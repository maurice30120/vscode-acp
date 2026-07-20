# Spécification — Parité hôte des reprises de pause V3

**Statut :** ready-for-agent
**Source :** entretien `grill-with-docs`, synthèse `to-spec`, ADR-0025 et ADR-0026
**Portée :** package pipeline partagé, surface hôte Pi, surface hôte VS Code

## Problem Statement

Le travail validé dans `acp-cli` a stabilisé le bon modèle d’exécution pour un Pipeline V3 : démarrer un run, recevoir une pause typée, puis reprendre avec une décision V3 explicite. Les autres surfaces hôtes, Pi et VS Code, restent encore orientées autour du vocabulaire historique de planification : `createPlan`, `approvePlan`, `rejectPlan`, `plan-ready` et des messages webview `approvePipelinePlan`.

Ce vocabulaire n’est pas seulement ancien ; il encode un mauvais modèle mental. Une pause V3 peut être une question, une approbation ou une promotion. La traiter comme un “plan prêt” pousse chaque surface hôte à reconstruire localement une logique de contrôle, ce qui contredit le Runtime partagé, l’Adapter hôte mince et la Parité hôte.

L’utilisateur veut que le résultat satisfaisant obtenu dans `acp-cli` devienne la base commune des autres surfaces hôtes, sans conserver de rétrocompatibilité publique avec l’ancienne API plan.

## Solution

Faire un chantier atomique qui casse explicitement l’API plan dans le package partagé et migre immédiatement Pi et VS Code vers une API générique de pause/reprise V3.

Le package partagé expose uniquement le contrat générique : démarrer un Pipeline V3, inspecter la pause courante, reprendre avec une décision `answer`, `complete-interview`, `approve` ou `reject`, annuler et disposer. Les événements publics nomment des pauses V3, pas des plans.

Pi traduit ses commandes `/pipeline` vers ces décisions normalisées. VS Code remplace son flux webview “approval-only” par un flux de reprise de pause V3. Chaque surface hôte peut garder sa présentation propre, mais aucune ne doit consommer une pause V3 via une API ou un événement nommé “plan”.

Le chantier se fait en une seule rupture sur `acp-pipeline`, `plugin-pi` et `plugin-vscode`, parce qu’une phase intermédiaire laisserait au moins une surface hôte sur l’ancien modèle et recréerait le drift que cette spec vise à supprimer.

## User Stories

