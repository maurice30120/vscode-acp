# ACP Client monorepo

Ce dépôt regroupe les surfaces ACP Client qui doivent évoluer ensemble : une extension VS Code, un moteur d'orchestration partagé, une extension Pi et un CLI. La racine ne contient pas de code applicatif ; elle sert de point d'entrée pour les commandes transverses et la cohérence des builds.

Le modèle pipeline est implémenté une seule fois dans `@acp-client/pipeline`, puis consommé depuis VS Code, Pi ou un terminal. Les hôtes fournissent l'interaction utilisateur et le lancement des agents, mais le DAG, les approbations et les reprises restent communs.

## Packages

| Dossier | Package npm | Rôle |
| --- | --- | --- |
| `plugin-vscode` | `acp-client` | Extension VS Code principale. Elle connecte l'éditeur à des agents compatibles ACP, fournit le chat, l'historique de sessions et les pipelines. |
| `acp-pipeline` | `@acp-client/pipeline` | Bibliothèque TypeScript indépendante de l'UI. Elle porte les types, la validation, la compilation et l'exécution des pipelines déclaratifs. |
| `plugin-pi` | `@acp-client/pi-extension` | Extension pour Pi exposant les pipelines dans cet hôte. |
| `pipeline-cli` | `@acp-client/cli` | Binaire `acp-cli`. Il charge les fichiers `.acp` du workspace, lance les agents déclarés par le pipeline et orchestre le run depuis un terminal. |

## CLI

La commande n'accepte pas de paramètre d'agent :

```bash
acp-cli run "nom-du-pipeline" "le prompt"
```

Le pipeline choisit ses agents dans ses primitives. `acp-cli` les résout dans
`.acp/acp-agents.json` et lance automatiquement les processus ACP ou
Sandcastle nécessaires.

Le CLI ne dépend d'aucun catalogue de pipelines ou d'agents embarqué dans Pi.
Les pipelines viennent de `.acp/pipelines` et les skills explicites de
`.agents/skills`.

Exemple local depuis la racine :

```bash
npm run acp-cli -- run grill-skeleton-tdd "Ajouter une nouvelle commande"
```

## Commandes courantes

```bash
npm run compile
npm test
npm run test:pi
npm run test:cli
npm run acp-cli -- list
npm run lint
npm run package
npm run vsx
```

Commandes ciblées :

```bash
npm run build -w @acp-client/pipeline
npm run build -w @acp-client/pi-extension
npm --prefix pipeline-cli run build
npm run vsx -w acp-client
```

## Documentation détaillée

- Extension VS Code : [`plugin-vscode/README.fr.md`](plugin-vscode/README.fr.md)
- Pipeline partagé : [`acp-pipeline/README.md`](acp-pipeline/README.md)
- Plugin Pi : [`plugin-pi/README.md`](plugin-pi/README.md)
- CLI : [`pipeline-cli/README.md`](pipeline-cli/README.md)
- Architecture cible : [`docs/architecture/pipeline-target-architecture.md`](docs/architecture/pipeline-target-architecture.md)
- Plan de migration : [`docs/architecture/pipeline-migration-plan.md`](docs/architecture/pipeline-migration-plan.md)
