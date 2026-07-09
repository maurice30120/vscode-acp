# Tickets: Transport Sandcastle éphémère dans plugin-pi

Ajouter le transport Sandcastle (Docker + worktree jetable) à `plugin-pi`, exécuté comme un run éphémère. Source spec : `plans/sandcastle-spec.md`. ADRs contraignantes : `adr/0008-*` (autonomie, duplication intentionnelle), `adr/0009-*` (six sous-décisions corrélées). Glossaire : `CONTEXT.md`.

Travailler la **frontière** : tout ticket dont les blockers sont tous faits. Après #1, les tickets #2 et #4 sont parallélisables. Un ticket par `/implement`, contexte frais entre chaque.

## Types & config : lire `.sandcastle/config.json`

**À construire :** un utilisateur peut écrire `.pi/.acp/.sandcastle/config.json` (`promotion` + `agents`, `transport: "sandcastle"` requis par entrée) ; sa validation rejette explicitement `provider`/`model`/`effort`/`promotion` invalides et pointe vers le champ fautif. `acp-agents.json` reste natif-only : tout `transport: "sandcastle"` y est rejeté avec un message pointant vers `.pi/.acp/.sandcastle/config.json`. Un doublon de nom d'agent entre les deux fichiers est une erreur, et aucun pipeline référençant ce nom ne démarre. Les agents Sandcastle et natifs restent disjoints sauf pour cette validation de doublon. L'absence de fichier Sandcastle ne change rien au comportement natif.

**Bloqué par :** None — démarrable immédiatement.

- [ ] `parseSandcastleConfig` valide le fichier dédié (champs, `transport` requis, `promotion` global).
- [ ] `acp-agents.json` rejette `transport: "sandcastle"` avec message pointant vers le fichier dédié.
- [ ] Doublon de nom natif/Sandcastle = erreur ; pipeline référençant ce nom ignoré.
- [ ] Absence de `.sandcastle/config.json` → comportement natif inchangé (non-régression).
- [ ] Erreurs explicites pointant le champ pour `provider`/`model`/`effort`/`promotion` invalides.
- [ ] Tests au seam config-catalogue (prior art `test/configCatalog.test.ts` : `createTempWorkspace` + `writeFile` + assertions sur `errors`/`agents`).

## Spawn le bridge Sandcastle comme serveur ACP éphémère

**À construire :** un pipeline qui référence un agent Sandcastle démarre le process bridge — `node`, `bridge` avec `--provider --model --effort`, `env` portant `ACP_SANDCASTLE_IMAGE` — géré par le même `AgentProcessManager` que le natif (un run = un spawn, démoli à la fin). Le bridge parle ACP sur stdio (AgentSideConnection NDJSON), donc `ConnectionManager` existant (initialize/prompt/cancel/session-update) est réutilisé tel quel. Le runner route selon `config.transport` : `sandcastle` → `sandcastleConnector` (nouveau), sinon `defaultAcpConnector` inchangé. `sideEffects: "none"` (défaut) se solde par un discard silencieux après le run. Le runner reste ignorant du transport une fois le connector choisi ; le runtime ACP standard (AbortSignal, ADR-0006) s'applique tel quel.

**Bloqué par :** Types & config : lire `.sandcastle/config.json`

- [ ] `sandcastleConnector` spawn le bridge avec les bons `command`/`args`/`env` ; process géré par `AgentProcessManager`.
- [ ] `EphemeralAcpRunner` route sur `config.transport` vers `sandcastleConnector` vs `defaultAcpConnector` (inchangé).
- [ ] `ConnectionManager.connect` réutilisé tel quel pour initialize/prompt/cancel/session-update.
- [ ] `sideEffects: "none"` → discard silencieux, pas d'outcome, pas de mutation.
- [ ] Annulation (AbortSignal, ADR-0006) démolit le process bridge ; pas d'état zombie.
- [ ] Permissions ACP du bridge auto-approuvées.
- [ ] Tests au seam runner/routing (prior art `test/runnerController.test.ts` : connector injecté mocké, Docker mocké) ; tests unitaires secondaires sur le `command`/`args`/`env` construits au niveau `test/acpHandlers.test.ts`.

## Promotion post-run via le canal d'approbation pipeline

