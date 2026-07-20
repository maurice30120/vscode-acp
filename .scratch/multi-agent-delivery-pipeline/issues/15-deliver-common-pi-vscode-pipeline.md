# 15 — Livrer le pipeline commun dans Pi et VS Code

**Identifier:** T15

**What to build:** Packager le workflow complet comme pipeline partagé et permettre à Pi et VS Code de démarrer, approuver, inspecter, annuler et reprendre le même run sans dupliquer la logique métier.

**Blocked by:** 03 — Exécuter `grill-me` → `toSpec` → `toTicket` avec deux approbations; 04 — Compiler le graphe de tickets approuvé en sous-DAG exécutable; 06 — Planifier les rôles avec une concurrence adaptative; 08 — Intégrer adaptativement les groupes avec des agents de merge; 09 — Exécuter les validations de checkpoint et attribuer les échecs; 10 — Réconcilier la dérive de la branche source avant vérification; 11 — Vérifier l’intégration dans une session indépendante et read-only; 12 — Router les réparations avec des cycles bornés; 13 — Promouvoir uniquement une intégration validée; 14 — Reprendre les runs et agents interrompus.

**Status:** ready-for-agent

**Owned paths:** `plugin-pi/**`, `plugin-vscode/**`, définitions de pipeline embarquées.

**Shared paths:** exports publics de `acp-pipeline/**`, configuration d’agents et documentation utilisateur.

- [ ] Un pipeline embarqué représente la chaîne grill → spec → tickets → implémentations parallèles → merge → vérification → réparation → promotion.
- [ ] Les valeurs par défaut utilisent Sandcastle pour les rôles qui écrivent, un vérificateur read-only, squash par ticket, dérive `integrate`, promotion `pull-request` et limites de réparation bornées.
- [ ] Pi permet de répondre au grill, approuver la spec, approuver les tickets, inspecter l’activité, annuler et reprendre un run.
- [ ] VS Code expose les mêmes décisions et états métier à travers son adapter et sa webview existante.
- [ ] Aucun hôte ne calcule la frontière des tickets, ne choisit les groupes de merge, ne dérive le verdict ou ne possède la reprise.
- [ ] Les deux hôtes utilisent les mêmes contrats de messages et les mêmes identifiants de run, pause, ticket et checkpoint.
- [ ] Un scénario end-to-end couvre au moins deux tickets parallèles, un ticket dépendant, un conflit résolu par le mergeur, un échec de vérification, une réparation ciblée et une promotion finale.
- [ ] Les tests prouvent qu’un run commencé dans un hôte peut être inspecté puis repris dans l’autre avec un store partagé.
- [ ] La documentation décrit la configuration des rôles, de la concurrence, des validations, de la dérive, des cycles de réparation, de la persistance et de la promotion.

**Validation command:** `npm test`

**Public seam exercised:** expérience complète d’un utilisateur Pi ou VS Code pilotant le même `PipelineRuntime`.
