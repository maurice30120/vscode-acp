# ADR-0005 : Pipeline avec approbation humaine

**Statut** : Acceptée

## Contexte

Le plugin Pi orchestre plusieurs agents ACP externes pour des workflows comme planifier, implémenter puis vérifier. Une étape qui modifie le workspace ne doit pas démarrer uniquement parce qu'un planner a produit du texte : l'utilisateur doit pouvoir relire le plan avant les effets de bord.

Le plugin Pi applique ce workflow via `@acp-client/pipeline`, `/pipeline` et `EphemeralAcpRunner`, sans créer de sessions utilisateur persistantes pour les agents internes.

## Décision

Les pipelines Pi peuvent insérer une étape `type: approval` entre une primitive de planning et une primitive à `sideEffects: workspace`.

Le planner produit un `output: proposed_plan`. `PipelineController` expose le plan à l'hôte Pi et attend `/pipeline approve` ou `/pipeline reject`. L'implémentation ne démarre qu'après approbation, et le plan approuvé est transmis aux étapes suivantes via les templates `{{steps.<id>.output}}`.

Chaque primitive est exécutée comme run ACP éphémère : spawn de l'agent configuré, `newSession`, `prompt`, collecte des chunks texte, puis dispose de la connexion et du processus.

## Conséquences

- Les workflows destructifs restent relisibles avant modification du workspace.
- Les agents internes du pipeline ne deviennent pas des sessions utilisateur persistantes.
- Les permissions fichier, terminal et authentification restent gouvernées par les handlers ACP du plugin Pi.
- Un pipeline sans étape d'approbation reste possible pour les workflows sans effet workspace ou explicitement directs.
