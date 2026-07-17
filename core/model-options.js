'use strict';
// Per-CLI model lists — single source of truth for the single-session top-bar
// model picker (renderer.js) and round-table create modal (meeting-create-modal.js).
//
// Model picker options used by the renderer config modal.
//
// `canSwitchInline(kind)`: claude CLI 接受 `/model <id>\r` 原地切换；deepseek
// 是 claude CLI + ANTHROPIC_BASE_URL 中转，同样走该路径。codex /
// gemini PTY 实测不识别 inline `/model`（spec §3.1）——必须 kill + respawn with --model，
// 本期未实现，picker 端给明确提示而不是默默无效切换。

const MODEL_OPTIONS_BY_KIND = {
  claude: [
    { id: '',       label: '跟随 Claude CLI 默认（推荐）' },
    { id: 'opus',   label: '最新 Opus（官方别名）' },
    { id: 'sonnet', label: '最新 Sonnet（官方别名）' },
    { id: 'haiku',  label: '最新 Haiku（官方别名）' },
  ],
  gemini: [
    { id: '',                     label: '跟随 Gemini CLI 默认（推荐）' },
    { id: 'gemini-2.5-pro',       label: 'Gemini 2.5 Pro' },
    { id: 'gemini-2.5-flash',     label: 'Gemini 2.5 Flash' },
  ],
  codex: [
    { id: '',              label: '跟随 Codex CLI / config.toml 默认（推荐）' },
    { id: 'gpt-5.6',       label: 'GPT-5.6' },
    { id: 'gpt-5.5',       label: 'GPT-5.5' },
    { id: 'gpt-5.4',       label: 'GPT-5.4' },
  ],
  deepseek: [
    { id: 'deepseek-v4-pro',   label: 'DeepSeek V4 Pro' },
    { id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash' },
  ],
};

const DEFAULT_MODEL_BY_KIND = {
  claude: '',
  gemini: '',
  codex: '',
  deepseek: 'deepseek-v4-pro',
};

function normalizeDeepSeekModel(modelId) {
  const raw = String(modelId || DEFAULT_MODEL_BY_KIND.deepseek).trim();
  if (!raw) return DEFAULT_MODEL_BY_KIND.deepseek;
  return raw.replace(/\[1m\]$/i, '');
}

function deepseekDisplayName(modelId) {
  const normalized = normalizeDeepSeekModel(modelId);
  const base = normalized;
  if (base === 'deepseek-v4-pro') return 'DS V4 Pro';
  if (base === 'deepseek-v4-flash') return 'DS V4 Flash';
  return normalized;
}

function modelFlag(modelId) {
  const model = String(modelId || '').trim();
  return model ? ` --model ${model}` : '';
}

// `<base>-resume` kinds 复用对应 base kind 清单（claude-resume → claude，等）。
function modelOptionsFor(kind) {
  if (!kind) return [];
  const base = String(kind).replace(/-resume$/, '');
  return MODEL_OPTIONS_BY_KIND[base] || [];
}

// 走 claude CLI 的 kind（含直连 + 中转）支持 inline `/model <id>\r`。
const INLINE_SWITCH_BASE_KINDS = new Set([
  'claude', 'deepseek',
]);

function canSwitchInline(kind) {
  if (!kind) return false;
  const base = String(kind).replace(/-resume$/, '');
  return INLINE_SWITCH_BASE_KINDS.has(base);
}

module.exports = {
  MODEL_OPTIONS_BY_KIND,
  DEFAULT_MODEL_BY_KIND,
  modelOptionsFor,
  canSwitchInline,
  modelFlag,
  normalizeDeepSeekModel,
  deepseekDisplayName,
};
