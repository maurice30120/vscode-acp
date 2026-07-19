# Review de la PR #9 — Grill → Spec → Tickets → Implement → Review

PR concernée : [#9 — feat: add grill spec tickets implement review pipeline](https://github.com/maurice30120/vscode-acp/pull/9)

## Verdict

**Changes requested — ne pas merger la PR en l’état.**

La direction fonctionnelle est bonne, mais l’ajout d’une seconde validation humaine révèle un problème bloquant dans le cycle de vie du contrôleur. Il reste également un écart entre plusieurs garanties annoncées dans le pipeline et ce que le runtime impose réellement.

## 1. Bloquant — la seconde approbation est traitée comme une fin de pipeline

Le pipeline contient deux étapes d’approbation :

1. `plan_approval` après l’entretien interactif ;
2. `delivery_approval` après la génération de la spécification et des tâches.

Cependant, `PipelineController.approve()` suppose qu’une approbation mène toujours à la fin du pipeline. Après l’appel à `service.approvePlan()`, il :

- affiche systématiquement `ACP Pipeline Completed` ;
- efface `activeSessionId` ;
- arrête le heartbeat ;
- nettoie les buffers d’activité.

Lorsque la première approbation reprend le graphe, celui-ci génère la spec et les tâches puis atteint la seconde pause. Un nouvel événement `plan-ready` est donc bien émis, mais le contrôleur annonce quand même que le pipeline est terminé et supprime son état actif dans le `finally`.

### Impact

Après la première validation :

- la seconde demande d’approbation apparaît ;
- une fausse notification `Pipeline Completed` est également affichée ;
- `/pipeline status` considère qu’aucun pipeline n’est actif ;
- `/pipeline cancel` ne peut plus annuler correctement le run ;
- le heartbeat et le suivi d’activité sont arrêtés ;
- la commande `/pipeline approve` ne distingue pas une approbation intermédiaire d’une exécution terminée.

### Correction recommandée

Faire retourner à `approve()` un résultat similaire à `runPipeline()` :

```ts
interface PipelineApprovalResult {
  output?: string;
  plan?: string;
  awaitingApproval: boolean;
}
```

Après `service.approvePlan()` :

```ts
const pendingPlan = this.pendingPlan;
const awaitingApproval = pendingPlan?.sessionId === sessionId;

if (awaitingApproval) {
  // Conserver activeSessionId et le heartbeat.
  // Ne pas afficher Pipeline Completed.
  // Informer l’utilisateur qu’une nouvelle validation est attendue.
} else {
  // Terminer réellement le run.
}
```

Ajouter un test d’exécution complet :

```text
run
→ entretien terminé
→ première approbation
→ spec + tâches
→ seconde approbation détectée
→ pipeline toujours actif
→ deuxième approbation
→ implémentation
→ review
→ completed
```

Les tests actuels vérifient seulement la structure du catalogue et la présence du bloc XML. Ils ne couvrent pas la reprise du graphe à travers deux validations.

## 2. Important — les étapes annoncées read-only peuvent modifier le workspace

Le planner, le spec writer, le task planner et le reviewer déclarent :

```yaml
sideEffects: none
permissions: allowAll
```

Or `permissions: allowAll` active l’approbation automatique des demandes ACP. Le client natif expose notamment :

- `writeTextFile` ;
- la création de terminaux ;
- l’exécution de commandes.

`sideEffects: none` n’est réellement appliqué que pour un agent Sandcastle : le worktree est alors rejeté. Pour un agent ACP natif, cette valeur ne bloque ni l’écriture de fichiers ni les commandes mutantes.

### Impact

La garantie documentée « planner, spec writer, task planner and reviewer are read-only » repose uniquement sur le prompt.

Un agent natif peut malgré tout :

- écrire ou supprimer un fichier ;
- lancer un formatter qui modifie le workspace ;
- mettre à jour des snapshots ;
- générer des caches ;
- exécuter une commande destructive.

### Correction recommandée

À court terme, utiliser :

```yaml
permissions: ask
```

pour toutes les primitives non implémenteur.

À moyen terme, rendre `sideEffects: none` exécutoire dans le runtime :

```ts
if (sideEffects === "none") {
  denyWriteTextFile();
  denyMutatingTerminalCommands();
}
```

Une autre option robuste consiste à exécuter les étapes de lecture dans Sandcastle avec `sideEffects: none`, puis à rejeter automatiquement les éventuelles modifications.

## 3. Important — les skills user-invoked ne sont pas réellement injectés

Le YAML déclare correctement des skills comme :

```yaml
skills:
  - to-spec
```

ou :

```yaml
skills:
  - implement
  - tdd
```

Cependant, `renderSkillsCatalog()` exclut les skills portant :

```yaml
disable-model-invocation: true
```

même lorsqu’ils sont explicitement demandés par une primitive du pipeline.

Les skills `to-spec`, `to-tickets` et `implement` sont précisément marqués ainsi. Le bloc `<available_skills>` transmis à l’agent ne contient donc pas ces entrées.

Les adapters `.acp/agents/matt-*.md` recopient suffisamment de règles pour que le workflow puisse fonctionner, mais techniquement les primitives n’utilisent pas réellement ces skills via le mécanisme de skills du pipeline.

### Correction recommandée

Distinguer deux cas :

1. invocation automatique proposée au modèle ;
2. invocation explicite demandée par une primitive pipeline.

`disable-model-invocation` doit empêcher uniquement le premier cas.

Par exemple :

```ts
const entries = catalog.filter(entry => allowed.has(entry.name));
```

lorsque l’allow-list provient explicitement de la primitive.

Ou introduire une option :

```ts
renderSkillsCatalog(catalog, allowList, workspaceCwd, {
  includeUserInvoked: true,
});
```

Ajouter ensuite un test qui vérifie que `to-spec`, `to-tickets`, `implement` et `code-review` apparaissent réellement dans le prompt final transmis à l’agent.

## 4. Fragile — du contenu arbitraire est placé dans une balise structurelle

Pour respecter le contrat actuel des approvals, la seconde validation encapsule la spec et les tâches dans :

```xml
<proposed_plan>
  <interview_state>ready</interview_state>

  {{steps.spec.output}}
  {{steps.tasks.output}}
</proposed_plan>
```

Le parseur utilise une expression régulière et exige exactement un bloc `<proposed_plan>...</proposed_plan>` sans contenu extérieur.

Si la spec ou les tâches contiennent accidentellement une balise `<proposed_plan>` ou `</proposed_plan>`, la validation peut être tronquée ou rejetée.

### Correction recommandée

Introduire un vrai type de pause :

```ts
type PipelinePause =
  | { type: "plan-approval"; plan: string }
  | { type: "content-approval"; content: string };
```

À défaut, encoder ou échapper le contenu injecté, même si cela resterait un contournement temporaire.

## 5. Tests manquants

Le test ajouté couvre correctement :

- la découverte du pipeline ;
- l’ordre des steps ;
- les skills déclarés ;
- les side effects déclarés ;
- la résolution des prompt files ;
- la présence du wrapper XML de la seconde approbation ;
- la présence des fichiers de skills vendus.

Il manque toutefois les tests les plus importants :

1. exécution réelle d’un pipeline avec deux approvals ;
2. conservation de `activeSessionId` entre les deux pauses ;
3. absence de notification `Pipeline Completed` après la première approbation ;
4. possibilité d’annuler pendant la seconde pause ;
5. reprise correcte après la seconde approbation ;
6. injection effective des skills user-invoked ;
7. enforcement réel de `sideEffects: none` pour un agent natif.

## Points positifs

Le découpage fonctionnel est cohérent :

- `grill-me` conserve l’interaction question par question ;
- `to-spec` et `to-tickets` sont séparés ;
- une validation humaine existe avant l’implémentation ;
- l’implémentation est isolée dans Vibe Sandcastle ;
- la review distingue Standards et Spec ;
- les adapters retirent correctement les commandes slash, les commits et la publication d’issues incompatibles avec le transport ACP ;
- Sandcastle applique les changements au host avec `git apply`, ce qui laisse un working-tree diff visible pour le reviewer via `git diff HEAD`.

## Ordre de correction recommandé

1. Corriger le cycle de vie de `PipelineController.approve()` avec plusieurs approvals.
2. Ajouter un test end-to-end du pipeline à deux validations.
3. Rendre `sideEffects: none` réellement exécutoire.
4. Permettre l’injection explicite des skills user-invoked.
5. Remplacer le wrapper `<proposed_plan>` de la seconde validation par un type de pause générique.

## Conclusion

La direction est bonne, mais le premier point est bloquant avant merge. Le runtime actuel a été conçu autour d’une seule pause humaine ; cette PR doit soit étendre correctement ce contrat, soit rester limitée à une seule approbation.