# Spécification — Runtime pipeline partagé et DSL v3

**Statut :** prête pour implémentation  
**Source :** synthèse de l’entretien `grill-me` et des décisions d’architecture associées  
**Portée :** moteur pipeline partagé, DSL pipeline, Adapters Pi/VS Code, Adapters d’exécution ACP natif et Sandcastle

## Problem Statement

Le moteur pipeline actuel expose une Interface spécialisée autour d’un workflow historique : créer un plan, approuver ce plan, puis poursuivre l’exécution. Les appels retournent essentiellement du texte, tandis que les événements et plusieurs états internes mutables doivent être interprétés par les Adapters hôtes pour distinguer une pause, une reprise et une fin de run.

Cette spécialisation entraîne plusieurs problèmes observables :

- un pipeline comportant plusieurs pauses humaines peut être interprété comme terminé après la première reprise ;
- Pi et VS Code reconstruisent chacun une partie du cycle de vie au lieu de consommer un résultat métier stable ;
- les pauses sont artificiellement liées au format `<proposed_plan>` même lorsque le contenu est une spécification, une liste de tâches ou une décision de promotion ;
- la DSL v2 représente le parallélisme par un bloc spécial au lieu de représenter directement les dépendances du graphe ;
- les sorties sont des chaînes non typées et les références invalides peuvent devenir silencieusement des chaînes vides ;
- les droits sont répartis entre `sideEffects` et `permissions`, avec des garanties différentes selon l’Adapter de transport ;
- l’identité d’un agent, ses capacités techniques et les droits accordés pour une exécution sont insuffisamment séparés ;
- la sélection explicite d’un skill peut être ignorée à cause des règles de découverte automatique ;
- les détails LangGraph remontent trop près des appelants et influencent leur logique de cycle de vie.

Le résultat est un Module peu profond : ses appelants doivent connaître trop de détails de son Implementation pour l’utiliser correctement. Toute évolution — approbations multiples, questions interactives, promotions, DAG plus riche ou politiques d’exécution — risque de dupliquer encore davantage la complexité dans les hôtes.

## Solution

Construire un moteur pipeline partagé qui possède entièrement le cycle de vie d’un run et expose une petite Interface stable. Pi et VS Code deviennent des Adapters de présentation : ils envoient des commandes au runtime, projettent les résultats dans leur UI et consomment les événements uniquement pour le streaming et la télémétrie.

La refonte est une rupture volontaire :

- les anciennes opérations orientées plan sont supprimées ;
- aucune Interface de compatibilité n’est conservée ;
- la DSL v2 est supprimée ;
- la DSL v3 devient le seul format accepté ;
- tous les pipelines embarqués et tous les appelants sont migrés dans la même évolution.

Le Seam externe principal est `PipelineRuntime`. Les commandes retournent toujours un état stable du run : pause ou état terminal. Les événements ne sont jamais nécessaires pour déterminer si un run doit rester actif.

La DSL v3 représente un DAG déclaratif. Chaque nœud exprime ses dépendances avec `needs`. Le parallélisme découle naturellement du graphe : plusieurs nœuds prêts peuvent être exécutés simultanément sans bloc spécial de parallélisme.

Les nœuds échangent des artefacts structurés et typés. Les références, les dépendances et les formats sont validés à la compilation. Une référence inconnue ou incompatible est une erreur explicite et ne produit jamais une chaîne vide silencieuse.

Les droits sont décrits par des profils de politique réutilisables, sélectionnés au niveau du nœud. L’agent décrit qui exécute ; ses capacités décrivent ce que son transport sait techniquement faire ; la politique du nœud décrit ce que cette exécution précise est autorisée à faire. Le moteur valide la compatibilité entre politique et capacités avant tout lancement.

Les skills explicitement déclarés par un nœud sont résolus comme un contrat d’orchestration. Ils sont injectés même lorsqu’ils sont exclus de la découverte automatique, ou le run échoue clairement avant l’exécution.

## User Stories

