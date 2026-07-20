# 08 — Intégrer adaptativement les groupes avec des agents de merge

**Identifier:** T08

**What to build:** Regrouper les branches de tickets selon leurs dépendances et leurs risques de collision, puis confier leur intégration à un ou plusieurs mergeurs capables de résoudre tous les conflits et de produire une branche d’intégration unique.

**Blocked by:** 06 — Planifier les rôles avec une concurrence adaptative; 07 — Créer les checkpoints d’intégration qui débloquent les dépendances.

**Status:** ready-for-agent

**Owned paths:** `acp-pipeline/**`, `acp-sandcastle/**`

**Shared paths:** configuration des agents de merge dans `plugin-pi/.acp/**` et les ressources embarquées VS Code.

- [ ] Le moteur calcule les groupes d’intégration à partir du DAG, des périmètres déclarés, des zones partagées, des fichiers réellement modifiés et des notes d’intégration.
- [ ] Les groupes indépendants peuvent être fusionnés en parallèle lorsque les plafonds du scheduler le permettent.
- [ ] Un mergeur final réconcilie les groupes intermédiaires et produit une branche d’intégration unique.
- [ ] Le mergeur respecte les dépendances obligatoires et choisit l’ordre des branches indépendantes.
- [ ] Le mergeur résout les conflits Git et peut adapter le code d’intégration sans réimplémenter silencieusement un ticket complet.
- [ ] La stratégie Git est configurable entre `squash`, `merge` et `cherry-pick`, avec `squash` par défaut.
- [ ] La traçabilité associe chaque ticket à ses commits source et à son commit d’intégration.
- [ ] Le résultat de merge décrit les conflits, les adaptations, les tickets affectés et une classification proposée `mechanical`, `limited` ou `architectural`.
- [ ] Une branche partiellement intégrée reste conservée lorsqu’un mergeur échoue.

**Validation command:** `npm run test -w @acp-client/pipeline && npm run test -w @acp-client/sandcastle`

**Public seam exercised:** orchestration d’intégration produisant un `MergeResultArtifact` et un checkpoint Git inspectable.
