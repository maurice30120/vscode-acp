# ADR 0001: Etat actuel de la strategie modules

- Statut: Accepte
- Date: 2026-05-19

## Contexte

Le projet est en transition entre un code source TypeScript moderne oriente Node 16 et un runtime d'extension VS Code encore bundle en CommonJS.

Etat verifie a la date de cet ADR:

- [tsconfig.json](/Users/dhuyet/Documents/POC/vscode-acp-perso/tsconfig.json) utilise `"module": "node16"` et `"moduleResolution": "node16"`.
- [webpack.config.js](/Users/dhuyet/Documents/POC/vscode-acp-perso/webpack.config.js) reste en configuration CommonJS avec `require(...)` et `module.exports`.
- [webpack.config.js](/Users/dhuyet/Documents/POC/vscode-acp-perso/webpack.config.js#L13) emet toujours le bundle principal en `commonjs2`.
- [package.json](/Users/dhuyet/Documents/POC/vscode-acp-perso/package.json) ne declare pas `"type": "module"`.
- [src/core/SessionManager.ts](/Users/dhuyet/Documents/POC/vscode-acp-perso/src/core/SessionManager.ts) contient encore un chargement optionnel via `require(...)` pour `ResearchSubagent`.
- [src/extension.ts](/Users/dhuyet/Documents/POC/vscode-acp-perso/src/extension.ts) contient encore un chargement optionnel via `require(...)` pour `ResearchSubagentTool`.
- [src/subagents/ResearchSubagent.ts](/Users/dhuyet/Documents/POC/vscode-acp-perso/src/subagents/ResearchSubagent.ts#L33) utilise encore `__dirname` pour resoudre `research_mcp.js`.

Le build a ete revalide dans cet etat avec `npm run compile-tests` et `npm run compile` apres alignement TypeScript. Le projet compile, mais il n'est pas encore en ESM pur.

## Decision

Nous documentons explicitement que l'etat courant est hybride:

- le code TypeScript evolue vers la resolution moderne `node16`;
- le runtime d'extension et la couche de tooling restent majoritairement CommonJS;
- la migration vers un ESM integral n'est pas consideree comme un patch local, mais comme un changement transverse de repo.

En consequence, tant que la migration complete n'est pas planifiee, les usages restants de CommonJS sont toleres quand ils evitent une regression de build ou de chargement dans l'extension host.

## Consequences

Avantages:

- compatibilite immediate avec le host VS Code et le bundle webpack actuel;
- support des imports modernes cote TypeScript et du SDK ACP ESM via `resolution-mode` et imports dynamiques cibles;
- migration incrementalement faisable sans bloquer le developpement fonctionnel.

Inconvenients:

- le repo n'est pas conceptuellement uniforme;
- `require(...)`, `__dirname` et la sortie `commonjs2` restent des points de dette technique;
- une bascule ESM complete demandera des changements coordonnes sur les imports relatifs, les configs Node, le packaging webpack et la validation runtime VS Code.

## Conditions pour passer en ESM complet

La migration complete devra au minimum inclure:

- ajout de `"type": "module"` dans [package.json](/Users/dhuyet/Documents/POC/vscode-acp-perso/package.json);
- conversion ou isolation des fichiers de config Node encore en CommonJS, notamment [webpack.config.js](/Users/dhuyet/Documents/POC/vscode-acp-perso/webpack.config.js);
- remplacement des derniers `require(...)` par `import()` ou imports statiques compatibles bundler;
- remplacement de `__dirname` par une resolution basee sur `import.meta.url` la ou le runtime est effectivement ESM;
- verification de tous les imports relatifs requis par `node16` ou `nodenext`;
- revalidation par `npm run compile-tests`, `npm run compile` et idealement `npm test`.

## Statut de reference

Jusqu'a nouvelle decision, cet ADR decrit l'etat courant de reference: TypeScript moderne, runtime d'extension encore partiellement CommonJS.