'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { stripHubHookEntries } = require('../core/claude-hook-settings.js');

test('disabling Hub hooks removes only Hub-owned commands', () => {
  const input = {
    permissionMode: 'default',
    hooks: {
      Stop: [{ matcher: '', hooks: [
        { type: 'command', command: 'python "C:/Users/me/.claude/scripts/session-hub-hook.py" stop' },
        { type: 'command', command: 'echo keep-me' },
      ] }],
      UserPromptSubmit: [{ matcher: '', hooks: [
        { type: 'command', command: 'python "C:/Users/me/.claude/scripts/session-hub-hook.py" prompt' },
      ] }],
    },
  };
  const result = stripHubHookEntries(input);
  assert.equal(result.changed, true);
  assert.equal(result.settings.permissionMode, 'default');
  assert.deepEqual(result.settings.hooks.Stop[0].hooks, [{ type: 'command', command: 'echo keep-me' }]);
  assert.deepEqual(result.settings.hooks.UserPromptSubmit, []);
});

test('hook cleanup is idempotent when no Hub command exists', () => {
  const result = stripHubHookEntries({ hooks: { Stop: [] } });
  assert.equal(result.changed, false);
  assert.deepEqual(result.settings.hooks.Stop, []);
});
