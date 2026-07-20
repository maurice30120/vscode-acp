# @acp-client/pi-extension

Extension Pi pour exécuter les pipelines ACP définis dans le workspace ouvert.

## Source de configuration

Le plugin Pi n'embarque plus de configuration, de pipelines, de prompts agents ou
de skills. Comme le plugin VS Code, il lit la configuration depuis la racine du
workspace courant :

- `.acp/acp-agents.json` pour les agents ACP natifs et les options pipeline.
- `.acp/.sandcastle/config.json` pour les agents Sandcastle et la promotion.
- `.acp/pipelines/*.yaml` et `.acp/pipelines/*.yml` pour les pipelines v3.
- `.acp/agents/*.md` pour les `promptFile` référencés par les pipelines.
- `.agents/skills/<name>/SKILL.md` uniquement si un pipeline workspace déclare
  explicitement `skills: [...]` sur un node.

Un workspace sans `.acp/acp-agents.json` ne reçoit aucun catalogue packagé en
fallback.

## Commandes Pi

- `/pipeline list`
- `/pipeline run <pipeline> <prompt>`
- `/pipeline answer <réponse>`
- `/pipeline approve`
- `/pipeline reject`
- `/pipeline cancel`
- `/pipeline status`
- `/pipeline verbose on|off|status`

Le plugin enregistre aussi l'outil `run_pipeline` pour que le modèle Pi puisse
lancer un pipeline configuré.

## Exemple de pipeline v3

```yaml
version: 3
id: plan-execute-verify
title: Plan Execute Verify

nodes:
  - id: plan
    agent: Codex CLI
    promptFile: ../agents/planner.md
    prompt: |
      Demande utilisateur :
      {{userPrompt}}
    output:
      name: plan
      type: acp.plan/v1
      format: markdown

  - id: approval
    type: pause
    pause: approval
    needs: [plan]
    content: "{{nodes.plan.outputs.plan}}"
    format: proposed-plan
    output:
      name: approved_plan
      type: acp.plan/v1
      format: markdown

  - id: implement
    agent: Pi Agent
    needs: [approval]
    inputs:
      - name: plan
        from: approval.approved_plan
        type: acp.plan/v1
        format: markdown
    policy:
      filesystem: workspace-write
      terminal: workspace-write
      network: disabled
      promotion: ask
    prompt: |
      Implémente le plan approuvé :
      {{inputs.plan}}
    output:
      name: changes
      type: acp.changes/v1
      format: markdown
```

## Organisation

```text
src/
├── index.ts
├── catalog/
│   ├── config.ts
│   ├── pipelineCatalog.ts
│   └── skillCatalog.ts
├── runtime/
│   ├── commands.ts
│   ├── pipelineController.ts
│   └── tool.ts
├── acp/
└── sandcastle/
```

## Build et tests

```bash
npm run build -w @acp-client/pi-extension
npm run test -w @acp-client/pi-extension
```
