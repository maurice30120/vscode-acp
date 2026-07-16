# ADR-0017 : Monorepo npm workspaces

**Statut** : Accepté

## Contexte

Le dépôt regroupe plusieurs surfaces qui évoluent ensemble : l'extension VS Code, le moteur pipeline partagé et le plugin Pi. Ces parties ont des dépendances et des cycles de build différents, mais elles doivent rester cohérentes car l'extension consomme le pipeline partagé et le plugin Pi réutilise le même modèle d'orchestration.

Le dépôt utilise donc un monorepo npm avec trois workspaces déclarés dans le `package.json` racine.

Le packaging VS Code ajoute une contrainte supplémentaire : le VSIX doit être généré depuis le workspace `plugin-vscode`, mais il doit reconstruire le pipeline partagé avant de lancer webpack. La racine doit donc offrir une commande simple pour l'utilisateur et la CI, sans dupliquer toute la logique de build de l'extension.

## Décision

1. **Conserver la racine comme point d'entrée pour les commandes transverses.**
   - La racine ne porte pas de code applicatif.
   - Elle expose les commandes usuelles qui ciblent le workspace principal `acp-client`.
   - Les commandes spécifiques à un package restent dans le `package.json` de ce package.

2. **Séparer les responsabilités par workspace.**

| Workspace | Package npm | Rôle |
|-----------|-------------|------|
| `plugin-vscode` | `acp-client` | Extension VS Code, UI, runtime ACP, orchestration utilisateur et packaging VSIX. |
| `acp-pipeline` | `@acp-client/pipeline` | Bibliothèque partagée du moteur pipeline v2 et orchestration LangGraph. |
| `plugin-pi` | `@acp-client/pi-extension` | Extension Pi autonome, commandes Pi et intégration du moteur pipeline côté Pi. |

3. **Compiler le pipeline avant les consommateurs.**
   - `plugin-vscode` lance `npm run build -w @acp-client/pipeline` avant `compile`, `watch`, `package` et `compile-tests`.
   - `plugin-pi` dépend de `@acp-client/pipeline` via `file:../acp-pipeline`.
   - Le code généré de `acp-pipeline/dist` est donc l'interface consommée par les autres workspaces.
   - Les scripts n'utilisent pas `npm --prefix ../acp-pipeline run build`, car ce chemin ne résout pas correctement les binaires installés par npm workspaces dans tous les layouts locaux.

4. **Garder une liste courte de scripts canoniques.**
   - Les scripts racine sont des raccourcis de développement et de CI.
   - Les scripts non référencés ou trop spécifiques ne doivent pas être dupliqués à la racine.
   - Quand une commande ne concerne qu'un package, utiliser `npm run <script> -w <workspace>`.

5. **Packager le VSIX depuis le workspace extension.**
   - La racine expose `npm run vsx`, qui délègue à `npm run vsx -w acp-client`.
   - Le workspace `plugin-vscode` expose `vsx` avec `vsce package --no-dependencies`.
   - `vsce package` exécute automatiquement `vscode:prepublish`, qui lance `npm run package`.
   - `npm run package` synchronise le starter de workspace, build `@acp-client/pipeline`, puis lance webpack en mode production.
   - Le script `vsx` ne lance pas `npm run package` lui-même, afin d'éviter un double build avant la génération du VSIX.

## Lecture du monorepo

La racine du dépôt est un orchestrateur npm, pas un package applicatif. Elle déclare les workspaces et fournit les commandes courantes pour éviter de mémoriser les noms de packages npm.

```text
vscode-acp-workspace
├── package.json              # scripts racine et déclaration des workspaces
├── acp-pipeline              # package @acp-client/pipeline
├── plugin-vscode             # package acp-client
└── plugin-pi                 # package @acp-client/pi-extension
```

`plugin-vscode` est le produit principal livré en VSIX. Il contient le manifeste VS Code, le runtime de l'extension, la webview, les ressources embarquées et le script de packaging.

