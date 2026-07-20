# 02 — Exécuter un pipeline linéaire via le nouveau PipelineRuntime

**What to build:** Permettre à Pi, VS Code ou un test d’intégration de démarrer un pipeline v3 linéaire à travers une Interface publique unique et de recevoir un résultat terminal discriminé, sans interpréter d’événement latéral.

**Blocked by:** 01 — Compiler la DSL v3 en programme DAG immuable.

**Status:** ready-for-agent

- [ ] L’Interface publique expose uniquement les commandes démarrer, reprendre, annuler et inspecter.
- [ ] Le démarrage d’un DAG linéaire sans pause retourne un résultat `completed` contenant l’artefact final et un snapshot stable.
- [ ] Les détails LangGraph, checkpointer, interrupts et identifiants internes ne traversent pas le Seam public.
- [ ] Les événements restent disponibles pour le streaming et la télémétrie mais ne sont jamais nécessaires pour déterminer l’état terminal.
- [ ] Une erreur métier attendue retourne un résultat `failed` structuré ; les exceptions sont réservées aux défauts inattendus.
- [ ] Les anciennes opérations orientées plan ne font pas partie de la nouvelle Interface.
