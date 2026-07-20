# 01 — Localiser l'activité de réflexion dans le webview

**What to build:** l'UI peut recevoir un signal "agent en réflexion" pendant une exécution Pipeline V3, mais ce signal reste uniquement dans l'état local du webview courant. Il n'est pas inclus dans l'état d'orchestration durable, pas restauré après reload, et pas synchronisé comme fait d'orchestration.

**Blocked by:** None — can start immediately.

**Status:** resolved

- [x] L'état d'orchestration durable ne contient aucun champ d'activité de réflexion.
- [x] L'état local du webview peut représenter une activité pipeline courante avec rôle et nom d'agent optionnel.
- [x] Les snapshots partagés ou persistés ne restaurent pas une ancienne activité de réflexion.
- [x] Le prototype staged existant est corrigé s'il persiste l'activité.

## Comments

Implémenté via `pipelineActivity` local dans l'état webview, exclu du bundle partagé et du snapshot d'orchestration.
