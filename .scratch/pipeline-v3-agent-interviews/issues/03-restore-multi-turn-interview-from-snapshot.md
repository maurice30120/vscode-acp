# 03 — Reprendre un entretien multi-tour depuis son snapshot

**What to build:** permettre à un entretien comportant plusieurs questions et réponses de survivre à la reconstruction du runtime et de continuer par replay, sans dépendre de la durée de vie d’une session ACP.

**Blocked by:** 01 — Poser et répondre à une question d’entretien depuis la CLI.

**Status:** ready-for-agent

- [ ] Le snapshot conserve le nœud, le protocole, l’état, la demande de conclusion et les tours agent/utilisateur sous forme structurée.
- [ ] Une nouvelle instance du runtime peut reprendre un entretien depuis son snapshot en rejouant la demande initiale et l’historique canonique.
- [ ] Chaque question possède un identifiant de pause unique lié au run, au nœud et au tour courant.
- [ ] Une décision consommée rend immédiatement la pause obsolète ; une seconde décision ou une réponse tardive échoue avec `invalid_resume`.
- [ ] Une éventuelle session ACP réutilisable reste une optimisation jetable : sa perte déclenche le replay sans modifier le comportement observable.
- [ ] Les tests publics couvrent plusieurs tours, la reconstruction depuis snapshot et l’inspection de l’historique persisté.
