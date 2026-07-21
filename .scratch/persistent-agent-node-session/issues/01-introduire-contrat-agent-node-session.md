# 01 — Introduire le contrat AgentNodeSession dans le Runtime partagé

**What to build:** Le Runtime partagé peut ouvrir, utiliser, annuler et fermer une connexion agent persistante bornée à un seul nœud agent Pipeline V3, avec un contrat public nommé `AgentNodeSession`.

**Blocked by:** None — can start immediately.

**Status:** resolved

- [x] Une `AgentNodeSession` appartient à exactement un nœud agent d'un run Pipeline V3 et ne peut pas être partagée entre nœuds.
- [x] Le Runtime partagé reçoit une fabrique de sessions depuis l'Adapter hôte au lieu de construire directement une relance éphémère pipeline.
- [x] Le contrat expose les opérations nécessaires pour envoyer un tour, recevoir l'activité ou le résultat, annuler le travail actif et fermer les ressources.
- [x] Les transitions métier du Runtime partagé ne dépendent pas de l'identité native ni de la survie d'une connexion ACP.

## Comments

Implemented in `@acp-client/pipeline` by introducing the public `AgentNodeSession` contract, routing Pipeline V3 execution through `PipelineRuntimeAdapter.createSession`, keeping interview sessions open across question pauses, closing/cancelling active sessions on terminal paths, and replaying interview state from the structured node history rather than ACP connection identity.
