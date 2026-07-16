---
ready-for-agent: true
title: "Spec : Transport Sandcastle éphémère dans plugin-pi"
---

## Problem Statement

Aujourd'hui, `plugin-pi` ne sait exécuter que des agents ACP **natifs** (`transport: "acp"` ou absence de transport) déclarés dans `.pi/.acp/acp-agents.json`. Toute configuration portant `transport: "sandcastle"` est rejetée à la validation. Un utilisateur de Pi qui veut faire travailler un agent dans une sandbox isolée — Docker + worktree Git jetable, sans écriture directe dans son workspace — n'a donc aucun chemin pour le faire depuis Pi, alors que le `plugin-vscode` voisin le propose. Pour l'utilisateur, le problème est : *"je ne peux pas lancer, depuis un pipeline Pi, un agent qui implémente du code dans une sandbox puis m'appliquer (ou rejeter) ses changements"*.

## Solution

Ajouter à `plugin-pi` le transport Sandcastle (Docker + worktree jetable) en l'exécutant comme un **run éphémère** : un process *bridge ACP* né et mort pour ce run, parlant ACP sur stdio, spawné à la demande. La config Sandcastle est embarquée dans le plugin (`plugin-pi/.pi/.acp/.sandcastle/config.json`) ; la promotion des changements de la sandbox vers le workspace réutilise le **canal d'approbation pipeline existant** (ADR-0005) plutôt que d'en inventer un nouveau. `plugin-pi` reste une implémentation autonome : le code utile est porté depuis `plugin-vscode` par duplication intentionnelle (ADR-0008), sans dépendance au plugin vscode.

## User Stories

