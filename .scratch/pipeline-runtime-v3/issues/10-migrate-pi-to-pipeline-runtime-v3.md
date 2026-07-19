# 10 — Migrer Pi vers PipelineRuntime et la DSL v3

**What to build:** Permettre à l’utilisateur Pi d’exécuter, inspecter, reprendre, rejeter et annuler les pipelines v3 en pilotant entièrement l’UI depuis les résultats discriminés du runtime.

**Blocked by:** 03 — Supporter les pauses génériques et les reprises multiples; 05 — Orchestrer le DAG en parallèle avec retries et fail-fast; 09 — Charger et découvrir uniquement les pipelines v3.

**Status:** ready-for-agent

- [ ] Les commandes Pi utilisent uniquement démarrer, reprendre, annuler et inspecter du nouveau runtime.
- [ ] La session active, le heartbeat et les notifications sont conservés ou libérés uniquement selon le résultat retourné.
- [ ] Les pauses `approval`, `question` et `promotion` sont projetées dans les interactions Pi sans supposer un plan XML universel.
- [ ] Le scénario à deux approbations reste actif après la première reprise et se termine uniquement après la seconde.
- [ ] Une reprise obsolète, un rejet, une annulation et un échec fail-fast produisent des messages cohérents et ne laissent aucun état actif fantôme.
- [ ] Les événements servent seulement aux mises à jour progressives et ne participent plus aux décisions de cycle de vie.
- [ ] Les tests Pi couvrent le même scénario de référence que les tests directs du runtime.