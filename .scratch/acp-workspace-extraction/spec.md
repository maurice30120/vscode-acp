# Extraction du Workspace ACP

## Problem Statement

`acp-runtime` porte aujourd'hui deux responsabilités différentes : exécuter le protocole ACP à bas niveau et composer un Workspace ACP depuis la Configuration workspace, les pipelines, les skills et Sandcastle.

Cette confusion rend la Parité hôte fragile. `pipeline-cli`, `plugin-pi` et `plugin-vscode` peuvent importer, réimplémenter ou diverger sur des loaders, catalogues et décisions de connecteur qui devraient être communs. Elle empêche aussi `acp-runtime` de rester un moteur ACP neutre, car il dépend directement de responsabilités workspace comme les pipelines, les skills et Sandcastle.

L'utilisateur veut récupérer ce travail sous forme d'une spécification actionnable pour extraire un package public `acp-workspace`, stabiliser la propriété de la Configuration workspace et migrer les trois surfaces hôtes ensemble.

## Solution

Créer un package public et stable `acp-workspace` dans le monorepo. Ce package devient la racine de composition du Workspace ACP pour toutes les surfaces hôtes.

`acp-workspace` prend en charge la lecture, le parsing, les catalogues, les écritures de Configuration workspace, la composition runtime workspace et la Sélection de connecteur workspace entre ACP natif et Sandcastle.

`acp-runtime` redevient un moteur ACP bas niveau. Il exécute un agent ACP avec des dépendances injectées, sans lire `.acp`, sans connaître les pipelines ou skills du workspace, sans connaître le chemin workspace et sans sélectionner Sandcastle directement.

`pipeline-cli`, `plugin-pi` et `plugin-vscode` migrent dans la même livraison vers `acp-workspace`. Les exports déplacés sont retirés directement de `@acp-client/runtime`, sans couche de compatibilité dépréciée.

`acp-sandcastle` conserve les responsabilités Sandcastle : bridge, providers, environnement, promotion, worktrees, logs, configuration Sandcastle et création du connecteur Sandcastle.

Les surfaces hôtes ne gardent que l'adaptation propre à leur interface : commandes, affichage, webviews, questions interactives, permission UI, télémétrie et traduction vers les contrats partagés.

## User Stories

