# 04 — Rendre la ligne d'activité compacte dans la timeline pipeline

**What to build:** l'utilisateur voit une ligne d'activité discrète près de la timeline Pipeline V3 pendant qu'un agent non-planner réfléchit. La ligne doit rester minimale, lisible, et ne pas devenir une visualisation complète ou un journal détaillé.

**Blocked by:** 02 — Mapper les réflexions agents en signal minimal; 03 — Nettoyer l'activité dès que la sortie commence.

**Status:** resolved

- [x] La ligne d'activité est visible uniquement lorsqu'une activité locale courante existe.
- [x] La ligne indique le rôle et le nom d'agent lorsqu'il est disponible.
- [x] La ligne utilise un texte fixe de type "réfléchit" ou équivalent, sans contenu de réflexion.
- [x] Le CLI reste inchangé, sans option ou mode de visualisation ajouté.

## Comments

Ajout de `PipelineActivityLine` près de la timeline pipeline, avec libellé compact rôle/agent et texte fixe `réfléchit`.
