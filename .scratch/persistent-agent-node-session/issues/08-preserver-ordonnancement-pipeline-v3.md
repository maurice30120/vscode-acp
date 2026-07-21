# 08 — Préserver l'ordonnancement Pipeline V3 avec sessions persistantes

**What to build:** Un seul Entretien agent est actif par run, les autres entretiens restent pending, et les nœuds ordinaires indépendants continuent à s'exécuter en parallèle malgré une session ouverte en pause humaine.

**Blocked by:** 03 — Maintenir une AgentNodeSession pendant un Entretien agent multi-tour; 06 — Fermer les sessions sur annulation, rejet et états terminaux.

**Status:** resolved

- [x] Un run expose au plus un Entretien agent actif à la fois.
- [x] Les autres nœuds d'entretien prêts restent pending tant que l'entretien courant n'a pas produit son artifact final.
- [x] Les nœuds ordinaires indépendants conservent leur parallélisme pendant une pause d'entretien.
- [x] Une session persistante bornée à un nœud n'introduit aucun état caché entre nœuds.

## Comments

- Implémenté dans `PipelineRuntime`: les nœuds agents prêts sont suivis comme tâches en vol, avec un seul entretien sélectionné selon l'ordre de déclaration tandis que les agents ordinaires indépendants continuent.
- Couvert par `PipelineRuntime.test.ts`, notamment le cas où une pause d'entretien est retournée sans attendre la fin d'un nœud ordinaire indépendant.
