# ADR-0001 : Politique de configuration sous `.pi/.acp`

**Statut** : Acceptée

## Contexte

Le plugin Pi a besoin d'une source de vérité claire pour sa configuration runtime. Répartir les fichiers entre plusieurs racines rendrait le chargement ambigu et compliquerait une extraction future du plugin.

## Décision

Toute configuration concernant le plugin Pi vit sous `.pi/.acp/`.

Le plugin Pi lit la config agents depuis `.pi/.acp/acp-agents.json`. Tout ce qui parle de pipeline vit sous `.pi/.acp/pipelines/`, avec les définitions chargées depuis `.pi/.acp/pipelines/*.yaml`.

## Conséquences

- Le périmètre de configuration Pi est visible immédiatement : tout ce qui est nécessaire au plugin est sous `.pi/.acp/`.
- Le runtime Pi ne lit pas de configuration plugin en dehors de `.pi/.acp/`.
- Une migration depuis un autre layout consiste à déplacer la config agents vers `.pi/.acp/acp-agents.json` et les pipelines vers `.pi/.acp/pipelines/`.
