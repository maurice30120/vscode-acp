# ADR 0002: Exécution ACP dans un conteneur Docker existant

- Statut: Accepté
- Date: 2026-03-17
- Branche documentée: `feature/agent-in-docker`
- Référence de comparaison: `main`

## Contexte

Le projet est une extension VS Code ACP qui pilote des agents via des process locaux (`stdio` + JSON-RPC ACP). Pendant cette session, l'objectif a été de rendre l'exécution des agents fiable dans Docker, sans changer le modèle d'intégration de fichiers côté extension.

Les besoins opérationnels validés:

- exécuter l'agent ACP principal et les commandes `terminal/*` ACP dans un conteneur déjà démarré;
- ne pas gérer le cycle de vie Docker depuis l'extension (pas de `docker run`, pas d'auto-start);
- conserver les opérations fichiers côté hôte via `FileSystemHandler` (pas de mapping host/container en v1);
- utiliser l'auth Codex via le montage `${HOME}/.codex` (pas de clé API en variable d'environnement);
- injecter uniquement `MISTRAL_API_KEY` pour Vibe.

Le problème observé en validation n'était pas un besoin de rebuild systématique du conteneur, mais un alignement de chemins: si le projet ouvert dans VS Code n'est pas monté dans le conteneur au meme chemin absolu, l'agent voit un autre codebase.

## Décision

Nous adoptons un mode Docker global piloté par configuration VS Code, appliqué de facon uniforme aux lancements agent et terminal.

Décisions clés:

- ajout de `acp.docker.enabled` et `acp.docker.container` comme settings publics;
- `acp.defaultWorkingDirectory` devient la source effective du `cwd` session si renseigné, sinon fallback workspace;
- introduction d'un launcher commun (`ProcessLauncher`) partagé entre `AgentManager` et `TerminalHandler`;
- en mode Docker, chaque lancement est encapsulé en `docker exec -i -w <cwd> [-e KEY=VALUE] <container> /bin/sh -lc '<commande échappée>'`;
- validation bloquante avant session:
  - Docker CLI disponible;
  - conteneur cible existant et `running`;
  - `cwd` présent dans le conteneur (`test -d`);
  - refus explicite sous Windows en v1;
- conservation stricte du modèle fichiers hôte (pas de translation de chemins v1).

## Implémentation

Changements extension:

- `src/utils/ProcessLauncher.ts`: nouvelle abstraction unique de lancement + validation runtime Docker.
- `src/config/AgentConfig.ts`: lecture des settings Docker et résolution centralisée du `cwd`.
- `src/core/AgentManager.ts`: passage au launcher partagé pour le process agent.
- `src/handlers/TerminalHandler.ts`: passage au meme launcher partagé pour `terminal/create`.
- `src/core/ConnectionManager.ts`, `src/core/SessionManager.ts`, `src/extension.ts`: propagation du launcher commun et validation Docker avant `newSession`.
- `package.json`: exposition des settings `acp.docker.*` et clarification de `acp.defaultWorkingDirectory`.
- `README.md`: documentation du mode Docker, prérequis de montage, et workflow Compose.

Changements containerisation:

- `Dockerfile`: image runtime avec Node 22 + Python 3.12, installation de `@openai/codex`, `@zed-industries/codex-acp`, et `mistral-vibe` dans un venv.
- `docker-compose.yml`: service `acp-agents` minimal, conteneur long-vivant (`sleep infinity`), montage `${HOME}/.codex`, variable inline `MISTRAL_API_KEY` uniquement, sans `env_file`.
- suppression du flux `.env` et des scripts d'injection d'auth associés.

## Validation

Couverture ajoutée:

- tests unitaires launcher: génération host vs Docker, flags `-i/-w/-e`, commande shell échappée, erreurs Windows/container/cwd;
- tests config: priorité de `acp.defaultWorkingDirectory` puis fallback workspace;
- adaptation des tests `SessionManager` et `TerminalHandler` pour l'injection du launcher.

Validation runtime réalisée pendant la session:

- build et démarrage via Compose;
- disponibilité de `codex`, `vibe-acp` et `codex-acp` dans le conteneur;
- visibilité du montage `/root/.codex`;
- vérification que l'exécution réelle dépend des settings appliqués dans la bonne instance VS Code.

Point d'attention confirmé:

- pour que l'agent voie le bon code source, le projet ouvert doit etre monté dans le conteneur au meme chemin absolu que sur l'hôte;
- si plusieurs projets sont ouverts hors du repo plugin, il faut monter un parent commun (par exemple `${HOME}:${HOME}` ou `/Users/<user>/Documents:/Users/<user>/Documents`) et aligner `acp.defaultWorkingDirectory`/workspace en conséquence.

## Conséquences

Conséquences positives:

- exécution cohérente agent + terminal dans un contexte Docker unique;
- réduction des écarts de comportement entre host et container;
- auth Codex sans clé API en environnement, via session locale montée;
- surface de configuration utilisateur simple et explicite.

Contraintes assumées:

- Docker mode non supporté sur Windows en v1;
- aucune translation de chemins host/container en v1;
- exigence forte de montage au meme chemin absolu;
- conteneur non géré par l'extension (préparation/démarrage hors extension).
