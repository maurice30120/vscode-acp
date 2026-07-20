# 07 — Créer les checkpoints d’intégration qui débloquent les dépendances

**Identifier:** T07

**What to build:** Produire une branche et un commit de checkpoint après chaque groupe de dépendances intégré, afin que les tickets dépendants commencent toujours depuis un état réconcilié et traçable.

**Blocked by:** 05 — Exécuter un implémenteur isolé par ticket prêt.

**Status:** ready-for-agent

**Owned paths:** `acp-pipeline/**`, couche Git partagée avec `acp-sandcastle/**`.

**Shared paths:** adapters d’exécution Pi et VS Code.

- [ ] Le runtime capture la branche active et son SHA au démarrage sans supposer `main`.
- [ ] Les noms de branches et checkpoints sont déterministes à partir du run, du niveau du DAG et du cycle d’intégration.
- [ ] Un checkpoint référence les tickets intégrés, leurs branches source, leurs commits source et son propre SHA.
- [ ] Un ticket dépendant ne passe à ready que lorsqu’un checkpoint contient tous ses bloqueurs.
- [ ] La branche de départ transmise au ticket correspond exactement au checkpoint déclaré dans le snapshot.
- [ ] Les checkpoints intermédiaires restent inspectables après un échec, une annulation ou une interruption.
- [ ] Un checkpoint incohérent avec Git est refusé avant tout nouveau lancement d’agent.
- [ ] Les événements `checkpoint-started`, `checkpoint-created` et `checkpoint-failed` sont persistés.

**Validation command:** `npm run test -w @acp-client/pipeline && npm run test -w @acp-client/sandcastle`

**Public seam exercised:** état de dépendances et checkpoints exposés par `PipelineRuntime.inspect()`.
