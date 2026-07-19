# 05 — Orchestrer le DAG en parallèle avec retries et fail-fast

**What to build:** Permettre au runtime d’exécuter tous les nœuds prêts d’un DAG, de respecter strictement leurs dépendances et d’arrêter proprement le run lorsqu’un nœud échoue définitivement.

**Blocked by:** 03 — Supporter les pauses génériques et les reprises multiples; 04 — Relier les nœuds avec des artefacts typés et des inputs stricts.

**Status:** ready-for-agent

- [ ] Deux nœuds dont toutes les dépendances sont satisfaites peuvent s’exécuter simultanément.
- [ ] Aucun nœud ne démarre avant la réussite de toutes ses dépendances déclarées.
- [ ] Un nœud peut déclarer un nombre borné de retries et une stratégie de backoff validée à la compilation.
- [ ] Un retry transitoire réussi produit le même résultat observable qu’une réussite au premier essai.
- [ ] Après épuisement des retries, aucun nouveau nœud n’est lancé et les nœuds actifs sont annulés dans la mesure permise par leur Adapter.
- [ ] Le résultat `failed` identifie le nœud, la tentative et la cause, tout en conservant les artefacts et diagnostics déjà produits dans le snapshot.
