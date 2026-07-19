# 07 — Garantir les politiques et promotions dans Sandcastle

**What to build:** Faire produire à l’Adapter Sandcastle le même état observable du workspace que l’Adapter ACP natif, tout en conservant l’isolation du worktree et les stratégies de promotion.

**Blocked by:** 06 — Appliquer les profils de politique sur ACP natif.

**Status:** ready-for-agent

- [ ] Sandcastle reçoit la même politique normalisée que l’Adapter ACP natif.
- [ ] Un nœud read-only peut travailler dans un worktree isolé mais aucun de ses changements n’est promu vers le workspace hôte.
- [ ] Un nœud workspace-write ne peut être promu que si la politique et les approbations du run l’autorisent.
- [ ] Les stratégies de promotion `discard`, `ask`, `auto-apply` et `auto-reject` produisent des résultats explicites et testables.
- [ ] Une annulation ou un rejet de promotion produit le bon état terminal sans laisser de run actif ni de changement hôte partiel.
- [ ] La même suite contractuelle read-only/workspace-write passe contre ACP natif et Sandcastle.