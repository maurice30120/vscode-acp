# 01 — Poser et répondre à une question d’entretien depuis la CLI

**What to build:** permettre à un utilisateur de la CLI de recevoir une question provenant d’un nœud d’entretien `proposed-plan`, de saisir une réponse libre et de reprendre ce même entretien, sans changer le comportement des nœuds agents ordinaires.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] Un nœud agent peut déclarer explicitement le protocole d’entretien `proposed-plan`, tandis qu’un nœud sans interaction conserve exactement son comportement actuel.
- [ ] Le compilateur refuse un protocole inconnu et toute configuration d’interaction placée sur un type de nœud incompatible.
- [ ] Une sortie `question` valide suspend le run avec une pause question persistée et ne produit aucun artifact du nœud.
- [ ] La CLI affiche la question puis `Answer [/done to finish]:` et transmet toute réponse non vide comme décision `answer`.
- [ ] La reprise exécute le tour suivant du même entretien avec la demande initiale et les tours déjà enregistrés.
- [ ] Les comportements sont couverts par les seams publics du runtime et de la CLI, et les tests existants des nœuds non interactifs continuent de passer.
