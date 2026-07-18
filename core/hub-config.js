/**
 * Hub 配置加载器
 *
 * 优先级（从高到低）：
 * 1. 环境变量（DEEPSEEK_API_KEY, CLAUDE_PROXY）
 * 2. config.json（~/.claude-session-hub/config.json）
 * 3. 默认值
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { getHubDataDir } = require('./data-dir');
const { normalizeExecutionMode } = require('./agent-launch-policy.js');

// 默认值
const DEFAULTS = {
  proxy: '',
  agent_execution_mode: 'safe',
  claude_hook_integration: false,
  claude_backend: 'subscription',
  claude_api_base_url: '',
  claude_api_model: '',
  codex_backend: 'subscription',
  codex_subscription_profile: 'default',
  codex_api_base_url: '',
  codex_api_model: 'gpt-5.6',
  codex_api_provider: '',
  ui_tool_fold_threshold: 15,
  ui_code_fold_threshold: 30,
};

/**
 * 加载 config.json
 */
function loadConfigJson() {
  const configPath = path.join(getHubDataDir(), 'config.json');
  try {
    const raw = fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, '');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/**
 * 获取配置值（优先级：env > config.json > default）
 */
function getConfigValue(key, envKey, configPath, defaultValue) {
  // 1. 环境变量
  if (process.env[envKey]) {
    return process.env[envKey];
  }

  // 2. config.json
  const config = loadConfigJson();
  const configValue = configPath.split('.').reduce((obj, k) => obj && obj[k], config);
  if (configValue !== undefined && configValue !== null && configValue !== '') {
    return configValue;
  }

  // 3. 默认值
  return defaultValue;
}

/**
 * 规范化 base URL（去掉末尾斜杠）
 */
function normalizeBaseUrl(url) {
  return String(url || '').trim().replace(/\/+$/, '');
}

function normalizeBoolean(value) {
  if (typeof value === 'boolean') return value;
  return /^(1|true|yes|on)$/i.test(String(value || '').trim());
}

function defaultCodexSubscriptionProfiles() {
  return [
    { id: 'default', label: '主账号', home: '' },
    { id: 'second', label: '新账号', home: path.join(os.homedir(), '.codex-profiles', 'second') },
  ];
}

function normalizeCodexSubscriptionProfiles(profiles) {
  const byId = new Map(defaultCodexSubscriptionProfiles().map(p => [p.id, p]));
  if (Array.isArray(profiles)) {
    for (const p of profiles) {
      if (!p || typeof p !== 'object') continue;
      const id = String(p.id || '').trim();
      if (!id) continue;
      byId.set(id, {
        id,
        label: String(p.label || p.name || id).trim() || id,
        home: String(p.home || '').trim(),
      });
    }
  }
  return [...byId.values()];
}

// Custom command members (v1.1.0): [{id, name, command}] — any interactive CLI
// the user wants as a group member. Stored under config.custom_members.
function normalizeCustomMembers(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const m of raw) {
    if (!m || typeof m !== 'object') continue;
    const id = String(m.id || '').trim();
    const name = String(m.name || '').trim();
    const command = String(m.command || '').trim();
    if (!id || !name || !command || seen.has(id)) continue;
    if (!/^[a-zA-Z0-9_-]{1,32}$/.test(id)) continue;
    seen.add(id);
    out.push({ id, name: name.slice(0, 40), command: command.slice(0, 500) });
  }
  return out;
}

// 导出配置值（惰性求值，首次访问时计算）
let _cachedConfig = null;

