# Spécification — pipeline de livraison multi-agents

**Statut :** prête pour découpage en tickets  
**Source :** synthèse de la session `grill-me` validée par l’utilisateur  
**Branche source de travail :** `agent/interactive-grill-skeleton-tdd`  
**Prérequis architectural :** le runtime pipeline partagé et la DSL DAG v3 décrits dans les documents d’architecture de la branche restent les seams de référence. Cette évolution les étend ; elle ne crée pas un second orchestrateur.

## Problem Statement

Le pipeline actuel sait enchaîner une planification, une approbation, une implémentation et une revue, mais il traite encore l’implémentation comme une exécution essentiellement monolithique. Un agent Sandcastle qui produit des modifications peut être promu directement vers le workspace selon une politique `ask`, `autoApply` ou `autoReject`. Cette promotion immédiate ne convient pas à un workflow dans lequel plusieurs agents implémentent des tickets indépendants en parallèle.

L’utilisateur veut transformer ce workflow en une chaîne de livraison structurée : un entretien `grill-me` produit des décisions, un agent `toSpec` les transforme en spécification, un agent `toTicket` les transforme en DAG de tickets, un implémenteur travaille sur chaque ticket, un ou plusieurs agents de merge intègrent les branches, puis un agent indépendant vérifie le résultat global en lecture seule.

Sans changement architectural, plusieurs problèmes apparaissent :

- plusieurs implémenteurs peuvent modifier le même workspace ou promouvoir leurs changements trop tôt ;
- les tickets dépendants peuvent démarrer depuis des branches parentes non intégrées et donc incompatibles ;
- les conflits de merge, les adaptations d’intégration et les échecs de validation n’ont pas de responsabilité explicite ;
- un reviewer textuel ne fournit pas un verdict structuré par catégories ni une attribution exploitable vers les tickets responsables ;
- les corrections peuvent repartir d’une branche obsolète plutôt que de l’état réellement vérifié ;
- une interruption de Pi, VS Code ou d’un agent peut perdre l’état d’orchestration même lorsque les branches Git existent encore ;
- la branche source active peut évoluer pendant l’exécution sans politique claire ;
- Pi et VS Code risquent de reconstruire séparément les mêmes règles de parallélisme, de reprise, de merge et de vérification.

Le système doit donc faire de la branche d’intégration et des artefacts structurés la frontière entre implémentation, merge et vérification, tout en conservant le runtime pipeline partagé comme propriétaire du cycle de vie.

## Solution

Construire un pipeline de livraison multi-agents au-dessus du runtime DAG partagé.

La phase de planification est strictement séquencée :

1. `grill-me` résout une décision utilisateur à la fois jusqu’à produire un plan décisionnel complet ;
2. `toSpec` synthétise les décisions approuvées en une spécification normative ;
3. l’utilisateur approuve une version précise de la spécification ;
4. `toTicket` transforme cette spécification en un DAG de tickets verticaux, avec dépendances, périmètres, critères d’acceptation et validations ;
5. l’utilisateur approuve une version précise du DAG et des tickets.

Après cette seconde approbation, le runtime exécute un implémenteur par ticket prêt. Chaque implémenteur travaille dans un sandbox et une branche dédiés. Il ne promeut jamais directement ses changements vers le workspace. Il retourne une branche, ses commits, son périmètre réellement modifié, ses validations et ses notes d’intégration dans un contrat structuré et versionné.

Les tickets indépendants s’exécutent en parallèle. Un ticket dépendant ne démarre qu’après la création d’un checkpoint d’intégration contenant toutes ses dépendances. Le runtime peut regrouper les branches indépendantes selon le DAG, les périmètres possédés, les fichiers partagés et les collisions observées. Un ou plusieurs agents de merge intègrent les groupes, résolvent tous les conflits et produisent une branche d’intégration unique.

Le mergeur lance des validations déterministes après chaque checkpoint. Il corrige directement les défauts dus au merge ou à l’assemblage. Les défauts localisables à un ticket repartent vers l’implémenteur d’origine. Les défauts transversaux sont routés selon leur impact : réparations parallèles, ticket transversal ou révision du DAG.

