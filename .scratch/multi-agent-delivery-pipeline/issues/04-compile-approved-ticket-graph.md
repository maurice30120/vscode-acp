# 04 — Compiler le graphe de tickets approuvé en sous-DAG exécutable

**Identifier:** T04

**What to build:** Transformer le contrat `toTicket` approuvé en un programme d’exécution dynamique qui calcule la frontière des tickets prêts, interdit les dépendances invalides et conserve l’état de chaque ticket dans le snapshot du run.

**Blocked by:** 01 — Versionner et valider les contrats d’artefacts multi-agents; 03 — Exécuter `grill-me` → `toSpec` → `toTicket` avec deux approbations.

**Status:** ready-for-agent

**Owned paths:** `acp-pipeline/**`

**Shared paths:** types de configuration consommés par les catalogues Pi et VS Code.

- [ ] Le compilateur refuse les cycles, identifiants dupliqués, bloqueurs absents et tickets inaccessibles.
- [ ] La frontière contient exactement les tickets dont tous les bloqueurs ont atteint le checkpoint requis.
- [ ] Chaque ticket expose son périmètre principal, ses zones partagées, ses critères d’acceptation, ses validations, ses règles de vérification et ses notes d’intégration.
- [ ] Les valeurs d’agent, modèle, effort, sandbox et politique héritent des valeurs du rôle et peuvent être surchargées par ticket.
- [ ] Les métadonnées de migration `reuse`, `adapt` et `restart` sont validées contre les versions précédentes des tickets.
- [ ] Le snapshot expose l’état stable de chaque ticket : pending, ready, running, implemented, integrated, repairing, verified, failed ou stale.
- [ ] Une nouvelle version de spec ou de graphe rend automatiquement stale les tickets dérivés qui ne sont pas explicitement réutilisés.
- [ ] Le sous-DAG reste un détail interne : les hôtes pilotent uniquement `PipelineRuntime`.

**Validation command:** `npm run test -w @acp-client/pipeline`

**Public seam exercised:** compilation d’un `TicketGraphArtifact` approuvé par `PipelineRuntime`.
