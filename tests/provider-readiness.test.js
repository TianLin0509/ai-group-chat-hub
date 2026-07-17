'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildProviderReadiness,
  findUnavailableKinds,
} = require('../core/provider-readiness.js');

test('provider readiness combines CLI detection with DeepSeek configuration', () => {
  assert.deepEqual(
    buildProviderReadiness(
      { claude: true, codex: false, gemini: true, python: false },
      { deepseekApiKey: 'configured' },
    ),
    { claude: true, codex: false, gemini: true, deepseek: true },
  );
});

test('DeepSeek also requires the Claude CLI that hosts its API session', () => {
  assert.equal(
    buildProviderReadiness({ claude: false }, { deepseekApiKey: 'configured' }).deepseek,
    false,
  );
});

test('unavailable selection is de-duplicated and unknown kinds fail closed', () => {
  const readiness = { claude: true, codex: false, gemini: false, deepseek: true };
  const unavailable = findUnavailableKinds([
    { kind: 'codex' },
    { kind: 'codex' },
    { kind: 'unknown-provider' },
    { kind: 'claude' },
  ], readiness);
  assert.deepEqual(unavailable, ['codex', 'unknown-provider']);
});