Après l’intégration complète et la prise en compte éventuelle de la dérive de la branche source, un agent de vérification indépendant inspecte un bundle dédié en lecture seule. Il produit un rapport structuré par catégories. La décision globale est calculée par le moteur selon les catégories obligatoires du pipeline et les surcharges des tickets.

En cas d’échec, les implémenteurs concernés reçoivent une branche de réparation créée depuis la branche d’intégration réellement vérifiée, et non depuis leur ancienne branche de ticket. Le cycle réparation → merge → vérification est borné globalement et par ticket.

Lorsque toutes les catégories obligatoires passent, la promotion finale est configurable : fusion vers la branche source, création d’une pull request ou conservation de la branche validée.

Le moteur persiste un journal d’événements et des snapshots via un backend configurable. Git reste la source de vérité du code. Pi et VS Code consomment le même runtime et les mêmes contrats.

## User Stories

1. En tant qu’utilisateur, je veux que `grill-me` pose une seule question à la fois, afin de prendre chaque décision explicitement.
2. En tant qu’utilisateur, je veux qu’une recommandation par défaut accompagne chaque question, afin d’avancer rapidement lorsque je n’ai pas de préférence particulière.
3. En tant qu’utilisateur, je veux que `toSpec` synthétise uniquement les décisions déjà validées, afin qu’aucune exigence ne soit inventée silencieusement.
4. En tant qu’utilisateur, je veux approuver une version précise de la spécification, afin que les agents ultérieurs travaillent sur un contrat figé.
5. En tant qu’utilisateur, je veux que `toTicket` transforme la spécification approuvée en tickets verticaux, afin que chaque ticket livre un comportement vérifiable.
6. En tant qu’utilisateur, je veux approuver le DAG et les tickets avant l’implémentation, afin de contrôler la granularité et les dépendances.
7. En tant qu’auteur de pipeline, je veux que chaque ticket possède un identifiant stable, afin de tracer sa branche, ses validations, ses réparations et son intégration.
8. En tant qu’auteur de pipeline, je veux déclarer les dépendances de chaque ticket, afin que le runtime calcule automatiquement la frontière exécutable.
9. En tant qu’auteur de pipeline, je veux déclarer un périmètre principal et des zones partagées, afin de limiter les collisions sans empêcher les changements transverses nécessaires.
10. En tant qu’auteur de pipeline, je veux définir des critères d’acceptation et des commandes de validation par ticket, afin que l’implémenteur et le vérificateur partagent le même contrat observable.
11. En tant qu’utilisateur, je veux qu’un implémenteur distinct travaille sur chaque ticket prêt, afin d’exploiter le parallélisme du DAG.
12. En tant qu’utilisateur, je veux limiter adaptativement le nombre d’agents simultanés, afin de respecter les ressources locales et les quotas des fournisseurs.
13. En tant qu’utilisateur, je veux configurer l’agent, le modèle, l’effort et l’environnement par rôle, afin d’utiliser un agent spécialisé pour l’implémentation, le merge ou la vérification.
14. En tant qu’auteur de pipeline, je veux pouvoir surcharger l’implémenteur d’un ticket particulier, afin d’affecter une tâche spécialisée à l’agent le plus adapté.
15. En tant qu’utilisateur, je veux que chaque implémenteur travaille dans un sandbox et une branche isolés, afin qu’aucune modification partielle n’atteigne le workspace principal.
16. En tant qu’utilisateur, je veux que les implémenteurs ne puissent pas promouvoir directement leurs changements, afin que seul le processus d’intégration décide du code final.
17. En tant que mergeur, je veux recevoir les commits, validations, fichiers partagés et notes d’intégration de chaque ticket, afin de comprendre l’intention des branches.
18. En tant que mergeur, je veux choisir l’ordre des branches indépendantes tout en respectant les dépendances obligatoires, afin de réduire les conflits.
19. En tant que mergeur, je veux résoudre tous les conflits et adapter le code d’intégration, afin de produire un ensemble cohérent.
20. En tant qu’utilisateur, je veux que plusieurs groupes indépendants puissent être intégrés en parallèle lorsque le risque est faible, afin d’accélérer les gros DAG.
21. En tant qu’utilisateur, je veux qu’un mergeur final réconcilie les groupes intermédiaires, afin d’obtenir une branche d’intégration unique.
22. En tant qu’auteur de pipeline, je veux configurer la stratégie Git d’intégration, afin de choisir entre squash, merge et cherry-pick.
23. En tant qu’utilisateur, je veux que la stratégie squash produise un commit propre par ticket tout en conservant les SHA d’origine, afin de concilier lisibilité et traçabilité.
24. En tant qu’utilisateur, je veux que les validations déterministes s’exécutent après chaque checkpoint, afin de découvrir les erreurs avant les tickets dépendants.
25. En tant qu’auteur de pipeline, je veux combiner les validations du ticket, du pipeline et de la détection automatique, afin de couvrir les projets Node, .NET, Java, Rust ou Python sans duplication.
26. En tant qu’utilisateur, je veux que le mergeur corrige les erreurs causées par l’intégration, afin de ne pas renvoyer un conflit mécanique aux implémenteurs.
27. En tant qu’utilisateur, je veux qu’une erreur localisable à un ticket retourne à son implémenteur d’origine, afin de préserver la responsabilité du code.
28. En tant qu’utilisateur, je veux qu’un défaut transversal puisse devenir plusieurs réparations ou un ticket transversal, afin d’adapter la correction à sa vraie portée.
29. En tant qu’utilisateur, je veux que les corrections du mergeur soient classées par impact, afin d’appliquer le niveau de contrôle approprié.
30. En tant qu’utilisateur, je veux qu’une modification fonctionnelle ou architecturale du mergeur déclenche une vérification dédiée, afin qu’une adaptation importante ne soit pas auto-validée.
31. En tant qu’utilisateur, je veux que le vérificateur soit strictement en lecture seule, afin qu’il reste indépendant des producteurs du code.
32. En tant qu’utilisateur, je veux que le vérificateur démarre dans une session neuve et différente de celle du mergeur, afin de réduire le biais de confirmation.
33. En tant que vérificateur, je veux recevoir un bundle filtré contenant la spec, les tickets, le diff, les validations et les ajustements de merge, afin d’évaluer le résultat sans dépendre des conversations internes.
34. En tant qu’utilisateur, je veux que le vérificateur contrôle le fonctionnel, les tests, l’intégration, l’architecture, la sécurité et la qualité, afin de rendre son verdict explicable.
35. En tant qu’auteur de pipeline, je veux définir les catégories obligatoires par défaut, afin d’adapter la rigueur au pipeline.
36. En tant qu’auteur de ticket, je veux renforcer les catégories obligatoires pour une tâche sensible, afin que la sécurité ou l’architecture devienne bloquante lorsque nécessaire.
37. En tant qu’utilisateur, je veux qu’un échec de vérification identifie les tickets responsables et fournisse des instructions de réparation, afin que le runtime puisse router automatiquement le travail.
38. En tant qu’implémenteur, je veux recevoir une branche de réparation créée depuis l’intégration vérifiée, afin de corriger le code dans son contexte réel.
39. En tant qu’utilisateur, je veux limiter les cycles de réparation globalement et par ticket, afin d’éviter les boucles infinies.
40. En tant qu’utilisateur, je veux conserver la dernière branche d’intégration lorsqu’une limite est atteinte, afin de pouvoir reprendre manuellement.
41. En tant qu’utilisateur, je veux que la branche source active soit capturée au démarrage, afin que la cible de promotion ne soit jamais supposée être `main`.
42. En tant qu’auteur de pipeline, je veux choisir une politique de dérive `freeze`, `integrate` ou `abort`, afin de contrôler les nouveaux commits arrivés pendant le run.
43. En tant qu’utilisateur, je veux que la politique `integrate` fasse intégrer les nouveaux commits par le mergeur avant la vérification finale, afin de valider l’état réellement promu.
44. En tant qu’auteur de pipeline, je veux choisir `merge`, `pull-request` ou `keep-branch` comme promotion finale, afin d’adapter le degré d’autonomie.
45. En tant qu’utilisateur, je veux que la promotion ne soit possible qu’après réussite des catégories obligatoires, afin qu’aucun code non validé n’atteigne la cible.
46. En tant qu’utilisateur, je veux qu’un journal d’événements décrive chaque transition, afin d’auditer et diagnostiquer le run.
47. En tant qu’utilisateur, je veux que des snapshots permettent une reprise rapide, afin de ne pas reconstruire tout l’état à chaque redémarrage.
48. En tant qu’auteur de pipeline, je veux choisir un backend de persistance workspace ou utilisateur, afin d’adapter la durée de vie des runs.
49. En tant qu’utilisateur, je veux reprendre une session native d’agent lorsque cela est sûr, afin de conserver le contexte de travail.
50. En tant qu’utilisateur, je veux reprendre depuis la branche et les commits lorsque la session native est indisponible, afin de ne pas perdre le code déjà produit.
51. En tant qu’utilisateur, je veux recréer une étape depuis le dernier checkpoint stable lorsque ni session ni branche ne sont exploitables, afin de garantir une stratégie de dernier recours.
52. En tant qu’utilisateur Pi, je veux lancer, approuver, inspecter, interrompre et reprendre ce pipeline depuis Pi, afin de bénéficier du workflow complet dans le terminal.
53. En tant qu’utilisateur VS Code, je veux piloter le même run et voir les mêmes états métier, afin que le comportement ne dépende pas de l’hôte.
54. En tant qu’utilisateur, je veux pouvoir commencer un run dans un hôte et le reprendre dans l’autre, afin que la persistance soit réellement commune.
55. En tant que mainteneur, je veux que toutes les sorties d’agents suivent des contrats versionnés, afin d’éviter le parsing fragile de texte libre.
56. En tant que mainteneur, je veux que le moteur demande automatiquement une correction de format lorsque la sortie est invalide, afin de tolérer une erreur de sérialisation sans refaire le travail.
57. En tant que mainteneur, je veux qu’une version de contrat inconnue soit refusée explicitement, afin de prévenir les incompatibilités silencieuses.
58. En tant que mainteneur, je veux que les branches Git restent la source de vérité du code et que le runtime possède seulement l’orchestration, afin de garder des responsabilités nettes.

