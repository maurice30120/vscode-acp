# 03 — Exécuter `grill-me` → `toSpec` → `toTicket` avec deux approbations

**Identifier:** T03

**What to build:** Livrer une phase de planification complète qui mène l’utilisateur d’une demande brute à une spécification approuvée puis à un DAG de tickets approuvé, sans aucun effet sur le workspace avant la seconde approbation.

**Blocked by:** 01 — Versionner et valider les contrats d’artefacts multi-agents.

**Status:** ready-for-agent

**Owned paths:** définitions de pipelines et agents embarqués sous `plugin-pi/.acp/**`, moteur de pauses et artefacts sous `acp-pipeline/**`.

**Shared paths:** catalogues de pipelines Pi et VS Code, documentation des pipelines embarqués.

- [ ] Le planner `grill-me` pose une décision à la fois, conserve les réponses précédentes et retourne un artefact `question` ou `ready` validé.
- [ ] Une réponse par défaut recommandée peut être acceptée sans modifier les autres décisions déjà validées.
- [ ] `toSpec` reçoit les décisions approuvées et produit les sept sections imposées par le skill sans réinterroger l’utilisateur.
- [ ] La première pause d’approbation fige la version et le digest de la spécification.
- [ ] `toTicket` reçoit uniquement la spécification approuvée et produit un graphe de tickets structuré.
- [ ] La seconde pause d’approbation fige la version et le digest du graphe de tickets.
- [ ] Aucun agent avec droits d’écriture n’est lancé avant la seconde approbation.
- [ ] Un problème de découpage reste dans `toTicket`, une contradiction technique remonte à `toSpec`, et une décision produit manquante remonte à `grill-me` avec invalidation des artefacts dérivés.
- [ ] Pi et VS Code observent les mêmes pauses génériques et les mêmes résultats discriminés.

**Validation command:** `npm run test -w @acp-client/pipeline && npm run test -w @acp-client/pi-extension && npm run test -w acp-client`

**Public seam exercised:** `PipelineRuntime.start()` et `PipelineRuntime.resume()` jusqu’à l’approbation du graphe de tickets.
