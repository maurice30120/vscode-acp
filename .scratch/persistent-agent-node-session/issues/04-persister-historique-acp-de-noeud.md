# 04 — Persister l'Historique ACP de nœud comme vérité de replay

**What to build:** Chaque échange significatif d'Entretien agent enrichit un Historique ACP de nœud structuré, durable et inspectable, qui reste la seule vérité de replay.

**Blocked by:** 03 — Maintenir une AgentNodeSession pendant un Entretien agent multi-tour.

**Status:** ready-for-agent

- [ ] Le snapshot conserve le prompt d'origine, le protocole d'entretien, les tours structurés agent/utilisateur et l'intention éventuelle de Sortie d'entretien.
- [ ] L'historique est persisté après chaque question agent, réponse utilisateur, demande de conclusion et sortie structurée significative.
- [ ] Les logs, stderr, chunks progressifs, sorties de debug et diagnostics ne sont jamais inclus dans les tours de replay.
- [ ] Un snapshot d'entretien peut être inspecté et chargé sans connexion ACP vivante.
