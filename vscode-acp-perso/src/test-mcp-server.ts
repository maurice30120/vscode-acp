import { createInterface } from "node:readline";

// Simple ND-JSON echo server for testing MCP stdio transport.
// Reads JSON lines from stdin and echoes back a response.

const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: false });

rl.on("line", (line) => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch (e) {
    console.log(JSON.stringify({ error: "invalid json", raw: line }));
    return;
  }

  // echo with an ack
  const out = {
    ack: true,
    received: parsed,
    timestamp: new Date().toISOString(),
  };
  try {
    // console.log may throw EPIPE if stdout is closed by the parent; ignore that.
    console.log(JSON.stringify(out));
  } catch (err: any) {
    if (err && err.code === 'EPIPE') {
      // parent closed read end — exit quietly
      process.exit(0);
    } else {
      // rethrow unknown errors
      throw err;
    }
  }
});

// Ignore EPIPE errors on stdout to prevent uncaught exceptions when parent closes pipe
process.stdout.on('error', (err: any) => {
  if (err && err.code === 'EPIPE') {
    process.exit(0);
  }
  // otherwise let it bubble (or log)
});

rl.on('close', () => process.exit(0));