`acp-pipeline` est une bibliothèque locale indépendante de VS Code. Elle expose le moteur d'orchestration pipeline v2, les types pipeline et les helpers partagés. Les consommateurs ne lisent pas son TypeScript directement : ils consomment `acp-pipeline/dist` après `npm run build -w @acp-client/pipeline`.

`plugin-pi` est un second consommateur du modèle pipeline. Il reste autonome côté Pi, mais partage les mêmes concepts et dépend du pipeline local comme l'extension VS Code.

Cette structure impose une règle simple : les scripts d'un package peuvent appeler un autre workspace avec `npm run <script> -w <package>`, mais ils ne doivent pas supposer une installation locale isolée dans chaque sous-dossier.

## Scripts à appeler

Depuis la racine du dépôt :

| Besoin | Commande |
|--------|----------|
| Compiler l'extension VS Code | `npm run compile` |
| Watch extension VS Code | `npm run watch` |
| Packager l'extension VS Code | `npm run package` |
| Lancer les tests VS Code avec pré-build et lint | `npm test` |
| Lancer le lint transverse | `npm run lint` |
| Compiler les tests VS Code | `npm run compile-tests` |
| Nettoyer les artefacts VS Code | `npm run clean` |
| Générer le VSIX de l'extension VS Code | `npm run vsx` |
| Tester le plugin Pi | `npm run test:pi` |

Commandes spécifiques par workspace :

| Besoin | Commande |
|--------|----------|
| Compiler uniquement le pipeline partagé | `npm run build -w @acp-client/pipeline` |
| Nettoyer uniquement le pipeline partagé | `npm run clean -w @acp-client/pipeline` |
| Compiler uniquement le plugin Pi | `npm run build -w @acp-client/pi-extension` |
| Installer et tester le plugin Pi dans Pi | `npm run pi -w @acp-client/pi-extension` |
| Générer le VSIX depuis le workspace extension | `npm run vsx -w acp-client` |
| Régénérer le starter de workspace embarqué | `npm run sync:workspace-starter -w acp-client` |
| Tester la promotion Sandcastle Codex | `npm run sandcastle:smoke:codex -w acp-client` |
| Tester la promotion Sandcastle Cursor | `npm run sandcastle:smoke:cursor -w acp-client` |
| Régénérer les typings VS Code proposés | `npm run vscode:dts -w acp-client` |

## Conséquences

### Positives

- Les commandes courantes restent découvrables depuis la racine.
- Les responsabilités de chaque package sont explicites.
- Les alias inutiles sont évités, ce qui limite la dérive entre scripts racine et scripts de workspaces.
- Les builds consommateurs reconstruisent le pipeline partagé avant de l'utiliser.
- `npm run vsx` fonctionne depuis la racine tout en gardant la logique de packaging dans `plugin-vscode`.
- Le build VSIX évite le double build en laissant `vsce package` déclencher `vscode:prepublish`.

### Négatives

- Certaines commandes utiles restent plus longues car elles doivent passer par `-w`.
- Un changement dans `@acp-client/pipeline` peut impacter deux consommateurs, donc les tests VS Code et Pi doivent être pensés ensemble.
- `vsce package` masque une partie du flux parce que `vscode:prepublish` est lancé implicitement.

### Neutres

- `npm test` à la racine reste centré sur l'extension VS Code.
- Le plugin Pi garde sa validation dédiée via `npm run test:pi`.
- Les warnings webpack de taille de bundle webview ne bloquent pas le packaging VSIX.

## ADRs liés

- [ADR-0005 : Pipeline A2A ACP](0005-a2a-acp-pipeline.md)
- [ADR-0015 : Bootstrap du runtime d'extension et seam des sessions virtuelles](0015-runtime-extension-et-sessions-virtuelles.md)
- [ADR-0016 : Starter de workspace embarqué](0016-workspace-starter.md)
- [ADR-0018 : Pipeline v2 comme catalogue canonique d'orchestration](0018-pipeline-v2-catalogue-canonique.md)
- [ADR-0019 : Résolution partagée de `promptFile` pour les pipelines](0019-promptfile-pipeline-partage.md)
