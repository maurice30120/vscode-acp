# 11 — Migrer VS Code vers PipelineRuntime et la DSL v3

**What to build:** Permettre à l’utilisateur VS Code d’exécuter les mêmes pipelines v3 que Pi avec le même cycle de vie métier, tout en conservant les projections chat et sessions virtuelles propres à l’extension.

**Blocked by:** 03 — Supporter les pauses génériques et les reprises multiples; 05 — Orchestrer le DAG en parallèle avec retries et fail-fast; 09 — Charger et découvrir uniquement les pipelines v3.

**Status:** ready-for-agent

- [ ] L’orchestration VS Code consomme uniquement l’Interface `PipelineRuntime` et ne reconstruit pas une machine d’état parallèle.
- [ ] Les résultats `paused`, `completed`, `rejected`, `cancelled` et `failed` sont projetés dans les sessions virtuelles et le chat existants.
- [ ] Les pauses `approval`, `question` et `promotion` restent reprenables dans la même session virtuelle.
- [ ] Le scénario à deux approbations produit la même séquence métier que dans Pi.
- [ ] Les artefacts typés sont présentés de façon lisible sans exposer les objets LangGraph ou le programme compilé.
- [ ] Les événements de streaming continuent d’alimenter l’UI sans déterminer la conservation de la session.
- [ ] Les tests VS Code utilisent des fakes du runtime et vérifient la projection observable, le statut et le nettoyage de session.