## Implementation Decisions

### Pipeline de planification

- La chaîne de planification est `grill-me` → `toSpec` → approbation de la spécification → `toTicket` → approbation du DAG et des tickets.
- `toSpec` utilise les sept sections du skill amont et ne réinterroge pas l’utilisateur.
- `toTicket` produit des tickets verticaux, chacun adapté à une fenêtre de contexte fraîche.
- Lorsqu’une décomposition échoue, le retour dépend du niveau : nouvelle tentative locale dans `toTicket`, retour à `toSpec` pour une exigence technique, retour à `grill-me` pour une décision utilisateur.
- Une modification d’un artefact parent rend obsolètes ses descendants. `toTicket` marque chaque ancien ticket `reuse`, `adapt` ou `restart` lorsque la spec évolue.
- Les deux approbations figent un numéro de version, un digest du contenu et l’identité de l’approbateur.

### Contrats d’artefacts

- Les sorties suivantes ont un schéma versionné : décisions grill, spécification, graphe de tickets, résultat d’implémentation, résultat de merge et rapport de vérification.
- Le moteur valide chaque sortie avant de la publier dans le snapshot du run.
- Une sortie invalide déclenche une reprise bornée de la même session avec une erreur de validation structurée. Après la limite, l’étape échoue en conservant ses artefacts, sa branche et sa session.
- Le graphe de tickets contient au minimum : identifiant, titre, dépendances, périmètre principal, zones partagées, critères d’acceptation, validations, règles de vérification et notes d’intégration.
- Le résultat d’implémentation contient au minimum : branche, commits, fichiers modifiés par classe de périmètre, validations exécutées, limitations connues et notes d’intégration.

