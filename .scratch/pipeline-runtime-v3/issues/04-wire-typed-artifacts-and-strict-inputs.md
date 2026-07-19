# 04 — Relier les nœuds avec des artefacts typés et des inputs stricts

**What to build:** Permettre aux nœuds d’un pipeline v3 d’échanger des artefacts nommés et typés, avec validation avant exécution et sans substitution silencieuse des références invalides.

**Blocked by:** 02 — Exécuter un pipeline linéaire via le nouveau PipelineRuntime.

**Status:** ready-for-agent

- [ ] Tout output de nœud est exposé comme un artefact possédant un type métier, un format et une valeur.
- [ ] Les formats initiaux `text`, `markdown` et `json` sont supportés de bout en bout.
- [ ] Chaque input consommé est nommé et référence explicitement un artefact produit par une dépendance directe ou transitive.
- [ ] Le compilateur refuse les références inconnues, les producteurs hors dépendances et les incompatibilités de type ou de format.
- [ ] Le runtime transmet plusieurs inputs sans concaténation implicite et conserve les artefacts par nœud dans le snapshot.
- [ ] Aucune référence invalide ne produit une chaîne vide ou une valeur par défaut silencieuse.