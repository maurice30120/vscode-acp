# 3. Design It Twice — alternatives d’interface

## 3.1 Contraintes communes

Toute nouvelle interface doit :

- supporter zéro, une ou plusieurs pauses ;
- distinguer clairement pause et fin ;
- empêcher l’approbation d’une pause obsolète ;
- fonctionner dans Pi et VS Code ;
- garder LangGraph et le checkpointer derrière le seam ;
- préserver les événements de streaming ;
- permettre annulation et future persistance ;
- ne pas obliger l’UI à comprendre l’implémentation du graphe.

Dépendances :

- graphe, registre et templates : in-process ;
- agent ACP : true external, via adapter ;
- filesystem/terminal : local-substitutable ;
- Sandcastle : adapter possédé et substituable.

## 3.2 Design A — commande minimale avec résultat discriminé

### Interface

```ts
interface PipelineRuntime {
  start(input: PipelineStartInput): Promise<PipelineRunOutcome>;
  resume(input: PipelineResumeInput): Promise<PipelineRunOutcome>;
  reject(input: PipelineRejectInput): void;
  cancel(sessionId: string): void;
  getSnapshot(sessionId: string): PipelineRunSnapshot | undefined;
}

type PipelineRunOutcome =
  | { kind: "paused"; sessionId: string; pause: PipelinePause }
  | { kind: "completed"; sessionId: string; output: string };
```

### Usage

```ts
const outcome = await runtime.resume({
  sessionId,
  pauseId,
  decision: "approve",
  content,
});

if (outcome.kind === "paused") {
  presenter.showPause(outcome.pause);
} else {
  presenter.showCompleted(outcome.output);
}
```

### Invariants

- `resume` exige un `pauseId` égal à la pause courante ;
- un outcome `completed` implique que le registre a été nettoyé ;
- un outcome `paused` implique que le run reste annulable et reprenable ;
- les événements ne changent pas le sens de l’outcome.

### Erreurs

- session inconnue ;
- run non suspendu ;
- pause obsolète ;
- contenu invalide selon le type de pause ;
- run annulé pendant la commande.

### Ce que l’implémentation cache

LangGraph, `MemorySaver`, registre, interrupts, transitions et nettoyage.

### Trade-offs

- interface très petite ;
- migration simple ;
- excellente leverage pour les deux hôtes ;
- la persistance avancée devra s’appuyer sur `getSnapshot` ou une future store.

## 3.3 Design B — handle orienté objet par run

### Interface

```ts
interface PipelineRuntime {
  start(input: PipelineStartInput): Promise<PipelineRunHandle>;
}

interface PipelineRunHandle {
  readonly sessionId: string;
  snapshot(): PipelineRunSnapshot;
  resume(input: PipelineResumeDecision): Promise<PipelineRunOutcome>;
  reject(pauseId: string): void;
  cancel(): void;
  onEvent(listener: (event: PipelineEvent) => void): Disposable;
}
```

### Usage

```ts
const run = await runtime.start(input);
const outcome = await run.resume({ pauseId, decision: "approve", content });
```

### Avantages

- ergonomie forte pour un hôte interactif ;
- état et événements naturellement regroupés ;
- évite de répéter `sessionId`.

### Limites

- un handle en mémoire s’accorde mal avec future persistance/reprise après redémarrage ;
- lifecycle des listeners plus complexe ;
- Pi et VS Code doivent conserver un objet vivant ;
- interface plus difficile à sérialiser et tester en contrat.

## 3.4 Design C — machine à états command/event

### Interface

```ts
interface PipelineRuntime {
  dispatch(command: PipelineCommand): Promise<PipelineTransition>;
  getSnapshot(sessionId: string): PipelineRunSnapshot | undefined;
}

type PipelineCommand =
  | { type: "start"; input: PipelineStartInput }
  | { type: "resume"; sessionId: string; pauseId: string; decision: "approve"; content?: string }
  | { type: "reject"; sessionId: string; pauseId: string }
  | { type: "cancel"; sessionId: string };

interface PipelineTransition {
  previous: PipelineRunSnapshot | undefined;
  current: PipelineRunSnapshot;
  events: PipelineDomainEvent[];
}
```

### Avantages

- transitions explicites et auditables ;
- très bon socle pour persistance, replay et métriques ;
- aucune ambiguïté entre commandes et événements.

### Limites

- surface plus conceptuelle pour les hôtes actuels ;
- risque de construire une infrastructure event-sourced trop tôt ;
- davantage de types et de code de migration pour corriger la PR #9.

## 3.5 Comparaison

| Critère | Design A | Design B | Design C |
| --- | --- | --- | --- |
| Depth | Élevée | Élevée | Très élevée |
| Interface | Petite | Moyenne | Moyenne |
| Locality | Élevée | Élevée | Très élevée |
| Migration PR #9 | Faible risque | Risque moyen | Risque élevé |
| Persistance future | Correcte | Faible | Excellente |
| Testabilité | Excellente | Bonne | Excellente |
| Adaptation Pi/VS Code | Directe | Gestion de handles | Mapping de commandes |

## 3.6 Recommandation

Retenir le **Design A**, enrichi de deux idées du Design C :

1. un `pauseId` obligatoire pour sécuriser les reprises ;
2. un `PipelineRunSnapshot` explicite pour status, debug et future persistance.

Ne pas adopter le handle du Design B : le projet vise déjà reprise, historique et plusieurs hôtes. Une interface sérialisable par identifiant est plus adaptée.
