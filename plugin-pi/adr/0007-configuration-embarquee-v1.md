# ADR-0007 : Configuration Pi embarquée en v1

**Statut** : Acceptée

## Contexte

Le plugin Pi a besoin d'une configuration opérationnelle dès son installation. Le modèle initial lisait `.acp/acp-agents.json` et `.acp/pipelines/*.yaml` depuis le workspace ouvert, ce qui imposait à chaque projet de dupliquer la configuration minimale avant de pouvoir utiliser les pipelines fournis.

Pour une v1, le besoin prioritaire est de livrer un plugin autonome avec ses agents, pipelines et fichiers d'instructions par défaut. La personnalisation par projet reste utile, mais elle demande une politique de surcharge explicite pour éviter les ambiguïtés de fusion et de priorité.

## Décision

En v1, le plugin Pi embarque sa configuration runtime sous `.acp/` dans le package du plugin.

Le runtime résout la racine du package installé, puis charge :

- `.acp/acp-agents.json` pour les agents ACP ;
- `.acp/pipelines/*.yaml` pour le catalogue de pipelines ;
- `.acp/agents/*.md` pour les `promptFile` référencés par les pipelines embarqués.

Les fichiers `<workspace>/.acp/...` ne sont pas lus comme surcharge en v1. La surcharge par workspace est reportée à une v2, avec une règle dédiée de priorité et de validation.

Les skills restent chargées depuis `<workspace>/.agents/skills`, car elles représentent les capacités disponibles dans le projet ouvert et non la configuration runtime embarquée du plugin.

## Conséquences

- Un workspace vide peut utiliser les pipelines fournis par le plugin sans créer de fichiers `.acp`.
- Le package npm doit inclure `.acp` en plus de `dist`.
- Les chemins `promptFile` commençant par `.acp/` sont résolus depuis la racine du package plugin, et non depuis le workspace ouvert.
- Les projets ne peuvent pas encore surcharger les agents ou pipelines embarqués via `.acp`; cette capacité sera conçue séparément pour la v2.