1. En tant qu'utilisateur Pi, je veux déclarer un agent Sandcastle dans un fichier dédié, de sorte que sa config soit validée séparément des agents ACP natifs.
2. En tant qu'utilisateur Pi, je veux écrire `.pi/.acp/.sandcastle/config.json` avec une politique de promotion globale (`ask`/`autoApply`/`autoReject`) et une map d'agents, de sorte que toute ma flotte Sandcastle suive la même politique.
3. En tant qu'utilisateur Pi, je veux que chaque agent Sandcastle porte `transport: "sandcastle"` explicitement, de sorte que je ne confonde jamais une config sandbox avec une config native.
4. En tant qu'utilisateur Pi, je veux préciser `provider` et `model` (et optionnellement `effort`, `displayName`, `env`, `skills`) par agent Sandcastle, de sorte que le bridge lance le bon CLI dans la sandbox.
5. En tant qu'utilisateur Pi, je veux que `provider` invalide, `model` vide, `effort` invalide, ou `promotion` invalide produisent une erreur explicite pointant vers le champ fautif, de sorte que je puisse corriger sans deviner.
6. En tant qu'utilisateur Pi, je veux que si je mets par erreur un agent `transport: "sandcastle"` dans `acp-agents.json`, la validation le rejette avec un message pointant vers `.pi/.acp/.sandcastle/config.json`, de sorte que l'erreur soit auto-corrigible.
7. En tant qu'utilisateur Pi, je veux qu'un nom d'agent présent à la fois dans `acp-agents.json` (natif) et dans `.sandcastle/config.json` (Sandcastle) soit signalé comme erreur, de sorte qu'aucun pipeline ne démarre sur un nom ambigu.
8. En tant qu'utilisateur Pi, je veux qu'un pipeline puisse référencer un agent Sandcastle au même titre qu'un agent natif, de sorte que la composition pipeline soit uniforme.
9. En tant qu'utilisateur Pi, je veux qu'un agent Sandcastle déclaré dans `.sandcastle/config.json` n'apparaisse pas dans la collection des agents natifs et inversement, de sorte que les deux mondes restent disjoints sauf pour la validation des doublons.
10. En tant qu'utilisateur Pi, je veux que lancer une étape de pipeline sur un agent Sandcastle démarre une sandbox Docker + un worktree Git isolé, exécute le prompt de l'agent dedans, et démolisse la sandbox à la fin, de sorte que mon workspace ne soit jamais écrit directement par l'agent.
11. En tant qu'utilisateur Pi, je veux que `sideEffects: "none"` (défaut) sur un run Sandcastle se solde par un discard silencieux de la sandbox après le run, de sorte qu'un run en lecture seule ne mute jamais mon workspace.
12. En tant qu'utilisateur Pi, je veux que `sideEffects: "workspace"` sur un run Sandcastle déclenche la promotion après le run, de sorte que je puisse choisir d'appliquer ou non les changements.
13. En tant qu'utilisateur Pi, quand `promotion` vaut `ask` et qu'une UI Pi est disponible, je veux que le système m'envoie une demande d'approbation (canal pipeline existant) portant le nombre de fichiers changés, de sorte que je puisse Apply ou Reject sans surprise.
14. En tant qu'utilisateur Pi, en mode `ask` avec UI, quand je réponds `approve` je veux que les changements de la sandbox soient **appliqués** au workspace et que le pipeline reprenne, de sorte que l'application soit effective.
15. En tant qu'utilisateur Pi, en mode `ask` avec UI, quand je réponds `reject` je veux que la sandbox soit **discartée** et que le pipeline s'arrête avec un retour clair, de sorte que rien ne mute.
16. En tant qu'utilisateur Pi, en mode `ask` avec UI, quand je dismiss l'approbation sans décider, je veux que la sandbox soit discartée et que le run retourne `cancelled`, de sorte que l'absence de décision ne bloque pas le pipeline.
17. En tant qu'utilisateur Pi tournant headless (pas d'UI Pi) en mode `ask`, je veux que le run retourne `cancelled` + discard (pas un crash), de sorte qu'un pipeline automatisé s'arrête proprement sans mutation.
18. En tant qu'utilisateur Pi, en mode `autoApply`, je veux que les changements de la sandbox soient automatiquement appliqués au workspace, de sorte que les pipelines sans intervention humaine appliquent le code.
19. En tant qu'utilisateur Pi, en mode `autoApply`, si l'application échoue (le contrôle `git apply` ne passe pas), je veux que le run échoue avec une erreur explicite, de sorte que je sache que rien n'a été appliqué partiellement.
20. En tant qu'utilisateur Pi, en mode `autoReject`, je veux que la sandbox soit automatiquement rejetée et que la suite du pipeline s'arrête, de sorte que les runs de type « sanity check » ne mutent jamais le workspace.
21. En tant qu'utilisateur Pi, quand l'agent n'a produit **aucun changement de fichier**, je veux que le run retourne `no_changes` (et que rien ne soit appliqué), de sorte que l'état soit honnête.
22. En tant qu'utilisateur Pi, je veux qu'au moment de l'approbation du plan (avant l'implémentation), un message distinct m'indique « approuver avant implémentation Sandcastle » quand l'implémenteur est Sandcastle, de sorte que je sache que je m'engage à promouvoir un run sandbox.
23. En tant qu'utilisateur Pi, je veux que la détention du runtime ACP standard (initialize/prompt/cancel/session-update/AbortSignal) soit identique pour un run Sandcastle et un run natif, de sorte qu'il n'y ait qu'un seul modèle de run côté Pi.
24. En tant qu'utilisateur Pi, je veux qu'un agent natif existant continue de fonctionner à l'identique après l'ajout de Sandcastle, de sorte que rien ne régresse pour les pipelines actuels.
25. En tant qu'utilisateur Pi, je veux que la config Sandcastle soit embarquée dans le plugin, de sorte que les workspaces n'aient pas besoin de fournir `.pi/.acp/.sandcastle/config.json` pour utiliser Sandcastle.
26. En tant qu'utilisateur Pi, je veux que l'annulation d'un run Sandcastle (AbortSignal, ADR-0006) démolisse le process bridge et la sandbox en cours, de sorte qu'aucun état zombie ne subsiste.
27. En tant qu'utilisateur Pi, je veux que les permissions ACP demandées par le bridge Sandcastle soient auto-approuvées, de sorte que le bridge puisse piloter la sandbox sans interrompre l'utilisateur.
28. En tant qu'utilisateur Pi, je veux que la promotion ne soit jamais interactive via une fenêtre VS Code (Pi n'en a pas), de sorte que tout le voyage d'approbation passe par le canal pipeline Pi.
29. En tant qu'utilisateur Pi, je veux qu'aucun View Diff interactif ne soit proposé en v1, de sorte que la surface reste simple ; les métadonnées (`filesChanged`, branche) suffisent dans le message d'approbation.
30. En tant qu'agent exécutant /en implementant un ticket Sandcastle, je veux que la spec et les ADRs (0008, 0009) restent les seules sources de décision, de sorte que je ne réintroduise pas des alternatives déjà rejetées.

