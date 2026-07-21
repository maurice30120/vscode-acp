# Spécification — AgentNodeSession pour les nœuds agent Pipeline V3

**Statut :** ready-for-agent
**Source :** entretien `grill-with-docs`, synthèse `to-spec` et ADR-0028
**Portée :** runtime partagé Pipeline V3 et adapters hôtes CLI, Pi et VS Code

## Problem Statement

Un nœud agent Pipeline V3 est actuellement exécuté comme une succession de relances éphémères. Ce modèle ferme la connexion ACP après chaque réponse de l’agent. Pendant un Entretien agent, chaque réponse utilisateur force donc une nouvelle connexion et une reconstruction du contexte, alors que l’utilisateur considère toujours être dans la même tâche et avec le même agent.

Cette discontinuité augmente le coût et la fragilité des entretiens, rend le cycle de vie difficile à observer et pousse les surfaces hôtes à porter des détails de reprise. Elle mélange également deux besoins différents : la continuité normale d’un nœud en cours et la reprise exceptionnelle après une perte de transport.

L’utilisateur veut qu’un agent reste connecté pendant toute l’exécution de son nœud Pipeline V3, y compris pendant l’attente d’une réponse humaine, puis que la connexion soit fermée dès que le nœud produit son artifact final, échoue ou est annulé. Cette continuité doit être identique sur les trois Surfaces hôtes et ne doit pas transformer la connexion vivante en source de vérité durable.

## Solution

Introduire `AgentNodeSession` comme contrat du Runtime partagé pour le cycle de vie ACP d’un seul nœud agent Pipeline V3. Le runtime ouvre la session lorsque le nœud démarre, l’utilise pour tous les échanges de ce nœud, la conserve pendant les pauses d’un Entretien agent et la ferme lorsque le nœud atteint un état terminal.

Le Runtime partagé reste propriétaire de la machine à états, du snapshot et des artifacts. Une `AgentNodeSession` est un transport jetable : si elle disparaît pendant un Entretien agent, le runtime ouvre une nouvelle session pour le même nœud et rejoue uniquement le prompt d’origine et l’Historique ACP de nœud structuré. Pour un nœud non interactif, une perte de connexion reste un échec technique soumis à `retry.maxAttempts` sans replay implicite.

CLI, Pi et VS Code fournissent chacun un Adapter hôte capable d’ouvrir une `AgentNodeSession`, mais ne redéfinissent ni sa durée de vie, ni le replay, ni les transitions d’entretien. La migration remplace le chemin éphémère pour tous les nœuds Pipeline V3 en une seule évolution. La Requête inline éphémère de VS Code reste inchangée.

## User Stories

