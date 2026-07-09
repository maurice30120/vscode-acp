# ADR-0008 : plugin-pi est une implémentation autonome, ne dépend pas de plugin-vscode

**Statut** : Acceptée

## Contexte

`plugin-pi` et `plugin-vscode` sont deux extensions sœurs, l'une tournant sous l'agent Pi, l'autre sous VS Code. Tous deux consomment le package partagé `@acp-client/pipeline` (runtime pipeline, statuts, approbation). Jusqu'ici le réflexe, à l'ajout d'une nouvelle couche (Sandcastle), serait de la partager ou d'extraire une dépendance.

## Décision

`plugin-pi` est pensé comme une **implémentation autonome** : on porte le code utile depuis `plugin-vscode` en le dupliquant, sans chercher à factoriser la couche plugin. La duplication est **intentionnelle**, pas une dette à rembourser plus tard. La seule frontière commune reste `@acp-client/pipeline`.

## Raison

Permettre à chaque plugin d'évoluer à son rythme et selon son modèle runtime propre — pi étant éphémère (un process par run), vscode étant longue durée par Conversation. Partager la couche plugin coûterait plus en coordination de release qu'en divergence. Record explicite pour qu'un futur lecteur ne « corrige » pas la duplication à l'envers (ex. en fusionnant les deux `src/sandcastle/`).
