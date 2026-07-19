# ADR proposé 2 — Capacités d’étape exécutoires au seam ACP

**Statut** : Proposé

## Contexte

`sideEffects: none` est aujourd’hui exécuté pour Sandcastle par rejet du worktree, mais pas pour un agent natif. `permissions: allowAll` peut auto-approuver une écriture ou un terminal, même si la primitive est documentée read-only.

Une intention de prompt n’est pas une garantie de sécurité.

## Décision

- Introduire une politique d’exécution dérivée de la primitive et du transport.
- Appliquer la politique lors de la construction du client ACP.
- En natif read-only : désactiver `writeTextFile` et le terminal, puis refuser défensivement les appels interdits.
- En Sandcastle read-only : autoriser les outils dans l’isolation puis rejeter les changements.
- En Sandcastle workspace : utiliser preview et promotion.
- `permissionMode` ne peut jamais étendre les capacités accordées.
- Refuser les combinaisons que l’adapter ne peut pas garantir.

## Conséquences positives

- `sideEffects` devient une garantie testable ;
- sécurité cohérente entre prompts, handlers et transport ;
- les étapes read-only ne dépendent plus du bon comportement du modèle ;
- policies extensibles vers réseau et chemins.

## Conséquences négatives

- un agent natif strictement read-only perd l’accès terminal ;
- les reviewers nécessitant shell doivent utiliser Sandcastle ou des outils de lecture dédiés ;
- modifications dans les deux stacks de connexion.

## Alternatives rejetées

- Utiliser seulement `permissions: ask` : réduit le risque mais reste dépendant de l’utilisateur.
- Classifier les commandes terminal read-only par regex : non fiable et contournable.
- Vérifier le git diff après un run natif : détecte tardivement et ne couvre pas tous les effets externes.
