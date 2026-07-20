# ACP Orchestration

Ce contexte fournit une orchestration ACP cohérente, quel que soit le point d’entrée utilisé par l’utilisateur.

## Language

**Surface hôte**:
Point d’entrée utilisateur qui adapte l’orchestration ACP à un environnement d’exécution sans en redéfinir le comportement. La CLI, Pi et VS Code sont les trois surfaces hôtes.
_Avoid_: moteur, runtime propre, implémentation indépendante

**Configuration workspace**:
Source de vérité unique décrivant les agents et pipelines ACP d’un workspace pour toutes les surfaces hôtes.
_Avoid_: configuration CLI, configuration Pi, configuration VS Code, fallback packagé

**Pipeline V3**:
Unique langage de définition et modèle d’exécution des workflows orchestrés.
_Avoid_: pipeline legacy, pipeline V2, conversion implicite

**Entretien agent**:
Mode explicite d’un nœud agent V3 qui peut produire plusieurs questions et recevoir leurs réponses avant de livrer son artifact final. Sa répétition appartient au runtime partagé et ne crée pas de cycle entre les nœuds du pipeline.
_Avoid_: boucle CLI, cycle de pipeline, pause d’approbation interactive

**Sortie d’entretien**:
Intention normalisée par laquelle un utilisateur demande à un entretien agent de cesser les questions et de produire son artifact final. Les surfaces hôtes peuvent la présenter différemment mais transmettent toutes la même décision au runtime partagé.
_Avoid_: réponse magique, approbation implicite, commande propre à un hôte

**Runtime partagé**:
Comportement d’orchestration commun exercé sans variation par toutes les surfaces hôtes.
_Avoid_: runtime CLI, runtime Pi, runtime VS Code

**Parité hôte**:
Invariant selon lequel une même configuration workspace et une même entrée produisent le même comportement observable sur chaque surface hôte, hors interactions propres à son interface utilisateur.
_Avoid_: comportement similaire, compatibilité approximative

**Adapter hôte**:
Couche minimale qui traduit les entrées, sorties et interactions utilisateur d’une surface hôte vers le runtime partagé.
_Avoid_: fork, moteur hôte, logique métier locale
