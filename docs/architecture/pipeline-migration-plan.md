# Plan de migration — approfondissement du moteur pipeline ACP

## 1. But

Faire évoluer l’architecture sans réécrire le moteur ni casser les pipelines v2 existants.

Le résultat attendu est un Module pipeline plus profond :

- il retourne un état de run non ambigu ;
- il supporte plusieurs pauses humaines sans logique spéciale dans les hôtes ;
- il rend les politiques d’effets de bord exécutoires ;
- il résout correctement les skills explicitement demandés ;
- il garde LangGraph, les checkpointers et les détails de transport derrière des Seams internes.

## 2. Non-objectifs

Cette migration ne cherche pas à :

- remplacer LangGraph ;
- introduire immédiatement une persistance des runs après redémarrage ;
- changer le format YAML v2 en une v3 complète ;
- refondre toute l’UI VS Code ou Pi ;
- généraliser `VirtualSessionRuntime` avant l’existence d’un second runtime virtuel ;
- ajouter des ports hypothétiques sans second Adapter réel.

## 3. Stratégie générale

La migration suit une règle de compatibilité : **ajouter la nouvelle Interface, migrer les appelants, puis supprimer l’ancienne**.

```mermaid
flowchart LR
  A[Caractériser l’existant] --> B[Résultat typé]
  B --> C[Pause générique]
  C --> D[Politique exécutoire]
  D --> E[SkillResolver]
  E --> F[Migrer Pi et VS Code]
  F --> G[Supprimer compatibilité]
```

Chaque phase doit être livrable séparément et conserver les tests verts.

## 4. Phase 0 — garde-fous immédiats

### Objectif

Réduire le risque fonctionnel avant la refonte de l’Interface.

### Changements

1. Remplacer `permissions: allowAll` par `permissions: ask` pour les primitives read-only du pipeline `grill-spec-tickets-implement-review`.
2. Ajouter un test de caractérisation du pipeline à deux approvals.
3. Ajouter un test qui reproduit le faux `ACP Pipeline Completed` après la première reprise.
4. Ajouter un test du prompt réellement transmis pour les skills explicitement sélectionnés.

### Fichiers probables

- `plugin-pi/.acp/pipelines/grill-spec-tickets-implement-review.yaml`
- `plugin-pi/test/runnerController.test.ts`
- `plugin-pi/test/pipelineCatalogMattSkills.test.ts`
- nouveau test d’intégration sous `acp-pipeline/test/` si le scénario peut être isolé du contrôleur Pi.

### Critères d’acceptation

- les étapes planner/spec/tasks/review ne sont plus auto-approuvées ;
- un test rouge démontre le défaut multi-approval avant correction ;
- le test de prompt démontre l’absence actuelle des skills user-invoked.

## 5. Phase 1 — introduire un résultat de run typé

### Objectif

Faire du résultat retourné la source de vérité du cycle de vie.

### Nouvelle Interface

```ts
export type PipelineRunResult =
  | { kind: 'paused'; sessionId: string; pause: PipelinePause; snapshot: PipelineRunSnapshot }
  | { kind: 'completed'; sessionId: string; output: string; snapshot: PipelineRunSnapshot }
  | { kind: 'rejected'; sessionId: string; reason?: string; snapshot: PipelineRunSnapshot }
  | { kind: 'cancelled'; sessionId: string; snapshot?: PipelineRunSnapshot }
  | { kind: 'failed'; sessionId: string; error: PipelineRunError; snapshot?: PipelineRunSnapshot };
```

### Étapes

1. Ajouter les types dans `acp-pipeline`.
2. Faire retourner `PipelineRunResult` par de nouvelles méthodes :
   - `start()` ;
   - `resume()` ;
   - `cancelRun()` ;
   - `inspect()`.
3. Conserver temporairement `createPlan()`, `approvePlan()`, `rejectPlan()` et `cancel()` comme wrappers de compatibilité.
4. Faire produire le résultat par `PipelineGraphCoordinator.handleGraphResult()` au lieu d’une chaîne seule.
5. Garder les événements `status`, `plan-ready` et `session-update` pendant la transition.

