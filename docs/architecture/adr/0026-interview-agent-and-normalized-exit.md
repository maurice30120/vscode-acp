# ADR-0026 — Entretien agent V3 et sortie normalisée

**Statut** : Accepté
**Date** : 2026-07-20

## Contexte

Un agent de planification peut avoir besoin de poser plusieurs questions avant de produire un plan prêt à être approuvé. Le runtime V3 exécute actuellement chaque nœud agent une seule fois et les surfaces hôtes ne doivent ni interpréter un protocole métier comme `<interview_state>`, ni reconstruire localement une boucle de questions-réponses. Une telle logique dans la CLI, Pi ou VS Code romprait la parité hôte définie par l’ADR-0025.

## Décision

V3 introduit l’**entretien agent** comme capacité explicite d’un nœud agent, par exemple :

```yaml
- id: plan
  type: agent
  interaction:
    protocol: proposed-plan
```

La répétition de l’entretien appartient au runtime partagé. Elle ne constitue pas un cycle entre les nœuds du DAG : le nœud reste en cours tant que son protocole signale une question. Chaque question produit un résultat stable `paused(question)` ; une reprise `answer` transmet la réponse au même entretien avec son historique. Lorsque le protocole signale `ready`, le nœud produit son artifact final et le DAG peut atteindre une pause `approval` distincte.

La sortie volontaire d’un entretien est une intention normalisée du runtime :

```ts
type PipelineResumeDecision =
  | { kind: 'answer'; value: string }
  | { kind: 'complete-interview' }
  | { kind: 'approve'; value?: unknown }
  | { kind: 'reject' };
```

Les surfaces traduisent leurs interactions propres vers cette même décision. Par exemple, la CLI peut exposer `/done`, Pi `/pipeline done` et VS Code un bouton « Terminer l’entretien ». Ces libellés ne font pas partie du contrat V3.

`complete-interview` n’est pas une approbation. Il demande la production de l’artifact final ; une éventuelle approbation reste une pause V3 ultérieure et explicite. Ainsi, `y/N` n’est présenté qu’une fois l’entretien terminé.

Après `complete-interview`, l’agent doit produire immédiatement son artifact final avec l’état `ready`. Il ne peut poser aucune nouvelle question. Une sortie `question` après cette décision est refusée comme une violation du protocole.

L’historique canonique de l’entretien est conservé sous forme de tours structurés dans le snapshot V3 :

```ts
interface PipelineInterviewSnapshot {
  nodeId: string;
  protocol: string;
  state: 'question';
  completionRequested: boolean;
  turns: Array<
    | { role: 'agent'; content: string }
    | { role: 'user'; content: string }
  >;
}
```

Une chaîne de prompt concaténée n’est pas une représentation persistée valide. Le runtime peut rendre les tours dans un prompt pour un transport donné, mais les rôles et les frontières entre tours restent présents dans le snapshot afin de permettre inspection, test et reprise.

Le replay de cet historique est le comportement de référence : un entretien doit pouvoir continuer en lançant un nouvel agent auquel le runtime fournit la demande initiale et les tours enregistrés. Un adapter peut conserver et réutiliser une session ACP active pour éviter ce replay, mais cette session est seulement un cache jetable. Si elle disparaît, le runtime reprend automatiquement par replay sans perdre l’entretien ni modifier son contrat observable.

Le runtime sélectionne le protocole déclaré par `interaction.protocol` dans un registre partagé du package pipeline. Un protocole traduit la sortie propre à l’agent vers les états normalisés du runtime et sait rendre un replay :

```ts
interface PipelineInterviewProtocol {
  id: string;
  parseAgentOutput(text: string):
    | { state: 'question'; question: string }
    | { state: 'ready'; artifact: unknown };
  renderReplay(context: {
    originalPrompt: string;
    turns: PipelineInterviewTurn[];
    completionRequested: boolean;
  }): string;
}
```

`proposed-plan` est la première implémentation. Elle seule connaît les balises `<proposed_plan>` et `<interview_state>`. Le cœur du runtime, la CLI, Pi et VS Code ne connaissent que `question` et `ready`. Un protocole inconnu ou une sortie non conforme produit une erreur V3 explicite.

Une sortie d’entretien non conforme bénéficie d’une politique de réparation distincte des retries techniques du nœud :

```yaml
interaction:
  protocol: proposed-plan
  repairAttempts: 1
```

`repairAttempts` vaut `1` par défaut et peut être fixé à `0`. Le runtime transmet une erreur de protocole précise à l’agent sans ajouter la sortie invalide à l’historique officiel. Si la sortie corrigée reste invalide, le run échoue avec le diagnostic `malformed_interview_output`. `retry.maxAttempts` reste réservé aux échecs d’exécution tels qu’un timeout ou l’arrêt d’un processus.

