'use strict';

const fs = require('fs');
const path = require('path');
const { KIND_LABELS } = require('./ai-kinds.js');

const STATE_VERSION = 2;

function arenaPromptsDir(hubDataDir) {
  return path.join(hubDataDir, 'arena-prompts');
}

function groupChatStatePath(hubDataDir, meetingId) {
  return path.join(arenaPromptsDir(hubDataDir), `${meetingId}-groupchat.json`);
}

function cleanup(hubDataDir, meetingId) {
  const fp = groupChatStatePath(hubDataDir, meetingId);
  try {
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
  } catch {}
}

function rawMessageAnchor(meetingId, messageId) {
  return `raw://group/${meetingId}/msg/${messageId}`;
}

function _clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function _memberLabel(member) {
  if (!member) return 'AI';
  return member.displayName || member.alias || KIND_LABELS[member.kind] || member.kind || member.memberId || 'AI';
}

// （投研场景 prompt 与交易纪律已在通用版移除。）

// 2026-06-05 联邦记忆下线：原 MEMORY_DISCIPLINE_PROMPT 教各家 AI 写 memory 的指令段已删除。
// 记忆维护完全交给 Claude/Codex 各自原生 auto-memory 能力，群聊 prompt 不再越俎代庖。

function buildSystemPromptText(displayName, scene, opts = {}) {
  const name = displayName || 'AI';
  const parts = [
    '## 规则',
    `- 这里是AI群聊，你是${name}。可赞同、反对、追问、反问用户及其他群聊队友或另起话题。`,
    '- 独到见解 > 全面但泛泛而谈。',
    '',
    '## 输出',
    '简单问题直答；复杂分析 / 多方案 / 含表格时，用清晰的结构化条理组织回答（要点、对比、结论分明）。',
  ];
  return parts.join('\n');
}

class GroupChatOrchestrator {
  constructor(hubDataDir, meetingId) {
    this.hubDataDir = hubDataDir;
    this.meetingId = meetingId;
    this.state = {
      schemaVersion: STATE_VERSION,
      meetingId,
      currentTurn: 0,
      currentMode: 'idle',
      messages: [],
      lastDeliveredIdx: {},
      turns: [],
      aiStats: {},
    };
    this._activePrompts = {};
    this._loadState();
  }

  _stateFilePath() {
    return groupChatStatePath(this.hubDataDir, this.meetingId);
  }

  _loadState() {
    const fp = this._stateFilePath();
    if (!fs.existsSync(fp)) return;
    try {
      const raw = JSON.parse(fs.readFileSync(fp, 'utf-8'));
      if (raw && raw.meetingId === this.meetingId) {
        const { summarySegments, ...rest } = raw;
        this.state = {
          schemaVersion: STATE_VERSION,
          currentMode: 'idle',
          turns: [],
          aiStats: {},
          ...rest,
          meetingId: this.meetingId,
          messages: Array.isArray(raw.messages) ? raw.messages : [],
          lastDeliveredIdx: raw.lastDeliveredIdx && typeof raw.lastDeliveredIdx === 'object' ? raw.lastDeliveredIdx : {},
        };
      }
    } catch (e) {
      console.warn(`[groupchat] load state failed for ${this.meetingId}:`, e.message);
    }
  }

