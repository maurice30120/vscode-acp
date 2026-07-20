# 02 — Terminer l’entretien avec `/done`, puis approuver le plan

**What to build:** permettre à l’utilisateur de demander la fin immédiate de l’entretien avec `/done`, d’examiner le plan final produit, puis de l’approuver séparément avant que le pipeline poursuive son exécution.

**Blocked by:** 01 — Poser et répondre à une question d’entretien depuis la CLI.

**Status:** ready-for-agent

- [ ] La CLI traduit exactement `/done` en décision `complete-interview` et ne le transmet jamais comme réponse métier à l’agent.
- [ ] Après `complete-interview`, le protocole exige immédiatement une sortie `ready` et refuse toute nouvelle question comme violation de protocole.
- [ ] Seule la sortie `ready` produit l’artifact final, en conservant intégralement le bloc canonique `<proposed_plan>`.
- [ ] Terminer l’entretien n’approuve pas son résultat : la pause d’approbation déclarée apparaît ensuite avec `Approve final plan? [y/N]`.
- [ ] Une réponse `y` reprend réellement le pipeline et le démarrage de l’agent suivant est visible sans mode verbose.
- [ ] Les parcours courts et complets couvrent `/done → ready → approval y`, le rejet, la saisie vide et l’annulation terminale.
