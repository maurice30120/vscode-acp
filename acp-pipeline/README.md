# @acp-client/pipeline

Module npm local qui contient l'orchestration pipeline d'ACP Client.

Ce package est volontairement indépendant de VS Code. Il ne lit pas les settings,
ne parcourt pas le workspace, ne lance pas d'agent concret, ne fait pas de `git diff`
et ne connait pas Sandcastle. Ces responsabilites restent dans l'extension, qui les
injecte via des callbacks.

## Ce que le package fournit

- Les types publics de pipeline v3: `PipelineV3Definition`,
  `CompiledPipelineProgram`, evenements pipeline, etc.
- La compilation et validation des definitions pipeline v3.
- L'execution de pipeline par DAG de `nodes`, pauses d'approbation, reprise,
  annulation, parallele, evenements de statut et session updates.
- Les helpers autour de `<proposed_plan>`.
- La resolution des `promptFile` attaches aux nodes v3.

## Ce qui reste cote extension

L'extension VS Code joue le role d'adapter. Elle fournit notamment:

- la lecture de `.acp/pipelines/*.yaml`;
- la lecture des settings `acp.agents`;
- la resolution du workspace courant;
- le runner ACP/Sandcastle concret;
- la detection d'un agent Sandcastle;
- la projection des evenements vers l'UI VS Code.

## Utilisation

Dans le monorepo, le package est reference comme workspace local:

```json
{
  "dependencies": {
    "@acp-client/pipeline": "file:root/acp-pipeline"
  }
}
```

Exemple minimal:

```ts
import { PipelineService } from '@acp-client/pipeline';

const service = new PipelineService(
  () => workspaceCwd,
  {
    getPipelinePrograms: () => programs,
    getPipelineProgramForAgent: agentName =>
      programs.find(program => program.title === agentName || program.id === agentName) ?? null,
    getAgentConfigs: () => agentConfigs,
    runAgent: input => runConcreteAgent(input),
    isAgentSandcastle: (agentName, configs) =>
      configs[agentName]?.transport === 'sandcastle',
    readWorkspaceDiff: () => readGitDiff(),
    isRunAbortedError: error => isAbortError(error),
  },
);
```

Le package emet des evenements `status`, `plan-ready` et `session-update`.
Les consommateurs doivent les projeter vers leur interface.

## Build

```bash
npm run build -w @acp-client/pipeline
```

Le build produit `dist/`, qui est consomme par l'extension pendant `npm run compile`.

## Tests

Les tests sont ecrits avec le runner natif Node.js (`node:test` + `node:assert/strict`).

```bash
# Lancer la suite complete (build package + compilation tests + execution)
npm run test -w @acp-client/pipeline

# Watch mode (dev only)
npm run test:watch -w @acp-client/pipeline
```

Structure :

- `test/PipelineV3Compiler.test.ts` — compilation YAML v3, DAG, inputs et erreurs structurelles.
- `test/PipelineV3Catalog.test.ts` — catalogue v3, resolution `promptFile`, securite path, taille max.
- `test/PipelineRuntime.test.ts` — execution, pauses, reprise, annulation et parallele.
- `test/PipelineService.test.ts` — integration service/runtime/adaptateur.
- `test/helpers.ts` — fixtures et utilitaires partages.

Les tests importent l'**API publique compilee** (`../dist/index.js`) et non les sources.
Le script `test` s'assure toujours de `npm run build` avant de compiler et executer la suite.

## Roadmap

Voir la section `@acp-client/pipeline` dans [`../ROADMAP.md`](../ROADMAP.md).
