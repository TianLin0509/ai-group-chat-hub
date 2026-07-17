'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildConfigJsonUpdate } = require('../main/ipc/config-handlers.js');

test('a partial integration update preserves every existing provider credential', () => {
  const existing = {
    providers: {
      claude: { backend: 'api', api_key: 'claude-secret', base_url: 'https://claude.example', model: 'custom-claude' },
      deepseek: { api_key: 'deepseek-secret' },
      codex: {
        backend: 'api',
        subscription_profile: 'work',
        subscription_profiles: [{ id: 'work', label: 'Work', home: 'C:/codex-work' }],
        api_key: 'codex-secret',
        base_url: 'https://codex.example',
        model: 'custom-codex',
        provider: 'custom-provider',
      },
    },
  };

  const merged = buildConfigJsonUpdate(existing, { claudeHookIntegration: true });
  assert.equal(merged.integrations.claude_hooks, true);
  assert.equal(merged.providers.claude.api_key, 'claude-secret');
  assert.equal(merged.providers.deepseek.api_key, 'deepseek-secret');
  assert.equal(merged.providers.codex.backend, 'api');
  assert.equal(merged.providers.codex.api_key, 'codex-secret');
  assert.equal(merged.providers.codex.base_url, 'https://codex.example');
  assert.equal(merged.providers.codex.model, 'custom-codex');
  assert.equal(merged.providers.codex.provider, 'custom-provider');
});
