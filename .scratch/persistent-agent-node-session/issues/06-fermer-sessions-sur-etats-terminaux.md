# 06 — Fermer les sessions sur annulation, rejet et états terminaux

**What to build:** `cancel` et `reject` arrêtent le travail actif et ferment les ressources sans demander d'artifact final ; succès et échec ferment aussi la session après la persistance nécessaire.

**Blocked by:** 02 — Exécuter un nœud agent non interactif via AgentNodeSession; 03 — Maintenir une AgentNodeSession pendant un Entretien agent multi-tour.

**Status:** ready-for-agent

- [x] L'annulation du run propage le signal à chaque `AgentNodeSession` active puis ferme les ressources.
- [x] Un `reject` sur une question d'entretien annule le run entier et suit le même chemin de fermeture que `cancel`.
- [x] Aucun artifact final n'est demandé après `cancel` ou `reject`.
- [x] Une session est fermée après succès et persistance de l'artifact final.
- [x] Une session est fermée après échec technique ou violation de protocole terminale.
