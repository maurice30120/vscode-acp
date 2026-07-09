# Ajouter Sandcastle à plugin-pi

## Summary

Ajouter le support des agents `transport: "sandcastle"` dans `plugin-pi`, en s'inspirant de `plugin-vscode`, sans modifier le comportement natif existant. Les configs Sandcastle seront lues depuis `.pi/.acp/.sandcastle/config.json`, avec `ask` par défaut pour la promotion et `autoApply` / `autoReject` configurables.

## Key Changes

- Config publique :
  - Ajouter `.pi/.acp/.sandcastle/config.json` :

    ```json
    {
      "promotion": "ask",
      "agents": {
        "Codex Sandcastle": {
          "transport": "sandcastle",
          "provider": "codex",
          "model": "gpt-5",
          "effort": "medium",
          "env": {},
          "skills": true
        }
      }
    }
    ```

  - Garder `.pi/.acp/acp-agents.json` pour les agents ACP natifs uniquement.
  - Si `transport: "sandcastle"` apparaît dans `acp-agents.json`, continuer à rejeter la config, avec un message pointant vers `.pi/.acp/.sandcastle/config.json`.
  - Fusionner les agents natifs et Sandcastle pour la validation des pipelines ; un nom dupliqué entre les deux fichiers est une erreur.

- Runtime Sandcastle Pi :
  - Ajouter à `plugin-pi` une tranche Sandcastle adaptée de `plugin-vscode` : bridge ACP, runtime Docker, worktree Git, preview/apply/reject, policy de promotion.
  - Ajouter la dépendance `@ai-hero/sandcastle` à `plugin-pi`.
  - Étendre les types `NativeAcpAgentConfig` / `SandcastleAgentConfig` / `PiAgentConfigEntry` et ajouter `isSandcastleAgentConfig`.
  - Modifier le spawn agent pour lancer le bridge Sandcastle via `node dist/src/sandcastle/bridge.js --provider ... --model ...`, sinon garder le spawn ACP natif actuel.

- Exécution pipeline :
  - `EphemeralAcpRunner` route selon le type d'agent.
  - Pour un agent Sandcastle avec `sideEffects: "none"`, le sandbox est toujours rejeté/discard après le run.
  - Pour `sideEffects: "workspace"`, appliquer la promotion :
    - `ask` : si UI Pi disponible, proposer `View Diff`, puis `Apply` / `Reject`.
    - `ask` sans UI : rejeter le sandbox et retourner `promotion: "cancelled"` pour arrêter la suite du pipeline sans mutation.
    - `autoApply` : appliquer via `sandcastle/apply`; erreur si `git apply --check` échoue.
    - `autoReject` : rejeter et retourner `promotion: "rejected"`.
  - Brancher `isAgentSandcastle` dans `PipelineService` côté `plugin-pi` pour conserver les statuts `implementerUsesSandcastle`.

- Docs :
  - Mettre à jour `plugin-pi/README.md` avec le nouveau fichier `.pi/.acp/.sandcastle/config.json`, un exemple de pipeline utilisant `Codex Sandcastle`, et le comportement de promotion.
  - Ajouter/mettre à jour un ADR Pi pour préciser que Sandcastle reste sous `.pi/.acp/.sandcastle`.

## Test Plan

- Config/catalogue :
  - config Sandcastle absente : comportement natif inchangé.
  - config Sandcastle valide : agents fusionnés et utilisables dans un pipeline.
  - provider/model/effort/promotion invalides : erreurs explicites.
  - agent Sandcastle dans `acp-agents.json` : rejet avec chemin correct.
  - doublon natif/Sandcastle : erreur et pipeline ignoré.

- Runner/promotion :
  - Sandcastle `sideEffects: none` appelle `sandcastle/reject`.
  - `autoApply` appelle `preview` puis `apply` et retourne `promotion: "applied"` ou `no_changes`.
  - `autoReject` appelle `reject` et arrête la suite du pipeline.
  - `ask` avec UI applique/rejette selon choix.
  - `ask` sans UI retourne `cancelled`.
  - permissions ACP auto-approuvées pour le bridge Sandcastle.

- Validation :
  - `npm run test:pi`.
  - Optionnel smoke manuel Docker avec un pipeline réel Sandcastle si l'image `acp-client-sandcastle:local` et les credentials sont disponibles.

## Assumptions

- On ne refactorise pas `plugin-vscode` dans cette étape ; on porte le minimum utile dans `plugin-pi` pour limiter le risque.
- Le chemin retenu est `.pi/.acp/.sandcastle/config.json`, pas `.pi/pipeline/.sandcastle`.
- Les pipelines continuent d'être déclarés dans `.pi/.acp/pipelines/*.yaml`.