### Fichiers probables

- `acp-pipeline/src/PipelineTypes.ts`
- nouveau `acp-pipeline/src/PipelineRunResult.ts`
- `acp-pipeline/src/PipelineService.ts`
- `acp-pipeline/src/PipelineRunEngine.ts`
- `acp-pipeline/src/engine/PipelineGraphCoordinator.ts`
- `acp-pipeline/src/index.ts`

### Tests

- `start()` retourne `paused` pour une première approval ;
- `resume()` retourne `paused` pour une seconde approval ;
- le run reste inspectable entre les pauses ;
- la seconde reprise retourne `completed` ;
- `cancelRun()` retourne `cancelled` et supprime le run ;
- les wrappers historiques conservent leur comportement pendant la compatibilité.

### Critère de sortie

Aucun appelant nouveau ne doit avoir besoin d’observer `plan-ready` pour déterminer si le run est terminé.

## 6. Phase 2 — généraliser les pauses

### Objectif

Retirer le contrat artificiel selon lequel toute pause contient un `<proposed_plan>`.

### Types

```ts
export interface PipelinePause {
  id: string;
  kind: 'approval' | 'question' | 'promotion';
  title?: string;
  content: string;
  contentType: 'markdown' | 'proposed_plan' | 'text';
  metadata?: Record<string, string | number | boolean>;
}

export type ResumeDecision =
  | { kind: 'approve'; content?: string }
  | { kind: 'answer'; content: string }
  | { kind: 'reject'; reason?: string };
```

### DSL compatible

Ajouter des champs optionnels sur les steps `approval` :

```yaml
- id: delivery_approval
  type: approval
  title: Approve specification and task plan
  contentType: markdown
  input: |
    ## Specification
    {{steps.spec.output}}

    ## Task plan
    {{steps.tasks.output}}
```

Valeurs par défaut de compatibilité :

- `contentType: proposed_plan` pour un step historique qui alimente le planner interactif ;
- `kind: approval` pour les steps existants.

### Étapes

1. Renommer les types internes `PendingApprovalState` vers `PendingPauseState`.
2. Traduire les interrupts LangGraph en `PipelinePause` dans le coordinateur.
3. N’appeler `assertSingleProposedPlan()` que pour `contentType: proposed_plan`.
4. Remplacer `approvePlan()` par `resume()` dans les appelants migrés.
5. Retirer le wrapper XML de `delivery_approval`.
6. Conserver le protocole interactif `question`/`ready` comme un Adapter de contenu proposé-plan, pas comme le modèle universel de pause.

### Tests

- approval Markdown contenant littéralement `<proposed_plan>` sans corruption ;
- approval `proposed_plan` toujours validée ;
- réponse à une pause `question` ;
- rejet d’une pause ;
- reprise avec un `pause.id` obsolète refusée par `invalid_resume`.

### Critère de sortie

Le pipeline de la PR #9 ne contient plus d’emballage XML pour la spécification et les tâches.

## 7. Phase 3 — rendre la politique d’exécution exécutoire

### Objectif

Transformer les déclarations YAML en garanties identiques sur les deux Adapters de transport.

### Nouveau Module

```ts
export interface ExecutionPolicyResolver {
  resolve(input: {
    primitive: PipelinePrimitiveDefinition;
    transport: PipelineTransportCapabilities;
    approvals: PipelineApprovalContext;
  }): ExecutionPolicy;
}
```

### Étapes

1. Définir `ExecutionPolicy` et `PipelineTransportCapabilities` dans `acp-pipeline`.
2. Faire résoudre la politique par `PipelineExecutor` avant d’appeler le runner.
3. Étendre `PipelineAgentRunInput` avec une seule politique normalisée plutôt que des champs indépendants ambigus.
4. Adapter ACP natif :
   - bloquer `writeTextFile` en read-only ;
   - appliquer la règle terminal ;
   - retourner un refus stable et journalisé.
