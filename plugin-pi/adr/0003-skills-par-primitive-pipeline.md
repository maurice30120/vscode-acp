# ADR-0003 : Skills par primitive de pipeline

**Statut** : Acceptée

## Contexte

Les skills sont utiles pour spécialiser un agent, mais les injecter globalement dans tous les prompts augmente le contexte et mélange les responsabilités des étapes. Un pipeline planifie, implémente et vérifie souvent avec des besoins différents.

## Décision

Les pipelines Pi référencent les skills au niveau des primitives via `skills: [...]`.

À l'exécution, `PipelineExecutor` propage les skills de la primitive active vers `EphemeralAcpRunner`. Le runner charge le catalogue depuis `.agents/skills/<name>/SKILL.md`, filtre selon la liste demandée, puis préfixe uniquement le prompt de cette primitive avec le bloc `<available_skills>`.

## Conséquences

- Une primitive sans `skills` ne reçoit aucun catalogue de skills.
- Une primitive avec `skills: [...]` ne reçoit que les entrées listées et disponibles dans `.agents/skills`.
- Un agent peut désactiver toute injection avec `skills: false` dans `.pi/.acp/acp-agents.json`.
- La divulgation progressive est conservée : chaque étape reçoit seulement le contexte utile à son rôle.
