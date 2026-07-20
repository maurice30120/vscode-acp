# 03 — Nettoyer l'activité dès que la sortie commence

**What to build:** quand un agent non-planner commence à produire une sortie visible, l'indicateur de réflexion disparaît immédiatement afin de ne pas concurrencer le contenu réel. La sortie assistant continue d'être ajoutée comme aujourd'hui.

**Blocked by:** 02 — Mapper les réflexions agents en signal minimal.

**Status:** resolved

- [x] Un `agent_message_chunk` non-planner efface l'activité pipeline locale.
- [x] Le même `agent_message_chunk` conserve le flux normal de sortie assistant.
- [x] Effacer l'activité est sans effet dangereux lorsqu'aucune activité n'est affichée.
- [x] Les approbations et sorties de rôles existantes ne changent pas de comportement.

## Comments

Les chunks de sortie pipeline non-planner émettent `clearPipelineActivity` avant `appendAssistantChunk`; le reducer ignore le nettoyage quand aucune activité n'existe.
