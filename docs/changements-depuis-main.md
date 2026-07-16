# Changements depuis `main` — `feature/package-plugin-vscode`

## Métadonnées

| Champ | Valeur |
|-------|--------|
| **Branche** | `feature/package-plugin-vscode` |
| **Base** | `main` (`6e3fde8`) |
| **Merge-base** | `e737165` |
| **HEAD** | `8b3f4d6` |
| **Date de génération** | 2026-07-16 |
| **Commits** | 78 |
| **Fichiers** | 563 modifiés |
| **Lignes** | **+68 977 / −15 287** |

**Commande de regénération des stats :**

```bash
git rev-parse main HEAD
git merge-base main HEAD
git log main..HEAD --oneline | wc -l
git diff --shortstat main...HEAD
```

---

## Résumé exécutif

Cette branche transforme l’extension monolithique `vscode-acp` en **monorepo npm workspaces** (`acp-pipeline`, `plugin-vscode`, `plugin-pi`).

Les changements majeurs sont :

1. **Architecture** — extraction de la logique d’orchestration dans `@acp-client/pipeline`, indépendante de VS Code.
2. **UI** — refonte complète du chat en webview React avec reducers (`chat`, `composer`, `pipeline`, `session`), mentions de fichiers, rendu Markdown et blocs de plan.
3. **Sessions** — historique par workspace, transfert de contexte, familles de contexte, traces debug et snapshots.
4. **Pipelines v2** — format canonique unique (suppression du DSL `.acp/teams/*.yaml`), approbation humaine, annulation `AbortSignal`, révision de plan et résolution partagée des `promptFile`.
5. **Sandcastle** — pont ACP vers Docker, runtimes éphémères, promotion `Apply`/`Reject` avec modes `ask`/`autoApply`/`autoReject`.
6. **Plugin Pi** — extension autonome `@acp-client/pi-extension` avec commandes `/pipeline`, transport Sandcastle éphémère et consommation du moteur pipeline partagé.
7. **Skills workspace** — catalogue `.agents/skills/` de 66+ skills (Matt Pocock et co.) branché dans le chat et les pipelines.
8. **Bootstrap** — provisionnement non destructif des modèles `.acp/`, `.agents/` et `.sandcastle/` à l’activation.
9. **Agent Teams** — introduit puis **retiré au HEAD** (remplacé par pipelines v2 unifiés).

---

## Vue d’architecture

### Avant (`main`)

```text
racine
├── src/                    # Extension VS Code monolithique
│   ├── core/
│   ├── ui/
│   ├── handlers/
│   └── utils/
├── resources/
├── .vscode/
├── tsconfig.json
└── package.json            # Package unique
```

### Après (`HEAD`)

```text
racine (orchestrateur npm, pas de code applicatif)
├── acp-pipeline/           # @acp-client/pipeline — moteur d'orchestration
├── plugin-vscode/          # acp-client — extension VS Code + webview React
│   ├── src/
│   └── webview/src/
├── plugin-pi/              # @acp-client/pi-extension — plugin Pi
│   ├── src/
│   └── .pi/.acp/
├── .acp/                   # Pipelines + agents (starter)
├── .agents/skills/         # Skills workspace (66+)
├── .sandcastle/            # Scaffold Docker
└── docs/                   # Documentation delta (ce fichier)
```

---

## Changements par package

### Racine / workspaces

- **`package.json`** — déclare les trois workspaces (`acp-pipeline`, `plugin-vscode`, `plugin-pi`) et les scripts transverses (`compile`, `test`, `test:pi`, `vsx`, `lint`).
- **Suppressions** — `CHANGELOG.md` racine, `.vscode/launch.json`, `.vscode/tasks.json`, `.vscodeignore`, `webpack.config.js`, `tsconfig.json` racine (déplacés ou remplacés).
- **Nouveaux dossiers** — `.acp/` (pipelines, agents), `.agents/skills/` (catalogue skills), `.sandcastle/` (Docker, `.env.example`), `acp.code-workspace`, `skills-lock.json`.
- **`.gitignore` / `.vscode/settings.json`** — ajustés pour le layout monorepo.

### `acp-pipeline` (`@acp-client/pipeline`)

Bibliothèque TypeScript indépendante de VS Code qui porte l’orchestration pipeline v2.

