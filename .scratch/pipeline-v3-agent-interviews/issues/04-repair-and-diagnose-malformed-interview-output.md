# 04 — Réparer et diagnostiquer les sorties d’entretien invalides

**What to build:** corriger automatiquement une erreur ponctuelle de format du protocole d’entretien et fournir un échec structuré et compréhensible lorsque l’agent ne produit toujours pas une sortie valide.

**Blocked by:** 01 — Poser et répondre à une question d’entretien depuis la CLI.

**Status:** ready-for-agent

- [ ] `repairAttempts` accepte les entiers positifs ou nuls, vaut `1` par défaut et est refusé lorsqu’il est négatif ou non entier.
- [ ] Une sortie invalide déclenche une relance corrective contenant un diagnostic précis du protocole sans ajouter cette sortie à l’historique officiel.
- [ ] Une réparation réussie reprend normalement l’entretien et respecte les mêmes états `question` ou `ready` qu’une première sortie valide.
- [ ] Après épuisement des réparations, le run échoue avec `malformed_interview_output` et conserve le dernier historique valide.
- [ ] Les réparations de protocole et les retries techniques possèdent des compteurs et diagnostics indépendants.
- [ ] Les cas de bloc manquant ou multiple, état inconnu, question vide et question après demande de conclusion sont couverts.