1. As a CLI user, I want `pipeline-cli` to load agents, pipelines and skills through the shared Workspace ACP, so that CLI behavior matches the other host surfaces.
2. As a Pi user, I want `plugin-pi` to load agents, pipelines and skills through the shared Workspace ACP, so that Pi behavior matches CLI and VS Code.
3. As a VS Code user, I want `plugin-vscode` to load agents, pipelines and skills through the shared Workspace ACP, so that editor behavior matches CLI and Pi.
4. As a workspace user, I want a single Configuration workspace source of truth, so that I do not have to reason about host-specific configuration semantics.
5. As a workspace user, I want native ACP agents and Sandcastle agents to be discovered consistently, so that the same agent name resolves the same way on every surface hôte.
6. As a workspace user, I want duplicate or ambiguous agent declarations to be handled consistently, so that no host silently chooses a different connector.
7. As a workspace user, I want pipelines to resolve configured agents consistently, so that a Pipeline V3 run is portable between CLI, Pi and VS Code.
8. As a workspace user, I want skills to be catalogued consistently, so that skills available to agents do not depend on the host surface.
9. As a workspace user, I want `.acp/acp-agents.json` to keep its current format, so that existing native ACP configuration files remain valid.
10. As a workspace user, I want `.acp/.sandcastle/config.json` to keep its current format, so that existing Sandcastle configuration files remain valid.
11. As a workspace user, I want `.acp/pipelines/` to keep its current format, so that existing pipeline definitions remain valid.
12. As a workspace user, I want `.acp/agents/` to keep its current format, so that existing agent-local configuration remains valid.
13. As a VS Code user, I want agent configuration writes to use the same store as the other hosts, so that adding, updating or removing agents preserves shared workspace semantics.
14. As a VS Code user, I want `writeAgentConfigs` behavior to preserve native and Sandcastle configuration separation, so that edits do not corrupt either configuration file.
15. As a VS Code user, I want `upsertAgentConfig` to write through `acp-workspace`, so that command handlers do not own workspace model rules.
16. As a VS Code user, I want `removeAgentConfig` to write through `acp-workspace`, so that deletion rules are shared and testable outside VS Code.
17. As a CLI user, I want terminal prompts and promotion questions to stay in the CLI, so that the common Workspace ACP does not own terminal UI.
18. As a VS Code user, I want QuickPick, commands, webviews and status UI to stay in VS Code, so that editor-specific UX remains native.
19. As a Pi user, I want Pi commands and permission presentation to stay in Pi, so that Pi-specific interaction remains native.
20. As a pipeline author, I want Sandcastle promotion policy to be read consistently, so that `ask`, `autoApply` and `autoReject` mean the same thing across host surfaces.
21. As a pipeline author, I want a Sandcastle pipeline step to use the Sandcastle connector through shared workspace selection, so that hosts do not duplicate Sandcastle routing.
22. As a pipeline author, I want a native ACP pipeline step to use the native connector through shared workspace selection, so that Sandcastle support does not change native behavior.
23. As an extension maintainer, I want `acp-workspace` to expose stable public exports, so that host packages have one supported dependency for workspace composition.
24. As an extension maintainer, I want moved workspace exports removed from `@acp-client/runtime`, so that new code cannot keep depending on the wrong package.
25. As an extension maintainer, I want no deprecated compatibility layer in `@acp-client/runtime`, so that ownership of workspace behavior is unambiguous.
26. As an extension maintainer, I want `acp-runtime` to receive connectors, permission context and logging through injection, so that it can be tested as a low-level ACP engine.
27. As an extension maintainer, I want `acp-runtime` not to read `.acp`, so that workspace file semantics live only in `acp-workspace`.
28. As an extension maintainer, I want `acp-runtime` not to import pipeline or skill catalogs, so that the runtime is not coupled to workspace orchestration.
29. As an extension maintainer, I want `acp-runtime` not to import Sandcastle selection logic, so that Sandcastle routing stays at the workspace composition layer.
30. As an extension maintainer, I want `acp-sandcastle` to keep connector creation and Sandcastle lifecycle primitives, so that Sandcastle-specific code remains isolated.
31. As an extension maintainer, I want `acp-workspace` to compose `WorkspaceRuntime` from injected host dependencies, so that hosts provide UI decisions without owning orchestration rules.
32. As an extension maintainer, I want one shared `WorkspaceRuntimeHost` contract, so that CLI, Pi and VS Code differ only where their interfaces differ.
33. As an extension maintainer, I want import regressions to fail tests, so that workspace loaders and catalogues do not drift back into `@acp-client/runtime` consumers.
34. As a test author, I want to test Configuration workspace behavior through `acp-workspace`, so that tests cover the highest public seam.
35. As a test author, I want to test host parity with the same representative Configuration workspace, so that observable behavior remains aligned across CLI, Pi and VS Code.
36. As a release owner, I want the host migrations delivered atomically, so that there is no supported intermediate state where only one host uses the new workspace package.
37. As a release owner, I want build and workspace metadata updated for `acp-workspace`, so that package consumers can import it through normal monorepo conventions.
38. As a future contributor, I want the ADR and glossary to explain why `acp-workspace` owns composition, so that the package boundary is understandable without archaeology.

## Implementation Decisions

- Add a new root package named `acp-workspace` and expose it as a public, stable monorepo package.
- Add `acp-workspace` to the root workspace configuration and align its package metadata, TypeScript configuration, build script and test script with existing root packages.
- Make `acp-workspace` the only authorized API for loading and writing Configuration workspace.
- Move or reconstruct the workspace catalog responsibilities in `acp-workspace`: agent catalog, agent config store, pipeline catalog, skill catalog and virtual agent catalog.
- Move or reconstruct the workspace loaders and parsers in `acp-workspace`: ACP agent configuration, Sandcastle configuration, pipeline discovery and skill discovery.
- Move the Configuration workspace write operations into `acp-workspace`: `writeAgentConfigs`, `upsertAgentConfig` and `removeAgentConfig`.
- Preserve the existing Configuration workspace file formats. The implementation must not introduce format changes for `.acp/acp-agents.json`, `.acp/.sandcastle/config.json`, `.acp/pipelines/` or `.acp/agents/`.
- Add a Workspace ACP runtime composition API that creates a workspace-level runtime from `workspaceCwd` plus host-provided dependencies.
- Introduce a minimal host contract for workspace composition. The host supplies permission context, logging, Sandcastle promotion decisions and any other interface-specific callbacks needed by runtime composition.
- Keep terminal prompts, VS Code UI, Pi UI, telemetry and command registration outside `acp-workspace`.
- Put the Sélection de connecteur workspace inside `acp-workspace`. The package decides whether a configured agent uses the native ACP connector or a Sandcastle connector.
- Keep Sandcastle bridge, providers, environment, promotion, worktrees, logs, Sandcastle configuration types and Sandcastle connector creation in `acp-sandcastle`.
- Let `acp-workspace` depend on `acp-runtime`, `acp-pipeline` and `acp-sandcastle` as needed to compose a Workspace ACP.
- Reduce `acp-runtime` to low-level ACP engine responsibilities: ACP client, agent process management, handlers, connection manager, permission runtime, security, guards and the default native connector.
- Remove direct workspace responsibilities from `acp-runtime`. It must not read `.acp`, load pipelines, load skills, know the workspace path or select Sandcastle directly.
- Change `acp-runtime` APIs so the low-level runtime receives dependencies by injection rather than discovering workspace state itself.
- Remove moved workspace exports from `@acp-client/runtime` directly, with no deprecated compatibility exports.
- Migrate `pipeline-cli` to consume `acp-workspace` for workspace loading, catalogues, runtime composition and Sandcastle selection.
- Migrate `plugin-pi` to consume `acp-workspace` for workspace loading, catalogues, runtime composition and Sandcastle selection.
- Migrate `plugin-vscode` to consume `acp-workspace` for workspace loading, catalogues, runtime composition, Configuration workspace writes and Sandcastle selection.
- Keep any host-specific adapter contracts local when they represent terminal, editor or Pi concerns rather than workspace model concerns.
- Deliver the three host migrations in the same implementation effort. A partial host migration is not an accepted final state.
- Preserve Pipeline V3 semantics. `acp-workspace` composes pipeline execution dependencies but does not change the pipeline language or introduce a new ACP protocol.
- Do not migrate VS Code inline ephemeral requests to persistent Workspace ACP execution in this feature.
- Do not move UI ownership into `acp-workspace`.

