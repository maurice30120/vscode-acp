import * as assert from 'assert';

import { parseBridgeConfig } from '../../sandcastle/BridgeConfig';

suite('BridgeConfig', () => {
  test('parses a Sandcastle provider and model', () => {
    const config = parseBridgeConfig(
      ['--provider', 'codex', '--model', 'gpt-test', '--effort', 'high'],
      { ACP_SANDCASTLE_IMAGE: 'test-image' },
    );
    assert.deepStrictEqual(config, {
      provider: 'codex',
      model: 'gpt-test',
      effort: 'high',
      imageName: 'test-image',
      env: {
        ACP_SANDCASTLE_IMAGE: 'test-image',
      },
    });
  });

  test('accepts Pi provider', () => {
    const config = parseBridgeConfig(
      ['--provider', 'pi', '--model', 'opencode-go/kimi-k2.6', '--effort', 'high'],
      {},
    );

    assert.strictEqual(config.provider, 'pi');
    assert.strictEqual(config.model, 'opencode-go/kimi-k2.6');
    assert.strictEqual(config.effort, 'high');
  });

  test('rejects unsupported providers', () => {
    assert.throws(
      () => parseBridgeConfig(['--provider', 'other', '--model', 'x'], {}),
      /provider codex\|cursor\|pi/,
    );
  });
});
