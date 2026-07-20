# Spécification — Entretiens agent dans le runtime pipeline V3

**Statut :** ready-for-agent
**Source :** ADR-0026 et entretien `grill-with-docs`
**Portée :** runtime pipeline partagé et adapter CLI uniquement

## Problem Statement

Lorsqu’un nœud de planification utilisant `grill-me` produit une question, le pipeline V3 actuel considère néanmoins l’exécution du nœud agent comme terminée. Le nœud de pause suivant étant déclaré comme une approbation, la CLI affiche `Approve pipeline pause? [y/N]` au lieu de permettre à l’utilisateur de répondre. Après `y`, le pipeline lance silencieusement l’agent suivant, alors que l’entretien n’a pas produit de plan final.

L’utilisateur doit pouvoir mener plusieurs tours de questions-réponses, choisir à tout moment de terminer l’entretien avec `/done`, examiner le plan final, puis seulement l’approuver avec `y`. Cette boucle ne peut pas appartenir à la CLI : elle doit être identique pour toutes les surfaces hôtes et rester reprenable depuis l’état du run.

## Solution

Ajouter l’**entretien agent** comme capacité explicite et optionnelle d’un nœud agent V3. Un nœud configuré avec un protocole d’entretien reste en cours tant que l’agent produit l’état normalisé `question`. Chaque question devient une pause V3 persistée. Une décision `answer` ajoute un tour utilisateur et reprend le même entretien avec son historique. Une décision `complete-interview` oblige l’agent à produire immédiatement l’état `ready`, sans nouvelle question.

Le package pipeline partagé possède la machine à états, l’historique structuré et le registre de protocoles. La première implémentation de protocole, `proposed-plan`, traduit les balises du plan vers les états normalisés `question` et `ready`. La CLI ne parse aucune balise : elle projette les pauses du runtime, traduit `/done` en `complete-interview`, puis utilise la pause d’approbation V3 ordinaire lorsque le plan final est prêt.

Le snapshot est la source de vérité. Le comportement de référence relance un agent avec la demande initiale et l’historique structuré complet. Une session ACP active pourra ultérieurement être réutilisée comme optimisation, mais sa perte ne doit jamais empêcher la reprise.

La première livraison modifie uniquement le runtime partagé et la CLI. Elle est essayée sur le pipeline réel avant toute adaptation de Pi ou VS Code.

## User Stories

1. En tant qu’utilisateur de la CLI, je veux répondre directement à une question de `grill-me`, afin de ne pas confondre une question avec une approbation.
2. En tant qu’utilisateur de la CLI, je veux voir la question produite par l’agent avant le champ de réponse, afin de savoir quelle décision prendre.
3. En tant qu’utilisateur de la CLI, je veux que chaque question affiche `Answer [/done to finish]:`, afin de pouvoir découvrir et utiliser la sortie de l’entretien à tout moment.
4. En tant qu’utilisateur de la CLI, je veux saisir une réponse libre, afin que l’entretien puisse résoudre la décision courante.
5. En tant qu’utilisateur de la CLI, je veux qu’une saisie vide soit refusée, afin de ne pas reprendre accidentellement le run sans réponse.
6. En tant qu’utilisateur de la CLI, je veux pouvoir saisir `/done`, afin de demander immédiatement la synthèse du plan final.
7. En tant qu’utilisateur de la CLI, je veux qu’aucune nouvelle question ne soit acceptée après `/done`, afin que la sortie de l’entretien soit déterministe.
8. En tant qu’utilisateur de la CLI, je veux examiner le plan final avant de l’approuver, afin que terminer l’entretien ne signifie pas accepter son résultat.
9. En tant qu’utilisateur de la CLI, je veux que `y` soit proposé seulement après l’état `ready`, afin de ne jamais approuver un entretien incomplet.
10. En tant qu’utilisateur de la CLI, je veux que `y` démarre effectivement la suite du pipeline, afin que l’approbation ne laisse pas la commande bloquée.
11. En tant qu’utilisateur de la CLI, je veux voir un log lorsque l’agent suivant démarre, afin de distinguer une exécution longue d’un blocage.
12. En tant qu’utilisateur de la CLI, je veux que `Ctrl+C` annule le run, afin de pouvoir abandonner proprement le pipeline.
13. En tant qu’utilisateur, je veux que le rejet d’une question annule le pipeline entier, afin que `reject` conserve une sémantique V3 unique.
14. En tant qu’auteur de pipeline, je veux activer explicitement un protocole d’entretien sur un nœud agent, afin que les nœuds existants conservent leur comportement actuel.
15. En tant qu’auteur de pipeline, je veux qu’un protocole inconnu soit rejeté à la compilation, afin de détecter une configuration invalide avant l’exécution.
16. En tant qu’auteur de pipeline, je veux configurer le nombre de réparations de sortie indépendamment des retries techniques, afin de distinguer une réponse mal formée d’une panne d’agent.
17. En tant qu’auteur de pipeline, je veux qu’une sortie `ready` soit la seule à produire l’artifact déclaré, afin que les consommateurs ne reçoivent jamais une question intermédiaire.
18. En tant qu’auteur de pipeline, je veux que le bloc `<proposed_plan>` final soit conservé intégralement, afin de respecter le contrat `acp.grill-decision/v1` existant.
19. En tant que mainteneur du runtime, je veux représenter chaque question par une pause V3 ordinaire, afin de réutiliser les garanties de reprise et d’obsolescence existantes.
20. En tant que mainteneur du runtime, je veux qu’une réponse cible l’identifiant exact de la pause courante, afin qu’une réponse tardive ne soit jamais appliquée à une autre question.
21. En tant que mainteneur du runtime, je veux conserver les tours agent et utilisateur dans le snapshot, afin de pouvoir inspecter et restaurer l’entretien.
22. En tant que mainteneur du runtime, je veux pouvoir rejouer l’historique dans un nouvel agent, afin de ne pas dépendre de la durée de vie d’un processus ACP.
23. En tant que mainteneur du runtime, je veux confiner la syntaxe `<proposed_plan>` dans son protocole, afin que le cœur du runtime reste indépendant du format de sortie.
24. En tant que mainteneur du runtime, je veux effectuer au plus une réparation de protocole par défaut, afin de corriger une erreur ponctuelle sans masquer une incompatibilité persistante.
25. En tant que mainteneur du runtime, je veux un diagnostic structuré après l’échec d’une réparation, afin de comprendre pourquoi l’entretien ne peut pas continuer.
26. En tant que mainteneur du runtime, je veux qu’un seul entretien soit actif par run, afin de conserver le contrat V3 à pause courante unique.
27. En tant que mainteneur du runtime, je veux conserver le parallélisme des agents ordinaires indépendants, afin que cette capacité ne ralentisse pas les DAG sans interaction.
28. En tant que mainteneur, je veux tester la machine à états à travers l’API publique du runtime, afin d’éviter des tests couplés à son implémentation interne.
29. En tant que mainteneur, je veux tester la traduction terminal à travers l’adapter CLI, afin de verrouiller `/done`, les réponses libres et l’approbation.
30. En tant que mainteneur, je veux essayer le pipeline réel avant de migrer Pi et VS Code, afin de valider l’ergonomie et la robustesse du contrat partagé.

