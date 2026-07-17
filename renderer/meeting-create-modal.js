'use strict';

(function () {
const { ipcRenderer } = require('electron');
const { KIND_LABELS } = require('../core/ai-kinds.js');
const { MODEL_OPTIONS_BY_KIND, DEFAULT_MODEL_BY_KIND } = require('../core/model-options.js');
const { findUnavailableKinds } = require('../core/provider-readiness.js');

const DEFAULT_SLOTS = [
  { kind: 'claude', model: DEFAULT_MODEL_BY_KIND.claude },
  { kind: 'codex', model: DEFAULT_MODEL_BY_KIND.codex },
  { kind: 'deepseek', model: DEFAULT_MODEL_BY_KIND.deepseek },
];
const DEFAULT_GROUP_MEMBERS = DEFAULT_SLOTS.map(x => ({ ...x }));
const MAX_GROUP_MEMBERS = 3;
const SLOT_NAMES = ['一号位', '二号位', '三号位'];

let _modalEl = null;
let _isGroupChat = true;
let _groupSlots = DEFAULT_GROUP_MEMBERS.map(x => ({ ...x }));
let _escListener = null;
// AI readiness ({claude,codex,gemini,deepseek: bool}); null = unknown (no marks).
// Refreshed on every modal open so the member dropdowns can flag AIs that are
// not installed / not configured — picking one would hang at "创建中" forever.
let _readiness = null;
let _readinessLoading = false;

function _kindReady(kind) {
  return !_readiness || _readiness[kind] !== false;
}

function _kindOptionLabel(kind) {
  const base = KIND_LABELS[kind] || kind;
  if (_kindReady(kind)) return base;
  return kind === 'deepseek' ? `${base}（需 Claude CLI + API Key）` : `${base}（未检测到）`;
}

async function _refreshReadiness() {
  _readinessLoading = true;
  _updateCreateState();
  try {
    const readiness = await ipcRenderer.invoke('get-ai-readiness');
    if (!readiness || typeof readiness !== 'object') throw new Error('empty readiness result');
    _readiness = readiness;
    if (_modalEl && _modalEl.style.display !== 'none') {
      const readyKinds = Object.keys(MODEL_OPTIONS_BY_KIND).filter(kind => _readiness[kind] === true);
      _groupSlots = readyKinds.length > 0
        ? readyKinds.slice(0, MAX_GROUP_MEMBERS).map(kind => ({ kind, model: DEFAULT_MODEL_BY_KIND[kind] || '' }))
        : [{ ...DEFAULT_GROUP_MEMBERS[0] }];
      _renderSlots();
      _renderReadyHint();
    }
  } catch (error) {
    _readiness = null;
    console.error('[meeting-create-modal] readiness detection failed:', error);
  } finally {
    _readinessLoading = false;
    _renderReadyHint();
    _updateCreateState();
  }
}

function _renderReadyHint() {
  if (!_modalEl) return;
  const hint = _modalEl.querySelector('#mcm-ready-hint');
  if (!hint) return;
  if (_readinessLoading) {
    hint.style.display = 'block';
    hint.textContent = '正在检测本机 AI CLI 与 DeepSeek 配置…';
    return;
  }
  if (!_readiness) {
    hint.style.display = 'block';
    hint.textContent = '⚠ AI 状态检测失败。为避免创建永久等待的卡片，本次暂不能创建；请关闭弹窗后重试。';
    return;
  }
  const missing = _readiness
    ? Object.keys(_readiness).filter(k => _readiness[k] === false).map(k => KIND_LABELS[k] || k)
    : [];
  if (missing.length === 0) { hint.style.display = 'none'; hint.textContent = ''; return; }
  hint.style.display = 'block';
  hint.textContent = `⚠ ${missing.join(' / ')} 尚未具备启动条件（未装 CLI 或未配 Key），已禁止选择。可先到 ⚙️ 设置 完成配置。`;
}

function _selectedSlots() {
  if (!_modalEl) return [];
  return Array.from(_modalEl.querySelectorAll('.mcm-slot')).map((el, i) => ({
    index: i,
    kind: el.querySelector('.mcm-ai-select').value,
    model: el.querySelector('.mcm-model-select').value,
  }));
}

function _updateCreateState() {
  if (!_modalEl) return;
  const createBtn = _modalEl.querySelector('.mcm-create');
  const addBtn = _modalEl.querySelector('#mcm-add-member');
  const slots = _selectedSlots();
  const unavailable = _readiness ? findUnavailableKinds(slots, _readiness) : [];
  const blocked = _readinessLoading || !_readiness || slots.length === 0 || unavailable.length > 0;
  if (createBtn && createBtn.textContent !== '创建群聊中...') {
    createBtn.disabled = blocked;
    createBtn.textContent = _readinessLoading ? '检测中...' : '创建群聊';
  }
  if (addBtn) {
    const anyReady = _readiness && Object.values(_readiness).some(Boolean);
    addBtn.disabled = !anyReady || slots.length >= MAX_GROUP_MEMBERS;
    addBtn.title = slots.length >= MAX_GROUP_MEMBERS ? `最多支持 ${MAX_GROUP_MEMBERS} 位成员` : '';
  }
}

function _escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function _aiLogo(kind) {
  return `assets/ai-logos/${kind}.svg`;
}

function _modelOptions(kind, selected) {
  const opts = MODEL_OPTIONS_BY_KIND[kind] || [];
  return opts.map((option, i) =>
    `<option value="${_escapeHtml(option.id)}"${option.id === selected || (!selected && i === 0) ? ' selected' : ''}>${_escapeHtml(option.label)}</option>`
  ).join('');
}

function _cloneSlots(slots) {
  return (slots || DEFAULT_GROUP_MEMBERS).map(x => ({ ...x }));
}

function _slotHtml(i, spec, isGroup) {
  const def = spec || DEFAULT_SLOTS[i] || DEFAULT_SLOTS[0];
  const aiOptions = Object.keys(MODEL_OPTIONS_BY_KIND).map(k =>
    `<option value="${_escapeHtml(k)}"${k === def.kind ? ' selected' : ''}${_readiness && !_kindReady(k) ? ' disabled' : ''}>${_escapeHtml(_kindOptionLabel(k))}</option>`
  ).join('');
  const avatarSrc = _aiLogo(def.kind);
  const avatarAlt = KIND_LABELS[def.kind] || def.kind;
  const label = isGroup ? `成员 ${i + 1}` : `Slot ${i + 1} · ${SLOT_NAMES[i]}`;
  const removeBtn = isGroup && i >= 1
    ? `<button type="button" class="mcm-remove-member" data-remove-member="${i}" title="移除此成员">×</button>`
    : '';
  return `
    <div class="mcm-slot${isGroup ? ' mcm-group-member' : ''}" data-slot="${i}">
      ${removeBtn}
      <img class="mcm-avatar" src="${_escapeHtml(avatarSrc)}" alt="${_escapeHtml(avatarAlt)}">
      <div class="mcm-slot-label">${_escapeHtml(label)}</div>
      <label>AI: <select class="mcm-ai-select">${aiOptions}</select></label>
      <label>Model: <select class="mcm-model-select">${_modelOptions(def.kind, def.model)}</select></label>
    </div>
  `;
}

function _syncGroupSlotsFromDom() {
  if (!_modalEl || !_isGroupChat) return;
  _groupSlots = Array.from(_modalEl.querySelectorAll('.mcm-slot')).map(el => ({
    kind: el.querySelector('.mcm-ai-select').value,
    model: el.querySelector('.mcm-model-select').value,
  }));
}

function _refreshModelOptions(slotEl) {
  const kind = slotEl.querySelector('.mcm-ai-select').value;
  const modelSel = slotEl.querySelector('.mcm-model-select');
  modelSel.innerHTML = _modelOptions(kind);
  const img = slotEl.querySelector('.mcm-avatar');
  if (_isGroupChat && img) {
    img.src = _aiLogo(kind);
    img.alt = KIND_LABELS[kind] || kind;
  }
}

function _renderSlots() {
  if (!_modalEl) return;
  const wrap = _modalEl.querySelector('.mcm-slots');
  if (!wrap) return;
  const specs = _isGroupChat ? _groupSlots : DEFAULT_SLOTS;
  wrap.innerHTML = specs.map((spec, i) => _slotHtml(i, spec, _isGroupChat)).join('');
  wrap.querySelectorAll('.mcm-slot').forEach(slotEl => {
    slotEl.querySelector('.mcm-ai-select').addEventListener('change', () => {
      _refreshModelOptions(slotEl);
      _syncGroupSlotsFromDom();
      _updateCreateState();
    });
    slotEl.querySelector('.mcm-model-select').addEventListener('change', _syncGroupSlotsFromDom);
  });
  wrap.querySelectorAll('[data-remove-member]').forEach(btn => {
    btn.addEventListener('click', () => {
      _syncGroupSlotsFromDom();
      const idx = parseInt(btn.getAttribute('data-remove-member'), 10);
      if (Number.isInteger(idx) && idx >= 0 && idx < _groupSlots.length) {
        _groupSlots.splice(idx, 1);
        _renderSlots();
        _updateCreateState();
      }
    });
  });
}

function _ensureModal() {
  if (_modalEl && document.body.contains(_modalEl)) return _modalEl;
  _modalEl = document.createElement('div');
  _modalEl.id = 'meeting-create-modal';
  _modalEl.className = 'mcm-overlay';
  _modalEl.style.display = 'none';
  _modalEl.innerHTML = `
    <div class="mcm-dialog" role="dialog" aria-labelledby="mcm-title-text">
      <div class="mcm-header">
        <span class="mcm-title" id="mcm-title-text">新建<span id="mcm-mode-label">AI 群聊</span></span>
        <button class="mcm-close" aria-label="关闭">×</button>
      </div>
      <div class="mcm-body">
        <div class="mcm-name-row">
          <label class="mcm-name-label" for="mcm-title-input">房名（可选）</label>
          <input id="mcm-title-input" class="mcm-title-input" type="text" maxlength="40"
                 placeholder="留空则自动编号：AI 群聊 #N" autocomplete="off">
        </div>
        <div class="mcm-slots"></div>
        <button type="button" class="mcm-add-member" id="mcm-add-member">+ 添加成员</button>
        <div id="mcm-ready-hint" style="display:none; font-size:12px; color:#c47a00; margin-top:8px; line-height:1.6;"></div>
      </div>
      <div class="mcm-footer">
        <button class="mcm-cancel">取消</button>
        <button class="mcm-create mcm-primary">创建群聊</button>
      </div>
    </div>
  `;
  document.body.appendChild(_modalEl);
  _bindEvents();
  return _modalEl;
}

function _bindEvents() {
  _modalEl.querySelector('.mcm-close').addEventListener('click', closeMeetingCreateModal);
  _modalEl.querySelector('.mcm-cancel').addEventListener('click', closeMeetingCreateModal);
  _modalEl.querySelector('.mcm-create').addEventListener('click', _onCreate);
  _modalEl.querySelector('#mcm-add-member').addEventListener('click', () => {
    _syncGroupSlotsFromDom();
    if (_groupSlots.length >= MAX_GROUP_MEMBERS) return;
    const readyKinds = Object.keys(MODEL_OPTIONS_BY_KIND).filter(kind => _kindReady(kind));
    const unused = readyKinds.find(kind => !_groupSlots.some(slot => slot.kind === kind));
    const kind = unused || readyKinds[0];
    if (!kind) return;
    _groupSlots.push({ kind, model: DEFAULT_MODEL_BY_KIND[kind] || '' });
    _renderSlots();
    _updateCreateState();
  });
  _modalEl.addEventListener('click', (e) => {
    if (e.target === _modalEl) closeMeetingCreateModal();
  });
}

async function _onCreate() {
  const slots = _selectedSlots();
  const unavailable = _readiness ? findUnavailableKinds(slots, _readiness) : slots.map(slot => slot.kind);
  if (unavailable.length > 0) {
    _showError(`${unavailable.map(kind => KIND_LABELS[kind] || kind).join(' / ')} 尚未就绪`);
    _updateCreateState();
    return;
  }
  const mode = 'general';
  const scene = 'general';
  const titleInput = _modalEl.querySelector('#mcm-title-input');
  const title = titleInput ? titleInput.value.trim() : '';

  const createBtn = _modalEl.querySelector('.mcm-create');
  createBtn.disabled = true;
  createBtn.textContent = '创建群聊中...';
  _clearError();
  try {
    const meeting = await ipcRenderer.invoke('create-meeting', {
      mode,
      scene,
      slots,
      title,
      groupChat: _isGroupChat,
      groupMode: _isGroupChat ? 'deliberation' : null,
      groupRecentRawN: 5,
      participants: _isGroupChat ? slots.map((_, i) => i) : null,
    });
    if (!meeting || !meeting.id) throw new Error('create-meeting returned empty meeting');
    closeMeetingCreateModal();
    if (typeof selectMeeting === 'function') selectMeeting(meeting.id);
    else if (typeof window.selectMeeting === 'function') window.selectMeeting(meeting.id);
  } catch (e) {
    console.error('[meeting-create-modal] create failed:', e);
    _showError((e && e.message) ? e.message : String(e));
    createBtn.disabled = false;
    createBtn.textContent = '创建群聊';
  }
}

function _showError(text) {
  let bar = _modalEl.querySelector('.mcm-error');
  if (!bar) {
    bar = document.createElement('div');
    bar.className = 'mcm-error';
    const footer = _modalEl.querySelector('.mcm-footer');
    if (footer) footer.before(bar);
  }
  bar.textContent = `创建失败：${text}`;
}

function _clearError() {
  const bar = _modalEl && _modalEl.querySelector('.mcm-error');
  if (bar) bar.remove();
}

function openMeetingCreateModal() {
  _isGroupChat = true;
  _ensureModal();
  _clearError();
  _readiness = null;
  _readinessLoading = true;
  _groupSlots = DEFAULT_GROUP_MEMBERS.map(x => ({ ...x }));
  _renderSlots();
  _renderReadyHint();
  _refreshReadiness();

  const modeLabel = _modalEl.querySelector('#mcm-mode-label');
  modeLabel.textContent = 'AI 群聊';

  const titleInput = _modalEl.querySelector('#mcm-title-input');
  if (titleInput) titleInput.value = '';
  const addBtn = _modalEl.querySelector('#mcm-add-member');
  if (addBtn) addBtn.style.display = 'inline-flex';
  const createBtn = _modalEl.querySelector('.mcm-create');
  createBtn.disabled = true;
  createBtn.textContent = '检测中...';
  _modalEl.style.display = 'flex';
  if (_escListener) document.removeEventListener('keydown', _escListener);
  _escListener = (e) => {
    if (e.key === 'Escape' && _modalEl.style.display !== 'none') closeMeetingCreateModal();
  };
  document.addEventListener('keydown', _escListener);
  _updateCreateState();
}

function closeMeetingCreateModal() {
  if (_modalEl) _modalEl.style.display = 'none';
  if (_escListener) {
    document.removeEventListener('keydown', _escListener);
    _escListener = null;
  }
}

window.openMeetingCreateModal = openMeetingCreateModal;
window.closeMeetingCreateModal = closeMeetingCreateModal;
})();
