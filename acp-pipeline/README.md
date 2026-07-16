# @acp-client/pipeline

Module npm local qui contient l'orchestration pipeline d'ACP Client.

Ce package est volontairement indépendant de VS Code. Il ne lit pas les settings,
ne parcourt pas le workspace, ne lance pas d'agent concret, ne fait pas de `git diff`
et ne connait pas Sandcastle. Ces responsabilites restent dans l'extension, qui les
injecte via des callbacks.

## Ce que le package fournit

- Les types publics de pipeline: `PipelineDefinition`,
  `PipelinePrimitiveDefinition`, evenements pipeline, etc.
- La validation des definitions pipeline.
- L'execution de pipeline avec plan, approbation, reprise, annulation, branches
  paralleles, evenements de statut et session updates.
- Les helpers autour de `<proposed_plan>`.
- La resolution des `promptFile` attaches aux primitives.

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
    getPipelineDefinitions: () => pipelines,
    getPipelineDefinitionForAgent: agentName =>
      pipelines.find(pipeline => pipeline.title === agentName) ?? null,
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

## Roadmap

Voir la section `@acp-client/pipeline` dans [`../ROADMAP.md`](../ROADMAP.md).
