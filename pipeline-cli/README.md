# ACP Pipeline CLI

`@acp-client/pipeline-cli` exécute les pipelines ACP depuis un terminal, sans lancer VS Code ni Pi.

Le package réutilise le moteur `@acp-client/pipeline` et l'entrée hôte sans effet de bord de `@acp-client/pi-extension`. Les définitions de pipelines, les agents ACP, les skills et la configuration Sandcastle restent donc identiques entre Pi et le CLI au lieu d'être dupliqués.

## Commandes

Depuis la racine du dépôt :

```bash
npm run pipeline -- list
npm run pipeline -- run grill-skeleton-tdd "Ajouter une commande export"
```

Options principales :

```text
--cwd <path>  workspace transmis aux agents
--yes, -y     approuve automatiquement le plan final
--verbose     affiche les statuts et chunks des agents sur stderr
--json        sérialise la liste ou le résultat final
```

## Boucle `grill-me`

Pour un pipeline interactif, le CLI :

1. démarre le planner dans une session pipeline unique ;
2. affiche le bloc `<proposed_plan>` ;
3. pose uniquement la `<clarification_question>` courante ;
4. transmet la réponse à la révision du plan existant ;
5. recommence tant que `interview_state=question` ;
6. demande une approbation seulement quand le plan est `ready` ;
7. reprend le DAG après approbation.

`--yes` ne supprime pas les demandes de promotion Sandcastle : appliquer les modifications isolées au workspace reste une décision séparée.

## Validation

```bash
npm run test:cli
```

Les tests couvrent le parsing des arguments, la succession question → réponse → plan prêt, l'approbation et le rejet avant implémentation.
