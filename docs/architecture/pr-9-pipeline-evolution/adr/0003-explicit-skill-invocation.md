# ADR proposé 3 — Distinguer découverte et invocation explicite des skills

**Statut** : Proposé

## Contexte

Le frontmatter `disable-model-invocation: true` signifie qu’une skill ne doit pas être proposée automatiquement au modèle. Dans Pi, cette valeur exclut aussi une skill explicitement déclarée par une primitive. Dans VS Code, la sélection `skills` de la primitive n’est pas appliquée au run natif.

Les deux adapters ont donc des sémantiques différentes et aucun n’exécute complètement le contrat du pipeline.

## Décision

Introduire :

```ts
type SkillSelection =
  | { mode: "none" }
  | { mode: "discoverable" }
  | { mode: "explicit"; names: string[] };
```

- `disable-model-invocation` affecte seulement `discoverable`.
- `skills: [...]` dans une primitive signifie `explicit`.
- Une skill explicite absente produit une erreur.
- L’ordre et la liste demandée sont préservés.
- Pi et VS Code passent les mêmes tests de contrat.

## Conséquences positives

- les skills `to-spec`, `to-tickets`, `implement` et similaires sont réellement utilisables ;
- plus de duplication silencieuse dans les prompt adapters ;
- sémantique claire pour l’utilisateur et le modèle ;
- extraction future facilitée.

## Conséquences négatives

- évolution des builders de prompt dans les deux hôtes ;
- nécessité de décider si le contenu complet ou un pointeur est injecté selon l’agent ;
- erreurs de catalogue désormais bloquantes pour une sélection explicite.

## Alternatives rejetées

- Ignorer `disable-model-invocation` partout : réactive l’auto-invocation non souhaitée.
- Continuer à recopier les skills dans les prompts `.acp/agents/*.md` : duplication et divergence.
- Extraire immédiatement un nouveau package : prématuré avant stabilisation du contrat.