1. En tant qu’utilisateur d’un Pipeline V3, je veux que l’agent reste connecté pendant toute sa tâche, afin de conserver une interaction continue.
2. En tant qu’utilisateur d’un Entretien agent, je veux répondre à plusieurs questions dans la même connexion, afin que chaque tour ne redémarre pas artificiellement l’agent.
3. En tant qu’utilisateur d’un Entretien agent, je veux que la connexion reste ouverte pendant que je réfléchis à ma réponse, afin que la continuité ne dépende pas de ma vitesse de saisie.
4. En tant qu’utilisateur d’un Entretien agent, je veux que mon temps de réflexion soit exclu du timeout agent, afin qu’une pause humaine ne soit pas traitée comme un agent bloqué.
5. En tant qu’utilisateur, je veux obtenir le même comportement depuis la CLI, Pi et VS Code, afin que la Surface hôte ne change pas la sémantique du pipeline.
6. En tant qu’utilisateur, je veux que `complete-interview` demande immédiatement l’artifact final au même agent connecté, afin de conclure l’entretien sans reconnexion normale.
7. En tant qu’utilisateur, je veux examiner et approuver l’artifact final séparément de la sortie d’entretien, afin que terminer les questions ne signifie pas approuver le résultat.
8. En tant qu’utilisateur, je veux qu’un rejet pendant une question annule le run entier, afin que le rejet conserve une sémantique non ambiguë.
9. En tant qu’utilisateur, je veux qu’une annulation ferme immédiatement la connexion agent, afin de ne laisser aucun travail actif en arrière-plan.
10. En tant qu’utilisateur, je veux qu’une annulation n’entraîne aucune demande d’artifact final, afin que l’agent ne poursuive pas une tâche abandonnée.
11. En tant qu’utilisateur, je veux qu’une perte de connexion pendant un entretien soit récupérée automatiquement lorsque possible, afin de ne pas perdre mes réponses.
12. En tant qu’utilisateur, je veux qu’une reconnexion technique conserve le même run et le même nœud, afin que la timeline ne présente pas un faux redémarrage métier.
13. En tant qu’utilisateur, je veux pouvoir distinguer une reconnexion d’un nouveau démarrage de nœud, afin de comprendre les incidents de transport.
14. En tant qu’utilisateur, je veux que le texte progressif de l’agent reste une activité temporaire, afin que les nœuds dépendants ne consomment jamais une réponse incomplète.
15. En tant qu’utilisateur, je veux que seul l’artifact structuré final soit exposé comme résultat du nœud, afin que le pipeline reste déterministe.
16. En tant qu’auteur de pipeline, je veux que chaque nœud possède sa propre `AgentNodeSession`, afin d’éviter tout état caché entre nœuds.
17. En tant qu’auteur de pipeline, je veux que deux nœuds ciblant le même agent utilisent des sessions distinctes, afin que leurs contextes ne se contaminent pas.
18. En tant qu’auteur de pipeline, je veux conserver le parallélisme des nœuds ordinaires indépendants, afin que la persistance d’une session n’impose pas une sérialisation globale.
19. En tant qu’auteur de pipeline, je veux qu’un seul Entretien agent soit actif par run, afin de conserver une seule interaction humaine courante.
20. En tant qu’auteur de pipeline, je veux que les autres nœuds ordinaires éligibles continuent pendant un entretien, afin que l’attente humaine ne bloque pas tout le DAG.
21. En tant qu’auteur de pipeline, je veux que les autres nœuds d’entretien restent en attente, afin de ne pas présenter plusieurs questions concurrentes.
22. En tant qu’auteur de pipeline, je veux que `retry.maxAttempts` continue de contrôler les échecs techniques des nœuds non interactifs, afin de ne pas rejouer implicitement leurs effets de bord.
23. En tant que mainteneur du Runtime partagé, je veux enregistrer l’Historique ACP de nœud à chaque échange significatif, afin que la reprise soit durable et inspectable.
24. En tant que mainteneur du Runtime partagé, je veux rejouer uniquement le prompt initial, le protocole et les tours structurés, afin que le replay ne dépende pas de données diagnostiques instables.
25. En tant que mainteneur du Runtime partagé, je veux exclure logs, stderr et chunks affichés du contexte canonique, afin d’éviter du bruit et des fuites de transport dans l’état métier.
26. En tant que mainteneur du Runtime partagé, je veux restaurer un entretien après reconstruction du runtime, afin qu’un processus hôte redémarré puisse reprendre depuis le snapshot.
27. En tant que mainteneur du Runtime partagé, je veux émettre un événement technique de reconnexion ou de replay, afin que les Surfaces hôtes puissent diagnostiquer la récupération.
28. En tant que mainteneur du Runtime partagé, je veux éviter un second événement logique `node_started` lors d’un replay, afin de préserver l’identité du nœud.
29. En tant que mainteneur du Runtime partagé, je veux demander une seule fois une sortie finale normalisée lorsqu’elle manque, afin de réparer un oubli de format sans boucle indéfinie.
30. En tant que mainteneur du Runtime partagé, je veux échouer explicitement si cette demande ne produit toujours pas l’artifact requis, afin de ne jamais valider une sortie ambiguë.
31. En tant que mainteneur Sandcastle, je veux garder la connexion ouverte jusqu’à la production du diff ou de l’artifact, afin que l’agent termine sa tâche dans son worktree.
32. En tant que mainteneur Sandcastle, je veux exécuter Apply ou Reject après fermeture de la connexion agent, afin de séparer production et promotion.
33. En tant que mainteneur VS Code, je veux conserver InlineEdit sur une Requête inline éphémère, afin de ne pas étendre ce cycle de vie aux interactions courtes hors pipeline.
34. En tant que mainteneur d’une Surface hôte, je veux seulement fournir les primitives de connexion, échange, annulation et fermeture, afin que la logique métier reste dans le Runtime partagé.
35. En tant que mainteneur, je veux supprimer le chemin Pipeline V3 basé sur les relances éphémères sans feature flag durable, afin de ne pas maintenir deux sémantiques concurrentes.
36. En tant que mainteneur, je veux tester le cycle de vie via l’API publique du Runtime partagé, afin de vérifier des comportements observables plutôt que des détails de transport.
37. En tant que mainteneur, je veux vérifier la parité des trois adapters avec une même suite de contrat, afin d’empêcher un drift entre Surfaces hôtes.