- **API publique** — `PipelineDefinition`, `PipelinePrimitiveDefinition`, événements, validation, compilation graphe, exécution, approbation humaine, annulation via `AbortSignal`, branches parallèles.
- **Résolution `promptFile`** — `PipelinePromptFileResolver` centralisé : chemins relatifs au YAML, composition `promptFile` + `prompt` inline, validation de taille (`acp.instructions.maxBytes`).
- **Révision de plan** — support pour modifier un plan proposé avant approbation.
- **Retrait final** — suppression des modules Agent Teams (`AgentTeamCompiler`, `TeamReviewerRerun`, etc.) au profit du seul catalogue pipeline v2.

### `plugin-vscode` (`acp-client`)

Extension VS Code principale. Migration massive depuis `src/` racine vers `plugin-vscode/src/`.

- **Webview React** — nouveau dossier `webview/src/` avec :
  - Composants : `MessageBubble`, `ChatComposer`, `Picker`, `PlanBlock`, `PipelinePlanBlock`, `TurnBlock`, `TurnTools`, `MarkdownDisplay`, `MarkdownEditor`, `SessionBanner`, `ThoughtBlock`, `CurrentTurnBlock`, `HistoryTurnBlock`, `EmptyState`, `Codicon`.
  - State management : reducers `chatReducer`, `composerReducer`, `pipelineReducer`, `sessionReducer`, `OrchestrationRuntime`.
  - Hooks : `useFileMentions`, `useSessionDisplay`.
  - Styles : `styles.css` (~1 481 lignes).
- **Refactor profond** — `ChatWebviewProvider` délègue à `ChatWebviewController`. `SessionManager`, `ConnectionManager`, `AgentManager` migrés et enrichis.
- **Features livrées** :
  - Pipelines catalogue (agents virtuels depuis `.acp/pipelines/*.yaml`).
  - Sandcastle : bridge ACP, run éphémère, promotion Apply/Reject.
  - Skills : injection catalogue `<available_skills>` au 1er message, invocation `/skill`.
  - Inline edit / `editorInsets` (ADR-0009) — expérimental.
  - Workspace bootstrap (`acp.workspaceBootstrap.enabled`).
  - Terminal ACP optionnel (`acp.terminal.visible`).
- **Tests** — ~40+ fichiers de test ajoutés (`SessionTreeProvider`, `PermissionHandler`, `extension.test`, etc.).

### `plugin-pi` (`@acp-client/pi-extension`)

Extension autonome pour l’hôte Pi.

- **Configuration embarquée** — `.pi/.acp/acp-agents.json`, `.pi/.acp/pipelines/*.yaml`, `.pi/.acp/.sandcastle/config.json`.
- **Commandes `/pipeline`** — `list`, `run`, `approve`, `reject`, `cancel`.
- **Outil `run_pipeline`** — enregistré pour invocation par le modèle Pi.
- **Runtime ACP** — `EphemeralAcpRunner` (connect → authenticate → prompt → collecte texte, abort/cancel), proxy fichiers/terminal/permissions, handler auth.
- **Sandcastle éphémère** — transport `sandcastle` pour providers `codex`, `cursor`, `pi`, `vibe` avec mounts workspace.
- **Docs** — `docs/architecture.md`, `plan-execute-verify-archi.md`, `plan-execute-verify-pi.md`, `session-analysis.md`, `ROADMAP.md`.

---

## Changements transverses (par thème)

### 1. Monorepo & build

- Passage de l’extension monolithique à trois workspaces npm.
- `plugin-vscode` consomme `@acp-client/pipeline` via dépendance locale `file:../acp-pipeline`.
- Build VSIX : `vsce package --no-dependencies` depuis `plugin-vscode`, avec `vscode:prepublish` qui build le pipeline puis webpack.
- Scripts racine comme raccourcis (`compile`, `test`, `test:pi`, `vsx`), scripts spécifiques avec `-w <workspace>`.

### 2. Chat & webview React

- Remplacement de la webview legacy par une stack React + TypeScript.
- Système de mentions de fichiers (`@`) avec sélection Picker.
- Rendu Markdown via `react-markdown` avec édition en place (`MarkdownEditor`).
- Blocs fonctionnels : bulles de message, blocs de réflexion, blocs d’outils, blocs de plan pipeline.

### 3. Sessions & historique

