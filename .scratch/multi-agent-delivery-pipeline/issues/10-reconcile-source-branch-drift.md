# 10 — Réconcilier la dérive de la branche source avant vérification

**Identifier:** T10

**What to build:** Détecter les nouveaux commits arrivés sur la branche source pendant le run et appliquer la politique `freeze`, `integrate` ou `abort` avant de construire le bundle de vérification final.

**Blocked by:** 08 — Intégrer adaptativement les groupes avec des agents de merge; 09 — Exécuter les validations de checkpoint et attribuer les échecs.

**Status:** ready-for-agent

**Owned paths:** `acp-pipeline/**`, couche Git partagée avec `acp-sandcastle/**`.

**Shared paths:** configuration de pipeline et affichage de statut dans les deux hôtes.

- [ ] Le run conserve la branche source, le SHA initial et le SHA courant observé.
- [ ] La politique `freeze` poursuit avec le SHA initial et rend la divergence visible dans le snapshot.
- [ ] La politique `abort` produit un échec métier explicite avant la vérification finale.
- [ ] La politique `integrate`, valeur par défaut, confie les nouveaux commits à l’agent de merge puis relance les validations déterministes.
- [ ] Les conflits avec la dérive source suivent les mêmes règles de résolution, classification et traçabilité que les autres merges.
- [ ] Le bundle de vérification référence le SHA source effectivement intégré, pas seulement le SHA capturé au démarrage.
- [ ] La branche cible finale reste la branche source capturée, sauf configuration explicite contraire.
- [ ] Aucun chemin de code ne suppose implicitement `main` ou `master`.

**Validation command:** `npm run test -w @acp-client/pipeline && npm run test -w @acp-client/sandcastle`

**Public seam exercised:** état de source et résultat de réconciliation exposés par `PipelineRuntime.inspect()`.
