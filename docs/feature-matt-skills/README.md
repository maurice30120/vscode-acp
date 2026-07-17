# Feature Matt Skills

## Vue d'ensemble

Cette documentation cadre l’adaptation possible des skills de
[mattpocock/skills](https://github.com/mattpocock/skills) au projet ACP.

L’objectif est d’améliorer les pipelines de développement agentique en deux
temps : d’abord enrichir les agents existants avec les principaux skills Matt,
puis étudier un pipeline dynamique piloté par `/ask-matt`.

## Statut

Étude uniquement. Aucun skill, pipeline, code applicatif, test ou fichier de
configuration n’est créé ou modifié dans cette V1.

La V1 se limite à documenter l’inclusion des principaux skills dans les agents
existants (`planner`, `implementer`, `tester`, `reviewer`). La V2 cible un
pipeline dynamique où `/ask-matt` choisit les étapes à exécuter selon la demande.

La V1 privilégie des prompts agents enrichis. Elle ne consiste pas à détourner
`promptFile` pour pointer directement vers les `SKILL.md` bruts.

Aucune de ces étapes ne modifie encore les fichiers d’agents, les pipelines ou
le catalogue de skills.

## Documents

- [Notes d’étude du flow Matt Skills](./etude-flux-matt-skills.md)
- [Proposition V1 et perspective V2](./proposition-v1.md)