- Historique de sessions **scoped par workspace** (pas global).
- **Context handoff** — transfert explicite de la discussion vers un autre agent ou une autre session.
- **Familles de contexte** — arborescence des sessions liées dans l’UI.
- **Debug snapshots** — panneau de traces en mémoire (voir, copier, exporter).

### 4. Pipelines v2 & orchestration

- **Format canonique unique** — suppression du parallèle `.acp/teams/*.yaml`. Seul `.acp/pipelines/*.yaml` est chargé.
- **Plan Execute Verify** — workflow par défaut avec `promptFile` pointant vers `.acp/agents/*.md`.
- **Approbation humaine** — gate obligatoire entre plan et implémentation.
- **Annulation** — propagation d’`AbortSignal` à travers `PipelineService` → `EphemeralAcpRunner` → connexion ACP.
- **Branches parallèles** — support `sideEffects: none` pour analyses concurrentes.

### 5. Sandcastle & promotion Apply/Reject

- **Bridge ACP** — adaptation du protocole ACP (stdio JSON-RPC) vers les runs Docker CLI (`codex`, `cursor`).
- **Worktree git isolé** — modifications sandboxées dans `sandcastle/acp/<provider>/<uuid>`.
- **Transcript borné** — historique texte limité (8 tours, 64 KiB) injecté dans chaque run frais.
- **Modes de promotion** — `ask` (manuel), `autoApply`, `autoReject` via `acp.sandcastle.promotion`.
- **Épuration legacy** — suppression du sandbox promotion v1 au profit du workflow Sandcastle v2.

### 6. Skills workspace (`.agents/skills`)

- Arrivée de ~66 skills (catalogue Matt Pocock et co.) : `code-review`, `codebase-design`, `diagnosing-bugs`, `domain-modeling`, `grilling`, `handoff`, `implement`, `prototype`, `research`, `resolving-merge-conflicts`, `tdd`, `teach`, etc.
- **Injection automatique** — catalogue `<available_skills>` injecté au premier message de session pour les agents configurés (`Cursor CLI`, `Codex Sandcastle`, `Cursor Sandcastle`).
- **Invocation explicite** — `/skill-name` développe le contenu du `SKILL.md` dans le prompt.
- **Symlink Cursor** — si `.cursor/skills` est absent, création d’un lien vers `.agents/skills` pour la découverte native Cursor CLI.

### 7. Workspace bootstrap / workspace-starter

- **Provisionnement non destructif** à l’activation de l’extension.
- Fournit `.acp/` (pipelines, agents), `.agents/skills/`, `.sandcastle/` si manquants.
- Paramètres : `acp.workspaceBootstrap.enabled`, `autoOnActivation`, `includePipelineArchive`.
- Commande manuelle : `ACP: Initialize Workspace Templates` (`acp.bootstrapWorkspace`).
- Synchronisation du starter via `npm run sync:workspace-starter` avant packaging.

### 8. Sécurité & permissions

- Queue des requêtes de permission pour éviter les conflits QuickPick concurrents.
- Timeout 30 s sur les appels au registre d’agents (`AbortController`).
- Validation de chemins `promptFile` (refus de traversal hors workspace).
- `acp.autoApprovePermissions` : `ask` ou `allowAll`.

### 9. Tests

- Tests unitaires natifs (`node:test`) dans `plugin-pi`.
- Tests VS Code (`@vscode/test-cli`) dans `plugin-vscode`.
- Couverture : `SessionTreeProvider`, `PermissionHandler`, `extension.test`, `configCatalog`, `runnerController`, `ephemeralRunner`, `PipelineExecutor`, `PipelineValidator`, `promptFileResolver`.

### 10. Suppressions & dépréciations

| Élément | Statut HEAD | Remarque |
|---------|-------------|----------|
| `src/` racine | **Supprimé** | Contenu migré vers `plugin-vscode/src/` |
| `CHANGELOG.md` racine | **Supprimé** | Remplacé par la documentation de branche (ce doc) |
| Agent Teams (`.acp/teams/`, ADR-0012, `AgentTeamCatalog`) | **Retiré** | Pipelines v2 remplacent les équipes déclaratives |
| Sandbox promotion legacy | **Remplacé** | Par Sandcastle Apply/Reject |
| `.vscode/launch.json`, `tasks.json` | **Supprimés** | Config déplacée dans `plugin-vscode/.vscode/` |
| `webpack.config.js` racine | **Supprimé** | Webpack vit dans `plugin-vscode/` |
| `tsconfig.json` racine | **Supprimé** | Remplacé par configs par package |

