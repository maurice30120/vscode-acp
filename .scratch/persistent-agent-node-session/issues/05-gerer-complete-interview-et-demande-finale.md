# 05 — Gérer complete-interview et la demande finale unique sur la même session

**What to build:** La Sortie d'entretien demande immédiatement l'artifact final au même agent connecté ; si l'artifact manque ou reste invalide, une seule demande normalisée est tentée avant échec.

**Blocked by:** 03 — Maintenir une AgentNodeSession pendant un Entretien agent multi-tour; 04 — Persister l'Historique ACP de nœud comme vérité de replay.

**Status:** ready-for-agent

- [ ] Une décision `complete-interview` utilise la session courante et n'ouvre pas une reconnexion normale.
- [ ] Après `complete-interview`, une nouvelle question agent est refusée comme violation de protocole.
- [ ] Seul un artifact final conforme à la déclaration de sortie peut terminer le nœud avec succès.
- [ ] Si la sortie finale attendue manque ou est invalide, le Runtime partagé envoie exactement une demande explicite de sortie finale normalisée.
- [ ] Une seconde absence ou invalidité échoue avec diagnostic structuré et fermeture de session.
