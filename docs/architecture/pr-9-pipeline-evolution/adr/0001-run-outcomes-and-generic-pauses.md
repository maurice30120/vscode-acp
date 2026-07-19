# ADR proposé 1 — Résultats de run explicites et pauses génériques

**Statut** : Proposé

## Contexte

Le moteur partagé supporte les interrupts LangGraph multiples, mais `createPlan()` et `approvePlan()` retournent un string. Les adapters déduisent une pause en observant l’événement `plan-ready` et un état mutable. La PR #9 introduit deux validations et révèle qu’une reprise peut aboutir à une nouvelle pause, pas nécessairement à la fin.

Le modèle actuel nomme tout interrupt « plan » et valide systématiquement `<proposed_plan>`, même pour une validation de spécification et de tâches en markdown.

## Décision

- Introduire `PipelineRunOutcome` discriminé : `paused` ou `completed`.
- Introduire `PipelinePause` générique avec `pauseId`, `stepId`, `purpose`, `content`, `contentType` et `editable`.
- Remplacer l’interface publique par `start` et `resume`.
- Exiger le `pauseId` lors d’un resume ou reject.
- Garder les événements comme surface d’observation uniquement.
- Valider `<proposed_plan>` seulement pour les pauses de type `proposed_plan`.

## Conséquences positives

- support correct de N pauses ;
- suppression des inférences temporelles dans les hôtes ;
- validation de contenu adaptée au type réel ;
- meilleure base pour persistance et reprise ;
- même contrat Pi/VS Code.

## Conséquences négatives

- migration des types, tests et messages UI ;
- compatibilité temporaire à gérer ;
- `pauseId` doit être propagé jusqu’aux boutons/commandes.

## Alternatives rejetées

- Corriger seulement `PipelineController.approve()` : laisse l’interface ambiguë et la divergence VS Code.
- Conserver le wrapper `<proposed_plan>` pour toute pause : fragile et sémantiquement faux.
- Piloter le lifecycle uniquement par événements : double source de vérité.