## Implementation Decisions

### Capacité V3 explicite

- `interaction` est une propriété optionnelle des nœuds agents ; son absence conserve exactement la sémantique V3 existante.
- La configuration d’interaction sélectionne un protocole enregistré et peut fixer `repairAttempts`.
- `proposed-plan` est le premier protocole disponible.
- Le compilateur refuse les protocoles inconnus, les valeurs de réparation négatives ou non entières et toute propriété d’interaction placée sur un nœud pause.
- Aucun type de nœud supplémentaire et aucun cycle de DAG ne sont introduits.

### Machine à états de l’entretien

- L’exécution initiale d’un nœud d’entretien peut produire `question` ou `ready`.
- `question` persiste l’état de l’entretien et retourne un résultat `paused` de type `question`.
- `answer` clôt la pause courante, ajoute le tour utilisateur, puis exécute le tour suivant.
- `complete-interview` clôt la pause courante et ajoute une instruction de conclusion au contexte du protocole.
- Après `complete-interview`, seule une sortie `ready` est valide. Une nouvelle question est une violation de protocole.
- `ready` produit l’artifact déclaré, marque le nœud terminé et permet au DAG de poursuivre.
- `approve` reste réservé aux pauses V3 d’approbation ; terminer un entretien n’approuve jamais son artifact.
- `reject` sur une question annule le run entier.
- Il n’existe ni état `final-question`, ni limite automatique du nombre de tours.

### Snapshot et identité

- Le snapshot conserve, pour l’entretien actif, le nœud, le protocole, l’état, l’indication de conclusion demandée et une suite structurée de tours agent/utilisateur.
- Les sorties invalides et les consignes internes de réparation ne deviennent pas des tours officiels.
- Chaque question reçoit un identifiant de pause unique dérivé du run, du nœud et du numéro de tour.
- Une pause reprise devient immédiatement obsolète ; une seconde décision portant le même identifiant retourne `invalid_resume`.
- Un run expose au plus un entretien actif et une pause courante.

### Continuité de l’agent

- Le replay de la demande initiale et des tours structurés constitue le comportement de référence.
- Une session ACP active peut être réutilisée comme optimisation ultérieure, jamais comme source de vérité.
- La disparition d’une session ou la reconstruction du runtime ne doit pas perdre l’entretien.
- Le rendu du replay appartient au protocole, afin de préserver les rôles et les instructions de conclusion.

### Registre de protocoles

- Le package pipeline expose un seam de protocole partagé capable d’analyser une sortie agent et de rendre le contexte d’un nouveau tour.
- Le cœur du runtime consomme uniquement les états normalisés `question` et `ready`.
- Le protocole `proposed-plan` exige exactement un bloc `<proposed_plan>` et un `interview_state` valide.
- En état `question`, une question de clarification non vide est requise.
- En état `ready`, le bloc canonique complet devient la valeur de l’artifact du nœud.
- Une sortie invalide déclenche au maximum `repairAttempts` relances correctives ; la valeur par défaut est `1` et `0` désactive la réparation.
- Après épuisement des réparations, le runtime échoue avec `malformed_interview_output` et conserve le dernier historique valide.
- Les réparations de protocole et les retries techniques du nœud ont des compteurs et des diagnostics distincts.

