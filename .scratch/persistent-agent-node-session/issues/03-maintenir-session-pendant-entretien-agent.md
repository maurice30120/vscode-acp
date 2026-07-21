# 03 — Maintenir une AgentNodeSession pendant un Entretien agent multi-tour

**What to build:** Une question d'Entretien agent met le run en pause sans fermer la session ; une réponse utilisateur reprend le même nœud et réutilise la même connexion agent persistante.

**Blocked by:** 01 — Introduire le contrat AgentNodeSession dans le Runtime partagé.

**Status:** ready-for-agent

- [ ] Un Entretien agent ouvre une `AgentNodeSession` au démarrage logique du nœud.
- [ ] Une sortie `question` produit une pause persistée tout en gardant la session ouverte.
- [ ] Une décision `answer` reprend l'entretien sur la même session lorsque celle-ci est viable.
- [ ] Le temps d'attente utilisateur ne consomme pas le timeout d'appel agent.
- [ ] L'Activité agent temporaire peut être projetée sans devenir une sortie observable du nœud.
