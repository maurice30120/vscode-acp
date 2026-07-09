# Plan : Diagnostic et correction des "freezes" de pi au lancement de `/pipeline`

## Contexte

Quand l'utilisateur lance `/pipeline run <pipeline> <prompt>` (ou le tool `run_pipeline`), l'UI de pi **semble se figer** : plus aucun retour, la commande ne rend pas la main, parfois indéfiniment. Ce document explique **pourquoi** à partir du code actuel de `plugin-pi` et `@acp-client/pipeline`, puis propose un plan de correction décision-complet.

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
                                └─ connection.prompt()   (await JSON-RPC, peut durer des minutes)
```

Tout ce chemin est **une chaîne d'`await` bloquants** tenue par le handler de commande pi. Tant que `prompt()` ne résout pas, la commande ne rend pas la main.

## Scope

- Diagnostiquer et corriger les causes de gel perçu et réel de `/pipeline`.
- Couvrir : absence de timeout, non-propagation de la mort du process enfant, absence de feedback UI en streaming, blocage permission/auth, recréation du controller en cours de run.

## Out of scope

- Réécriture de `@acp-client/pipeline` (uniquement gardes-fous côté adapter `plugin-pi`).
- Changement du protocole ACP / SDK.
- Refactor de la UI TUI de pi (on utilise les APIs existantes `sendMessage`/`ui.notify`).

---

## Causes racines identifiées

### 1. Aucun timeout sur `initialize()` et `prompt()` (cause principale de gel infini)

**Fichier** : `src/acp/ephemeralRunner.ts:119-136`

`connection.initialize()` puis `connection.prompt()` sont attendus **sans aucun délai maximal**. Si l'agent ACP enfant met 10 minutes à répondre, le handler pi reste bloqué 10 minutes sans rendre la main. Aujourd'hui, seul un `AbortController` explicite (cancel/dispose) peut interrompre ; aucun timeout automatique n'existe.

```ts
const response = await connected.connInfo.connection.prompt({ sessionId, prompt: [...] });
// aucun Promise.race avec timeout, aucun AbortSignal temporisé
```

### 2. La mort du process enfant n'est PAS propagée aux promesses JSON-RPC en cours (gel définitif)

**Fichiers** : `src/acp/agentProcess.ts:50-54`, `src/acp/connectionManager.ts:65-78`, `src/acp/ephemeralRunner.ts`

`AgentProcessManager` écoute `child.on('close')` et `child.on('error')` mais **ne fait que logger + émettre un event**. Rien ne rejette la promesse en cours sur `connection.initialize()` ou `connection.prompt()`.

Conséquence : si l'agent crashe (exit non zéro, ENOENT, SIGSEGV, OOM) pendant l'initialize ou le prompt, le stream ndJson ne reçoit jamais de réponse → l'`await` **ne résout jamais** → `/pipeline` reste figé **indéfiniment**. Le `finally` de `runAgent` ne s'exécute pas non plus (la promesse est pendante), donc le listener abort et le handler restent attachés.

C'est le scénario "gel total" le plus grave : pas même un message d'erreur.

### 3. Aucun feedback UI pendant l'exécution (gel *perçu*)

**Fichier** : `src/runtime/pipelineController.ts:62-76`, `src/runtime/commands.ts:43-48`

- `plan-ready` → `sendDisplayMessage` (affiché).
- `status` → **logger uniquement** (`this.options.logger?.log`), jamais remonté à l'UI pi.
- `session-update` (chunks de texte de l'agent) → transmis à `input.onSessionUpdate` côté engine, mais **le controller ne les forward pas à pi** (`PipelineController` n'écoute même pas `session-update`).

Résultat : pendant toute la phase planner (potentiellement longue), l'utilisateur ne voit **rien**. Pas de spinner, pas de chunks, pas de statut. → Impression de freeze même si le pipeline travaille normalement.

on veut un feedback en streaming pour que l'utilisateur voie que le pipeline avance. 

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

**Problème** : cause #2. Un agent qui crashe pendant `initialize`/`prompt` => gel infini.

**Décision** : introduire un garde-fou dans `EphemeralAcpRunner.runAgent` qui rejette toute promesse en cours quand le process enfant se termine anormalement.

**Changements** :

- Dans `defaultConnector` (ou `EphemeralAcpRunner`), exposer l'`AgentProcessManager` / le `ChildProcess` au runner afin qu'il puisse attacher un listener `close`/`error` **qui rejette la promesse en cours**.
- Concrètement : créer une `Promise` gardée (`let initializeReject`, `let promptReject`) et, sur `close`/`error` du child avant fin, appeler le reject courant avec une `AgentProcessDiedError(code|signal)`.
- Nettoyer ces listeners dans le `finally` existant.
- Alternative plus propre : wrapper `connection.initialize()` et `connection.prompt()` dans un helper `withProcessGuard(child, promise)` qui `Promise.race` la promesse JSON-RPC avec une promesse qui reject à la mort du child.

**Fichiers** :

- `src/acp/ephemeralRunner.ts`
- `src/acp/defaultConnector.ts` (exposer le child / un hook `onProcessDied`)
- `src/acp/agentProcess.ts` (exposer un event typé `died` exploitable, déjà émet `agent-closed`/`agent-error`)
- Nouveau test : simuler un child qui exit(code=1) pendant `initialize` → `runAgent` rejette rapidement (sous 1s), pas de pendage.

**Critères d'acceptation** :

- Un agent qui crash mid-run lève une erreur explicite en < 1s au lieu de geler.
- `finally` s'exécute, listeners retirés, process tué.
- Nouveau test unitaire vert.

---

### Étape 2 — Ajouter un timeout par step (initialize + prompt) (priorité BLOQUANTE)

**Problème** : cause #1. Aucune borne temporelle.

**Décision** : ajouter un timeout configurable sur `initialize` et `prompt`, implémenté via `AbortController` temporisé branché sur le `signal` existant de l'input + rejet par timeout.

**Changements** :

- `EphemeralAcpRunnerOptions` : ajouter `timeouts?: { initializeMs?: number; promptMs?: number }` (défauts : initialize 30s, prompt 10min, surchargeables par config).
- Dans `runAgent`, créer un `AbortController` local combiné (parent = `input.signal`, + timer) ; utiliser `AbortSignal.any([input.signal, timeoutSignal])` (Node ≥ 22 OK).
- Sur timeout : appeler `connected.connInfo.connection.cancel({ sessionId })`, `dispose()`, et rejeter avec `PipelineTimeoutError` (reconnue comme non-abort pour ne pas être silenciée — ou gérée explicitement dans `PipelineRunEngine` qui déjà gère `isRunAbortedError`).
- Propager le timeout côté `PipelineController`/config (`.pi/.acp/acp-agents.json` ou `config.ts`) avec valeurs par défaut saines.
- Brancher aussi le timer sur `createSessionWithAuth` (auth flow borné).

**Fichiers** :

- `src/acp/ephemeralRunner.ts`
- `src/catalog/config.ts` (lecture `timeouts`)
- `src/runtime/pipelineController.ts` (passer options)
- Test : prompt qui ne répond jamais → rejet après `promptMs`, process tué, run marqué `error`/`cancelled`.

**Critères d'acceptation** :

- Un agent silencieux est interrompu après le timeout configuré.
- Le process enfant est tué (SIGTERM puis SIGKILL après 5s via `killAgent`).
- `npm test` vert + nouveau test timeout.

---

### Étape 3 — Remonter le streaming et les statuts à l'UI pi (priorité HAUTE, gel perçu)

**Problème** : cause #3 et #4. L'utilisateur ne voit rien pendant l'exécution.

**Décision** : `PipelineController` écoute `session-update` (chunks) et `status`, et les forward à pi via `pi.sendMessage` (display) / `ctx.ui.notify`.

**Changements** :

- Dans le constructeur de `PipelineController`, ajouter un listener `this.service.on('session-update', ...)` qui envoie un message display incrémental (chunks de l'agent). Throttle/debounce pour ne pas spammer (ex. batch tous les 200ms ou toutes les N lignes).
- Transformer le listener `status` pour qu'en plus du logger il émette un `pi.sendMessage` display (statut `running`/`planning`/`implementing`).
- Option : rendre le handler `/pipeline run` non bloquant en lançant le run en arrière-plan (`void controller.runPipeline(...)` sans await) et en notifiant via `sendMessage` à la fin. **Décision** : d'abord garder l'await mais avec streaming ; n'asyncifier que si le contrat pi l'exige (à vérifier dans la doc pi). Si le handler doit rendre la main, alors asyncifier + notifier.

**Fichiers** :

- `src/runtime/pipelineController.ts`
- `src/runtime/commands.ts` (éventuellement asyncifier)
- `src/acp/sessionUpdateHandler.ts` (vérifier le forward des chunks)

**Critères d'acceptation** :

- Pendant un run, l'utilisateur voit les chunks de l'agent s'afficher en continu.
- Les transitions de statut (`planning`, `implementing`, `reviewing`) sont visibles.
- Pas de spam UI (throttle respecté).

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

- Une permission/anth qui n'aboutit pas ne gèle plus le pipeline.
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
  - `ephemeralRunner` : child exit pendant initialize → rejet rapide (étape 1).
  - `ephemeralRunner` : prompt sans réponse → timeout (étape 2).
  - `pipelineController` : forwarding `session-update`/`status` à `sendMessage` (étape 3).
  - `index` : multi-cwd sans interruption croisée (étape 4).
  - `permissionHandler`/`authHandler` : timeout → `CANCELLED` (étape 5).
  - `agentProcess` : `loginShell: false` par défaut (étape 6).
- `npm run build` vert.
- Test manuel : `/pipeline run ...` sur un agent lent → feedback visible, terminaison garantie même si l'agent crashe.

## Risques

- Timeout trop court sur de gros pipelines légitimes → valeurs par défaut généreuses (prompt 10min) + surchargeable.
- Asyncification du handler (étape 3 option) peut changer le contrat pi → vérifier doc pi avant ; sinon garder await + streaming.
- `AbortSignal.any` nécessite Node ≥ 20 (OK, `engines` = `>=22.19.0`).
- Multi-controller (étape 4) : veiller à disposer pour éviter fuite de processes enfants.

## Vérification initiale (référence)

- Code lu : `src/runtime/{commands,pipelineController,tool}.ts`, `src/acp/{ephemeralRunner,defaultConnector,connectionManager,agentProcess,permissionHandler,authHandler}.ts`, `src/index.ts`, `@acp-client/pipeline` `PipelineService`/`PipelineRunEngine`/`PipelineExecutor`.
- Aucun fichier modifié par ce plan (document de plan uniquement).
