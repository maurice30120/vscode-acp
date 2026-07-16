# ACP Client monorepo

Ce dépôt est un monorepo npm qui regroupe les surfaces ACP Client qui doivent évoluer ensemble : une extension VS Code, un moteur d'orchestration partagé et une extension Pi. La racine ne contient pas de code applicatif ; elle sert de point d'entrée pour les commandes transverses, la déclaration des workspaces et la cohérence des builds.

Le monorepo permet de faire évoluer le modèle pipeline une seule fois, puis de le consommer depuis plusieurs environnements. C'est important parce que l'orchestration d'agents ACP, les pipelines déclaratifs, les approbations humaines et les runs isolés Sandcastle doivent rester cohérents entre VS Code et Pi, même si les intégrations UI et runtime sont différentes.

## Workspaces

| Dossier | Package npm | Rôle |
| --- | --- | --- |
| `plugin-vscode` | `acp-client` | Extension VS Code principale. Elle connecte l'éditeur à des agents compatibles ACP, fournit le chat, l'historique de sessions, les pipelines v2 et les runtimes Sandcastle avec promotion Apply/Reject. |
| `acp-pipeline` | `@acp-client/pipeline` | Bibliothèque TypeScript indépendante de VS Code. Elle porte les types, la validation, la compilation et l'exécution des pipelines déclaratifs, avec approbation humaine, reprise, annulation et branches parallèles. |
| `plugin-pi` | `@acp-client/pi-extension` | Extension pour l'hôte Pi. Elle embarque sa configuration ACP, expose des commandes `/pipeline`, lance des agents ACP externes et consomme le moteur pipeline partagé pour orchestrer des workflows dans Pi. |

## Pourquoi ce découpage

- `plugin-vscode` reste le produit principal livré en VSIX, avec toute l'intégration VS Code.
- `acp-pipeline` isole la logique métier d'orchestration pour qu'elle soit testable et réutilisable hors VS Code.
- `plugin-pi` valide que le modèle pipeline peut vivre dans un autre hôte, sans dépendre de l'extension VS Code.
- La racine garde les commandes courantes pour éviter de mémoriser les noms exacts des packages npm.

## À quoi sert le projet

ACP Client sert à piloter des agents de code depuis un environnement développeur, sans lier l'utilisateur à un seul fournisseur. Le projet fournit une couche d'intégration autour du protocole ACP : découverte et lancement d'agents, chat, contexte éditeur, accès fichiers/terminal, permissions, historique de sessions et orchestration de workflows.

Le sujet central du dépôt est donc le **harness d'exécution d'agents** : tout ce qui entoure le modèle ou le CLI agent pour le rendre utilisable dans un vrai workspace. Cela inclut le choix du contexte transmis, la manière d'enchaîner plusieurs agents, les points d'approbation humaine, l'isolation des modifications dans Sandcastle et la promotion contrôlée des changements vers le workspace.

Le monorepo existe pour partager cette logique entre plusieurs surfaces :

- dans VS Code, l'utilisateur manipule directement les agents depuis l'éditeur ;
- dans Pi, les mêmes concepts sont exposés comme plugin et commandes de pipeline ;
- dans `acp-pipeline`, l'orchestration reste indépendante de l'UI et du runtime concret.

Dans le vocabulaire de recherche récent, ce type de travail se rapproche du **harness engineering** : améliorer le code et les règles autour d'un agent pour mieux gérer le contexte, les outils, la mémoire, les traces et les effets de bord. Le projet ne cherche pas à optimiser automatiquement des harnesses comme Meta-Harness ; il construit le harness applicatif nécessaire pour utiliser, orchestrer et isoler des agents ACP dans des environnements de développement réels.

## Commandes courantes

Depuis la racine :

```bash
npm run compile      # compiler l'extension VS Code
npm test             # tests centrés sur l'extension VS Code
npm run test:pi      # tests du plugin Pi
npm run lint         # lint transverse
npm run package      # build de production VS Code
npm run vsx          # générer le VSIX
```

Commandes ciblées :

```bash
npm run build -w @acp-client/pipeline
npm run build -w @acp-client/pi-extension
npm run vsx -w acp-client
```

## Documentation détaillée

- Extension VS Code : [`plugin-vscode/README.fr.md`](plugin-vscode/README.fr.md)
- Pipeline partagé : [`acp-pipeline/README.md`](acp-pipeline/README.md)
- Plugin Pi : [`plugin-pi/README.md`](plugin-pi/README.md)
- Roadmap monorepo : [`ROADMAP.md`](ROADMAP.md)
- Décision d'architecture monorepo : [`plugin-vscode/doc_fr/adr/0017-monorepo-npm-workspaces.md`](plugin-vscode/doc_fr/adr/0017-monorepo-npm-workspaces.md)
- Décision pipeline v2 canonique : [`plugin-vscode/doc_fr/adr/0018-pipeline-v2-catalogue-canonique.md`](plugin-vscode/doc_fr/adr/0018-pipeline-v2-catalogue-canonique.md)
- Décision `promptFile` partagé : [`plugin-vscode/doc_fr/adr/0019-promptfile-pipeline-partage.md`](plugin-vscode/doc_fr/adr/0019-promptfile-pipeline-partage.md)
