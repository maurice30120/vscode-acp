# Etude : parler ACP dans le Docker Sandcastle

## Question

Aujourd'hui, le flux Sandcastle est :

```text
Plugin Pi / VS Code -> ACP -> bridge Sandcastle host -> CLI provider dans Docker
```

Le Docker ne parle donc pas ACP. Il execute une commande provider (`vibe`, `codex`, `pi`, `cursor`) construite par le bridge, avec un prompt texte et un parsing de sortie.

La question est de savoir s'il serait preferable de pousser ACP jusqu'au conteneur :

```text
Plugin Pi / VS Code -> ACP -> agent ACP dans Docker -> provider
```

## Reponse courte

Oui, c'est probablement mieux a moyen terme si Sandcastle devient une primitive centrale et multi-providers.

Non, ce n'est pas forcement mieux pour un POC rapide : cela ajoute un agent long-running dans le conteneur, un transport ACP a router, plus de gestion de cycle de vie et plus de surface de debug.

La bonne pratique observee dans l'ecosysteme ACP/Docker est :

1. Garder ACP sur stdio comme contrat principal.
2. Demarrer l'agent ACP comme un process enfant, meme si ce process est encapsule dans Docker.
3. Ne pas ouvrir de port reseau pour ACP si l'integration est editor/IDE ; reserver HTTP a A2A ou a une API explicite.
4. Monter explicitement le workspace, le home/session store et les credentials necessaires.
5. Laisser le host garder la decision de permissions et de promotion des changements.

La recommandation pragmatique pour ce repo est donc :

1. Garder le bridge host actuel pour stabiliser les providers.
2. Introduire un mode experimental `transport: "sandcastle-acp-container"` pour Vibe ou un provider pilote.
3. Basculer seulement si le mode ACP-in-Docker reduit vraiment les adaptateurs CLI et les erreurs de traduction.

## Recherche rapide

Les sources consultées convergent sur un point : ACP est d'abord un protocole agent-host sur `stdin/stdout`.

- Docker Agent expose officiellement des agents via ACP avec `docker agent serve acp <agent.yaml>`. La documentation precise que le host spawn le process, envoie les messages JSON-RPC sur stdin et lit les reponses sur stdout. Elle distingue aussi ACP pour l'integration IDE, A2A pour agent-to-agent sur HTTP, et MCP pour exposer des agents comme outils.
- La documentation d'architecture ACP indique que l'editeur demarre l'agent comme sous-processus a la demande, avec communication sur `stdin/stdout`, et que les notifications JSON-RPC servent au streaming temps reel.
- Open Interpreter expose aussi un mode `interpreter acp` en stdio, et recommande de ne pas l'envelopper dans une TUI interactive.
- ACPBox documente une approche gateway : un process HTTP garde un process ACP stdio par worker, avec `session/new` puis `session/prompt`. Son mode Docker conseille d'embarquer le binaire ACP dans l'image et de configurer la commande ACP.
- tldw documente un mode sandbox Docker pour ACP : on configure `agent_command` avec une commande qui sert ACP sur stdio, par exemple `opencode acp` ou un adaptateur `codex-acp`. La doc met en garde contre les commandes qui relancent recursivement le runner.
- Coop documente un proxy ACP devant un agent containerise pour survivre aux redemarrages de conteneur : le proxy conserve le handshake, recharge les sessions et relance le child si le conteneur tombe.

Conclusion de recherche : la bonne pratique n'est pas "ACP via HTTP dans Docker". C'est plutot "un host/proxy stable parle ACP stdio a un process agent, et ce process peut etre lance dans Docker".

## Probleme du modele actuel

Le bridge host fait une traduction fragile :

```text
Prompt ACP -> texte -> commande shell provider -> stdout/stderr -> evenements ACP
```

Cette traduction depend de details CLI propres a chaque provider. Exemple recent : Vibe en mode `-p` ne lisait pas le prompt comme attendu depuis `stdin`, mais comme argument positionnel. L'appel ACP etait correct ; l'erreur etait dans l'adaptateur CLI.

Ce modele a trois faiblesses :

- Chaque provider impose son dialecte CLI : flags, stdin, JSON streaming, codes d'erreur.
- Le protocole riche ACP est degrade en prompt texte avant d'entrer dans la sandbox.
- Le debug traverse deux abstractions differentes : ACP cote extension, CLI cote Docker.

## Ce que change ACP dans Docker

Avec ACP dans Docker, le conteneur demarre un vrai agent ACP. Le bridge host devient surtout un proxy de transport et de cycle de vie :

```text
session/new -> proxy -> agent container
session/prompt -> proxy -> agent container
session/update <- proxy <- agent container
```

Le provider dans le Docker peut alors :

- recevoir les `ContentBlock` ACP directement ;
- emettre des `sessionUpdate` ACP directement ;
- demander des permissions via le protocole ACP ;
- exposer des methodes d'extension eventuelles ;
- eviter une partie du parsing stdout provider-specific.

## Avantages

- Moins de perte semantique : ACP reste le contrat de bout en bout.
- Moins de bugs de traduction prompt-vers-shell.
- Streaming plus propre : les chunks, thoughts, tool calls et erreurs restent structures.
- Meilleure isolation conceptuelle : le conteneur contient l'agent complet, pas seulement une CLI appelee par le host.
- Possibilite de tester l'agent Docker comme un agent ACP standard, sans passer par toute l'extension.

## Inconvenients

