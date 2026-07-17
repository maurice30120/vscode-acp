# ADR-0004 : Sélection des pipelines par ID court

**Statut** : Acceptée

## Contexte

Les titres de pipeline sont lisibles, mais peu pratiques comme argument de commande. Les anciens IDs longs comme `plan-execute-verify` rendaient `/pipeline run` verbeux alors que l'utilisateur veut sélectionner rapidement un workflow.

## Décision

L'`id` du pipeline est le nom de sélection court recommandé pour `/pipeline run`.

La liste des pipelines affiche l'ID entre crochets suivi du titre humain, par exemple :

```text
- [pev] Plan Execute Verify
```

Le titre reste un libellé de lecture. L'ID est l'interface stable de commande.

## Conséquences

- Le chemin recommandé est `/pipeline run pev <prompt>`.
- Les IDs doivent rester courts, mémorisables et uniques dans `.acp/pipelines`.
- Les titres peuvent évoluer pour être plus clairs sans casser les habitudes de commande.
