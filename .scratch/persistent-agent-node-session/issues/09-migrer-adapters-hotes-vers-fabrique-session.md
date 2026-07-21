# 09 — Migrer les Adapters hôtes CLI, Pi et VS Code vers la fabrique AgentNodeSession

**What to build:** Les trois Surfaces hôtes utilisent le même contrat public `AgentNodeSession` et ne portent pas de logique métier propre ; VS Code InlineEdit reste sur sa Requête inline éphémère.

**Blocked by:** 02 — Exécuter un nœud agent non interactif via AgentNodeSession; 03 — Maintenir une AgentNodeSession pendant un Entretien agent multi-tour; 05 — Gérer complete-interview et la demande finale unique sur la même session; 06 — Fermer les sessions sur annulation, rejet et états terminaux; 07 — Rejouer un Entretien agent après rupture de transport.

**Status:** ready-for-agent

- [ ] CLI fournit une fabrique `AgentNodeSession` au Runtime partagé et traduit ses interactions utilisateur vers les décisions normalisées.
- [ ] Pi fournit la même fabrique et conserve une couche d'Adapter hôte sans machine à états pipeline locale.
- [ ] VS Code fournit la même fabrique pour Pipeline V3 et conserve InlineEdit sur une Requête inline éphémère.
- [ ] Les trois Surfaces hôtes gardent la même sémantique pour transitions, artifacts, retries et règles de fermeture.
- [ ] Aucun feature flag durable ni fallback silencieux ne maintient deux chemins Pipeline V3 concurrents.
