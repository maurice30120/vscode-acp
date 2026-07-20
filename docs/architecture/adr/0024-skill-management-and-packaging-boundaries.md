# ADR-0024 — Gestion des skills et frontières de packaging

**Statut** : Accepté
**Date** : 2026-07-20

## Contexte

Les pipelines peuvent demander des skills pour enrichir le prompt d'un node agent. La migration v3 a aussi introduit une résolution explicite des skills dans le package partagé.

Deux problèmes devaient être traités ensemble :

1. la différence entre une skill explicitement demandée par un pipeline et une skill découvrable automatiquement par le modèle ;
2. le packaging Pi, qui embarquait des ressources proches du starter VS Code et pouvait donner l'impression que des skills étaient fournies par le plugin Pi.

La contrainte finale est stricte : aucune skill ne doit être packagée dans le plugin Pi. Pi et VS Code restent des plugins séparés, mais ils consomment les skills du workspace quand elles existent.

## Décision

Les skills sont des ressources de workspace, pas des ressources du plugin Pi.

Le plugin Pi :

- ne publie pas `.agents/skills` ;
- ne publie pas `.cursor/skills` ;
- ne publie pas `skills-lock.json` ;
- ne publie pas de pipelines embarqués qui référencent des skills packagées ;
- ne fournit pas de fallback de skill si une skill demandée manque.

La résolution des skills se fait selon deux chemins distincts :

- découverte automatique : exclut les skills marquées `disable-model-invocation: true` ;
- sélection explicite par pipeline : accepte une skill explicitement demandée même si elle est désactivée pour l'invocation automatique.

La configuration d'agent `skills: false` reste prioritaire et désactive toute injection pour cet agent.

## Règles runtime

Pour chaque node agent v3 :

1. si `skills` est absent, aucun catalogue ou contenu de skill n'est injecté ;
2. si `skills` est présent, les noms sont résolus depuis `<workspace>/.agents/skills`;
3. un nom absent, ambigu ou invalide provoque une erreur avant l'appel agent ;
4. `disable-model-invocation` ne bloque pas une sélection explicite ;
5. `skills: false` dans la config de l'agent bloque l'injection, même si le pipeline déclare des skills.

## Frontières de packaging

VS Code peut fournir un starter workspace contenant `.agents/skills` et `.acp`.

Pi ne package pas ce starter et ne le copie pas. Si Pi est lancé dans un workspace déjà initialisé par VS Code, il consomme simplement les fichiers présents à la racine du workspace.

Cette frontière garantit :

- isolation des plugins ;
- pas de duplication de skills dans Pi ;
- pas de drift silencieux entre skills packagées et skills workspace ;
- comportement identique lorsque les deux plugins pointent vers le même workspace.

## Invariants

1. `plugin-pi` ne contient aucun fichier de skill packagé.
2. Le package Pi ne déclare pas `.agents/skills` dans ses fichiers publiés.
3. Un pipeline Pi ne peut utiliser une skill que si elle existe dans le workspace.
4. Une skill explicitement demandée est injectée ou le run échoue clairement.
5. La découverte automatique et la sélection explicite restent deux politiques différentes.
6. `disable-model-invocation` ne signifie pas "non utilisable par orchestration".

## Conséquences positives

- Plus de skills cachées dans le plugin Pi.
- Erreurs explicites quand un pipeline dépend d'une skill non disponible.
- Les pipelines workspace déclarent leurs dépendances réelles.
- Le starter VS Code reste propriétaire de ses ressources de démarrage.
- Le package Pi reste léger et prévisible.

## Conséquences négatives

- Les pipelines qui dépendaient de skills packagées dans Pi doivent fournir ces skills dans le workspace.
- Les tests Pi doivent créer leurs fixtures `.agents/skills` explicitement.
- Les docs historiques qui parlent de skills par primitive ou de skills vendored doivent être lues comme obsolètes.

## Alternatives rejetées

### Emballer les skills VS Code dans Pi

Cela viole l'isolation des plugins et crée deux copies à maintenir.

### Garder des prompt files Pi autonomes à la place des skills

Cela masque les dépendances réelles et recrée une variante non déclarée des skills. Les prompts autonomes ne doivent pas remplacer un mécanisme de dépendance explicite.

### Ignorer une skill manquante

Un pipeline continuerait avec un contrat incomplet. Une sélection explicite doit être fiable : injectée ou refusée.

### Utiliser `disable-model-invocation` comme interdiction globale

Ce champ contrôle l'exposition spontanée au modèle. Il ne doit pas empêcher une orchestration contrôlée de demander explicitement une skill.

## Validation

- Tests de résolution explicite dans `@acp-client/pipeline`.
- Tests Pi d'injection de skills explicites.
- Tests Pi `skills: false`.
- Recherches ciblées confirmant l'absence de `.agents/skills`, `.cursor/skills` et `skills-lock.json` dans `plugin-pi`.
- `npm run test -w @acp-client/pipeline`.
- `npm run test -w @acp-client/pi-extension`.

## Documents liés

- ADR-0021 — Politiques d'exécution exécutoires et résolution explicite des skills.
- ADR-0022 — Runtime pipeline v3 unique et suppression du moteur v2.
- ADR-0023 — Configuration workspace-root pour le plugin Pi.