1. En tant qu’utilisateur Pi, je veux qu’une première approbation puisse mener à une seconde pause sans que le pipeline soit annoncé comme terminé, afin de poursuivre correctement les workflows complexes.
2. En tant qu’utilisateur VS Code, je veux voir le même état métier qu’un utilisateur Pi pour un pipeline identique, afin que le comportement ne dépende pas de l’hôte.
3. En tant qu’utilisateur, je veux pouvoir approuver, répondre, rejeter ou annuler une pause explicite, afin de contrôler le pipeline sans dépendre d’un type de contenu particulier.
4. En tant qu’utilisateur, je veux qu’un run en pause reste inspectable et reprenable, afin de ne pas perdre son contexte entre deux interactions.
5. En tant qu’utilisateur, je veux qu’une reprise cible la pause courante, afin qu’une action obsolète ne soit jamais appliquée au mauvais état.
6. En tant qu’utilisateur, je veux recevoir un résultat clair lorsque le pipeline est terminé, rejeté, annulé ou en erreur, afin que l’UI ne déduise pas l’état depuis des événements.
7. En tant qu’auteur de pipeline, je veux déclarer un DAG avec `needs`, afin d’exprimer directement les dépendances métier.
8. En tant qu’auteur de pipeline, je veux que deux nœuds ayant les mêmes dépendances puissent s’exécuter en parallèle automatiquement, afin de ne pas créer de blocs de parallélisme artificiels.
9. En tant qu’auteur de pipeline, je veux que les cycles soient détectés avant l’exécution, afin qu’un pipeline invalide ne puisse pas démarrer.
10. En tant qu’auteur de pipeline, je veux que les dépendances absentes et les nœuds inaccessibles soient signalés à la compilation, afin de corriger la définition avant le run.
11. En tant qu’auteur de pipeline, je veux nommer explicitement les inputs consommés par un nœud, afin de rendre son contrat lisible et testable.
12. En tant qu’auteur de pipeline, je veux déclarer le type et le format des artefacts produits, afin que les consommateurs puissent être validés statiquement.
13. En tant qu’auteur de pipeline, je veux continuer à utiliser du texte ou du Markdown comme formats simples, afin que la structure ne rende pas les pipelines ordinaires inutilement complexes.
14. En tant qu’auteur de pipeline, je veux utiliser des artefacts JSON lorsque le contrat l’exige, afin de transmettre des données structurées sans parsing implicite.
15. En tant qu’auteur de pipeline, je veux qu’une référence invalide provoque une erreur descriptive, afin d’éviter les substitutions silencieuses.
16. En tant qu’auteur de pipeline, je veux définir des profils de politique réutilisables, afin d’éviter de recopier les mêmes droits sur chaque nœud.
17. En tant qu’auteur de pipeline, je veux attacher une politique à chaque nœud, afin que le même agent puisse être read-only dans une étape et workspace-write dans une autre.
18. En tant qu’administrateur, je veux que les capacités techniques d’un agent soient séparées de ses droits d’exécution, afin qu’une capacité disponible ne soit pas automatiquement autorisée.
19. En tant qu’utilisateur, je veux qu’un nœud read-only ne puisse pas modifier le workspace hôte, même si le prompt ou l’agent se trompe, afin que la sécurité soit garantie par l’Implementation.
20. En tant qu’utilisateur, je veux que les garanties read-only et workspace-write soient cohérentes entre ACP natif et Sandcastle, afin de ne pas dépendre du transport choisi.
21. En tant qu’utilisateur, je veux qu’une politique non garantie par le transport soit refusée avant l’appel à l’agent, afin d’éviter une fausse promesse de sécurité.
22. En tant qu’utilisateur, je veux qu’une promotion Sandcastle respecte la politique du nœud, afin qu’un diff read-only ne soit jamais appliqué au workspace.
23. En tant qu’auteur de pipeline, je veux sélectionner explicitement des skills, afin que l’agent reçoive réellement les disciplines demandées.
24. En tant qu’auteur de skill, je veux que `disable-model-invocation` empêche seulement la découverte automatique, afin qu’une orchestration explicite puisse toujours utiliser le skill.
25. En tant qu’auteur de pipeline, je veux qu’un skill absent ou invalide bloque la compilation ou le lancement avec une erreur claire, afin que la configuration ne soit jamais trompeuse.
26. En tant que développeur du moteur, je veux tester tout le cycle de vie via une seule Interface publique, afin que les tests ne dépendent pas de LangGraph ou d’états privés.
27. En tant que développeur d’un Adapter hôte, je veux piloter session active, heartbeat et notifications depuis le résultat du runtime, afin de ne pas maintenir une seconde machine à états.
28. En tant que mainteneur, je veux que LangGraph, ses interrupts, son checkpointer et son `thread_id` restent internes, afin de pouvoir changer l’Implementation sans casser les hôtes.
29. En tant que mainteneur, je veux conserver les outputs et diagnostics déjà produits lorsqu’un run échoue, afin de comprendre la cause sans rejouer l’ensemble du pipeline.
30. En tant qu’auteur de pipeline, je veux configurer des retries bornés par nœud, afin de tolérer les erreurs transitoires sans créer de boucles infinies.
31. En tant qu’utilisateur, je veux qu’un échec définitif arrête par défaut les nouveaux lancements et annule les nœuds encore actifs, afin d’obtenir un comportement prévisible.
32. En tant que mainteneur, je veux que les pipelines embarqués Pi et VS Code utilisent le même compilateur v3, afin d’éviter deux interprétations de la DSL.
33. En tant que mainteneur, je veux supprimer complètement le code v2 après migration, afin de ne pas entretenir deux modèles concurrents.
34. En tant que contributeur, je veux disposer d’erreurs de compilation localisées par pipeline, nœud et champ, afin de corriger rapidement une définition invalide.
35. En tant que contributeur, je veux qu’un pipeline v2 soit rejeté explicitement comme version non supportée, afin que la rupture soit claire et non ambiguë.