## Implementation Decisions

- **Autonomie (ADR-0008)** : `plugin-pi` est une implémentation autonome, indépendante de `plugin-vscode`. Le code utile est porté par **duplication intentionnelle**, pas par factorisation. La seule frontière commune reste le package `@acp-client/pipeline`. On ne crée aucune dépendance de plugin-pi vers plugin-vscode.

- **Runtime éphémère (ADR-0009 §1)** : un run Sandcastle = un process bridge ACP né et mort pour ce run. On **ne porte pas** la couche « ConnectedAgent longue durée » de `plugin-vscode`. On porte seulement la tranche utile : la config du bridge, la garde Docker/worktree, la promotion du worktree, la politique de promotion pure, et le point d'entrée `bridge` lancé en process séparé. Le modèle runtime Pi (éphémère, AbortSignal, ADR-0006) est conservé tel quel.

- **Config séparée sous `.pi/.acp/.sandcastle/config.json` (ADR-0009 §2, cohérent avec ADR-0001)** : un fichier dédié, sous le home runtime `.pi/.acp`. Forme de l'entrée (decision-rich, issu de l'interview) :

  ```jsonc
  {
    "promotion": "ask",                       // "ask" | "autoApply" | "autoReject", global
    "agents": {
      "Codex Sandcastle": {
        "transport": "sandcastle",             // requis — discriminant, jamais implicite
        "provider": "codex",                   // "codex" | "cursor" | "pi" | "vibe"
        "model": "gpt-5",
        "effort": "medium",                    // "low"|"medium"|"high"|"xhigh", optionnel
        "displayName": "...",                  // optionnel
        "env": {},                             // optionnel
        "skills": true                         // optionnel, false désactive le wiring .agents/skills
      }
    }
  }
  ```

  Le `transport` est **requis** sur chaque entrée (symétrie avec `plugin-vscode`, sécurité du discriminant `isSandcastleAgentConfig`). La config agent reste **pure** (= qui lancer) ; elle ne porte **pas** `sideEffects`.

- **`sideEffects` est une propriété du *run*, pas de l'agent (ADR-0009 §3)** : `'none' | 'workspace'`, défaut `'none'`. Portée par l'input de run du pipeline (côté `@acp-client/pipeline`), pas par la config agent. Le même agent peut être `none` dans un pipeline et `workspace` dans un autre.

- **`acp-agents.json` reste natif-only** : si `transport: "sandcastle"` y apparaît, la validation le rejette avec un message pointant explicitement vers `.pi/.acp/.sandcastle/config.json`. Le parser natif ne se couple pas à la forme Sandcastle.

- **Doublon natif/Sandcastle = erreur** : charger les deux fichiers et croiser les noms ; tout nom présent des deux côtés est une erreur, et aucun pipeline référençant ce nom ne démarre.

- **Routing run-then-connector (ADR-0009 §4)** : le runner lit la config de l'agent, inspecte `transport`. Si `sandcastle` → nouveau connector Sandcastle ; sinon → connector natif existant, **inchangé**. Le natif ne bouge pas.

- **Spawn du bridge (ADR-0009 §4)** : le connector Sandcastle spawn un process enfant — `command: node`, `args` pointant vers le bridge (provider/model/effort), `env` portant `ACP_SANDCASTLE_IMAGE`. Le bridge **parle ACP sur stdio** (AgentSideConnection NDJSON), donc le `ConnectionManager` existant (initialize/prompt/cancel/session-update) est **réutilisé tel quel** ; seul le spawn diffère du natif. Le process est géré par le même `AgentProcessManager` que le natif : un run = un spawn, démoli à la fin (cohérent avec éphémère + ADR-0006).

