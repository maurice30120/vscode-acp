import * as assert from 'assert';

import { buildSpawnCommandSpec, resolveUnixShell, shellEscape } from '../utils/ShellSpawn';

suite('ShellSpawn', () => {
  test('uses the user login shell on Unix when supported', () => {
    const spec = buildSpawnCommandSpec('npx', ['@scope/tool', '--acp'], {
      platform: 'darwin',
      userShell: '/bin/zsh',
    });

    assert.strictEqual(spec.file, '/bin/zsh');
    assert.deepStrictEqual(spec.args, ['-l', '-c', "'npx' '@scope/tool' '--acp'"]);
    assert.strictEqual(spec.shell, undefined);
    assert.strictEqual(spec.shellName, 'zsh');
    assert.strictEqual(spec.useLoginFlag, true);
  });

  test('falls back to bash for unsupported Unix shells', () => {
    const unsupportedShells: string[] = [];
    const resolved = resolveUnixShell({
      userShell: '/bin/tcsh',
      pathExists: (path) => path === '/usr/bin/bash',
      onUnsupportedShell: (userShell) => unsupportedShells.push(userShell),
    });

    assert.deepStrictEqual(resolved, {
      shell: '/usr/bin/bash',
      useLoginFlag: true,
    });
    assert.deepStrictEqual(unsupportedShells, ['/bin/tcsh']);
  });

  test('keeps Windows shell spawning for batch-script resolution', () => {
    const spec = buildSpawnCommandSpec('npx', ['tool'], {
      platform: 'win32',
    });

    assert.strictEqual(spec.file, 'npx');
    assert.deepStrictEqual(spec.args, ['tool']);
    assert.strictEqual(spec.shell, true);
  });

  test('escapes embedded single quotes for shell execution', () => {
    assert.strictEqual(shellEscape("it's"), "'it'\\''s'");
  });

  test('rejects empty commands', () => {
    assert.throws(
      () => buildSpawnCommandSpec('   ', []),
      /Command must be a non-empty string/,
    );
  });
});