## Implementation Decisions

### Module runtime partagé

- Le moteur pipeline est un Module profond qui possède le registre des runs, les transitions d’état, les pauses, les reprises, l’annulation, le nettoyage, les snapshots et la traduction des résultats du moteur de graphe.
- Son Interface publique est limitée à quatre commandes : démarrer, reprendre, annuler et inspecter.
- Les commandes retournent un résultat discriminé représentant un état stable.
- Les événements sont réservés aux mises à jour progressives, au streaming et à la télémétrie ; ils ne déterminent jamais le cycle de vie.
- Une pause conserve le run dans le store. Un état terminal libère les ressources actives mais conserve le snapshot final retourné.
- Les erreurs métier attendues sont représentées par des codes structurés. Les exceptions sont réservées aux défauts d’Implementation ou d’infrastructure inattendus.

Le contrat de décision retenu est :

```ts
interface PipelineRuntime {
  start(input: StartPipelineInput): Promise<PipelineRunResult>;
  resume(input: ResumePipelineInput): Promise<PipelineRunResult>;
  cancel(sessionId: string): PipelineRunResult;
  inspect(sessionId: string): PipelineRunSnapshot | null;
}

type PipelineRunResult =
  | { kind: 'paused'; sessionId: string; pause: PipelinePause; snapshot: PipelineRunSnapshot }
  | { kind: 'completed'; sessionId: string; output: PipelineArtifact; snapshot: PipelineRunSnapshot }
  | { kind: 'rejected'; sessionId: string; reason?: string; snapshot: PipelineRunSnapshot }
  | { kind: 'cancelled'; sessionId: string; snapshot?: PipelineRunSnapshot }
  | { kind: 'failed'; sessionId: string; error: PipelineRunError; snapshot?: PipelineRunSnapshot };
```

### Rupture et suppression de l’ancien modèle

- Les opérations historiques orientées plan sont supprimées et ne restent pas sous forme de wrappers.
- Les états et événements spécialisés autour d’un plan sont remplacés par les concepts génériques de pause et de résultat.
- Pi et VS Code sont migrés dans la même évolution afin qu’aucun appelant ne reste dépendant de l’ancienne Interface.
- La DSL v2 n’est ni interprétée ni migrée automatiquement au runtime.
- Une version autre que 3 est refusée avec une erreur de version explicite.

### DSL v3 en DAG

- La DSL v3 utilise une table de nœuds identifiés par leur clé.
- `needs` déclare les dépendances directes.
- L’absence de `needs` désigne un nœud racine.
- Le compilateur construit un programme interne immuable, indépendant du format YAML.
- Le compilateur détecte les cycles, références absentes, dépendances incohérentes, nœuds inaccessibles, sorties incompatibles et politiques inconnues.
- Le parallélisme est dérivé de l’état du DAG : tous les nœuds prêts sont éligibles à l’exécution.
- Les pauses sont des nœuds ordinaires et peuvent apparaître à n’importe quel niveau du DAG.
- Un nœud qui consomme l’output d’un autre doit dépendre directement ou transitivement de ce producteur.