## Implementation Decisions

### Contrat AgentNodeSession

- `AgentNodeSession` est le nom canonique du contrat runtime partagé. `PersistentAgentNodeRun` et `EphemeralRun` ne désignent pas cette responsabilité.
- Une instance appartient à exactement un nœud agent d’un run Pipeline V3 et ne peut être ni réutilisée ni partagée par un autre nœud.
- Le contrat expose les capacités nécessaires pour envoyer un tour à l’agent, recevoir l’activité et le résultat structurés, annuler le travail actif et fermer les ressources.
- L’ouverture d’une session appartient à un seam de fabrique fourni au Runtime partagé par l’Adapter hôte.
- Le Runtime partagé possède les sessions actives et garantit leur fermeture dans tous les chemins terminaux : succès, échec, rejet et annulation.
- Les transitions métier ne dépendent jamais de l’identité native d’une session ACP ni de sa survie dans le processus hôte.

### Cycle de vie du nœud

- Le runtime ouvre une `AgentNodeSession` au démarrage logique d’un nœud agent.
- Tous les tours normaux du nœud, y compris les réparations de protocole et `complete-interview`, utilisent cette même session tant qu’elle est viable.
- Une question met le nœud et le run en pause sans fermer la session.
- L’attente d’une décision utilisateur suspend les gardes de timeout propres à un appel agent ; elle ne suspend pas les mécanismes explicites d’annulation.
- La session est fermée après validation et persistance de l’artifact final, ou immédiatement lors d’un état terminal sans artifact.
- L’Activité agent temporaire peut être projetée par l’Adapter hôte, mais elle ne modifie ni les artifacts, ni les entrées des nœuds dépendants.

### Snapshot et Historique ACP de nœud

- Le snapshot conserve le prompt d’origine, le protocole d’entretien, les tours structurés agent/utilisateur et l’intention éventuelle de sortie d’entretien.
- Cet historique est persisté comme artifact de nœud après chaque question agent, réponse utilisateur, demande de conclusion et sortie structurée significative.
- Les chunks progressifs, logs, stderr, sorties de debug et consignes internes non canoniques ne deviennent jamais des tours de replay.
- La session ACP vivante reste absente du contrat de persistance ; un snapshot doit rester chargeable dans un nouveau processus.

### Reconnexion et replay

- Une perte de connexion pendant un Entretien agent ferme et remplace la session défaillante, sans changer l’identité logique du run ou du nœud.
- La nouvelle session reçoit le prompt d’origine et le replay rendu par le protocole à partir de l’Historique ACP de nœud.
- Le runtime publie un diagnostic et un événement technique dédié de reconnexion ou replay, mais ne réémet pas `node_started`.
- Le replay automatique est réservé aux nœuds avec Entretien agent, car leur historique structuré rend la reprise explicite.
- Une perte de connexion d’un nœud non interactif retourne un échec technique retryable selon la classification de l’Adapter hôte. Chaque retry ouvre une nouvelle `AgentNodeSession` et compte comme une tentative de nœud.
- Les réparations de protocole restent distinctes des retries techniques et utilisent la session courante lorsqu’elle est disponible.

### Artifact final

- Seul un artifact conforme à la déclaration de sortie peut terminer avec succès le nœud.
- Si l’agent termine un tour censé être final sans artifact structuré valide, le runtime envoie exactement une demande explicite de sortie finale normalisée sur la session courante.
- Cette demande unique est indépendante du budget de réparation ordinaire et ne doit pas ouvrir une nouvelle boucle de questions.
- Une seconde absence ou invalidité échoue avec un diagnostic structuré et ferme la session.

### Annulation, rejet et promotion

- L’annulation du run propage le signal à chaque `AgentNodeSession` active, demande l’annulation ACP si possible, puis ferme les ressources sans demander d’artifact.
- `reject` sur une pause d’entretien annule le run entier et suit le même chemin de fermeture.
- `complete-interview` n’est ni une annulation ni une approbation ; il demande la sortie finale sur la session courante.
- Pour Sandcastle, la session couvre la production agent jusqu’au diff ou à l’artifact. La décision et l’exécution de promotion Apply/Reject ont lieu après sa fermeture.

### Migration et Parité hôte

