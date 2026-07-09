# ADR-0009 : Sandcastle éphémère sous `.pi/.acp/.sandcastle`, promotion via le canal d'approbation pipeline

**Statut** : Acceptée

## Contexte

Ajout du transport `sandcastle` (agent en Docker + worktree Git jetable) à `plugin-pi`. `plugin-vscode` possède déjà une couche `src/sandcastle/` mature. Plusieurs décisions corrélées et difficiles à défaire : l'emplacement de la config, le modèle runtime, et comment l'humain approuve la promotion des changements de la sandbox vers le workspace.

## Décision

1. **Runtime éphémère** : un run Sandcastle = un process bridge ACP né et mort pour ce run, sans session persistante. On ne porte pas la couche « ConnectedAgent longue durée » de `plugin-vscode` (`SandcastleAcpAgent`, `BridgeConversation`, `PromptHistory`), seulement : `BridgeConfig` + garde Docker/worktree + `WorktreePromotion` + `PromotionPolicy` + `bridge.ts` lancé en process séparé.

2. **Config séparée** sous `.pi/.acp/.sandcastle/config.json` : top-level `promotion` (`ask` | `autoApply` | `autoReject`) + `agents` (Sandcastle-only, chaque entrée portant `transport: 'sandcastle'` requis). `acp-agents.json` reste natif-only ; si `transport: 'sandcastle'` y apparaît → rejet pointant vers le fichier dédié. Un doublon de nom d'agent entre les deux fichiers est une erreur.

3. **`sideEffects` est une propriété du *run*, pas de l'agent** — portée par l'input de run (`PipelineAgentRunInput`), pas par la config agent.

4. **Spawn et routing** : `EphemeralAcpRunner` route selon `config.transport`. Nouveau `sandcastleConnector` spawn `node dist/.../bridge.js --provider --model --effort` avec `ACP_SANDCASTLE_IMAGE`, puis `ConnectionManager.connect` (ACP stdio, réutilisé) — le bridge parle ACP, le reste du runner est inchangé. Le natif via `defaultAcpConnector` ne bouge pas.

5. **Promotion** : outcomes `'applied' | 'no_changes' | 'rejected' | 'cancelled'` tels quels (symétrie avec vscode). `ask` sans UI Pi → outcome `cancelled` + discard, pipeline arrêt sans mutation. `ask` avec UI Pi → réutilisation du **canal d'approbation pipeline** (ADR-0005) : `approve` ≈ Apply, `reject` ≈ Reject, dismiss ≈ `cancelled`. **Pas de View Diff interactif** en v1.

6. **`isAgentSandcastle`** : branché par one-liner dans les deps du `PipelineService` (symétrie avec vscode) pour que le message `plan_ready` porte « approve before Sandcastle implementation » quand l'implémenteur est Sandcastle. Pas de rendu verbose supplémentaire.

## Considérations

- **Considérées**: (a) fichier unique `acp-agents.json` avec discriminant `transport` — rejeté pour ne pas couple le parser natif à la forme Sandcastle ; (b) `transport: 'sandcastle'` implicite dans le fichier dédié — rejeté par sécurité du discriminant et symétrie avec vscode ; (c) connector unifié — rejeté pour propager la union Native|Sandcastle partout ; (d) canal de promotion neuf — rejeté pour réutiliser ADR-0005 ; (e) View Diff interactif — écarté pour v1 (trop complexe côté UI Pi).
- **Conséquences**: le pipeline headless (pas d'UI Pi) en mode `ask` s'arrête proprement (`cancelled`), sans crash. Le signal pré-approbation « run Sandcastle » est porté par le message ADR-0005 existant.
