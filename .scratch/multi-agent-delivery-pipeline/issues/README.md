# Tickets — pipeline de livraison multi-agents

La spécification de référence est [`../spec.md`](../spec.md).

## Dependency graph

```text
T01 Contracts
 ├─ T02 Persistence
 └─ T03 Grill → Spec → Tickets
       └─ T04 Ticket graph compiler
             └─ T05 Isolated implementers
                  ├─ T06 Adaptive scheduler
                  └─ T07 Integration checkpoints
                       └─ T08 Merger agents
                            └─ T09 Checkpoint validation
                                 └─ T10 Source drift
                                      └─ T11 Read-only verification
                                           └─ T12 Repair cycles
                                                ├─ T13 Final promotion
                                                └─ T14 Hybrid resume

T15 Common Pi/VS Code delivery depends on the completed execution path and T14.
```

## Ordered tickets

1. T01 — Versionner et valider les contrats d’artefacts multi-agents
2. T02 — Persister les snapshots et le journal d’événements du run
3. T03 — Exécuter `grill-me` → `toSpec` → `toTicket` avec deux approbations
4. T04 — Compiler le graphe de tickets approuvé en sous-DAG exécutable
5. T05 — Exécuter un implémenteur isolé par ticket prêt
6. T06 — Planifier les rôles avec une concurrence adaptative
7. T07 — Créer les checkpoints d’intégration qui débloquent les dépendances
8. T08 — Intégrer adaptativement les groupes avec des agents de merge
9. T09 — Exécuter les validations de checkpoint et attribuer les échecs
10. T10 — Réconcilier la dérive de la branche source avant vérification
11. T11 — Vérifier l’intégration dans une session indépendante et read-only
12. T12 — Router les réparations avec des cycles bornés
13. T13 — Promouvoir uniquement une intégration validée
14. T14 — Reprendre les runs et agents interrompus
15. T15 — Livrer le pipeline commun dans Pi et VS Code

## Frontier

- **T01** peut commencer immédiatement.
- Après T01, **T02** et **T03** peuvent être exécutés en parallèle.

## External prerequisite

Ces tickets étendent le runtime pipeline partagé et la DSL DAG v3 déjà spécifiés sur la branche. Ils doivent réutiliser `PipelineRuntime`, les pauses génériques, les artefacts typés, les politiques d’exécution et le store de run plutôt que créer un orchestrateur concurrent.