---

## Impacts utilisateur / migration

| Ancien chemin / comportement | Nouveau chemin / comportement | Action requise |
|------------------------------|-------------------------------|----------------|
| `src/` (racine) | `plugin-vscode/src/` | Aucune (interne) |
| `package.json` unique | Workspaces `acp-pipeline`, `plugin-vscode`, `plugin-pi` | Utiliser `npm run <script> -w <workspace>` pour les commandes spécifiques |
| `.vscode/launch.json` racine | `plugin-vscode/.vscode/launch.json` | Lancer le debug depuis `plugin-vscode/` ou utiliser `acp.code-workspace` |
| `.acp/teams/*.yaml` | `.acp/pipelines/*.yaml` | Migrer les définitions team vers des pipelines v2 équivalents |
| Commandes teams (`showCompiledTeamPipeline`, `rerunTeamReviewer`) | Supprimées | Utiliser les commandes pipeline standards |
| `acp.sandcastle.promotion` legacy | Nouveau workflow Apply/Reject + modes | Reconfigurer selon `plugin-vscode/README.fr.md` |

---

## Documentation existante à référencer

| Document | Sujet |
|----------|-------|
| [`README.md`](../README.md) | Vue d’ensemble du monorepo |
| [`plugin-vscode/doc_fr/adr/0017-monorepo-npm-workspaces.md`](../plugin-vscode/doc_fr/adr/0017-monorepo-npm-workspaces.md) | Décision monorepo |
| [`plugin-vscode/doc_fr/adr/0018-pipeline-v2-catalogue-canonique.md`](../plugin-vscode/doc_fr/adr/0018-pipeline-v2-catalogue-canonique.md) | Pipelines v2 comme format unique |
| [`plugin-vscode/doc_fr/adr/0019-promptfile-pipeline-partage.md`](../plugin-vscode/doc_fr/adr/0019-promptfile-pipeline-partage.md) | Résolution partagée `promptFile` |
| [`plugin-vscode/doc_fr/changements-sandcastle-promotion-en-cours.md`](../plugin-vscode/doc_fr/changements-sandcastle-promotion-en-cours.md) | Promotion Apply/Reject (évolution) |
| [`plugin-vscode/README.fr.md`](../plugin-vscode/README.fr.md) | Documentation utilisateur VS Code (fr) |
| [`plugin-pi/docs/architecture.md`](../plugin-pi/docs/architecture.md) | Architecture du plugin Pi |
| [`plugin-pi/ROADMAP.md`](../plugin-pi/ROADMAP.md) | Roadmap plugin Pi |
| [`acp-pipeline/README.md`](../acp-pipeline/README.md) | API et responsabilités du pipeline partagé |

---

## Annexe A — Commits (condensés par lot thématique)

| Lot | Thème | Commits clés |
|-----|-------|--------------|
| **L1** | **UI chat React & contexte éditeur** | `986ac07`, `0bcee17`, `0a490b4`, `d9f4f56`, `87117a7`, `cbd0c39`, `9d17074`, `32ae96a`, `ac95847` |
| **L2** | **Tests, TypeScript, sécurité & stabilité** | `c1be5d6`, `b0272cd`, `d4a8bd1`, `b79eb36`, `225189f`, `95293c6`, `12d1bbf` |
| **L3** | **Sessions, historique, context handoff & debug** | `1080622`, `b11214d`, `c974af4`, `2795e38`, `fbbcec7`, `3da3ba8`, `4bb62aa`, `d09a29f`, `3099086`, `cea8d11` |
| **L4** | **Pipeline plan management & inline chat** | `3e56b63`, `266bb0a`, `3e57939`, `be70297`, `3db3aa9`, `3b89bf5` |
| **L5** | **Sandcastle : bridge, runtimes, promotion Apply/Reject** | `ab63ebf`, `62b9209`, `bd64266`, `2e2ee98`, `b409651`, `9d5ed26`, `40045aa`, `7d9bbd3` |
| **L6** | **Agent Teams (intro puis retrait final)** | `7f121f0` (introduction), `8b3f4d6` (suppression finale) |
| **L7** | **Monorepo & extraction `@acp-client/pipeline`** | `07a10f2`, `d8e7e14`, `f020d1e`, `89439f4`, `b3ec774`, `e3ed499` |
| **L8** | **Refactor orchestration & state management** | `450f6e6`, `c567446`, `d14d296`, `cf40a07`, `4d14031`, `77c5570`, `c783790` |
| **L9** | **Plugin Pi autonome** | `9d6eb09`, `a2efd9a`, `3f51c2d`, `0f1cc83`, `fe018c7`, `5cb8951`, `79891d0`, `5edca17`, `87c1c4a`, `8b27937`, `88aadba`, `8d0ad76`, `a5a182a`, `1ca773a`, `9f359a7`, `bc0bff6`, `fe285eb`, `32a37fd` |
| **L10** | **Skills workspace & documentation** | `e498165`, `3fa3c43`, `b91a84b`, `eb7e376` |
| **L11** | **Corrections diverses** | `001c3a8` (fix agent Vibe test-gap-radar) |

