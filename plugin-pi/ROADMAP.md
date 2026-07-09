# Roadmap — @acp-client/pi-extension

Roadmap du plugin Pi pour les pipelines ACP (`@acp-client/pi-extension`).
Le plugin orchestre plusieurs agents ACP externes via des pipelines déclaratifs
et des équipes d'agents, et s'intègre à l'hôte Pi (`@earendil-works/pi-coding-agent`).

Pour le contexte global de l'extension VS Code, voir [`../../ROADMAP.md`](../../ROADMAP.md).

---

## Objectifs du plugin

- Exposer la puissance des pipelines/teams ACP directement depuis Pi (commande `/pipeline`, outil `run_pipeline`).
- Connecter et orchestrer des agents ACP externes (Codex, Claude, Gemini, Vibe, …) depuis le workspace.
- Tirer parti de l'hôte Pi (UI, skills, `.agents/`, terminaux, permissions) comme runtime d'exécution.

---

## Réalisé

- Découverte des agents depuis `.pi/.acp/acp-agents.json`.
- Pipelines v2 (`.pi/.acp/pipelines/*.yaml`) : primitives + steps, étapes `approval`, validation.
- Teams v1 (`.acp/teams/*.yaml`) : composition par rôles compilée en pipelines (`teamCatalog`, `instructionResolver`).
- Spawn + connexion ACP (`agentProcess`, `connectionManager`, `defaultConnector`), proxy fichiers/terminal/permissions.
- Runner éphémère (`ephemeralRunner`) : connect → authenticate → prompt → collecte texte, avec abort/cancel.
- Commande slash `/pipeline` (`list`, `run`, `approve`, `reject`, `cancel`) et outil `run_pipeline` pour le modèle.
- Tests natifs `node:test` (configCatalog, runnerController) — zéro dépendance externe.

---

## Court Terme

### Consolidation Pipeline vs Feature Team

Le plugin supporte aujourd'hui deux formats d'orchestration qui se chevauchent :

- **Pipelines v2** (`.pi/.acp/pipelines/*.yaml`) — format déclaratif complet (`primitives` + `steps`), flexible.
- **Teams v1** (`.acp/teams/*.yaml`) — format rôle-basé simplifié (`planner` → `approval` → `implementer` → `reviewer` → `tester`), compilé en pipeline v2 par `teamCatalog` + `compileTeamToPipeline`.

**Constat** : les teams sont un **sous-ensemble strict** des pipelines. Le compilateur génère toujours la même structure de steps et les mêmes prompts à partir d'un format plus limité. Deux mécanismes parallèles pour le même résultat = charge cognitive, duplication de code, deux sources de doc/exemples à maintenir.

**Objectif : comprendre la différence puis ne garder qu'un seul format.**

