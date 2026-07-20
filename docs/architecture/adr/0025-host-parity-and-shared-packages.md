# ADR-0025 — Parité des surfaces hôtes et packages partagés

**Statut** : Accepté
**Date** : 2026-07-20

La CLI, le plugin Pi et le plugin VS Code doivent offrir au maximum le même comportement d’orchestration. Ils consomment strictement la configuration V3 située à la racine du workspace (`.acp/acp-agents.json`, `.acp/.sandcastle/config.json`, `.acp/pipelines/` et `.acp/agents/`) sans copie, fallback packagé ni format propre à une surface.

Toute logique indépendante de l’interface utilisateur doit être placée dans un package partagé, en priorité `@acp-client/pipeline` pour le runtime et `@acp-client/sandcastle` pour l’isolation. Les surfaces hôtes restent des adapters minces : elles ne peuvent diverger que pour traduire les interactions propres au terminal, à Pi ou à VS Code. Une évolution de configuration ou de runtime n’est complète que lorsqu’un test de parité ou des tests équivalents couvrent les trois surfaces.

Le Pipeline V3 est l’unique format exécutable. Les définitions V2 et les conversions implicites restent rejetées explicitement afin qu’aucun second chemin runtime ne réapparaisse.
