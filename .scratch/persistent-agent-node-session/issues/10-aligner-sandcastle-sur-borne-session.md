# 10 — Aligner Sandcastle sur la borne AgentNodeSession

**What to build:** La connexion agent Sandcastle couvre la production du diff ou de l'artifact, puis la promotion Apply/Reject démarre seulement après fermeture de la session.

**Blocked by:** 06 — Fermer les sessions sur annulation, rejet et états terminaux; 09 — Migrer les Adapters hôtes CLI, Pi et VS Code vers la fabrique AgentNodeSession.

**Status:** ready-for-agent

- [ ] Une exécution agent Sandcastle reste sous `AgentNodeSession` jusqu'à production du diff ou de l'artifact attendu.
- [ ] La session est fermée avant toute décision ou exécution de promotion Apply/Reject.
- [ ] Une annulation ferme la session Sandcastle active et ne lance aucune promotion.
- [ ] Le comportement Sandcastle respecte les mêmes transitions Pipeline V3 que les autres adapters.
