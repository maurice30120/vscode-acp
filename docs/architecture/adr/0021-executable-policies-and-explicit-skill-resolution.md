# ADR-0021 — Politiques d’exécution exécutoires et résolution explicite des skills

**Statut** : Proposé  
**Date** : 2026-07-19

## Contexte

Les primitives pipeline déclarent aujourd’hui :

```yaml
sideEffects: none | workspace
permissions: ask | allowAll
skills: [...]
```

Ces valeurs ne produisent pas les mêmes garanties selon le transport.

### Effets de bord

Pour Sandcastle, une primitive `sideEffects: none` peut écrire dans son worktree isolé, puis le runner rejette les changements. Le workspace hôte reste donc intact.

Pour ACP natif, `sideEffects` est transmis au runner mais n’est pas utilisé pour bloquer les handlers d’écriture ou les commandes mutantes. Avec `permissions: allowAll`, le `PermissionHandler` approuve automatiquement les demandes ACP.

La promesse read-only dépend alors du prompt et du comportement de l’agent, pas de l’Implementation.

### Skills

Le catalogue lit `disable-model-invocation: true` depuis les `SKILL.md`. `renderSkillsCatalog()` exclut ces skills même lorsqu’une primitive les sélectionne explicitement dans `skills: [...]`.

Deux intentions différentes sont donc confondues :

1. découverte automatique par le modèle ;
2. sélection explicite par l’orchestrateur.

Les skills `to-spec`, `to-tickets` et `implement` de la PR #9 sont explicitement demandés mais absents du bloc injecté. Des prompt files recopient une partie de leur contrat pour compenser.

## Décision

### 1. Normaliser les intentions en une politique exécutoire

Introduire un Module `ExecutionPolicyResolver` dans le package partagé.

```ts
export interface ExecutionPolicyResolver {
  resolve(input: {
    primitive: PipelinePrimitiveDefinition;
    transport: PipelineTransportCapabilities;
    approvals: PipelineApprovalContext;
  }): ExecutionPolicy;
}
```

La politique normalisée est :

```ts
export interface ExecutionPolicy {
  filesystem: 'read-only' | 'workspace-write';
  terminal: 'deny' | 'ask' | 'allow';
  network: 'deny' | 'ask' | 'allow';
  promotion: 'discard' | 'ask' | 'auto-apply' | 'auto-reject';
}
```

Les capacités du transport sont explicites :

```ts
export interface PipelineTransportCapabilities {
  isolatedFilesystem: boolean;
  enforceReadOnlyFilesystem: boolean;
  supportsPromotion: boolean;
  supportsTerminalPolicy: boolean;
}
```

`PipelineExecutor` résout et valide la politique avant d’appeler l’Adapter de transport.

### 2. Enforcement par Adapter

#### ACP natif

L’Adapter doit :

- refuser `writeTextFile` en `filesystem: read-only` ;
- appliquer la règle terminal avant création ou exécution ;
- retourner un refus stable et explicite ;
- journaliser le refus sans dépendre de l’interprétation du prompt ;
- refuser le run avant démarrage si le transport ne peut pas garantir la politique.

#### Sandcastle

L’Adapter peut autoriser les écritures dans le worktree isolé, puis :

- rejeter le worktree pour `promotion: discard` ;
- demander ou appliquer la promotion pour une primitive workspace-write ;
- ne jamais promouvoir une primitive read-only.

Les différences d’Implementation sont cachées derrière le même contrat observable : le workspace final respecte la politique.

### 3. Séparer résolution explicite et découverte automatique des skills

Introduire un Module `SkillResolver` :

```ts
export interface SkillResolver {
  resolveExplicit(input: {
    workspaceCwd: string;
    names: string[];
  }): ResolvedSkillSet;

  discoverModelInvocable(input: {
    workspaceCwd: string;
  }): ResolvedSkillSet;
}
```

Règles :

- `resolveExplicit()` inclut un skill demandé même s’il possède `disable-model-invocation: true` ;
- `discoverModelInvocable()` exclut ce skill ;
- un skill explicitement demandé mais absent ou invalide produit une erreur ;
- l’ordre de résolution est déterministe ;
- la composition du prompt est centralisée ;
- la configuration d’agent `skills: false` continue de désactiver toute injection.

### 4. Garder les Seams internes nécessaires

Le filesystem, le terminal et le réseau sont des dépendances local-substitutable. Les tests utilisent des Adapters temporaires ou en mémoire sans exposer ces Seams dans l’Interface publique du pipeline.

