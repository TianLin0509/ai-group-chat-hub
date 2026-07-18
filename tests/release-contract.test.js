'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const pkg = require('../package.json');

test('npm test points at the maintained Node test runner', () => {
  assert.equal(pkg.scripts.test, 'node --test');
  assert.ok(fs.existsSync(path.join(repoRoot, 'tests')));
});

test('documented runtime floor covers package engine requirements', () => {
  assert.equal(pkg.engines.node, '>=20');
});

test('package and lockfile versions describe the same patch release', () => {
  const lock = require('../package-lock.json');
  assert.equal(pkg.version, '1.1.0');
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[''].version, pkg.version);
  assert.equal(lock.packages[''].engines.node, '>=20');
});

test('launcher version is read from package metadata instead of hardcoded HTML', () => {
  const html = fs.readFileSync(path.join(repoRoot, 'renderer', 'index.html'), 'utf8');
  const renderer = fs.readFileSync(path.join(repoRoot, 'renderer', 'renderer.js'), 'utf8');
  assert.doesNotMatch(html, /launcher-version[^>]*>v\d/);
  assert.match(renderer, /require\('\.\.\/package\.json'\)\.version/);
});

test('public runtime no longer enables CDP or dangerous agent flags implicitly', () => {
  const main = fs.readFileSync(path.join(repoRoot, 'main.js'), 'utf8');
  const sessions = fs.readFileSync(path.join(repoRoot, 'core', 'session-manager.js'), 'utf8');
  assert.match(main, /CLAUDE_HUB_ENABLE_CDP === '1'/);
  assert.doesNotMatch(main, /CLAUDE_HUB_NO_CDP !== '1'/);
  assert.doesNotMatch(sessions, /codex --dangerously-bypass-approvals-and-sandbox/);
  assert.doesNotMatch(sessions, /gemini --approval-mode yolo/);
  assert.doesNotMatch(sessions, /CLAUDE_HUB_NO_EFFORT_MAX/);
});

test('installation docs consistently require Node 20 or newer', () => {
  for (const file of ['README.md', 'INSTALL.md', 'AGENTS.md']) {
    const content = fs.readFileSync(path.join(repoRoot, file), 'utf8');
    assert.doesNotMatch(content, /Node(?:\.js)?\s*18|v18\+/i, file);
  }
});
