# 05 — Exécuter un implémenteur isolé par ticket prêt

**Identifier:** T05

**What to build:** Lancer un agent d’implémentation distinct pour chaque ticket de la frontière, dans un sandbox, un worktree et une branche dédiés, puis retourner une preuve structurée sans promouvoir directement les changements.

**Blocked by:** 04 — Compiler le graphe de tickets approuvé en sous-DAG exécutable.

**Status:** ready-for-agent

**Owned paths:** `acp-pipeline/**`, `acp-sandcastle/**`

**Shared paths:** adapters Sandcastle de `plugin-pi` et `plugin-vscode`.

- [ ] Chaque ticket prêt reçoit une branche déterministe et un worktree isolé dérivés de son checkpoint de départ.
- [ ] Un implémenteur ne peut jamais appeler la promotion finale du sandbox vers le workspace source.
- [ ] La fin d’exécution conserve la branche et les commits même lorsque l’agent échoue après avoir produit du code exploitable.
- [ ] Le résultat d’implémentation contient les commits, les modifications dans le périmètre principal, les zones partagées, les modifications hors périmètre, les validations, les limitations connues et les notes d’intégration.
- [ ] Les modifications hors périmètre non déclarées sont détectées par comparaison avec le diff réel et signalées au mergeur.
- [ ] Les commandes de validation propres au ticket peuvent être exécutées dans le sandbox et leurs résultats sont enregistrés sans être considérés comme une preuve suffisante pour l’intégration finale.
- [ ] Un ticket dependent ne peut pas choisir une branche d’implémenteur comme base ; il attend un checkpoint intégré.
- [ ] Les sessions résumables peuvent être capturées lorsque le provider le supporte.

**Validation command:** `npm run test -w @acp-client/pipeline && npm run test -w @acp-client/sandcastle`

**Public seam exercised:** exécution d’un ticket via `PipelineAgentRunner` retournant un `ImplementationResultArtifact`.
