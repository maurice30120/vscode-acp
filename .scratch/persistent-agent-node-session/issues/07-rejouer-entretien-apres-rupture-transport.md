# 07 — Rejouer un Entretien agent après rupture de transport

**What to build:** Une perte de connexion pendant un Entretien agent ouvre une nouvelle session pour le même run et le même nœud, rejoue uniquement le prompt d'origine et l'Historique ACP de nœud, publie un événement technique, et ne réémet pas `node_started`.

**Blocked by:** 04 — Persister l'Historique ACP de nœud comme vérité de replay; 05 — Gérer complete-interview et la demande finale unique sur la même session; 06 — Fermer les sessions sur annulation, rejet et états terminaux.

**Status:** ready-for-human

- [x] Une rupture de transport pendant un entretien ferme et remplace la session défaillante sans changer l'identité logique du run ou du nœud.
- [x] La nouvelle session reçoit le prompt d'origine et le replay rendu par le protocole depuis l'Historique ACP de nœud.
- [x] Le Runtime partagé publie un diagnostic ou événement technique dédié de reconnexion ou replay.
- [x] Le replay ne réémet pas un second événement logique `node_started`.
- [x] Le replay automatique reste réservé aux Entretien agent et ne s'applique pas aux nœuds non interactifs.

## Comments

- Implemented in `@acp-client/pipeline`: retryable transport loss during an Entretien agent now closes the failed `AgentNodeSession`, opens a replacement for the same run/node, sends a protocol-rendered replay prompt from the original prompt and Historique ACP de nœud, and emits `node_replayed` without re-emitting `node_started`.
- Added coverage for replay after an already recorded agent question and user answer, including same run/node identity, replay prompt contents, replacement-session lifecycle, event counts, non-transport retry behavior, and non-interactive retry behavior.
- Verification: `npm test` in `acp-pipeline` passes.
