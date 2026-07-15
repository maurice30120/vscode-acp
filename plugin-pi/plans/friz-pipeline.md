# Plan : Diagnostic et correction des "freezes" de pi au lancement de `/pipeline`

## Contexte

Quand l'utilisateur lance `/pipeline run <pipeline> <prompt>` (ou le tool `run_pipeline`), l'UI de pi peut **sembler se figer** ou rester bloquée indéfiniment si un appel ACP ne revient jamais. Ce document explique **pourquoi** à partir du code actuel de `plugin-pi` et `@acp-client/pipeline`, puis propose un plan de correction décision-complet.

Le cheminement d'exécution concerné :

```
commands.handlePipelineCommand (handler asynchrone, await)
  └─ PipelineController.runPipeline (await)
       └─ PipelineService.createPlan (await)
            └─ PipelineRunEngine.createPlan
                 └─ graphCoordinator.invokeInitial (LangGraph, await)
                      └─ PipelineExecutor.runStep
                           └─ EphemeralAcpRunner.runAgent (await)
                                ├─ defaultAcpConnector : spawn child process
                                ├─ connection.initialize() (await JSON-RPC)
                                ├─ connection.newSession() / authenticate() (await JSON-RPC/UI)
                                └─ connection.prompt()   (await JSON-RPC, peut durer des minutes)
```

Tout ce chemin est **une chaîne d'`await` longs** tenue par le handler de commande pi. Le code courant remonte déjà des statuts, du streaming agent et un heartbeat via `PipelineController`, ce qui limite le freeze perçu. En revanche, si `initialize()`, `newSession()`, `authenticate()`, `prompt()` ou une interaction UI ne résout jamais, la commande ne rend pas la main.

## Scope

- Diagnostiquer et corriger les causes de gel perçu et réel de `/pipeline`.
- Couvrir : absence de timeout, non-propagation de la mort du process enfant, blocage permission/auth, recréation du controller en cours de run.
- Vérifier et consolider le feedback UI existant (`status`, `session-update`, heartbeat), sans le reconstruire de zéro.

## Out of scope

- Réécriture de `@acp-client/pipeline` (uniquement gardes-fous côté adapter `plugin-pi`).
- Changement du protocole ACP / SDK.
- Refactor de la UI TUI de pi (on utilise les APIs existantes `sendMessage`/`ui.notify`).

---

## Causes racines identifiées

### 1. Aucun timeout sur les appels ACP longs (cause principale de gel infini)

**Fichiers** : `src/acp/connectionManager.ts:68-81`, `src/acp/ephemeralRunner.ts:141-156`, `src/acp/authHandler.ts`

`connection.initialize()`, `connection.newSession()`, `connection.authenticate()` et `connection.prompt()` sont attendus **sans aucun délai maximal**. Si l'agent ACP enfant met 10 minutes à répondre, le handler pi reste actif 10 minutes. S'il ne répond jamais, le run reste suspendu. Aujourd'hui, seul un `AbortController` explicite (cancel/dispose) peut tenter d'interrompre ; aucun timeout automatique n'existe.

```ts
const response = await connected.connInfo.connection.prompt({ sessionId, prompt: [...] });
// aucun Promise.race avec timeout, aucun AbortSignal temporisé
```

### 2. La mort du process enfant n'est PAS propagée aux promesses JSON-RPC en cours (gel définitif)

**Fichiers** : `src/acp/agentProcess.ts:50-54`, `src/acp/connectionManager.ts:65-78`, `src/acp/ephemeralRunner.ts`

`AgentProcessManager` écoute `child.on('close')` et `child.on('error')` mais **ne fait que logger + émettre un event**. Rien ne rejette la promesse en cours sur `connection.initialize()`, `connection.newSession()`, `connection.authenticate()` ou `connection.prompt()`.

Conséquence : si l'agent crashe (exit non zéro, ENOENT, SIGSEGV, OOM) pendant l'initialize ou le prompt, le stream ndJson ne reçoit jamais de réponse → l'`await` **ne résout jamais** → `/pipeline` reste figé **indéfiniment**. Le `finally` de `runAgent` ne s'exécute pas non plus (la promesse est pendante), donc le listener abort et le handler restent attachés.

