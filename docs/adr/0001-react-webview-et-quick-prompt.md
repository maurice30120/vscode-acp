# ADR 0001: Adoption d'une webview React partagée pour le chat et le quick prompt

- Statut: Proposé
- Date: 2026-03-16
- Branche documentée: `feature/react`
- Référence de comparaison: `main`

## Contexte

La branche `feature/react` introduit un ensemble de changements importants par rapport à `main`, mais ces changements ne relèvent pas d'une simple accumulation de fonctionnalités isolées. Ils convergent vers une même décision d'architecture: déplacer l'interface de chat vers une application webview plus structurée, capable de supporter plusieurs surfaces UI sans dupliquer la logique de présentation.

Dans `main`, la webview de chat reste principalement pilotée par l'extension host. La logique d'assemblage de l'interface, de routage des événements et d'évolution du rendu est concentrée dans `ChatWebviewProvider`, ce qui complique l'ajout d'une nouvelle expérience utilisateur partageant les mêmes primitives de session, de rendu Markdown, de slash commands et de sélection de mode ou de modèle.

La branche ajoute en parallèle:

- une nouvelle surface utilisateur `acp.quickPrompt`, exposée comme commande et raccourci clavier;
- une capture structurée du contexte éditeur via `EditorSnapshot`;
- une application React sous `webview/` avec état, normalisation des messages et composants dédiés;
- un shell HTML commun pour charger le chat et le quick prompt depuis les mêmes artefacts webview;
- une évolution de la synchronisation de session pour mieux absorber les mises à jour ACP reçues avant l'enregistrement complet d'une session;
- une réorganisation du build et des tests pour prendre en charge cette nouvelle séparation entre extension host et frontend webview.

Sans décision explicite, ces changements peuvent être lus comme une série de refactors indépendants. Cette lecture serait trompeuse: le but réel est de disposer d'une base UI unique, extensible et testable pour les interactions ACP.

## Décision

Nous adoptons une architecture de webview applicative fondée sur `React` et `Vite`, partagée entre le panneau de chat principal et un nouveau panneau de quick prompt.

Cette décision implique les choix suivants:

- Le frontend webview devient une application dédiée sous `webview/`, compilée en artefacts statiques déposés dans `resources/webview/dist`.
- Le chargement des surfaces UI est centralisé via un shell HTML commun (`resources/webview/chat.html`) et un helper côté extension (`getReactShellHtmlContent`) qui injecte le type de vue à rendre (`chat` ou `quick-prompt`).
- Le point d'entrée React (`webview/src/main.tsx`) choisit l'application à monter selon `data-view-kind`, ce qui permet de partager le pipeline de build, le CSS, la couche de messagerie VS Code et une partie des primitives d'état.
- `ChatWebviewProvider` conserve le rôle d'adaptateur entre l'extension host et la webview, mais une partie significative de la logique de présentation et de composition d'état est déplacée vers le frontend React.
- Le quick prompt devient un point d'entrée officiel de l'extension via la commande `acp.quickPrompt` et le raccourci `Ctrl+Alt+P` / `Cmd+Alt+P`. Son objectif est de capturer le contexte actif de l'éditeur, de préfixer le prompt avec ce contexte, puis de réinjecter l'envoi dans le flux normal du chat.
- La gestion de session est renforcée pour supporter cette UI plus riche: les mises à jour ACP reçues trop tôt sont rejouées après l'enregistrement de la session, et les états mode, modèle et commandes disponibles sont synchronisés vers les deux surfaces UI.
- Le pipeline de build est séparé par responsabilité: `Vite` pour la webview, `tsup` pour l'extension host. Les scripts `build:webview`, `watch:webview`, `compile:host`, `watch:host`, `package:host`, `test:unit` et `test:integration` deviennent les points d'entrée explicites de cette architecture.

## Conséquences

### Conséquences positives

