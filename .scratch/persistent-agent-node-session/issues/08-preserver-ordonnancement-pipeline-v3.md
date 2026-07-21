# 08 — Préserver l'ordonnancement Pipeline V3 avec sessions persistantes

**What to build:** Un seul Entretien agent est actif par run, les autres entretiens restent pending, et les nœuds ordinaires indépendants continuent à s'exécuter en parallèle malgré une session ouverte en pause humaine.

**Blocked by:** 03 — Maintenir une AgentNodeSession pendant un Entretien agent multi-tour; 06 — Fermer les sessions sur annulation, rejet et états terminaux.

**Status:** ready-for-agent

- [ ] Un run expose au plus un Entretien agent actif à la fois.
- [ ] Les autres nœuds d'entretien prêts restent pending tant que l'entretien courant n'a pas produit son artifact final.
- [ ] Les nœuds ordinaires indépendants conservent leur parallélisme pendant une pause d'entretien.
- [ ] Une session persistante bornée à un nœud n'introduit aucun état caché entre nœuds.
