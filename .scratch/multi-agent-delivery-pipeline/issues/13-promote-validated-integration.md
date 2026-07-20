# 13 — Promouvoir uniquement une intégration validée

**Identifier:** T13

**What to build:** Terminer un run réussi en fusionnant la branche validée, en ouvrant une pull request ou en conservant la branche, selon une politique explicite, sans réutiliser la promotion immédiate de chaque sandbox implémenteur.

**Blocked by:** 10 — Réconcilier la dérive de la branche source avant vérification; 11 — Vérifier l’intégration dans une session indépendante et read-only; 12 — Router les réparations avec des cycles bornés.

**Status:** ready-for-agent

**Owned paths:** `acp-pipeline/**`, adapters Git/promotion de `acp-sandcastle/**`.

**Shared paths:** commandes et notifications de promotion dans Pi et VS Code.

- [ ] La configuration accepte `merge`, `pull-request` et `keep-branch`.
- [ ] La promotion cible par défaut la branche source capturée au démarrage et jamais une branche codée en dur.
- [ ] Aucun mode de promotion n’est exécuté tant qu’une catégorie obligatoire est en échec ou qu’un cycle de réparation est actif.
- [ ] Le mode `merge` fusionne localement la branche validée vers la cible en conservant un résultat structuré.
- [ ] Le mode `pull-request` conserve ou pousse la branche d’intégration selon l’adapter disponible et produit les métadonnées nécessaires à la création de PR.
- [ ] Le mode `keep-branch` termine avec succès sans modifier la cible.
- [ ] L’ancienne politique Sandcastle `ask/autoApply/autoReject` n’est plus utilisée pour promouvoir les branches de tickets ; elle reste encapsulée ou supprimée selon les besoins de compatibilité hors de ce pipeline.
- [ ] Un échec de promotion produit un état métier `failed` avec la branche validée conservée et reprenable.
- [ ] Le snapshot final identifie la source, la cible, le SHA validé, le mode et le résultat de promotion.

**Validation command:** `npm run test -w @acp-client/pipeline && npm run test -w @acp-client/sandcastle`

**Public seam exercised:** résultat terminal de `PipelineRuntime` après promotion ou conservation de branche.
