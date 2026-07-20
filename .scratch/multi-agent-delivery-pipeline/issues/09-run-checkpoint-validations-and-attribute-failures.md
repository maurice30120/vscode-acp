# 09 — Exécuter les validations de checkpoint et attribuer les échecs

**Identifier:** T09

**What to build:** Résoudre et exécuter les validations déterministes après chaque checkpoint, puis classifier les échecs pour décider si le mergeur corrige, si un implémenteur reprend son ticket ou si `toTicket` doit créer une réparation transversale.

**Blocked by:** 07 — Créer les checkpoints d’intégration qui débloquent les dépendances; 08 — Intégrer adaptativement les groupes avec des agents de merge.

**Status:** ready-for-agent

**Owned paths:** `acp-pipeline/**`

**Shared paths:** scripts de validation et métadonnées de package du workspace.

- [ ] Le plan de validation combine les commandes du ticket, celles du pipeline et celles détectées automatiquement, puis les normalise et les déduplique.
- [ ] Une liste d’exclusion permet de supprimer explicitement une commande détectée ou héritée.
- [ ] Chaque résultat conserve la commande, son origine, le checkpoint, le code de sortie et un résumé borné des sorties.
- [ ] Les validations s’exécutent après chaque checkpoint avant de débloquer les tickets dépendants.
- [ ] Un échec dû à un conflit ou à l’assemblage est attribué au mergeur.
- [ ] Un échec localisable à un ticket est attribué à son implémenteur d’origine avec les preuves nécessaires.
- [ ] Un échec transversal ou incertain produit une demande structurée destinée à `toTicket`.
- [ ] La classification des corrections du mergeur est vérifiée par des règles minimales ; une sous-évaluation ou une ambiguïté déclenche un triage indépendant en lecture seule.
- [ ] Une correction mécanique exige les validations déterministes, une adaptation limitée est couverte par la vérification finale, et une adaptation architecturale déclenche une mini-vérification dédiée.

**Validation command:** `npm run test -w @acp-client/pipeline`

**Public seam exercised:** plan et résultats de validation présents dans le snapshot et les événements du `PipelineRuntime`.
