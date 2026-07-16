# ADR-0017 : Monorepo npm workspaces

**Statut** : Accepté

## Contexte

Le dépôt regroupe plusieurs surfaces qui évoluent ensemble : l'extension VS Code, le moteur pipeline partagé et le plugin Pi. Ces parties ont des dépendances et des cycles de build différents, mais elles doivent rester cohérentes car l'extension consomme le pipeline partagé et le plugin Pi réutilise le même modèle d'orchestration.

Le dépôt utilise donc un monorepo npm avec trois workspaces déclarés dans le `package.json` racine.

## Décision

1. **Conserver la racine comme point d'entrée pour les commandes transverses.**
   - La racine ne porte pas de code applicatif.
   - Elle expose les commandes usuelles qui ciblent le workspace principal `acp-client`.
   - Les commandes spécifiques à un package restent dans le `package.json` de ce package.

2. **Séparer les responsabilités par workspace.**

| Workspace | Package npm | Rôle |
|-----------|-------------|------|
| `plugin-vscode` | `acp-client` | Extension VS Code, UI, runtime ACP, orchestration utilisateur et packaging VSIX. |
| `acp-pipeline` | `@acp-client/pipeline` | Bibliothèque partagée du moteur pipeline, équipes d'agents et orchestration LangGraph. |
| `plugin-pi` | `@acp-client/pi-extension` | Extension Pi autonome, commandes Pi et intégration du moteur pipeline côté Pi. |

3. **Compiler le pipeline avant les consommateurs.**
   - `plugin-vscode` lance `npm run build -w @acp-client/pipeline` avant `compile`, `watch`, `package` et `compile-tests`.
   - `plugin-pi` dépend de `@acp-client/pipeline` via `file:../acp-pipeline`.
   - Le code généré de `acp-pipeline/dist` est donc l'interface consommée par les autres workspaces.

4. **Garder une liste courte de scripts canoniques.**
   - Les scripts racine sont des raccourcis de développement et de CI.
   - Les scripts non référencés ou trop spécifiques ne doivent pas être dupliqués à la racine.
   - Quand une commande ne concerne qu'un package, utiliser `npm run <script> -w <workspace>`.

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

### Négatives

- Certaines commandes utiles restent plus longues car elles doivent passer par `-w`.
- Un changement dans `@acp-client/pipeline` peut impacter deux consommateurs, donc les tests VS Code et Pi doivent être pensés ensemble.

### Neutres

- `npm test` à la racine reste centré sur l'extension VS Code.
- Le plugin Pi garde sa validation dédiée via `npm run test:pi`.

## ADRs liés

- [ADR-0005 : Pipeline A2A ACP](0005-a2a-acp-pipeline.md)
- [ADR-0012 : Équipes d'agents](0012-equipes-agents.md)
- [ADR-0015 : Bootstrap du runtime d'extension et seam des sessions virtuelles](0015-runtime-extension-et-sessions-virtuelles.md)
- [ADR-0016 : Starter de workspace embarqué](0016-workspace-starter.md)
