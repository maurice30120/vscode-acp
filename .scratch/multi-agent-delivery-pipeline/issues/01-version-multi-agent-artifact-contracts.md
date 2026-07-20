# 01 — Versionner et valider les contrats d’artefacts multi-agents

**Identifier:** T01

**What to build:** Permettre au runtime de recevoir les sorties de `grill-me`, `toSpec`, `toTicket`, des implémenteurs, des mergeurs et du vérificateur sous forme d’artefacts structurés, versionnés et validés, avec une correction de format bornée qui reprend la même session sans rejouer le travail.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

**Owned paths:** `acp-pipeline/**`

**Shared paths:** exports publics du workspace et types communs consommés par `plugin-pi` et `plugin-vscode`.

- [ ] Les contrats `acp.grill-decision/v1`, `acp.specification/v1`, `acp.ticket-graph/v1`, `acp.implementation-result/v1`, `acp.merge-result/v1` et `acp.verification-report/v1` disposent d’un modèle TypeScript et d’une validation runtime.
- [ ] Une version inconnue ou un payload invalide produit une erreur métier localisée par contrat et champ.
- [ ] Le runtime peut demander à un provider résumable de corriger uniquement le format de sa sortie, avec un nombre de tentatives borné.
- [ ] Une correction réussie publie exactement le même type d’artefact qu’une sortie valide au premier essai.
- [ ] Après épuisement des tentatives, la branche, la session, la sortie brute et les diagnostics restent inspectables dans le snapshot.
- [ ] Les contrats restent indépendants de Pi, de VS Code, de LangGraph et des types internes de `@ai-hero/sandcastle`.

**Validation command:** `npm run test -w @acp-client/pipeline`

**Public seam exercised:** validation et publication d’un `PipelineArtifact` par `PipelineRuntime`.