C'est le scénario "gel total" le plus grave : pas même un message d'erreur.

### 3. Feedback UI existant mais à conserver/tester (gel *perçu*)

**Fichier** : `src/runtime/pipelineController.ts`

- `plan-ready` → `sendDisplayMessage` (affiché).
- `status` → `handleStatusEvent` → `sendDisplayMessage`.
- `session-update` → `handleSessionUpdateEvent` → chunks bufferisés/throttlés.
- Heartbeat toutes les 15s par défaut quand aucune activité récente n'est vue.

Le risque initial "aucun feedback" est donc **déjà partiellement corrigé dans le code courant**. Le plan ne doit pas réimplémenter cette couche, mais la couvrir par tests et vérifier que les messages apparaissent bien dans les phases longues.

Le gel perçu peut encore exister pendant les phases sans événement agent avant le premier statut visible, ou si le handler de commande pi empêche réellement toute interaction malgré les `sendMessage`.

### 4. Le handler de commande pi bloque sur un `await` long sans rendre la main

**Fichier** : `src/runtime/commands.ts:43`

```ts
const result = await controller.runPipeline(parsed.pipelineName, parsed.prompt, ctx);
```

`runPipeline` est awaited de bout en bout. Selon le contrat commande de pi, un handler qui `await` une opération longue sans yielding/UI update gèle la boucle d'interaction. Il faudrait soit rendre la main rapidement (lancer le run en arrière-plan et notifier via `sendMessage`), soit garantir du feedback en streaming.

### 5. Recréation/dispose du controller en cours de run sur changement de cwd

**Fichier** : `src/index.ts:12-23`

```ts
const getController = (cwd: string): PipelineController => {
  if (!controller || controllerCwd !== cwd) {
    void controller?.dispose();   // ← abort le run en cours !
    controller = new PipelineController(cwd, pi, { logger: consoleLogger });
    controllerCwd = cwd;
  }
  return controller;
};
pi.on("session_start", (_event, ctx) => { getController(ctx.cwd); });
```

`session_start` peut se déclencher avec un `ctx.cwd` différent (autre workspace, sous-dossier) pendant qu'un pipeline tourne. `dispose()` → `service.dispose()` → `abortController.abort()` sur tous les runs + émet `cancelled`. L'utilisateur voit son pipeline "s'arrêter" sans raison claire, ou un état incohérent (run en cours mais controller neuf sans registre). Effet perçu : gel/instabilité.

### 6. Blocage potentiel sur `PermissionHandler` et `SessionAuthHandler`

**Fichiers** : `src/acp/permissionHandler.ts:20-26`, `src/acp/authHandler.ts`

- `PermissionHandler.requestPermission` fait `await ctx.ui.select(...)` **sans timeout**. Si la modale ne s'affiche pas (contexte sans UI mal détecté, race condition) ou n'est jamais fermée, l'agent ACP reste bloqué en attente de permission → `prompt()` ne termine jamais → gel.
- `createSessionWithAuth` → `authHandler.runAuthFlow` peut ouvrir un flow browser/interaction longue, lui aussi sans timeout ni cancellation robuste.

Note : `if (!ctx?.hasUI) return CANCELLED` couvre le cas headless, mais pas le cas "UI présente mais select qui ne revient jamais".

### 7. Spawn via login shell `-l` (lenteur/instabilité au démarrage)

**Fichier** : `src/acp/agentProcess.ts:92-101`, `resolveUnixShell`

`spawnUnix` utilise `['-l', '-c', commandStr]` (login shell) pour zsh/bash/ksh. Un login shell source les fichiers de profil (`~/.zshrc`, `~/.zprofile`, etc.). Si un profil est lent (nvm, pyenv, appels réseau, prompt interactif), l'agent met du temps à démarrer → fenêtre d'initialize allongée → freeze perçu pendant l'initialize. Sans timeout (cause #1), un profil qui **bloque** (prompt de passphrase, attend une entrée stdin) = gel infini.

### 8. Buffer stdio et backpressure

**Fichier** : `src/acp/agentProcess.ts:38-43`

