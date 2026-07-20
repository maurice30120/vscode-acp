# 14 — Reprendre les runs et agents interrompus

**Identifier:** T14

**What to build:** Reprendre un run multi-agents après redémarrage en utilisant d’abord une session native cohérente, puis la branche et les commits existants, puis le dernier checkpoint stable lorsque les deux premières options sont indisponibles.

**Blocked by:** 02 — Persister les snapshots et le journal d’événements du run; 05 — Exécuter un implémenteur isolé par ticket prêt; 08 — Intégrer adaptativement les groupes avec des agents de merge; 12 — Router les réparations avec des cycles bornés.

**Status:** ready-for-agent

**Owned paths:** `acp-pipeline/**`, reprise de session sous `acp-sandcastle/**`.

**Shared paths:** commandes de reprise de `plugin-pi/**` et `plugin-vscode/**`.

- [ ] Le snapshot conserve pour chaque rôle l’agent, la session, la branche, le SHA, le worktree, le checkpoint stable et le statut d’interruption.
- [ ] La reprise native vérifie que la session appartient au ticket et que la branche et le worktree correspondent au snapshot avant de continuer.
- [ ] Lorsque la session native est indisponible, une nouvelle session reprend depuis la branche et les commits existants avec le contrat et les validations restantes.
- [ ] Lorsque la branche est absente ou incohérente, l’étape est recréée depuis le dernier checkpoint stable sans modifier les autres tickets déjà intégrés.
- [ ] Deux propriétaires ne peuvent pas reprendre simultanément la même étape.
- [ ] Une reprise n’efface jamais les diagnostics ou événements de la tentative précédente.
- [ ] Un run commencé dans Pi peut être listé et repris dans VS Code, et réciproquement, lorsqu’ils utilisent le même provider de persistance.
- [ ] Les événements indiquent la stratégie de reprise choisie et la raison du fallback éventuel.

**Validation command:** `npm run test -w @acp-client/pipeline && npm run test -w @acp-client/sandcastle && npm run test -w @acp-client/pi-extension && npm run test -w acp-client`

**Public seam exercised:** inspection puis reprise d’un run persistant via `PipelineRuntime`.
