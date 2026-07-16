# ADR-0018 : Pipeline v2 comme catalogue canonique d'orchestration

**Statut** : Accepté

## Contexte

L'extension VS Code exposait deux manières de décrire un workflow multi-agent : les pipelines v2 sous `.acp/pipelines/*.yaml` et les équipes d'agents sous `.acp/teams/*.yaml`. Le workflow livré par défaut `Feature Team` couvrait le même parcours produit que `Plan Execute Verify`, mais passait par un compilateur `team` séparé.

Le plugin Pi avait déjà retenu les pipelines v2 comme format canonique. Garder deux surfaces côté VS Code créait de la duplication produit, des commandes spécifiques, des watchers supplémentaires et une API partagée plus large que nécessaire dans `@acp-client/pipeline`.

## Décision

VS Code et Pi utilisent un seul format canonique pour l'orchestration déclarative : les pipelines v2.

Concrètement :

- `.acp/pipelines/*.yaml` est la seule source de workflows virtuels côté VS Code.
- `Plan Execute Verify` est le workflow livré par défaut.
- `Feature Team` n'est plus livré comme agent virtuel séparé.
- `.acp/teams/*.yaml` n'est plus chargé par le catalogue VS Code et n'est plus créé par le starter.
- Les commandes dédiées aux teams (`acp.showCompiledTeamPipeline`, `acp.rerunTeamReviewer`) sont supprimées.
- Les types et helpers team ne font plus partie de l'API publique de `@acp-client/pipeline`.

Les workspaces qui utilisaient encore `.acp/teams/*.yaml` doivent migrer vers un pipeline v2 équivalent.

## Conséquences

### Positives

- Le catalogue d'agents virtuels ne présente plus deux entrées pour le même workflow produit.
- VS Code et Pi partagent le même modèle mental : un workflow déclaratif = un pipeline v2.
- Le moteur partagé `@acp-client/pipeline` expose moins de concepts historiques.
- Les tests et la documentation n'ont plus à couvrir deux DSL qui convergent vers la même exécution.

### Négatives

- La migration est cassante pour les workspaces qui dépendaient encore de `.acp/teams/*.yaml`.
- Les commandes de diagnostic/rerun spécifiques au compilateur team disparaissent au lieu d'être maintenues en compatibilité.

### Neutres

- Les sessions virtuelles continuent d'être exécutées par le runtime d'orchestration LangGraph.
- Les IDs d'affichage et de timeline doivent venir des steps/primitives de pipeline (`plan`, `implement`, `verify`) plutôt que d'un rôle team.

## ADRs liés

- [ADR-0005 : Pipeline A2A ACP](0005-a2a-acp-pipeline.md)
- [ADR-0015 : Bootstrap du runtime d'extension et seam des sessions virtuelles](0015-runtime-extension-et-sessions-virtuelles.md)
- [ADR-0016 : Starter de workspace embarqué](0016-workspace-starter.md)
- [ADR-0017 : Monorepo npm workspaces](0017-monorepo-npm-workspaces.md)
