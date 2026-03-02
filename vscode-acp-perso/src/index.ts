import { randomUUID } from "node:crypto";
import { Readable, Writable } from "node:stream";
import { spawn, type ChildProcess } from "node:child_process";
import {
  AgentSideConnection,
  PROTOCOL_VERSION,
  RequestError,
  ndJsonStream,
  type Agent,
  type AuthenticateRequest,
  type AuthenticateResponse,
  type CancelNotification,
  type ContentBlock,
  type InitializeRequest,
  type InitializeResponse,
  type NewSessionRequest,
  type NewSessionResponse,
  type PromptRequest,
  type PromptResponse,
} from "@agentclientprotocol/sdk";

type SessionState = {
  id: string;
  cwd: string;
  createdAt: string;
  cancelRequested: boolean;
  mcpProcesses?: ChildProcess[];
};

const AGENT_NAME = "acp-perso-minimal";
const AGENT_VERSION = "0.1.0";
const STREAM_CHUNK_SIZE = 100;
const STREAM_DELAY_MS = 35;

class MinimalAcpAgent implements Agent {
  private readonly sessions = new Map<string, SessionState>();

  constructor(private readonly connection: AgentSideConnection) {}

  // Kill any MCP processes when the connection closes
  private setupConnectionCleanup() {
    this.connection.signal.addEventListener("abort", () => {
      for (const session of this.sessions.values()) {
        this.stopMcpProcesses(session);
      }
      log("connection aborted - stopped MCP processes");
    });
  }

  async initialize(_params: InitializeRequest): Promise<InitializeResponse> {
    log("initialize");
    return {
      protocolVersion: PROTOCOL_VERSION,
      agentInfo: {
        name: AGENT_NAME,
        version: AGENT_VERSION,
      },
      agentCapabilities: {},
    };
  }

  async authenticate(
    _params: AuthenticateRequest,
  ): Promise<AuthenticateResponse> {
    log("authenticate");
    return {};
  }

  async newSession(params: NewSessionRequest): Promise<NewSessionResponse> {
    const sessionId = randomUUID();
    const state: SessionState = {
      id: sessionId,
      cwd: params.cwd,
      createdAt: new Date().toISOString(),
      cancelRequested: false,
      mcpProcesses: [],
    };
    this.sessions.set(sessionId, state);
    // Ensure cleanup listener is registered once
    try {
      this.setupConnectionCleanup();
    } catch {}
    log(`newSession: ${sessionId} cwd=${params.cwd}`);

    // If the client requested MCP servers, handle stdio MCP servers
    const mcpServers = (params as any).mcpServers ?? [];
    for (const srv of mcpServers) {
      try {
        // Accept both explicit `{ type: 'stdio' }` and legacy/alternate shapes
        // where a stdio MCP is described by a `command` field.
        const stdioSrv = srv as any;
        const isStdio = stdioSrv?.type === "stdio" || typeof stdioSrv?.command === "string";
        if (isStdio) {
          const cmd = stdioSrv.command;
          const args: string[] = stdioSrv.args ?? [];
          const envObj = envArrayToObject(stdioSrv.env);

          const proc = spawn(cmd, args, {
            env: { ...process.env, ...envObj },
            stdio: ["pipe", "pipe", "inherit"],
          });

          state.mcpProcesses!.push(proc);
          log(`started MCP stdio ${stdioSrv.name} pid=${proc.pid}`);

          proc.on("exit", (code, signal) => {
            log(`mcp ${stdioSrv.name} exited pid=${proc.pid} code=${code} signal=${signal}`);
          });

          proc.stdout.on("data", (chunk) => {
            const text = chunk.toString();
            log(`mcp ${stdioSrv.name} stdout: ${text.replace(/\n/g, "\\n")}`);
          });

          // send a simple ping to the MCP process (newline-delimited JSON)
          try {
            proc.stdin.write(JSON.stringify({ type: "ping", sessionId }) + "\n");
          } catch (e) {
            log(`failed to write ping to mcp ${stdioSrv.name}: ${String(e)}`);
          }
        } else {
          log(`mcp server type ${(srv as any).type} ignored by minimal agent`);
        }
      } catch (e) {
        log(`failed to start/request mcp server: ${String(e)}`);
      }
    }
    return {
      sessionId,
    };
  }

