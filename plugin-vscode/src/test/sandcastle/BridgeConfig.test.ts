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
      maxIterations: 1,
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
    assert.strictEqual(config.maxIterations, 5);
  });

  test('parses explicit max iterations', () => {
    const config = parseBridgeConfig(
      ['--provider', 'pi', '--model', 'opencode-go/kimi-k2.6', '--max-iterations', '7'],
      {},
    );

    assert.strictEqual(config.maxIterations, 7);
  });

  test('rejects invalid max iterations', () => {
    for (const value of ['0', '21', '1.5', 'abc']) {
      assert.throws(
        () => parseBridgeConfig(['--provider', 'pi', '--model', 'x', '--max-iterations', value], {}),
        /max-iterations/,
      );
    }
  });

  test('rejects unsupported providers', () => {
    assert.throws(
      () => parseBridgeConfig(['--provider', 'other', '--model', 'x'], {}),
      /provider codex\|cursor\|pi/,
    );
  });
});
