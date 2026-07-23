# Plan — Extraction du Workspace ACP

## Problem

`acp-runtime` porte aujourd’hui deux responsabilités différentes : le moteur ACP bas niveau et la composition d’un workspace ACP depuis la Configuration workspace, les pipelines, les skills et Sandcastle. Cette confusion pousse `pipeline-cli`, `plugin-pi` et `plugin-vscode` à importer ou dupliquer de la logique de workspace, ce qui menace la Parité hôte.

Le travail consiste à introduire `acp-workspace` comme package public et stable du monorepo, puis à migrer les trois surfaces hôtes vers cette façade commune dans une seule livraison.

## Confirmed Decisions

1. `acp-workspace` est un package public et stable du monorepo dès ce plan.
2. `acp-workspace` possède toute la Configuration workspace : lecture, parsing, composition et écritures (`writeAgentConfigs`, `upsertAgentConfig`, `removeAgentConfig`).
3. `pipeline-cli`, `plugin-pi` et `plugin-vscode` migrent vers `acp-workspace` dans la première livraison.
4. `acp-workspace` devient la seule API autorisée pour charger et écrire la Configuration workspace.
5. Les exports déplacés sont supprimés directement de `@acp-client/runtime`, sans compatibilité dépréciée.
6. `acp-workspace` possède la Sélection de connecteur workspace entre ACP natif et Sandcastle.
7. `acp-runtime` redevient un moteur ACP bas niveau : il reçoit ses dépendances par injection et ne lit plus `.acp`, pipelines, skills, chemin workspace ou configuration Sandcastle.
8. `acp-sandcastle` conserve les responsabilités Sandcastle : bridge, providers, environnement, promotion, worktrees, logs, configuration Sandcastle et création du connecteur Sandcastle.
9. Les surfaces hôtes ne gardent que l’adaptation UI ou terminal : commandes, webviews, affichage, questions interactives, permission UI, télémétrie et traduction vers les contrats partagés.

## Implementation Shape

Créer le package racine `acp-workspace/` avec ses exports publics.

Y déplacer ou reconstruire les responsabilités suivantes :

- `AgentCatalog`
- `AgentConfigStore`
- `PipelineCatalog`
- `SkillCatalog`
- `VirtualAgentCatalog`
- `WorkspaceRuntime`
- `WorkspaceBackend`
- loaders/parsers ACP et Sandcastle
- opérations d’écriture de Configuration workspace
- composition du runner workspace
- Sélection de connecteur workspace ACP natif vs Sandcastle

Réduire `acp-runtime` aux primitives ACP bas niveau :

- client ACP
- processus agent
- handlers ACP
- connection manager
- permissions runtime
- sécurité et guards
- connecteur par défaut natif

Migrer `pipeline-cli`, `plugin-pi` et `plugin-vscode` pour consommer `acp-workspace` au lieu des loaders ou catalogues déplacés depuis `@acp-client/runtime` ou de leurs variantes locales.

## Unresolved Out-of-Scope Items

- Pas de changement de format pour `.acp/acp-agents.json`, `.acp/.sandcastle/config.json`, `.acp/pipelines/` ou `.acp/agents/`.
- Pas de nouveau protocole ACP.
- Pas de migration des requêtes inline VS Code vers un modèle workspace persistant.
- Pas de maintien d’une API de compatibilité dépréciée dans `@acp-client/runtime`.
- Pas de déplacement des responsabilités UI de CLI, Pi ou VS Code dans `acp-workspace`.

## Testing Seams

- Tests unitaires `acp-workspace` pour lecture, parsing, écriture et suppression de Configuration workspace.
- Tests de catalogues pour agents natifs, agents Sandcastle, pipelines et skills.
- Tests de sélection ACP natif vs Sandcastle à partir de configurations workspace représentatives.
- Tests de composition `WorkspaceRuntime` avec doubles de `WorkspaceRuntimeHost`, permission context, logger et promotion Sandcastle.
- Tests de non-régression qui échouent si `pipeline-cli`, `plugin-pi` ou `plugin-vscode` réimportent les loaders/catalogues workspace depuis `@acp-client/runtime`.
- Tests de parité hôte couvrant une même Configuration workspace sur CLI, Pi et VS Code.
- Tests `acp-runtime` vérifiant que le runtime bas niveau fonctionne avec dépendances injectées et sans accès direct au workspace.

## Documentation Updates

- `CONTEXT.md` définit `Workspace ACP` et `Sélection de connecteur workspace`.
- `docs/architecture/adr/0029-acp-workspace-public-composition-root.md` enregistre la décision architecturale.
- `.scratch/acp-workspace-extraction/plan.md` capture le plan approuvé.

## Next-Step Handoff Notes

1. Commencer par créer `acp-workspace/package.json`, son `tsconfig` et ses exports publics selon les conventions des packages racine existants.
2. Déplacer les fonctions pures de configuration depuis `plugin-vscode/src/config/AgentConfig.ts` avant de toucher aux surfaces hôtes.
3. Déplacer les catalogues workspace partagés depuis `acp-runtime`, `plugin-pi` et `plugin-vscode` vers `acp-workspace`.
4. Introduire la factory `createWorkspaceRuntime(workspaceCwd, host)` avec un contrat hôte minimal.
5. Migrer les trois surfaces hôtes dans le même chantier et supprimer les exports déplacés de `@acp-client/runtime`.
6. Finir par les tests de parité et les tests anti-régression d’imports directs.