  async prompt(params: PromptRequest): Promise<PromptResponse> {
    const session = this.getSession(params.sessionId);
    session.cancelRequested = false;

    const userText = getPromptText(params.prompt);
    const assistantText = buildAssistantResponse(userText, session.cwd);
    const chunks = splitIntoChunks(assistantText, STREAM_CHUNK_SIZE);

    log(`prompt: session=${session.id} chunks=${chunks.length}`);

    for (const chunk of chunks) {
      if (session.cancelRequested) {
        session.cancelRequested = false;
        log(`prompt cancelled: session=${session.id}`);
        return { stopReason: "cancelled" };
      }

      await this.connection.sessionUpdate({
        sessionId: session.id,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: {
            type: "text",
            text: chunk,
          },
        },
      });

      await sleep(STREAM_DELAY_MS);
    }

    return { stopReason: "end_turn" };
  }

  async cancel(params: CancelNotification): Promise<void> {
    const session = this.sessions.get(params.sessionId);
    if (!session) {
      return;
    }
    session.cancelRequested = true;
    log(`cancel: session=${session.id}`);
    this.stopMcpProcesses(session);
  }

  private getSession(sessionId: string): SessionState {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw RequestError.resourceNotFound(`session:${sessionId}`);
    }
    return session;
  }

  private stopMcpProcesses(session: SessionState) {
    if (!session.mcpProcesses) return;
    for (const p of session.mcpProcesses) {
      try {
        p.kill();
      } catch {}
    }
    session.mcpProcesses = [];
  }
}

function envArrayToObject(env: Array<{ name: string; value: string }> | undefined) {
  const out: Record<string, string> = {};
  if (!env) return out;
  for (const e of env) {
    if (e && typeof e.name === "string") out[e.name] = String(e.value ?? "");
  }
  return out;
}

function getPromptText(prompt: ContentBlock[]): string {
  const blocks = prompt.filter(
    (block): block is Extract<ContentBlock, { type: "text" }> =>
      block.type === "text",
  );

  return blocks
    .map((block) => block.text.trim())
    .filter((text) => text.length > 0)
    .join("\n");
}

function buildAssistantResponse(userText: string, cwd: string): string {
  if (!userText) {
    return [
      "Serveur ACP minimal actif.",
      "Envoie un message texte pour recevoir une reponse.",
      `cwd session: ${cwd}`,
    ].join("\n");
  }

  return [
    "Reponse du serveur ACP minimal:",
    `- cwd session: ${cwd}`,
    `- message recu: ${userText}`,
  ].join("\n");
}

function splitIntoChunks(text: string, size: number): string[] {
  if (text.length <= size) {
    return [text];
  }

  const chunks: string[] = [];
  for (let index = 0; index < text.length; index += size) {
    chunks.push(text.slice(index, index + size));
  }
  return chunks;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function log(message: string): void {
  process.stderr.write(`[${AGENT_NAME}] ${message}\n`);
}

async function main(): Promise<void> {
  const readable = Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>;
  const writable = Writable.toWeb(process.stdout) as WritableStream<Uint8Array>;
  const stream = ndJsonStream(writable, readable);

  const connection = new AgentSideConnection(
    (conn) => new MinimalAcpAgent(conn),
    stream,
  );

  connection.signal.addEventListener("abort", () => {
    log("connection closed");
  });

  process.on("uncaughtException", (error) => {
    log(`uncaughtException: ${error.stack ?? error.message}`);
  });

  process.on("unhandledRejection", (reason) => {
    log(`unhandledRejection: ${String(reason)}`);
  });

  log(`server started (protocol=${PROTOCOL_VERSION})`);
  await connection.closed;
}

void main().catch((error) => {
  log(`fatal: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  process.exitCode = 1;
});