### Ordonnancement

- Si plusieurs nœuds d’entretien sont prêts, le runtime démarre le premier selon l’ordre de déclaration du pipeline et laisse les autres en attente.
- Les nœuds ordinaires indépendants restent éligibles au parallélisme.
- Aucun second entretien ne démarre tant que le premier n’a pas produit son artifact final.

### Adapter CLI

- La CLI affiche le contenu de la pause question puis `Answer [/done to finish]:` à chaque tour.
- Toute saisie non vide différente de `/done` devient une décision `answer` contenant le texte original normalisé uniquement par le trim terminal existant.
- `/done` devient `complete-interview` et n’est jamais transmis comme réponse métier à l’agent.
- Après `ready`, la CLI traite la pause d’approbation déclarée par le pipeline avec `Approve final plan? [y/N]`.
- La CLI affiche sans mode verbose le démarrage de chaque agent suivant une reprise.
- Les détails supplémentaires, événements runtime et données d’erreur restent disponibles avec le mode verbose.
- La CLI ne dépend ni du protocole `proposed-plan`, ni de ses balises.

### Livraison progressive

- La première étape modifie le runtime partagé, le compilateur V3, le protocole `proposed-plan` et l’adapter CLI.
- Le pipeline de démonstration active explicitement l’interaction sur son nœud de planification.
- Pi et VS Code restent inchangés pendant l’essai initial.
- Une seconde évolution pourra projeter le même contrat dans Pi et VS Code après validation du pipeline réel.

## Testing Decisions

- Le seam principal est l’API publique du runtime : les tests conduisent `start`, `resume` et `inspect`, puis vérifient uniquement les résultats discriminés, snapshots, artifacts et diagnostics observables.
- Les tests du runtime couvrent : sortie `ready` immédiate ; une puis plusieurs questions ; réponse obsolète ; `/done` représenté par `complete-interview` ; refus d’une question après conclusion ; rejet et annulation ; reconstruction depuis snapshot ; sélection déterministe entre deux entretiens ; conservation du parallélisme ordinaire.
- Les tests du compilateur couvrent : interaction absente ; protocole valide ; protocole inconnu ; `repairAttempts` à `0`, `1`, négatif ou non entier ; interaction interdite sur un nœud pause.
- Les tests du protocole couvrent ses sorties externes : bloc unique, états `question` et `ready`, question manquante, état inconnu, blocs multiples et rendu d’un replay avec historique.
- Les tests de réparation vérifient une correction réussie, une seconde sortie invalide et l’indépendance entre `repairAttempts` et `retry.maxAttempts`.
- Le seam CLI utilise `runPipelineInteractive` avec un host et un terminal simulés. Il vérifie le texte d’aide répété, la conservation d’une réponse libre, la traduction exacte de `/done`, l’approbation seulement après `ready`, le rejet et les erreurs terminales.
- Le smoke test du binaire construit vérifie le wiring, stdout, stderr et les codes de sortie sans reproduire tous les cas unitaires.
- Les tests existants des pauses V3, de compilation, de reprise persistée et du host CLI servent de prior art et doivent continuer à passer sans modification de comportement pour les nœuds non interactifs.
- Le parcours d’acceptation automatisé principal est : `question → answer → question → /done → ready → approval y → démarrage du nœud suivant`.
- Le parcours court est : `question → /done → ready → approval y → démarrage du nœud suivant`.
- L’essai manuel final exécute le pipeline réel depuis la CLI et confirme que la saisie reste compréhensible, que `y` n’apparaît qu’après `ready` et qu’un log rend visible le lancement de l’étape suivante.

## Out of Scope

- Modification des adapters Pi ou VS Code pendant la première livraison.
- Boucles ou cycles génériques entre nœuds du DAG V3.
- Plusieurs entretiens actifs simultanément dans un même run.
- Plusieurs pauses courantes ou réponses groupées.
- État `final-question` ou droit de poser une question après `/done`.
- Limite automatique du nombre de questions.
- Retour à une question précédente, modification d’une ancienne réponse ou saut implicite d’une question.
- Persistance obligatoire d’une session ACP native.
- Optimisation de réutilisation d’une session ACP pendant la première implémentation.
- Nouveaux protocoles d’entretien autres que `proposed-plan`.
- Inférence implicite de l’interaction depuis le type d’artifact ou le contenu XML.

## Further Notes

- Cette spécification applique ADR-0020, ADR-0022, ADR-0025 et ADR-0026.
- Le terme canonique est « entretien agent ». « Boucle CLI », « cycle de pipeline » et « pause d’approbation interactive » ne désignent pas cette capacité.
- La commande `/done` est une affordance CLI ; seule la décision `complete-interview` appartient au contrat partagé.
- La migration différée de Pi et VS Code est volontaire. Elle ne permet pas d’ajouter de logique spécifique à la CLI : toute transition métier reste dans le runtime partagé dès la première étape.
