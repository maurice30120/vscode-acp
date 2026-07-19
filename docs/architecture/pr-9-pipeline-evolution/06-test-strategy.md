# 6. Stratégie de tests

## 6.1 Règle

L’interface est la surface de test. Les tests doivent vérifier les outcomes, snapshots et effets observables, pas les champs privés du registre ou l’ordre interne des méthodes LangGraph.

## 6.2 Package `@acp-client/pipeline`

### Tests de lifecycle

| Cas | Résultat attendu |
| --- | --- |
| Pipeline sans pause | `completed` au premier `start`. |
| Une pause | `paused`, puis `completed` après resume. |
| Deux pauses | `paused`, puis `paused`, puis `completed`. |
| Pause rejetée | statut terminal rejected, registre supprimé. |
| Cancel pendant run | signal aborté, statut cancelled, registre supprimé. |
| Cancel pendant seconde pause | possible et terminal. |
| Resume avec mauvais `pauseId` | erreur `stale pipeline pause`. |
| Double resume du même `pauseId` | deuxième appel refusé. |
| Resume d’un run completed | session inconnue/terminale. |

### Tests de contenu de pause

- plan valide avec un seul `<proposed_plan>` ;
- plan sans wrapper refusé ;
- pause markdown contenant littéralement `<proposed_plan>` acceptée ;
- delivery markdown non éditable ;
- révision autorisée uniquement sur pause plan éditable.

### Tests de validator

- defaults de `purpose`, `contentType`, `editable` ;
- valeurs invalides ;
- templates de pause ne référencent que des étapes antérieures ;
- compatibilité YAML v2 existante.

## 6.3 Test de contrat `PipelineAgentRunner`

Créer une suite réutilisable prenant une factory d’adapter :

```ts
export function definePipelineAgentRunnerContract(
  name: string,
  createRunner: () => PipelineAgentRunner,
): void;
```

Contrats :

- transmet `AbortSignal` ;
- transmet session updates ;
- respecte skills explicites ;
- respecte permission mode sans dépasser les capabilities ;
- garantit le traitement de `sideEffects`/policy ;
- normalise le texte ;
- dispose les ressources après succès, erreur et annulation.

Appliquer la suite à Pi et VS Code.

## 6.4 Adapter Pi

### `PipelineController`

Tester via l’interface publique :

- notifications envoyées ;
- `formatActivitySnapshot()` ;
- commandes approve/reject/cancel ;
- heartbeat actif seulement pendant une activité longue ;
- absence de completion après une pause intermédiaire ;
- nouvelle pause affichée avec son `stepId` ;
- completion unique à la fin.

Éviter d’asserter directement un champ privé. Utiliser les messages, le status formaté et le faux runtime.

### Capabilities natives

Avec `ConnectionManager` et handlers fakes :

| Policy | Attendu |
| --- | --- |
| read-only natif | read true, write false, terminal false. |
| read-write natif | write et terminal selon config. |
| allow-all + read-only | écriture toujours refusée. |
| appel write malgré capability false | refus défensif du handler. |

### Sandcastle

- sandbox jetable rejette toujours les changements ;
- sandbox promotable preview puis apply/reject ;
- annulation pendant dialogue de promotion ;
- aucun changement host pour une étape read-only.

### Skills

- skill découvrable incluse en mode discoverable ;
- user-invoked exclue du catalogue discoverable ;
- user-invoked incluse en mode explicit ;
- skill explicite absente = erreur ;
- ordre de l’allow-list conservé.

## 6.5 Adapter VS Code

### `OrchestrationRuntime`

- `sendPrompt` avec outcome paused ;
- première approval produisant une nouvelle pause ;
- deuxième approval produisant completion ;
- `promptEnd` correct sans faux completion ;
- `pauseId` transmis dans le message UI ;
- cancel sur seconde pause ;
- événements toujours projetés via `SessionManager.projectAndApply`.

### `DefaultEphemeralAgentRunner`

- transmet `skills` au run natif ;
- transmet la policy complète ;
- sélectionne l’adapter Sandcastle ;
- n’efface pas silencieusement une propriété du contrat.

## 6.6 Test end-to-end de la PR #9

Utiliser des agents fakes déterministes :

```text
planner → proposed_plan
pause plan_approval
resume
spec_writer → markdown spec
task_planner → markdown tasks
pause delivery_approval
resume
implementer → markdown report + faux diff
reviewer → markdown review
completed
```

Assertions :

- ordre exact des primitives ;
- contenu des templates ;
- deux `pauseId` différents ;
- seconde pause en markdown sans wrapper XML ;
- implémenteur jamais lancé avant delivery approval ;
- reviewer voit les sorties approuvées ;
- completion émise une seule fois ;
- run supprimé seulement après review.

## 6.7 Matrice CI

| Suite | Commande cible |
| --- | --- |
| Shared pipeline | `npm test -w @acp-client/pipeline` |
| Shared Sandcastle | `npm test -w @acp-client/sandcastle` |
| Plugin Pi | `npm test -w @acp-client/pi-extension` |
| Extension VS Code | `npm test -w acp-client` |
| Compile transverse | `npm run compile` |
| Lint transverse | `npm run lint` |

La migration n’est terminée que lorsque les deux adapters passent la même suite de contrat.

## 6.8 Tests à supprimer après approfondissement

Après création des tests de contrat à l’interface du module profond :

- supprimer les tests qui ne vérifient que le pass-through de `PipelineService` ;
- supprimer les tests couplés à `pendingPlan` privé ;
- conserver les tests ciblés du compilateur pour les règles de graphe ;
- ne pas doubler chaque test lifecycle dans le moteur, le service et le contrôleur.