5. Adapter Sandcastle :
   - conserver l’écriture dans le worktree isolé ;
   - rejeter automatiquement le worktree en read-only ;
   - appliquer la politique de promotion pour workspace-write.
6. Valider au démarrage qu’un transport sait garantir la politique demandée.

### Fichiers probables

- `acp-pipeline/src/PipelineExecutor.ts`
- `acp-pipeline/src/PipelineTypes.ts`
- nouveau `acp-pipeline/src/ExecutionPolicy.ts`
- `plugin-pi/src/acp/ephemeralRunner.ts`
- `plugin-pi/src/acp/fileSystemHandler.ts`
- `plugin-pi/src/acp/terminalHandler.ts`
- `plugin-pi/src/acp/permissionHandler.ts`
- Adapters correspondants dans `plugin-vscode`.

### Tests contractuels

La même suite est exécutée contre les deux Adapters :

| Cas | Native ACP | Sandcastle |
| --- | --- | --- |
| read-only + lecture | autorisé | autorisé |
| read-only + écriture fichier | refusé | diff rejeté |
| read-only + commande mutante | refusé ou demandé selon politique | diff rejeté |
| workspace-write sans approval | refusé | refusé |
| workspace-write approuvé | autorisé | promotion appliquée selon politique |

### Critère de sortie

Un prompt malveillant ou erroné ne peut plus contourner `sideEffects: none` sur l’Adapter natif.

## 8. Phase 4 — introduire `SkillResolver`

### Objectif

Séparer invocation explicite et découverte automatique.

### Étapes

1. Ajouter une Interface commune :

```ts
interface SkillResolver {
  resolveExplicit(input: { workspaceCwd: string; names: string[] }): ResolvedSkillSet;
  discoverModelInvocable(input: { workspaceCwd: string }): ResolvedSkillSet;
}
```

2. Déplacer la lecture du catalogue et la composition du bloc prompt derrière ce Module.
3. Inclure les skills `disable-model-invocation: true` dans `resolveExplicit()`.
4. Continuer à les exclure de `discoverModelInvocable()`.
5. Échouer clairement lorsqu’un skill demandé est absent ou invalide.
6. Utiliser la même Implementation depuis Pi et VS Code si les deux hôtes injectent les skills.
7. Réduire progressivement les duplications dans les prompt adapters Matt Pocock lorsque le skill réel est garanti.

### Tests

- `to-spec`, `to-tickets` et `implement` sont présents quand explicitement demandés ;
- ils restent absents de la découverte automatique ;
- un skill inconnu produit une erreur ;
- la désactivation globale des skills sur un agent reste respectée ;
- ordre déterministe et chemins normalisés sur Windows/Linux.

### Critère de sortie

Le pipeline de la PR #9 utilise réellement les skills qu’il déclare.

## 9. Phase 5 — migrer les Adapters hôtes

### Pi

1. Remplacer `service.createPlan()` par `runtime.start()`.
2. Remplacer `service.approvePlan()` par `runtime.resume()`.
3. Supprimer la déduction `pendingPlan?.sessionId === sessionId` comme source de vérité.
4. Piloter heartbeat, session active et messages UI uniquement depuis `PipelineRunResult`.
5. Renommer les messages `ACP Pipeline Plan` en un affichage générique de pause lorsque nécessaire.

### VS Code

1. Migrer l’Implementation orchestration qui satisfait `VirtualSessionRuntime`.
2. Traduire `PipelineRunResult` vers les projections chat existantes.
3. Conserver `SessionManager` agnostique du pipeline.
4. Vérifier que les deux pauses apparaissent et se reprennent dans une même session virtuelle.

### Tests de parité

Un scénario partagé doit produire la même séquence logique dans les deux hôtes :

```text
start
→ paused(plan_approval)
→ resume approve
→ paused(delivery_approval)
→ resume approve
→ completed
```

Les détails de présentation peuvent différer, pas les résultats métier.

