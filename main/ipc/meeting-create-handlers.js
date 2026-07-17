'use strict';

const { findUnavailableKinds } = require('../../core/provider-readiness.js');

function createMeetingSubAdder(deps) {
  const {
    fs,
    getHookPort,
    getHubDataDir,
    getMeetingWorkspaceDir,
    getProviderReadiness,
    getSlotPromptName,
    groupchat,
    hookToken,
    isClaudeFamily,
    isCodexBaseKind,
    kindLabels,
    logger = console,
    meetingManager,
    path,
    registerSessionForTap,
    scenes,
    sendToRenderer,
    sessionManager,
    slotIds,
  } = deps;

  function addCodexMcpEntry(sessionOpts, entry) {
    if (!entry) return;
    sessionOpts.codexMcpEntries = [...(sessionOpts.codexMcpEntries || []), entry];
  }

  return async function addMeetingSubInternal(meetingId, kind, opts = {}) {
    const meeting = meetingManager.getMeeting(meetingId);
    let sessionOpts = { ...(opts || {}), meetingId };
    if (opts && opts.model) sessionOpts.model = opts.model;

    let slotId = null;
    if (meeting) {
      const currentSubCount = (meeting.subSessions || []).length;
      if (currentSubCount < slotIds.length) {
        slotId = slotIds[currentSubCount];
      }
      if (!sessionOpts.title) {
        if (meeting.groupChat) {
          const label = kindLabels[kind] || kind || 'AI';
          sessionOpts.title = `${label} ${currentSubCount + 1}`;
        } else if (slotId) {
          sessionOpts.title = getSlotPromptName(slotId);
        }
      }
    }

    if (meeting && meeting.groupChat && sessionOpts.noInheritCursor === undefined) {
      // Headless/background group-chat members often have no renderer xterm
      // attached. With inherited cursor enabled, Windows ConPTY can stop
      // delivering Claude-family TUI output; Codex already forces this off in
      // session-manager. Apply the same safety to every group member.
      sessionOpts.noInheritCursor = true;
    }

    if (!sessionOpts.cwd) {
      // Group members run in a narrow Hub-owned directory. The old public
      // default used the user's entire home directory, which granted a safe
      // session a much broader workspace than the meeting actually needs.
      const workspaceDir = meeting ? getMeetingWorkspaceDir(meetingId) : null;
      if (workspaceDir) {
        try {
          fs.mkdirSync(workspaceDir, { recursive: true });
          sessionOpts.cwd = workspaceDir;
        } catch (err) {
          logger.warn(`[meeting-sub] workspace mkdir failed for ${meetingId}: ${err.message}; sub will use default cwd`);
        }
      }
    }

    const session = sessionManager.createSession(kind, sessionOpts);
    if (!session) return null;
    const updated = meetingManager.addSubSession(meetingId, session.id);
    if (!updated) {
      sessionManager.closeSession(session.id);
      return null;
    }

    registerSessionForTap(session);
    sendToRenderer('session-created', { session });
    const freshMeeting = meetingManager.getMeeting(meetingId);
    sendToRenderer('meeting-updated', { meeting: freshMeeting || updated });
    return { session, meeting: freshMeeting || updated };
  };
}

function registerMeetingCreateIpc(ipcMain, deps) {
  const {
    getHubDataDir,
    getProviderReadiness,
    groupchat,
    kindLabels,
    logger = console,
    meetingManager,
    sendToRenderer,
    slotIds,
  } = deps;
  const addMeetingSubInternal = createMeetingSubAdder(deps);

  ipcMain.handle('create-meeting', async (_e, opts) => {
    const safe = { ...(opts || {}) };
    safe.groupChat = true;
    if (!Array.isArray(safe.slots) || safe.slots.length === 0) {
      throw new Error('请至少选择 1 位 AI 成员。');
    }
    if (safe.slots.length > slotIds.length) {
      throw new Error(`当前编排器最多支持 ${slotIds.length} 位成员，请先移除多余成员。`);
    }
    if (typeof getProviderReadiness !== 'function') {
      throw new Error('AI 就绪状态检测器不可用，请重启应用后再试。');
    }
    const readiness = await getProviderReadiness();
    const unavailableKinds = findUnavailableKinds(safe.slots, readiness);
    if (unavailableKinds.length > 0) {
      const labels = unavailableKinds.map(kind => kindLabels[kind] || kind).join(' / ');
      throw new Error(`${labels} 尚未就绪。请先安装并登录对应 CLI，或为 DeepSeek 配置 API Key。`);
    }
    const hasCustomTitle = typeof safe.title === 'string' && safe.title.trim().length > 0;
    safe.autoTitlePending = !hasCustomTitle;
    safe.userRenamed = hasCustomTitle;
    if (Array.isArray(safe.slots) && safe.slots.length > 0) {
      safe.slotSpecs = safe.slots.map(s => ({
        index: typeof s.index === 'number' ? s.index : null,
        kind: s.kind,
        model: s.model || null,
      }));
      if (safe.groupChat && !Array.isArray(safe.participants)) {
        safe.participants = safe.slots.map((_, i) => i);
      }
    }
    const meeting = meetingManager.createMeeting(safe);

    if (Array.isArray(safe.slots) && safe.slots.length > 0) {
      const errors = [];
      for (const slot of safe.slots) {
        try {
          await addMeetingSubInternal(meeting.id, slot.kind, { model: slot.model });
        } catch (err) {
          errors.push({ slot, message: err && err.message || String(err) });
          logger.warn('[create-meeting] add-sub failed for slot', slot, err && err.message);
        }
      }
      const finalMeeting = meetingManager.getMeeting(meeting.id);
      const subCount = finalMeeting ? (finalMeeting.subSessions || []).length : 0;
      if (subCount === 0) {
        try { meetingManager.closeMeeting(meeting.id); } catch (err) { logger.warn('[create-meeting] close empty meeting failed:', err.message); }
        try { groupchat.cleanup?.(getHubDataDir(), meeting.id); } catch {}
        const detail = errors.map(er => `· ${er.slot.kind}（${er.slot.model || 'default'}）：${er.message}`).join('\n');
        throw new Error('所有子会话创建失败：\n' + (detail || '（未知原因）'));
      }
      meetingManager.setSlotSpecs(meeting.id, safe.slotSpecs);
      if (errors.length > 0) {
        sendToRenderer('meeting-created-with-errors', { meeting: finalMeeting, errors });
      }
      sendToRenderer('meeting-created', { meeting: finalMeeting });
    } else {
      sendToRenderer('meeting-created', { meeting });
    }

    return meetingManager.getMeeting(meeting.id) || meeting;
  });

  ipcMain.handle('add-meeting-sub', async (_e, args = {}) => {
    const { meetingId, kind, model } = args;
    const opts = args.opts || {};
    if (model && !opts.model) opts.model = model;
    return addMeetingSubInternal(meetingId, kind, opts);
  });

  return { addMeetingSubInternal };
}

module.exports = {
  createMeetingSubAdder,
  registerMeetingCreateIpc,
};
