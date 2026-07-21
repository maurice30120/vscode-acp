# 10 — Aligner Sandcastle sur la borne AgentNodeSession

**What to build:** La connexion agent Sandcastle couvre la production du diff ou de l'artifact, puis la promotion Apply/Reject démarre seulement après fermeture de la session.

**Blocked by:** 06 — Fermer les sessions sur annulation, rejet et états terminaux; 09 — Migrer les Adapters hôtes CLI, Pi et VS Code vers la fabrique AgentNodeSession.

**Status:** resolved

- [x] Une exécution agent Sandcastle reste sous `AgentNodeSession` jusqu'à production du diff ou de l'artifact attendu.
- [x] La session est fermée avant toute décision ou exécution de promotion Apply/Reject.
- [x] Une annulation ferme la session Sandcastle active et ne lance aucune promotion.
- [x] Le comportement Sandcastle respecte les mêmes transitions Pipeline V3 que les autres adapters.

## Comments

- Implémenté côté VS Code Sandcastle : `finishEphemeralSandcastleRun` ferme désormais obligatoirement la session agent Sandcastle avant toute promotion, et la promotion est sautée si la fermeture échoue.
- Le bridge Sandcastle expose `sandcastle/close-agent-session`, refuse les prompts après fermeture, mais conserve les méthodes de promotion `preview`/`apply`/`reject` disponibles sur le worktree.
- Vérifié par `npm run compile-tests -w acp-client`, `npm run lint -w acp-client` et `npm run test:common`.
