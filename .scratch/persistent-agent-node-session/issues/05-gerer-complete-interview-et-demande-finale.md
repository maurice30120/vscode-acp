# 05 — Gérer complete-interview et la demande finale unique sur la même session

**What to build:** La Sortie d'entretien demande immédiatement l'artifact final au même agent connecté ; si l'artifact manque ou reste invalide, une seule demande normalisée est tentée avant échec.

**Blocked by:** 03 — Maintenir une AgentNodeSession pendant un Entretien agent multi-tour; 04 — Persister l'Historique ACP de nœud comme vérité de replay.

**Status:** resolved

- [x] Une décision `complete-interview` utilise la session courante et n'ouvre pas une reconnexion normale.
- [x] Après `complete-interview`, une nouvelle question agent est refusée comme violation de protocole.
- [x] Seul un artifact final conforme à la déclaration de sortie peut terminer le nœud avec succès.
- [x] Si la sortie finale attendue manque ou est invalide, le Runtime partagé envoie exactement une demande explicite de sortie finale normalisée.
- [x] Une seconde absence ou invalidité échoue avec diagnostic structuré et fermeture de session.

## Comments

- Implémenté dans `PipelineRuntime`: après `complete-interview`, le runtime réutilise la session d'entretien active, demande au plus une sortie finale normalisée, puis échoue avec `malformed_interview_output` en fermant la session si la réponse reste invalide.
- Couvert par `PipelineRuntime.test.ts` sur le seam public `start`/`resume`.
