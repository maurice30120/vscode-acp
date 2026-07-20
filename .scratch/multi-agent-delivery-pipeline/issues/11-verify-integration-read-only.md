# 11 — Vérifier l’intégration dans une session indépendante et read-only

**Identifier:** T11

**What to build:** Lancer un agent de vérification indépendant qui reçoit un bundle dédié, relance les contrôles nécessaires et produit un verdict structuré par catégories sans pouvoir modifier ou promouvoir le code.

**Blocked by:** 01 — Versionner et valider les contrats d’artefacts multi-agents; 09 — Exécuter les validations de checkpoint et attribuer les échecs; 10 — Réconcilier la dérive de la branche source avant vérification.

**Status:** ready-for-agent

**Owned paths:** `acp-pipeline/**`, politiques read-only de `acp-sandcastle/**`.

**Shared paths:** agents de vérification embarqués et projections UI de Pi/VS Code.

- [ ] Le bundle contient les décisions et artefacts approuvés, la source effectivement intégrée, la branche et le diff d’intégration, les checkpoints, validations, contrats publics, ajustements du mergeur, limitations connues et affirmations d’acceptation.
- [ ] Le vérificateur démarre dans une session neuve, différente de celle du mergeur ; un modèle différent des implémenteurs est préféré lorsque la configuration le permet.
- [ ] La politique et le filesystem empêchent toute modification promue par le vérificateur.
- [ ] Le prompt demande explicitement de ne pas faire confiance aux affirmations du bundle et de rechercher des problèmes non déclarés.
- [ ] Le rapport évalue `functional`, `tests`, `integration`, `architecture`, `security` et `quality`.
- [ ] Les règles par défaut du pipeline distinguent catégories requises, consultatives et requises lorsqu’elles sont présentes ; un ticket peut renforcer ces règles.
- [ ] Chaque problème bloquant identifie sa catégorie, sa sévérité, les tickets affectés, les preuves et les instructions de réparation.
- [ ] La décision globale est dérivée par le moteur et ne dépend pas d’un texte libre de l’agent.
- [ ] Une catégorie consultative en warning ne bloque pas ; une catégorie obligatoire en fail bloque toujours la promotion.

**Validation command:** `npm run test -w @acp-client/pipeline && npm run test -w @acp-client/sandcastle`

**Public seam exercised:** publication d’un `VerificationReportArtifact` et résultat stable de `PipelineRuntime`.