Le Seam du transport reste `PipelineAgentRunner`, car deux Adapters concrets existent déjà : ACP natif et Sandcastle.

Le Seam de catalogue de skills peut être partagé entre Pi et VS Code si les deux hôtes consomment le même format. Il ne faut pas dupliquer deux Implementations qui interprètent différemment le même frontmatter.

## Invariants

1. `sideEffects: none` garantit que le workspace hôte n’est pas modifié.
2. `sideEffects: workspace` exige une approval antérieure conforme au graphe.
3. Une politique non supportée échoue avant l’exécution de l’agent.
4. `permissions: allowAll` ne peut pas élargir une politique read-only.
5. Un skill explicitement demandé est injecté ou provoque une erreur claire.
6. `disable-model-invocation` contrôle uniquement la découverte/invocation automatique.
7. Les mêmes primitives produisent les mêmes garanties observables sur ACP natif et Sandcastle.

## Conséquences positives

- Garantie read-only réelle, indépendante du prompt.
- Contrat cohérent entre transports.
- Réduction des risques liés à `allowAll`.
- Tests contractuels réutilisables pour les Adapters.
- Les pipelines utilisent réellement les skills qu’ils déclarent.
- Réduction progressive de la duplication dans les prompt adapters.
- Locality accrue pour les règles de sécurité et de résolution.

## Conséquences négatives

- Les handlers ACP natifs doivent recevoir et appliquer une politique de run.
- La classification des commandes terminal mutantes demande une stratégie conservatrice.
- Certains agents ou transports peuvent être refusés s’ils ne savent pas garantir la politique.
- Une erreur de skill manquant devient bloquante alors qu’elle était auparavant silencieuse.
- La mutualisation du catalogue peut demander une migration de code entre workspaces.

## Alternatives rejetées

### Utiliser uniquement `permissions: ask`

C’est un garde-fou immédiat utile, mais pas une garantie. L’utilisateur peut approuver une écriture involontaire, un environnement headless peut annuler tout le run, et la politique dépend encore de chaque demande outil.

### Faire confiance au prompt read-only

Le prompt n’est pas une politique de sécurité. Un agent peut se tromper, une instruction peut être contradictoire et un outil peut produire un effet indirect.

### Exécuter toutes les étapes dans Sandcastle

Cette approche garantirait l’isolation, mais imposerait Docker, augmenterait le coût de chaque étape et supprimerait l’intérêt du transport ACP natif. Le Seam existant doit permettre les deux Adapters.

### Ignorer silencieusement les skills non injectables

Le pipeline afficherait une configuration trompeuse. Une sélection explicite est un contrat de l’orchestrateur et doit être honorée ou refusée.

### Supprimer `disable-model-invocation`

Ce champ reste utile pour éviter qu’un modèle invoque spontanément des workflows destinés à une commande utilisateur ou à une orchestration contrôlée.

## Migration

1. Passer immédiatement les primitives read-only de la PR #9 à `permissions: ask`.
2. Ajouter les types de politique et de capacités dans `acp-pipeline`.
3. Adapter `PipelineExecutor` et `PipelineAgentRunInput`.
4. Implémenter l’enforcement ACP natif.
5. Adapter Sandcastle au contrat normalisé sans changer son comportement observable.
6. Ajouter les tests contractuels transport.
7. Introduire `SkillResolver` et migrer le runner Pi.
8. Mutualiser ou aligner l’Implementation VS Code.
9. Supprimer l’ancien filtrage silencieux.
10. Réduire les prompt adapters uniquement après validation des skills réels.

## Plan de validation

### Politique

- lecture autorisée en read-only ;
- écriture fichier refusée sur ACP natif ;
- diff Sandcastle rejeté en read-only ;
- terminal refusé/demandé/autorisé selon politique ;
- workspace-write sans approval refusé ;
- workspace-write approuvé promu conformément à la configuration ;
- transport incapable de garantir read-only refusé avant prompt.

### Skills

- `to-spec`, `to-tickets` et `implement` injectés lors d’une sélection explicite ;
- mêmes skills absents de la découverte automatique ;
- skill manquant refusé ;
- `skills: false` respecté ;
- résultat déterministe sur les chemins Windows et POSIX.

## Documents liés

- `docs/architecture/pipeline-architecture-study.md`
- `docs/architecture/pipeline-target-architecture.md`
- `docs/architecture/pipeline-migration-plan.md`
- `docs/reviews/pr-9-review.md`
- ADR-0020 : résultats typés et pauses génériques