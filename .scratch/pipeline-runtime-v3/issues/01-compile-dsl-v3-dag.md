# 01 — Compiler la DSL v3 en programme DAG immuable

**What to build:** Permettre à un auteur de pipeline de charger une définition `version: 3` et d’obtenir soit un programme DAG immuable prêt à exécuter, soit une liste déterministe d’erreurs de compilation compréhensibles.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] Une définition v3 valide compile en un programme interne qui ne dépend plus de la forme YAML.
- [ ] Le compilateur valide les agents, politiques, nœuds, dépendances `needs`, racines et références de base.
- [ ] Les cycles, dépendances absentes, nœuds inaccessibles, identifiants dupliqués et versions différentes de 3 sont refusés avec des erreurs stables.
- [ ] Deux nœuds partageant les mêmes dépendances sont représentés comme simultanément éligibles, sans bloc spécial de parallélisme.
- [ ] Le compilateur est testable comme un Module pur, sans démarrer LangGraph ni un agent.
- [ ] Les tests existants de validation v2 qui décrivent encore un comportement utile sont remplacés par leurs équivalents v3.
