# ADR-0002 : Pipeline comme catalogue canonique du plugin Pi

**Statut** : Acceptée

## Contexte

Le moteur pipeline sait déjà représenter les workflows simples et avancés : primitives, étapes, approbation humaine, branches et prompts par agent. Le plugin Pi doit rester lisible et prévisible avec un seul modèle de configuration.

## Décision

Le plugin Pi utilise un seul moteur runtime : `pipeline`. Son catalogue canonique est `.acp/pipelines/*.yaml`.

Tout workflow orchestré par Pi doit être exprimé comme pipeline v2 dans ce catalogue.

## Conséquences

- `/pipeline list` ne reflète que les pipelines du catalogue Pi.
- Le code runtime Pi n'a pas à fusionner plusieurs catalogues ni à expliquer des priorités entre formats.
- La documentation et les exemples du plugin peuvent se concentrer sur un seul format.