`stderr` est consommé via `on('data')` (drainé). `stdout` est consommé par `ndJsonStream`. En théorie drainés, mais si l'agent écrit massivement sur stderr entre deux lignes JSON, le logger synchrone peut ralentir le drain. Moins critique que #1/#2 mais contribue aux lenteurs.

---

## Plan de correction (décision-complet)

### Étape 1 — Propager la mort du process enfant vers les promesses JSON-RPC (priorité BLOQUANTE)

**Problème** : cause #2. Un agent qui crashe pendant `initialize`/`newSession`/`authenticate`/`prompt` => gel infini.

**Décision** : introduire un garde-fou de cycle de vie process au plus près du process enfant. Le connector/`ConnectionManager` doit l'utiliser pendant `initialize()`, puis exposer le même garde à `EphemeralAcpRunner` pour `newSession()`, `authenticate()` et `prompt()`.

**Changements** :

- Créer un garde typé côté `defaultAcpConnector`, par exemple `processExit: Promise<AgentProcessExit>` ou `onProcessDied(listener): Disposable`, branché sur les événements `agent-error` / `agent-closed` de `AgentProcessManager`.
- Utiliser ce garde **dans `ConnectionManager.connect()` ou dans `defaultAcpConnector` autour de `connectionManager.connect(...)`** pour couvrir `initialize()`, qui se produit avant le retour de `ConnectedAcpAgent`.
- Étendre `ConnectedAcpAgent` avec le même garde pour les phases suivantes. Éviter d'exposer directement `ChildProcess` au runner sauf nécessité.
- `sandcastleConnector` expose le même contrat si son process bridge peut mourir pendant un appel ACP.
- Concrètement : wrapper chaque appel long (`initialize`, `newSession`, `authenticate`, `prompt`) avec un helper `withProcessGuard(processGuard, label, promise)` qui `Promise.race` la promesse JSON-RPC avec une promesse rejetée à la mort du process.
- L'erreur doit être explicite : `AgentProcessDiedError(agentName, code, signal, phase)`.
- Nettoyer ces listeners dans le `finally` existant.

**Fichiers** :

- `src/acp/ephemeralRunner.ts`
- `src/acp/connectionManager.ts` ou `src/acp/defaultConnector.ts` pour garder `initialize()`
- `src/acp/defaultConnector.ts` (exposer un hook/process guard typé)
- `src/acp/agentProcess.ts` (exposer un event typé `died` exploitable, déjà émet `agent-closed`/`agent-error`)
- `src/acp/sandcastleConnector.ts` si le bridge doit participer au même contrat.
- Nouveau test : simuler un child qui exit(code=1) pendant `initialize` et pendant `prompt` → `runAgent` rejette rapidement (sous 1s), pas de promesse pendante.

**Critères d'acceptation** :

- Un agent qui crash mid-run lève une erreur explicite en < 1s au lieu de geler.
- `finally` s'exécute, listeners retirés, process tué.
- Nouveau test unitaire vert.

---

### Étape 2 — Ajouter des timeouts sur les appels ACP/UI longs (priorité BLOQUANTE)

**Problème** : cause #1. Aucune borne temporelle.

**Décision** : ajouter des timeouts configurables sur `initialize`, `newSession`, `authenticate`, `prompt`, les permissions et la promotion/auth UI. Implémenter via `Promise.race` + cleanup/cancel, en respectant le `signal` existant de l'input.

**Changements** :

- `EphemeralAcpRunnerOptions` : ajouter `timeouts?: { initializeMs?: number; newSessionMs?: number; authenticateMs?: number; promptMs?: number; permissionMs?: number; authUiMs?: number; promotionUiMs?: number }`.
- Défauts proposés : initialize 30s, newSession 30s, authenticate 2min, prompt 10min, permission 5min, auth UI 10min, promotion UI 10min.
- Introduire un helper commun `withTimeout(label, ms, promise, onTimeout?)`.
- Sur timeout de `prompt` : appeler `connected.connInfo.connection.cancel({ sessionId })` si `sessionId` existe, puis `dispose()`, puis rejeter avec `PipelineTimeoutError`.
- Sur timeout de `initialize`/`newSession`/`authenticate` : `dispose()` et rejeter avec `PipelineTimeoutError`.
- Le timeout doit être distingué d'un abort utilisateur : il ne doit pas être masqué par `isRunAbortedError`.
- Propager le timeout côté `PipelineController`/config (`.pi/.acp/acp-agents.json` ou `config.ts`) avec valeurs par défaut saines.
- Brancher les timeouts UI dans `PermissionHandler`, `SessionAuthHandler` et la promotion Sandcastle (`requestSandcastlePromotion`).

