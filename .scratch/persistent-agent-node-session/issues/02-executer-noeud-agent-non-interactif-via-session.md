# 02 — Exécuter un nœud agent non interactif via AgentNodeSession

**What to build:** Un nœud agent Pipeline V3 ordinaire utilise une session par tentative, ferme la session en succès, échec ou annulation, et conserve la sémantique `retry.maxAttempts` sans replay implicite.

**Blocked by:** 01 — Introduire le contrat AgentNodeSession dans le Runtime partagé.

**Status:** done

- [x] Chaque tentative d'un nœud agent non interactif ouvre sa propre `AgentNodeSession`.
- [x] Une rupture de transport d'un nœud non interactif est classée comme échec technique retryable quand l'Adapter hôte le permet.
- [x] Le budget `retry.maxAttempts` continue de borner les tentatives et aucune reprise automatique par replay n'est déclenchée.
- [x] La session active est fermée après succès, échec terminal ou annulation.

## Comments

- Implémenté dans `acp-pipeline/src/PipelineRuntime.ts` via une `AgentNodeSession` ouverte dans la boucle de tentative non interactive, fermée en `finally`, avec retry uniquement sur les diagnostics retryable retournés par l'Adapter hôte.
- Couvert par `PipelineRuntime opens and closes one AgentNodeSession per non-interactive attempt` et `PipelineRuntime closes a non-interactive AgentNodeSession when send throws`.
- Vérification: `npm run test -w @acp-client/pipeline`.
