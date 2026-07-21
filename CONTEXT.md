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

**Connexion agent persistante**:
Relation ACP maintenue par un nœud agent pendant toute son étape pipeline, afin que l’entretien agent conserve sa continuité jusqu’à la production de son artifact final.
_Avoid_: relance éphémère, agent global du pipeline, session partagée entre nœuds

**AgentNodeSession**:
Contrat runtime partagé qui représente la connexion agent persistante bornée à un nœud agent Pipeline V3.
_Avoid_: PersistentAgentNodeRun, EphemeralRun pipeline, session globale de run

**Historique ACP de nœud**:
Artifact structuré d’un nœud agent Pipeline V3, enrichi à chaque échange ACP significatif, qui permet de rejouer l’entretien après une perte de connexion et d’auditer le résultat produit.
_Avoid_: log texte, mémoire volatile, transcript de surface hôte

**Replay d’entretien**:
Reconstitution d’un entretien agent à partir de son prompt d’origine et de ses tours structurés lorsque la connexion agent persistante n’est plus disponible.
_Avoid_: reprise par logs, restauration de session vivante, concaténation de transcript

**Activité agent temporaire**:
Texte progressif produit pendant une connexion agent persistante, affichable par une surface hôte sans devenir une sortie observable du nœud ni une entrée consommable par les dépendances du pipeline.
_Avoid_: artifact partiel, sortie de nœud, contrat de streaming

**Migration complète de connexion agent**:
Remplacement du modèle de relance éphémère par la connexion agent persistante pour les exécutions Pipeline V3 sur toutes les surfaces hôtes concernées, sans mode de compatibilité durable ni feature flag conservant l’ancienne sémantique pipeline.
_Avoid_: double chemin runtime pipeline, compatibilité pipeline EphemeralRun, migration partielle par hôte

**Requête inline éphémère**:
Unité de travail VS Code InlineEdit qui conserve une exécution ACP courte et isolée pour produire une proposition d’édition sans ouvrir de connexion agent persistante.
_Avoid_: migration InlineEdit, session inline persistante, entretien inline

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
