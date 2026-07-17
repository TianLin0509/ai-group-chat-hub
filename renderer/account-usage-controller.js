'use strict';

function createAccountUsageController({
  document,
  ipcRenderer,
  sessions,
  escapeHtml,
  setIntervalFn = setInterval,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  nowFn = Date.now,
}) {
  if (!document) throw new Error('document is required');
  if (!ipcRenderer) throw new Error('ipcRenderer is required');
  if (!sessions) throw new Error('sessions is required');
  if (typeof escapeHtml !== 'function') throw new Error('escapeHtml is required');

  const accountUsage = { usage5h: null, usage7d: null };
  const agentUsage = { gemini: null, codex: null };
  const agentUsageLastSeen = { gemini: 0, codex: 0 };
  let _claudeUsageLastSeen = 0;
  const usageRefreshState = { inFlight: false, error: null, lastManualAt: 0, providerResults: null };
  let _refreshStatusTimer = null;

  const BURN_HISTORY_MS = 15 * 60 * 1000;
  const globalUsageSamples = []; // [{t, pct, totalUsedTokens}]
  const DEFAULT_TOKENS_PER_PCT = 2_000_000; // fallback baseline if we have no delta
  
  function pruneSamples(arr, now) {
    const cutoff = now - BURN_HISTORY_MS;
    while (arr.length && arr[0].t < cutoff) arr.shift();
  }
  
  function aggregateUsedTokens(now) {
    let total = 0;
    for (const s of sessions.values()) {
      // Use each session's most recent contextUsed as a proxy. Not perfect —
      // but good enough to attribute ratably.
      if (typeof s.contextUsed === 'number') total += s.contextUsed;
    }
    return total;
  }
  
  function estimateTokensPerPct() {
    // Find two global samples far enough apart with a positive pct delta.
    for (let i = globalUsageSamples.length - 1; i >= 1; i--) {
      const a = globalUsageSamples[i];
      for (let j = i - 1; j >= 0; j--) {
        const b = globalUsageSamples[j];
        if (a.t - b.t < 60 * 1000) continue; // need ≥1 min spread
        const dp = a.pct - b.pct;
        const dt = a.totalUsedTokens - b.totalUsedTokens;
        if (dp > 0.3 && dt > 0) return dt / dp;
      }
    }
    return DEFAULT_TOKENS_PER_PCT;
  }
  
  function sessionBurnRate(session) {
    const samples = session._tokenSamples;
    if (!samples || samples.length < 2) return null;
    const first = samples[0];
    const last = samples[samples.length - 1];
    const dt = last.t - first.t;
    if (dt < 60 * 1000) return null;
    const dTokens = last.used - first.used;
    if (dTokens <= 0) return null;
    const tokensPerMin = dTokens / (dt / 60000);
    const tokensPerPct = estimateTokensPerPct();
    const pctPerHour = (tokensPerMin * 60) / tokensPerPct;
    return { tokensPerMin, pctPerHour };
  }

  function recordStatusUsage(payload) {
    if (!payload) return;
    if (payload.usage5h || payload.usage7d) _claudeUsageLastSeen = payload.observedAt || nowFn();
    if (payload.usage5h) {
      accountUsage.usage5h = payload.usage5h;
      const now = nowFn();
      globalUsageSamples.push({ t: now, pct: payload.usage5h.pct, totalUsedTokens: aggregateUsedTokens(now) });
      pruneSamples(globalUsageSamples, now);
    }
    if (payload.usage7d) accountUsage.usage7d = payload.usage7d;
    render();
  }

  function recordSessionContextSample(session, contextUsed) {
    if (!session || typeof contextUsed !== 'number') return;
    if (!session._tokenSamples) session._tokenSamples = [];
    session._tokenSamples.push({ t: nowFn(), used: contextUsed });
    pruneSamples(session._tokenSamples, nowFn());
  }

  function recordAgentUsage(totals) {
    if (totals && totals.gemini && (totals.gemini.usage5h || totals.gemini.usage7d)) {
      agentUsage.gemini = totals.gemini;
      agentUsageLastSeen.gemini = totals.gemini.observedAt || totals.gemini._ts || nowFn();
    }
    if (Object.prototype.hasOwnProperty.call(totals || {}, 'codex')) {
      agentUsage.codex = totals.codex;
      agentUsageLastSeen.codex = (totals.codex && (totals.codex.observedAt || totals.codex._ts)) || nowFn();
    }
    render();
  }

  function applyUsageCache(cached) {
    if (!cached) cached = {};
    if (cached.claude && cached.claude.usage5h) {
      accountUsage.usage5h = cached.claude.usage5h;
      accountUsage.usage7d = cached.claude.usage7d;
      _claudeUsageLastSeen = cached.claude.observedAt || cached.claude.ts || _claudeUsageLastSeen;
    }
    if (cached.gemini) agentUsage.gemini = cached.gemini;
    if (cached.gemini) agentUsageLastSeen.gemini = cached.gemini.observedAt || cached.gemini.ts || agentUsageLastSeen.gemini;
    if (cached.codex) agentUsage.codex = cached.codex;
    if (cached.codex) agentUsageLastSeen.codex = cached.codex.observedAt || cached.codex.ts || agentUsageLastSeen.codex;
    render();
  }

  function formatResetIn(resetsAt) {
    if (!resetsAt) return '';
    const ms = new Date(resetsAt).getTime() - nowFn();
    if (isNaN(ms) || ms <= 0) return '';
    const mins = Math.round(ms / 60000);
    if (mins < 60) return `${mins}m`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h < 24) return `${h}h${m ? ' ' + m + 'm' : ''}`;
    const d = Math.floor(h / 24);
    return `${d}d ${h % 24}h`;
  }

  function formatAge(ts) {
    if (!ts) return '未刷新';
    const ms = Math.max(0, nowFn() - ts);
    const sec = Math.floor(ms / 1000);
    if (sec < 45) return '刚刚';
    if (sec < 60) return `${sec}s`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m`;
    const h = Math.floor(min / 60);
    if (h < 24) return `${h}h`;
    return `${Math.floor(h / 24)}d`;
  }

  function usageFreshnessClass(ts) {
    if (!ts) return 'unknown';
    return nowFn() - ts > 2 * 60 * 1000 ? 'stale' : 'fresh';
  }

  function refreshUsageNow() {
    if (usageRefreshState.inFlight) return Promise.resolve(null);
    usageRefreshState.inFlight = true;
    usageRefreshState.error = null;
    render();
    return Promise.resolve(ipcRenderer.invoke('refresh-usage-now'))
      .then((result) => {
        usageRefreshState.providerResults = result && result.providerResults || null;
        usageRefreshState.lastManualAt = (result && result.refreshedAt) || nowFn();
        if (_refreshStatusTimer !== null) clearTimeoutFn(_refreshStatusTimer);
        _refreshStatusTimer = setTimeoutFn(() => {
          _refreshStatusTimer = null;
          render();
        }, Math.max(1, usageRefreshState.lastManualAt + 60_001 - nowFn()));
        if (result && result.cache) applyUsageCache(result.cache);
        if (result && result.agentData) recordAgentUsage(result.agentData);
        return result;
      })
      .catch((err) => {
        usageRefreshState.error = err && err.message ? err.message : '刷新失败';
        throw err;
      })
      .finally(() => {
        usageRefreshState.inFlight = false;
        render();
      });
  }
  
  function render() {
    const el = document.getElementById('account-usage');
    if (!el) return;
    el.style.display = 'block';
  
    const pctCls = (pct) => pct >= 85 ? 'danger' : pct >= 70 ? 'warn' : 'ok';
  
    const renderBar = (label, u) => {
      const resetTxt = u && u.resetsAt ? formatResetIn(u.resetsAt) : '';
      const resetHtml = resetTxt
        ? `<span class="acc-bar-reset" title="距离 ${label} 配额刷新还有 ${resetTxt}">${resetTxt}</span>`
        : `<span class="acc-bar-reset"></span>`;
      if (!u || u.pct === null || u.pct === undefined) {
        return `<div class="acc-bar-line"><span class="acc-bar-label">${label}</span><div class="acc-bar-track"><div class="acc-bar-fill dim" style="width:0%"></div></div><span class="acc-bar-pct dim">—</span>${resetHtml}</div>`;
      }
      const pct = Math.round(u.pct);
      const cls = pctCls(pct);
      const w = pct <= 0 ? 0 : Math.max(2, Math.min(100, pct));
      return `<div class="acc-bar-line"><span class="acc-bar-label">${label}</span><div class="acc-bar-track"><div class="acc-bar-fill ${cls}" style="width:${w}%"></div></div><span class="acc-bar-pct ${cls}">${pct}%</span>${resetHtml}</div>`;
    };
  
    const logoSrc = (badgeClass) => {
      if (badgeClass === 'cl') return 'assets/ai-logos/claude.svg';
      if (badgeClass === 'cx') return 'assets/ai-logos/codex.svg';
      return '';
    };
    const renderUsageRow = (badgeClass, name, u5h, u7d, meta = {}) => {
      const src = logoSrc(badgeClass);
      const logoHtml = src
        ? `<img class="acc-ai-logo" src="${src}" alt="${escapeHtml(name)}" title="${escapeHtml(name)}">`
        : `<span class="acc-ai-letters">${badgeClass.toUpperCase()}</span>`;
      const accountLabel = meta.accountEmail || meta.profileLabel || '';
      const title = meta.profileLabel ? `${name} · ${meta.profileLabel}` : name;
      const age = formatAge(meta.lastSeen || 0);
      const source = meta.source ? ` · ${meta.source}` : '';
      const staleCls = usageFreshnessClass(meta.lastSeen || 0);
      const stateText = meta.unavailable ? '无数据' : age;
      const recentResult = usageRefreshState.providerResults
        && usageRefreshState.lastManualAt
        && nowFn() - usageRefreshState.lastManualAt <= 60_000
        ? usageRefreshState.providerResults[meta.providerKey]
        : null;
      let resultLabel = '';
      let resultClass = '';
      if (recentResult) {
        if (!recentResult.ok) { resultLabel = '失败'; resultClass = 'error'; }
        else if (recentResult.mode === 'live') { resultLabel = '实时'; resultClass = 'live'; }
        else if (recentResult.mode === 'fallback') { resultLabel = '回退'; resultClass = 'fallback'; }
        else if (recentResult.changed === false) { resultLabel = '无新快照'; resultClass = 'unchanged'; }
        else { resultLabel = '已更新'; resultClass = 'updated'; }
      }
      const resultTitle = recentResult
        ? `${resultLabel}${recentResult.source ? ` · ${recentResult.source}` : ''}${recentResult.error ? ` · ${recentResult.error}` : ''}`
        : '';
      const resultHtml = resultLabel
        ? `<span class="acc-refresh-status ${resultClass}" title="${escapeHtml(resultTitle)}">${escapeHtml(resultLabel)}</span>`
        : '';
      const refreshTitle = usageRefreshState.error
        ? `立即刷新用量 · 上次失败: ${usageRefreshState.error}`
        : recentResult && recentResult.error
          ? `立即刷新用量 · ${resultTitle}`
          : `立即刷新用量 · ${stateText}${source}`;
      const refreshHtml = meta.refreshable
        ? `<button class="acc-refresh-btn${usageRefreshState.inFlight ? ' loading' : ''}" data-action="refresh-usage" title="${escapeHtml(refreshTitle)}" aria-label="立即刷新用量">${usageRefreshState.inFlight ? '...' : '↻'}</button>`
        : '';
      // profileLabel 只在 Codex 行显示（Claude 没有 profile 概念）。
      // 直接显示在 badge 旁边，让用户一眼看出当前监控的是哪个账号——
      // 否则 UI 上没有区分线索，会和 codex /status 的另一个账号配额混淆。
      const profileChip = accountLabel
        ? `<span class="acc-ai-profile" title="${escapeHtml(accountLabel)}">${escapeHtml(accountLabel)}</span>`
        : '';
      const metaHtml = `<div class="acc-row-meta">${resultHtml}<span class="acc-row-age ${staleCls}" title="${escapeHtml(title)} · ${escapeHtml(stateText)}${escapeHtml(source)}">${escapeHtml(stateText)}</span>${refreshHtml}</div>`;
      return `
        <div class="acc-usage-row" title="${escapeHtml(title)} · ${escapeHtml(stateText)}${escapeHtml(source)}">
          <span class="acc-ai-badge ${badgeClass}">${logoHtml}</span>
          ${profileChip}
          <div class="acc-bars">
            ${renderBar('5h', u5h)}
            ${renderBar('7d', u7d)}
          </div>
          ${metaHtml}
        </div>
      `;
    };
  
    const c = agentUsage.codex || {};
    el.innerHTML =
      renderUsageRow('cl', 'Claude', accountUsage.usage5h, accountUsage.usage7d, {
        providerKey: 'claude',
        lastSeen: _claudeUsageLastSeen,
        refreshable: true,
        source: 'statusline',
      }) +
      renderUsageRow('cx', 'Codex', c.usage5h, c.usage7d, {
        providerKey: 'codex',
        ...c,
        lastSeen: agentUsageLastSeen.codex,
        refreshable: true,
      });
  
    el.querySelectorAll('[data-action="refresh-usage"]').forEach(refreshBtn => {
      refreshBtn.addEventListener('click', (event) => {
        event.preventDefault();
        refreshUsageNow().catch(() => {});
      });
    });

  }
  
  setIntervalFn(render, 60000);
  
  function pctClass(pct) {
    if (pct >= 85) return 'danger';
    if (pct >= 70) return 'warn';
    return 'ok';
  }

  return {
    render,
    sessionBurnRate,
    pctClass,
    recordSessionContextSample,
    recordStatusUsage,
    recordAgentUsage,
    applyUsageCache,
    refreshUsageNow,
  };
}

module.exports = { createAccountUsageController };
