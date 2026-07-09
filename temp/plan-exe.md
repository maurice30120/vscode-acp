# Plan d'exécution — Ajout de schémas Mermaid au README `acp-pi-extension`

> Rapport post-exécution. Ce document retrace **toutes les étapes réellement effectuées**,
> les outils utilisés, les difficultés rencontrées, et — importantly — **clarifie ce qui a été
> vérifié vs ce qui n'a PAS été exécuté** concernant le pipeline ACP et les appels d'agents.

---

## 1. Objectif initial

Demande 1 : « ajoute des schémas mermaid au `packages/acp-pi-extension/README.md` ».
Demande 2 : « tu vas me faire un fichier `temp/plan-exe.md` avec toutes les étapes, les outils
et les difficultés que tu as trouvées — je veux voir si mon pipeline a bien marché avec le call
des agents ACP et toute info disponible ».

## 2. Hypothèse importante à corriger d'emblée

> ⚠️ **Je n'ai pas exécuté de pipeline ACP ni fait d'appel réel à un agent ACP externe.**
>
> Aucun `run_pipeline`, aucune commande `/pipeline run`, aucun spawn de sous-process
> `codex-acp` / `pi-acp` n'a eu lieu pendant cette session. Mon travail a été **lecture de code +
> édition de documentation**. Les informations ci-dessous sur le fonctionnement du pipeline
> proviennent de la **lecture du source** (`src/`), pas d'une exécution live.

Si tu veux réellement vérifier que ton pipeline appelle bien les agents ACP, il faut lancer
(pour de vrai, dans un terminal) :

```bash
cd packages/acp-pi-extension
npm run build
npm test                                  # node --test dist/test/**/*.test.js
# puis, depuis l'hôte Pi :
#   /pipeline list
#   /pipeline run demo "remets une note dans NOTES.md"
#   /pipeline approve
```

Je peux exécuter `npm test` ou `npm run build` dans une étape suivante si tu le souhaites —
c'est ça qui donnera la « preuve de fonctionnement » côté pipeline + ACP runner (les tests
mockent le runner ACP via `runnerController.test.ts`).

---

## 3. Étapes réellement effectuées (chronologie)

| # | Action | Outil | Fichier / cible | Résultat |
| --- | -------- | ------ | ----------------- | ---------- |
| 1 | Lire le README actuel | `read` | `packages/acp-pi-extension/README.md` | 220 lignes chargées avec anchors `LINE:HASH` |
| 2 | Lister le dossier package | `bash` (`ls`) | `.../acp-pi-extension/` | `README.md dist node_modules package.json src test tsconfig.json` |
| 3 | Demander un outline sémantique du dossier `src` | `module_report` | `src/` | ❌ **Échec** — voir §5. Difficulté 1 |
| 4 | Lire `runtime/pipelineController.ts` | `read` | source | OK — comprend le contrôleur |
| 5 | Lire `acp/ephemeralRunner.ts` | `read` | source | OK — comprend le runner ACP |
| 6 | Lire `runtime/commands.ts` | `read` | source | OK — comprend les commandes slash |
| 7 | Lire `index.ts` | `read` | source | OK — point d'entrée du plugin |
| 8 | Lire `acp/defaultConnector.ts` | `read` | source | OK — comprend le connecteur ACP |
| 9 | Relire la section « Flux d'architecture » à remplacer | `read` (offset 185) | README | Anchors fraîches récupérées |
| 10 | Remplacer le bloc ASCII par 4 schémas Mermaid | `edit` (replace_lines) | README | ✅ Appliqué — mais auto-fix déclenché (voir §5. Difficulté 2) |
| 11 | Re-lire la section modifiée (post auto-format) | `read` (offset 185) | README | ✅ Validé, markdownlint clean |

## 4. Outils utilisés (résumé)

- `read` — lecture de fichiers (README + 5 fichiers source)
- `bash` — `ls` (dossier package) + `mkdir` (création de `temp/`)
- `module_report` — tentative d'outline sémantique sur `src/` (a échoué)
- `write` — création de ce fichier `temp/plan-exe.md`
- `edit` — remplacement de la section « Flux d'architecture » dans le README

Aucun : `lsp_diagnostics`, `lsp_navigation`, `ast_grep_*`, `grep`, `search`, `refs`,
`run_pipeline`, `subagent`, `mcp`, `web_search`.

## 5. Difficultés rencontrées

### Difficulté 1 — `module_report` indisponible sur `src/`