**À construire :** `sideEffects: "workspace"` déclenche la promotion après le run — preview, puis décision selon `promotion` (`ask`/`autoApply`/`autoReject`). Outcomes `'applied' | 'no_changes' | 'rejected' | 'cancelled'` repris tels quels (symétrie `plugin-vscode`). `ask` avec UI Pi → réutilisation du **canal d'approbation pipeline** (ADR-0005) : `approve`→`applied`, `reject`→`rejected`+discard, dismiss→`cancelled`+discard. Le message d'approbation porte les métadonnées (`filesChanged`, branche), pas de diff interactif. `autoApply` → `applied`, ou `no_changes` si aucun fichier changé, ou erreur explicite si `git apply --check` échoue (rien appliqué partiellement). `autoReject` → `rejected`, suite du pipeline s'arrête. `ask` sans UI (headless) → `cancelled`+discard (pas un crash). La distinction `cancelled` (pas de décision) ≠ `rejected` (décision explicite) est conservée.

**Bloqué par :** Spawn le bridge Sandcastle comme serveur ACP éphémère

- [ ] `sideEffects: "workspace"` déclenche preview + promotion après le run.
- [ ] `ask` avec UI → message d'approbation sur le canal pipeline (ADR-0005) ; `approve`/`reject`/dismiss mappés.
- [ ] `autoApply` → `applied` ; `no_changes` si zéro fichier ; erreur si `git apply --check` échoue.
- [ ] `autoReject` → `rejected`, pipeline arrêté.
- [ ] `ask` sans UI → `cancelled`+discard, pas de crash.
- [ ] `cancelled` ≠ `rejected` préservée dans les outcomes.
- [ ] Pas de View Diff interactif (out of scope v1 — métadonnées seules).
- [ ] Tests au seam runner/routing (`prompt` mocké, `pi.sendMessage` / canal d'approbation observé).

## `isAgentSandcastle` branché

**À construire :** brancher `isAgentSandcastle` par one-liner dans les dépendances du `PipelineService` côté Pi (symétrie avec `plugin-vscode`), de sorte que le message `plan_ready` porte « approve before Sandcastle implementation » quand l'implémenteur de l'étape est Sandcastle, et reste générique sinon. Pas de rendu verbose supplémentaire — le signal reste porté par le seul message d'approbation de plan. Le signal pré-approbation est le moment decisif (« tu vas approuver un run sandbox »).

**Bloqué par :** Types & config : lire `.sandcastle/config.json`

- [ ] `isAgentSandcastle` injecté dans les deps du `PipelineService` côté Pi (one-liner, symétrie vscode).
- [ ] Message `plan_ready` porte « approve before Sandcastle implementation » quand l'implémenteur est Sandcastle.
- [ ] Message `plan_ready` reste générique sinon (non-régression).
- [ ] Pas de rendu verbose « via Sandcastle » dans les statuts d'activité (out of scope).
- [ ] Tests au seam runner/routing (assertion du texte `plan_ready`).

## Bridge Sandcastle porté depuis plugin-vscode

**À construire :** porter par **duplication intentionnelle** (ADR-0008) la tranche utile depuis `plugin-vscode/src/sandcastle/` : `BridgeConfig` + garde Docker/worktree (`DefaultSandcastleRuntime`) + `WorktreePromotion` + `PromotionPolicy` (pure, déjà testée vscode) + `bridge.ts` lancé en process séparé. On **ne porte pas** la couche « ConnectedAgent longue durée » (`SandcastleAcpAgent`, `BridgeConversation`, `PromptHistory`) — Pi reste éphémère. Ajouter la dépendance `@ai-hero/sandcastle` à `plugin-pi` (runtime Docker/worktree externe, déjà consommé par vscode). Ce ticket rend le run Sandcastle réel (Docker non mocké), en complétant le connector défini au ticket #2.

**Bloqué par :** Spawn le bridge Sandcastle comme serveur ACP éphémère

- [ ] `BridgeConfig` porté (parsing `--provider --model --effort`, `ACP_SANDCASTLE_IMAGE`).
- [ ] `DefaultSandcastleRuntime` (Docker/worktree) porté.
- [ ] `WorktreePromotion` (preview/apply/reject) porté.
- [ ] `PromotionPolicy` (pure) portée.
- [ ] `bridge.ts` (AgentSideConnection NDJSON) porté comme point d'entrée.
- [ ] Dépendance `@ai-hero/sandcastle` ajoutée à `plugin-pi/package.json`.
- [ ] Couche ConnectedAgent longue durée **non** portée (éphémère seulement).
- [ ] Smoke Docker manuel optionnel (image `acp-client-sandcastle:local` si disponible) ; non requis par les tests automatisés.
