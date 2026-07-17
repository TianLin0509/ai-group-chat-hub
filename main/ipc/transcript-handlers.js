'use strict';

const { isUsableCodexRolloutPath } = require('../../core/codex-transcript-parser.js');

function defaultDefer() {
  return new Promise(resolve => setImmediate(resolve));
}

async function parseSessionTranscript(args = {}, deps) {
  const {
    defaultCodexSessionsRoot,
    defer = defaultDefer,
    findCodexRolloutByCwd,
    findCodexRolloutBySid,
    findTranscriptByCCSessionId,
    isCodexCliKind,
    parseClaudeTranscriptToTurns,
    parseCodexRolloutToTurns,
    sessionManager,
    transcriptTap,
    updateSessionTranscriptBinding,
  } = deps;
  const validateCodexRolloutPath = typeof deps.isUsableCodexRolloutPath === 'function'
    ? deps.isUsableCodexRolloutPath
    : isUsableCodexRolloutPath;

  await defer();

  const { hubSessionId, ccSessionId, transcriptPath: inPath, kind: inKind, opts } = args || {};
  let transcriptPath = null;
  try {
    const session = hubSessionId ? sessionManager.getSession(hubSessionId) : null;
    const kind = session ? session.kind : inKind;

    if (isCodexCliKind(kind)) {
      const liveRolloutPath = hubSessionId ? transcriptTap.getCodexRolloutPath(hubSessionId) : null;
      const expectedCodexSid = session && session.codexSid ? session.codexSid : null;
      if (liveRolloutPath && validateCodexRolloutPath(liveRolloutPath)) {
        transcriptPath = liveRolloutPath;
      }
      if (!transcriptPath && session && session.transcriptPath
        && validateCodexRolloutPath(session.transcriptPath, expectedCodexSid)) {
        transcriptPath = session.transcriptPath;
      }
      if (!transcriptPath && inPath && validateCodexRolloutPath(inPath, expectedCodexSid)) {
        transcriptPath = inPath;
      }
      if (!transcriptPath && session && session.codexSid) {
        const bySid = findCodexRolloutBySid(
          session.codexSid,
          session.codexSessionsRoot || defaultCodexSessionsRoot,
        );
        if (bySid && validateCodexRolloutPath(bySid, session.codexSid)) transcriptPath = bySid;
      }
      if (!transcriptPath && session && session.codexAllowMtimeFallback && session.cwd) {
        const byCwd = findCodexRolloutByCwd(
          session.cwd,
          session.codexSessionsRoot || defaultCodexSessionsRoot,
          { sinceMs: session.createdAt || Date.now() },
        );
        if (byCwd && validateCodexRolloutPath(byCwd)) transcriptPath = byCwd;
      }
      if (!transcriptPath) {
        return { turns: [], transcriptPath: null, error: 'codex rollout not found' };
      }
      if (hubSessionId && transcriptPath && session && session.transcriptPath !== transcriptPath) {
        updateSessionTranscriptBinding(hubSessionId, { transcriptPath });
      }
      const parseOpts = { limit: 50, fromTail: true, ...(opts && typeof opts === 'object' ? opts : {}) };
      const turns = parseCodexRolloutToTurns(transcriptPath, parseOpts);
      return { turns: Array.isArray(turns) ? turns : [], transcriptPath, error: null };
    }

    transcriptPath = session && session.transcriptPath ? session.transcriptPath : null;
    if (!transcriptPath && inPath) {
      transcriptPath = inPath;
    }
    if (!transcriptPath && ccSessionId) {
      transcriptPath = findTranscriptByCCSessionId(ccSessionId);
    }
    if (!transcriptPath && hubSessionId) {
      if (session && session.ccSessionId) {
        transcriptPath = findTranscriptByCCSessionId(session.ccSessionId);
      }
    }
    if (!transcriptPath) {
      return { turns: [], transcriptPath: null, error: 'transcript not found' };
    }
    if (hubSessionId && transcriptPath && session && session.transcriptPath !== transcriptPath) {
      updateSessionTranscriptBinding(hubSessionId, { transcriptPath });
    }
    const parseOpts = { limit: 50, fromTail: true, ...(opts && typeof opts === 'object' ? opts : {}) };
    const parseStartedAt = Date.now();
    const turns = await parseClaudeTranscriptToTurns(transcriptPath, parseOpts);
    return {
      turns: Array.isArray(turns) ? turns : [],
      transcriptPath,
      parseMs: Date.now() - parseStartedAt,
      error: null,
    };
  } catch (err) {
    return { turns: [], transcriptPath, error: err && err.message ? err.message : String(err) };
  }
}

function registerTranscriptIpc(ipcMain, deps) {
  const {
    transcriptTap,
  } = deps;

  ipcMain.handle('get-last-assistant-text', (_e, sessionId) => {
    return transcriptTap.getLastAssistantText(sessionId);
  });

  ipcMain.handle('parse-session-transcript', async (_e, args = {}) => {
    return parseSessionTranscript(args, deps);
  });
}

module.exports = {
  parseSessionTranscript,
  registerTranscriptIpc,
};
