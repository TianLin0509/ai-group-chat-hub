'use strict';

const SAFE_MODE = 'safe';
const DANGEROUS_MODE = 'dangerous';

function normalizeExecutionMode(value) {
  return value === DANGEROUS_MODE ? DANGEROUS_MODE : SAFE_MODE;
}

function buildClaudePermissionArg(mode) {
  return normalizeExecutionMode(mode) === DANGEROUS_MODE
    ? '--permission-mode bypassPermissions'
    : '--permission-mode acceptEdits';
}

function buildGeminiPermissionArgs(mode) {
  return normalizeExecutionMode(mode) === DANGEROUS_MODE
    ? '--approval-mode yolo'
    : '--approval-mode auto_edit';
}

function buildCodexPermissionArgs(mode) {
  return normalizeExecutionMode(mode) === DANGEROUS_MODE
    ? '--dangerously-bypass-approvals-and-sandbox'
    : '--full-auto';
}

function codexConfigPolicy(mode) {
  if (normalizeExecutionMode(mode) === DANGEROUS_MODE) {
    return { approvalPolicy: 'never', sandboxMode: 'danger-full-access' };
  }
  return { approvalPolicy: 'on-request', sandboxMode: 'workspace-write' };
}

module.exports = {
  SAFE_MODE,
  DANGEROUS_MODE,
  normalizeExecutionMode,
  buildClaudePermissionArg,
  buildGeminiPermissionArgs,
  buildCodexPermissionArgs,
  codexConfigPolicy,
};
