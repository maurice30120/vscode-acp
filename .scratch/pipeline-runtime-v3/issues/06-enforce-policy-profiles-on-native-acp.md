# 06 — Appliquer les profils de politique sur ACP natif

**What to build:** Garantir qu’un nœud exécuté par l’Adapter ACP natif respecte réellement la politique sélectionnée, indépendamment du prompt ou des demandes d’outil de l’agent.

**Blocked by:** 02 — Exécuter un pipeline linéaire via le nouveau PipelineRuntime.

**Status:** ready-for-agent

- [ ] La DSL v3 permet de définir des profils de politique nommés et d’en sélectionner un au niveau de chaque nœud.
- [ ] Le moteur normalise la politique filesystem, terminal, réseau et promotion avant d’appeler l’Adapter.
- [ ] Les capacités techniques de l’agent ou du transport sont validées séparément des autorisations du nœud.
- [ ] En read-only, les écritures de fichiers et les commandes mutantes sont refusées par les handlers ACP natifs.
- [ ] Une approbation générique d’outil ne peut jamais élargir une politique read-only.
- [ ] Une politique que l’Adapter ne sait pas garantir est refusée avant l’envoi du prompt à l’agent.
- [ ] Les refus sont structurés, journalisés et observables via le résultat du runtime.