**Fichiers** :

- `src/acp/ephemeralRunner.ts`
- `src/acp/connectionManager.ts`
- `src/acp/permissionHandler.ts`
- `src/acp/authHandler.ts`
- `src/catalog/config.ts` (lecture `timeouts`)
- `src/runtime/pipelineController.ts` (passer options)
- Test : prompt qui ne répond jamais → rejet après `promptMs`, process tué, run marqué `error`.
- Test : `newSession` ou `authenticate` qui ne répond jamais → rejet après timeout.

**Critères d'acceptation** :

- Un agent silencieux est interrompu après le timeout configuré.
- Le process enfant est tué (SIGTERM puis SIGKILL après 5s via `killAgent`).
- Timeout visible comme erreur explicite et non comme annulation utilisateur.
- `npm test` vert + nouveau test timeout.

---

### Étape 3 — Consolider le feedback UI existant (priorité HAUTE, gel perçu)

**Problème** : cause #3 et #4. Le code courant remonte déjà les statuts, chunks et heartbeats, mais cette garantie doit être protégée par tests et vérifiée contre le vrai contrat de commande Pi.

**Décision** : ne pas réimplémenter le streaming. Ajouter des tests de non-régression et vérifier si le handler `/pipeline run` peut rester `await` avec `sendMessage` streaming, ou doit rendre la main immédiatement.

**Changements** :

- Ajouter/mettre à jour les tests `PipelineController` :
  - `status` actif → `pi.sendMessage` avec `kind: activity-status`.
  - `session-update` texte → buffer flush + `pi.sendMessage` avec `agent-message-chunk` / `agent-thought-chunk`.
  - absence d'update pendant `heartbeatIntervalMs` → message heartbeat.
- Vérifier manuellement dans Pi que `sendMessage(display: true)` s'affiche pendant que le command handler est encore en `await`.
- Si Pi ne rend pas l'UI interactive malgré les messages : transformer `/pipeline run` en run arrière-plan avec registre de session, notification finale et erreurs envoyées via `sendMessage`.

**Fichiers** :

- `src/runtime/pipelineController.ts`
- `src/runtime/commands.ts` (éventuellement asyncifier)
- Tests runtime associés.

**Critères d'acceptation** :

- Pendant un run, l'utilisateur voit les chunks de l'agent s'afficher en continu.
- Les transitions de statut (`planning`, `implementing`, `reviewing`) sont visibles.
- Pas de spam UI (throttle respecté).
- Le heartbeat apparaît pendant les phases longues sans chunk.

---

### Étape 4 — Stabiliser le cycle de vie du controller (priorité MOYENNE)

**Problème** : cause #5. `session_start` avec cwd différent détruit le controller en cours de run.

**Décision** : ne pas disposer un controller qui a un run actif ; garder un controller **par cwd** au lieu d'un singleton global.

**Changements** :

- Remplacer `controller`/`controllerCwd` par une `Map<cwd, PipelineController>` dans `index.ts`.
- `getController(cwd)` retourne/crée celui du cwd sans toucher aux autres.
- `session_shutdown` ne dispose que le controller de la session concernée, ou dispose tous les controllers inactifs (GC : dispose si aucun run actif).
- `dispose` d'un controller avec run actif : abort explicite + log clair "Pipeline annulé : session fermée".

**Fichiers** :

- `src/index.ts`
- Test : deux workspaces, pipeline lancé dans A, `session_start` sur B n'interrompt pas A.

**Critères d'acceptation** :

- Un `session_start` sur un autre cwd ne tue pas un pipeline en cours ailleurs.
- Pas de fuite : controllers inactifs disposés.

---

### Étape 5 — Borner permission et auth (priorité MOYENNE)

**Problème** : cause #6. `ui.select` et auth flow sans timeout.

**Décision** : ajouter un timeout sur les interactions permission/auth et un chemin "annulation propre" si la modale ne revient pas.

