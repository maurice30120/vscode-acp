# 12 — Supprimer v2 et finaliser le contrat runtime v3

**What to build:** Livrer une base cohérente où tous les appelants, pipelines, tests et documents utilisent exclusivement le runtime partagé et la DSL v3, sans compatibilité cachée avec l’ancien modèle.

**Blocked by:** 10 — Migrer Pi vers PipelineRuntime et la DSL v3; 11 — Migrer VS Code vers PipelineRuntime et la DSL v3.

**Status:** ready-for-agent

- [ ] Les anciennes opérations orientées plan, états `pendingApproval` spécialisés et événements utilisés comme source de vérité sont supprimés.
- [ ] Les types, parseurs, compilateurs et tests spécifiques à la DSL v2 sont supprimés ou remplacés par leurs équivalents v3.
- [ ] Aucun pipeline embarqué ou test de production n’utilise encore `version: 2`, `primitives`, `steps` ou un bloc spécial de parallélisme.
- [ ] Les ADR et documents d’architecture sont mis à jour pour refléter la rupture immédiate, le DAG v3, les artefacts typés et les politiques de nœud.
- [ ] La version du package partagé et les messages d’erreur rendent la rupture visible aux consommateurs.
- [ ] Les suites complètes passent sur Ubuntu, macOS et Windows, et le VSIX est créé sur les trois plateformes.
- [ ] Un audit final confirme que Pi et VS Code partagent le même compilateur, le même runtime, la même résolution de skills et les mêmes garanties de politique.