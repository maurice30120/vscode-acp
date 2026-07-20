import assert from 'node:assert/strict';
import { PassThrough, Writable } from 'node:stream';
import test from 'node:test';

import { NodeCliTerminal } from '../src/terminal.js';

class MemoryWritable extends Writable {
  readonly chunks: string[] = [];

  _write(chunk: Buffer | string, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.chunks.push(String(chunk));
    callback();
  }
}

test('cancels pending questions when stdin closes', async () => {
  const input = new PassThrough();
  const output = new MemoryWritable();
  const errors = new MemoryWritable();
  const terminal = new NodeCliTerminal(input, output, errors);

  const answer = terminal.ask('Answer [/done to finish]:');
  input.end();

  await assert.rejects(answer, /Terminal input closed/);
  assert.ok(output.chunks.join('').startsWith('Answer [/done to finish]: '));

  terminal.close();
});