- Auditer les cas d'usage réels : qui utilise les teams vs les pipelines ? Le format team apporte-t-il une valeur (ergonomie rôle, instructions par rôle) que le pipeline ne couvre pas ?
- Décider du format unique : conserver **pipelines v2** comme format canonique (plus expressif) et faire disparaître teams, **ou** promouvoir un format rôle unique (si la valeur ergonomique l'emporte) en abandonnant les pipelines low-level.
- Quelle que l'issue :
  - Supprimer l'autre format + son compilateur côté plugin (`teamCatalog`, `instructionResolver`, `compileTeamToPipeline` dans `@acp-client/pipeline`).
  - Migrer les exemples existants (`.acp/teams/`, `.pi/.acp/agents/*.md` par rôle) vers le format retenu.
  - Mettre à jour le README du plugin et les ADR concernés.
- Documenter la décision dans un ADR (rationale du format retenu, migration).

> Note : cette consolidation est à aligner avec la même dynamique côté extension VS Code (`../../ROADMAP.md`, section « Consolidation Pipeline vs Feature Team »).

### Simplifier l'appel

Réduire la friction pour lancer un pipeline depuis Pi :

- Un seul point d'entrée clair : aujourd'hui `/pipeline run <id> "<prompt>"` + approbation manuelle — clarifier le parcours « choisir un workflow → lancer ».
- Defaults sensibles : agent cible et options hérités du contexte courant plutôt qu'à re-spécifier.
- Lancer un pipeline directement depuis un fichier `.pi/.acp/pipelines/*.yaml` (raccourci / action dans l'UI Pi).
- Réduire le nombre d'étapes de confirmation avant le premier tour.
- Aligner l'appel pipeline et l'appel agent simple sur la même surface.

### Visualiser les changes depuis pi

Aujourd'hui pi produit des changements (fichiers, diffs, plans, artefacts) qui restent visibles côté pi/terminal. Objectif : que le plugin puisse **afficher des choses produites par pi** dans l'UI Pi, au-delà du texte simple collecté par `ephemeralRunner`.

- Définir un canal pi → plugin pour pousser du contenu affichable (diffs, fichiers modifiés, résumés d'étape, plans, sorties d'outils) — aujourd'hui seul le `agent_message_chunk` texte est collecté.
- Distinguer les side-effects : `sideEffects: workspace` produisent des changements de fichiers qu'il faut pouvoir visualiser (diff par fichier, navigation,Apply/Reject) plutôt que juste résumés en markdown.
- Synchronisation live : statut d'exécution, fichiers touchés, diff par fichier, retour à l'éditeur/au workspace.
- Réutiliser au maximum l'UI Pi (panneaux, dialogues select, messages) plutôt qu'un rendu ad hoc.
- Questions ouvertes :
  - Transport : events ACP dédiés (`session_update` enrichis ?) vs canal annexe du plugin ?
  - Sécurité/permissions : qu'est-ce qu'un agent peut pousser comme contenu affichable ?
  - Cycle de vie : run éphémère (pipeline step) vs session persistante pi ?

### Connexion à l'agent au travers de pi

Le plugin connecte déjà des agents ACP externes (Codex, Claude, Gemini, Vibe, …) en les spawnant. Piste : permettre de **router la connexion à un agent via pi** — pi comme transport/hôte ACP — et exposer cette connexion comme les autres agents.

- pi est déjà exposé via `pi-acp` (`Pi Agent` dans `acp-agents.json`) : étendre pour servir de pont/relay vers d'autres agents (pi wrapper ACP).
- Bénéfice : bénéficier des skills/workspace/`.agents/` de pi côté agent, tout en gardant l'orchestration pipeline (approbation, compilation, `run_pipeline`).
- Surface cohérente avec les agents natifs : commande `/pipeline`, collecte texte, approbation, annulation.
- À cadrer :
  - Un agent via pi = un agent ACP standard ? impact sur `connectionManager` / `defaultConnector` / `ephemeralRunner`.
  - Compatibilité avec les étapes pipeline (`primitives` référençant un agent pi-relayé).
  - Gestion de l'authentification et des permissions quand pi sert de relay.

---

## Moyen Terme

- Étendre l'outil `run_pipeline` : paramètres plus riches (sélection d'agent par étape, options de session, mode auto-approve).
- Persistance des runs pipeline côté plugin (historique, reprise d'un run interrompu).
- Hooks pipeline : actions personnalisables entre les étapes (validation, notification, scripts).
- Meilleures erreurs : classification des échecs (auth, agent introuvable, timeout, étape invalide) avec messages actionnables dans l'UI Pi.

---

## Long Terme

- Pipelines parallèles/branches (aujourd'hui strictement séquentiel) : comparaison multi-agent, fan-out/reduce.
- Pipelines pilotés par le modèle : le modèle Pi choisit et enchaîne les pipelines selon le contexte.
- Composition de pipelines : un pipeline appelant un autre pipeline comme étape.
- Export/import de pipelines et teams partageables entre workspaces.

---

## Pistes Techniques

| Piste | Statut |
| ------- | -------- |
| Couverture de tests (catalog, runner, handlers ACP) | Partiel — configCatalog + runnerController ; edge cases à compléter |
| Consolidation pipeline/team | À faire — deux formats parallèles, décider du format unique |
| Visualisation des changes pi dans l'UI | À faire — aujourd'hui texte seul, pas de rendu diffs/artefacts |
| Connexion agent via pi (relay) | À faire — pi déjà exposé via `pi-acp`, relay à cadrer |
| Hooks et persistance de runs | À faire |
| Pipelines parallèles | À faire — aujourd'hui séquentiel uniquement |

---

## Priorités Suggérées

1. **Consolidation Pipeline vs Feature Team** — auditer, décider du format unique, supprimer l'autre (court terme).
2. **Visualiser les changes depuis pi** — canal pi → plugin pour diffs/artefacts, rendu dans l'UI Pi.
3. **Connexion à l'agent au travers de pi** — pi comme relay ACP, surface cohérente avec les agents natifs.
4. **Simplifier l'appel** — defaults sensibles, moins de confirmations, lancement depuis un fichier YAML.
5. **Étendre `run_pipeline`** — paramètres riches, hooks, persistance (moyen terme).
