# 04 — Persister l'Historique ACP de nœud comme vérité de replay

**What to build:** Chaque échange significatif d'Entretien agent enrichit un Historique ACP de nœud structuré, durable et inspectable, qui reste la seule vérité de replay.

**Blocked by:** 03 — Maintenir une AgentNodeSession pendant un Entretien agent multi-tour.

**Status:** resolved

- [x] Le snapshot conserve le prompt d'origine, le protocole d'entretien, les tours structurés agent/utilisateur et l'intention éventuelle de Sortie d'entretien.
- [x] L'historique est persisté après chaque question agent, réponse utilisateur, demande de conclusion et sortie structurée significative.
- [x] Les logs, stderr, chunks progressifs, sorties de debug et diagnostics ne sont jamais inclus dans les tours de replay.
- [x] Un snapshot d'entretien peut être inspecté et chargé sans connexion ACP vivante.

## Comments

- Implemented in `@acp-client/pipeline`: the Runtime shared now publishes each Entretien agent's Historique ACP de nœud as a durable JSON node artifact (`acpNodeHistory`, type `acp.node-history/v1`) whenever the canonical interview history is recorded.
- The history artifact carries the original prompt, protocol, structured agent/user replay turns, completion intent, and significant structured ready outputs while keeping temporary agent activity out of replay turns.
- Verification: `npm run test -w @acp-client/pipeline` passes. Full `npm test` was also run outside the sandbox; it reached VS Code integration tests but failed on an existing Sandcastle Vibe timeout (`SandcastleAcpAgent completes Vibe run when the process hangs after writing completed session logs`), unrelated to this pipeline runtime change.
