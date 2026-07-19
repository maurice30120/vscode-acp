# 5. Plan d’implémentation détaillé

## Principe de livraison

Procéder par tranches verticales testables. Ne pas modifier simultanément le DSL, les deux hôtes et les policies sans tests rouges préalables.

## Phase 0 — verrouiller la régression de la PR #9

### Tests à écrire avant le refactor

Dans `plugin-pi/test/runnerController.test.ts` :

1. run initial jusqu’à `plan_approval` ;
2. première approbation ;
3. exécution `spec` + `tasks` ;
4. arrivée à `delivery_approval` ;
5. `activeSessionId` toujours actif via la surface publique de status ;
6. aucune notification `completed` ;
7. cancel possible ;
8. second scénario avec deuxième approbation puis completion.

Dans `acp-pipeline/test/` : test réel du graphe avec deux steps `approval`.

### Correctif de sécurité temporaire

Dans le YAML de la PR #9, passer les primitives non implémenteur à :

```yaml
permissions: ask
```

Cela réduit le risque mais ne remplace pas l’enforcement.

## Phase 1 — introduire outcomes et pauses génériques dans `acp-pipeline`

### `acp-pipeline/src/PipelineTypes.ts`

Ajouter :

- `PipelinePausePurpose` ;
- `PipelinePause` ;
- champs optionnels `purpose`, `contentType`, `editable` sur `PipelineApprovalStepDefinition` ;
- `PipelineRunOutcome` ;
- `PipelineRunSnapshot` ;
- inputs `PipelineStartInput`, `PipelineResumeInput`, `PipelineRejectInput`.

### `acp-pipeline/src/PipelineEvents.ts`

Ajouter `PipelinePauseEvent`.

Conserver temporairement :

```ts
type PipelinePlanReadyEvent = DeprecatedPlanReadyShape | PipelinePauseEvent;
```

Il est préférable que les nouveaux consommateurs utilisent uniquement `pause`.

### `acp-pipeline/src/PipelineRunRegistry.ts`

Remplacer :

```ts
pendingApproval
```

par :

```ts
pendingPause: PipelinePause | null
phase: PipelineRunPhase
currentStepId?: string
```

Générer un `pauseId` stable à chaque interrupt. Le `pauseId` doit changer après une révision ou une nouvelle pause.

### `acp-pipeline/src/PipelineGraphCompiler.ts`

Changer le payload de `interrupt()` :

```ts
{ pause: { stepId, purpose, content, contentType, editable } }
```

Le resume ne doit plus appeler le contenu `plan`.

### `acp-pipeline/src/engine/PipelinePlanRevision.ts`

Limiter la révision conversationnelle aux pauses `purpose: plan` et `editable: true`.

Une pause delivery non éditable ne doit pas entrer dans `revisePendingPlan()`.

### `acp-pipeline/src/engine/PipelineGraphCoordinator.ts`

- lire un interrupt générique ;
- construire `PipelinePause` avec `pauseId` ;
- valider `<proposed_plan>` uniquement pour `contentType: proposed_plan` ;
- retourner `PipelineRunOutcome` depuis `invokeInitial`, `resumeAfterApproval` ou `handleGraphResult`.

### `acp-pipeline/src/PipelineRunEngine.ts`

Introduire :

```ts
start(input): Promise<PipelineRunOutcome>
resume(input): Promise<PipelineRunOutcome>
getSnapshot(sessionId): PipelineRunSnapshot | undefined
```

Valider avant resume :

- session présente ;
- phase paused ;
- `pauseId` égal ;
- contenu révisé autorisé.

Le registre est supprimé seulement sur outcome terminal.

### `acp-pipeline/src/PipelineService.ts`

Approfondir la façade publique :

- exposer les nouvelles méthodes ;
- retransmettre `pause` ;
- garder les wrappers deprecated sans retour string.

### `acp-pipeline/src/PipelineValidator.ts`

Valider :

- `purpose` ;
- `contentType` ;
- `editable` ;
- cohérence `proposed_plan` / plan ;
- templates inchangés.

## Phase 2 — migrer l’adapter Pi

### `plugin-pi/src/runtime/pipelineController.ts`

- remplacer `pendingPlan` par `activePause` ;
- utiliser l’outcome de `start` et `resume` ;
- centraliser le nettoyage terminal dans `applyOutcome` ;
- ne plus afficher completion depuis un `finally` ;
- garder les événements uniquement pour l’affichage ;
- transmettre `pauseId` à `approve` et `reject` ;
- adapter `PipelineRunCommandResult` pour contenir `pause`.

### `plugin-pi/src/runtime/commands.ts`

- `/pipeline approve` approuve la pause active ;
- messages adaptés à `purpose` ;
- `/pipeline status` affiche `paused at <stepId>` ;
- `/pipeline cancel` reste actif pendant toutes les pauses.

