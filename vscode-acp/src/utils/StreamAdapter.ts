import { Readable, Writable } from 'node:stream';
import type { ChildProcess } from 'node:child_process';

/**
 * Interface de flux ACP : canal bidirectionnel de messages.
 * Le type est re-exporte depuis le SDK pour simplifier l'import.
 */
export interface AcpStream {
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
}

/**
 * Adapte stdin/stdout d'un processus Node.js vers l'API Web Streams
 * requise par `ndJsonStream()` dans le SDK ACP.
 */
export function childProcessToWebStreams(process: ChildProcess): AcpStream {
  if (!process.stdin || !process.stdout) {
    throw new Error('Child process must have stdin and stdout piped');
  }

  const writable = Writable.toWeb(process.stdin) as WritableStream<Uint8Array>;
  const readable = Readable.toWeb(process.stdout) as ReadableStream<Uint8Array>;

  return { readable, writable };
}
