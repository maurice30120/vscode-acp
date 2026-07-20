# 09 — Charger et découvrir uniquement les pipelines v3

**What to build:** Permettre aux deux hôtes de découvrir les mêmes définitions de pipeline v3, de les compiler avec le même Module et de refuser explicitement toute définition v2.

**Blocked by:** 01 — Compiler la DSL v3 en programme DAG immuable; 04 — Relier les nœuds avec des artefacts typés et des inputs stricts; 06 — Appliquer les profils de politique sur ACP natif; 07 — Garantir les politiques et promotions dans Sandcastle; 08 — Résoudre les skills explicites de manière déterministe.

**Status:** ready-for-agent

- [ ] Le catalogue partagé ne retourne que des pipelines v3 compilés avec succès.
- [ ] Une définition v2 est refusée avec un message de version non supportée, sans conversion implicite.
- [ ] Tous les pipelines embarqués sont réécrits en DAG v3 avec `needs`, artefacts nommés et politiques de nœud.
- [ ] Les anciennes structures `primitives`, `steps` et blocs spéciaux de parallélisme ne sont plus acceptées.
- [ ] Pi et VS Code voient le même identifiant, le même graphe, les mêmes erreurs et les mêmes skills pour une définition donnée.
- [ ] Les chemins de prompt et de skills restent sûrs et déterministes sur Windows et POSIX.
- [ ] Les tests de catalogue couvrent les pipelines interactifs, skeleton/TDD et spec/tickets/implement/review convertis.