## Testing Decisions

- Tests must target observable behavior through the highest practical public seam, with `acp-workspace` as the preferred seam for workspace model behavior.
- Add focused `acp-workspace` unit tests for reading, parsing, writing, upserting and removing Configuration workspace entries.
- Add `acp-workspace` catalog tests for native agents, Sandcastle agents, pipelines, skills and virtual agents.
- Add selection tests proving that representative native ACP and Sandcastle configurations resolve to the expected effective connector without host-specific branching.
- Add `WorkspaceRuntime` composition tests using doubles for the host contract, permission context, logger and Sandcastle promotion callbacks.
- Add non-regression tests or static import checks that fail if `pipeline-cli`, `plugin-pi` or `plugin-vscode` import moved workspace loaders or catalogues from `@acp-client/runtime`.
- Add non-regression tests or static import checks that fail if `acp-runtime` imports workspace catalogues, pipeline catalogues, skill catalogues or Sandcastle selection logic.
- Add host parity tests using the same representative Configuration workspace across CLI, Pi and VS Code. These tests should assert shared observable behavior and ignore UI-specific presentation.
- Add `acp-runtime` tests proving low-level ACP execution works with injected dependencies and without direct workspace file access.
- Reuse existing package-level Node test patterns where possible, including the existing monorepo build and test scripts.
- Prior art for these tests includes current catalog/config tests in runtime and host packages, existing Sandcastle routing tests, package-level `node --test` suites and CLI/PI/VS Code integration seams already present in the repo.
- Do not write tests that assert private file layout inside `acp-workspace` when the same behavior can be asserted through its public exports.

## Out of Scope

- Changing the format of `.acp/acp-agents.json`.
- Changing the format of `.acp/.sandcastle/config.json`.
- Changing the format of `.acp/pipelines/`.
- Changing the format of `.acp/agents/`.
- Introducing a new ACP protocol.
- Changing Pipeline V3 language semantics.
- Migrating VS Code inline ephemeral requests to a persistent workspace runtime model.
- Keeping deprecated compatibility exports in `@acp-client/runtime`.
- Moving CLI terminal UI into `acp-workspace`.
- Moving VS Code commands, webviews, tree views, status UI, telemetry or dialogs into `acp-workspace`.
- Moving Pi UI, commands or permission presentation into `acp-workspace`.
- Replacing Sandcastle bridge, provider, worktree, promotion or log internals beyond what is needed for the workspace connector selection boundary.
- Shipping a final state where only one or two host surfaces have migrated to `acp-workspace`.

## Further Notes

- Triage label: `ready-for-agent`.
- The approved feature slug is `acp-workspace-extraction`.
- ADR-0029 records the architectural decision that `acp-workspace` is the public composition root.
- `CONTEXT.md` already defines `Workspace ACP` and `Sélection de connecteur workspace`; no additional domain glossary update is required by this specification.
- Recommended implementation order is to create the package skeleton first, move pure Configuration workspace functions next, then migrate catalogues and runtime composition, then update all three surfaces, and finish with parity and import-regression tests.

## Documentation

- Created `.scratch/acp-workspace-extraction/spec.md`.
- Reused `.scratch/acp-workspace-extraction/plan.md`.
- Referenced `CONTEXT.md`.
- Referenced `docs/architecture/adr/0029-acp-workspace-public-composition-root.md`.
- Referenced `docs/agents/issue-tracker.md`.
- Referenced `docs/agents/domain.md`.
