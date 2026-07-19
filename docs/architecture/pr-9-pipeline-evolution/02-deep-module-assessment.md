# 2. Évaluation des modules et opportunités d’approfondissement

## 2.1 Méthode

L’évaluation utilise :

- le **deletion test** ;
- la taille et la complexité de l’**interface** ;
- la **locality** des règles métier ;
- le nombre d’adapters réels au seam ;
- la catégorie des dépendances.

## 2.2 Tableau de profondeur

| Module actuel | Diagnostic | Motif | Action proposée |
| --- | --- | --- | --- |
| `PipelineGraphCompiler` | Deep | Une interface de compilation cache LangGraph, les nœuds, les interrupts, le parallélisme et les templates. | Conserver ; généraliser le payload de pause. |
| `PipelineGraphCoordinator` | Assez deep | Centralise l’interprétation du graphe et le checkpoint. | Faire retourner un outcome typé. |
| `PipelineRunEngine` | Implémentation deep, interface trop pauvre | Cache beaucoup de comportement mais retourne uniquement du texte. | Exposer l’état suspendu/terminal et un snapshot. |
| `PipelineService` | Shallow | Relais de méthodes et d’événements sans invariant propre. | L’approfondir en façade runtime publique ou le supprimer. |
| `PipelineController` Pi | Trop de responsabilités | Commandes, état de run, projection UI, heartbeat, streaming, promotion. | Extraire un `PipelineRunPresenter`; garder le lifecycle piloté par outcome. |
| `OrchestrationRuntime` VS Code | Correctement placé | Adapter du transport virtual et projection webview. | Consommer le même outcome que Pi. |
| `EphemeralAcpRunner` Pi | Deep mais politique mélangée | Spawn, auth, prompt, streaming, skills et promotion dans un seul module. | Injecter une politique de capacités et un resolver de skills. |
| `DefaultEphemeralAgentRunner` VS Code | Shallow router | Route natif/Sandcastle et perd `sideEffects`/`skills`. | En faire un vrai adapter de `PipelineAgentRunner`. |
| `ConnectionManager` Pi | Deep | Cache transport NDJSON, initialisation ACP et construction du client. | Ajouter la politique d’exécution à son interface. |
| `SkillsCatalog` / `skillCatalog.ts` | Deux modules divergents | Même domaine avec interfaces et règles différentes. | Stabiliser un contrat commun, puis extraire si utile. |

## 2.3 Candidat principal : runtime de run

### Cluster actuel

```text
PipelineService
  → PipelineRunEngine
    → PipelineGraphCoordinator
      → PipelineGraphCompiler
    → PipelineRunRegistry
```

### Problème

L’interface externe est structurée autour d’actions historiques (`createPlan`, `approvePlan`) et non autour du lifecycle général d’un run.

### Module approfondi proposé

**Nom recommandé** : `PipelineRuntime`.

**Interface externe** : cinq opérations maximum : `start`, `resume`, `reject`, `cancel`, `getSnapshot`.

**Implémentation cachée** :

- catalogue et validation ;
- compilation ;
- checkpoint ;
- plusieurs pauses ;
- révision ;
- registre ;
- annulation ;
- événements ;
- nettoyage terminal.

### Deletion test

Si `PipelineRuntime` est supprimé, les hôtes doivent réimplémenter :

- la distinction paused/completed ;
- les identifiants de pause ;
- les transitions autorisées ;
- le nettoyage du registre ;
- les règles d’annulation ;
- la reprise LangGraph.

La complexité réapparaît dans au moins deux adapters. Le module gagne donc de la leverage et de la locality.

## 2.4 Candidat : politique de capacités d’étape

### Dépendances

| Dépendance | Catégorie | Stratégie |
| --- | --- | --- |
| Lecture/écriture de fichiers locaux | Local-substitutable | Handler en mémoire dans les tests. |
| Terminal hôte | Local-substitutable mais dangereux | Adapter fake pour tests ; désactivation stricte en read-only natif. |
| Agent ACP externe | True external | Mock adapter et tests de contrat. |
| Sandcastle local | Local-substitutable / runtime possédé | Adapter Sandcastle réel en intégration, fake en unité. |

### Seam recommandé

Le seam doit être placé avant la construction du client ACP :

```ts
interface StepExecutionPolicy {
  workspace: "read-only" | "read-write";
  terminal: "disabled" | "enabled";
  permissionMode: "ask" | "allow-all";
  isolation: "native" | "discarded-sandbox" | "promotable-sandbox";
}
```

Le connector reçoit cette politique et construit les capacités, handlers et adapter appropriés.

Il ne faut pas créer un simple wrapper de validation autour du runner. L’agent appelle directement les méthodes du client ACP ; le seam exécutoire se trouve donc dans `ConnectionManager` / `PiAcpClient` côté Pi et dans les équivalents de connexion côté VS Code.

## 2.5 Candidat : résolution des skills

Deux adapters existent déjà, donc le seam est réel.

**Interface cible** :

```ts
interface SkillPromptResolver {
  compose(input: {
    workspaceCwd: string;
    agentName: string;
    prompt: string;
    selection: SkillSelection;
  }): string;
}

type SkillSelection =
  | { mode: "none" }
  | { mode: "discoverable" }
  | { mode: "explicit"; names: string[] };
```

L’interface cache :

- scan du workspace ;
- frontmatter ;
- limite de taille ;
- `disable-model-invocation` ;
- rendu du catalogue ;
- résolution des noms ;
- stratégie d’injection.

À court terme, chaque hôte peut garder son implémentation. Les mêmes tests de contrat doivent s’appliquer aux deux. Une extraction vers un package partagé n’est justifiée qu’après stabilisation du contrat.

## 2.6 Candidat rejeté : interface de chaque handler ACP

Créer des ports publics séparés pour chaque opération `readTextFile`, `writeTextFile`, `createTerminal`, etc. agrandirait fortement l’interface du runtime pipeline.

Ces seams sont utiles à l’intérieur de l’adapter ACP et pour ses tests, mais ne doivent pas remonter à l’interface externe du pipeline. Ce sont des **internal seams**.

## 2.7 Locality attendue

Après l’évolution :

| Règle | Localisation unique |
| --- | --- |
| Déterminer paused vs completed | `PipelineRuntime` |
| Valider un resume contre la bonne pause | `PipelineRuntime` / registre |
| Interpréter un interrupt LangGraph | `PipelineGraphCoordinator` |
| Enforcer read-only/read-write | Connector ACP de l’hôte |
| Décider si une skill explicitement sélectionnée est injectable | `SkillPromptResolver` |
| Afficher une pause | Presenter/UI de chaque hôte |

Aucun adapter hôte ne doit recalculer ces règles.
