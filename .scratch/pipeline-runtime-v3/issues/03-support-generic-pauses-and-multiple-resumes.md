# 03 — Supporter les pauses génériques et les reprises multiples

**What to build:** Permettre à un pipeline v3 de se mettre en pause plusieurs fois pour une approbation, une question ou une promotion, puis de reprendre exactement la pause courante jusqu’à sa terminaison.

**Blocked by:** 02 — Exécuter un pipeline linéaire via le nouveau PipelineRuntime.

**Status:** ready-for-agent

- [ ] Un nœud de pause retourne un résultat `paused` avec un identifiant stable, un type, un contenu, un format et un snapshot.
- [ ] Un run en pause reste inspectable et reprenable dans le store du runtime.
- [ ] Une décision de reprise explicite supporte au minimum approbation, réponse et rejet.
- [ ] Une reprise qui cible un identifiant de pause obsolète retourne une erreur `invalid_resume` sans avancer le DAG.
- [ ] Le scénario démarrage → première pause → reprise → seconde pause → reprise → terminaison fonctionne à travers le seul Seam `PipelineRuntime`.
- [ ] Le format `proposed-plan` est validé uniquement lorsqu’il est explicitement déclaré comme format de contenu.