Le prototype décisionnel minimal de la DSL est :

```yaml
version: 3
id: example

agents:
  planner:
    agent: Pi Agent
    capabilities: [filesystem, terminal]

policies:
  read-only:
    filesystem: read-only
    terminal: deny
    network: ask
    promotion: discard

nodes:
  plan:
    run: planner
    policy: read-only
    inputs:
      request: request
    produces:
      type: proposed-plan
      format: markdown

  approval:
    needs: [plan]
    pause:
      kind: approval
      content: nodes.plan.output
```

### Contrats d’artefacts

- Tout output de nœud est représenté par un `PipelineArtifact`.
- Un artefact possède au minimum un type métier, un format et une valeur.
- Les formats initiaux supportés sont `text`, `markdown` et `json`.
- Le compilateur vérifie la compatibilité entre artefact produit et input attendu.
- Le moteur ne remplace jamais silencieusement une référence inconnue par une valeur vide.
- Les inputs sont nommés, ce qui évite la concaténation implicite de plusieurs sorties.
- Le snapshot expose les artefacts produits par nœud sans exposer les objets internes du moteur de graphe.

### Pauses génériques

- Une pause possède un identifiant stable, un type, un contenu, un format et des métadonnées optionnelles.
- Les types initiaux sont `approval`, `question` et `promotion`.
- Une reprise contient l’identifiant de la pause ciblée et une décision explicite.
- Une reprise visant une pause obsolète échoue avec une erreur `invalid_resume`.
- Le protocole `<proposed_plan>` reste un format d’artefact ou de contenu spécialisé, jamais l’enveloppe universelle du contrôle de flux.

### Politiques d’exécution

- `sideEffects` et `permissions` sont supprimés de la DSL.
- Les droits sont définis par des profils de politique nommés et réutilisables.
- Chaque nœud référence exactement une politique, sauf si une politique par défaut explicite est définie au niveau du pipeline.
- La politique appartient au nœud, pas à l’agent.
- Les capacités appartiennent à la définition de l’agent ou du transport et ne constituent pas une autorisation.
- La politique normalisée couvre au minimum le filesystem, le terminal, le réseau et la promotion.
- Le moteur valide qu’un Adapter peut garantir la politique avant de lancer l’agent.
- ACP natif bloque les opérations interdites au niveau des handlers.
- Sandcastle peut autoriser des écritures isolées mais doit appliquer la règle de promotion pour garantir le même état observable du workspace hôte.
- Une politique read-only ne peut pas être élargie par une approbation d’outil générique.

### Skills

- La résolution explicite et la découverte automatique sont deux opérations distinctes.
- Un skill explicitement sélectionné est injecté même s’il est marqué `disable-model-invocation: true`.
- Ce marqueur continue d’exclure le skill de la découverte automatique.
- Un skill explicitement demandé mais absent ou invalide bloque le run avec une erreur claire.
- L’ordre et le rendu des skills sont déterministes et identiques sur les plateformes supportées.
- Pi et VS Code partagent la même sémantique de résolution.

### Défaillances et retries

- Le comportement par défaut est fail-fast.
- Un nœud peut déclarer un nombre borné de retries et une stratégie de backoff.
- Après épuisement des retries, le run passe à `failed`.
- Aucun nouveau nœud n’est lancé après l’échec définitif.
- Les nœuds encore actifs sont annulés dans la mesure permise par leur Adapter.
- Les artefacts déjà produits et les diagnostics restent présents dans le snapshot d’échec.
- `continueOnError` et les nœuds optionnels ne font pas partie de la première version.

### Hôtes et Adapters

- Pi et VS Code ne possèdent plus de machine d’état pipeline parallèle.
- Ils conservent ou libèrent leur session active uniquement selon `PipelineRunResult`.
- Ils projettent les pauses génériques dans leurs interactions natives.
- Le Seam de transport reste un runner partagé satisfait par au moins deux Adapters réels : ACP natif et Sandcastle.
- LangGraph reste un Seam interne ; ses commandes, interrupts et détails de checkpointer ne font pas partie de l’Interface publique.

