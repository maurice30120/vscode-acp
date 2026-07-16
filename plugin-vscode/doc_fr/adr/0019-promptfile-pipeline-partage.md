# ADR-0019 : Résolution partagée de `promptFile` pour les pipelines

**Statut** : Accepté

## Contexte

Les pipelines v2 peuvent contenir des prompts longs ou réutilisables. Le plugin Pi supportait déjà `promptFile`, ce qui permet de garder les instructions de rôle dans des fichiers Markdown séparés. Côté VS Code, la suppression du DSL team rend ce mécanisme nécessaire pour conserver les instructions `planner`, `implementer` et `reviewer` sans réintroduire un format parallèle.

Sans résolution explicite de `promptFile` avant l'exécution, une primitive pouvait être validée avec un `prompt` vide ou diverger entre VS Code et Pi selon le catalogue utilisé.

## Décision

La résolution de `promptFile` est un comportement partagé du package `@acp-client/pipeline`.

Concrètement :

- `PipelinePromptFileResolver` centralise le contrat de résolution.
- VS Code et Pi résolvent les fichiers de prompt avant validation/exécution du pipeline.
- Une primitive est valide si elle fournit soit `prompt`, soit `promptFile`.
- Quand les deux sont fournis, le contenu du fichier est composé avec le prompt inline afin de conserver des instructions communes et un contexte spécifique à l'étape.
- Les chemins `promptFile` sont résolus relativement au fichier YAML de pipeline, avec refus des chemins qui sortent de la racine autorisée.
- Le starter conserve les instructions de rôle sous `.acp/agents/*.md` et les rattache à `Plan Execute Verify` via `promptFile`.

## Conséquences

### Positives

- VS Code et Pi partagent le même comportement pour les prompts externes.
- Les instructions longues restent maintenables sans recréer un DSL d'équipe.
- Les pipelines peuvent être validés avec des primitives qui n'ont pas de prompt inline, tant que `promptFile` est valide.
- Les erreurs de fichier manquant, dossier, dépassement de taille ou sortie de workspace sont détectées au niveau catalogue.

### Négatives

- Le chargement d'un pipeline dépend maintenant aussi de fichiers adjacents au YAML.
- Les tests doivent couvrir la résolution de chemins et les erreurs I/O, pas seulement le schéma YAML.

### Neutres

- `acp.instructions.maxBytes` reste utile comme limite de taille pour les fichiers référencés par `promptFile`.
- Les workspaces peuvent encore garder un prompt inline simple quand aucun fichier séparé n'est nécessaire.

## ADRs liés

- [ADR-0005 : Pipeline A2A ACP](0005-a2a-acp-pipeline.md)
- [ADR-0018 : Pipeline v2 comme catalogue canonique d'orchestration](0018-pipeline-v2-catalogue-canonique.md)