- **Promotion post-run (ADR-0009 §5)** : outcomes `'applied' | 'no_changes' | 'rejected' | 'cancelled'` repris tels quels de `plugin-vscode` (symétrie). Flux :
  - `sideEffects: none` (défaut) → discard silencieux, pas de promotion, pas d'outcome.
  - `sideEffects: workspace` → preview, puis décision selon `promotion` :
    - `autoApply` → apply ; si `git apply --check` échoue → erreur explicite, rien n'est appliqué partiellement ; outcome `applied` sinon, `no_changes` si aucun fichier changé.
    - `autoReject` → reject ; outcome `rejected` ; suite du pipeline s'arrête.
    - `ask` → **réutilisation du canal d'approbation pipeline existant (ADR-0005)** : `approve` ≈ Apply (→ `applied`), `reject` ≈ Reject (→ `rejected`+discard), dismiss/absence → `cancelled`+discard. Le message d'approbation porte les métadonnées (`filesChanged`, branche), **pas de diff interactif**.

  La distinction `cancelled` ≠ `rejected` est conservée : `rejected` = décision explicite de jeter, `cancelled` = pas de décision (dismiss OU pas d'UI). Le pipeline headless en `ask` retourne `cancelled`+discard (pas un crash).

- **`isAgentSandcastle` (ADR-0009 §6)** : branché par un one-liner dans les dépendances du `PipelineService` côté Pi (symétrie avec `plugin-vscode`), de sorte que le message `plan_ready` porte « approve before Sandcastle implementation » quand l'implémenteur de l'étape est Sandcastle. **Pas** de rendu verbose supplémentaire — le signal reste celui, déjà existant, de l'approbation de plan.

- **Run ACP uniforme** : initialize/prompt/cancel/session-update/AbortSignal sont identiques entre Sandcastle et natif côté runner. Le runner reste ignorant du transport une fois le connector choisi.

- **Permissions du bridge** : les permissions ACP demandées par le bridge Sandcastle sont auto-approuvées (le bridge doit piloter la sandbox sans bloquer l'utilisateur).

- **Dépendance `@ai-hero/sandcastle`** : ajoutée à `plugin-pi` (runtime Docker/worktree externe, déjà consommé par `plugin-vscode`). C'est une dépendance à package externe, pas une dépendance au plugin vscode.

## Testing Decisions

- **Test external behavior, not implementation details.** On ne teste pas « comment le connector construit exactement la commande spawn en interne » au-delà de ce que le comportement observable expose ; on teste le routage et les outcomes via des mocks de connexion ACP, comme le fait le test runner existant.

- **Deux seams, les deux existants — aucun seam nouveau créé (idéal) :**

  1. **Seam config-catalogue** (prior art : tests de parsing de config sur disque via `createTempWorkspace` + `writeFile` + `parsePiAcpConfig`/`loadPiAcpConfig`, assertions sur `errors`/`agents`) couvre :
     - parsing de `.pi/.acp/.sandcastle/config.json` valide → agents fusionnés (noms) et utilisables ;
     - `provider`/`model`/`effort`/`promotion` invalides → erreurs explicites pointant le champ ;
     - `transport: "sandcastle"` dans `acp-agents.json` → rejet avec message pointant vers le fichier dédié ;
     - doublon de nom natif/Sandcastle → erreur, pipeline ignoré ;
     - absence de fichier Sandcastle → comportement natif inchangé (non-régression).

  2. **Seam runner/routing** (prior art : `EphemeralAcpRunner` avec `connector` injecté et `pi.sendMessage` observé, le seam polymorphe le plus haut) couvre, derrière l'interface `AcpConnector` :
     - **Routage** : config Sandcastle fournie → le connector Sandcastle (mocké) est appelé, pas le natif ; initialize/prompt se déroulent.
     - **sideEffects & promotion** : mock du `prompt` de la connexion, puis assertions :
       - `none` → discard silencieux, aucun message d'approbation, pas d'outcome ;
       - `workspace` + `ask` → message d'approbation poussé sur le canal pipeline (ADR-0005) ; `approve`→`applied`, `reject`→`rejected`+discard, dismiss/absence d'UI→`cancelled`+discard ;
       - `autoApply` → `applied` / `no_changes` (zéro fichier) / erreur si `git apply --check` échoue ;
       - `autoReject` → `rejected`, suite arrêtée ;
       - `ask` headless (pas d'UI) → `cancelled`+discard, pas de crash.
     - **`isAgentSandcastle`** : assertion que le texte du message `plan_ready` reflète « approve before Sandcastle implementation » quand l'implémenteur est Sandcastle, et reste générique sinon.

- **Tests unitaires secondaires** au spawn (assertion du `command`/`args`/`env` construits pour le bridge : `node`, chemin du `bridge`, `--provider`, `--model`, `--effort`, `ACP_SANDCASTLE_IMAGE`), au même niveau que les tests existants du `AgentProcessManager`. Ces tests sont secondaires : le comportement important (routage + promotion) est couvert par le seam runner, pas par eux. (Voir `/implement` : TDD piloté par le seam runner d'abord.)

- **Prior art** : `test/configCatalog.test.ts` (config depuis disque, temp workspaces), `test/runnerController.test.ts` (connector injecté + `pi.sendMessage` observé), `test/acpHandlers.test.ts` (process manager unit-level).

## Out of Scope

- **View Diff interactif** en mode `ask` (écarté en v1 — trop complexe côté UI Pi). Le message d'approbation porte seulement les métadonnées.
- **Runtime Sandcastle longue durée** (session de bridge réutilisée sur plusieurs prompts, type vscode `ConnectedSandcastleAgent`). Pi reste éphémère.
- **Port du `SandcastlePromotionUi` vscode** (QuickPick VS Code). Pi n'a pas d'UI VS Code ; la promotion passe par le canal pipeline.
- **Refactorisation de `plugin-vscode`** pour factoriser la couche Sandcastle. Duplication intentionnelle (ADR-0008).
- **Système de pools / réutilisation de process bridge** entre runs. Un run = un spawn = une destruction.
- **Changement du modèle d'annulation** (ADR-0006 reste applicable tel quel ; on confirme juste que le run Sandcastle l'honore).
- **Smoke Docker manuel** avec une image `acp-client-sandcastle:local` réelle et des credentials. Optionnel ; non requis par les tests automatisés.
- **Rendu verbose « via Sandcastle » dans les statuts d'activité.** Le signal Sandcastle reste porté par le seul message `plan_ready`.

## Further Notes

- **Vocabulaire** : utiliser le glossaire `CONTEXT.md` racine de `plugin-pi` — notamment la distinction **`cancelled`** (pas de décision) vs **`rejected`** (décision explicite), `side effects` (propriété du *run*), **Run éphémère**, **Promotion**.
- **ADRs contraignantes** : ADR-0001 (`.pi/.acp` = home runtime — justifie l'emplacement du fichier), ADR-0005 (canal d'approbation pipeline — réutilisé pour la promotion, pas un canal neuf), ADR-0006 (AbortSignal — le run Sandcastle l'honore), ADR-0008 (autonomie Pi, duplication intentionnelle), ADR-0009 (les six sous-décisions corrélées de cette spec).
- **Baseline tests : 74 verts** au démarrage du travail. Objectif : jamais de régression, ajout net de tests sur les deux seams.
- **Sitting alongside** : `plans/ajouter-sandcastle.md` (plan d'origine, maintenant historicisé par cette spec), `plans/corrections-architecture.md` et `plans/friz-pipeline.md` (travaux indépendants — ce ticket ne les touche pas).
- **Travail restant vs réalisé** : tout est en attente — ADR-0009 acte les décisions, aucune n'est encore implémentée dans le code. Le détail « ce qui est déjà fait » des autres plans est hors périmètre.
