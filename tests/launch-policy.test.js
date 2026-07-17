'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeExecutionMode,
  buildClaudePermissionArg,
  buildCodexPermissionArgs,
  buildGeminiPermissionArgs,
  codexConfigPolicy,
} = require('../core/agent-launch-policy.js');

test('execution mode defaults to safe and only accepts explicit dangerous opt-in', () => {
  assert.equal(normalizeExecutionMode(), 'safe');
  assert.equal(normalizeExecutionMode('unknown'), 'safe');
  assert.equal(normalizeExecutionMode('dangerous'), 'dangerous');
});

test('safe launch policy never bypasses approval or sandbox boundaries', () => {
  assert.equal(buildClaudePermissionArg('safe'), '--permission-mode acceptEdits');
  assert.equal(buildGeminiPermissionArgs('safe'), '--approval-mode auto_edit');
  assert.equal(buildCodexPermissionArgs('safe'), '--full-auto');

  const combined = [
    buildClaudePermissionArg('safe'),
    buildGeminiPermissionArgs('safe'),
    buildCodexPermissionArgs('safe'),
    JSON.stringify(codexConfigPolicy('safe')),
  ].join(' ');
  assert.doesNotMatch(combined, /bypassPermissions|dangerously-bypass|danger-full-access|approval_policy[^\n]*never|yolo/i);
});

test('dangerous launch policy is available only as an explicit mode', () => {
  assert.match(buildClaudePermissionArg('dangerous'), /bypassPermissions/);
  assert.match(buildGeminiPermissionArgs('dangerous'), /yolo/);
  assert.match(buildCodexPermissionArgs('dangerous'), /dangerously-bypass-approvals-and-sandbox/);
  assert.deepEqual(codexConfigPolicy('dangerous'), {
    approvalPolicy: 'never',
    sandboxMode: 'danger-full-access',
  });
});