1. En tant qu’utilisateur de la CLI, je veux que le comportement validé dans `acp-cli` serve de référence, afin que les autres surfaces hôtes se comportent comme le Runtime partagé.
2. En tant qu’utilisateur Pi, je veux lancer un Pipeline V3 avec `/pipeline run`, afin de démarrer le même runtime que la CLI.
3. En tant qu’utilisateur Pi, je veux répondre à une question avec `/pipeline answer <réponse>`, afin de reprendre une pause `question`.
4. En tant qu’utilisateur Pi, je veux terminer un Entretien agent avec `/pipeline done`, afin de transmettre l’intention normalisée `complete-interview`.
5. En tant qu’utilisateur Pi, je veux approuver une pause avec `/pipeline approve`, afin de transmettre une décision V3 `approve`.
6. En tant qu’utilisateur Pi, je veux rejeter une pause avec `/pipeline reject`, afin de transmettre une décision V3 `reject`.
7. En tant qu’utilisateur Pi, je veux que l’approbation soit bloquée pendant une question d’entretien, afin de ne pas confondre réponse et validation.
8. En tant qu’utilisateur Pi, je veux que les messages affichés parlent de pause, question, approbation ou promotion selon le cas, afin de comprendre l’état réel du run.
9. En tant qu’utilisateur VS Code, je veux voir une pause question avec une zone de réponse, afin de répondre sans passer par une approbation de plan.
10. En tant qu’utilisateur VS Code, je veux disposer d’une action “terminer l’entretien”, afin de produire le résultat final sans inventer une réponse métier.
11. En tant qu’utilisateur VS Code, je veux voir une pause d’approbation avec des actions approuver/rejeter, afin de valider explicitement l’artifact final.
12. En tant qu’utilisateur VS Code, je veux voir une pause de promotion comme une décision distincte, afin de comprendre qu’elle peut appliquer des changements isolés.
13. En tant qu’utilisateur VS Code, je veux que les erreurs de reprise soient affichées comme erreurs de pause, afin de ne plus recevoir des messages limités à l’approbation de plan.
14. En tant qu’auteur de pipeline, je veux que les trois Surfaces hôtes consomment la même Configuration workspace, afin que le comportement ne dépende pas du point d’entrée.
15. En tant qu’auteur de pipeline, je veux que les pauses `question`, `approval` et `promotion` soient visibles comme telles, afin que le graphe V3 reste lisible.
16. En tant que mainteneur du Runtime partagé, je veux supprimer `createPlan`, `approvePlan` et `rejectPlan`, afin que l’ancienne API ne puisse plus être utilisée.
17. En tant que mainteneur du Runtime partagé, je veux renommer l’événement `plan-ready`, afin qu’une question ou une promotion ne soit jamais appelée un plan.
18. En tant que mainteneur du Runtime partagé, je veux exposer `startPipeline`, afin que les hôtes démarrent un run sans hypothèse de planification.
19. En tant que mainteneur du Runtime partagé, je veux exposer `resumePipeline`, afin que les hôtes transmettent directement une décision V3 typée.
20. En tant que mainteneur du Runtime partagé, je veux exposer l’inspection de la pause courante, afin que les hôtes puissent construire l’action utilisateur correcte.
21. En tant que mainteneur du Runtime partagé, je veux que le rejet soit une décision de reprise, afin qu’il suive les mêmes règles d’identité de pause que les autres décisions.
22. En tant que mainteneur Pi, je veux supprimer la reprise d’entretien basée sur un nouvel appel de création, afin qu’une réponse ne démarre jamais un nouveau run.
23. En tant que mainteneur Pi, je veux que `/pipeline done` soit seulement une traduction hôte, afin que le Runtime partagé reste propriétaire de la Sortie d’entretien.
24. En tant que mainteneur VS Code, je veux remplacer `approvePipelinePlan` et `rejectPipelinePlan`, afin que le webview ne soit plus couplé à une pause d’approbation.
25. En tant que mainteneur VS Code, je veux un message webview générique de reprise de pause, afin de gérer toutes les pauses V3 avec un seul contrat.
26. En tant que mainteneur VS Code, je veux que la projection conversationnelle transporte le type et l’identifiant de pause, afin de cibler la bonne reprise.
27. En tant que mainteneur, je veux que les tests échouent si une surface hôte réintroduit l’API plan, afin de préserver la Parité hôte.
28. En tant que mainteneur, je veux que les tests couvrent les décisions `answer`, `complete-interview`, `approve` et `reject`, afin de verrouiller le contrat observable.
29. En tant que mainteneur, je veux faire cette rupture dans un seul chantier atomique, afin d’éviter une période de drift entre les Surfaces hôtes.
30. En tant que mainteneur, je veux documenter la décision en ADR, afin que les futurs changements respectent la frontière entre Runtime partagé et Adapter hôte.

## Implementation Decisions

- Le package partagé supprime l’API publique orientée plan : `createPlan`, `approvePlan` et `rejectPlan` ne restent pas comme façades de compatibilité.
- Le package partagé expose une API générique de Pipeline V3 : démarrage, reprise par décision typée, inspection de pause courante, annulation et disposal.
- La reprise accepte les décisions normalisées existantes du Runtime partagé : `answer`, `complete-interview`, `approve` et `reject`.
- Le rejet d’une pause ne passe plus par une méthode spéciale nommée plan ; il devient une décision de reprise ciblant l’identifiant de pause courant.
- L’événement public `plan-ready` est remplacé par un événement de pause V3.
- L’événement de pause transporte au minimum l’identifiant de pause, le type de pause, le contenu, le format, le nœud concerné et les métadonnées utiles à la projection hôte.
- Aucun événement public du package partagé ne doit appeler une pause V3 un “plan”.
- Pi migre `/pipeline run` vers l’API de démarrage générique.
- Pi migre `/pipeline answer` vers `resumePipeline` avec une décision `answer`.
- Pi ajoute ou conserve `/pipeline done` comme traduction hôte de `complete-interview`.
- Pi migre `/pipeline approve` vers `resumePipeline` avec une décision `approve`.
- Pi migre `/pipeline reject` vers `resumePipeline` avec une décision `reject`.
- Pi ne doit plus relancer un pipeline ou appeler une création de plan pour répondre à une question.
- VS Code remplace les messages webview `approvePipelinePlan` et `rejectPipelinePlan` par un message générique de reprise de pause.
- VS Code projette les pauses depuis leur type réel : question, approbation ou promotion.
- La surface webview VS Code peut garder une présentation spécifique par type, mais l’action envoyée à l’extension reste une décision V3 normalisée.
- Le vocabulaire de domaine à utiliser dans les noms d’API et documents est : Surface hôte, Runtime partagé, Adapter hôte, Pipeline V3, Entretien agent, Sortie d’entretien et Parité hôte.
- Les anciennes documentations qui décrivent `createPlan`, `approvePlan`, `rejectPlan` ou `plan-ready` doivent être mises à jour ou considérées comme obsolètes dans le périmètre touché.
- Un ADR court doit enregistrer la règle : aucune Surface hôte ne peut consommer une pause V3 via une API ou un événement nommé “plan”.
- Le chantier est atomique sur `acp-pipeline`, `plugin-pi` et `plugin-vscode`; il n’y a pas de phase de compatibilité publique.

