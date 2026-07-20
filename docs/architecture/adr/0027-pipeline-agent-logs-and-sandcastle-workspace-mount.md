# ADR-0027 — Logs agents de pipeline et workspace Sandcastle promouvable

**Statut** : Accepté
**Date** : 2026-07-20

## Contexte

Le replay CLI du pipeline `grill-spec-tickets-implement-review` devait prouver qu’un agent Sandcastle pouvait créer `poem3.md` dans le workspace réel, sans intervention manuelle. Le premier diagnostic était insuffisant : le terminal affichait seulement `ACP connection closed` ou une réponse d’agent, sans expliquer si l’échec venait du transport ACP, du process enfant, du sandbox Docker, des outils de l’agent ou de la promotion du worktree.

Le debug a montré plusieurs causes distinctes :

- `Vibe` pouvait fermer l’ACP parce que son process écrivait dans `~/.vibe/logs/vibe.log`, chemin non autorisé par le sandbox du runner courant.
- `Codex CLI` devait rester l’agent des étapes prévues par le pipeline ; remplacer ces étapes par `Vibe` n’est pas une solution acceptable.
- `Vibe Sandcastle` lançait bien le provider et appelait `write_file`, mais l’outil écrivait dans `/home/agent/workspace/poem3.md` sans produire de diff promouvable côté host. Le log de session Vibe a permis de constater que le fichier était écrit dans le workspace vu par l’agent, mais pas dans le worktree Sandcastle réellement promu.

Sans logs persistants par agent, ces situations se ressemblent depuis la sortie terminal alors qu’elles relèvent de corrections différentes.

## Décision

La CLI de pipeline écrit désormais des logs JSONL persistants sous `.acp/logs/` pour chaque nouveau départ de pipeline.

Au démarrage d’un run, `.acp/logs/` est nettoyé puis recréé. Le run produit :

- un fichier JSONL global par run ;
- un fichier JSONL par nœud agent, nommé avec le pipeline, le run id, le node id et l’agent, par exemple `...-plan-Codex_CLI.jsonl` ou `...-implementation-Vibe_Sandcastle.jsonl`.

Les logs capturent :

- `run_started`, `run_result` et les événements runtime ;
- `agent_started`, `agent_completed`, `agent_failed` ;
- les `status` de pipeline ;
- les `agent_message_chunk` visibles ;
- les métadonnées des `agent_thought_chunk` sans persister leur texte ;
- les logs internes du host, dont les stderr des process enfants, dupliqués dans le fichier de l’agent actif.

Cette duplication est volontaire : un diagnostic doit pouvoir commencer par le fichier de l’agent en échec sans devoir recroiser manuellement le log global.

Sandcastle Docker doit aussi garantir que le chemin utilisé par les agents comme workspace courant est le worktree qui sera inspecté et promu. Le provider Docker de `@ai-hero/sandcastle` choisit son `workdir` sandbox en cherchant un mount dont `hostPath` est égal au `worktreePath`. Le wrapper `createDockerSandboxProvider` ajoute donc au moment de `create` un mount :

```text
hostPath: <worktreePath>
sandboxPath: /home/agent/workspace
readonly: false
```

Les autres mounts restent dédiés aux besoins complémentaires : `.agents`, home provider (`/home/agent/.codex`, `/home/agent/.vibe`) et override Git pour rattacher le worktree Docker au répertoire Git parent.

## Invariants

1. Un nouveau départ de pipeline nettoie `.acp/logs/` avant d’écrire les logs du run courant.
2. Chaque nœud agent doit avoir son propre fichier de log lorsque le nœud démarre.
3. Les stderr du process agent sont persistés, même lorsque le mode terminal n’est pas `verbose`.
4. Les logs visibles de message agent sont conservés ; le texte des chunks de pensée ne l’est pas.
5. Le log global reste utile pour suivre le DAG complet, mais le fichier agent doit suffire à diagnostiquer l’agent actif.
6. Le workspace courant vu dans le conteneur Sandcastle doit correspondre au worktree promouvable.
7. Un fichier écrit par un outil agent dans `/home/agent/workspace` doit apparaître dans le diff Sandcastle.
8. Les corrections ne remplacent pas les agents déclarés par le pipeline : si le pipeline dit `Codex CLI`, ce nœud doit rester `Codex CLI`.

## Alternatives rejetées

- **Se contenter du terminal** : la sortie compacte ne contient pas les stderr, les chemins de session Vibe ni les détails de promotion.
- **Activer seulement `--verbose`** : le diagnostic dépendrait d’une option utilisateur et resterait fragile pendant les replays.
- **Remplacer `Codex CLI` par `Vibe`** : cela masque le problème au lieu de respecter le contrat du pipeline.
- **Monter directement le repo host sur `/home/agent/workspace` en user mount** : le provider Docker monte déjà ce chemin et échoue avec `Duplicate mount point`.
- **Laisser l’agent écrire dans un workspace conteneur non promu** : la revue peut alors réussir localement dans le conteneur mais échouer côté host, comme observé avec `poem3.md`.

## Conséquences

Le debug des pipelines CLI devient reproductible : après un échec, `.acp/logs/` indique si l’erreur vient du process agent, du protocole ACP, d’un tool call, du sandbox ou de la promotion.

Le replay `grill-spec-tickets-implement-review` a pu créer `poem3.md` via `Vibe Sandcastle` après correction du mount du worktree. La revue du pipeline a ensuite vérifié que le fichier existait et que la spec était satisfaite.

Le nettoyage de `.acp/logs/` signifie que ces fichiers sont des diagnostics du dernier run, pas une archive historique. Une conservation multi-run devra être décidée séparément si le besoin apparaît.

## Documents liés

- ADR-0022 — Runtime pipeline v3 unique et suppression du moteur v2
- ADR-0025 — Parité des surfaces hôtes et packages partagés
- ADR-0026 — Entretien agent V3 et sortie normalisée