**Changements** :

- `PermissionHandler.requestPermission` : `Promise.race` entre `ctx.ui.select(...)` et un timeout (ex. 5 min configurable) → renvoyer `CANCELLED` au-delà, log "permission timed out".
- `SessionAuthHandler.runAuthFlow` : timeout d'auth (ex. 10 min) + respect du `signal` abort.
- Rendre les timeouts configurables via `config.ts`.

**Fichiers** :

- `src/acp/permissionHandler.ts`
- `src/acp/authHandler.ts`
- `src/catalog/config.ts`
- Tests : select qui ne résout pas → `CANCELLED` après timeout, pas de gel.

**Critères d'acceptation** :

- Une permission/auth qui n'aboutit pas ne gèle plus le pipeline.
- Comportement annulable via `/pipeline cancel`.

---

### Étape 6 — Atténuer le login shell (priorité BASSE)

**Problème** : cause #7. `-l` source des profils potentiellement lents/bloquants.

**Décision** : rendre le login shell opt-out et capter les cas bloquants via le timeout de l'étape 2.

**Changements** :

- `NativeAcpAgentConfig` : ajouter `loginShell?: boolean` (défaut : `false` pour les ACP agents, car ils n'ont généralement pas besoin du profil utilisateur ; `true` opt-in).
- `spawnUnix` : respecter ce flag (`['-l','-c',...]` vs `['-c',...]`).
- Documenter que les agents qui ont besoin de PATH/ENV du profil doivent mettre `loginShell: true`.
- Le timeout d'initialize (étape 2) protège contre un profil bloquant.

**Fichiers** :

- `src/acp/agentProcess.ts`
- `src/types.ts` (type `NativeAcpAgentConfig`)
- `src/catalog/config.ts` (lecture du flag)
- Test : spawn sans login shell démarre plus vite ; avec login shell bloquant → timeout.

**Critères d'acceptation** :

- Démarrage agent plus rapide par défaut.
- Profil bloquant => timeout propre, pas de gel.

---

## Test Plan

- `npm test` (plugin-pi) : tests existants verts + nouveaux tests :
  - `ephemeralRunner`/`connectionManager` : child exit pendant initialize/newSession/prompt → rejet rapide (étape 1).
  - `ephemeralRunner`/`connectionManager`/`authHandler` : prompt, newSession ou authenticate sans réponse → timeout (étape 2).
  - `pipelineController` : forwarding `session-update`/`status` + heartbeat à `sendMessage` (étape 3).
  - `index` : multi-cwd sans interruption croisée (étape 4).
  - `permissionHandler`/`authHandler` : timeout → `CANCELLED` (étape 5).
  - `agentProcess` : `loginShell: false` par défaut (étape 6).
- `npm run build` vert.
- Test manuel : `/pipeline run ...` sur un agent lent → feedback visible, terminaison garantie même si l'agent crashe.

## Risques

- Timeout trop court sur de gros pipelines légitimes → valeurs par défaut généreuses (prompt 10min) + surchargeable.
- Asyncification du handler (étape 3 option) peut changer le contrat pi → vérifier le comportement réel Pi avant ; sinon garder await + streaming existant.
- `AbortSignal.any` nécessite Node ≥ 20 (OK, `engines` = `>=22.19.0`).
- Multi-controller (étape 4) : veiller à disposer pour éviter fuite de processes enfants.
- Exposer directement `ChildProcess` depuis le connector augmenterait le couplage ; préférer un contrat typé `processExit`/`onProcessDied`.

## Vérification initiale (référence)

- Code relu le 2026-07-15 : `src/runtime/{commands,pipelineController,tool}.ts`, `src/acp/{ephemeralRunner,defaultConnector,connectionManager,agentProcess,permissionHandler,authHandler}.ts`, `src/index.ts`, `@acp-client/pipeline` `PipelineService`/`PipelineRunEngine`/`PipelineExecutor`.
- Mise à jour importante : `PipelineController` contient déjà le forwarding `status`/`session-update` et un heartbeat. Le plan actualisé traite ce point comme consolidation/test, pas comme fonctionnalité absente.
- Aucun code modifié par ce plan (document de plan uniquement).