## Testing Decisions

- Le Seam de test principal est l’Interface `PipelineRuntime`. Les tests de cycle de vie n’appellent pas directement le coordinateur LangGraph ou le registre interne.
- Les tests vérifient les résultats observables et les snapshots, pas l’ordre des méthodes privées ni la structure interne du graphe compilé.
- Un scénario d’acceptation partagé couvre : démarrage, première pause, reprise, seconde pause, inspection, seconde reprise et fin.
- Les mêmes scénarios de cycle de vie sont exécutés depuis les projections Pi et VS Code pour vérifier la parité métier.
- Le compilateur v3 est testé comme un Module pur : définition valide vers programme interne, ou liste d’erreurs déterministes.
- Les tests du compilateur couvrent les cycles, dépendances absentes, nœuds inaccessibles, références d’artefact invalides, incompatibilités de formats, politiques inconnues, agents inconnus et version non supportée.
- Les tests de scheduling vérifient que deux nœuds prêts peuvent s’exécuter en parallèle et qu’un nœud n’est jamais lancé avant toutes ses dépendances.
- Les tests de pause couvrent `approval`, `question`, `promotion`, rejet, annulation et identifiant obsolète.
- Les tests d’artefacts vérifient texte, Markdown, JSON, plusieurs inputs nommés et absence totale de substitution silencieuse.
- Une suite contractuelle de politique est exécutée contre ACP natif et Sandcastle.
- Cette suite vérifie la lecture read-only, le refus d’écriture, les commandes terminal, le réseau, la promotion, le refus préalable d’une politique non supportée et la conservation du workspace hôte.
- Les tests de skills vérifient la sélection explicite des skills non invocables automatiquement, leur exclusion de la découverte automatique, l’erreur sur skill absent et le déterminisme Windows/POSIX.
- Les tests de défaillance couvrent retry réussi, retries épuisés, annulation des nœuds actifs, absence de nouveaux lancements et conservation des artefacts diagnostiques.
- Les tests des Adapters hôtes utilisent des fakes du runtime et vérifient uniquement les projections UI, le heartbeat et la gestion de session dérivés du résultat.
- Les tests existants de pipelines multi-approbations, de sessions virtuelles et de promotion Sandcastle constituent le prior art à conserver au niveau du comportement, même si leur montage interne doit être réécrit.
- La matrice CI reste obligatoire sur Ubuntu, macOS et Windows, avec exécution des tests complets et packaging VSIX.

## Out of Scope

- Compatibilité runtime avec la DSL v2.
- Conversion automatique v2 vers v3 au chargement.
- Wrappers dépréciés pour l’ancienne Interface TypeScript.
- Persistance durable des runs après redémarrage de l’hôte.
- Remplacement de LangGraph.
- Interface graphique dédiée d’édition du DAG.
- Conditions dynamiques, boucles, fan-out calculé ou génération de nœuds au runtime.
- `continueOnError`, nœuds optionnels ou agrégation partielle après échec.
- Orchestration distribuée entre plusieurs machines.
- Reprise d’un run après changement de version de sa définition pipeline.
- Publication automatique des spécifications ou tâches dans un issue tracker.
- Modification du protocole ACP lui-même.

## Further Notes

- Cette spec remplace les recommandations de migration progressive présentes dans les documents d’architecture antérieurs. Les ADR concernés devront être amendés ou remplacés avant la fusion de l’Implementation.
- La rupture est intentionnelle et doit être visible dans la version du package partagé et dans les messages d’erreur de chargement des pipelines.
- Tous les pipelines embarqués doivent être convertis en v3 dans la même branche d’implémentation ; aucun mélange v2/v3 n’est accepté.
- Le Module doit rester profond : les hôtes ne doivent pas recevoir de nouveaux détails de compilation ou de scheduling pour compenser la suppression de l’ancien modèle.
- Le comportement fail-fast est retenu comme défaut opérationnel pour rendre la première version déterministe. Une extension future vers des nœuds optionnels devra être justifiée par un cas réel et introduire un contrat explicite pour les inputs absents.
- La spec doit être suivie d’une décomposition en tâches verticales avec le skill `to-tickets`, chaque tâche livrant un comportement testable à travers le Seam `PipelineRuntime`.
