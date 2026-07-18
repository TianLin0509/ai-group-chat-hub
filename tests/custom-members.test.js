'use strict';
// v1.1.0: custom command members — unit coverage for the pure helpers.
const test = require('node:test');
const assert = require('node:assert');

const { isCustomKind, customIdFromKind, logoNameForKind } = require('../core/ai-kinds.js');
const { findUnavailableKinds } = require('../core/provider-readiness.js');

test('isCustomKind / customIdFromKind parse the custom:<id> shape', () => {
  assert.equal(isCustomKind('custom:echo1'), true);
  assert.equal(isCustomKind('claude'), false);
  assert.equal(isCustomKind(null), false);
  assert.equal(customIdFromKind('custom:echo1'), 'echo1');
  assert.equal(customIdFromKind('claude'), null);
});

test('logoNameForKind falls back to the terminal icon for custom/unknown kinds', () => {
  assert.equal(logoNameForKind('claude'), 'claude');
  assert.equal(logoNameForKind('claude-resume'), 'claude');
  assert.equal(logoNameForKind('custom:x1'), 'powershell');
  assert.equal(logoNameForKind('mystery'), 'powershell');
});

test('findUnavailableKinds passes saved custom members and blocks unknown ids', () => {
  const readiness = { claude: true, codex: false, gemini: false, deepseek: false };
  const customMembers = [{ id: 'echo1', name: 'Echo', command: 'echo hi' }];
  const slots = [
    { kind: 'claude' },
    { kind: 'custom:echo1' },   // saved -> allowed
    { kind: 'custom:ghost' },   // not in config -> blocked
    { kind: 'codex' },          // not ready -> blocked
  ];
  const unavailable = findUnavailableKinds(slots, readiness, { customMembers });
  assert.deepEqual(unavailable, ['custom:ghost', 'codex']);
});

test('findUnavailableKinds without opts keeps legacy behavior (custom blocked)', () => {
  const readiness = { claude: true, codex: true, gemini: true, deepseek: true };
  const unavailable = findUnavailableKinds([{ kind: 'custom:echo1' }], readiness);
  assert.deepEqual(unavailable, ['custom:echo1']);
});

test('normalizeCustomMembers sanitizes ids, lengths and duplicates', () => {
  // hub-config keeps the normalizer private — exercise it through getConfig()
  // by pointing CLAUDE_HUB_DATA_DIR at a fixture-written config.json.
  const fs = require('node:fs');
  const path = require('node:path');
  const os = require('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-cm-'));
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
    custom_members: [
      { id: 'ok-1', name: 'Echo', command: 'echo hi' },
      { id: 'ok-1', name: 'Dup', command: 'x' },              // duplicate id -> dropped
      { id: 'bad id!', name: 'Bad', command: 'x' },           // invalid slug -> dropped
      { id: 'noname', name: '  ', command: 'x' },             // empty name -> dropped
      { id: 'nocmd', name: 'NoCmd', command: '' },            // empty command -> dropped
    ],
  }), 'utf8');
  const prev = process.env.CLAUDE_HUB_DATA_DIR;
  process.env.CLAUDE_HUB_DATA_DIR = dir;
  try {
    delete require.cache[require.resolve('../core/hub-config.js')];
    delete require.cache[require.resolve('../core/data-dir.js')];
    const { getConfig } = require('../core/hub-config.js');
    const members = getConfig().customMembers;
    assert.equal(members.length, 1);
    assert.deepEqual(members[0], { id: 'ok-1', name: 'Echo', command: 'echo hi' });
  } finally {
    if (prev === undefined) delete process.env.CLAUDE_HUB_DATA_DIR;
    else process.env.CLAUDE_HUB_DATA_DIR = prev;
    delete require.cache[require.resolve('../core/hub-config.js')];
    delete require.cache[require.resolve('../core/data-dir.js')];
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
