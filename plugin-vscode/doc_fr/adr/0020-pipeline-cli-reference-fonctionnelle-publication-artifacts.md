# ADR-0020 : `pipeline-cli` comme référence fonctionnelle de la publication des artifacts

**Statut** : Accepté

## Contexte

Le projet expose le même moteur de pipeline à travers trois surfaces principales :

- `pipeline-cli`, utilisé comme exécutable de référence pour lancer et valider les pipelines sans dépendance à une interface graphique ;
- le plugin VS Code ;
- le plugin Pi.

Le pipeline `grill-spec-tickets-implement-review` produit des artifacts de planification typés, notamment :

- `acp.specification/v1` ;
- `acp.ticket-graph/v1`.

Le comportement attendu, déjà validé par l'usage de `pipeline-cli`, est de matérialiser ces artifacts dans le workspace, par exemple sous :

```text
.scratch/<feature>/spec.md
.scratch/<feature>/issues/README.md
.scratch/<feature>/issues/01-<ticket>.md
```

Une divergence est apparue lorsque VS Code et Pi restituaient les artifacts dans la conversation sans produire les fichiers correspondants. Ajouter une implémentation spécifique dans chaque plugin aurait créé plusieurs variantes du même comportement et aurait rendu les évolutions futures difficiles à maintenir.

Il faut donc distinguer deux responsabilités :

1. la **référence fonctionnelle**, qui décrit le comportement observable attendu ;
2. l'**implémentation partagée**, qui garantit que toutes les surfaces exécutent ce comportement de manière identique.

## Décision

`pipeline-cli` est la référence fonctionnelle du comportement des pipelines.

Cela signifie que :

- un pipeline exécuté depuis VS Code ou Pi doit produire les mêmes artifacts et les mêmes effets de bord qu'une exécution équivalente depuis `pipeline-cli` ;
- toute évolution du comportement pipeline doit d'abord être cohérente avec le contrat observable du CLI ;
- les plugins ne doivent pas réimplémenter la logique métier déjà portée par le moteur partagé.

L'implémentation de la publication des artifacts est centralisée dans le package `@acp-client/pipeline`.

Concrètement :

- `PipelineService` orchestre la publication des artifacts conservés dans le snapshot du runtime ;
- `PipelineArtifactPublisher` contient la logique de détection, de conversion et d'écriture des artifacts ;
- VS Code et Pi consomment automatiquement ce comportement via `PipelineService` ;
- `pipeline-cli` doit utiliser le même composant partagé, directement ou à travers `PipelineService`, afin d'éviter qu'une logique CLI distincte ne devienne une seconde implémentation ;
- les plugins restent des hôtes : ils fournissent l'intégration UI, le workspace, les permissions et les adaptateurs runtime, mais ne définissent pas le contrat métier de publication.

L'architecture cible est donc :

```text
                         pipeline-cli
                              │
                              │ référence fonctionnelle
                              ▼
                    @acp-client/pipeline
             ┌────────────────────────────────┐
             │ PipelineService                │
             │ PipelineArtifactPublisher      │
             │ runtime et contrats partagés   │
             └───────────────┬────────────────┘
                             │
                 ┌───────────┴───────────┐
                 ▼                       ▼
           plugin-vscode              plugin-pi
              hôte                      hôte
```

## Règles d'architecture

1. La logique métier de pipeline doit être placée dans `@acp-client/pipeline` dès qu'elle est commune à plusieurs hôtes.
2. `pipeline-cli`, VS Code et Pi doivent consommer les mêmes fonctions ou services partagés pour les comportements observables communs.
3. Une adaptation spécifique à un hôte est autorisée uniquement pour les responsabilités propres à cet hôte : interface, transport, permissions, sélection du workspace, affichage et interactions utilisateur.
4. Un test d'intégration du moteur partagé doit vérifier le comportement commun avant les tests spécifiques aux hôtes.
5. Les tests de VS Code, Pi et du CLI doivent vérifier l'absence de divergence, sans recopier l'algorithme de publication dans leurs fixtures ou helpers.
6. Une nouvelle implémentation spécifique à un plugin doit être considérée comme une exception d'architecture et documentée par un ADR.

## Conséquences

### Positives

- Le comportement validé depuis `pipeline-cli` devient reproductible dans VS Code et Pi.
- La publication des artifacts n'est implémentée qu'une seule fois.
- Les corrections et nouvelles versions d'artifacts sont disponibles automatiquement dans les différents hôtes.
- Les plugins restent plus simples et concentrés sur leur rôle d'intégration.
- Les tests du package partagé deviennent la source principale de validation du contrat métier.
- Le risque qu'un plugin affiche un artifact sans matérialiser les fichiers attendus est réduit.

### Négatives

- `PipelineService` porte désormais des effets de bord filesystem en plus de l'orchestration du runtime.
- Les hôtes doivent fournir un environnement d'exécution compatible avec le contrat d'écriture du publisher.
- Une évolution du format de sortie nécessite de préserver la compatibilité entre CLI, VS Code et Pi.
- Les comportements historiques propres au CLI doivent être progressivement remplacés par l'implémentation partagée lorsqu'ils existent encore en doublon.

### Neutres

- `pipeline-cli` reste l'outil privilégié pour diagnostiquer et valider un pipeline indépendamment des interfaces graphiques.
- Le CLI n'est pas le propriétaire technique de la logique partagée : il en est la référence fonctionnelle et un consommateur.
- VS Code et Pi peuvent présenter différemment les événements et artifacts dans leur interface tant que les résultats métier et les fichiers produits restent équivalents.

## Alternatives rejetées

### Dupliquer le publisher dans chaque hôte

Rejeté, car cette solution introduit trois implémentations susceptibles de diverger sur les chemins, les slugs, le nettoyage des fichiers obsolètes et les formats d'artifacts.

### Faire dépendre VS Code et Pi directement du code interne de `pipeline-cli`

Rejeté, car le CLI est une surface d'exécution et non une bibliothèque métier. Cette dépendance inverserait les responsabilités et couplerait les plugins à une interface applicative.

### Limiter la publication au CLI

Rejeté, car un même pipeline doit produire les mêmes résultats métier quel que soit l'hôte depuis lequel il est lancé.

### Laisser chaque pipeline écrire lui-même ses fichiers

Rejeté, car les agents devraient connaître les conventions filesystem de chaque hôte et la publication ne serait plus déterministe ni contrôlée par le runtime.

## ADRs liés

- [ADR-0005 : Pipeline A2A ACP](0005-a2a-acp-pipeline.md)
- [ADR-0017 : Monorepo npm workspaces](0017-monorepo-npm-workspaces.md)
- [ADR-0018 : Pipeline v2 comme catalogue canonique d'orchestration](0018-pipeline-v2-catalogue-canonique.md)
- [ADR-0019 : Résolution partagée de `promptFile` pour les pipelines](0019-promptfile-pipeline-partage.md)
