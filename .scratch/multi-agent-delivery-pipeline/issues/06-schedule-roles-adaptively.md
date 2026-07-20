# 06 — Planifier les rôles avec une concurrence adaptative

**Identifier:** T06

**What to build:** Permettre au runtime d’exécuter plusieurs implémenteurs et mergeurs en parallèle sans dépasser les plafonds configurés, tout en respectant le DAG, les ressources disponibles et les surcharges d’agent propres aux tickets.

**Blocked by:** 04 — Compiler le graphe de tickets approuvé en sous-DAG exécutable; 05 — Exécuter un implémenteur isolé par ticket prêt.

**Status:** ready-for-agent

**Owned paths:** `acp-pipeline/**`

**Shared paths:** catalogues d’agents et configuration Sandcastle des deux hôtes.

- [ ] La configuration supporte `adaptive`, `maxTotal` et des plafonds distincts pour implementer, merger et verifier.
- [ ] Les valeurs par rôle définissent agent, modèle, effort/thinking, sandbox, image et politique ; un ticket peut surcharger les valeurs d’implémentation.
- [ ] Le scheduler n’exécute que les tickets appartenant à la frontière calculée.
- [ ] Le nombre total de rôles actifs et le nombre par rôle ne dépassent jamais les plafonds.
- [ ] Le mode adaptatif peut réduire la concurrence selon les ressources observables et les conteneurs déjà actifs, mais ne change jamais les dépendances du DAG.
- [ ] Le vérificateur reste limité à une exécution active par run.
- [ ] Une annulation empêche tout nouveau lancement et propage l’annulation aux rôles actifs dans la mesure permise par leur adapter.
- [ ] Les décisions du scheduler sont enregistrées dans le journal avec la cause d’un lancement différé.

**Validation command:** `npm run test -w @acp-client/pipeline`

**Public seam exercised:** progression observable d’un run via `PipelineRuntime.inspect()` et les événements de scheduling.
