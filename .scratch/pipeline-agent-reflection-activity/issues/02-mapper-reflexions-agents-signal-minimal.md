# 02 — Mapper les réflexions agents en signal minimal

**What to build:** quand un agent non-planner émet une réflexion pendant le pipeline, le webview affiche seulement un signal minimal indiquant le rôle et, si connu, le nom de l'agent. Le contenu de la réflexion ne doit jamais être copié ni affiché dans ce signal.

**Blocked by:** 01 — Localiser l'activité de réflexion dans le webview.

**Status:** resolved

- [x] Un `agent_thought_chunk` non-planner produit une activité locale du webview.
- [x] L'activité contient le rôle pipeline et le nom d'agent optionnel.
- [x] L'activité ne contient pas le texte du chunk de réflexion, même tronqué.
- [x] Le comportement existant des pensées du planner reste inchangé.

## Comments

Le mapping `sessionUpdate` crée uniquement `{ role, agentName }` pour les réflexions pipeline non-planner; les pensées planner continuent d'utiliser `appendThoughtChunk`.
