# Étude d’architecture — évolution du runtime pipeline révélée par la PR #9

## Statut

- **PR étudiée** : `#9 feat: add grill spec tickets implement review pipeline`
- **Branche étudiée** : `agent/matt-skills-spec-tickets-review`
- **Commit de référence** : `38b0e73c5019173e6c8ad7441922b937d373017e`
- **Nature de ce dossier** : étude et décisions proposées ; aucune modification de runtime n’est incluse ici.

## But

La PR #9 ajoute un pipeline contenant deux validations humaines. Elle révèle que le runtime actuel sait interrompre et reprendre un graphe plusieurs fois, mais que ses interfaces publiques et ses adapters hôtes ont été conçus autour d’une seule « approbation de plan ».

L’objectif de cette étude est de proposer une évolution cohérente pour les trois surfaces qui doivent rester alignées :

1. `@acp-client/pipeline`, le module partagé d’orchestration ;
2. `@acp-client/pi-extension`, l’adapter Pi ;
3. `acp-client`, l’adapter VS Code.

L’étude applique le vocabulaire du skill `.agents/skills/codebase-design/SKILL.md` : **module**, **interface**, **seam**, **adapter**, **depth**, **leverage** et **locality**.

## Décision recommandée

Faire évoluer le runtime autour d’un module profond unique dont l’interface de commande est petite et explicite :

```ts
type PipelineRunOutcome =
  | { kind: "paused"; sessionId: string; pause: PipelinePause }
  | { kind: "completed"; sessionId: string; output: string };

interface PipelineRuntime {
  start(input: PipelineStartInput): Promise<PipelineRunOutcome>;
  resume(input: PipelineResumeInput): Promise<PipelineRunOutcome>;
  reject(input: PipelineRejectInput): void;
  cancel(sessionId: string): void;
  getSnapshot(sessionId: string): PipelineRunSnapshot | undefined;
}
```

Les événements restent une surface d’observation pour l’UI et le debug. Ils ne doivent plus être utilisés par un adapter hôte pour déduire le résultat d’une commande.

En parallèle :

- remplacer la notion spécifique de `plan-ready` par une **pause générique typée** ;
- rendre les capacités de chaque étape exécutoires au seam ACP, au lieu de traiter `sideEffects` comme une simple intention ;
- distinguer une skill découvrable par le modèle d’une skill explicitement demandée par un pipeline ;
- ajouter des tests de contrat communs aux adapters Pi et VS Code.

## Documents

1. [Architecture actuelle](01-current-architecture.md)
2. [Évaluation des modules et opportunités d’approfondissement](02-deep-module-assessment.md)
3. [Design It Twice — alternatives d’interface](03-design-it-twice.md)
4. [Architecture cible recommandée](04-target-architecture.md)
5. [Plan d’implémentation détaillé](05-implementation-plan.md)
6. [Stratégie de tests](06-test-strategy.md)
7. Décisions proposées :
   - [ADR proposé 1 — résultats de run et pauses génériques](adr/0001-run-outcomes-and-generic-pauses.md)
   - [ADR proposé 2 — capacités d’étape exécutoires](adr/0002-enforced-step-capabilities.md)
   - [ADR proposé 3 — invocation explicite des skills](adr/0003-explicit-skill-invocation.md)

## Périmètre immédiat de la PR #9

Avant merge, le minimum sûr est :

1. ajouter un test d’exécution à deux pauses ;
2. faire retourner un résultat explicite par `approvePlan` ou son remplaçant ;
3. conserver le run actif lorsque la reprise atteint une nouvelle pause ;
4. passer les étapes non implémenteur à `permissions: ask` tant que les capacités ne sont pas exécutoires ;
5. corriger l’injection explicite des skills marquées `disable-model-invocation: true` ;
6. supprimer le wrapper artificiel `<proposed_plan>` de la seconde validation dès que la pause générique est disponible.

## Hors périmètre

- migration complète du DSL pipeline v2 vers un DAG v3 ;
- persistance durable des checkpoints LangGraph ;
- refonte globale de `SessionManager` et de la webview VS Code ;
- classification fiable de commandes terminal « lecture seule » sur l’hôte natif ;
- nouveau package partagé de skills dès la première étape.