  _saveState() {
    const fp = this._stateFilePath();
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, JSON.stringify(this.state, null, 2), 'utf-8');
  }

  getState() {
    return _clone(this.state);
  }

  beginTurn(userInput, opts = {}) {
    const requestedTurnNum = Number(opts.turnNum);
    const n = Number.isInteger(requestedTurnNum) && requestedTurnNum > 0
      ? requestedTurnNum
      : (this.state.currentTurn || 0) + 1;
    const appendUserMessage = opts.appendUserMessage !== false;
    this.state.currentTurn = Math.max(this.state.currentTurn || 0, n);
    this.state.currentMode = 'group';
    let msg = this.state.messages.find(m => m.id === `u${n}` && m.role === 'user') || null;
    let didAppendUserMessage = false;
    if (appendUserMessage && !msg) {
      msg = this._appendMessage({
        id: `u${n}`,
        turnNum: n,
        role: 'user',
        speaker: '你',
        content: userInput || '',
      });
      didAppendUserMessage = true;
    }
    this._saveState();
    return { turnNum: n, userMessage: msg, didAppendUserMessage };
  }

  rollbackTurn(turnNum) {
    this.state.messages = this.state.messages.filter(m => m.turnNum !== turnNum);
    this.state.turns = this.state.turns.filter(t => t.n !== turnNum);
    const lastIdx = this.state.messages.length - 1;
    for (const sid of Object.keys(this.state.lastDeliveredIdx || {})) {
      if (this.state.lastDeliveredIdx[sid] > lastIdx) this.state.lastDeliveredIdx[sid] = lastIdx;
    }
    this.state.currentTurn = Math.max(0, ...this.state.turns.map(t => t.n || 0));
    this.state.currentMode = 'idle';
    delete this._activePrompts[turnNum];
    this._saveState();
  }

  _appendMessage(msg) {
    const message = {
      createdAt: Date.now(),
      ...msg,
    };
    message.anchor = rawMessageAnchor(this.meetingId, message.id);
    this.state.messages.push(message);
    return message;
  }

  recordTurnPrompt(turnNum, sid, prompt) {
    if (!this._activePrompts[turnNum]) this._activePrompts[turnNum] = {};
    this._activePrompts[turnNum][sid] = prompt || '';
  }

  getActivePrompt(turnNum) {
    const promptBy = this._activePrompts[turnNum];
    return promptBy ? { promptBy } : null;
  }

  setSendStatus(_turnNum, _sid, _status) {
    // Group chat keeps transient send state in renderer partials; this method
    // preserves the shared watcher recovery contract.
  }

  buildDelta(selfSid, userInput, opts = {}) {
    const lastIdx = this.state.lastDeliveredIdx[selfSid] ?? -1;
    const currentUserMessageAppended = opts.currentUserMessageAppended !== false;
    // [全量注入] 投委会幕间传 includeCommitteeMid:true——把中间幕发言全文注入下一幕，让每个委员看到
    //   队友调研全文（群聊式，dispatchInternalPrompt 用）。自由聊默认 false：中间幕不灌回、只带 outcome
    //   （末轮辩论+收敛），省 token 不灌爆上下文（点6）。
    const includeCommitteeMid = opts.includeCommitteeMid === true;
    const cutoff = currentUserMessageAppended
      ? Math.max(0, this.state.messages.length - 1)
      : this.state.messages.length;
    const newMsgs = this.state.messages
      .slice(lastIdx + 1, cutoff)
      .filter(m => m.role !== 'user' && m.sid !== selfSid && m.content && (includeCommitteeMid || !(m.committeeAct && !m.committeeOutcome)));
    const parts = [];
    if (newMsgs.length > 0) {
      parts.push('## 新增发言\n' + newMsgs.map(m => `${m.speaker}：${m.content}`).join('\n\n'));
    }
    parts.push('## 用户\n' + (userInput || ''));
    parts.push('请发言。');
    return parts.join('\n\n');
  }

  buildFirstDelta(selfSid, userInput, systemPromptText, opts = {}) {
    if (this.state.lastDeliveredIdx[selfSid] === undefined) {
      return String(systemPromptText || '') + '\n\n' + this.buildDelta(selfSid, userInput, opts);
    }
    return this.buildDelta(selfSid, userInput, opts);
  }

  completeTurn(turnNum, userInput, results, memberBySid, statsBySid = {}, opts = {}) {
    let turn = this.state.turns.find(t => t.n === turnNum);
    const isExistingTurn = !!turn;
    const by = isExistingTurn && turn.by && typeof turn.by === 'object' ? turn.by : {};
    const byStatus = isExistingTurn && turn.byStatus && typeof turn.byStatus === 'object' ? turn.byStatus : {};
    const thinkSecBy = isExistingTurn && turn.thinkSecBy && typeof turn.thinkSecBy === 'object' ? turn.thinkSecBy : {};
    const tokensBy = isExistingTurn && turn.tokensBy && typeof turn.tokensBy === 'object' ? turn.tokensBy : {};
    const aiMessages = [];

    for (const r of results) {
      const sid = r.sid;
      const member = memberBySid[sid] || {};
      // [查看本轮 prompt] 该 AI 本轮实际收到的完整 prompt（dispatcher 已 recordTurnPrompt 存入 _activePrompts，
      //   本循环结束前不会被 delete），随消息持久化，供前端气泡「📥 查看 prompt」弹窗复盘/优化。
      const _srcPrompt = (this._activePrompts[turnNum] && this._activePrompts[turnNum][sid]) || '';
      // 2026-06-21 道雪：与 patchTurnResult 对齐——仅确有新文本时写正文；
      //   errored/超时返回空文本时保留已有答案，防重发/串行工作流抹掉已生成内容。
      // 2026-07-12 道雪收紧：completed 空文本（process_exit_clean 兜底 settle）同样
      //   不得覆盖——旧规则"成功态无条件写"会让干净退出的 CLI 把已有/已手动同步的
      //   答案抹成空气泡。真理源统一为 by[sid]，消息正文从 by[sid] 取，不再直接用 r.text。
      const _rStatus = r.status || 'completed';
      // trim 判空与渲染层口径一致（多方审查加固）：纯空白文本视为无内容，不覆盖已有答案。
      const _writeContent = !!(r.text && String(r.text).trim().length);
      by[sid] = _writeContent ? r.text : (by[sid] || '');
      // 状态守卫：本轮已被手动同步（manual_extracted）且新结果没带更有效文本时，
      //   保留 manual_extracted——对齐 waitTurnComplete.onTurnPatched 的同名守卫，
      //   防止"手动救回的答案"在整轮 settle 时又被标回 errored。
      const _prevStatus = byStatus[sid];
      byStatus[sid] = (_prevStatus === 'manual_extracted' && !_writeContent) ? 'manual_extracted' : _rStatus;
      // 空结果（重发失败/干净退出兜底）不把已有 thinkSec/tokens 统计清零（多方审查加固）。
      thinkSecBy[sid] = statsBySid[sid]?.thinkSec || r.thinkSec || thinkSecBy[sid] || 0;
      tokensBy[sid] = statsBySid[sid]?.tokens || (r.tokens && r.tokens.total) || tokensBy[sid] || 0;
      const messageId = `a${turnNum}-${member.memberId || sid.slice(0, 8)}`;
      const _failReason = (byStatus[sid] === 'errored' && r.reason) ? String(r.reason) : null;
      let msg = this.state.messages.find(m => m.id === messageId && m.role === 'assistant');
      if (msg) {
        msg.sid = sid;
        msg.memberId = member.memberId || sid;
        msg.speaker = _memberLabel(member);
        msg.content = by[sid] || '';
        msg.status = byStatus[sid];
        msg.updatedAt = Date.now();
        if (_srcPrompt) msg.sourcePrompt = _srcPrompt;
        // 迟到的无 reason errored 不抹掉已持久化的失败原因；非 errored 终态才清除。
        if (_failReason) msg.statusReason = _failReason;
        else if (byStatus[sid] !== 'errored') delete msg.statusReason;
      } else {
        msg = this._appendMessage({
          id: messageId,
          turnNum,
          role: 'assistant',
          sid,
          memberId: member.memberId || sid,
          speaker: _memberLabel(member),
          content: by[sid] || '',
          status: byStatus[sid],
          sourcePrompt: _srcPrompt,
          ...(_failReason ? { statusReason: _failReason } : {}),
        });
      }
      aiMessages.push(msg);

      const prev = this.state.aiStats[sid] || { totalThinkSec: 0, totalTokens: 0, turns: 0 };
      prev.totalThinkSec += thinkSecBy[sid] || 0;
      prev.totalTokens += tokensBy[sid] || 0;
      prev.turns += 1;
      prev.kind = member.kind || prev.kind;
      prev.model = member.model || prev.model;
      this.state.aiStats[sid] = prev;
    }

    if (!turn) {
      turn = {
        n: turnNum,
        mode: 'group',
        userInput: userInput || '',
        by,
        byStatus,
        thinkSecBy,
        tokensBy,
        timestamp: Date.now(),
        meta: {
          dispatchMode: opts.dispatchMode || 'group',
        },
      };
      this.state.turns.push(turn);
    } else {
      turn.userInput = turn.userInput || userInput || '';
      turn.by = by;
      turn.byStatus = byStatus;
      turn.thinkSecBy = thinkSecBy;
      turn.tokensBy = tokensBy;
      turn.lastUpdatedAt = Date.now();
      turn.meta = turn.meta && typeof turn.meta === 'object' ? turn.meta : {};
      if (opts.dispatchMode) turn.meta.dispatchMode = opts.dispatchMode;
    }
    this.state.currentMode = 'idle';
    delete this._activePrompts[turnNum];
    const lastIdx = this.state.messages.length - 1;
    for (const r of results) {
      this.state.lastDeliveredIdx[r.sid] = Number.isInteger(r.deliveredIdx) ? r.deliveredIdx : lastIdx;
    }
    this._saveState();
    return turn;
  }

  // silent 内部编排（投委会五幕）每幕后调：标记这些委员已收到 systemPrompt 并对齐到当前 messages
  // 末尾，使后续幕 buildFirstDelta 走增量、不再每幕全量重发规则（点2 上下文污染根因）。故意不写
  // messages（silent 不污染自由聊 transcript）——委员靠各自持久 CLI 会话记忆延续上下文。
  markDeliveredSilent(results) {
    const lastIdx = this.state.messages.length - 1;
    for (const r of results || []) {
      if (!r || !r.sid) continue;
      this.state.lastDeliveredIdx[r.sid] = Number.isInteger(r.deliveredIdx) ? r.deliveredIdx : lastIdx;
    }
    this._saveState();
  }

  // 投委会发言落进群聊 messages（带 committeeAct 幕次 meta）——每个 AI 发言以气泡卡片承载在群聊主
  // 界面、按时间排列（阶段二 UI）。actMeta.outcome=true 的（末轮辩论 / 主席收敛）额外标 committeeOutcome：
  // 这类会被 buildDelta 带给回归自由聊后没看到的 AI（点6）；中间幕发言 buildDelta 跳过（省 token）。
  // 只写 messages、不写 turns —— 不进群聊 turn 列表，仅作气泡渲染 + 选择性上下文传递。
  appendCommitteeSpeeches(items, actMeta = {}) {
    const list = (items || []).filter(it => it && it.sid && String(it.content || '').trim());
    if (!list.length) return 0;
    for (const it of list) {
      this._appendMessage({
        id: `committee-${actMeta.act || 'x'}-${String(it.sid).slice(0, 8)}-${this.state.messages.length}`,
        role: 'assistant',
        sid: it.sid,
        memberId: it.memberId || it.sid,
        speaker: it.speaker || '委员',
        content: String(it.content),
        status: 'completed',
        committeeAct: actMeta.act || '',
        committeeRound: actMeta.round,
        committeeSub: actMeta.sub || '',
        committeeOutcome: !!actMeta.outcome,
        sourcePrompt: it.prompt || '',
      });
    }
    this._saveState();
    return list.length;
  }

  // 兼容旧入口（点6）：末轮+主席发言，标 outcome。新代码走 appendCommitteeSpeeches。
  appendCommitteeOutcome(items) { return this.appendCommitteeSpeeches(items, { outcome: true }); }

  clearTurnInProgress(turnNum) {
    if (!turnNum || this.state.currentTurn !== turnNum) return;
    this.state.currentMode = 'idle';
    delete this._activePrompts[turnNum];
    this._saveState();
  }

  patchTurnResult(turnNum, sid, { text, status, thinkSec, tokens } = {}) {
    const turn = this.state.turns.find(t => t.n === turnNum);
    if (!turn) return null;
    turn.by = turn.by || {};
    turn.byStatus = turn.byStatus || {};
    turn.thinkSecBy = turn.thinkSecBy || {};
    turn.tokensBy = turn.tokensBy || {};
    // 2026-07-12 道雪：成功态也必须"确有文本"才写——空文本 patch 不得抹掉已有答案
    //   （与 completeTurn 同规则，真理源 by[sid]；trim 判空与渲染层口径一致）。
    const _writeContent = (status === 'completed' || status === 'manual_extracted') && !!(text && String(text).trim().length);
    if (_writeContent) {
      turn.by[sid] = text;
    }
    // manual_extracted 守卫与 completeTurn 对齐（多方审查加固）：没带更有效文本的
    //   patch 不得把手动救回的状态打回。现有调用方（manual-extract handler /
    //   onTurnPatched）本就传对状态，这里是状态机层面的不变量兜底。
    const _prevPatchStatus = turn.byStatus[sid];
    const _finalStatus = (_prevPatchStatus === 'manual_extracted' && !_writeContent)
      ? 'manual_extracted'
      : (status || 'completed');
    turn.byStatus[sid] = _finalStatus;
    if (typeof thinkSec === 'number') turn.thinkSecBy[sid] = thinkSec;
    if (tokens && typeof tokens.total === 'number') turn.tokensBy[sid] = tokens.total;
    turn.lastPatchedAt = Date.now();

    const msg = this.state.messages.find(m => m.turnNum === turnNum && m.role === 'assistant' && m.sid === sid);
    if (msg) {
      if (_writeContent) msg.content = text;
      msg.status = _finalStatus;
      msg.patchedAt = turn.lastPatchedAt;
      // 手动同步/补全成功即撤掉旧失败原因，避免"已修复但仍显示失败原因"。
      if (_writeContent) delete msg.statusReason;
    }

    this._saveState();
    return _clone(turn);
  }

  searchRaw(query, limit = 20) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return [];
    return this.state.messages
      .filter(m => String(m.content || '').toLowerCase().includes(q))
      .slice(-Math.max(1, limit))
      .map(m => ({
        id: m.id,
        anchor: m.anchor,
        speaker: m.speaker,
        turnNum: m.turnNum,
        snippet: String(m.content || '').replace(/\s+/g, ' ').trim(),
      }));
  }

  readRaw(messageId) {
    const id = String(messageId || '').trim();
    return this.state.messages.find(m => m.id === id || m.anchor === id) || null;
  }
}

const _cache = new Map();

function getOrchestrator(hubDataDir, meetingId) {
  const key = `${hubDataDir}::${meetingId}`;
  if (!_cache.has(key)) _cache.set(key, new GroupChatOrchestrator(hubDataDir, meetingId));
  return _cache.get(key);
}

module.exports = {
  getOrchestrator,
  groupChatStatePath,
  cleanup,
  rawMessageAnchor,
  buildSystemPromptText,
  _private: { buildSystemPromptText },
};
