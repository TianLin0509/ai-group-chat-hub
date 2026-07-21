'use strict';
// User-facing error text must not leak Electron IPC plumbing.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// _cleanIpcError lives inside the modal IIFE; extract and evaluate it in isolation.
function loadCleaner() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'meeting-create-modal.js'), 'utf8');
  const m = src.match(/function _cleanIpcError\(text\) \{[\s\S]*?\n\}/);
  assert.ok(m, '_cleanIpcError not found in meeting-create-modal.js');
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(m[0] + '\nthis.fn = _cleanIpcError;', ctx);
  return ctx.fn;
}

test('_cleanIpcError strips the Electron remote-method wrapper', () => {
  const clean = loadCleaner();
  assert.equal(
    clean("Error invoking remote method 'create-meeting': Error: 项目目录不存在：C:\\x"),
    '项目目录不存在：C:\\x',
  );
});

test('_cleanIpcError keeps plain messages intact and handles empties', () => {
  const clean = loadCleaner();
  assert.equal(clean('所有子会话创建失败'), '所有子会话创建失败');
  assert.equal(clean(''), '未知错误');
  assert.equal(clean(null), '未知错误');
  assert.equal(clean('Error: 请至少选择 1 位 AI 成员。'), '请至少选择 1 位 AI 成员。');
});
