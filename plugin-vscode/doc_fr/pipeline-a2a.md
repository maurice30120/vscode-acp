# Ancienne page pipeline A2A

Les pipelines ne reposent plus sur le mécanisme A2A historique.

La documentation française à jour est maintenant ici :

- [Pipelines LangGraph ACP](./pipelines-langgraph.md)

Résumé du nouveau fonctionnement :

- les pipelines sont déclarés en YAML dans `.acp/pipelines/*.yaml` ;
- les anciens fichiers `.acp/teams/*.yaml` ont été retirés ; les workflows orientés rôles doivent être exprimés en pipelines v2 ;
- chaque pipeline valide apparaît comme un agent virtuel dans VS Code ;
- LangGraph orchestrate les steps, les approvals et les branches parallèles ;
- ACP reste le protocole utilisé pour appeler les agents configurés ;
- les actions `sideEffects: workspace` doivent passer après une approbation humaine.

> **Note** : Pour les workflows basés sur des rôles (planner, implementer, reviewer, tester), utilisez des primitives pipeline avec `promptFile`.
