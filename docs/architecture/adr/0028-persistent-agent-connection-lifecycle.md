# ADR-0028 — Cycle de vie de la connexion agent persistante

**Statut** : Accepté
**Date** : 2026-07-21

## Contexte

Le runtime Pipeline V3 utilisait encore des relances éphémères pour appeler les agents internes. Ce modèle fonctionne pour une requête courte, mais il devient fragile pour un entretien agent : chaque réponse utilisateur force une nouvelle connexion ACP et oblige le runtime à reconstruire artificiellement la continuité de la tâche.

ADR-0026 a déjà défini l’entretien agent, sa sortie normalisée et son snapshot structuré. La migration vers une connexion agent persistante précise maintenant le cycle de vie transport sans déplacer la source de vérité hors du runtime partagé.

## Décision

Le contrat runtime partagé qui remplace `EphemeralRun` côté pipeline est nommé `AgentNodeSession`. Une `AgentNodeSession` ouvre une connexion agent persistante pour un nœud agent Pipeline V3 et reste strictement bornée à ce nœud. Elle n’est jamais globale au run pipeline et n’est jamais partagée entre plusieurs nœuds, même lorsqu’ils ciblent le même agent.

Pour un entretien agent, la connexion reste ouverte pendant les pauses de question utilisateur. L’attente utilisateur ne consomme pas de timeout d’appel agent ; les timeouts agent ne couvrent que les périodes où le runtime attend effectivement une réponse de l’agent.

Le texte progressif produit par l’agent connecté est une activité agent temporaire. Les surfaces hôtes peuvent l’afficher, mais il ne devient pas une sortie observable du nœud et ne peut pas être consommé par les dépendances du pipeline. Seuls les artifacts structurés et l’état final normalisé constituent le résultat contractuel du nœud.

La connexion ACP vivante est une optimisation de transport. La source de vérité de reprise reste le snapshot structuré de l’entretien : prompt d’origine, protocole déclaré, tours agent/utilisateur et intention éventuelle `complete-interview`. Cet historique structuré est enregistré comme artifact du nœud à chaque échange ACP significatif afin de rendre le replay inspectable et durable. Si la connexion tombe pendant un entretien, le runtime tente de recréer une connexion dans le même run et le même nœud, puis effectue un replay d’entretien. Les logs agents, stderr, chunks visibles et artifacts de diagnostic `.acp/logs/` ne font pas partie de ce replay.

Cette reprise technique ne réémet pas un démarrage logique de nœud. Le nœud reste le même dans la timeline du DAG ; le runtime peut toutefois publier un événement de diagnostic dédié tel que `agent_replayed` ou `agent_reconnected`.

La reprise par replay automatique est réservée aux entretiens agent. Pour un nœud agent non-interactif, une perte de connexion est un échec technique couvert par `retry.maxAttempts`, afin d’éviter de rejouer implicitement des actions ou de produire un artifact divergent.

`complete-interview` garde la connexion ouverte pour demander immédiatement l’artifact final `ready` au même agent. La connexion est fermée après production de l’artifact final ou erreur. `cancel` et `reject` ferment la connexion active sans demander d’artifact final ; `reject` sur une question d’entretien annule le run entier et ne signifie jamais “ignorer cette question” ou “terminer l’entretien”.

Quand un nœud agent persistant se termine sans produire l’artifact structuré attendu, le runtime tente une seule demande explicite de sortie finale normalisée sur la même connexion. Le nœud échoue si l’artifact reste absent ou invalide après cette demande.

Sandcastle suit la même borne : la connexion agent couvre l’appel agent jusqu’à production du diff ou de l’artifact agent, puis la promotion Apply/Reject s’exécute hors connexion agent.

La migration concerne les exécutions Pipeline V3 sur toutes les surfaces hôtes concernées via le runtime partagé. Les requêtes inline VS Code conservent leur requête inline éphémère, car elles sont courtes, isolées et ne participent pas à l’entretien agent pipeline.

## Invariants

1. Une connexion agent persistante appartient à un seul nœud agent Pipeline V3.
2. Le contrat runtime partagé de cette connexion est nommé `AgentNodeSession`.
3. Une connexion agent persistante n’est pas partagée entre nœuds.
4. Un run expose au plus un entretien agent actif à la fois.
5. La connexion ACP vivante est jetable ; le snapshot structuré reste la vérité de reprise.
6. L’historique structuré destiné au replay est enregistré à chaque échange ACP significatif.
7. L’activité agent temporaire n’est pas une sortie observable du nœud.
8. Le replay d’entretien n’utilise ni logs de diagnostic, ni stderr, ni chunks streamés comme entrée canonique.
9. Une reconnexion technique ne redémarre pas logiquement le nœud dans le DAG.
10. La reprise automatique par replay ne s’applique pas aux nœuds agents non-interactifs.
11. L’attente utilisateur ne consomme pas de timeout d’appel agent.
12. `complete-interview`, `cancel` et `reject` restent trois intentions distinctes.
13. Un artifact final manquant déclenche au plus une demande explicite de sortie normalisée.
14. La promotion Sandcastle se fait après fermeture de la connexion agent.
15. InlineEdit conserve une requête inline éphémère hors migration pipeline.
16. Le runtime partagé porte la sémantique ; les surfaces hôtes restent des adapters.

## Alternatives rejetées

- **Connexion globale au run pipeline** : elle introduit de l’état caché entre nœuds et contredit la borne nœud du Pipeline V3.
- **Nommer le contrat `PersistentAgentNodeRun`** : ce nom décrit la migration depuis `EphemeralRun` plutôt que le concept cible, et suggère à tort que la persistance de transport est la vérité métier.
- **Session ACP vivante comme source de vérité** : elle rend la reprise dépendante du transport et casse l’inspectabilité du snapshot.
- **Replay depuis les logs agents** : les logs sont diagnostiques, non canoniques, et peuvent contenir du bruit technique.
- **Replay automatique des nœuds non-interactifs** : il peut répéter des effets de bord ou produire un artifact différent.
- **Streaming comme sortie de nœud** : il rendrait observable une donnée partielle et instable, alors que les dépendances du pipeline doivent consommer des artifacts structurés.
- **Échec immédiat quand l’artifact final manque** : une demande explicite de sortie normalisée permet de réparer un oubli de format sans relancer tout le nœud.
- **Timeout incluant l’attente utilisateur** : il ferait échouer un entretien alors que l’agent n’est pas en train de travailler.
- **Promotion Sandcastle sous connexion agent** : elle mélange la phase de production agent avec la décision de promotion du worktree.
- **Migration InlineEdit vers connexion persistante** : l’InlineEdit reste une requête courte et isolée, sans entretien agent pipeline.

## Documents liés

- ADR-0025 — Parité des surfaces hôtes et packages partagés
- ADR-0026 — Entretien agent V3 et sortie normalisée
- ADR-0027 — Logs agents de pipeline et workspace Sandcastle promouvable
