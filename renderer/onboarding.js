'use strict';
// First-run welcome guide: detect installed AI CLIs, show readiness, and guide
// the user toward configuring at least one AI. Self-triggers on first launch
// (tracked via localStorage). Re-openable through window.showOnboarding().
(function () {
  const { ipcRenderer } = require('electron');
  const ONBOARD_KEY = 'hub_onboarded_v1';

  const AI_INFO = {
    claude: { label: 'Claude', install: '安装 Claude Code CLI 并登录（命令行能跑通 claude）' },
    codex: { label: 'Codex', install: '安装 Codex CLI 并登录 ChatGPT（命令行能跑通 codex）' },
    gemini: { label: 'Gemini', install: '安装 Gemini CLI 并登录（命令行能跑通 gemini）' },
    deepseek: { label: 'DeepSeek', install: '在设置里填 DeepSeek API Key（它复用 Claude CLI 运行）' },
  };

  function _ensureStyle() {
    if (document.getElementById('onboarding-style')) return;
    const s = document.createElement('style');
    s.id = 'onboarding-style';
    s.textContent = `
      .ob-overlay{position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;
        background:rgba(0,0,0,.5);backdrop-filter:blur(4px);
        font-family:-apple-system,"PingFang SC",system-ui,sans-serif;}
      .ob-card{background:#fff;color:#1d1d1f;max-width:540px;width:calc(100% - 48px);max-height:calc(100% - 48px);
        overflow:auto;border-radius:16px;padding:28px 30px;box-shadow:0 20px 60px rgba(0,0,0,.3);}
      .ob-h1{font-size:22px;font-weight:700;margin:0 0 10px;letter-spacing:-.01em;}
      .ob-sub{font-size:14px;line-height:1.65;color:#6e6e73;margin:0 0 20px;}
      .ob-list{display:flex;flex-direction:column;gap:10px;margin-bottom:16px;}
      .ob-row{display:flex;align-items:center;gap:10px;font-size:14px;flex-wrap:wrap;}
      .ob-badge{flex:none;font-size:12px;font-weight:600;padding:3px 9px;border-radius:7px;white-space:nowrap;}
      .ob-badge.ok{background:#e4f7ea;color:#1d8f3f;}
      .ob-badge.no{background:#f0f0f2;color:#8a8a8e;}
      .ob-name{font-weight:600;min-width:64px;}
      .ob-hint{color:#8a8a8e;font-size:12.5px;flex:1;min-width:180px;}
      .ob-warn{background:#fff4e5;color:#a05a00;font-size:13px;padding:10px 12px;border-radius:9px;
        margin-bottom:14px;line-height:1.55;}
      .ob-actions{display:flex;gap:12px;justify-content:flex-end;margin-top:8px;flex-wrap:wrap;}
      .ob-btn{border:none;border-radius:10px;padding:10px 18px;font-size:14px;font-weight:600;cursor:pointer;}
      .ob-ghost{background:#f0f0f2;color:#1d1d1f;}
      .ob-primary{background:#0071e3;color:#fff;}
      .ob-foot{margin-top:14px;font-size:12px;color:#aeaeb2;text-align:center;}
      @media (prefers-color-scheme:dark){
        .ob-card{background:#2c2c2e;color:#f5f5f7;}
        .ob-sub{color:#aeaeb2;}
        .ob-badge.ok{background:#16321f;color:#4ad06a;}
        .ob-badge.no{background:#3a3a3c;color:#aeaeb2;}
        .ob-warn{background:#3a2a10;color:#ffb84d;}
        .ob-ghost{background:#3a3a3c;color:#f5f5f7;}
      }`;
    document.head.appendChild(s);
  }

  function _row(label, ready, hint) {
    const badge = ready
      ? '<span class="ob-badge ok">✅ 已就绪</span>'
      : '<span class="ob-badge no">⬜ 未检测到</span>';
    const h = ready ? '' : `<span class="ob-hint">${hint}</span>`;
    return `<div class="ob-row">${badge}<span class="ob-name">${label}</span>${h}</div>`;
  }

  function _openSettings() {
    if (typeof window.openConfigModal === 'function') { window.openConfigModal(); return; }
    const gear = document.getElementById('options-settings');
    if (gear) gear.click();
  }

  async function _render() {
    _ensureStyle();
    let clis = { claude: false, codex: false, gemini: false, python: false };
    let deepseekKey = false;
    try { clis = await ipcRenderer.invoke('detect-clis'); } catch {}
    try { const cfg = await ipcRenderer.invoke('get-hub-config-raw'); deepseekKey = !!(cfg && cfg.deepseekApiKey); } catch {}
    const anyReady = clis.claude || clis.codex || clis.gemini || deepseekKey;

    const old = document.getElementById('onboarding-overlay');
    if (old) old.remove();
    const overlay = document.createElement('div');
    overlay.className = 'ob-overlay';
    overlay.id = 'onboarding-overlay';
    overlay.innerHTML = `
      <div class="ob-card" role="dialog" aria-label="欢迎">
        <div class="ob-h1">👋 欢迎使用 AI 群聊 Hub</div>
        <div class="ob-sub">这是一个把多个 AI 命令行拉进同一个群聊的本地工作台——让 Claude / Codex / Gemini / DeepSeek 在一个房间里<b>串行接力</b>或并行讨论。它本身不含 AI，靠调用你本机<b>已安装并登录</b>的 AI CLI 工作。下面是当前检测结果：</div>
        <div class="ob-list">
          ${_row(AI_INFO.claude.label, clis.claude, AI_INFO.claude.install)}
          ${_row(AI_INFO.codex.label, clis.codex, AI_INFO.codex.install)}
          ${_row(AI_INFO.gemini.label, clis.gemini, AI_INFO.gemini.install)}
          ${_row(AI_INFO.deepseek.label, deepseekKey, AI_INFO.deepseek.install)}
        </div>
        ${!clis.python ? '<div class="ob-warn">⚠ 未检测到 <b>python</b>：群聊卡片的自动同步依赖它。建议安装 Python 3 并加入 PATH（不影响先用起来）。</div>' : ''}
        ${!anyReady ? '<div class="ob-warn">⚠ 还没有检测到任何可用的 AI。请先安装并登录上面任一 CLI，或在设置里填一个 DeepSeek API Key，再开始群聊。</div>' : ''}
        <div class="ob-actions">
          <button class="ob-btn ob-ghost" id="ob-settings">⚙️ 打开设置 / 填 Key</button>
          <button class="ob-btn ob-primary" id="ob-start">开始使用 →</button>
        </div>
        <div class="ob-foot">这一步只提示，不修改任何配置。之后可在右上角「⚙️ 设置」随时重新配置。</div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#ob-start').addEventListener('click', () => {
      localStorage.setItem(ONBOARD_KEY, '1');
      overlay.remove();
    });
    overlay.querySelector('#ob-settings').addEventListener('click', () => {
      localStorage.setItem(ONBOARD_KEY, '1');
      overlay.remove();
      _openSettings();
    });
  }

  async function maybeShow() {
    try { if (localStorage.getItem(ONBOARD_KEY)) return; } catch {}
    _render();
  }

  // Re-openable from a menu / settings ("重新查看引导").
  window.showOnboarding = _render;

  window.addEventListener('load', () => {
    setTimeout(maybeShow, 700);
    // Gear menu entry: "👋 使用引导" re-opens the guide any time.
    const item = document.getElementById('options-onboarding');
    if (item) item.addEventListener('click', () => {
      const menu = document.getElementById('options-menu');
      if (menu) menu.style.display = 'none';
      _render();
    });
  });
})();
