# ADR-0020 — Résultats typés et pauses génériques du runtime pipeline

**Statut** : Proposé  
**Date** : 2026-07-19

## Contexte

Le package `@acp-client/pipeline` expose actuellement des opérations orientées vers le workflow historique « produire un plan, approuver le plan, continuer » :

- `createPlan()` ;
- `approvePlan()` ;
- `rejectPlan()` ;
- événement `plan-ready` ;
- état `PendingApprovalState.plan`.

Les méthodes asynchrones retournent une chaîne. La différence entre une pause intermédiaire et une fin de run est communiquée par un événement latéral et un état interne mutable.

Cette Interface fonctionne avec une seule approval, mais devient ambiguë avec plusieurs pauses. Après une première reprise, le graphe peut atteindre une seconde approval. Le moteur émet alors un nouvel événement `plan-ready`, tandis qu’un Adapter hôte peut interpréter la chaîne retournée comme une sortie terminale.

La PR #9 a rendu ce défaut observable dans le contrôleur Pi : la seconde approval est affichée, puis le contrôleur annonce malgré tout la fin du pipeline et libère sa session active.

La même spécialisation impose d’emballer une spécification et une liste de tâches dans `<proposed_plan>` pour utiliser un step `approval`, alors que ce contenu n’est pas un plan interactif.

## Décision

### 1. Le runtime retourne un résultat discriminé

Ajouter une Interface de commandes :

```ts
export interface PipelineRuntime {
  start(input: StartPipelineInput): Promise<PipelineRunResult>;
  resume(input: ResumePipelineInput): Promise<PipelineRunResult>;
  cancelRun(sessionId: string): PipelineRunResult;
  inspect(sessionId: string): PipelineRunSnapshot | null;
}
```

Toutes les commandes retournent une valeur qui représente l’état stable du run :

```ts
export type PipelineRunResult =
  | { kind: 'paused'; sessionId: string; pause: PipelinePause; snapshot: PipelineRunSnapshot }
  | { kind: 'completed'; sessionId: string; output: string; snapshot: PipelineRunSnapshot }
  | { kind: 'rejected'; sessionId: string; reason?: string; snapshot: PipelineRunSnapshot }
  | { kind: 'cancelled'; sessionId: string; snapshot?: PipelineRunSnapshot }
  | { kind: 'failed'; sessionId: string; error: PipelineRunError; snapshot?: PipelineRunSnapshot };
```

Les événements restent disponibles pour :

- le streaming des chunks agent ;
- les changements d’activité ;
- la télémétrie ;
- les projections UI progressives.

Ils ne sont plus la source de vérité pour distinguer pause et fin.

### 2. Les pauses sont génériques

Introduire :

```ts
export interface PipelinePause {
  id: string;
  kind: 'approval' | 'question' | 'promotion';
  title?: string;
  content: string;
  contentType: 'markdown' | 'proposed_plan' | 'text';
  metadata?: Record<string, string | number | boolean>;
}
```

La reprise utilise une décision explicite :

```ts
export type ResumeDecision =
  | { kind: 'approve'; content?: string }
  | { kind: 'answer'; content: string }
  | { kind: 'reject'; reason?: string };
```

Le contrat `<proposed_plan>` n’est appliqué que lorsque `contentType === 'proposed_plan'`.

### 3. LangGraph reste un Seam interne

Les types suivants ne font pas partie de l’Interface des hôtes :

- `Command` ;
- `MemorySaver` ;
- `thread_id` ;
- représentation brute des interrupts.

`PipelineGraphCoordinator` traduit les interruptions du moteur de graphe en `PipelinePause` et les résultats de graphe en `PipelineRunResult`.

### 4. Migration compatible

Pendant la migration :

- les méthodes historiques restent disponibles comme wrappers dépréciés ;
- les événements historiques peuvent être émis pour les UIs non migrées ;
- les steps `approval` sans `contentType` conservent un comportement compatible ;
- Pi migre en premier afin de corriger le défaut multi-approval ;
- VS Code migre ensuite via son runtime de session virtuelle.

Les wrappers sont supprimés lorsque les deux hôtes utilisent la nouvelle Interface.

## Invariants

1. Un appel retourne exactement un résultat stable.
2. `paused` implique que le run reste inspectable et reprenable.
3. Un état terminal implique que les ressources actives sont libérées.
4. Une reprise doit cibler la pause courante ; une pause obsolète est refusée.
5. Le nombre de pauses d’un pipeline n’est pas limité par l’Interface publique.
6. Les événements peuvent être perdus sans rendre l’état du run ambigu.

## Conséquences positives

- Correction structurelle des pipelines à plusieurs approvals.
- Réduction de la logique dupliquée entre Pi et VS Code.
- Tests directs du cycle de vie à travers l’Interface publique.
- Support naturel de contenu Markdown, texte, plan interactif et futures pauses.
- Locality accrue : le moteur possède la décision de nettoyage et de conservation du run.
- Les Adapters hôtes deviennent des projections de résultats plutôt que des machines à états concurrentes.

## Conséquences négatives

- Nouvelle famille de types publics à maintenir.
- Migration nécessaire des deux hôtes.
- Période transitoire avec deux Interfaces.
- Les événements historiques peuvent dupliquer temporairement une partie de l’information retournée.

## Alternatives rejetées

### Ajouter une condition dans `PipelineController.approve()`

Cette correction locale résout le symptôme Pi, mais laisse chaque hôte reconstruire le cycle de vie. La complexité réapparaîtrait dans VS Code et dans tout futur Adapter.

### Utiliser uniquement un event stream

Un stream est adapté au progrès, mais oblige encore l’appelant à réduire les événements pour connaître l’état stable. Il augmente aussi le coût d’utilisation pour les commandes simples.

### Retourner un objet handle mutable

Un handle de run simplifierait certaines opérations, mais introduirait des problèmes de durée de vie, de sérialisation et d’état obsolète. Les hôtes utilisent déjà `sessionId` comme identité stable.

### Conserver `<proposed_plan>` comme enveloppe universelle

Cette enveloppe mélange structure de contrôle et contenu métier, impose un parser fragile et ne représente pas les futures catégories de pause.

## Plan de validation

Les tests d’acceptation doivent couvrir :

```text
start
→ paused(plan_approval)
→ resume approve
→ paused(delivery_approval)
→ inspect = paused
→ resume approve
→ completed
```

Ainsi que :

- reject à la première et à la seconde pause ;
- cancel avant, pendant et après une pause ;
- contenu Markdown contenant des balises `<proposed_plan>` ;
- erreur de reprise avec un identifiant de pause obsolète ;
- parité des résultats Pi et VS Code.

## Documents liés

- `docs/architecture/pipeline-architecture-study.md`
- `docs/architecture/pipeline-target-architecture.md`
- `docs/architecture/pipeline-migration-plan.md`
- `docs/reviews/pr-9-review.md`
- ADR-0015 : runtime d’extension et sessions virtuelles
- ADR-0018 : pipeline v2 canonique