*Note : 78 commits au total. Certains commits de documentation mineure ou de merge sont groupés dans les lots thématiques correspondants.*

---

## Annexe B — Fichiers supprimés / déplacés (structure)

### Suppressions à la racine

```text
.vscode/extensions.json
.vscode/launch.json
.vscode/tasks.json
.vscodeignore
CHANGELOG.md
resources/icon-ext.svg
src/config/AgentConfig.ts
src/core/SessionHistoryStore.ts
src/core/SessionManager.ts
src/handlers/PermissionHandler.ts
src/test/extension.test.ts
src/ui/ChatWebviewProvider.ts
src/utils/StreamAdapter.ts
webpack.config.js
```

### Renommages majeurs (`src/` → `plugin-vscode/src/`)

```text
src/extension.ts                          → plugin-vscode/src/commands/RegisterCommands.ts
src/config/RegistryClient.ts              → plugin-vscode/src/config/RegistryClient.ts
src/core/AcpClientImpl.ts               → plugin-vscode/src/core/AcpClientImpl.ts
src/core/AgentManager.ts                → plugin-vscode/src/core/AgentManager.ts
src/core/ConnectionManager.ts           → plugin-vscode/src/core/ConnectionManager.ts
src/handlers/FileSystemHandler.ts       → plugin-vscode/src/handlers/FileSystemHandler.ts
src/handlers/SessionUpdateHandler.ts    → plugin-vscode/src/handlers/SessionUpdateHandler.ts
src/handlers/TerminalHandler.ts         → plugin-vscode/src/handlers/TerminalHandler.ts
src/ui/SessionTreeProvider.ts           → plugin-vscode/src/ui/SessionTreeProvider.ts
src/ui/StatusBarManager.ts              → plugin-vscode/src/ui/StatusBarManager.ts
src/utils/Logger.ts                     → plugin-vscode/src/utils/Logger.ts
src/utils/TelemetryManager.ts           → plugin-vscode/src/utils/TelemetryManager.ts
tsconfig.json                           → acp-pipeline/tsconfig.json
.vscode-test.mjs                        → plugin-vscode/.vscode-test.mjs
LICENSE                                 → plugin-vscode/LICENSE
eslint.config.mjs                       → plugin-vscode/eslint.config.mjs
resources/icon.png                      → plugin-vscode/resources/icon.png
resources/icon.svg                      → plugin-vscode/resources/icon.svg
resources/screenshot.png                → plugin-vscode/resources/screenshot.png
```

---

## Annexe C — Commandes de regénération complète

```bash
# 1. Identifiants
git rev-parse main HEAD
git merge-base main HEAD

# 2. Stats
git diff --shortstat main...HEAD
git log main..HEAD --oneline | wc -l

# 3. Commits détaillés
git log main..HEAD --format='%h|%s|%an|%ad' --date=short

# 4. Fichiers
git diff --name-status main...HEAD
git diff --name-only main...HEAD | sed 's|/.*||' | sort | uniq -c | sort -rn

# 5. Renommages uniquement
git diff --name-status main...HEAD | awk '$1 ~ /^R/ {print}'
```

---

*Document généré le 2026-07-16. Pour toute question sur un changement spécifique, privilégier les ADR et README référencés ci-dessus plutôt que la relecture brute des 563 fichiers.*