- Le chat et le quick prompt reposent sur la même base technique, ce qui réduit la duplication de logique UI et facilite l'évolution conjointe des deux expériences.
- L'extension expose désormais une capacité produit supplémentaire: lancer un quick prompt contextuel depuis l'éditeur, avec fichier courant, curseur et sélection inclus dans le prompt envoyé à l'agent.
- L'état frontend devient plus testable grâce à des modules dédiés pour la normalisation, l'historique, la composition du prompt et la réduction d'état, ainsi qu'à l'ajout de tests `vitest`.
- Le chargement de la webview devient plus cohérent grâce à un shell commun et à des messages typés entre l'extension host et le frontend React.
- `SessionManager` absorbe mieux les notifications ACP asynchrones en rejouant les `available_commands_update` et autres mises à jour de session reçues avant la mise à disposition complète de la session dans la mémoire locale.
- La robustesse opérationnelle progresse aussi côté permissions avec une file d'attente explicite dans `PermissionHandler`, évitant que plusieurs demandes concurrentes se chevauchent dans VS Code.

### Coûts et contraintes

- L'architecture introduit un frontend distinct, donc davantage de dépendances (`react`, `react-dom`, `vite`, `vitest`, `@testing-library/*`) et une chaîne de build plus sophistiquée.
- La logique fonctionnelle est désormais répartie entre l'extension host et la webview React, ce qui impose de maintenir un contrat de messages stable entre les deux côtés.
- Le quick prompt ajoute une nouvelle surface à synchroniser avec l'état de session courant, en particulier pour les modes, modèles et slash commands.
- Le dépôt doit désormais assumer une structure publique plus claire entre code host (`src/`) et code frontend (`webview/`).

## Alternatives écartées

### 1. Continuer à faire évoluer une webview principalement pilotée côté extension

Cette option préserve l'existant à court terme, mais elle rend l'ajout d'une seconde surface comme le quick prompt plus coûteux. La logique d'interface reste trop concentrée dans `ChatWebviewProvider`, avec un risque accru de duplication et de régression à mesure que les comportements UI se multiplient.

### 2. Ajouter le quick prompt comme implémentation ad hoc indépendante du chat

Cette option permettrait d'aller vite sur la fonctionnalité, mais au prix d'une dette technique immédiate: double rendu, double gestion d'état, double maintenance des pickers et des messages VS Code. Elle ne répond pas à l'objectif de base commune.

### 3. Conserver `webpack` comme pipeline unique

Cette option n'est pas retenue, car la branche assume une séparation plus nette entre application webview et extension host. `Vite` est plus adapté au bundle frontend et `tsup` simplifie la compilation de l'extension côté Node, avec des scripts distincts qui reflètent mieux cette responsabilité partagée.

## Écarts notables par rapport à `main`

Les changements suivants matérialisent directement la décision prise:

- ajout de la commande publique `acp.quickPrompt` et du raccourci `Ctrl+Alt+P` / `Cmd+Alt+P`;
- ajout de `QuickPromptPanel` et de `EditorSnapshot` pour capturer le contexte éditeur et le renvoyer vers `ChatWebviewProvider.sendPromptFromExtension(...)`;
- remplacement du rôle central d'une webview chat plus monolithique par un shell React commun, chargé via `getReactShellHtmlContent(...)` et `resources/webview/chat.html`;
- création du frontend `webview/` avec `App.tsx`, `QuickPromptApp.tsx`, une couche d'état dédiée et des composants de rendu pour tours, plans, outils et zone de saisie;
- remplacement de `webpack` par la combinaison `Vite` + `tsup`, avec des scripts de build et de test explicitement séparés dans `package.json`;
- ajout de tests ciblés sur la sérialisation des permissions, le replay des mises à jour de session et le comportement des nouvelles applications webview.

Cet ADR documente donc une décision d'architecture et ses impacts visibles côté produit. Il ne cherche pas à reproduire le diff complet entre `main` et `feature/react`, mais à expliquer pourquoi ces changements existent ensemble et pourquoi ils doivent être maintenus comme un ensemble cohérent.
