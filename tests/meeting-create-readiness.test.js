'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createMeetingSubAdder, registerMeetingCreateIpc } = require('../main/ipc/meeting-create-handlers.js');

function captureCreateHandler(overrides = {}) {
  const handlers = new Map();
  let createCalls = 0;
  const ipcMain = { handle(name, fn) { handlers.set(name, fn); } };
  const meetingManager = {
    createMeeting() {
      createCalls += 1;
      return { id: 'should-not-be-created' };
    },
    ...overrides.meetingManager,
  };
  registerMeetingCreateIpc(ipcMain, {
    fs: require('node:fs'),
    getHookPort: () => null,
    getHubDataDir: () => 'unused',
    getMeetingWorkspaceDir: () => 'unused',
    getProviderReadiness: async () => ({ claude: true, codex: false, gemini: true, deepseek: false }),
    getSlotPromptName: () => 'AI',
    groupchat: {},
    hookToken: '',
    isClaudeFamily: () => false,
    isCodexBaseKind: () => false,
    isIsolatedHub: () => false,
    kindLabels: { claude: 'Claude', codex: 'Codex', gemini: 'Gemini', deepseek: 'DeepSeek' },
    meetingManager,
    path: require('node:path'),
    registerSessionForTap: () => {},
    scenes: {},
    sendToRenderer: () => {},
    sessionManager: {},
    slotIds: ['member1', 'member2', 'member3'],
    ...overrides,
    meetingManager,
  });
  return {
    handler: handlers.get('create-meeting'),
    getCreateCalls: () => createCalls,
  };
}

test('main process rejects unavailable members before creating persistent state', async () => {
  const { handler, getCreateCalls } = captureCreateHandler();
  await assert.rejects(
    handler(null, { slots: [{ kind: 'claude' }, { kind: 'codex' }] }),
    /Codex.*尚未就绪/,
  );
  assert.equal(getCreateCalls(), 0);
});

test('main process rejects more members than the three-slot orchestrator supports', async () => {
  const { handler, getCreateCalls } = captureCreateHandler({
    getProviderReadiness: async () => ({ claude: true, codex: true, gemini: true, deepseek: true }),
  });
  await assert.rejects(
    handler(null, { slots: [
      { kind: 'claude' },
      { kind: 'codex' },
      { kind: 'gemini' },
      { kind: 'deepseek' },
    ] }),
    /最多.*3.*成员/,
  );
  assert.equal(getCreateCalls(), 0);
});

test('group members always start in a Hub-owned meeting workspace', async () => {
  let capturedOptions = null;
  const meeting = { id: 'meeting-1', groupChat: true, subSessions: [] };
  const addSub = createMeetingSubAdder({
    fs: { mkdirSync() {} },
    getMeetingWorkspaceDir: (id) => `C:\\hub-data\\workspaces\\${id}`,
    getSlotPromptName: () => 'AI',
    kindLabels: { claude: 'Claude' },
    meetingManager: {
      getMeeting: () => meeting,
      addSubSession: () => ({ ...meeting, subSessions: ['session-1'] }),
    },
    registerSessionForTap: () => {},
    sendToRenderer: () => {},
    sessionManager: {
      createSession(_kind, options) {
        capturedOptions = options;
        return { id: 'session-1' };
      },
    },
    slotIds: ['member1', 'member2', 'member3'],
  });

  await addSub('meeting-1', 'claude');
  assert.equal(capturedOptions.cwd, 'C:\\hub-data\\workspaces\\meeting-1');
  assert.equal(capturedOptions.noInheritCursor, true);
});
