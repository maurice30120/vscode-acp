# ADR-0001 : Politique de configuration sous `.acp`

**Statut** : Acceptée

## Contexte

Le plugin Pi a besoin d'une source de vérité claire pour sa configuration runtime. Répartir les fichiers entre plusieurs racines rendrait le chargement ambigu et compliquerait une extraction future du plugin.

## Décision

Toute configuration concernant le plugin Pi vit sous `.acp/`.

Le plugin Pi lit la config agents depuis `.acp/acp-agents.json`. Tout ce qui parle de pipeline vit sous `.acp/pipelines/`, avec les définitions chargées depuis `.acp/pipelines/*.yaml`.

## Conséquences

- Le périmètre de configuration Pi est visible immédiatement : tout ce qui est nécessaire au plugin est sous `.acp/`.
- Le runtime Pi ne lit pas de configuration plugin en dehors de `.acp/`.
- Une migration depuis un autre layout consiste à déplacer la config agents vers `.acp/acp-agents.json` et les pipelines vers `.acp/pipelines/`.
