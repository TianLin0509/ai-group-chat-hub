'use strict';

const DEFAULT_CODEX_MODEL = 'gpt-5.6';

function createConfigModalController({ document, ipcRenderer, providerModes, renderAccountUsage }) {
  if (!document) throw new Error('document is required');
  if (!ipcRenderer) throw new Error('ipcRenderer is required');
  if (!providerModes) throw new Error('providerModes is required');

  // Config/Settings Modal (API key + proxy)
  const CONFIG_AI_META = {
    claude: {
      title: 'Claude 设置',
      hint: '使用当前本机 Claude Code 登录状态。新建 Claude 会话会走本机订阅和本机代理配置。',
      status: '订阅',
      statusClass: 'subscription',
    },
    gemini: {
      title: 'Gemini 设置',
      hint: '使用当前本机 Gemini CLI 登录状态。代理设置会影响新建 Gemini 会话。',
      status: '订阅',
      statusClass: 'subscription',
    },
    codex: {
      title: 'Codex 设置',
      hint: '全 Hub 新建 Codex 会话统一生效。API 模式会使用隔离 CODEX_HOME，不污染本机订阅配置。',
    },
    deepseek: {
      title: 'DeepSeek 设置',
      hint: 'DeepSeek 当前通过 API 接入，新建 DeepSeek 会话生效。',
      status: 'API',
      statusClass: 'api',
    },
  };
  
  let activeConfigAi = 'codex';
  // Custom command members (v1.1.0): [{id, name, command}], persisted via save-hub-config.
  let customMembers = [];

  function renderCustomMembers() {
    const wrap = configEl('cfg-custom-members');
    if (!wrap) return;
    if (!customMembers.length) {
      wrap.innerHTML = '<p class="config-hint" style="margin:0;">（还没有自定义成员）</p>';
      return;
    }
    wrap.innerHTML = customMembers.map((m, i) => `
      <div style="display:flex; align-items:center; gap:8px; padding:6px 0; border-bottom:1px solid rgba(128,128,128,0.15);">
        <strong style="flex:none; max-width:140px; overflow:hidden; text-overflow:ellipsis;">${escapeHtmlCfg(m.name)}</strong>
        <code style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; opacity:0.75;">${escapeHtmlCfg(m.command)}</code>
        <button type="button" class="config-back-btn" data-custom-del="${i}" style="flex:none;">删除</button>
      </div>`).join('');
    wrap.querySelectorAll('[data-custom-del]').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.getAttribute('data-custom-del'), 10);
        if (Number.isInteger(idx)) { customMembers.splice(idx, 1); renderCustomMembers(); }
      });
    });
  }

  function escapeHtmlCfg(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  let codexSubscriptionProfiles = [
    { id: 'default', label: '主账号', home: '' },
    { id: 'second', label: '新账号', home: '' },
  ];
  let codexSubscriptionProfile = 'default';
  
  function configEl(id) {
    return document.getElementById(id);
  }
  
  function normalizeCodexProfilesForUi(profiles) {
    const byId = new Map(codexSubscriptionProfiles.map(p => [p.id, { ...p }]));
    if (Array.isArray(profiles)) {
      for (const p of profiles) {
        if (!p || typeof p !== 'object') continue;
        const id = String(p.id || '').trim();
        if (!id) continue;
        byId.set(id, {
          id,
          label: String(p.label || id).trim() || id,
          home: String(p.home || '').trim(),
        });
      }
    }
    return [...byId.values()];
  }
  
  function renderCodexProfileSelect(selectedId) {
    const select = configEl('cfg-codex-subscription-profile');
    if (!select) return;
    const selected = selectedId || codexSubscriptionProfile || 'default';
    select.innerHTML = '';
    for (const profile of codexSubscriptionProfiles) {
      const opt = document.createElement('option');
      opt.value = profile.id;
      opt.textContent = profile.label || profile.id;
      select.appendChild(opt);
    }
    select.value = codexSubscriptionProfiles.some(p => p.id === selected) ? selected : 'default';
    codexSubscriptionProfile = select.value;
  }
  
  function setCodexProfileForm(profiles, selectedId) {
    codexSubscriptionProfiles = normalizeCodexProfilesForUi(profiles);
    codexSubscriptionProfile = selectedId || 'default';
    const main = codexSubscriptionProfiles.find(p => p.id === 'default') || { label: '主账号', home: '' };
    const second = codexSubscriptionProfiles.find(p => p.id === 'second') || { label: '新账号', home: '' };
    if (configEl('cfg-codex-profile-default-label')) configEl('cfg-codex-profile-default-label').value = main.label || '主账号';
    if (configEl('cfg-codex-profile-second-label')) configEl('cfg-codex-profile-second-label').value = second.label || '新账号';
    if (configEl('cfg-codex-profile-second-home')) configEl('cfg-codex-profile-second-home').value = second.home || '';
    renderCodexProfileSelect(codexSubscriptionProfile);
    updateCodexProfileMenuLabels();
  }
  
  function readCodexProfilesFromForm() {
    const mainLabel = (configEl('cfg-codex-profile-default-label') && configEl('cfg-codex-profile-default-label').value.trim()) || '主账号';
    const secondLabel = (configEl('cfg-codex-profile-second-label') && configEl('cfg-codex-profile-second-label').value.trim()) || '新账号';
    const secondHome = (configEl('cfg-codex-profile-second-home') && configEl('cfg-codex-profile-second-home').value.trim()) || '';
    codexSubscriptionProfiles = [
      { id: 'default', label: mainLabel, home: '' },
      { id: 'second', label: secondLabel, home: secondHome },
    ];
    return codexSubscriptionProfiles;
  }
  
  function updateCodexProfileMenuLabels() {
    const byId = new Map(codexSubscriptionProfiles.map(p => [p.id, p]));
    document.querySelectorAll('[data-codex-profile-label]').forEach(el => {
      const profile = byId.get(el.dataset.codexProfileLabel);
      if (profile) el.textContent = profile.label || profile.id;
    });
  }
  
  function setConfigStatus(el, label, cls) {
    if (!el) return;
    el.textContent = label;
    el.className = 'config-ai-status ' + (cls || '');
  }

  function updateConfigSummaries() {
    const claudeBackend = configEl('cfg-claude-backend') ? configEl('cfg-claude-backend').value : 'subscription';
    const claudeModel = configEl('cfg-claude-model') ? (configEl('cfg-claude-model').value.trim() || 'CLI 默认') : 'CLI 默认';
    const claudeKey = configEl('cfg-claude-key') ? configEl('cfg-claude-key').value.trim() : '';
    const codexBackend = configEl('cfg-codex-backend') ? configEl('cfg-codex-backend').value : 'subscription';
    const codexModel = configEl('cfg-codex-model') ? (configEl('cfg-codex-model').value.trim() || DEFAULT_CODEX_MODEL) : DEFAULT_CODEX_MODEL;
    const codexKey = configEl('cfg-codex-key') ? configEl('cfg-codex-key').value.trim() : '';
    const profiles = readCodexProfilesFromForm();
    const profileSelect = configEl('cfg-codex-subscription-profile');
    const selectedProfileId = profileSelect ? profileSelect.value : codexSubscriptionProfile;
    if (profileSelect) renderCodexProfileSelect(selectedProfileId);
    const selectedProfile = profiles.find(p => p.id === selectedProfileId) || profiles[0];
    codexSubscriptionProfile = selectedProfile ? selectedProfile.id : 'default';
    updateCodexProfileMenuLabels();
    const deepseekKey = configEl('cfg-deepseek-key') ? configEl('cfg-deepseek-key').value.trim() : '';
  
    const codexSummary = configEl('cfg-summary-codex');
    if (codexSummary) {
      codexSummary.textContent = codexBackend === 'api'
        ? `第三方 API · ${codexModel}`
        : `订阅模式 · ${(selectedProfile && selectedProfile.label) || '主账号'} · ${codexModel}`;
    }
    setConfigStatus(
      configEl('cfg-status-codex'),
      codexBackend === 'api' ? (codexKey ? 'API' : '缺 Key') : ((selectedProfile && selectedProfile.label) || '订阅'),
      codexBackend === 'api' ? (codexKey ? 'api' : 'missing') : 'subscription'
    );
  
    const deepseekSummary = configEl('cfg-summary-deepseek');
    if (deepseekSummary) deepseekSummary.textContent = deepseekKey ? 'API · deepseek-v4-pro' : 'API · 未配置 Key';
    setConfigStatus(configEl('cfg-status-deepseek'), deepseekKey ? 'API' : '缺 Key', deepseekKey ? 'api' : 'missing');

    const claudeSummary = configEl('cfg-summary-claude');
    if (claudeSummary) claudeSummary.textContent = '订阅模式 · 跟随 CLI 默认';
    if (activeConfigAi === 'claude') {
      setConfigStatus(configEl('cfg-detail-status'), '订阅', 'subscription');
    }
  
    if (claudeSummary) {
      claudeSummary.textContent = claudeBackend === 'api'
        ? `API · ${claudeModel}`
        : '订阅模式 · 跟随 CLI 默认';
    }
    if (activeConfigAi === 'claude') {
      setConfigStatus(
        configEl('cfg-detail-status'),
        claudeBackend === 'api' ? (claudeKey ? 'API' : '缺 Key') : '订阅',
        claudeBackend === 'api' ? (claudeKey ? 'api' : 'missing') : 'subscription'
      );
    }

    if (activeConfigAi === 'codex') {
      setConfigStatus(
        configEl('cfg-detail-status'),
        codexBackend === 'api' ? (codexKey ? 'API' : '缺 Key') : ((selectedProfile && selectedProfile.label) || '订阅'),
        codexBackend === 'api' ? (codexKey ? 'api' : 'missing') : 'subscription'
      );
    } else if (activeConfigAi === 'deepseek') {
      setConfigStatus(configEl('cfg-detail-status'), deepseekKey ? 'API' : '缺 Key', deepseekKey ? 'api' : 'missing');
    }
  }
  
  function showConfigMainView() {
    if (configEl('config-main-view')) configEl('config-main-view').classList.remove('hidden');
    if (configEl('config-detail-view')) configEl('config-detail-view').classList.add('hidden');
    document.querySelectorAll('.config-ai-row').forEach(row => row.classList.remove('active'));
    updateConfigSummaries();
  }
  
  function showConfigDetail(ai) {
    activeConfigAi = ai || 'codex';
    const meta = CONFIG_AI_META[activeConfigAi] || CONFIG_AI_META.codex;
    if (configEl('config-main-view')) configEl('config-main-view').classList.add('hidden');
    if (configEl('config-detail-view')) configEl('config-detail-view').classList.remove('hidden');
    if (configEl('cfg-detail-title')) configEl('cfg-detail-title').textContent = meta.title;
    if (configEl('cfg-detail-hint')) configEl('cfg-detail-hint').textContent = meta.hint;
    document.querySelectorAll('.config-ai-row').forEach(row => row.classList.toggle('active', row.dataset.ai === activeConfigAi));
    document.querySelectorAll('.config-ai-detail').forEach(panel => panel.classList.toggle('active', panel.id === 'cfg-detail-' + activeConfigAi));
  
    if (meta.status) {
      setConfigStatus(configEl('cfg-detail-status'), meta.status, meta.statusClass);
    }
    updateConfigSummaries();
  }
  
  async function openConfigModal() {
    let modal = document.getElementById('config-modal');
    if (!modal && document.readyState === 'loading') {
      await new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve, { once: true }));
      modal = document.getElementById('config-modal');
    }
    if (!modal) return;
  
    // 加载当前配置
    try {
      const cfg = await ipcRenderer.invoke('get-hub-config-raw');
      providerModes.codex = cfg.codexBackend === 'api' ? 'api' : 'subscription';
      setCodexProfileForm(cfg.codexSubscriptionProfiles, cfg.codexSubscriptionProfile);
      document.getElementById('cfg-proxy').value = cfg.proxy || '';
      document.getElementById('cfg-execution-mode').value = cfg.agentExecutionMode === 'dangerous' ? 'dangerous' : 'safe';
      document.getElementById('cfg-claude-hook-integration').value = cfg.claudeHookIntegration ? 'on' : 'off';
      document.getElementById('cfg-claude-backend').value = cfg.claudeBackend || 'subscription';
      document.getElementById('cfg-claude-key').value = cfg.claudeApiKey || '';
      document.getElementById('cfg-claude-url').value = cfg.claudeApiBaseUrl || '';
      document.getElementById('cfg-claude-model').value = cfg.claudeApiModel || '';
      document.getElementById('cfg-deepseek-key').value = cfg.deepseekApiKey || '';
      document.getElementById('cfg-codex-backend').value = cfg.codexBackend || 'subscription';
      document.getElementById('cfg-codex-key').value = cfg.codexApiKey || '';
      document.getElementById('cfg-codex-url').value = cfg.codexApiBaseUrl || '';
      document.getElementById('cfg-codex-model').value = cfg.codexApiModel || '';
      customMembers = Array.isArray(cfg.customMembers) ? cfg.customMembers.map(m => ({ ...m })) : [];
      renderCustomMembers();
      updateConfigSummaries();
    } catch {
      // 加载失败也显示空白面板
    }
    showConfigMainView();
    modal.classList.remove('hidden');
  }
  
  function closeConfigModal() {
    const modal = document.getElementById('config-modal');
    if (modal) modal.classList.add('hidden');
    const msg = document.getElementById('config-save-msg');
    if (msg) { msg.style.display = 'none'; msg.textContent = ''; }
  }
  
  // 配置面板事件（DOM ready 后绑定）
  function initConfigModal() {
    const modal = document.getElementById('config-modal');
    if (!modal) return;
  
    document.getElementById('config-close').addEventListener('click', closeConfigModal);
    document.getElementById('config-cancel').addEventListener('click', closeConfigModal);
    const customAddBtn = document.getElementById('cfg-custom-add');
    if (customAddBtn) {
      customAddBtn.addEventListener('click', () => {
        const nameEl = document.getElementById('cfg-custom-name');
        const cmdEl = document.getElementById('cfg-custom-command');
        const name = (nameEl && nameEl.value.trim()) || '';
        const command = (cmdEl && cmdEl.value.trim()) || '';
        if (!name || !command) return;
        const id = 'c' + Date.now().toString(36);
        customMembers.push({ id, name: name.slice(0, 40), command: command.slice(0, 500) });
        if (nameEl) nameEl.value = '';
        if (cmdEl) cmdEl.value = '';
        renderCustomMembers();
      });
    }
    const backBtn = document.getElementById('config-back');
    if (backBtn) backBtn.addEventListener('click', showConfigMainView);
    document.querySelectorAll('.config-ai-row').forEach(row => {
      row.addEventListener('click', () => showConfigDetail(row.dataset.ai));
    });
    ['cfg-execution-mode', 'cfg-claude-hook-integration', 'cfg-claude-backend', 'cfg-claude-key', 'cfg-claude-url', 'cfg-claude-model', 'cfg-codex-backend', 'cfg-codex-subscription-profile', 'cfg-codex-profile-default-label', 'cfg-codex-profile-second-label', 'cfg-codex-profile-second-home', 'cfg-codex-key', 'cfg-codex-url', 'cfg-codex-model', 'cfg-deepseek-key'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('input', updateConfigSummaries);
      if (el) el.addEventListener('change', updateConfigSummaries);
    });
    modal.addEventListener('click', (e) => { if (e.target === modal) closeConfigModal(); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !modal.classList.contains('hidden')) {
        e.preventDefault(); closeConfigModal();
      }
    });
  
    document.getElementById('config-save').addEventListener('click', async () => {
      const msg = document.getElementById('config-save-msg');
      const newConfig = {
        proxy: document.getElementById('cfg-proxy').value.trim() || undefined,
        agentExecutionMode: document.getElementById('cfg-execution-mode').value === 'dangerous' ? 'dangerous' : 'safe',
        claudeHookIntegration: document.getElementById('cfg-claude-hook-integration').value === 'on',
        claudeBackend: document.getElementById('cfg-claude-backend').value,
        claudeApiKey: document.getElementById('cfg-claude-key').value.trim() || undefined,
        claudeApiBaseUrl: document.getElementById('cfg-claude-url').value.trim() || undefined,
        claudeApiModel: document.getElementById('cfg-claude-model').value.trim() || undefined,
        deepseekApiKey: document.getElementById('cfg-deepseek-key').value.trim() || undefined,
        codexBackend: document.getElementById('cfg-codex-backend').value,
        codexSubscriptionProfile: (document.getElementById('cfg-codex-subscription-profile') && document.getElementById('cfg-codex-subscription-profile').value) || 'default',
        codexSubscriptionProfiles: readCodexProfilesFromForm(),
        codexApiKey: document.getElementById('cfg-codex-key').value.trim() || undefined,
        codexApiBaseUrl: document.getElementById('cfg-codex-url').value.trim() || undefined,
        codexApiModel: document.getElementById('cfg-codex-model').value.trim() || undefined,
        customMembers,
      };
      try {
        const result = await ipcRenderer.invoke('save-hub-config', newConfig);
        if (result && result.success) {
          providerModes.codex = newConfig.codexBackend === 'api' ? 'api' : 'subscription';
          renderAccountUsage();
          msg.textContent = '配置已保存。权限策略对新会话生效；Claude Hook 开关在重启 Hub 后生效。';
          msg.className = 'config-save-msg success';
          msg.style.display = 'block';
          setTimeout(() => { msg.style.display = 'none'; }, 4000);
        } else {
          throw new Error('save failed');
        }
      } catch (err) {
        msg.textContent = '保存失败: ' + (err.message || '未知错误');
        msg.className = 'config-save-msg error';
        msg.style.display = 'block';
      }
    });
  }
  document.addEventListener('DOMContentLoaded', initConfigModal);
  // 如果 DOM 已经 ready 也立即尝试
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(initConfigModal, 0);
  }

  return {
    open: openConfigModal,
    close: closeConfigModal,
    init: initConfigModal,
    setCodexProfileForm,
    updateSummaries: updateConfigSummaries,
    showMainView: showConfigMainView,
    showDetail: showConfigDetail,
    readCodexProfilesFromForm,
  };
}

module.exports = { createConfigModalController };
