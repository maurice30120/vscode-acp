# Proposition V1 : skills par agent

## Intention

La V1 documente l’inclusion des principaux skills Matt Pocock dans les agents
existants du pipeline ACP. Elle ne crée pas encore de pipeline dynamique.

Le principe : chaque agent reçoit les skills qui renforcent sa responsabilité
naturelle, sans changer encore le schéma YAML des pipelines.

L’intégration se fait par prompts agents enrichis. La V1 ne remplace pas les
`promptFile` existants par des chemins directs vers `.agents/skills/*/SKILL.md`.
Les `SKILL.md` servent de source d’inspiration contrôlée, puis leurs règles
utiles sont reformulées dans les prompts des agents.

## Répartition proposée

| Agent existant | Skills à inclure | Rôle attendu |
| --- | --- | --- |
| `planner` | `grill-me`, `grill-with-docs`, `to-spec`, `to-tickets` | Cadrer la demande, verrouiller les décisions, produire un plan ou préparer une spec/tickets si le travail est trop large. |
| `implementer` | `implement`, `tdd` | Exécuter le plan approuvé, garder une diff ciblée, travailler par boucles testables. |
| `tester` | `tdd` | Valider le comportement avec les commandes de test existantes et rapporter les échecs de manière reproductible. |
| `reviewer` | `code-review` | Relire l’implémentation contre le plan, les standards du dépôt et les risques de régression. |

`/ask-matt` peut rester utile comme aide d’orientation en V1, mais seulement
pour conseiller quel agent ou quelle phase utiliser. Il devient central en V2.

## Comportement attendu

Le pipeline conserve son flow humain-dans-la-boucle :

1. `planner` cadre la demande avec `grill-me` ou `grill-with-docs`.
2. Si le travail dépasse une session, `planner` s’appuie sur `to-spec` puis
   `to-tickets` pour préparer une sortie plus structurée.
3. `PlanApprovalGate` garde l’approbation humaine avant toute modification du
   workspace.
4. `implementer` applique le plan approuvé avec `implement` et `tdd`.
5. `tester` vérifie les tests existants et rapporte les résultats.
6. `reviewer` applique l’esprit de `code-review` en fin de cycle.

## Contraintes V1

- Aucune modification de code ou de configuration dans cette étape documentaire.
- Aucun nouveau YAML sous `.acp/pipelines/*.yaml`.
- Aucune création ou modification des fichiers `.acp/agents/*.md` dans cette
  étape.
- Aucun `promptFile` de pipeline ne doit pointer directement vers un `SKILL.md`
  brut en V1.
- Les prompts agents enrichis doivent adapter les consignes des skills au rôle
  précis de l’agent ACP.
- Pas d’exécution automatique de skills à effets de bord.
- Les étapes workspace-write restent derrière une approbation humaine.

## Perspective V2 : `/ask-matt` pilote le pipeline

La V2 cible un pipeline dynamique en fonction de `/ask-matt`.

Le comportement attendu :

1. Une première étape `/ask-matt` classe la demande utilisateur.
2. Elle choisit le flow adapté : cadrage, spec, tickets, implémentation, tests,
   review, ou combinaison de ces étapes.
3. Le pipeline sélectionne dynamiquement les agents et étapes nécessaires.
4. Les agents exécutés sont ceux enrichis par la V1.
5. Toute étape workspace-write reste précédée d’un `PlanApprovalGate`.

La V2 ne doit pas seulement “appeler ask-matt” : elle doit rendre son choix
auditable. La sortie de `/ask-matt` doit expliquer le flow choisi, les étapes
ignorées, et le prochain point d’approbation humaine.

## Relation avec les concepts ACP

- `Pipeline` : en V1, orchestre toujours les agents existants ; en V2, peut être
  construit ou sélectionné dynamiquement après la décision de `/ask-matt`.
- `VirtualAgent` : reste le point d’entrée visible côté utilisateur pour un flow
  pipeline ; en V2, `/ask-matt` peut devenir le routeur initial du flow.
- `PipelineStep` : correspond à une étape qui invoque un agent enrichi par les
  skills adaptés à son rôle, ou à une étape choisie dynamiquement en V2.
- `PlanApprovalGate` : matérialise la frontière entre planification et
  exécution.
- `EphemeralRun` : reste une option future pour exécuter ponctuellement une étape
  spécialisée sans session longue durée.

## Critère de succès

La V1 est réussie si un lecteur comprend quels skills Matt doivent enrichir
chaque agent existant. La perspective V2 est claire si le lecteur comprend que
`/ask-matt` devient alors le routeur d’un pipeline dynamique, sans supprimer les
approbations humaines.
