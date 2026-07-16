# Plan : Corrections d'architecture plugin-pi (post-review)

## Contexte

Issu de la review d'architecture de `plugin-pi`. L'architecture est globalement saine : le module profond est `@acp-client/pipeline`, `plugin-pi` joue l'adapter Pi/ACP. Les meilleurs seams sont `PipelineController` et `EphemeralAcpRunner`. Ce plan adresse les 5 points à corriger, sans refactor global.

## Scope

- Corriger le risque de sécurité sur le seam process/terminal.
- Clarifier la fuite de surface Sandcastle du package pipeline partagé côté Pi.
- Faire déléguer `index.ts` vers les modules runtime existants.
- Réduire la surface publique exportée par le plugin.
- Clarifier le bootstrap des pipelines (doc/config/templates).

## Out of scope

- Refactor de `plugin-vscode`.
- Réécriture de `@acp-client/pipeline` (uniquement séparation d'interface/facade).
- Changement de comportement natif des pipelines existants.

## Étapes

### 1. Sécuriser le seam process/terminal (priorité haute)

**Problème** : `TerminalHandler` ([src/acp/terminalHandler.ts:50](src/acp/terminalHandler.ts)) exécute `spawn(params.command, params.args, { shell: true })`. Les paramètres proviennent d'un agent ACP externe ; l'interface "command + args" ne garantit pas une exécution sans interprétation shell. Node émet un avertissement de sécurité pendant les tests.

**Changements** :

- Passer `shell: false` pour le chemin "command + args", OU introduire une interface explicite "shell command string" séparée avec validation/permission renforcée.
- Valider que `command` est un chemin exécutable absolu/résolu (pas une chaîne shell) côté `spawn`.
- Ajouter un test couvrant le rejet d'une commande contenant des métacaractères shell (`;`, `&&`, `$()`, backticks) quand `shell: false`.
- Documenter le contrat de l'interface : `command` = binaire, `args` = argv, jamais de shell interpolation.

**Fichiers** :

- `src/acp/terminalHandler.ts`
- Tests associés.

**Critères d'acceptation** :

- Plus d'avertissement Node sur `shell: true` avec entrée externe.
- Métacaractères shell rejetés sans exécution.
- `npm test` vert.

### 2. Isoler Sandcastle hors de l'interface Pi de `@acp-client/pipeline`

**Problème** : `plugin-pi` rejette Sandcastle dans sa config ([src/catalog/config.ts:97](src/catalog/config.ts)), mais `@acp-client/pipeline` expose encore `isAgentSandcastle`, `readWorkspaceDiff` et des méthodes Sandcastle dans [PipelineService](../acp-pipeline/src/PipelineService.ts). Élargit l'interface pour Pi sans leverage.

**Changements** :

- Définir une interface minimale `PipelineServiceDependencies` pour les pipelines purs (sans Sandcastle).
- Extraire une facade/extension séparée pour VS Code Sandcastle (consommée uniquement par `plugin-vscode`).
- `plugin-pi` dépend uniquement de l'interface minimale ; ne référence plus `isAgentSandcastle`/`readWorkspaceDiff`.
- Garder les statuts `implementerUsesSandcastle` côté `plugin-pi` via une propriété locale dérivée, pas via l'API partagée.

**Fichiers** :

- `acp-pipeline/src/PipelineService.ts` (split interface/facade)
- `plugin-pi` : imports/usage de `@acp-client/pipeline`.

**Critères d'acceptation** :

- `plugin-pi` n'importe aucune API Sandcastle depuis `@acp-client/pipeline`.
- `plugin-vscode` continue de fonctionner via la facade.
- `npm run build -w @acp-client/pipeline` vert ; `npm test` (plugin-pi) vert.

### 3. Faire déléguer `index.ts` vers les modules runtime

**Problème** : `index.ts` ([src/index.ts:31](src/index.ts)) réimplémente l'enregistrement de `/pipeline` et `run_pipeline` alors que [src/runtime/commands.ts:5](src/runtime/commands.ts) et [src/runtime/tool.ts:15](src/runtime/tool.ts) existent. Module peu exploité.

**Changements** :

- `index.ts` délègue à `commands.ts` et `tool.ts`.
- Adapter l'interface de ces modules pour accepter un `getController(cwd)` (résolution paresseuse du controller par workspace).
- Supprimer la duplication d'enregistrement.

**Fichiers** :

- `src/index.ts`
- `src/runtime/commands.ts`
- `src/runtime/tool.ts`

**Critères d'acceptation** :

- Aucune logique d'enregistrement dupliquée.
- Comportement commande `/pipeline` et tool `run_pipeline` inchangé (tests existants verts).

### 4. Réduire la surface publique exportée

**Problème** : [src/index.ts:78](src/index.ts) exporte beaucoup d'implémentation interne (runner, catalogues, controller, helpers). Si pas de consommateurs librairie, coût de maintenance élevé.

**Changements** :

- Limiter les exports publics au plugin par défaut + quelques types stables intentionnellement publics.
- Marquer le reste comme interne (non exporté depuis `index.ts`, ou via sous-chemins `/*.internal` si nécessaire).
- Auditer les imports externes avant de casser ; si un consommateur existe, exposer via un sous-chemin explicite plutôt que barrel.

**Fichiers** :

- `src/index.ts`
- Éventuels `package.json` `exports`.

**Critères d'acceptation** :

- Exports publics = plugin + types stables documentés.
- Pas de regression détectée par `npm test` / build.

### 5. Clarifier le bootstrap des pipelines (doc/config/templates)

**Problème** : le runtime lit `.pi/.acp/pipelines` ([src/catalog/pipelineCatalog.ts:15](src/catalog/pipelineCatalog.ts)), mais des exemples vivent sous `plugin-pi/.acp/pipelines`. Manque un seam clair de bootstrap/copie.

**Changements** :

- Ajouter un seam explicite de bootstrap/copie des pipelines templates (ou documenter que `plugin-pi/.acp/pipelines` = templates de référence, non lus au runtime).
- Corriger la roadmap/docs pour pointer uniquement vers le catalogue pipeline v2.
- Documenter le chemin runtime attendu `.pi/.acp/pipelines/*.yaml`.

**Fichiers** :

- `src/catalog/pipelineCatalog.ts` (seam/flag template vs runtime)
- `README.md`, docs roadmap/ADR.

**Critères d'acceptation** :

- Distinction template/runtime documentée et, si applicable, codée.
- Roadmap cohérente avec le catalogue canonique `.pi/.acp/pipelines/*.yaml`.

## Test Plan

- `npm test` (plugin-pi) : 69 tests attendus verts + nouveaux tests sécurité terminal.
- `npm run build -w @acp-client/pipeline` vert.
- `npm run build` (plugin-pi) vert après réduction des exports.
- Vérifier `plugin-vscode` compile toujours après le split d'interface/facade.

## Risques

- Casser `plugin-vscode` en retirant des APIs du package partagé → mitigrer par facade distincte.
- Réduire les exports peut casser un consommateur inconnu → audit imports avant.
- `shell: false` peut casser des commandes qui comptaient sur le shell → valider chaque appel existant.

## Vérification initiale (référence)

- `npm test` dans `plugin-pi` : 69 tests OK.
- `npm run build -w @acp-client/pipeline` : OK.
- Aucun fichier modifié par la review.