## 10. Phase 6 — retirer l’ancienne Interface

### Conditions préalables

- Pi et VS Code utilisent la nouvelle Interface ;
- aucun test n’appelle les anciennes méthodes sauf les tests de compatibilité ;
- les pipelines embarqués n’utilisent plus le wrapper XML non nécessaire ;
- les docs et exemples utilisent `pause` et `resume`.

### Suppressions

- `createPlan()` ;
- `approvePlan()` ;
- `rejectPlan()` ;
- événements spécialisés `plan-ready` si plus aucun affichage streaming n’en dépend ;
- noms `PendingApprovalState.plan` ;
- logique de déduction dans les contrôleurs ;
- heuristiques historiques inutilisées.

Le changement peut nécessiter un bump de version interne du package, même si le monorepo reste privé.

## 11. Découpage recommandé en tickets

### Ticket A — tests de caractérisation multi-approval

**Dépendances** : aucune.  
**Valeur** : verrouille le défaut actuel.

### Ticket B — types `PipelineRunResult` et snapshot

**Dépendances** : A.  
**Valeur** : crée la nouvelle Interface sans migrer les hôtes.

### Ticket C — moteur `start/resume/cancelRun/inspect`

**Dépendances** : B.  
**Valeur** : concentre le cycle de vie.

### Ticket D — Adapter Pi sur résultats typés

**Dépendances** : C.  
**Valeur** : corrige immédiatement le bug multi-approval côté Pi.

### Ticket E — pause générique et DSL compatible

**Dépendances** : C.  
**Valeur** : retire le wrapper XML de la seconde approval.

### Ticket F — Adapter VS Code sur résultats typés

**Dépendances** : C, E.  
**Valeur** : assure la parité des hôtes.

### Ticket G — politique d’exécution commune

**Dépendances** : C.  
**Valeur** : rend read-only exécutoire.

### Ticket H — enforcement Native ACP

**Dépendances** : G.  
**Valeur** : ferme le principal écart de sécurité.

### Ticket I — `SkillResolver`

**Dépendances** : aucune après caractérisation.  
**Valeur** : rétablit les skills explicitement sélectionnés.

### Ticket J — nettoyage de compatibilité

**Dépendances** : D, E, F, H, I.  
**Valeur** : réduit l’Interface et la dette historique.

## 12. Matrice de validation

### Package partagé

```bash
npm run test -w @acp-client/pipeline
```

Couvre validation YAML, compilation, résultats, pauses, annulation et snapshots.

### Plugin Pi

```bash
npm run test -w @acp-client/pi-extension
```

Couvre contrôleur, runner, permissions, skills et Sandcastle.

### Extension VS Code

```bash
npm run test -w acp-client
```

Couvre runtime virtuel, projections UI, sessions et Adapters d’exécution.

### Monorepo

```bash
npm test
```

Doit être exécuté avant fusion de chaque phase qui modifie l’Interface partagée.

## 13. Déploiement et retour arrière

- Chaque phase conserve les anciennes méthodes jusqu’à migration complète.
- Les nouveaux champs YAML sont optionnels.
- Les pipelines existants continuent d’être chargés avec les valeurs par défaut historiques.
- Un feature flag n’est pas nécessaire si les wrappers garantissent la compatibilité.
- En cas de régression, les hôtes peuvent revenir temporairement aux wrappers sans annuler les nouveaux types internes.

## 14. Definition of Done

La migration est terminée lorsque :

- un pipeline avec N approvals fonctionne dans Pi et VS Code ;
- les hôtes ne déduisent plus l’état final depuis des événements ;
- le contenu Markdown d’une approval ne dépend pas de `<proposed_plan>` ;
- `sideEffects: none` est garanti par chaque Adapter ;
- les skills explicitement demandés sont effectivement injectés ;
- les tests principaux traversent l’Interface publique du moteur ;
- l’ancienne Interface orientée plan est supprimée ;
- les ADR proposés sont acceptés ou remplacés par des décisions équivalentes.