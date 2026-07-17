'use strict';

// 串行工作流配置弹窗（2026-06-17 道雪）。
// 纯 UI：接收 members + 当前 config，保存时回调 onSave(config)，不直接碰持久化（解耦）。
// config 结构：{ enabled: bool, templateId: 't1'|'t2'|'t3'|null, steps: [[memberId...], ...] }
// memberId 形如 'm1'/'m2'，与后端 dispatcher.groupMembersForMeeting 的 `m${idx+1}` 对齐。
(function () {

const TEMPLATES = [
  { id: 't1', name: 'T1 逐个接力', desc: '每个 AI 各占一步，按顺序依次串行回答' },
  { id: 't2', name: 'T2 并行 → 汇总', desc: '第 1 步全员并行各自答，第 2 步指定一人收口' },
  { id: 't3', name: 'T3 自定义', desc: '自己定步数，每步任意勾选参与的 AI' },
];
const MAX_STEPS = 8;

let _modalEl = null;
let _state = null;       // { enabled, templateId, steps, members }
let _onSave = null;
let _escListener = null;

function _escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function _aiLogo(kind) { return `assets/ai-logos/${_escapeHtml(kind || 'claude')}.svg`; }
function _memberTitle(memberId) {
  const m = (_state.members || []).find(x => x.memberId === memberId);
  return m ? (m.title || m.memberId) : memberId;
}

function _applyTemplate(tplId) {
  const members = _state.members || [];
  if (tplId === 't1') {
    _state.steps = members.map(m => [m.memberId]);
    if (_state.steps.length === 0) _state.steps = [[]];
  } else if (tplId === 't2') {
    if (members.length === 0) _state.steps = [[]];
    else {
      const all = members.map(m => m.memberId);
      _state.steps = members.length === 1 ? [all] : [all, [members[0].memberId]];
    }
  } else { // t3 自定义：保留现有步骤，至少 1 步
    if (!_state.steps || _state.steps.length === 0) _state.steps = [[]];
  }
  _state.templateId = tplId;
}

function _applyLoopTemplate(id) {
  const members = _state.members || [];
  const ids = members.map(m => m.memberId);
  if (!_state.loop) _state.loop = { enabled: true, maxRounds: 8, consecutivePass: 1, polish: true };
  _state.loop.enabled = true;
  _state.enabled = true;
  if (id === 'L1') {            // 开发 + 1 评审
    _state.steps = ids.length >= 2 ? [[ids[0]], [ids[1]]] : [ids.slice(0, 1), []];
  } else if (id === 'L2') {     // 开发 + 2 评审（同质冗余）
    _state.steps = ids.length >= 3 ? [[ids[0]], [ids[1]], [ids[2]]]
      : (ids.length === 2 ? [[ids[0]], [ids[1]]] : [ids.slice(0, 1), []]);
  } else {                      // L3 自定义：保留现有步骤
    if (!_state.steps || !_state.steps.length) _state.steps = [[]];
  }
  _state.loopTemplateId = id;
  _state.templateId = null;
}

function _setStepCount(n) {
  const steps = _state.steps || [];
  n = Math.max(1, Math.min(MAX_STEPS, n));
  while (steps.length < n) steps.push([]);
  while (steps.length > n) steps.pop();
  _state.steps = steps;
  _state.templateId = null; // 手动改步数 → 视为自定义
}

function _toggleMember(stepIdx, memberId) {
  const step = _state.steps[stepIdx];
  if (!step) return;
  const i = step.indexOf(memberId);
  if (i >= 0) step.splice(i, 1); else step.push(memberId);
  _state.templateId = null;
}

function _syncLoopInputs() {
  if (!_state.loop) _state.loop = { enabled: false, maxRounds: 8, consecutivePass: 1, polish: true };
  const r = _modalEl && _modalEl.querySelector('#wf-loop-rounds');
  const g = _modalEl && _modalEl.querySelector('#wf-loop-green');
  if (r && r.value) _state.loop.maxRounds = Math.max(1, Math.min(30, parseInt(r.value, 10) || 8));
  if (g && g.value) _state.loop.consecutivePass = Math.max(1, Math.min(3, parseInt(g.value, 10) || 1));
}

function _previewHtml() {
  const steps = _state.steps || [];
  if (!steps.length) return '<span class="wf-empty">还没有步骤</span>';
  return steps.map(step => {
    if (!step.length) return '<span class="wf-empty">(未选)</span>';
    return step.map(mid => _escapeHtml(_memberTitle(mid))).join('<span class="wf-plus">+</span>');
  }).join('<span class="wf-arrow">→</span>');
}

function _bodyHtml() {
  const s = _state;
  const tplCards = TEMPLATES.map(t =>
    `<div class="wf-tpl-card${s.templateId === t.id ? ' selected' : ''}" data-wf="tpl" data-tpl="${t.id}">
       <div class="wf-tpl-name">${_escapeHtml(t.name)}</div>
       <div class="wf-tpl-desc">${_escapeHtml(t.desc)}</div>
     </div>`).join('');

  const loopOn = !!(s.loop && s.loop.enabled);
  const stepRows = (s.steps || []).map((step, idx) => {
    const chips = (s.members || []).map(m => {
      const sel = step.includes(m.memberId);
      return `<span class="wf-member-chip${sel ? ' selected' : ''}" data-wf="chip" data-step="${idx}" data-member="${_escapeHtml(m.memberId)}">
                <img src="${_aiLogo(m.kind)}" alt="">${_escapeHtml(m.title || m.memberId)}
              </span>`;
    }).join('');
    const roleTag = loopOn
      ? `<span style="font-size:11px;font-weight:700;padding:2px 7px;border-radius:5px;margin-right:6px;${idx === 0 ? 'background:rgba(10,132,255,.18);color:#0a84ff' : 'background:rgba(255,69,58,.16);color:#ff453a'}">${idx === 0 ? '开发' : '评审'}</span>`
      : '';
    return `<div class="wf-step-row">
              <span class="wf-step-index">${idx + 1}</span>
              ${roleTag}
              <div class="wf-member-chips">${chips || '<span class="wf-empty">群里暂无可选 AI</span>'}</div>
            </div>`;
  }).join('');

  const stepCount = (s.steps || []).length;

  return `
    <div class="wf-toggle-row">
      <div class="wf-toggle-text">
        <div class="wf-toggle-title">启用串行工作流</div>
        <div class="wf-toggle-sub">开启后，发送的问题会按下面的步骤依次问各步的 AI（每步内多个 AI 并行）；关闭则恢复普通群聊。</div>
      </div>
      <button type="button" class="wf-switch${s.enabled ? ' on' : ''}" data-wf="toggle" aria-label="启用开关"></button>
    </div>
    <div class="wf-config-area${s.enabled ? '' : ' disabled'}">
      <div class="wf-section-label">预设模板</div>
      <div class="wf-templates">${tplCards}</div>
      <div class="wf-section-label">步骤数</div>
      <div class="wf-stepcount">
        <button type="button" class="wf-stepper-btn" data-wf="step-dec"${stepCount <= 1 ? ' disabled' : ''}>−</button>
        <span class="wf-stepcount-val">${stepCount}</span>
        <button type="button" class="wf-stepper-btn" data-wf="step-inc"${stepCount >= MAX_STEPS ? ' disabled' : ''}>＋</button>
      </div>
      <div class="wf-section-label">每步参与的 AI（点击切换，可选同一个 AI 出现在多步）</div>
      <div class="wf-steps">${stepRows}</div>
      <div class="wf-preview">
        <span class="wf-preview-label">流程预览</span>
        ${_previewHtml()}
      </div>
      <div class="wf-section-label" style="margin-top:16px">🔁 循环模式（评审不过自动重来 · 达标后打磨）</div>
      <div style="display:flex;align-items:center;gap:18px;font-size:13px;padding:4px 0">
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
          <input type="checkbox" data-wf="loop-toggle" ${(s.loop && s.loop.enabled) ? 'checked' : ''}> 启用循环
        </label>
        <span>最多 <input id="wf-loop-rounds" type="number" min="1" max="30" value="${(s.loop && s.loop.maxRounds) || 8}" style="width:54px;padding:2px 6px"> 轮</span>
        <span>连续 <input id="wf-loop-green" type="number" min="1" max="3" value="${(s.loop && s.loop.consecutivePass) || 1}" style="width:46px;padding:2px 6px"> 轮绿即达标</span>
      </div>
      <div style="font-size:12px;opacity:.65;margin-top:4px;line-height:1.5">循环模式下：第 1 步的 AI = 开发者；第 2 步起的 AI = 评审者（每个都"验证卡门+提优化"，两个都通过才算达标）。</div>
      ${(s.loop && s.loop.enabled) ? `<div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;align-items:center">
        <span style="font-size:12px;opacity:.7">一键预设：</span>
        <button type="button" class="wf-tpl-card${s.loopTemplateId === 'L1' ? ' selected' : ''}" data-wf="loop-tpl" data-ltpl="L1" style="padding:6px 11px;font-size:12px">L1 开发+1评审</button>
        <button type="button" class="wf-tpl-card${s.loopTemplateId === 'L2' ? ' selected' : ''}" data-wf="loop-tpl" data-ltpl="L2" style="padding:6px 11px;font-size:12px">L2 开发+2评审</button>
        <button type="button" class="wf-tpl-card${s.loopTemplateId === 'L3' ? ' selected' : ''}" data-wf="loop-tpl" data-ltpl="L3" style="padding:6px 11px;font-size:12px">L3 自定义</button>
      </div>` : ''}
    </div>
  `;
}

function _ensureModal() {
  if (_modalEl && document.body.contains(_modalEl)) return _modalEl;
  _modalEl = document.createElement('div');
  _modalEl.id = 'workflow-config-modal';
  _modalEl.className = 'mcm-overlay';
  _modalEl.style.display = 'none';
  _modalEl.innerHTML = `
    <div class="mcm-dialog" role="dialog" aria-labelledby="wf-title-text" style="width:560px">
      <div class="mcm-header">
        <span class="mcm-title" id="wf-title-text">🔀 串行工作流</span>
        <button class="mcm-close" aria-label="关闭">×</button>
      </div>
      <div class="mcm-body" id="wf-body"></div>
      <div class="mcm-footer">
        <button class="mcm-cancel">取消</button>
        <button class="mcm-primary wf-save">保存</button>
      </div>
    </div>`;
  document.body.appendChild(_modalEl);
  _bindEvents();
  return _modalEl;
}

function _renderBody() {
  const body = _modalEl.querySelector('#wf-body');
  if (body) body.innerHTML = _bodyHtml();
}

function _bindEvents() {
  // 事件委托绑在 overlay 上，body innerHTML 重渲不影响该监听器。
  _modalEl.addEventListener('click', (e) => {
    if (e.target === _modalEl) { closeWorkflowConfigModal(); return; }
    if (e.target.closest('.mcm-close') || e.target.closest('.mcm-cancel')) { closeWorkflowConfigModal(); return; }
    if (e.target.closest('.wf-save')) { _save(); return; }
    const node = e.target.closest('[data-wf]');
    if (!node) return;
    const action = node.getAttribute('data-wf');
    if (action === 'toggle') { _state.enabled = !_state.enabled; _renderBody(); }
    else if (action === 'tpl') { _applyTemplate(node.getAttribute('data-tpl')); _renderBody(); }
    else if (action === 'step-inc') { _setStepCount((_state.steps || []).length + 1); _renderBody(); }
    else if (action === 'step-dec') { _setStepCount((_state.steps || []).length - 1); _renderBody(); }
    else if (action === 'chip') {
      _toggleMember(parseInt(node.getAttribute('data-step'), 10), node.getAttribute('data-member'));
      _renderBody();
    }
    else if (action === 'loop-toggle') {
      _syncLoopInputs();
      _state.loop.enabled = !_state.loop.enabled;
      _renderBody();
    }
    else if (action === 'loop-tpl') {
      _syncLoopInputs();
      _applyLoopTemplate(node.getAttribute('data-ltpl'));
      _renderBody();
    }
  });
}

function _save() {
  _syncLoopInputs();
  const steps = (_state.steps || []).map(s => [...s]).filter(s => s.length > 0);
  const loopOn = !!(_state.loop && _state.loop.enabled) && steps.length > 0;
  const config = {
    enabled: (!!_state.enabled || loopOn) && steps.length > 0,
    templateId: _state.templateId || null,
    steps,
    loop: {
      enabled: loopOn,
      maxRounds: (_state.loop && _state.loop.maxRounds) || 8,
      consecutivePass: (_state.loop && _state.loop.consecutivePass) || 1,
      polish: !(_state.loop && _state.loop.polish === false),
    },
  };
  if (typeof _onSave === 'function') _onSave(config);
  closeWorkflowConfigModal();
}

function openWorkflowConfigModal({ members = [], config = null, onSave = null } = {}) {
  _ensureModal();
  _onSave = onSave;
  const cfg = (config && typeof config === 'object') ? config : null;
  _state = {
    enabled: cfg ? !!cfg.enabled : false,
    templateId: (cfg && cfg.templateId) ? cfg.templateId : null,
    steps: (cfg && Array.isArray(cfg.steps) && cfg.steps.length)
      ? cfg.steps.map(s => Array.isArray(s) ? [...s] : [])
      : null,
    loop: (cfg && cfg.loop && typeof cfg.loop === 'object')
      ? { enabled: !!cfg.loop.enabled, maxRounds: cfg.loop.maxRounds || 8, consecutivePass: cfg.loop.consecutivePass || 1, polish: cfg.loop.polish !== false }
      : { enabled: false, maxRounds: 8, consecutivePass: 1, polish: true },
    members: (members || []).map(m => ({ memberId: m.memberId, kind: m.kind, title: m.title })),
  };
  // 没有历史配置 → 默认装填 T1（逐个接力），给用户一个起点
  if (!_state.steps) _applyTemplate('t1');
  _renderBody();
  _modalEl.style.display = 'flex';
  if (_escListener) document.removeEventListener('keydown', _escListener);
  _escListener = (e) => { if (e.key === 'Escape' && _modalEl.style.display !== 'none') closeWorkflowConfigModal(); };
  document.addEventListener('keydown', _escListener);
}

function closeWorkflowConfigModal() {
  if (_modalEl) _modalEl.style.display = 'none';
  if (_escListener) { document.removeEventListener('keydown', _escListener); _escListener = null; }
}

window.openWorkflowConfigModal = openWorkflowConfigModal;
window.closeWorkflowConfigModal = closeWorkflowConfigModal;
})();
