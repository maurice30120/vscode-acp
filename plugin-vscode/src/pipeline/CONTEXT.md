# Pipeline et orchestration

Workflows multi-étapes basés sur le runtime pipeline v3 partagé, exposés comme agents virtuels dans le même arbre d’agents et la même UI de chat que les agents ACP natifs.

## Agents virtuels

**VirtualAgent** :
Nom de ConfiguredAgent qui ne correspond pas à un processus enfant ACP longue durée. Le sélectionner démarre une Conversation avec transport `virtual`. L’orchestration s’exécute in-process.
_À éviter_ : agent pipeline (quand on parle de l’entrée d’arbre), faux agent

**Pipeline** :
Workflow déclaratif v3 (YAML sous `.acp/pipelines/` du workspace) compilé en DAG immutable : nœuds agents, branches parallèles par dépendances et pauses explicites.
_À éviter_ : workflow (générique), graphe (implémentation)

**Pipeline canonique** :
Workflow déclaratif YAML sous `.acp/pipelines/`. Les anciens raccourcis `.acp/teams/` ont été supprimés ; les workflows rôle-basés doivent être exprimés en pipeline v3.
_À éviter_ : squad, crew, multi-agent (générique)

**PipelineStep** :
Un nœud du DAG Pipeline (ex. planner, implementer, verifier). Peut invoquer un ConfiguredAgent sous-jacent ou produire une pause.
_À éviter_ : étape (seule, ambiguë), phase

**PlanApprovalGate** :
Étape où le pipeline s’arrête jusqu’à ce que l’utilisateur approuve ou rejette un plan proposé dans l’UI chat avant les étapes à effets de bord.
_À éviter_ : confirmation, étape de revue

## Exécution

**OrchestrationRun** :
Une exécution unique d’un Pipeline pour une Conversation virtual — un id ProtocolSession, un fil de chat visible, blocs de timeline dans ChatHistory.
_À éviter_ : session pipeline (ambigu avec SessionRecord)

**EphemeralRun** :
Lancement ACP de courte durée utilisé dans un PipelineStep (ou édition inline) pour appeler un ConfiguredAgent sous-jacent. N’est pas un ConnectedAgent et n’apparaît pas dans l’arbre des sessions. Détruit à la fin de l’étape.
_Routage_ : `EphemeralAgentRunner` choisit native ACP ou Sandcastle+Promotion selon la config agent.
_À éviter_ : sous-session, session enfant, mini-session

**PipelineRuntimeAgentAdapter** :
Module qui exécute un nœud agent v3 via `EphemeralAgentRunner` et publie un artefact typé.
_À éviter_ : runConfiguredAcpAgent (nom historique)

**PipelineRuntime** :
Exécution complète d'un OrchestrationRun : programme v3 compilé, pauses génériques, reprise, annulation, artefacts typés, retries/fail-fast et émission des événements `status` / `plan-ready` / `session-update`.
_À éviter_ : PipelineService (quand on parle de la logique run, pas du wiring extension)

**PipelineService** :
Façade wiring pour l'extension VS Code : construit le runtime v3, délègue createPlan/approve/reject/cancel, forward les événements EventEmitter vers OrchestrationRuntime.
_À éviter_ : service pipeline (générique)

**PipelineTimeline** :
Séquence ordonnée des statuts d’étapes et libellés de rôles affichés dans ChatHistory pendant un OrchestrationRun.
_À éviter_ : historique pipeline, journal d’étapes

## Relations avec Core

- Une Conversation VirtualAgent est portée par la couche session de Core mais exécutée via la couture de transport virtual.
- Les EphemeralRuns peuvent cibler des ConfiguredAgents natifs ou Sandcastle ; leur sortie alimente la ChatHistory de l’OrchestrationRun, pas une entrée d’arbre séparée.
- Les chunks de message d’OrchestrationRun sont aussi ajoutés à la Discussion sur le SessionRecord virtual pour le handoff, comme pour les conversations natives.
