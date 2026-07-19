# 08 — Résoudre les skills explicites de manière déterministe

**What to build:** Garantir qu’un nœud reçoit exactement les skills qu’il déclare, y compris les skills réservés à une invocation explicite, avec la même sémantique dans Pi et VS Code.

**Blocked by:** 02 — Exécuter un pipeline linéaire via le nouveau PipelineRuntime.

**Status:** ready-for-agent

- [ ] La résolution explicite et la découverte automatique sont deux opérations distinctes du même Module.
- [ ] Un skill déclaré par un nœud est injecté même s’il porte `disable-model-invocation: true`.
- [ ] Le même skill reste exclu de la découverte automatique du modèle.
- [ ] Un skill absent, invalide ou désactivé au niveau de l’agent bloque le nœud avant exécution avec une erreur claire.
- [ ] L’ordre de résolution et le rendu du catalogue sont déterministes sur Windows, macOS et Linux.
- [ ] Pi et VS Code consomment la même résolution, sans dupliquer des règles contradictoires dans leurs prompt adapters.
- [ ] Les skills `grill-me`, `to-spec`, `to-tickets`, `implement`, `tdd` et `code-review` sont couverts par des tests de sélection explicite.