function getConfig() {
  if (_cachedConfig) return _cachedConfig;
  const rawConfig = loadConfigJson();
  const codexProvider = (rawConfig.providers && rawConfig.providers.codex) || {};
  const codexSubscriptionProfiles = normalizeCodexSubscriptionProfiles(codexProvider.subscription_profiles);

  _cachedConfig = {
    proxy: getConfigValue('proxy', 'CLAUDE_PROXY', 'proxy.http', DEFAULTS.proxy),
    agentExecutionMode: normalizeExecutionMode(getConfigValue('agentExecutionMode', 'HUB_AGENT_EXECUTION_MODE', 'execution.mode', DEFAULTS.agent_execution_mode)),
    claudeHookIntegration: normalizeBoolean(getConfigValue('claudeHookIntegration', 'HUB_CLAUDE_HOOK_INTEGRATION', 'integrations.claude_hooks', DEFAULTS.claude_hook_integration)),
    claudeBackend: getConfigValue('claudeBackend', 'HUB_CLAUDE_BACKEND', 'providers.claude.backend', DEFAULTS.claude_backend),
    claudeApiKey: getConfigValue('claudeApiKey', 'HUB_CLAUDE_API_KEY', 'providers.claude.api_key', ''),
    claudeApiBaseUrl: normalizeBaseUrl(getConfigValue('claudeApiBaseUrl', 'HUB_CLAUDE_API_BASE_URL', 'providers.claude.base_url', DEFAULTS.claude_api_base_url)),
    claudeApiModel: getConfigValue('claudeApiModel', 'HUB_CLAUDE_API_MODEL', 'providers.claude.model', DEFAULTS.claude_api_model),
    deepseekApiKey: getConfigValue('deepseekApiKey', 'DEEPSEEK_API_KEY', 'providers.deepseek.api_key', ''),
    codexBackend: getConfigValue('codexBackend', 'HUB_CODEX_BACKEND', 'providers.codex.backend', DEFAULTS.codex_backend),
    codexSubscriptionProfile: getConfigValue('codexSubscriptionProfile', 'HUB_CODEX_PROFILE', 'providers.codex.subscription_profile', DEFAULTS.codex_subscription_profile),
    codexSubscriptionProfiles,
    codexApiKey: getConfigValue('codexApiKey', 'HUB_CODEX_API_KEY', 'providers.codex.api_key', ''),
    codexApiBaseUrl: normalizeBaseUrl(getConfigValue('codexApiBaseUrl', 'HUB_CODEX_API_BASE_URL', 'providers.codex.base_url', DEFAULTS.codex_api_base_url)),
    codexApiModel: getConfigValue('codexApiModel', 'HUB_CODEX_API_MODEL', 'providers.codex.model', DEFAULTS.codex_api_model),
    codexApiProvider: getConfigValue('codexApiProvider', 'HUB_CODEX_API_PROVIDER', 'providers.codex.provider', DEFAULTS.codex_api_provider),
    uiToolFoldThreshold: parseInt(getConfigValue('uiToolFoldThreshold', 'HUB_UI_TOOL_FOLD', 'ui.tool_fold_threshold', DEFAULTS.ui_tool_fold_threshold), 10),
    uiCodeFoldThreshold: parseInt(getConfigValue('uiCodeFoldThreshold', 'HUB_UI_CODE_FOLD', 'ui.code_fold_threshold', DEFAULTS.ui_code_fold_threshold), 10),
    customMembers: normalizeCustomMembers(rawConfig.custom_members),
  };

  return _cachedConfig;
}

/**
 * 清除缓存（用于测试或配置更新后重新加载）
 */
function clearConfigCache() {
  _cachedConfig = null;
}

/**
 * 保存配置到 config.json
 */
function saveConfig(config) {
  const configPath = path.join(getHubDataDir(), 'config.json');
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
  clearConfigCache();
}

/**
 * 获取 config.json 路径
 */
function getConfigPath() {
  return path.join(getHubDataDir(), 'config.json');
}

/**
 * 检查是否缺少必要配置（用于首次启动向导）
 */
function checkMissingConfig() {
  const config = getConfig();
  const missing = [];

  // DeepSeek 是可选功能，不强制要求
  // 但如果用户想用，需要配置
  if (!config.deepseekApiKey) {
    missing.push({ key: 'deepseek', label: 'DeepSeek API Key', required: false });
  }

  return missing;
}

module.exports = {
  getConfig,
  clearConfigCache,
  saveConfig,
  getConfigPath,
  checkMissingConfig,
  DEFAULTS,
};