### `plugin-pi/src/runtime/tool.ts`

Le résultat de `run_pipeline` doit indiquer explicitement :

```json
{ "state": "paused", "pauseId": "...", "stepId": "..." }
```

Le modèle ne doit pas interpréter un texte comme une fin.

## Phase 3 — migrer l’adapter VS Code

### `plugin-vscode/src/plugins/orchestration/OrchestrationRuntime.ts`

- utiliser `start` / `resume` ;
- transporter `pauseId` dans les messages webview ;
- ne pas supposer qu’un approve termine le pipeline ;
- conserver les événements pour `ConversationProjector`.

### Projection et webview

Adapter les types/messages :

- `pipeline-plan-ready` → `pipeline-pause-ready` ;
- bloc UI selon `purpose` et `contentType` ;
- bouton approve envoie `pauseId` + contenu ;
- bloc delivery non éditable par défaut.

Préserver un alias de message durant la migration si les tests de webview en dépendent.

## Phase 4 — rendre les capacités exécutoires

### Types partagés

Ajouter `PipelineStepCapabilities` et une fonction pure de mapping du DSL v2.

### Pi

Fichiers :

- `plugin-pi/src/acp/defaultConnector.ts` ;
- `plugin-pi/src/acp/connectionManager.ts` ;
- `plugin-pi/src/acp/piAcpClient.ts` ;
- `plugin-pi/src/acp/fileSystemHandler.ts` ;
- `plugin-pi/src/acp/terminalHandler.ts` ;
- `plugin-pi/src/acp/ephemeralRunner.ts`.

Actions :

1. transmettre la politique complète au connector ;
2. annoncer des capabilities ACP minimales ;
3. refuser côté handler toute opération non autorisée ;
4. empêcher `allowAll` de contourner la politique ;
5. garder Sandcastle rejeté/promotable selon isolation.

### VS Code

Fichiers probables :

- `plugin-vscode/src/core/EphemeralAgentRunner.ts` ;
- `plugin-vscode/src/core/EphemeralRun.ts` ;
- `plugin-vscode/src/core/AgentConnectionFactory.ts` ;
- handlers/connection client concernés.

Actions identiques : la policy doit atteindre le seam de construction du client ACP.

### Validation du pipeline

Refuser une combinaison que l’adapter sélectionné ne peut pas garantir. Exemple : reviewer natif demandant terminal activé avec garantie read-only stricte.

## Phase 5 — corriger et aligner les skills

### Pi

`plugin-pi/src/catalog/skillCatalog.ts` :

- remplacer l’allow-list implicite par `SkillSelection` ;
- inclure `disableModelInvocation` en mode explicit ;
- erreur si une skill explicite manque ;
- tests d’ordre et de doublons.

### VS Code

- ajouter `skills?: string[]` à `EphemeralRunInput` ;
- transmettre la sélection depuis `DefaultEphemeralAgentRunner` ;
- étendre `SkillsPromptBuilder` avec `selection` ;
- en mode explicit, résoudre exactement les skills demandées, y compris user-invoked ;
- ne pas injecter le catalogue complet pour une primitive explicitement configurée.

### Extraction future

Après parité et tests de contrat, décider si le resolver devient :

- un module partagé dans un nouveau workspace ;
- ou une implémentation commune Node consommée par les deux hôtes.

Ne pas créer le package avant stabilisation de l’interface.

## Phase 6 — migrer le pipeline de la PR #9

Dans `plugin-pi/.acp/pipelines/grill-spec-tickets-implement-review.yaml` :

- déclarer la seconde pause en markdown delivery ;
- retirer `<proposed_plan>` ;
- configurer les policies réellement supportées ;
- garder l’implémenteur Sandcastle promotable ;
- placer planner/spec/tasks/reviewer en sandbox jetable s’ils ont besoin du terminal.

Mettre à jour le fichier `.md` miroir et le test catalogue.

## Phase 7 — nettoyage

- supprimer les aliases deprecated après migration des deux hôtes ;
- mettre à jour `README.md`, `ROADMAP.md`, `plugin-pi/README.md` et `CONTEXT.md` ;
- corriger la liste des quatre workspaces dans la documentation racine ;
- enregistrer les ADRs acceptés dans l’emplacement canonique ;
- vérifier que `PipelineService` gagne réellement les invariants prévus, sinon le supprimer.

## Ordre des PRs conseillé

1. Tests rouges multi-pause + correctif minimal Pi.
2. Outcomes + pause générique dans le package partagé.
3. Migration Pi et pipeline #9.
4. Migration VS Code.
5. Enforcement des capacités.
6. Parité skills.
7. Nettoyage des compatibilités.

Chaque PR doit compiler et tester les quatre workspaces concernés par ses contrats.
