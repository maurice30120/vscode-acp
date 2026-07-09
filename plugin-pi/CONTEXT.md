# plugin-pi

Extension Pi qui exécute des pipelines ACP sous l'agent Pi. Autonome vis-à-vis de `plugin-vscode` — les deux implémentations vivent et divergent séparément.

## Language

### Exécution

**Sandcastle**:
Mode d'exécution d'un agent dans Docker et un worktree Git jetable, exposé comme un transport ACP (`sandcastle`) distinct du transport natif (`acp`).
_À éviter_: sandbox (seul), agent docker, mode conteneur

**Run éphémère**:
Un run d'agent = un process bridge ACP né et mort pour ce run, sans session persistante réutilisée sur les prompts suivants.
_À éviter_: run longue durée, session réutilisable, connected agent

**Side effects**:
Propriété d'un _run_ précisant ce qu'il peut faire : `none` (lecture seule) ou `workspace` (écriture dans le worktree, promotable). Ce n'est pas une propriété de l'agent — le même agent peut Lire dans un pipeline et écrire dans un autre.
_À éviter_: permissions, droits, capabilities

### Effets sur le workspace

**Promotion**:
Décision d'appliquer les changements du worktree isolé dans le vrai workspace (`applied`), de les jeter (`rejected`), ou de ne pas décider (`cancelled`).
_À éviter_: merge, commit, sync

**Cancelled**:
Outcome de promotion quand il n'y a pas eu de décision explicite — humain dismiss l'approbation, ou UI Pi absente. La sandbox est discartée mais la distinction avec `rejected` est conservée : `rejected` = décision explicite de jeter, `cancelled` = pas de décision.
_À éviter_: rejeté (ambigu entre les deux), abandonné

## Relationships

- **Pi ↔ plugin-vscode** : implémentations sœurs et divergentes. La duplication de code est intentionnelle ; aucun ne dépend de l'autre.
- **Pi ↔ @acp-client/pipeline** : pi consomme le package partagé (runtime pipeline, statuts, approbation). Cette frontière est commune aux deux plugins.
