# ACP CLI

`@acp-client/cli` exécute un pipeline ACP directement depuis un terminal.

La commande principale est volontairement minimale :

```bash
acp-cli run "nom-du-pipeline" "le prompt utilisateur"
```

Aucun agent n'est passé en argument. Le CLI :

1. charge le pipeline depuis `.acp/pipelines/*.yaml` ;
2. lit les agents du workspace dans `.acp/acp-agents.json` ;
3. résout l'agent déclaré par chaque primitive du pipeline ;
4. lance les processus ACP ou Sandcastle requis par le DAG ;
5. orchestre les questions, approbations et reprises avec `@acp-client/pipeline`.

Le CLI ne charge aucun catalogue de pipelines ou d'agents embarqué dans Pi.

## Configuration

Le fichier `.acp/acp-agents.json` utilise le même format plat que le workspace VS Code :

```json
{
  "Codex CLI": {
    "command": "npx",
    "args": ["@zed-industries/codex-acp@latest"],
    "env": {}
  },
  "Vibe Sandcastle": {
    "transport": "sandcastle",
    "provider": "vibe",
    "model": "mistral-large-latest",
    "env": {}
  }
}
```

Chaque primitive choisit son agent dans le YAML :

```yaml
primitives:
  planner:
    agent: Codex CLI
    skills:
      - grill-me
    output: proposed_plan
    sideEffects: none
    permissions: allowAll
```

## `grill-me`

Les skills nommés explicitement par une primitive sont chargés depuis
`.agents/skills/<nom>/SKILL.md` et injectés intégralement dans le prompt.

`disable-model-invocation: true` bloque uniquement la découverte automatique ;
il ne bloque pas un skill explicitement demandé par un pipeline. Le planner
`grill-me` peut donc poser une seule question à la fois jusqu'à obtenir un plan
complet, puis le CLI demande l'approbation avant les étapes à effets de bord.

## Commandes

```bash
acp-cli run grill-skeleton-tdd "Ajouter une commande export"
acp-cli list
```

Options :

```text
--cwd <path>  workspace contenant .acp et .agents
--yes, -y     approuve automatiquement le plan final
--verbose     affiche les statuts et chunks des agents sur stderr
--json        sérialise la liste ou le résultat final
```

`--yes` ne valide pas automatiquement une promotion Sandcastle : l'application
des modifications isolées reste une décision distincte.

## Développement

Depuis la racine du dépôt :

```bash
npm run test:cli
npm run acp-cli -- run grill-skeleton-tdd "Ajouter une commande export"
```