Chaque question d’un entretien devient une pause V3 persistée avec un identifiant unique composé de l’identité du run, du nœud et du numéro de tour. Une décision `answer` ou `complete-interview` doit cibler cet identifiant exact. Dès la reprise, la pause devient obsolète ; toute répétition ou réponse tardive échoue avec `invalid_resume`, comme pour les autres pauses V3.

Un run ne peut avoir qu’un seul entretien agent actif à la fois. Lorsque plusieurs nœuds d’entretien deviennent prêts, le runtime choisit le premier selon leur ordre de déclaration et laisse les autres `pending`. Les nœuds agents ordinaires indépendants peuvent conserver leur parallélisme. Le runtime ne démarre l’entretien suivant qu’après la production de l’artifact final du précédent.

Sur une question d’entretien, `reject` conserve la sémantique V3 existante : il annule le run entier. Il ne signifie ni « ignorer cette question » ni « terminer l’entretien ». Une sortie volontaire utilise exclusivement `complete-interview`; une absence de préférence reste une réponse utilisateur explicite. Une annulation de l’interface, notamment `Ctrl+C`, appelle `cancel`.

La CLI traduit ces intentions avec le prompt `Answer [/done to finish]:`, affiché à chaque question afin que la sortie reste découvrable pendant tout l’entretien. Une saisie ordinaire devient `answer`, `/done` devient `complete-interview`, une saisie vide redemande une valeur et `Ctrl+C` annule le run. Après `/done` et la production immédiate de l’artifact `ready`, la pause d’approbation affiche `Approve final plan? [y/N]`.

Lorsque le protocole atteint `ready`, sa sortie canonique complète devient la valeur de l’artifact déclaré par le nœud. Pour `proposed-plan`, cette valeur conserve l’unique bloc `<proposed_plan>` avec `<interview_state>ready</interview_state>`. Les sorties intermédiaires `question` restent dans l’historique du snapshot et ne deviennent jamais des artifacts du DAG.

Aucune limite automatique de nombre de questions n’est imposée. L’utilisateur garde la maîtrise de la durée de l’entretien grâce à `complete-interview`, exposé par `/done` dans la CLI. Les timeouts d’un appel agent restent applicables, mais ils ne limitent pas le nombre de tours valides.

La livraison commence exclusivement par le runtime partagé et son adapter CLI afin de corriger et essayer le cas terminal. Les contrats restent communs dès cette première livraison, mais Pi et VS Code ne sont pas modifiés à cette étape. Leur migration constitue une seconde étape conditionnée par la validation du comportement réel de la CLI ; elle réutilisera alors la même capacité sans réimplémenter la machine à états.

## Invariants

1. La CLI, Pi et VS Code ne parsèrent pas le contenu d’un artifact pour inventer une transition de contrôle.
2. L’historique de l’entretien appartient au run et doit être inspectable et restaurable avec lui.
3. `answer`, `complete-interview` et `approve` sont trois intentions distinctes.
4. Un nœud agent en entretien ne produit son artifact de sortie qu’à la fin de l’entretien.
5. La sortie de l’entretien ne contourne jamais une pause d’approbation déclarée dans le pipeline.
6. Une demande `complete-interview` impose immédiatement la production du résultat final `ready`.
7. L’historique persisté conserve une suite structurée de tours agent et utilisateur.
8. La perte d’une session ACP active ne peut ni perdre ni terminer l’entretien.
9. Le replay depuis le snapshot reste possible quel que soit le transport de l’agent.
10. Toute syntaxe propre à un protocole est confinée à son implémentation enregistrée.
11. Une réparation de protocole ne compte ni comme un tour utilisateur ni comme un retry technique.
12. Une question d’entretien utilise le même contrat d’identité et d’obsolescence que toute pause V3.
13. Un run expose au plus un entretien actif et une pause courante.
14. `reject` et `cancel` ne sont jamais des synonymes de `complete-interview`.
15. Les commandes textuelles propres à un hôte ne font pas partie du contrat V3.
16. Seule une sortie `ready` peut satisfaire l’output déclaré par un nœud d’entretien.

## Alternatives rejetées

- **Boucle dans chaque surface hôte** : elle duplique la machine à états et rompt la parité hôte.
- **Cycle entre nœuds YAML** : il remplace le DAG V3 par un modèle de graphe cyclique beaucoup plus difficile à compiler, persister et reprendre.
- **Détection implicite par type d’artifact** : elle couple silencieusement un contrat de données au contrôle d’exécution.
- **Texte magique comme « c’est fini »** : il rend une réponse utilisateur ambiguë et dépendante de la langue.
- **Nombre maximal de tours** : il peut interrompre un entretien encore utile ; la sortie explicite normalisée donne déjà le contrôle à l’utilisateur.

## Documents liés

- ADR-0020 — Résultats typés et pauses génériques du runtime pipeline
- ADR-0022 — Runtime pipeline v3 unique et suppression du moteur v2
- ADR-0025 — Parité des surfaces hôtes et packages partagés
