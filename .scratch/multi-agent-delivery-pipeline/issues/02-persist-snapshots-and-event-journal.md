# 02 — Persister les snapshots et le journal d’événements du run

**Identifier:** T02

**What to build:** Permettre à un run multi-agents de conserver durablement son état courant et son historique, afin qu’une interruption de Pi, VS Code ou du processus ne perde ni les décisions, ni les branches, ni les étapes déjà terminées.

**Blocked by:** 01 — Versionner et valider les contrats d’artefacts multi-agents.

**Status:** ready-for-agent

**Owned paths:** `acp-pipeline/**`

**Shared paths:** configuration de workspace et résolution des chemins partagées par les deux hôtes.

- [ ] Le seam `PipelineRunStore` permet de créer, charger et sauvegarder un snapshot, d’ajouter un événement append-only et de lister les runs reprenables d’un dépôt.
- [ ] Un provider `workspace` persiste sous le projet sans versionner par défaut les données d’exécution.
- [ ] Un provider `user` persiste sous le répertoire utilisateur en séparant les dépôts par identifiant stable.
- [ ] Les snapshots sont écrits atomiquement et un événement déjà appendé n’est jamais perdu par une mise à jour concurrente du snapshot.
- [ ] Le journal trace au minimum les transitions de planification, approbation, implémentation, merge, validation, vérification, réparation, reprise et promotion.
- [ ] Les branches et commits Git restent la source de vérité du code ; le store ne duplique pas le contenu des worktrees.
- [ ] Un runtime reconstruit peut inspecter un run persistant sans disposer de l’ancienne instance LangGraph.

**Validation command:** `npm run test -w @acp-client/pipeline`

**Public seam exercised:** `PipelineRunStore` injecté dans `PipelineRuntime`.
