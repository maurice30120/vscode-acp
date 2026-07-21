# 11 — Ajouter la suite de contrat de Parité hôte

**What to build:** Une même suite de contrat vérifie les comportements observables `AgentNodeSession` sur CLI, Pi et VS Code afin d'empêcher le drift entre Surfaces hôtes.

**Blocked by:** 09 — Migrer les Adapters hôtes CLI, Pi et VS Code vers la fabrique AgentNodeSession; 10 — Aligner Sandcastle sur la borne AgentNodeSession.

**Status:** ready-for-agent

- [ ] La suite de contrat couvre ouverture, échange multi-tour, Activité agent temporaire, annulation et fermeture.
- [ ] La suite couvre rupture de transport, classification, replay d'entretien et absence de second `node_started`.
- [ ] La suite vérifie que les politiques, retries et règles de fermeture ne divergent pas entre Surfaces hôtes.
- [ ] Les tests conduisent le Runtime partagé par son API publique plutôt que par des détails de transport.
