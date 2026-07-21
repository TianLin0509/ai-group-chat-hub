'use strict';
// Guards against providers leaking in from upstream ports. This edition ships
// exactly four AI providers; any UI affordance offering another one would let a
// user launch a session kind the backend cannot start.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(repoRoot, p), 'utf8');

const SUPPORTED = ['claude', 'codex', 'gemini', 'deepseek'];
const FOREIGN = ['kimi', 'glm', 'qwen'];

test('ALL_AI_KINDS is exactly the four supported providers', () => {
  const { ALL_AI_KINDS } = require('../core/ai-kinds.js');
  assert.deepEqual([...ALL_AI_KINDS].sort(), [...SUPPORTED].sort());
});

test('command palette only offers session kinds this edition supports', () => {
  const src = read('renderer/keyboard-shortcuts.js');
  const kinds = [...src.matchAll(/invoke\('create-session',\s*'([a-z-]+)'\)/g)].map(m => m[1]);
  assert.ok(kinds.length >= 4, `expected create-session entries, got ${kinds.length}`);
  const allowed = new Set([...SUPPORTED, 'powershell']);
  const bad = kinds.filter(k => !allowed.has(k));
  assert.deepEqual(bad, [], `command palette offers unsupported kinds: ${bad.join(', ')}`);
});

test('no UI affordance references a foreign provider logo asset', () => {
  const logoDir = path.join(repoRoot, 'renderer', 'assets', 'ai-logos');
  const present = fs.readdirSync(logoDir).map(f => f.replace(/\.svg$/, ''));
  for (const foreign of FOREIGN) {
    assert.ok(!present.includes(foreign), `unexpected logo asset: ${foreign}.svg`);
  }
  // CSS must not point at logo files that do not exist.
  for (const cssFile of ['renderer/styles/card-view.css', 'renderer/styles/meeting-room-chat-flow.css']) {
    const css = read(cssFile);
    for (const foreign of FOREIGN) {
      assert.ok(
        !new RegExp(`\\.(logo|ai-name)-${foreign}\\b`).test(css),
        `${cssFile} still styles the removed provider "${foreign}"`,
      );
    }
  }
});
