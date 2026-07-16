import * as assert from 'assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { loadSandcastleEnv, parseDotEnv } from '../../sandcastle/SandcastleEnv';

suite('SandcastleEnv', () => {
  test('parseDotEnv supports comments quotes and export prefixes', () => {
    assert.deepStrictEqual(parseDotEnv(`
      # comment
      export OPENCODE_API_KEY="sk-opencode"
      OPENAI_API_KEY='sk-openai'
      INVALID-NAME=ignored
    `), {
      OPENCODE_API_KEY: 'sk-opencode',
      OPENAI_API_KEY: 'sk-openai',
    });
  });

  test('loadSandcastleEnv reads workspace .sandcastle env', () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'sandcastle-env-'));
    try {
      fs.mkdirSync(path.join(workspace, '.sandcastle'), { recursive: true });
      fs.writeFileSync(path.join(workspace, '.sandcastle', '.env'), 'OPENCODE_API_KEY=sk-opencode\n', 'utf8');

      assert.deepStrictEqual(loadSandcastleEnv(workspace), {
        OPENCODE_API_KEY: 'sk-opencode',
      });
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });
});