### Exécution des tickets

- Le runtime compile le graphe de tickets approuvé en sous-graphe d’exécution dynamique.
- Tout ticket sans dépendance non satisfaite appartient à la frontière et peut démarrer.
- Un implémenteur est créé par ticket. Les valeurs par rôle peuvent être surchargées par ticket.
- Le scheduler est adaptatif avec des plafonds `maxTotal` et `maxByRole`.
- Les implémenteurs utilisent Sandcastle par défaut, avec environnement configurable par rôle.
- Un implémenteur ne peut jamais appeler la promotion finale de son sandbox. La fin de son étape conserve la branche et les commits pour l’intégration.

### Checkpoints et merge

- Tout ticket dépendant part obligatoirement d’un checkpoint d’intégration contenant toutes ses dépendances.
- Le regroupement des merges tient compte du DAG, des périmètres, des zones partagées, des fichiers réellement modifiés et des notes d’intégration.
- Les groupes indépendants peuvent être intégrés en parallèle ; un mergeur final produit ensuite une branche unique.
- Le mergeur reçoit une spec globale, le checkpoint de départ, les tickets du groupe, leurs dépendances, leurs résultats structurés et les validations à exécuter.
- Le mergeur résout tous les conflits et peut modifier le code pour réconcilier les branches. Il ne doit pas réimplémenter silencieusement un ticket complet.
- La stratégie Git est configurable : `squash` par défaut, `merge` ou `cherry-pick`. La traçabilité conserve les SHA source et le commit d’intégration.
- Le mergeur classe ses adaptations `mechanical`, `limited` ou `architectural`. Le moteur applique des règles minimales et peut relever la classification. Une ambiguïté déclenche un triage indépendant.

