# ADR-0016 : Starter de workspace embarqué

**Statut** : Accepté

## Contexte

L'extension VS Code peut initialiser un workspace avec des fichiers ACP de base. Cette initialisation est déclenchée par la commande `ACP: Initialize Workspace Templates`, ou automatiquement au démarrage quand le bootstrap workspace est activé.

Le dossier `plugin-vscode/resources/workspace-starter` contient les fichiers embarqués dans le package de l'extension pour cette initialisation. Il ne représente pas la configuration active du dépôt courant : c'est un modèle copié dans d'autres workspaces.

Le code de copie vit dans `src/workspace/WorkspaceBootstrapCore.ts`. Le dossier starter est régénéré avant packaging par `scripts/sync-workspace-starter.mjs`, à partir des templates maintenus dans le dépôt.

## Décision

1. **Conserver `resources/workspace-starter` comme artefact de packaging.**
   - Il sert à embarquer les fichiers créés dans les workspaces utilisateurs.
   - Il ne doit pas être traité comme la source de vérité runtime du dépôt.

2. **Centraliser les fichiers de configuration ACP sous `.acp`.**
   - `.acp/` contient les agents, pipelines, équipes et fichiers d'instructions.
   - Cette règle accompagne la migration vers une configuration runtime ACP regroupée dans un seul dossier.

3. **Garder les autres dossiers limités à leur rôle.**
   - `.sandcastle/` contient uniquement le scaffold Docker nécessaire aux runs isolés.
   - `.agents/` peut contenir les skills workspace quand ils doivent être provisionnés.

4. **Régénérer le starter plutôt que l'éditer à la main.**
   - Après modification des templates sources, lancer `npm run sync:workspace-starter`.
   - Le script filtre les fichiers qui ne doivent pas être embarqués.

5. **Ne pas embarquer d'état local.**
   - Le starter ne doit pas contenir de logs, secrets, worktrees, caches ou marqueurs locaux comme `.bootstrap-version`.

## Conséquences

### Positives

- Le rôle de `resources/workspace-starter` est explicite : modèle packagé, pas configuration active.
- Les nouveaux workspaces reçoivent une structure cohérente avec la convention `.acp`.
- La régénération par script réduit les écarts entre les templates sources et ce qui est livré dans l'extension.

### Négatives

- Il faut penser à relancer `npm run sync:workspace-starter` avant packaging quand les templates changent.
- Le dossier peut sembler dupliqué avec les fichiers `.acp` du dépôt, même s'il a un rôle différent.

### Neutres

- Le comportement runtime du plugin ne change pas : cette ADR documente la responsabilité du starter.
- Les paramètres VS Code non liés aux agents restent dans la configuration VS Code.

## ADRs liés

- [ADR-0005 : Pipelines de planning A2A](0005-a2a-acp-pipeline.md)
- [ADR-0012 : Équipes d'agents](0012-equipes-agents.md)
