# Pipelines ACP v3

Les pipelines ACP sont des workflows déclarés en YAML sous `.acp/pipelines/`.
Chaque pipeline valide apparaît comme agent virtuel quand `acp.pipeline.enabled`
est actif.

## Pré-requis

1. `acp.pipeline.enabled` doit être à `true`.
2. Le fichier YAML doit être dans `.acp/pipelines/*.yaml` ou `.acp/pipelines/*.yml`.
3. Le YAML doit utiliser `version: 3`.
4. Chaque `nodes[].agent` doit exister dans `.acp/acp-agents.json`.
5. Les actions qui modifient le workspace doivent être placées derrière une
   pause d'approbation humaine et utiliser une policy compatible.

## Exemple minimal

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
    agent: Codex CLI
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

Le champ `title` devient le nom affiché dans la vue Agents. Ici, l'agent virtuel
s'appelle `Plan Execute Verify`.

## Modèle d'exécution

- Un node sans `type` est un node agent.
- `needs` déclare les dépendances du node et permet l'exécution parallèle quand
  plusieurs nodes deviennent prêts en même temps.
- `inputs` référence des artifacts produits par les dépendances avec la forme
  `<node>.<artifact>`.
- `promptFile` est résolu relativement au fichier pipeline, puis son contenu est
  ajouté avant `prompt`.
- `type: pause` avec `pause: approval`, `question` ou `promotion` interrompt le
  workflow jusqu'à décision humaine.
- `policy` décrit les capacités autorisées pour le node: filesystem, terminal,
  network et promotion.

## Skills

Les skills ne sont pas packagées par le plugin Pi. Dans VS Code, le starter
workspace peut fournir `.agents/skills/`. Un pipeline peut demander une skill sur
un node agent avec `skills: [...]`; si la skill n'existe pas dans le workspace,
le pipeline est refusé avant exécution.

```yaml
nodes:
  - id: review
    agent: Codex CLI
    skills: [code-review]
    prompt: Relis les changements.
    output:
      name: review
      type: acp.review/v1
      format: markdown
```

## Sandcastle

Un node peut cibler un agent Sandcastle déclaré dans `.acp/acp-agents.json`.
Les changements workspace restent isolés dans la sandbox jusqu'à la promotion.
La promotion peut être `discard`, `ask`, `auto-apply` ou `auto-reject` selon la
policy du node et la configuration de l'extension.