### Validations déterministes

- Les validations sont résolues à partir des commandes du ticket, des commandes globales du pipeline et de la détection automatique, puis normalisées et dédupliquées.
- Elles s’exécutent après chaque checkpoint et avant la vérification finale.
- Un échec dû au merge est corrigé par le mergeur. Un échec localisable est renvoyé à l’implémenteur. Un échec transversal ou incertain retourne à `toTicket`.
- Une correction mécanique du mergeur exige uniquement les validations déterministes. Une adaptation limitée est couverte par la vérification finale. Une adaptation fonctionnelle ou architecturale exige une mini-vérification dédiée en lecture seule.

### Vérification indépendante

- Le vérificateur est strictement read-only au niveau de la politique d’exécution et du montage du filesystem lorsque le transport le permet.
- Il utilise une session neuve. Il doit être différent du mergeur ; la diversité par rapport aux implémenteurs est préférée.
- Le moteur construit un bundle contradictoire contenant les artefacts approuvés, la branche et le diff d’intégration, les validations, les contrats publics, les ajustements du mergeur, les limitations connues et les affirmations d’acceptation.
- Le vérificateur relance les validations nécessaires et recherche des défauts non déclarés.
- Les catégories sont au minimum : `functional`, `tests`, `integration`, `architecture`, `security` et `quality`.
- Les règles du pipeline définissent les catégories requises, consultatives et requises lorsqu’elles sont présentes. Les tickets peuvent renforcer ces règles.
- La décision globale est dérivée automatiquement. Un échec d’une catégorie obligatoire bloque la promotion.

### Réparation et escalade

- Un défaut local crée une branche `repair` depuis la branche d’intégration vérifiée et retourne à l’implémenteur d’origine.
- Un défaut transversal séparable crée plusieurs réparations parallèles. Un défaut nécessitant une conception commune crée un ticket transversal. Des frontières incorrectes déclenchent une révision du DAG.
- Une correction locale conforme au ticket ne relance pas `toTicket`. Une modification de périmètre ou de critères relance `toTicket`. Une exigence technique incorrecte retourne à `toSpec`. Une décision utilisateur manquante retourne à `grill-me`.
- Le runtime applique une limite globale de cycles et une limite par ticket. Les valeurs par défaut sont `maxCycles: 4` et `maxCyclesPerTicket: 2`.

### Branche source et promotion finale

- Le runtime capture la branche active et son SHA au démarrage. Il ne suppose jamais `main`.
- La politique de dérive est configurable : `freeze`, `integrate` par défaut ou `abort`.
- Avec `integrate`, le mergeur intègre les nouveaux commits de la branche source avant la vérification finale.
- La promotion finale est configurable : `merge`, `pull-request` ou `keep-branch`.
- La cible par défaut est la branche source capturée. La promotion est impossible tant que les catégories obligatoires n’ont pas réussi.

### Persistance et reprise

- Le moteur persiste un journal d’événements append-only et un snapshot courant.
- Git demeure la source de vérité pour le code, les branches et les commits.
- Le backend est configurable avec deux premières implémentations : `workspace` et `user`.
- La reprise suit cet ordre : session native cohérente, branche et commits cohérents, recréation depuis le dernier checkpoint stable.
- Chaque reprise vérifie la branche, le SHA, le worktree, l’identité de la tâche et l’absence d’un autre propriétaire actif.

### Hôtes et seams

