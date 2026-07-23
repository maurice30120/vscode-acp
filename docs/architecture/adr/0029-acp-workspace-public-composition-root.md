# ADR-0029 — Workspace ACP public comme racine de composition

**Statut** : Accepté
**Date** : 2026-07-23

## Contexte

`acp-runtime` regroupe encore deux responsabilités : exécuter un agent ACP et composer un workspace ACP depuis `.acp/`, les pipelines, les skills et Sandcastle. Cette double responsabilité contredit la parité des surfaces hôtes définie par ADR-0025, car CLI, Pi et VS Code peuvent conserver des catalogues ou loaders locaux divergents.

## Décision

Nous extrayons un package public et stable `acp-workspace`. Il devient la racine de composition du workspace ACP : lecture et écriture de la Configuration workspace, catalogues agents/pipelines/skills, composition du runtime workspace et Sélection de connecteur workspace entre ACP natif et Sandcastle.

`acp-runtime` redevient un moteur ACP bas niveau. Il ne lit plus `.acp`, ne connaît plus le chemin workspace, ne charge plus pipelines ou skills, et ne sélectionne plus directement Sandcastle. Les dépendances dont il a besoin sont injectées depuis `acp-workspace`.

Les trois surfaces hôtes, `pipeline-cli`, `plugin-pi` et `plugin-vscode`, migrent dans la même livraison vers `acp-workspace`. Les exports déplacés sont supprimés directement de `@acp-client/runtime`, sans couche de compatibilité dépréciée.

## Conséquences

La migration est atomique : une surface hôte ne peut pas rester sur les loaders workspace de `@acp-client/runtime`. Les tests doivent verrouiller la parité de configuration et de sélection ACP natif/Sandcastle sur CLI, Pi et VS Code.

## Alternatives rejetées

- **Package interne expérimental** : incompatible avec la volonté de fournir une API stable de monorepo pour les surfaces hôtes.
- **Lecture seule dans `acp-workspace`** : laisserait les écritures de Configuration workspace à VS Code et préserverait une propriété de modèle locale.
- **Migration d’une seule surface d’abord** : créerait une période de divergence contraire à la Parité hôte.
- **Exports dépréciés dans `@acp-client/runtime`** : prolongerait l’ambiguïté sur la propriété du modèle workspace.
- **Sélection ACP natif/Sandcastle injectée par les hôtes** : recréerait la duplication que l’extraction doit supprimer.