```
path: packages/acp-pi-extension/src
available: false
staleness: "unavailable"
semantic.source: "none"   (références/implementations false)
summary: imports=0 exports=0 symbols=0
```

Le rapport sémantique (who-uses-this, blast radius, callbacks) n'est **pas disponible** pour ce
dossier. Cause probable :

- Cache de graphe sémantique non construit pour ce package (les modules pi-lens dépendent d'un
  index project-wide ; ici on pointe sur un sous-dossier d'un monorepo sans graphe).
- `module_report` dégrade normalement vers un outline tree-sitter, mais ici même l'outline
  n'est pas retourné — probable dossier ciblé sans résoudre les fichiers `.ts`.

**Contournement appliqué** : lecture manuelle des fichiers clés (`pipelineController.ts`,
`ephemeralRunner.ts`, `commands.ts`, `index.ts`, `defaultConnector.ts`) avec `read`.

### Difficulté 2 — Auto-format markdownlint déclenché après `edit`

Après l'opération `edit` (replace_lines de ~22 lignes → 127 lignes), pi-lens a signalé :

```
Auto-fixed 1 issue(s) (markdownlint:1)
Warning: File was modified by auto-format/fix … You MUST re-read modified file(s) before making any further edits.
```

Le fichier a été réécrit (normalisation de la table des dépendances notamment :
`| Package | Rôle |` → `| Package | Rôle |` + `| --- | --- |`). Les anchors `LINE:HASH` de mon
contexte étaient donc **potentiellement périmés**.

**Contournement appliqué** : re-`read` de la section (offset 185) avant toute autre édition,
conformément à l'avertissement. Le contenu rendu était correct, les 4 schémas Mermaid sont
présents et valides.

### Difficulté 3 — Fragilité des anchors sur un `replace_lines` long

Le replaceport concernait 26 lignes (bloc ASCII `Hôte Pi → … → .acp/teams/*.yaml`).
J'ai dû encadrer avec `start_anchor: "185:12b"` et `end_anchor: "210:fd6|```"`. Un risque
d'ancre ambiguë sur la ligne ```` ``` ```` existait ; le match a ici fonctionné du premier coup.

---

## 6. Schémas Mermaid produits (4)

1. **Flux d'architecture** (`flowchart TD`) — Hôte Pi → commandes/outils → PipelineController
   → PipelineService → EphemeralAcpRunner → defaultConnector (AgentProcessManager +
   ConnectionManager + PiAcpClient + handlers FS/Terminal/Permission) → agent ACP externe.
2. **Découverte de la configuration (catalog)** (`flowchart LR`) —
   `.pi/acp-agents.json` / `.acp/pipelines/*.yaml` / `.acp/teams/*.yaml` → catalog → fusion.
3. **Exécution d'un pipeline (avec validation humaine)** (`sequenceDiagram`) —
   run → plan-ready → alt approve/reject/cancel.
4. **Cycle de vie d'un run ACP** (`sequenceDiagram`) — spawn → initialize ACP → newSession
   (retry auth) → prompt → stream agent_message_chunk → PromptResponse → dispose / abort.

Tous en français, cohérents avec le README. markdownlint a validé sans erreur.

---

## 7. Ce que j'ai appris sur le pipeline ACP (lecture de code, pas exécution)

Ce qui suit est issu **uniquement de la lecture du source**, pas d'un run réel.

### 7.1 Points d'entrée — l'hôte Pi (`src/index.ts`)

- Événements : `session_start` → instancie paresseusement un `PipelineController` (1 par `cwd`,
  dispose l'ancien si le cwd change) ; `session_shutdown` → `dispose()`.
- Commande slash : `pi.registerCommand('pipeline', …)` → délègue à
  `handlePipelineCommand()` dans `commands.ts`.
- Outil modèle : `pi.registerTool({ name: 'run_pipeline', … })` → `PipelineController.runPipeline`.

### 7.2 Commande `/pipeline` (`src/runtime/commands.ts`)

Sous-commandes : `list` (vide = list), `run`, `approve`, `reject`, `cancel`.
`parseRunArgs` matche d'abord un **titre** de pipeline (plus long d'abord, sinon id 1er mot).

### 7.3 Orchestrateur (`src/runtime/pipelineController.ts`)

- `PipelineController` wrappe un `PipelineService` (@acp-client/pipeline).
- Injecte au service :
  - `getPipelineDefinitions`, `getPipelineDefinitionForAgent` (catalog),
  - `getAgentConfigs` (`.pi/acp-agents.json`),
  - `runner.run` = `EphemeralAcpRunner.run` par défaut (injectable via options — c'est ce que
    les tests utilisent pour mocker),
  - `isRunAbortedError` → `RunAbortedError`.
- Événements : `plan-ready` → stocke `pendingPlan`, envoie message UI `kind: 'plan-ready'` ;
  `status` → log + push dans `lastStatuses`.
- `runPipeline` → `service.createPlan` ; retourne `{ sessionId, plan?, output?, awaitingApproval }`.
- `approve`/`reject`/`cancel` → `service.approvePlan` / `rejectPlan` / `cancel`.
- `permissionContext` renseigné pendant run/approve, effacé dans `finally`.

### 7.4 Runner ACP (`src/acp/ephemeralRunner.ts`)

Cycle d'un `runAgent(input)` :

1. Lecture config agent (`loadPiAcpConfig` ou `getAgentConfigs`).
2. Abonne un listener `SessionUpdateHandler` : collecte `agent_message_chunk` → `collectedText`
   - forward à `input.onSessionUpdate`.
3. Abonne `AbortSignal` → `onAbort` : `connection.cancel(sessionId)` puis `dispose`.
4. `connector.connect(...)` via `defaultConnector`.
5. `createSessionWithAuth` : `newSession({ cwd })` ; si erreur d'auth détectée
   (`SessionAuthHandler.isAuthRequiredError`) → `runAuthFlow` → retry `newSession`.
6. `connection.prompt([{ type: 'text', text }])` → `throwIfCancelled` sur `stopReason`.
7. `return { text: collectedText.trim() }` ; `finally` détache listeners + `dispose`.

### 7.5 Connecteur par défaut (`src/acp/defaultConnector.ts`)

- `AgentProcessManager.spawnAgent(name, config, cwd)` → process (cross-platform).
- `ConnectionManager.connect(agentId, process, cwd)` → `ClientSideConnection` (ACP over ndjson).
- En cas d'erreur : `killAgent` + `connectionManager.dispose()` puis rethrow.
- `dispose()` = `killAll` + `connectionManager.dispose` + `sessionUpdateHandler.dispose`.

### 7.6 Validation des appels ACP — ce qui existe comme tests

D'après la table du README + `test/` :

- `test/configCatalog.test.ts` — parsing config, validation YAML pipelines, compilation
  teams, limite taille instructions, fusion définitions.
- `test/runnerController.test.ts` — **runner ACP mocké** (collecte de texte, cancel/abort) +
  commandes `/pipeline` (`list`, `run` → `approve`).

➡️ Donc le **seul endroit qui prouve réellement l'appel ACP** (spawn/connection/prompt) en
tests automatisés, c'est `runnerController.test.ts` — mais avec un runner **mocké**. Le vrai
spawn de `codex-acp`/`pi-acp` n'est couvert que par une exécution live.

---

## 8. Vérification recommandée pour confirmer que le pipeline marche

Pour obtenir une « preuve de fonctionnement » réelle, dans l'ordre :

1. `cd packages/acp-pi-extension && npm run build` — compile TS → `dist/`.
2. `npm test` — doit passer (notes : zéro dépendance externe de test, `node:test` +
   `node:assert`).
3. Lancer l'hôte Pi avec une config `.pi/acp-agents.json` valide + au moins un pipeline
   `.acp/pipelines/*.yaml`.
4. `/pipeline list` → doit lister les pipelines.
5. `/pipeline run demo "fais X"` → observer les logs : `status` events, `plan-ready` puis
   pause ; vérifier qu'un sous-process agent est bien spawné.
6. `/pipeline approve` → doit déclencher l'étape suivante (ex. implémenteur) puis `completed`.
7. Chemins négatifs : `/pipeline reject`, `/pipeline cancel` (via abort).

Points infra à vérifier : le résultat attendu dépend de la présence des binaires
`npx @zed-industries/codex-acp@latest` et `pi-acp` dans le `PATH`, et de variables d'auth
specifiques à l'agent.

## 9. Lancement possible depuis mo-même ici

Je peux (étape suivante si tu veux) :

- exécuter `npm run build` + `npm test` dans `packages/acp-pi-extension` pour valider la
  compilation et la suite de tests (y compris `runnerController.test.ts` qui mocke le runner
  ACP) ;
- lancer `lsp_diagnostics` / `lens_diagnostics mode=all` sur le package pour relever d'éventuels
  soucis TS ;
- vérifier que `dist/` est à jour par rapport aux sources modifiés.

Dis-moi laquelle tu veux que je lance.