- Il faut gerer un transport ACP entre host et conteneur : stdio via `docker exec`, socket, ou process long-running lance au demarrage.
- Il faut definir qui possede les permissions : le host doit rester decisionnaire pour les actions dangereuses.
- Les credentials et mounts doivent etre encore plus stricts, car l'agent ACP dans Docker peut devenir plus autonome.
- Le cycle de vie devient plus complexe : demarrage, handshake, timeouts, annulation, fermeture, logs.
- Tous les providers ne parlent pas ACP nativement ; il faudra peut-etre garder un adaptateur CLI dans le conteneur.

## Architecture candidate

### Option A : bridge proxy ACP vers process Docker

Le host lance un conteneur puis demarre dedans un process ACP :

```text
host bridge
  -> docker exec node /app/agent-acp.js
  -> stdio ACP
```

Le host ne traduit plus les prompts. Il relaie les messages ACP et garde la responsabilite :

- creation/suppression du worktree ;
- montage des credentials ;
- preview/apply/reject ;
- politique de promotion ;
- logs host.

C'est l'option la plus proche du design actuel.

Bonne pratique detaillee :

- Le process host reste le serveur ACP vu par l'IDE ou Pi.
- Le process host spawn un child ACP dans Docker avec un transport stdio equivalent a `docker exec -i ... sandcastle-provider-acp`.
- Le host relaie `initialize`, `authenticate`, `session/new`, `session/prompt`, `cancel`, `session/close`.
- Le host garde un registre des sessions actives pour pouvoir tuer/redemarrer le child proprement.
- Les flux stdout/stderr sont strictement separes : stdout est reserve au NDJSON/JSON-RPC ACP ; logs et diagnostics vont sur stderr.
- Le conteneur monte un workspace unique, un home agent persistant et les credentials minimaux.

### Option B : agent ACP complet dans Docker, Sandcastle host minimal

Le conteneur devient l'unite principale. Le host ne fait que demarrer le conteneur et relayer ACP.

C'est plus propre a long terme, mais plus risqué maintenant car cela deplace beaucoup de responsabilites d'un coup.

### Option C : garder CLI, durcir les adaptateurs

On conserve le modele actuel, mais on ajoute des tests contractuels par provider :

- commande construite ;
- prompt avec apostrophes et multiline ;
- parsing streaming ;
- erreurs provider connues.

C'est le meilleur choix court terme, mais ca ne resout pas le probleme de fond.

## Recommandation

Faire une etape intermediaire :

1. Garder le bridge host actuel comme chemin stable.
2. Ajouter un prototype ACP-in-Docker limite a un provider pilote.
3. Le prototype doit parler ACP sur stdio depuis un process lance dans le conteneur.
4. Le host reste proprietaire de `preview/apply/reject` et de la policy de promotion.
5. Comparer sur trois criteres :
   - moins de code provider-specific ;
   - meilleure qualite des erreurs ;
   - annulation et streaming plus fiables.

Si ces trois criteres sont positifs, ACP-in-Docker doit devenir le modele cible.

La forme cible recommandee est donc :

```text
Pi / VS Code
  -> ACP stdio
  -> Sandcastle host proxy
  -> ACP stdio via docker exec -i
  -> agent ACP dans le conteneur
  -> provider interne
```

Pas :

```text
Pi / VS Code -> HTTP -> Docker
```

sauf si le besoin devient explicitement un service agent-to-agent ou une API distante.

## Plan technique minimal

1. Ajouter un mode de config experimental :

```json
{
  "transport": "sandcastle-acp-container",
  "provider": "vibe",
  "model": "mistral-large-latest"
}
```

2. Dans le bridge host, creer une variante runtime qui :

- cree le sandbox Docker ;
- lance un process ACP dans le conteneur ;
- connecte `AgentSideConnection` host a ce process ;
- relaie les updates sans convertir en CLI stdout.

3. Dans l'image Docker, fournir un binaire agent ACP minimal :

```text
/usr/local/bin/sandcastle-provider-acp
```

4. Pour le premier prototype, cet agent peut encore appeler `vibe` en interne, mais l'adaptation CLI est deplacee dans le conteneur et testee comme un agent ACP.

5. Ajouter des tests :

- handshake ACP container ;
- prompt texte simple ;
- prompt multiline avec apostrophe ;
- streaming ;
- cancel ;
- erreur provider remontee en message ACP exploitable ;
- fermeture propre du conteneur.

## Decision proposee

Ne pas remplacer immediatement le bridge actuel.

Creer un prototype `sandcastle-acp-container` dans une branche dediee. Si le prototype reduit effectivement les adaptations provider et ameliore les erreurs, faire evoluer Sandcastle vers :

```text
ACP end-to-end jusqu'au conteneur
```

Le modele actuel reste acceptable pour stabiliser vite, mais il continuera a produire des bugs de traduction CLI comme celui observe avec Vibe.

## Sources

- Docker Docs, ACP pour Docker Agent : https://docs.docker.com/ai/docker-agent/features/acp/
- Docker Docs, choix ACP/MCP/A2A : https://docs.docker.com/ai/docker-agent/integrations/
- Agent Client Protocol, architecture : https://agentclientprotocol.com/get-started/architecture
- Open Interpreter, mode ACP : https://www.openinterpreter.com/docs/terminal/acp
- ACPBox, gateway OpenAI vers ACP stdio avec Docker : https://pypi.org/project/acpbox/
- tldw, ACP sandbox Docker : https://www.tldwproject.com/server/docs/User_Guides/Integrations_Experiments/Getting_Started_with_ACP/
- Coop `acpproxy`, proxy ACP devant agent containerise : https://pkg.go.dev/github.com/AndrewDryga/coop/internal/acpproxy
