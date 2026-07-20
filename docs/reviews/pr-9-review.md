# Review de la PR #9 — Grill → Spec → Tickets → Implement → Review

PR concernée : [#9 — feat: add grill spec tickets implement review pipeline](https://github.com/maurice30120/vscode-acp/pull/9)

## État GitHub actuel

La PR #9 est désormais **fusionnée et fermée**. Sa branche tête `agent/matt-skills-spec-tickets-review` a été supprimée après fusion.

Le commit de merge de la PR #9 est présent dans `agent/interactive-grill-skeleton-tdd`, branche tête de la [PR #8](https://github.com/maurice30120/vscode-acp/pull/8), qui reste ouverte. La vérification et les compléments d’architecture ont donc été ajoutés à cette branche.

Documents complémentaires :

- [Étude de l’architecture existante](../architecture/pipeline-architecture-study.md)
- [Architecture cible](../architecture/pipeline-target-architecture.md)
- [Plan de migration](../architecture/pipeline-migration-plan.md)
- [ADR-0020 — résultats typés et pauses génériques](../architecture/adr/0020-pipeline-runtime-results-and-generic-pauses.md)
- [ADR-0021 — politiques exécutoires et résolution explicite des skills](../architecture/adr/0021-executable-policies-and-explicit-skill-resolution.md)

## Verdict historique et conclusion actuelle

Le verdict initial était : **changes requested — ne pas merger la PR en l’état**.

La PR ayant déjà été fusionnée, ce verdict ne peut plus agir comme gate. Les constats ont été revérifiés sur la branche qui contient le merge et restent valides au moment de l’étude :

1. la seconde approval est mal gérée par le contrôleur Pi ;
2. `sideEffects: none` n’est pas exécutoire pour un agent ACP natif ;
3. plusieurs skills explicitement demandés sont filtrés ;
4. le wrapper `<proposed_plan>` est utilisé comme protocole universel de pause ;
5. les tests ne couvrent pas le cycle de vie complet.

La recommandation n’est plus de bloquer une fusion passée, mais de traiter ces points comme dette d’architecture prioritaire avant de généraliser les workflows à plusieurs approvals.

## 1. Bloquant — la seconde approval est traitée comme une fin de pipeline

Le pipeline contient deux étapes d’approbation :

1. `plan_approval` après l’entretien interactif ;
2. `delivery_approval` après la génération de la spécification et des tâches.

`PipelineController.approve()` suppose toutefois qu’une approval mène toujours à la fin. Après `service.approvePlan()`, il :

- affiche systématiquement `ACP Pipeline Completed` ;
- efface `activeSessionId` ;
- arrête le heartbeat ;
- nettoie les buffers d’activité.

Lorsque la première approval reprend le graphe, celui-ci génère la spec et les tâches puis atteint la seconde pause. Le moteur émet un nouvel événement `plan-ready`, mais le contrôleur annonce quand même la fin et supprime son état actif dans le `finally`.

### Impact

Après la première validation :

- la seconde demande d’approbation apparaît ;
- une fausse notification `Pipeline Completed` est aussi affichée ;
- `/pipeline status` considère qu’aucun pipeline n’est actif ;
- `/pipeline cancel` ne peut plus annuler correctement le run ;
- le heartbeat et le suivi d’activité sont arrêtés ;
- l’Interface ne distingue pas une pause intermédiaire d’une fin réelle.

### Cause d’architecture

`PipelineService.createPlan()` et `PipelineService.approvePlan()` retournent uniquement une chaîne. La vérité du cycle de vie est divisée entre :

- la valeur retournée ;
- l’événement `plan-ready` ;
- l’état mutable `pendingPlan` dans l’Adapter hôte.

L’Interface du Module moteur est trop peu profonde : chaque hôte doit reconstruire sa propre machine à états.

### Correction recommandée

Faire retourner au moteur un résultat discriminé :

```ts
type PipelineRunResult =
  | { kind: 'paused'; sessionId: string; pause: PipelinePause }
  | { kind: 'completed'; sessionId: string; output: string }
  | { kind: 'rejected'; sessionId: string; reason?: string }
  | { kind: 'cancelled'; sessionId: string }
  | { kind: 'failed'; sessionId: string; error: PipelineRunError };
```

Le contrôleur Pi doit projeter ce résultat vers l’UI, et non déduire l’état terminal depuis un événement.

Ajouter un test d’exécution complet :

```text
run
→ entretien terminé
→ première approval
→ spec + tâches
→ seconde approval détectée
→ pipeline toujours actif
→ deuxième approval
→ implémentation
→ review
→ completed
```

## 2. Important — les étapes annoncées read-only peuvent modifier le workspace

Le planner, le spec writer, le task planner et le reviewer déclarent :

```yaml
sideEffects: none
permissions: allowAll
```

`permissions: allowAll` active l’approbation automatique des demandes ACP. Le client natif expose notamment :

- `writeTextFile` ;
- la création de terminaux ;
- l’exécution de commandes.

`sideEffects: none` est réellement garanti pour Sandcastle parce que le worktree est rejeté. Pour un agent ACP natif, cette valeur ne bloque ni les écritures ni les commandes mutantes.

### Impact

La garantie « read-only » repose uniquement sur le prompt. Un agent natif peut malgré tout :

- écrire ou supprimer un fichier ;
- lancer un formatter qui modifie le workspace ;
- mettre à jour des snapshots ;
- générer des caches ;
- exécuter une commande destructive.

### Correction recommandée

À court terme :

```yaml
permissions: ask
```

pour toutes les primitives non implémenteur.

À moyen terme, résoudre une politique d’exécution commune et la faire appliquer par chaque Adapter :

```ts
interface ExecutionPolicy {
  filesystem: 'read-only' | 'workspace-write';
  terminal: 'deny' | 'ask' | 'allow';
  network: 'deny' | 'ask' | 'allow';
  promotion: 'discard' | 'ask' | 'auto-apply' | 'auto-reject';
}
```

L’Adapter ACP natif doit refuser les écritures en read-only. L’Adapter Sandcastle peut écrire dans son worktree, puis rejeter toute modification pour la même politique.

## 3. Important — les skills user-invoked ne sont pas réellement injectés

Le YAML déclare :

```yaml
skills:
  - to-spec
```

et :

```yaml
skills:
  - implement
  - tdd
```

`renderSkillsCatalog()` exclut pourtant les skills portant :

```yaml
disable-model-invocation: true
```

même lorsque leur nom vient de l’allow-list explicite de la primitive.

`to-spec`, `to-tickets` et `implement` sont précisément marqués ainsi. Les adapters `.acp/agents/matt-*.md` recopient suffisamment de règles pour que le workflow puisse partiellement fonctionner, mais les primitives n’utilisent pas réellement ces skills via le mécanisme déclaré.

### Cause d’architecture

Deux intentions sont confondues :

1. invocation automatique proposée au modèle ;
2. invocation explicite demandée par l’orchestrateur.

### Correction recommandée

Introduire une Interface distincte :

```ts
interface SkillResolver {
  resolveExplicit(input: { workspaceCwd: string; names: string[] }): ResolvedSkillSet;
  discoverModelInvocable(input: { workspaceCwd: string }): ResolvedSkillSet;
}
```

`disable-model-invocation` doit empêcher uniquement le second cas.

Ajouter un test qui inspecte le prompt final et vérifie que `to-spec`, `to-tickets`, `implement` et `code-review` sont effectivement injectés lorsqu’ils sont explicitement sélectionnés.

## 4. Important — du contenu arbitraire est placé dans une balise structurelle

La seconde validation encapsule la spec et les tâches dans :

```xml
<proposed_plan>
  <interview_state>ready</interview_state>

  {{steps.spec.output}}
  {{steps.tasks.output}}
</proposed_plan>
```

Le parseur exige exactement un bloc `<proposed_plan>...</proposed_plan>`. Si la spec ou les tâches contiennent accidentellement une balise identique, la validation peut être tronquée ou rejetée.

### Cause d’architecture

Le modèle de pause est spécialisé autour du premier plan interactif :

- `PipelinePlanReadyEvent` ;
- `approvePlan()` ;
- `PendingApprovalState.plan` ;
- `assertSingleProposedPlan()`.

Une spécification, une liste de tâches ou une future décision de promotion ne sont pourtant pas nécessairement des plans.

### Correction recommandée

Introduire une pause générique :

```ts
interface PipelinePause {
  id: string;
  kind: 'approval' | 'question' | 'promotion';
  content: string;
  contentType: 'markdown' | 'proposed_plan' | 'text';
}
```

Le contrat `<proposed_plan>` ne doit être validé que pour `contentType: proposed_plan`.

## 5. Important — la sémantique des rôles dépend des noms

`PipelineRoleLabels` déduit les rôles depuis des IDs tels que `plan`, `implementer`, `review` ou `verify`. `implementerUsesSandcastle()` cherche directement une primitive nommée `implementer`.

Un pipeline valide peut utiliser d’autres noms, mais l’UI, les phases et la détection Sandcastle deviennent alors heuristiques.

### Correction recommandée

Ajouter des métadonnées optionnelles explicites :

```yaml
primitives:
  delivery:
    role: implementer
    phase: implementing
```

Conserver temporairement les heuristiques comme fallback avec warning de compatibilité.

## 6. Tests manquants

Le test ajouté couvre correctement :

- la découverte du pipeline ;
- l’ordre des steps ;
- les skills déclarés ;
- les side effects déclarés ;
- la résolution des prompt files ;
- la présence du wrapper XML ;
- la présence des fichiers de skills vendus.

Il manque les tests les plus importants à l’Interface du Module :

1. exécution réelle avec deux approvals ;
2. conservation du run entre les pauses ;
3. absence de notification terminale après la première approval ;
4. annulation pendant la seconde pause ;
5. reprise correcte après la seconde approval ;
6. injection effective des skills user-invoked ;
7. enforcement de `sideEffects: none` pour ACP natif ;
8. parité des résultats Pi et VS Code ;
9. contenu Markdown arbitraire dans une approval ;
10. refus d’une reprise ciblant une pause obsolète.

## 7. Points positifs conservés

Le découpage fonctionnel de la PR reste cohérent :

- `grill-me` conserve l’interaction question par question ;
- `to-spec` et `to-tickets` sont séparés ;
- une validation humaine existe avant l’implémentation ;
- l’implémentation est isolée dans Vibe Sandcastle ;
- la review distingue Standards et Spec ;
- les prompt adapters retirent les commandes slash, commits et publication d’issues incompatibles avec le transport ACP ;
- les modifications Sandcastle appliquées au host restent visibles au reviewer via le diff du working tree.

Le Seam `PipelineAgentRunner` est également bien justifié : deux Adapters concrets existent, ACP natif et Sandcastle.

## 8. Ordre de correction recommandé

1. Ajouter les tests de caractérisation multi-approval.
2. Passer immédiatement les primitives read-only à `permissions: ask`.
3. Introduire `PipelineRunResult` et migrer le contrôleur Pi.
4. Introduire `PipelinePause` et retirer le wrapper XML de `delivery_approval`.
5. Migrer le runtime VS Code vers les mêmes résultats.
6. Rendre la politique d’exécution exécutoire sur ACP natif et Sandcastle.
7. Introduire `SkillResolver` et corriger l’injection explicite.
8. Remplacer les heuristiques de rôle par des métadonnées explicites.
9. Supprimer l’ancienne Interface orientée plan après migration des deux hôtes.

## Conclusion

La PR #9 apporte un workflow utile, mais révèle que le runtime a été conçu autour d’une seule pause humaine et d’un seul type de contenu.

La correction durable ne consiste pas à empiler des conditions dans le contrôleur. Elle consiste à approfondir le Module pipeline afin qu’il possède :

- le cycle de vie complet ;
- les résultats et pauses typés ;
- les garanties d’effets de bord ;
- la résolution explicite des skills.

Le plan de migration associé permet d’effectuer cette évolution par étapes compatibles et testables.