# Grill → Spec → Tickets → Implement → Review

Pipeline ACP inspiré du workflow d'ingénierie de
[`mattpocock/skills`](https://github.com/mattpocock/skills).

## Objectif

Transformer une demande encore ambiguë en une implémentation vérifiée sans perdre
les points de contrôle humains :

```text
Demande
  → entretien grill-me, une question à la fois
  → validation du plan
  → spécification to-spec
  → tracer-bullet tickets to-tickets
  → validation de la spec et des tickets
  → implémentation TDD dans Sandcastle
  → code-review Standards + Spec
```

## Skills utilisés

| Primitive | Agent | Skills |
| --- | --- | --- |
| `planner` | Pi Agent | `grill-me`, `grilling` |
| `spec_writer` | Pi Agent | `to-spec` |
| `task_planner` | Pi Agent | `to-tickets` |
| `implementer` | Vibe Sandcastle | `implement`, `tdd` |
| `reviewer` | Pi Agent | `code-review` |

Les fichiers originaux sont présents sous `.agents/skills/`. Certains sont des
skills user-invoked qui font référence à des commandes slash ou à un issue tracker.
Les fichiers `.acp/agents/matt-*.md` les adaptent au transport ACP : ils conservent
la discipline du skill, mais remplacent les commandes slash, la publication de
tickets, le commit et les sous-agents implicites par des étapes explicites du
pipeline.

## Utilisation

```text
/pipeline run grill-spec-tickets-implement-review <demande>
```

Le planner pose ensuite une seule question à la fois :

```text
/pipeline answer <réponse>
```

Répéter jusqu'à ce que le plan soit prêt, puis :

```text
/pipeline approve
```

Le pipeline produit alors la spec et les tickets, puis s'arrête une seconde fois
pour validation. Vérifier la décomposition et lancer :

```text
/pipeline approve
```

L'implémentation s'exécute ensuite dans `Vibe Sandcastle`. La politique de
promotion Sandcastle configurée dans `.acp/.sandcastle/config.json` reste
applicable. Après promotion, le reviewer inspecte `git diff HEAD` et rend deux
rapports indépendants : conformité aux standards du dépôt et conformité au plan,
à la spec et aux tickets.

## Garanties du workflow

- Aucune spec n'est produite avant la validation du plan interactif.
- Aucune implémentation ne démarre avant la validation de la spec et des tickets.
- Les tickets sont ordonnés par dépendances et découpés en vertical slices.
- L'implementer utilise red-green par seam publique et ne commit pas.
- Le reviewer ne modifie pas le workspace et sépare `Standards` de `Spec`.
