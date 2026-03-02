# vscode-acp-perso

Serveur ACP minimal (cote agent) pour tester `vscode-acp`.

## Prerequis

- Node.js 18+

## Installation

```bash
npm install
```

## Build

```bash
npm run build
```

## Lancer le serveur ACP

Le serveur communique en `stdio` (NDJSON), donc il est fait pour etre lance par un client ACP.

```bash
npm start
```

## Connecter depuis `vscode-acp`

Dans les settings VS Code (`acp.agents`), ajoute une entree qui pointe vers ce binaire :

```json
{
  "acp.agents": {
    "ACP Perso Minimal": {
      "command": "node",
      "args": ["/Users/dhuyet/Documents/POC/ACP/vscode-acp-perso/dist/index.js"],
      "env": {}
    }
  }
}
```

## Comportement implemente

- `initialize`
- `authenticate` (noop)
- `newSession`
- `prompt` (streaming texte via `session/update`)
- `cancel`
