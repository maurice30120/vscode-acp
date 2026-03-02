import { spawn } from "child_process";
import { Readable, Writable } from "node:stream";
import {
  ndJsonStream,
  ClientSideConnection,
  PROTOCOL_VERSION,
  type Client,
} from "@agentclientprotocol/sdk";

async function run() {
  // spawn the agent (tsx will run TypeScript file)
  const proc = spawn("npx", ["tsx", "src/index.ts"], {
    cwd: process.cwd(),
    stdio: ["pipe", "pipe", "inherit"],
  });

  const stream = ndJsonStream(
    Writable.toWeb(proc.stdin),
    Readable.toWeb(proc.stdout),
  );

  const client: Client = {
    async sessionUpdate(params) {
      // Log session updates (message chunks...) to stdout
      // Pretty-print minimal info
      try {
        const json = JSON.stringify(params, null, 2);
        console.log("[test-client] sessionUpdate:\n", json);
      } catch (e) {
        console.log("[test-client] sessionUpdate (err)", String(e));
      }
    },
    // minimal implementations for optional methods
    async requestPermission() {
      return { outcome: "granted" } as any;
    },
  };

  const connection = new ClientSideConnection(() => client, stream);

  connection.signal.addEventListener("abort", () => {
    console.log("[test-client] connection closed");
  });

  try {
    // initialize (include protocolVersion)
    await connection.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientInfo: { name: "test-client", version: "0.0.1" } as any,
      clientCapabilities: {},
    } as any);

    const newSession = await connection.newSession({
      cwd: process.cwd(),
      mcpServers: [
        {
          type: "stdio",
          name: "test-mcp",
          command: "npx",
          args: ["tsx", "src/test-mcp-server.ts"],
          env: [],
        },
      ],
    } as any);
    console.log("[test-client] newSession ->", newSession.sessionId);

    // send a prompt and await response
    const promptResponse = await connection.prompt({
      sessionId: newSession.sessionId,
      prompt: [{ type: "text", text: "Bonjour depuis le client de test" } as any],
    } as any);

    console.log("[test-client] prompt response ->", promptResponse);

  } catch (error) {
    console.error("[test-client] error", error);
  } finally {
    // ensure child process is killed
    try {
      proc.kill();
    } catch {}
  }
}

void run();
