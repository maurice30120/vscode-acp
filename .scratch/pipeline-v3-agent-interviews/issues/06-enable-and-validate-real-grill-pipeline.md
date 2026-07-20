# 06 — Activer et valider l’entretien sur le pipeline `grill-me` réel

**What to build:** activer la capacité d’entretien sur le pipeline réel appelé depuis la CLI et démontrer que son parcours complet est compréhensible, observable et fonctionnel avant toute adaptation de Pi ou VS Code.

**Blocked by:** 02 — Terminer l’entretien avec `/done`, puis approuver le plan; 03 — Reprendre un entretien multi-tour depuis son snapshot; 04 — Réparer et diagnostiquer les sorties d’entretien invalides; 05 — Ordonner plusieurs entretiens sans perdre le parallélisme ordinaire.

**Status:** ready-for-agent

- [ ] Le nœud de planification du pipeline réel active explicitement le protocole `proposed-plan` sans détection implicite du contenu de l’agent.
- [ ] Le parcours automatisé principal vérifie `question → answer → question → /done → ready → approval y → démarrage du nœud suivant`.
- [ ] Le parcours court vérifie `question → /done → ready → approval y → démarrage du nœud suivant`.
- [ ] Un smoke test du binaire construit vérifie le wiring final, stdout, stderr et les codes de sortie sans dupliquer toute la couverture unitaire.
- [ ] Les logs permettent de distinguer une étape agent longue d’un blocage et conservent les détails structurés des erreurs utiles au diagnostic.
- [ ] Un essai manuel de la commande réelle confirme que chaque question rappelle `/done`, que `y` n’est proposé qu’après `ready` et que Pi et VS Code sont restés inchangés.