- Le Runtime partagé et son adapter agent remplacent le contrat d’appel unique par la fabrique d’`AgentNodeSession`.
- CLI, Pi et VS Code migrent dans la même évolution et utilisent le même contrat public.
- Les anciens runners éphémères peuvent rester disponibles uniquement pour les usages non pipeline qui en ont encore besoin.
- VS Code InlineEdit continue à utiliser sa Requête inline éphémère et n’acquiert aucune sémantique d’Entretien agent.
- Aucun feature flag durable, fallback silencieux ou double chemin Pipeline V3 n’est ajouté.
- Les Surfaces hôtes peuvent différer dans leur affichage de l’activité et des diagnostics, mais pas dans les transitions, artifacts, retries ou règles de fermeture.

## Testing Decisions

- Le seam principal et unique de comportement est l’API publique du Runtime partagé, alimentée par une fabrique de `AgentNodeSession` contrôlable. Les tests conduisent le runtime par `start`, `resume`, `cancel` et restauration, puis observent résultats, snapshots, artifacts, événements, diagnostics et fermeture des sessions.
- Ce seam couvre : une session unique sur plusieurs tours ; conservation pendant une pause ; exclusion de l’attente utilisateur du timeout ; `complete-interview` sur la même session ; fermeture après succès ; fermeture après échec, rejet ou annulation ; demande finale unique ; absence de sortie observable depuis l’activité temporaire.
- Les scénarios de replay simulent une rupture de transport, vérifient l’ouverture d’une seconde session pour le même nœud, le contenu strict du replay, l’absence d’un second `node_started` et la présence de l’événement technique dédié.
- Les scénarios non interactifs vérifient qu’une rupture n’entraîne aucun replay d’historique, respecte `retry.maxAttempts`, ouvre une session par tentative et ne répète pas une tentative après épuisement du budget.
- Les scénarios d’ordonnancement vérifient qu’un seul Entretien agent est actif, que les entretiens suivants restent pending et que les nœuds ordinaires indépendants continuent.
- Les scénarios de restauration recréent un Runtime partagé depuis un snapshot persisté sans session vivante, puis vérifient le replay et la poursuite du même nœud.
- Une suite de contrat d’Adapter hôte est exécutée contre les implementations CLI, Pi et VS Code. Elle vérifie ouverture, échange multi-tour, activité temporaire, annulation, fermeture, classification d’une rupture et propagation des politiques.
- Les tests Sandcastle vérifient que la production du diff précède la fermeture de session et que la promotion commence seulement après cette fermeture.
- Les tests VS Code InlineEdit existants restent inchangés et prouvent que son exécution demeure éphémère.
- Les tests existants du Runtime partagé pour les entretiens, retries, réparations, snapshots et ordonnancement constituent le prior art. Ils doivent être adaptés au seam `AgentNodeSession` sans affaiblir leurs assertions externes.
- Le parcours d’acceptation principal est : ouverture de session → question → pause avec session ouverte → réponse → question → `complete-interview` → artifact `ready` → fermeture → approbation séparée → nœud suivant.
- Le parcours de récupération est : ouverture de session → question → réponse persistée → rupture → nouvelle session → replay structuré → artifact final → fermeture, avec un seul démarrage logique de nœud.

## Out of Scope

- Session agent globale à un run Pipeline V3.
- Partage d’une session entre plusieurs nœuds, même s’ils ciblent le même agent.
- Plusieurs Entretiens agent actifs simultanément dans un run.
- Persistance ou restauration d’une connexion ACP native vivante.
- Replay depuis les logs, stderr, chunks progressifs ou fichiers de diagnostic.
- Replay automatique des nœuds agents non interactifs.
- Transformation de l’Activité agent temporaire en streaming contractuel de sortie de nœud.
- Migration de VS Code InlineEdit vers `AgentNodeSession`.
- Promotion Sandcastle pendant que la connexion agent est encore ouverte.
- Mode de compatibilité durable conservant les relances éphémères pour Pipeline V3.
- Modification du langage YAML Pipeline V3 pour exposer le choix du cycle de vie.

## Further Notes

- Cette spécification applique ADR-0025, ADR-0026, ADR-0027 et ADR-0028.
- Elle remplace la décision transitoire de la première spec d’Entretien agent qui reportait la session persistante et limitait la livraison initiale à la CLI. L’ADR-0028 rend désormais la Connexion agent persistante obligatoire pour Pipeline V3 sur toutes les Surfaces hôtes.
- Le point le plus risqué est la migration atomique des adapters sans feature flag. La réduction de risque retenue est une suite de contrat commune et le maintien d’un seul seam runtime, pas la conservation de deux chemins de production.
- Le nom `AgentNodeSession` décrit la borne métier stable. La persistance de la connexion est une propriété de son cycle de vie, pas la source de vérité de l’entretien.
