# Étude du flux Matt Skills

## Synthèse

Le flow observé dans les skills Matt Pocock organise le développement agentique
comme une chaîne de responsabilités progressives :

1. `/ask-matt` peut aider à choisir le bon flow, mais ne doit pas être le centre
   de la V1.
2. `/grill-me` ou `/grill-with-docs` cadre l’idée avant tout code.
3. `/to-spec` condense la discussion en spécification lorsque le travail dépasse
   une session.
4. `/to-tickets` découpe la spécification en tickets agent-ready, avec
   dépendances explicites.
5. `/implement` exécute un ticket ou une demande bornée, idéalement en TDD.
6. `/code-review` valide la diff selon deux axes : standards du dépôt et respect
   de la spec.

La V1 adaptée au projet consiste à inclure ces skills dans les agents existants.
La V2 pourra ensuite utiliser `/ask-matt` comme routeur d’un pipeline dynamique.

## Répartition cible par agent

- `planner` : utilise `grill-me` pour cadrer une demande simple, ou
  `grill-with-docs` lorsque le cadrage doit s’appuyer sur le dépôt et garder une
  trace documentaire. Il peut aussi s’inspirer de `to-spec` et `to-tickets` pour
  produire un plan assez stable pour une exécution future.
- `implementer` : utilise `implement` comme comportement principal, avec `tdd`
  lorsque le travail peut être découpé en boucles red-green-refactor.
- `tester` : reprend l’esprit de `tdd` côté vérification, mais reste centré sur
  l’exécution et le reporting des tests existants.
- `reviewer` : utilise `code-review` pour relire l’implémentation contre le plan
  approuvé, les standards du dépôt et les risques de régression.
- `/ask-matt` : reste une aide optionnelle d’orientation, utile si l’utilisateur
  ne sait pas quel agent ou quel flow choisir. En V2, cette aide devient le
  moteur de sélection d’un pipeline dynamique.

Le point central n’est pas l’automatisation totale, mais l’amélioration de chaque
agent par le skill qui correspond à sa responsabilité.

## Décision d’intégration V1

La V1 doit enrichir les prompts des agents existants, pas remplacer leur
`promptFile` par les `SKILL.md` bruts.

Même si `promptFile` peut techniquement charger un fichier Markdown, les skills
Matt contiennent du frontmatter, des consignes génériques et parfois des
enchaînements qui ne correspondent pas exactement au rôle d’un agent pipeline.
Les prompts `.acp/agents/*.md` doivent donc reprendre les règles utiles des
skills, en les adaptant au contexte ACP et aux garde-fous humains.

Cette approche garde :

- un rôle clair pour chaque agent ;
- une compatibilité avec les pipelines déclaratifs actuels ;
- la maîtrise des effets de bord ;
- la possibilité d’intégrer plusieurs inspirations de skills dans un même agent.

## Correspondance avec le dépôt

- `Pipeline` : reste le flow déclaratif qui orchestre les agents existants. La
  V1 documente les comportements attendus des agents, sans introduire de nouveau
  YAML.
- `VirtualAgent` : les agents exposés par le pipeline restent les points
  d’entrée visibles. `/ask-matt` peut rester un futur agent virtuel d’aide, mais
  il n’est pas la V1 principale.
- `PipelineStep` : chaque étape peut invoquer un agent dont les instructions
  incorporent le skill adapté à son rôle.
- `PlanApprovalGate` : garde le point d’arrêt humain entre le plan produit par
  `planner` et l’exécution par `implementer`.
- `EphemeralRun` : pourrait servir plus tard à lancer ponctuellement un agent
  enrichi par skill pour une étape de pipeline, sans session longue durée.

Cette correspondance reste compatible avec les pipelines déclaratifs actuels
sous `.acp/pipelines/*.yaml`, sans figer une nouvelle définition pipeline.

## Perspective V2 : pipeline dynamique

La V2 cible un pipeline dont la forme dépend de la recommandation de
`/ask-matt`. Au lieu d’exécuter toujours les mêmes `PipelineStep`, le système
commencerait par une étape de routing :

1. `/ask-matt` analyse la demande utilisateur.
2. Il choisit un flow : cadrage simple, cadrage documenté, spec, tickets,
   implémentation directe, test, review, ou combinaison de ces étapes.
3. Le pipeline construit ou sélectionne dynamiquement les `PipelineStep`
   nécessaires.
4. Les étapes à effets de bord restent bloquées par un `PlanApprovalGate`.
5. Les agents enrichis par la V1 exécutent les étapes choisies.

Cette V2 demande des décisions supplémentaires : représentation du pipeline
dynamique, traçabilité du choix de `/ask-matt`, reprise après erreur, et limites
entre recommandation, planification et exécution.

## Points forts

- Cadrage avant code : le `planner` cherche d’abord à comprendre l’objectif, les
  termes et les décisions.
- Spécialisation par agent : chaque agent reçoit les skills qui correspondent à
  son rôle, au lieu de déléguer toute la décision à un routeur.
- Découpage multi-session : les travaux longs peuvent être condensés en spec
  puis découpés en tickets avant l’implémentation.
- Revue automatisée : le `reviewer` compare à la fois les conventions du dépôt
  et la demande initiale.
- Vocabulaire partagé : le flow encourage l’usage de termes stables pour limiter
  les malentendus entre utilisateur, agent et codebase.

## Risques

- Instructions trop lourdes : ajouter trop de skills dans un agent peut diluer
  son rôle principal.
- Perte de contrôle utilisateur : un agent enrichi qui exécute sans approbation
  contournerait le modèle humain-dans-la-boucle.
- Complexité d’orchestration : transformer chaque skill en comportement implicite
  d’agent augmente les questions de contexte, reprise, erreurs et approbations.
- Pipeline dynamique prématuré : en V2, `/ask-matt` peut choisir un flow trop
  ambitieux si les règles de routing ne sont pas explicites et auditables.
- Sur-formalisation : toutes les demandes ne justifient pas une spec ou un
  découpage en tickets.

## Limite de l’étude

Cette note ne propose ni modification des fichiers `.acp/agents/*.md`, ni
installation de skills, ni pipeline exécutable. Elle sert uniquement de base à
une décision future sur l’intégration des skills principaux dans les agents,
puis sur un pipeline dynamique piloté par `/ask-matt`.