## Testing Decisions

- Le seam principal de test est `PipelineService` dans le package partagé.
- Les tests du package partagé doivent vérifier le comportement externe : démarrage d’un Pipeline V3, émission d’une pause générique, inspection de la pause courante, reprise avec chaque décision supportée et résultat final.
- Les tests du package partagé doivent vérifier que les pauses `question`, `approval` et `promotion` sont exposées avec leur type réel.
- Les tests du package partagé doivent couvrir un chemin négatif de reprise avec mauvais identifiant de pause ou absence de pause courante.
- Les tests du package partagé doivent échouer si les anciennes méthodes publiques orientées plan réapparaissent.
- Le seam Pi est le couple `PipelineController` / commandes `/pipeline`.
- Les tests Pi doivent vérifier la traduction observable des commandes vers les décisions V3, sans tester les détails internes du contrôleur.
- Les tests Pi doivent vérifier que `/pipeline answer` ne démarre pas de nouveau run.
- Les tests Pi doivent vérifier que `/pipeline done` transmet `complete-interview`.
- Les tests Pi doivent vérifier que `/pipeline approve` est refusé pendant une question et repris pendant une pause d’approbation.
- Le seam VS Code est `OrchestrationRuntime` et les messages webview.
- Les tests VS Code doivent vérifier que le démarrage utilise l’API générique du package partagé.
- Les tests VS Code doivent vérifier que le message webview de reprise produit une décision V3 ciblant la pause courante.
- Les tests VS Code doivent vérifier que les anciens messages `approvePipelinePlan` et `rejectPipelinePlan` ne sont plus le contrat de reprise.
- Le seam webview est minimal : mapping des messages hôte vers l’état affichable et des actions utilisateur vers le message de reprise générique.
- Les tests webview ne doivent pas vérifier les détails visuels ; ils doivent vérifier les états et messages observables.
- Les tests existants du Runtime partagé, de Pi et de VS Code servent de prior art, notamment les tests de `PipelineRuntime`, `PipelineService`, `PipelineController`, `OrchestrationRuntime` et projections conversationnelles.

## Out of Scope

- Changer le langage Pipeline V3 lui-même.
- Modifier la sémantique interne de l’Entretien agent déjà définie par ADR-0026.
- Ajouter une nouvelle Surface hôte.
- Conserver une couche de rétrocompatibilité publique pour `createPlan`, `approvePlan`, `rejectPlan` ou `plan-ready`.
- Refaire entièrement le design visuel du webview VS Code.
- Modifier les règles de Sandcastle au-delà de l’exposition correcte de la pause `promotion`.
- Introduire un nouveau protocole d’entretien.
- Changer la Configuration workspace ou le format des pipelines existants, sauf si des noms historiques dans la documentation doivent être corrigés.

## Further Notes

Le brouillon de code actuel contient déjà une partie de l’intuition correcte, mais il conserve une façade de compatibilité `createPlan` / `approvePlan` et un événement encore nommé `plan-ready`. Il doit donc être traité comme brouillon non validé, à transformer ou annuler selon cette spec.

La décision architecturale clé est la rupture atomique : si le package partagé casse l’API plan, Pi et VS Code doivent migrer dans le même chantier. Laisser une Surface hôte sur l’ancien modèle créerait une période de drift contraire à l’objectif de Parité hôte.

Cette spec doit être accompagnée d’un ADR parce qu’elle fixe une frontière durable : le Runtime partagé possède les pauses et décisions V3 ; chaque Adapter hôte traduit uniquement son interaction utilisateur locale vers ce contrat commun.
