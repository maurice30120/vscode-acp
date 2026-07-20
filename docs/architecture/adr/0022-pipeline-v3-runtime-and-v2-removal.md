# ADR-0022 — Runtime pipeline v3 unique et suppression du moteur v2

**Statut** : Accepté
**Date** : 2026-07-20

## Contexte

Le projet avait deux générations de pipeline en parallèle :

- un moteur v2 historique basé sur `primitives` et `steps` ;
- un runtime v3 basé sur des `nodes`, des artifacts typés, des pauses génériques et des policies exécutoires.

Cette coexistence augmentait le coût de maintenance et laissait deux chemins d'exécution possibles dans les plugins. Elle rendait aussi floue la source de vérité du catalogue : certaines surfaces acceptaient encore des définitions v2 pendant que le service exécutait déjà des programmes v3 compilés.

L'objectif d'implémentation est que le moteur v2 n'existe plus comme moteur exécutable, et que les plugins VS Code et Pi restent alignés sur le même contrat v3.

## Décision

Le runtime pipeline officiel est désormais v3 uniquement.

Les éléments v2 suivants sont supprimés :

- `PipelineExecutor` ;
- `PipelineGraphCompiler` ;
- `PipelineRunEngine` ;
- `PipelineRunRegistry` ;
- le coordinateur et les helpers de moteur v2 sous `engine/` ;
- les types publics `PipelineDefinition`, `PipelinePrimitiveDefinition`, `PipelineStepDefinition` ;
- le validateur v2 ;
- le resolver v2 de `promptFile`.

`PipelineService` orchestre uniquement des `CompiledPipelineProgram` v3. Les plugins ne fournissent plus de fallback vers une définition v2. Une définition YAML `version: 2` est refusée explicitement par le compilateur/catalogue v3, sans conversion implicite.

## Contrat v3 retenu

Un pipeline est un DAG de `nodes`.

- Un node agent déclare `agent`, `prompt` ou `promptFile`, `output`, `inputs`, `needs`, `policy` et éventuellement `skills`.
- Un node pause déclare `type: pause`, `pause`, `content`, `format`, `inputs`, `needs` et éventuellement `output`.
- Les données entre nodes passent par des artifacts typés.
- Les `promptFile` sont résolus par `resolvePipelineV3PromptFiles`.
- Les policies sont normalisées avant exécution et validées contre les capacités de l'adapter.
- La résolution des skills explicites se fait avant d'appeler l'agent.

## Invariants

1. Aucun hôte ne peut exécuter un pipeline v2.
2. Une définition v2 peut seulement apparaître dans un test de refus explicite.
3. `PipelineService` ne connaît que des programmes v3 compilés.
4. Le catalogue v3 est la seule surface de chargement runtime.
5. Les prompts externes sont résolus avant compilation/exécution.
6. Les policies et skills sont validés avant le prompt agent.

## Conséquences positives

- Une seule sémantique de pipeline à maintenir.
- Suppression de chemins morts et de shims entre plugins.
- Erreurs plus nettes quand un ancien YAML v2 est encore présent.
- Tests plus directs autour du runtime réel.
- Meilleure parité entre VS Code, Pi et le package partagé.

## Conséquences négatives

- Les anciens pipelines v2 ne sont plus compatibles.
- Les consommateurs qui importaient les types v2 publics doivent migrer.
- La documentation historique doit être considérée comme obsolète si elle parle encore de `primitives` et `steps`.

## Alternatives rejetées

### Garder le moteur v2 en compatibilité

Cela aurait conservé deux modèles mentaux et deux chemins de bug. La compatibilité aurait aussi retardé la stabilisation des policies, des pauses et des artifacts typés.

### Convertir automatiquement v2 vers v3

Une conversion implicite aurait masqué les migrations incomplètes et créé un troisième contrat à maintenir. Le refus explicite rend les erreurs visibles.

### Garder les types v2 comme API dépréciée

Les types auraient continué à suggérer une surface supportée. Leur suppression force l'usage du catalogue v3.

## Validation

- `npm run test -w @acp-client/pipeline`
- `npm run test -w @acp-client/pi-extension`
- `npm run test -w acp-client`
- recherches ciblées sur les anciennes API v2 (`PipelineDefinition`, `PipelineValidator`, `parsePipelineYaml`, `PipelinePromptFileResolver`)

## Documents liés

- ADR-0020 — Résultats typés et pauses génériques du runtime pipeline
- ADR-0021 — Politiques d'exécution exécutoires et résolution explicite des skills
- ADR-0023 — Configuration workspace-root pour le plugin Pi
- ADR-0024 — Gestion des skills et frontières de packaging
