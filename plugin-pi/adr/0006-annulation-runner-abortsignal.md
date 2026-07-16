# ADR-0006 : Annulation des runs ACP via AbortSignal

**Statut** : Acceptée

## Contexte

Un pipeline Pi peut être annulé pendant qu'une primitive ACP est déjà en cours d'exécution. Une annulation seulement coopérative empêcherait les étapes suivantes de démarrer, mais laisserait le `prompt()` courant continuer en arrière-plan.

Le runner éphémère doit donc recevoir un signal d'annulation et interrompre l'agent actif.

## Décision

Standardiser l'annulation des runs ACP éphémères sur `AbortSignal`.

`PipelineService.cancel()`, `rejectPlan()` et `dispose()` propagent un signal jusqu'à `EphemeralAcpRunner`. Le runner vérifie le signal avant les étapes critiques, installe un listener `abort`, appelle `connection.cancel({ sessionId })` quand une session ACP existe, puis dispose la connexion et le processus. L'annulation remonte sous forme de `RunAbortedError` afin de ne pas la traiter comme une erreur métier.

## Conséquences

- `/pipeline cancel` peut interrompre l'étape ACP active, pas seulement le reste du pipeline.
- Les runs annulés ne retournent pas de sortie partielle comme résultat valide.
- Les courses fin naturelle vs annulation restent possibles, mais sont limitées par les checks `signal.aborted` et le listener `abort` installé une seule fois.
- Si l'annulation arrive pendant l'authentification ou avant `sessionId`, le dispose du runner sert de fallback.
