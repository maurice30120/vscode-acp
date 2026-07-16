# Roadmap — ACP Client monorepo

Ce fichier est la **vue d'ensemble** des priorités et idées pour les trois workspaces du monorepo. Le détail des réalisations, des décisions techniques et des plans d'implémentation vit dans les roadmaps et les documents de chaque sous-projet.

## `acp-client` (extension VS Code)

### Court terme
- Renforcer Sandcastle : policies réseau/terminal, limites dans l'UI, isolation OS optionnelle.
- Stabiliser la liste des sessions et les mécanismes de reprise selon les capacités agent.
- Skills workspace : autocomplétion `/skill`, watcher `.agents/skills`, validation des `SKILL.md`, documentation dédiée.
- Simplifier l'appel pipeline : defaults sensibles, CodeLens sur les fichiers `.acp/pipelines/*.yaml`, moins de confirmations.
- UI pipeline : timeline lisible (statut, durée, agent), preview des prompts et instructions injectés.
- Architecture : approfondir `SessionManager` / `PipelineService` / webview ; corriger resume vs load ; factoriser `EphemeralRun`.

### Moyen terme
- Profils agents déclaratifs en `.acp/agents/*.yaml` (`AgentProfileCatalog`).
- Persistance locale multi-workspace v2 (`SessionHistoryStore` avec statuts `available`/`missing`/`agentRemoved`).
- Recherche, export et import de l'historique des sessions.
- Politiques de sécurité déclaratives (`allow` / `deny` / `ask`) pour shell, fichiers, réseau.

### Idées
- Prévisualiser et éditer le contexte injecté avant envoi à l'agent.
- Historique des plans proposés, approuvés, rejetés ou modifiés ; comparer avec les changements réels.
- Mode comparaison multi-agent : même prompt à plusieurs agents, résultats côte à côte.
- Centre de diagnostic : bundle de support filtré depuis les snapshots debug.

→ Détail : [`plugin-vscode/ROADMAP.md`](plugin-vscode/ROADMAP.md)

---

## `@acp-client/pipeline`

### Court terme
- Exposer et consommer **`type: parallel`** de bout en bout côté hôtes (VS Code UI, Pi) — le moteur est déjà présent dans le package.
- Créer une **suite de tests dédiée** au package (validation YAML, résolution `promptFile`, branches parallèles, annulation) — aujourd'hui aucun `*.test.ts`.
- Stabiliser l'API publique et documenter le contrat des callbacks injectés dans `PipelineService`.

### Moyen terme
- DAG avec dépendances `needs` arbitraires (v3 — voir [`plugin-vscode/doc_fr/plans/plan-workflows-paralleles.md`](plugin-vscode/doc_fr/plans/plan-workflows-paralleles.md)).
- Map-reduce dynamique : N branches générées depuis une liste structurée en sortie d'étape.
- Composition : un pipeline appelant un sous-pipeline comme étape.
- Retry, timeout et stratégies d'erreur par étape.

### Idées
- Steps conditionnels (`when:`) sans passer à un DAG complet.
- Schéma JSON Schema exportable pour autocomplétion dans les éditeurs.
- Métriques d'exécution (durée par step/branche) émises via événements.

→ Détail : [`acp-pipeline/README.md`](acp-pipeline/README.md) · [`plugin-vscode/doc_fr/adr/0018-pipeline-v2-catalogue-canonique.md`](plugin-vscode/doc_fr/adr/0018-pipeline-v2-catalogue-canonique.md) · [`plugin-vscode/doc_fr/adr/0019-promptfile-pipeline-partage.md`](plugin-vscode/doc_fr/adr/0019-promptfile-pipeline-partage.md)

---

## `@acp-client/pi-extension`

### Court terme
- **Sandcastle éphémère** : config dédiée `.pi/.acp/.sandcastle/config.json`, bridge ACP, promotion post-run, `isAgentSandcastle` branché. Voir [`plugin-pi/tickets.md`](plugin-pi/tickets.md).
- Visualiser les diffs et artefacts produits par Pi au-delà du texte brut collecté par `ephemeralRunner`.
- Simplifier l'appel `/pipeline` : defaults sensibles, lancement direct depuis un fichier YAML.
- Robustesse du runner : timeouts sur les appels ACP, propagation de la mort du process enfant, feedback UI pendant les phases longues. Voir [`plugin-pi/plans/friz-pipeline.md`](plugin-pi/plans/friz-pipeline.md).

### Moyen terme
- Outil `run_pipeline` enrichi : sélection d'agent par étape, options de session, mode auto-approve, hooks entre étapes.
- Persistance et reprise des runs pipeline côté plugin.
- Connexion agent **via Pi comme relay ACP** : bénéficier des skills / `.agents/` de l'hôte tout en gardant l'orchestration pipeline.
- Surcharge de config workspace via `.pi/.acp/` (ADR-0007 v2).

### Idées
- Pipelines pilotés par le modèle Pi : choix dynamique de workflow selon le contexte.
- Export / import de pipelines partageables entre workspaces.
- View diff interactif post-Sandcastle (hors scope v1 tickets).

→ Détail : [`plugin-pi/ROADMAP.md`](plugin-pi/ROADMAP.md) · [`plugin-pi/tickets.md`](plugin-pi/tickets.md)

---

## Thèmes transverses monorepo

- **Pipeline v2 canonique** — fait ; maintenir la parité VS Code ↔ Pi ↔ `@acp-client/pipeline`.
- **`promptFile` partagé** — fait (ADR-0019) ; généraliser aux futurs profils agents YAML.
- **Parallélisme read-only** — moteur prêt dans `@acp-client/pipeline` ; reste à livrer les exemples YAML, l'affichage dans les deux UIs et les garde-fous `sideEffects: workspace`.
- **Sandcastle** — mature côté VS Code ; **en cours** côté Pi (tickets Sandcastle éphémère).
- **Skills workspace** — injection prompt OK dans les deux hôtes ; UX de découverte et orchestration par rôle pipeline à unifier.
- **Profils agents YAML** — prochain levier commun : `AgentProfileCatalog`, watcher, fusion avec la config agent existante.