- `PipelineRuntime` reste le seam public du cycle de vie. Le nouveau workflow utilise les résultats discriminés, les pauses génériques, les snapshots et les événements du runtime partagé.
- Pi et VS Code sont des adaptateurs de commandes et de présentation. Ils ne réimplémentent ni le DAG de tickets, ni la politique de merge, ni la réparation, ni la reprise.
- Les actions visibles communes sont : démarrer, répondre à `grill-me`, approuver la spec, approuver les tickets, inspecter, annuler, reprendre et consulter le résultat final.

## Testing Decisions

- Le seam principal de test est `PipelineRuntime`. Les scénarios de bout en bout doivent piloter le run avec `start`, `resume`, `inspect` et `cancel`, sans dépendre directement de LangGraph.
- Les contrats versionnés sont testés avec des sorties valides, invalides, inconnues et corrigées après reprise de session.
- Le compilateur du graphe de tickets est testé avec des frontières parallèles, des dépendances, des cycles, des périmètres partagés et des tickets obsolètes.
- Le scheduler est testé avec une horloge et des runners contrôlés afin de vérifier les plafonds, le parallélisme réel et l’ordre imposé par les checkpoints.
- L’intégration Git est testée dans des dépôts temporaires couvrant squash, merge, cherry-pick, conflits, branches de réparation et dérive de branche source.
- La résolution des validations est testée indépendamment de leur exécution, puis avec des commandes factices qui réussissent ou échouent.
- Le vérificateur est testé via son bundle public et son rapport structuré. Les tests doivent confirmer qu’une catégorie requise bloque et qu’un avertissement consultatif ne bloque pas.
- Les politiques read-only doivent être testées sur les adapters ACP natif et Sandcastle. Un vérificateur ne doit pas pouvoir produire une modification promue.
- La persistance est testée par arrêt et reconstruction du runtime avec le backend workspace puis utilisateur.
- La reprise est testée pour les trois niveaux : session native, branche existante et checkpoint stable.
- Pi et VS Code doivent partager des tests de contrat d’adapter afin de prouver qu’ils projettent les mêmes résultats métier.
- Un scénario d’acceptation complet doit couvrir : grill → spec → tickets → implémenteurs parallèles → merge avec conflit → validation → vérification échouée → réparation ciblée → nouvelle vérification → promotion.
- Les tests vérifient les comportements observables, les branches produites, les résultats discriminés et les artefacts publics. Ils ne doivent pas figer les détails internes du moteur de graphe.

## Out of Scope

- Une UI graphique avancée de revue de diff ou d’acceptation hunk par hunk.
- La collaboration temps réel de plusieurs utilisateurs sur une même approbation.
- Un backend de persistance distant ou distribué dans la première livraison.
- La création d’un nouveau protocole réseau entre les agents ; ACP et Sandcastle restent les adapters d’exécution.
- L’entraînement ou l’évaluation automatique des modèles utilisés par rôle.
- La garantie qu’un agent résolve correctement tout conflit fonctionnel ; le système garantit le routage, les validations et les limites de boucle.
- La conservation indéfinie de tous les conteneurs et worktrees après un état terminal.
- Une compatibilité avec la DSL pipeline v2 après la migration vers la v3.

## Further Notes

- Cette évolution doit être implémentée après ou en continuité directe de la migration runtime/DSL v3 déjà spécifiée dans la branche. Les tickets doivent réutiliser les seams `PipelineRuntime`, `PipelineRunStore`, politiques d’exécution, artefacts typés et DAG plutôt que contourner ces abstractions.
- La configuration par défaut doit privilégier la sécurité et la traçabilité : Sandcastle pour les rôles qui écrivent, vérificateur read-only, squash par ticket, dérive `integrate`, promotion `pull-request`, session neuve de vérification et limites de réparation bornées.
- Le mode local explicitement autonome peut choisir une promotion `merge`, mais cette option reste un choix du pipeline.
- Les noms de branches doivent être déterministes à partir du run, du ticket, du checkpoint ou du cycle de réparation afin de faciliter la reprise et le diagnostic.
- La branche source utilisée pour cette planification est `agent/interactive-grill-skeleton-tdd`. Les fichiers de spécification et de tickets sont publiés sur cette branche afin que l’implémentation parte du même historique que la session de conception.
