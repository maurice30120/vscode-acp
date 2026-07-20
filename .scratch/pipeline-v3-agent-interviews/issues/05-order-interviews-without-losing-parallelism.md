# 05 — Ordonner plusieurs entretiens sans perdre le parallélisme ordinaire

**What to build:** garantir qu’un run ne présente jamais deux entretiens simultanés, tout en conservant l’exécution parallèle des agents ordinaires indépendants.

**Blocked by:** 03 — Reprendre un entretien multi-tour depuis son snapshot.

**Status:** ready-for-agent

- [ ] Lorsque plusieurs nœuds d’entretien deviennent prêts, le premier selon l’ordre de déclaration démarre et les autres restent en attente.
- [ ] Aucun second entretien ne démarre avant que le premier ait produit son artifact final.
- [ ] Le snapshot et l’inspection publique n’exposent jamais plus d’un entretien actif ni plus d’une pause courante.
- [ ] Les nœuds agents ordinaires indépendants restent éligibles au parallélisme pendant qu’un entretien est actif, sous réserve de leurs dépendances normales.
- [ ] La sélection reste déterministe après reconstruction du runtime depuis un snapshot.
- [ ] Des tests publics vérifient simultanément la sérialisation des entretiens et la conservation du parallélisme ordinaire.
