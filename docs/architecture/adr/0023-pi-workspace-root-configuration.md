# ADR-0023 — Configuration workspace-root pour le plugin Pi

**Statut** : Accepté
**Date** : 2026-07-20

## Contexte

Le plugin Pi embarquait auparavant sa propre arborescence `.acp` :

- `.acp/acp-agents.json` ;
- `.acp/.sandcastle/config.json` ;
- `.acp/pipelines/*.yaml` ;
- `.acp/agents/*.md` ;
- un ancien pipeline sous `.pi/.acp/pipelines`.

Ce modèle divergeait du plugin VS Code, qui fonctionne à partir de la configuration du workspace. Il créait aussi deux sources de vérité : le starter/configuration du repo d'un côté, et les ressources packagées dans Pi de l'autre.

La contrainte produit est que le plugin Pi reste isolé du plugin VS Code au niveau code et packaging, mais qu'il consomme la même configuration de racine workspace.

## Décision

Le plugin Pi ne package plus de configuration runtime.

Il lit exclusivement depuis la racine `cwd` fournie par l'hôte Pi :

- `<cwd>/.acp/acp-agents.json` ;
- `<cwd>/.acp/.sandcastle/config.json` ;
- `<cwd>/.acp/pipelines/*.yaml` et `*.yml` ;
- les `promptFile` résolus depuis la racine de configuration du workspace ;
- `<cwd>/.agents/skills/<name>/SKILL.md` uniquement pour les skills explicitement référencées par un pipeline workspace.

Le package npm Pi ne publie plus `.acp`. Le fichier `pluginRoot.ts` est supprimé. Un workspace sans `.acp/acp-agents.json` n'obtient aucun fallback packagé.

## Règles de chargement

`loadPiAcpConfig(cwd)` lit `<cwd>/.acp/acp-agents.json`.

`loadSandcastleConfig(cwd)` lit `<cwd>/.acp/.sandcastle/config.json` et retourne une config Sandcastle vide si le fichier est absent.

`loadPiAgentCatalog(cwd)` fusionne agents natifs et Sandcastle depuis le workspace, en conservant les validations existantes :

- `acp-agents.json` reste natif-only ;
- les agents Sandcastle vivent dans `.acp/.sandcastle/config.json` ;
- un nom d'agent déclaré dans les deux fichiers est une erreur ;
- les pipelines qui référencent un agent absent sont invalides.

`getPipelinePrograms(cwd)` compile les pipelines v3 de `<cwd>/.acp/pipelines`.

## Invariants

1. Le package Pi ne contient pas `.acp`, `.pi/.acp`, `.agents/skills` ni `skills-lock.json`.
2. Pi et VS Code lisent les mêmes fichiers de configuration workspace.
3. Pi ne dépend pas du code plugin VS Code pour lire cette configuration.
4. Un workspace vide ne reçoit pas de pipelines implicites.
5. Les erreurs de config workspace sont rapportées au logger/runtime Pi.

## Conséquences positives

- Une seule source de vérité par workspace.
- Plus de drift entre pipelines VS Code et pipelines Pi.
- Package Pi plus petit et sans ressources de démarrage cachées.
- Les tests doivent déclarer explicitement leurs fixtures `.acp`.
- La frontière entre plugin Pi et plugin VS Code reste claire : même format, code plugin séparé.

## Conséquences négatives

- Un utilisateur Pi doit disposer d'un workspace configuré.
- Les anciennes installations qui comptaient sur les pipelines packagés doivent migrer vers `.acp` à la racine du projet.
- Les docs/ADR historiques sur la configuration embarquée restent uniquement valables comme historique.

## Alternatives rejetées

### Garder un fallback packagé si le workspace est vide

Ce fallback recréerait deux sources de vérité et rendrait les bugs dépendants du contexte d'exécution.

### Copier automatiquement les templates VS Code dans Pi

Cela couplerait les plugins et introduirait une synchronisation implicite. Le plugin Pi doit consommer la config workspace, pas fabriquer un starter.

### Partager directement le code de catalogue VS Code

La parité de format est souhaitée, mais les plugins restent isolés. Le package partagé pertinent est `@acp-client/pipeline`, pas le code d'un plugin hôte.

## Validation

- Tests Pi de chargement workspace-root.
- Test Pi d'absence de fallback sur workspace non configuré.
- Suppression des fichiers `plugin-pi/.acp`, `plugin-pi/.pi/.acp`, `plugin-pi/.agents` et `plugin-pi/.cursor`.
- `npm run test -w @acp-client/pi-extension`.

## Documents liés

- ADR-0007 Pi — Configuration embarquée v1, remplacée par cette décision.
- ADR-0008 Pi — Plugin Pi autonome.
- ADR-0022 — Runtime pipeline v3 unique et suppression du moteur v2.
- ADR-0024 — Gestion des skills et frontières de packaging.
