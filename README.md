# ACP Client for VS Code

A [Visual Studio Code extension](https://marketplace.visualstudio.com/items?itemName=formulahendry.acp-client) that provides a client for the [Agent Client Protocol (ACP)](https://agentclientprotocol.com/) — connect to any ACP-compatible AI coding agent directly from your editor.

![ACP Client Screenshot](resources/screenshot.png)

## Features

- **Multi-Agent Support**: Connect to 9 pre-configured ACP agents or add your own
- **Single-Agent Focus**: One agent active at a time — seamlessly switch between agents
- **Interactive Chat**: Built-in chat panel with Markdown rendering, inline tool call display, and collapsible tool sections
- **Thinking Display**: See agent reasoning in a collapsible block with streaming animation and elapsed time
- **Slash Commands**: Autocomplete popup for agent-provided commands with keyboard navigation
- **Mode & Model Picker**: Switch agent modes and models directly from the chat toolbar
- **File System Integration**: Agents can read and write files in your workspace
- **Terminal Execution**: Agents can run commands with terminal output display
- **Permission Management**: Configurable auto-approve policies for agent actions
- **Protocol Traffic Logging**: Inspect all ACP JSON-RPC messages with request/response/notification labels
- **Agent Registry**: Browse and discover available ACP agents
- **Chat Persistence**: Conversations are preserved when switching panels

## Quick Start

1. Install: [Visual Studio Code Marketplace](https://marketplace.visualstudio.com/items?itemName=formulahendry.acp-client) | [Open in VS Code](https://vscode.dev/redirect?url=vscode%3Aextension%2Fformulahendry.acp-client) | [Open VSX Marketplace](https://open-vsx.org/extension/formulahendry/acp-client)
2. Open the ACP Client panel from the Activity Bar (ACP icon)
3. Click **+** to add an agent configuration, or use the defaults
4. Click an agent to connect
5. Start chatting!

## Requirements

- Node.js 18+ (for spawning agent processes)
- An ACP-compatible agent installed or available via `npx`
- Docker is optional, but required when using `acp.docker.*` to run agents inside an existing container

## Pre-configured Agents

The extension comes with default configurations for:

| Agent | Command |
|-------|---------|
| GitHub Copilot | `npx @github/copilot-language-server@latest --acp` |
| Claude Code | `npx @zed-industries/claude-code-acp@latest` |
| Gemini CLI | `npx @google/gemini-cli@latest --experimental-acp` |
| Qwen Code | `npx @qwen-code/qwen-code@latest --acp --experimental-skills` |
| Auggie CLI | `npx @augmentcode/auggie@latest --acp` |
| Qoder CLI | `npx @qoder-ai/qodercli@latest --acp` |
| Codex CLI | `npx @zed-industries/codex-acp@latest` |
| OpenCode | `npx opencode-ai@latest acp` |
| OpenClaw | `npx openclaw acp` |
| Pi | `npx -y pi-acp` |

You can add custom agent configurations in settings.

## Extension Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `acp.agents` | *(pre-configured agents)* | Agent configurations. Each entry maps an agent name to its `command`, `args`, and `env`. |
| `acp.autoApprovePermissions` | `ask` | How agent permission requests are handled: `ask` or `allowAll`. |
| `acp.defaultWorkingDirectory` | `""` | Default working directory for agent sessions. Empty uses current workspace. In Docker mode, this path must exist inside the container at the same absolute location. |
| `acp.docker.enabled` | `false` | Run ACP agents and ACP terminal commands inside an existing Docker container via `docker exec`. |
| `acp.docker.container` | `""` | Docker container name or ID used when Docker mode is enabled. |
| `acp.subAgents.researchAgentName` | `""` | Agent name from `acp.agents` used by the hidden `call_research_subagent` MCP tool. Leave empty to expose the tool in error mode until configured. |
| `acp.logTraffic` | `true` | Log all ACP protocol traffic to the ACP Traffic output channel. |

## Research Sub-Agent Tool

The extension can expose a single MCP tool named `call_research_subagent` to the connected parent agent.

- The tool is injected through `mcpServers` during session creation
- The tool implementation launches a hidden ACP agent, asks it to perform a stateless research task, and returns the resulting summary as a tool result
- Configure the hidden backend by setting `acp.subAgents.researchAgentName` to one of your configured `acp.agents`
- The hidden research agent runs in read-only mode from the client's perspective: file reads are allowed, file writes and terminal access are denied

## Docker Execution

The extension can run ACP agents and ACP terminal commands inside an existing Docker container.

- The extension does not create or start containers for you
- `acp.docker.enabled` must be `true`
- `acp.docker.container` must point to a running container
- Your workspace, or `acp.defaultWorkingDirectory`, must be mounted inside that container at the same absolute path as on the host
- File reads and writes still happen through VS Code on the host filesystem in this first version

When Docker mode is enabled, the extension validates that:

- the Docker CLI is available
- the configured container is running
- the resolved working directory exists inside the container

### Docker Compose Example

Start the agent container with Docker Compose:

```bash
docker compose up -d
```

The tracked [`docker-compose.yml`](/Users/dhuyet/Documents/POC/vscode-acp-perso/docker-compose.yml) is configured to:

- build the local `Dockerfile`
- keep the container alive with `sleep infinity`
- mount the workspace at the same absolute path as the host
- preinstall the default ACP agent CLIs for GitHub Copilot, Claude Code, Gemini, Codex, OpenCode, Pi, and Mistral Vibe
- persist Codex auth from `${HOME}/.codex` to `/root/.codex`
- persist Gemini auth/settings from `${HOME}/.gemini` to `/root/.gemini`
- persist Claude local state from `${HOME}/.claude` to `/root/.claude`
- persist Pi local state from `${HOME}/.pi` to `/root/.pi`
- persist OpenCode local state from `${HOME}/.config/opencode` and `${HOME}/.opencode`
- expose API key env vars for Mistral/Claude/Codex/Gemini/OpenCode

Set your real secrets in your shell or a local `.env` file before starting the container.

### Auth Persistence By CLI

Use the same pattern as Codex for each CLI: mount its local auth/config folder into the container and provide required API key env vars.

| CLI | Preferred auth persistence in container |
|-----|-----------------------------------------|
| GitHub Copilot | best effort mount `${HOME}/.config/github-copilot` -> `/root/.config/github-copilot` |
| Claude Code | `ANTHROPIC_API_KEY` + optional `${HOME}/.claude` -> `/root/.claude` |
| Gemini CLI | `${HOME}/.gemini` -> `/root/.gemini` + `GEMINI_API_KEY` or Google env vars |
| Mistral Vibe | `MISTRAL_API_KEY` env var |
| Codex CLI | `${HOME}/.codex` -> `/root/.codex` + optional `OPENAI_API_KEY` / `CODEX_API_KEY` |
| Pi | `${HOME}/.pi` -> `/root/.pi` |
| OpenCode | `OPENCODE_API_KEY` + `${HOME}/.config/opencode` -> `/root/.config/opencode` |

Stop the container with:

```bash
docker compose down
```

## Commands

All commands are accessible via the Command Palette (`Ctrl+Shift+P`):

| Command | Description |
|---------|-------------|
| `ACP: Connect to Agent` | Connect to an agent |
| `ACP: New Conversation` | Start a new conversation with the connected agent |
| `ACP: Send Prompt` | Send a message to the agent |
| `ACP: Cancel Current Turn` | Cancel the current agent turn |
| `ACP: Disconnect Agent` | Disconnect from the current agent |
| `ACP: Restart Agent` | Restart the current agent process |
| `ACP: Open Chat Panel` | Focus the chat webview |
| `ACP: Add Agent Configuration` | Add a new agent to settings |
| `ACP: Remove Agent` | Remove an agent configuration |
| `ACP: Set Agent Mode` | Change the agent's operating mode |
| `ACP: Set Agent Model` | Change the agent's model |
| `ACP: Show Log` | Open the ACP Client log output channel |
| `ACP: Show Protocol Traffic` | Open the ACP Traffic output channel |
| `ACP: Browse Agent Registry` | Browse the ACP agent registry |

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+A` (`Cmd+Shift+A` on Mac) | Open Chat Panel |
| `Escape` (when turn in progress) | Cancel Current Turn |

## Development

### Prerequisites

- Node.js 18+
- VS Code 1.85+

### Setup

```bash
git clone https://github.com/formulahendry/vscode-acp.git
cd vscode-acp
npm install
```

### Build & Run

```bash
npm run compile    # Build the webview (Vite) and extension host (tsup)
npm run watch      # Watch the webview and extension host together
```

Press `F5` in VS Code to launch the Extension Development Host.

### Testing

```bash
npm run pretest    # Compile tests + lint
npm test           # Run tests
```

### Packaging

```bash
npm run package    # Production build
npx @vscode/vsce package   # Create .vsix
```

## Architecture

The extension follows a modular architecture:

- **Core**: `AgentManager`, `ConnectionManager`, `SessionManager`, `AcpClientImpl`
- **Handlers**: `FileSystemHandler`, `TerminalHandler`, `PermissionHandler`, `SessionUpdateHandler`
- **UI**: `SessionTreeProvider`, `ChatWebviewProvider`, `StatusBarManager`
- **Webview v2 Scaffold**: React + Vite app under `webview/`, emitted into `resources/webview/dist`
- **Config**: `AgentConfig`, `RegistryClient`
- **Utils**: `Logger`, `StreamAdapter`

Communication with agents uses the ACP protocol (JSON-RPC 2.0 over stdio).

### Architecture Diagram

```mermaid
graph LR
  subgraph VSCodeExt["VS Code Extension\n(Extension Host)"]
    AM[AgentManager]
    CM[ConnectionManager]
    SM[SessionManager]
    AC[AcpClientImpl]
    HANDLERS["Handlers\n(FileSystem, Terminal, Permission, SessionUpdate)"]
    UI["UI\n(SessionTreeProvider, ChatWebviewProvider, StatusBar)"]
    TOOL["ResearchSubagentTool\n(Language Model Tool)"]
  end

  subgraph WebviewUI["Webview UI\n(React + Vite)"]
    WV[Webview]
  end

  ResearchMCP["Research MCP\n(src/subagents/research_mcp.js)"]
  ACPAgents["ACP Agents\n(Copilot, Claude, Gemini, Codex, OpenCode, Pi, Mistral)"]
  DockerContainer["Optional Docker container\n(acp-agents)"]
  AgentRegistry["Agent Registry CDN\n(cdn.agentclientprotocol.com)"]
  WorkspaceFS["Workspace Filesystem\n(project files)"]
  TelemetrySvc["Telemetry Service\n(@vscode/extension-telemetry)"]
  GitHubCI["GitHub Actions CI\n(build / tests / package)"]

  WV <--> VSCodeExt
  WV -->|postMessage host to extension| VSCodeExt
  VSCodeExt <-->|spawn & ACP JSON-RPC over stdio| ACPAgents
  VSCodeExt -->|spawn when LM tool invoked| ResearchMCP
  ResearchMCP <-->|launch hidden research agent / ACP JSON-RPC| ACPAgents
  VSCodeExt -->|HTTP GET fetchRegistry| AgentRegistry
  VSCodeExt -->|fs read / write via FileSystemHandler| WorkspaceFS
  VSCodeExt -->|docker exec optional| DockerContainer
  VSCodeExt -->|sendEvent telemetry| TelemetrySvc
  GitHubCI -->|build / test / package .vsix| VSCodeExt
```

### Notes & Defaults

- Build artifact: `dist/extension.js` (as referenced by `package.json` -> `main`).
- Docker: optional — if `acp.docker.enabled` is used, mount the workspace at the same absolute path inside the container; use `docker-compose.yml` as an example but provide secrets via a `.env` (do not commit secrets).
- Research sub-agent: set `acp.subAgents.researchAgentName: "<your-research-agent>"` (example: `opencode` or `copilot`).
- API keys: prefer environment variables or a local `.env`; never commit API keys (e.g., `MISTRAL_API_KEY`).
- Packaging: ensure `scripts/copy-research-mcp.mjs` runs during packaging so that `src/subagents/research_mcp.js` is included in the final VSIX.

## Known Issues

- Agents must be available via the system PATH or `npx`
- Some agents may require additional authentication setup
- File attachment feature is not yet functional
- Docker mode is not supported on Windows in this version

## Links

- [ACP Client on Visual Studio Code Marketplace](https://marketplace.visualstudio.com/items?itemName=formulahendry.acp-client)
- [Agent Client Protocol](https://agentclientprotocol.com/)
- [GitHub Repository](https://github.com/formulahendry/vscode-acp)

## License

MIT — see [LICENSE](LICENSE) for details.
