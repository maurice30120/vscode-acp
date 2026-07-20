# 12 — Router les réparations avec des cycles bornés

**Identifier:** T12

**What to build:** Transformer les échecs de validation ou de vérification en réparations ciblées depuis la branche d’intégration réellement contrôlée, puis réintégrer et revérifier jusqu’à réussite ou atteinte des limites.

**Blocked by:** 11 — Vérifier l’intégration dans une session indépendante et read-only.

**Status:** ready-for-agent

**Owned paths:** `acp-pipeline/**`

**Shared paths:** runners d’agents, catalogues de tickets et affichage des cycles dans Pi/VS Code.

- [ ] Un défaut local crée une branche `repair` depuis le SHA d’intégration vérifié et retourne à l’implémenteur d’origine avec son ticket, les preuves et le contexte intégré.
- [ ] La correction est réintégrée par le mergeur avant une nouvelle vérification globale.
- [ ] Un défaut transversal séparable crée plusieurs réparations parallèles ; un défaut nécessitant une conception commune crée un ticket transversal ; des frontières incorrectes déclenchent une révision du DAG.
- [ ] Une correction locale conforme au ticket ne relance pas `toTicket`.
- [ ] Une modification de périmètre ou de critères relance `toTicket`, une exigence technique incorrecte retourne à `toSpec`, et une décision utilisateur manquante retourne à `grill-me`.
- [ ] Les artefacts descendants deviennent stale lorsqu’un artefact parent est révisé.
- [ ] `toTicket` marque les anciennes implémentations `reuse`, `adapt` ou `restart` et le runtime vérifie techniquement la réutilisation proposée.
- [ ] Les limites globales et par ticket sont configurables, avec des valeurs par défaut de quatre cycles globaux et deux cycles par ticket.
- [ ] Lorsque la première limite est atteinte, le run s’arrête proprement avec la dernière branche d’intégration, les problèmes restants et l’historique des tentatives.

**Validation command:** `npm run test -w @acp-client/pipeline`

**Public seam exercised:** reprises successives de `PipelineRuntime` jusqu’à `completed` ou `failed` avec snapshot conservé.
