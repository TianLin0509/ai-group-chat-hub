const { app, BrowserWindow, ipcMain, clipboard, nativeImage, Notification, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const http = require('http');
const os = require('os');
const { pathToFileURL } = require('url');

// Chromium CDP exposes the renderer's Node-enabled context and therefore must
// never be enabled by default in a public build. Tests/support sessions can opt
// in with CLAUDE_HUB_ENABLE_CDP=1 or pass --remote-debugging-port explicitly.
//   必须在 app.whenReady() 之前 appendSwitch 才生效。
//   注：如果启动命令行已经传了 --remote-debugging-port（E2E 测试用 hub-launcher 的场景），
//   不重复 append，避免 Chromium argv 冲突。
const _hasCdpSwitch = process.argv.some(a => a.startsWith('--remote-debugging-port'));
const _cdpEnabled = _hasCdpSwitch || process.env.CLAUDE_HUB_ENABLE_CDP === '1';
if (_cdpEnabled && !_hasCdpSwitch) {
  app.commandLine.appendSwitch('remote-debugging-port', '0');
}
const { SessionManager, clearSessionManagerConfigCache } = require('./core/session-manager.js');
const stateStore = require('./core/state-store.js');
const { getHubDataDir, getMeetingWorkspaceDir } = require('./core/data-dir.js');
const hubControl = require('./core/hub-control.js');
const { MeetingRoomManager } = require('./core/meeting-room.js');
const meetingStore = require('./core/meeting-store.js');
const sessionStore = require('./core/session-store.js');
const { TranscriptTap } = require('./core/transcript-tap');
const { createUsageFilter } = require('./core/usage-filter.js');
const transcriptTap = new TranscriptTap();
// Resend & Auto-Recovery（2026-05-03）—— patch-listener 注册表（见 line 834 附近）会让
//   transcriptTap 在 5 分钟 patch 窗口内挂多个 listener。3 sub × 1 watcher/sub × 多轮重叠
//   ＞ Node 默认 10 个会触发 MaxListenersExceededWarning。提升上限到 100 安全冗余。
try { transcriptTap.setMaxListeners(100); } catch {}
const scenes = require('./core/group-chat-scenes.js');
const groupchat = require('./core/group-chat-orchestrator.js');
const cliReadyDetector = require('./core/group-chat-cli-ready-detector.js');
const { getConfig: getHubConfig } = require('./core/hub-config.js');
const {
  resolveCodexUsageScope,
  attachCodexUsageScope,
  filterUsageCacheForCodexScope,
} = require('./core/codex-usage-scope.js');
const { ALL_AI_KINDS, isClaudeFamily, isCodexCliKind, SLOT_IDS, KIND_LABELS, getSlotPromptName, getSlotDisplayLabel, slotIdToIndex, slotIndexToId } = require('./core/ai-kinds.js');
const { buildProviderReadiness } = require('./core/provider-readiness.js');
const { stripHubHookEntries } = require('./core/claude-hook-settings.js');
const {
  isAllowedExternalUrl,
  isAllowedPreviewUrl,
  isLocalHtmlPreviewUrl,
  isTrustedMainNavigation,
} = require('./core/navigation-policy.js');
const { registerConfigIpc } = require('./main/ipc/config-handlers.js');
const { registerPathIpc } = require('./main/ipc/path-handlers.js');
const { registerSessionIpc } = require('./main/ipc/session-handlers.js');
const { registerUsageIpc } = require('./main/ipc/usage-handlers.js');
const { registerMeetingIpc } = require('./main/ipc/meeting-handlers.js');
const { registerMeetingCreateIpc } = require('./main/ipc/meeting-create-handlers.js');
const { registerMeetingTimelineIpc } = require('./main/ipc/meeting-timeline-handlers.js');
const { registerTranscriptIpc } = require('./main/ipc/transcript-handlers.js');
const { registerCliStatusIpc } = require('./main/ipc/cli-status-handlers.js');
const { registerPersistenceIpc } = require('./main/ipc/persistence-handlers.js');
const { registerAppUtilityIpc } = require('./main/ipc/app-utility-handlers.js');
const { registerGroupchatQueryIpc } = require('./main/ipc/groupchat-query-handlers.js');
const { registerGroupchatRecoveryIpc } = require('./main/ipc/groupchat-recovery-handlers.js');
const { registerGroupchatTurnIpc } = require('./main/ipc/groupchat-turn-handlers.js');
const { registerResumeSessionIpc } = require('./main/ipc/resume-session-handlers.js');
const { createGroupChatDispatcher } = require('./main/groupchat/dispatcher.js');
const { createAutoTitleManager } = require('./main/auto-title-manager.js');
const {
  extractCodexRateLimits,
  mergeCodexRateLimitCandidates,
  parseCodexUsage,
  parseGeminiUsage,
  stripAnsi,
} = require('./main/usage/agent-usage-parser.js');
const {
  expireCodexUsageWindows,
  readCodexAccountUsage,
  shouldPreferCodexLiveUsage,
} = require('./main/usage/codex-app-server-usage.js');
const {
  didClaudeSnapshotAdvance,
  selectClaudeStatuslineUsage,
} = require('./main/usage/claude-statusline-usage.js');
const {
  pruneCodexCliUsage,
  recordCodexCliUsage,
  selectCodexCliUsageForScope,
} = require('./main/usage/scoped-codex-cli-usage.js');

function isCodexBaseKind(kind) {
  return isCodexCliKind(kind);
}
const { readLastAssistantMessage } = require('./core/read-last-assistant.js');
const { readTranscriptTail } = require('./core/session-manager');
const { parseClaudeTranscriptToTurns } = require('./core/claude-transcript-parser.js');
const {
  findTranscriptByCCSessionId,
  healPersistedCwds,
} = require('./core/claude-transcript-locator.js');
const {
  DEFAULT_CODEX_SESSIONS_ROOT,
  parseCodexRolloutToTurns,
  findCodexRolloutBySid,
  findCodexRolloutByCwd,
  isUsableCodexRolloutPath,
  isCodexSubagentRolloutPath,
} = require('./core/codex-transcript-parser.js');
const { registerArchiveIpc } = require('./main/ipc/archive-handlers.js');

// === EPIPE 防护（隔离 Hub 启动必需）===
// PowerShell `& exe ...` + run_in_background 启动模式下，parent 退出后
// stdout/stderr 管道关闭。任何 console.log/warn/error 写入会触发 EPIPE，
// 未捕获时整个 Electron 主进程崩溃（红色 "JavaScript error" dialog）。
// 真实触发点：listenWithFallback 端口被占用时 console.warn → EPIPE → uncaught。
process.stdout.on('error', (e) => { if (e.code !== 'EPIPE') throw e; });
process.stderr.on('error', (e) => { if (e.code !== 'EPIPE') throw e; });
process.on('uncaughtException', (e) => {
  if (e && e.code === 'EPIPE') return;
  throw e;
});

const STARTUP_TRACE = process.env.HUB_STARTUP_TRACE === '1';
const STARTUP_T0 = Date.now();
function traceStartup(msg) {
  if (!STARTUP_TRACE) return;
  console.log(`[startup +${Date.now() - STARTUP_T0}ms] ${msg}`);
}

// Isolate Chromium userData when CLAUDE_HUB_DATA_DIR is set (parallel test
// instances). Must run before app.whenReady(). Production Hub unaffected
// because the env var is only set by test harnesses.
if (process.env.CLAUDE_HUB_DATA_DIR) {
  app.setPath('userData', path.join(process.env.CLAUDE_HUB_DATA_DIR, 'electron-userdata'));
}

// Deploy hook scripts only for Hub-managed config or after explicit opt-in.
// Idempotent — skips if already present and preserves unrelated user hooks.
// claudeDirPath: target Claude config dir (e.g. ~/.claude or ~/.claude-deepseek)
// opts.hubManaged: true only for Hub-owned isolated config dirs (~/.claude-deepseek).
// The user's primary ~/.claude is modified only when the user enables the Hook
// integration. Permission mode, statusline and folder trust remain untouched.
function ensureHooksDeployed(claudeDirPath, opts = {}) {
  const hubManaged = !!opts.hubManaged;
  const claudeDir = claudeDirPath;
  const scriptsDir = path.join(claudeDir, 'scripts');

  // 1. Copy hook scripts if missing
  const srcDir = app.isPackaged
    ? path.join(process.resourcesPath, 'scripts')
    : path.join(__dirname, 'scripts');

  const scriptFiles = ['session-hub-hook.py', 'claude-hub-statusline.js', 'deepseek_repl.py'];
  for (const file of scriptFiles) {
    const dest = path.join(scriptsDir, file);
    const src = path.join(srcDir, file);
    if (!fs.existsSync(src)) continue;
    fs.mkdirSync(scriptsDir, { recursive: true });
    // Repo-generated scripts (not user-authored): keep deployed copy in sync
    // with the repo. Otherwise an old deployed statusline/hook keeps running
    // and silently ignores new logic shipped in later Hub releases.
    let needsCopy = !fs.existsSync(dest);
    if (!needsCopy) {
      try { needsCopy = !fs.readFileSync(src).equals(fs.readFileSync(dest)); }
      catch { needsCopy = true; }
    }
    if (needsCopy) {
      fs.copyFileSync(src, dest);
      console.log(`[群聊] deployed ${file} -> ${dest}`);
    }
  }

  // 2. Merge hook config into settings.json if not present
  const settingsPath = path.join(claudeDir, 'settings.json');
  let settings = {};
  try { settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8')); } catch {}

  const hookPyPath = path.join(scriptsDir, 'session-hub-hook.py').replace(/\\/g, '\\\\');
  const statusJsPath = path.join(scriptsDir, 'claude-hub-statusline.js').replace(/\\/g, '/');

  let changed = false;

  // Ensure hooks object
  if (!settings.hooks) settings.hooks = {};

  // Stop hook
  const stopCmd = `python "${hookPyPath}" stop`;
  if (!settings.hooks.Stop) settings.hooks.Stop = [];
  const hasStop = settings.hooks.Stop.some(entry =>
    entry.hooks && entry.hooks.some(h => h.command && h.command.includes('session-hub-hook'))
  );
  if (!hasStop) {
    settings.hooks.Stop.push({
      matcher: '',
      hooks: [{ type: 'command', command: stopCmd, timeout: 5 }]
    });
    changed = true;
  }

  // UserPromptSubmit hook
  const promptCmd = `python "${hookPyPath}" prompt`;
  if (!settings.hooks.UserPromptSubmit) settings.hooks.UserPromptSubmit = [];
  const hasPrompt = settings.hooks.UserPromptSubmit.some(entry =>
    entry.hooks && entry.hooks.some(h => h.command && h.command.includes('session-hub-hook'))
  );
  if (!hasPrompt) {
    settings.hooks.UserPromptSubmit.push({
      matcher: '',
      hooks: [{ type: 'command', command: promptCmd, timeout: 5 }]
    });
    changed = true;
  }

  // Statusline belongs only in Hub-managed isolated config. Never add or replace
  // a statusline in the user's primary ~/.claude settings.
  if (hubManaged && (!settings.statusLine || !String(settings.statusLine.command || '').includes('claude-hub-statusline'))) {
    settings.statusLine = {
      type: 'command',
      command: `node "${statusJsPath}"`
    };
    changed = true;
  }

  if (changed) {
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
    console.log('[群聊] settings.json updated with hook config');
  }

  // 4. Ensure .claude.json project trust — ONLY for Hub-managed isolated dirs.
  //    Folder-trust of the user's primary ~/.claude is the user's own decision.
  if (!hubManaged) return;
  const statePath = path.join(claudeDir, '.claude.json');
  try {
    const raw = fs.readFileSync(statePath, 'utf8');
    const state = JSON.parse(raw);
    if (state.projects && typeof state.projects === 'object') {
      let trustChanged = false;
      for (const [projectDir, proj] of Object.entries(state.projects)) {
        if (proj && typeof proj === 'object' && proj.hasTrustDialogAccepted === false) {
          proj.hasTrustDialogAccepted = true;
          trustChanged = true;
          console.log(`[群聊] .claude.json trust fixed: ${projectDir}`);
        }
      }
      if (trustChanged) {
        fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf8');
        console.log('[群聊] .claude.json trust state updated');
      }
    }
  } catch { /* .claude.json 不存在或格式异常，跳过（首次启动可能尚未生成） */ }
}

// (This edition ships no stock-research MCP; Gemini research MCP auto-install removed.)

function detectCliCommands() {
  const { execFileSync } = require('child_process');
  const has = (cmd) => {
    try {
      execFileSync('where', [cmd], { stdio: 'ignore', timeout: 4000, windowsHide: true });
      return true;
    } catch {
      return false;
    }
  };
  return { claude: has('claude'), codex: has('codex'), gemini: has('gemini'), python: has('python') };
}

function removeHubHooksFromPrimarySettings(claudeDirPath) {
  const settingsPath = path.join(claudeDirPath, 'settings.json');
  try {
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    const result = stripHubHookEntries(settings);
    if (!result.changed) return;
    fs.writeFileSync(settingsPath, JSON.stringify(result.settings, null, 2), 'utf8');
    console.log('[群聊] removed disabled Hub hooks from primary Claude settings');
  } catch (err) {
    if (err && err.code !== 'ENOENT') console.warn('[群聊] failed to reconcile primary Claude hooks:', err.message);
  }
}

function getProviderReadiness() {
  return buildProviderReadiness(detectCliCommands(), getHubConfig());
}

// Read the last user message text from a Claude Code transcript JSONL file.
// Reads the trailing chunk(s) only (not the whole file) — long sessions can be
// 10MB+ and we used to readFileSync the whole thing on every hook POST, which
// stalled the main-process event loop. Now we seek from EOF and walk backward
// in 64KB chunks until we hit the first complete `user`-typed entry.
// Returns null on any failure — caller should treat absence as non-fatal.
async function readLastUserMessage(transcriptPath) {
  const CHUNK = 65536;
  let fh;
  try {
    fh = await fs.promises.open(transcriptPath, 'r');
    const { size } = await fh.stat();
    let pos = size;
    let tail = '';
    while (pos > 0) {
      const readLen = Math.min(CHUNK, pos);
      pos -= readLen;
      const buf = Buffer.alloc(readLen);
      await fh.read(buf, 0, readLen, pos);
      tail = buf.toString('utf-8') + tail;
      const lines = tail.split('\n');
      // The first fragment may be an incomplete line — keep it for the next pass
      // by prepending it back to `tail`, except when we've reached the very start.
      const firstFragment = pos === 0 ? null : lines.shift();
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i].trim();
        if (!line) continue;
        let entry;
        try { entry = JSON.parse(line); } catch { continue; }
        const role = entry.type || entry.role;
        if (role !== 'user') continue;
        const msg = entry.message;
        let text = '';
        if (typeof msg === 'string') {
          text = msg;
        } else if (msg && typeof msg.content === 'string') {
          text = msg.content;
        } else if (msg && Array.isArray(msg.content)) {
          // CC stores tool_result entries as role=user too (Anthropic API
          // convention). Skip those — they pollute the preview with strings
          // like "[Image: source: ]" pulled from tool return payloads.
          const hasTool = msg.content.some(c => c && c.type === 'tool_result');
          if (hasTool) continue;
          text = msg.content.filter(c => c && c.type === 'text').map(c => c.text || '').join(' ').trim();
        }
        if (text) return text;
      }
      tail = firstFragment == null ? '' : firstFragment;
    }
  } catch {
    // swallowed — non-fatal
  } finally {
    if (fh) { try { await fh.close(); } catch {} }
  }
  return null;
}

// Hook server picks the first free port in this range.
const HOOK_PORT_CANDIDATES = [
  3456, 3457, 3458, 3459, 3460,
  3461, 3462, 3463, 3464, 3465,
  3466, 3467, 3468, 3469, 3470,
  3471, 3472, 3473, 3474, 3475,
];
// Random per-launch token; hook POSTs must carry it. Stops any other local
// process from forging unread bumps.
const HOOK_TOKEN = crypto.randomBytes(16).toString('hex');

let hookPort = null;  // set after listen() succeeds

let mainWindow;
const sessionManager = new SessionManager();
const meetingManager = new MeetingRoomManager();

// Deep-summary service singleton: instantiated from config-driven fallback chain.
// Providers tried in order; first one with a parseable response wins.

// Wire TranscriptTap → MeetingRoomManager timeline.
// When a sub-session's CLI finishes a turn, append the AI text to its
// meeting's timeline (if the sub-session belongs to a meeting).
transcriptTap.on('turn-complete', (ev) => {
  const { hubSessionId, text, completedAt } = ev || {};
  const session = sessionManager.getSession(hubSessionId);
  if (session && session.meetingId) {
    const turn = meetingManager.appendTurn(
      session.meetingId,
      hubSessionId,
      text,
      completedAt != null ? completedAt : Date.now(),
    );
    if (turn) {
      sendToRenderer('meeting-timeline-updated', { meetingId: session.meetingId, turn });
    }
    // (Driver-mode auto-review removed when driver mode was deprecated.)
  }

  // spec2/S3：把 turn-complete 广播给 renderer，供历史会话/侧边栏卡片实时刷新。
  // 注意：这里独立于上面的 meeting timeline 逻辑——非群聊的普通会话也要广播。
  try {
    let transcriptPath = ev && ev.transcriptPath ? ev.transcriptPath : null;
    if (!transcriptPath && session && session.transcriptPath) {
      transcriptPath = session.transcriptPath;
    }
    if (!transcriptPath && session && session.ccSessionId) {
      try { transcriptPath = findTranscriptByCCSessionId(session.ccSessionId); } catch {}
    }
    sendToRenderer('turn-complete-event', {
      hubSessionId,
      ccSessionId: session ? session.ccSessionId : null,
      transcriptPath,
      text,
      completedAt: completedAt != null ? completedAt : Date.now(),
      meetingId: session ? session.meetingId : null,
      kind: session ? session.kind : null,
      durationMs: ev ? ev.durationMs : null,
      signalSource: ev ? ev.signalSource : null,
    });
  } catch (e) {
    console.warn('[spec2/S3] turn-complete-event broadcast failed:', e && e.message);
  }
});

const autoTitleManager = createAutoTitleManager({
  allAiKinds: ALL_AI_KINDS,
  getHubConfig,
  kindLabels: KIND_LABELS,
  meetingManager,
  sendToRenderer,
  sessionManager,
});
const { maybeAutoTitleMeetingFromPrompt, maybeAutoTitleSessionFromPrompt } = autoTitleManager;
transcriptTap.on('prompt-submitted', (ev) => {
  const { hubSessionId, text, submittedAt } = ev || {};
  if (!hubSessionId) return;
  const session = sessionManager.getSession(hubSessionId);
  maybeAutoTitleSessionFromPrompt(ev);
  try {
    sendToRenderer('prompt-submitted-event', {
      hubSessionId,
      transcriptPath: ev ? ev.transcriptPath : null,
      text,
      submittedAt: submittedAt != null ? submittedAt : Date.now(),
      meetingId: session ? session.meetingId : null,
      kind: session ? session.kind : null,
      signalSource: ev ? ev.signalSource : null,
    });
  } catch (e) {
    console.warn('[codex prompt] prompt-submitted-event broadcast failed:', e && e.message);
  }
});

// Persist resume meta when transcript-tap binds a sub-session to its native CLI sid.
transcriptTap.on('session-bound', (ev) => {
  if (!ev || !ev.hubSessionId) return;
  try {
    if (isCodexCliKind(ev.kind) && (ev.codexSid || ev.rolloutPath)) {
      const current = sessionManager.getSession(ev.hubSessionId);
      const patch = {};
      if (ev.codexSid) patch.codexSid = ev.codexSid;
      if (ev.rolloutPath) patch.transcriptPath = ev.rolloutPath;
      if (current && current.codexSessionsRoot) patch.codexSessionsRoot = current.codexSessionsRoot;
      if (current && current.codexAllowMtimeFallback) patch.codexAllowMtimeFallback = true;
      sessionManager.updateSessionMeta(ev.hubSessionId, patch);
    }
  } catch {}
  // Find the session in lastPersistedSessions and merge new fields.
  const idx = lastPersistedSessions.findIndex(s => s.hubId === ev.hubSessionId);
  if (idx < 0) {
    if (isCodexCliKind(ev.kind) && (ev.codexSid || ev.rolloutPath)) {
      sendToRenderer('session-meta-updated', {
        hubSessionId: ev.hubSessionId,
        kind: ev.kind,
        codexSid: ev.codexSid,
        transcriptPath: ev.rolloutPath,
        codexSessionsRoot: sessionManager.getSession(ev.hubSessionId)?.codexSessionsRoot || null,
        codexAllowMtimeFallback: !!sessionManager.getSession(ev.hubSessionId)?.codexAllowMtimeFallback,
      });
    }
    return;
  }
  const cur = lastPersistedSessions[idx];
  let changed = false;
  if (isCodexCliKind(ev.kind) && ev.codexSid && cur.codexSid !== ev.codexSid) {
    cur.codexSid = ev.codexSid;
    changed = true;
  }
  if (isCodexCliKind(ev.kind) && ev.rolloutPath && cur.transcriptPath !== ev.rolloutPath) {
    cur.transcriptPath = ev.rolloutPath;
    changed = true;
  }
  const liveSession = isCodexCliKind(ev.kind) ? sessionManager.getSession(ev.hubSessionId) : null;
  if (isCodexCliKind(ev.kind) && liveSession && liveSession.codexSessionsRoot && cur.codexSessionsRoot !== liveSession.codexSessionsRoot) {
    cur.codexSessionsRoot = liveSession.codexSessionsRoot;
    changed = true;
  }
  if (isCodexCliKind(ev.kind) && liveSession && liveSession.codexAllowMtimeFallback && cur.codexAllowMtimeFallback !== true) {
    cur.codexAllowMtimeFallback = true;
    changed = true;
  }
  if (ev.kind === 'gemini') {
    if (ev.geminiChatId && cur.geminiChatId !== ev.geminiChatId) { cur.geminiChatId = ev.geminiChatId; changed = true; }
    if (ev.geminiProjectHash && cur.geminiProjectHash !== ev.geminiProjectHash) { cur.geminiProjectHash = ev.geminiProjectHash; changed = true; }
    if (ev.geminiProjectRoot && cur.geminiProjectRoot !== ev.geminiProjectRoot) { cur.geminiProjectRoot = ev.geminiProjectRoot; changed = true; }
  }
  if (changed) {
    cur.updatedAt = Date.now();  // 让后续 stateStore merge 用最新版本胜出
    stateStore.save({
      version: 1,
      cleanShutdown: false,
      sessions: lastPersistedSessions,
      meetings: meetingManager.getAllMeetings(),
      immersiveByMeeting: _immersiveByMeeting,
    });
    // 2026-05-07 道雪：sid 类字段一旦确定就立刻 sync 写 per-session JSON。
    //   不靠 200ms debounce，不靠 state.json 防抖 500ms——任何一个 race / crash
    //   都不会再让 Codex/Gemini 的 transcript 关联丢失。
    try { sessionStore.markDirtySync(ev.hubSessionId, cur); }
    catch (e) { console.warn('[hub] sessionStore sync persist failed:', e.message); }

    // Spec 3 · W12：广播给 renderer 让 sessions Map 即刻同步（之前只写磁盘，
    // renderer 内存不更新 → codex/gemini 的 resume meta 必须 reboot 才生效）
    sendToRenderer('session-meta-updated', {
      hubSessionId: ev.hubSessionId,
      kind: ev.kind,
      codexSid: cur.codexSid,
      transcriptPath: cur.transcriptPath,
      codexSessionsRoot: cur.codexSessionsRoot,
      codexAllowMtimeFallback: !!cur.codexAllowMtimeFallback,
      geminiChatId: cur.geminiChatId,
      geminiProjectHash: cur.geminiProjectHash,
      geminiProjectRoot: cur.geminiProjectRoot,
    });
    console.log(`[群聊] persisted resume meta for ${ev.kind} session ${ev.hubSessionId.slice(0,8)}`);
  }
});

sessionManager.hookToken = HOOK_TOKEN;  // port set after listen

// Pin a stable AppUserModelID before the first toast notification fires.
// Leaving it unset (the prior approach) has a hole: the first Windows toast
// raised from main/ipc/app-utility-handlers.js (Notification.show()) makes the
// toast subsystem implicitly bind the process to an electron.exe-derived AUMID,
// whose icon is electron.exe's default atom — so the taskbar icon silently
// reverts to the Electron default hours into a session. Setting our own AUMID
// first makes Windows fall back to the window HICON (setIcon in createWindow =
// claude-wx.ico) instead. Must precede any window/notification. win32-only.
if (process.platform === 'win32') {
  app.setAppUserModelId('com.ai-group-chat-hub'); // = package.json build.appId
}

function createWindow() {
  // Load the icon as a NativeImage so we can pass it to BrowserWindow AND
  // re-apply via setIcon — on Windows the constructor `icon` alone sometimes
  // misses the taskbar; the explicit setIcon nails it.
  const iconPath = path.join(__dirname, 'claude-wx.ico');
  const winIcon = nativeImage.createFromPath(iconPath);

  // 标题动态读 package.json 版本号，避免硬编码漂移（card-redesign 0.2.0 起）
  const _pkgVersion = (() => {
    try { return require('./package.json').version || ''; } catch { return ''; }
  })();
  // 2026-05-03 道雪：标题带 PID，方便桌面同时存在多个 Hub 窗口（生产+测试）时
  //   一眼区分哪个对应哪个 PID — 调试时不再需要 Get-Process 反查。
  const _hubTitle = `AI 群聊 Hub：PID ${process.pid}${_pkgVersion ? ` v${_pkgVersion}` : ''}`;
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: _hubTitle,
    backgroundColor: '#0d1117',
    icon: winIcon,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      sandbox: false,
      webviewTag: true,
    },
  });
  // index.html 的 <title>AI 群聊 Hub</title> 在页面加载完成后会触发 page-title-updated 覆盖
  // BrowserWindow.title — preventDefault 阻止覆盖，保留带 PID 的标题
  mainWindow.on('page-title-updated', (e) => { e.preventDefault(); });

  if (!winIcon.isEmpty()) {
    mainWindow.setIcon(winIcon);
  } else {
    console.warn('[icon] failed to load', iconPath);
  }

  let hasShown = false;
  const showMainWindow = () => {
    if (hasShown || !mainWindow || mainWindow.isDestroyed()) return;
    hasShown = true;
    mainWindow.maximize();
    mainWindow.show();
  };
  ipcMain.once('renderer-sidebar-ready', showMainWindow);
  mainWindow.webContents.once('did-finish-load', showMainWindow);
  mainWindow.webContents.on('did-finish-load', () => {
    traceStartup('did-finish-load');
    sendToRenderer('hook-status', { up: hookPort !== null, port: hookPort });
    // Phase 2b：boot 后由 main 循环引擎扫描未完成循环并自动续跑（main 驱动 + 自动 wake 成员）。once 守卫 + 延迟(等 session 恢复) + try，绝不影响启动。
    if (!global.__loopResumeScanned) {
      global.__loopResumeScanned = true;
      setTimeout(() => {
        try { if (global.__loopEngine) global.__loopEngine.resumePending(); }
        catch (e) { console.warn('[loop] boot resume failed:', e && e.message); }
      }, 8000);
    }
  });
  setTimeout(showMainWindow, 4000);

  // This renderer still needs Node integration. Keep that trust boundary narrow:
  // only the packaged index may load in the main frame, and every preview guest
  // has Node disabled even when it displays a local HTML file.
  const trustedIndexUrl = pathToFileURL(path.join(__dirname, 'renderer', 'index.html')).href;
  const openAllowedExternal = (urlStr) => {
    if (!isAllowedExternalUrl(urlStr)) {
      console.warn('[nav-guard] blocked unsupported external URL:', urlStr);
      return;
    }
    shell.openExternal(urlStr).catch((e) => console.warn('[nav-guard] openExternal failed:', e && e.message));
  };
  const interceptNavigate = (event, urlStr) => {
    if (isTrustedMainNavigation(urlStr, trustedIndexUrl)) return;
    event.preventDefault();
    openAllowedExternal(urlStr);
  };
  mainWindow.webContents.on('will-navigate', interceptNavigate);
  mainWindow.webContents.on('will-redirect', interceptNavigate);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openAllowedExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.nodeIntegrationInSubFrames = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
    webPreferences.webSecurity = true;
    webPreferences.allowRunningInsecureContent = false;
    if (isLocalHtmlPreviewUrl(params.src)) webPreferences.javascript = false;
    if (!isAllowedPreviewUrl(params.src)) event.preventDefault();
  });
  mainWindow.webContents.on('did-attach-webview', (_event, guest) => {
    const guardPreviewNavigation = (event, urlStr) => {
      if (!isAllowedPreviewUrl(urlStr)) event.preventDefault();
    };
    guest.on('will-navigate', guardPreviewNavigation);
    guest.on('will-redirect', guardPreviewNavigation);
    guest.setWindowOpenHandler(({ url }) => {
      openAllowedExternal(url);
      return { action: 'deny' };
    });
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.on('closed', () => { mainWindow = null; });
}

function sendToRenderer(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

let groupChatDispatcher = null;

sessionManager.onData = (sessionId, data) => {
  sendToRenderer('terminal-data', { sessionId, data });
};

sessionManager.onSessionClosed = (sessionId, meetingId, exitInfo) => {
  groupChatDispatcher?.markProcessExitForSession(sessionId, exitInfo);

  try { transcriptTap.unregisterSession(sessionId); } catch {}
  // 群聊 cli-ready monotonic guard 清理（独立模块，详见 core/group-chat-cli-ready-detector.js）
  try { cliReadyDetector.cleanup(sessionId); } catch {}
  sendToRenderer('session-closed', { sessionId });
  if (meetingId) {
    const updated = meetingManager.removeSubSession(meetingId, sessionId);
    if (updated) sendToRenderer('meeting-updated', { meeting: updated });
  }
};

// Register a freshly-spawned session with the transcript tap so the appropriate
// backend starts watching its CLI-native transcript file. No-op for kinds
// without a backend (powershell/deepseek/glm).
function registerSessionForTap(session) {
  if (!session || !session.id) return;
  try {
    transcriptTap.registerSession(session.id, session.kind, {
      cwd: session.cwd,
      transcriptPath: session.transcriptPath || undefined,
      sessionsRoot: session.codexSessionsRoot || undefined,
      codexSid: session.codexSid || undefined,
      allowMtimeFallback: !!session.codexAllowMtimeFallback,
      requirePromptMatch: !!session.meetingId,
    });
  }
  catch (e) {
    // silent-failure-hunter L2（2026-05-04 道雪）：注册失败 → watcher 收不到 turn-complete L1
    //   信号 → 群聊等到 180s 软提醒才感知该家"卡住"。日志方便定位根因。
    console.warn('[tap] registerSession failed for', session.id.slice(0, 8), session.kind, ':', e && e.message);
  }
}

function updateSessionTranscriptBinding(hubSessionId, fields = {}) {
  if (!hubSessionId) return null;
  const next = {};
  if (fields.ccSessionId) next.ccSessionId = fields.ccSessionId;
  if (fields.transcriptPath) next.transcriptPath = fields.transcriptPath;
  if (Object.keys(next).length === 0) return null;
  const current = sessionManager.getSession(hubSessionId);
  if (!current) return null;
  const changed = Object.keys(next).some(k => current[k] !== next[k]);
  if (!changed) return current;
  const updated = sessionManager.updateSessionMeta(hubSessionId, next);
  if (updated) {
    sendToRenderer('session-updated', { session: updated });
    sendToRenderer('session-meta-updated', { hubSessionId, ...next });
  }
  return updated || null;
}

registerMeetingCreateIpc(ipcMain, {
  fs,
  getHookPort: () => hookPort,
  getHubDataDir,
  getMeetingWorkspaceDir,
  getProviderReadiness,
  getSlotPromptName,
  groupchat,
  hookToken: HOOK_TOKEN,
  isClaudeFamily,
  isCodexBaseKind,
  isCodexSubagentRolloutPath,
  kindLabels: KIND_LABELS,
  meetingManager,
  path,
  registerSessionForTap,
  scenes,
  sendToRenderer,
  sessionManager,
  slotIds: SLOT_IDS,
});

registerMeetingIpc(ipcMain, {
  deleteImmersiveByMeeting: (meetingId) => { delete _immersiveByMeeting[meetingId]; },
  getHubDataDir,
  getImmersiveByMeeting: () => _immersiveByMeeting,
  getLastPersistedSessions: () => lastPersistedSessions,
  groupchat,
  meetingManager,
  scenes,
  sendToRenderer,
  sessionManager,
  sessionStore,
  slotIds: SLOT_IDS,
  stateStore,
});

// =====================================================================
// Group Chat Mode dispatch
// =====================================================================
groupChatDispatcher = createGroupChatDispatcher({
  cliReadyDetector,
  getHubDataDir,
  groupchat,
  isCodexBaseKind,
  kindLabels: KIND_LABELS,
  maybeAutoTitleMeetingFromPrompt,
  meetingManager,
  sendToRenderer,
  sessionManager,
  transcriptTap,
});

registerGroupchatTurnIpc(ipcMain, {
  dispatchGroupChatTurn: groupChatDispatcher.dispatchGroupChatTurn,
});

// Phase 2b：main 进程循环引擎（崩溃续跑 + 成员 wake），复用 dispatcher。try 包裹，绝不影响启动。
try {
  global.__loopEngine = require('./main/groupchat/loop-engine.js').createLoopEngine({
    getDispatcher: () => groupChatDispatcher,
    meetingManager, sessionManager, sendToRenderer,
    writeReport: (html) => {
      try {
        const fsx = require('fs'), pathx = require('path'), osx = require('os');
        const dir = pathx.join(osx.homedir(), 'Desktop', 'claude-artifacts');
        fsx.mkdirSync(dir, { recursive: true });
        const f = pathx.join(dir, 'loop-report-' + Date.now() + '.html');
        fsx.writeFileSync(f, html, 'utf8');
        return f;
      } catch (e) { return null; }
    },
    logger: console,
  });
  require('./main/ipc/loop-handlers.js').registerLoopIpc(ipcMain, { loopEngine: global.__loopEngine });
} catch (e) { console.warn('[loop] engine init failed:', e && e.message); }

// (Committee / 五幕投委会 feature removed in this edition.)

registerGroupchatQueryIpc(ipcMain, {
  getHubDataDir,
  groupchat,
  transcriptTap,
});

registerGroupchatRecoveryIpc(ipcMain, {
  getHubDataDir,
  getActiveWatchers: groupChatDispatcher.getActiveWatchers,
  groupchat,
  groupChatWatcher: groupChatDispatcher.getGroupChatWatcher(),
  meetingManager,
  sendToRenderer,
  sessionManager,
  transcriptTap,
});
registerCliStatusIpc(ipcMain, {
  cliReadyDetector,
  sessionManager,
});

registerTranscriptIpc(ipcMain, {
  defaultCodexSessionsRoot: DEFAULT_CODEX_SESSIONS_ROOT,
  findCodexRolloutByCwd,
  findCodexRolloutBySid,
  findTranscriptByCCSessionId,
  isCodexCliKind,
  isUsableCodexRolloutPath,
  parseClaudeTranscriptToTurns,
  parseCodexRolloutToTurns,
  sessionManager,
  transcriptTap,
  updateSessionTranscriptBinding,
});

// build-injection IPC 历史用于 blackboard 用户输入合成注入子会话(meeting-blackboard.js)。
// Module C 后 blackboard 已删除,该 handler 不再被任何前端代码调用,清理。

registerArchiveIpc(ipcMain);

registerSessionIpc(ipcMain, {
  registerSessionForTap,
  sendToRenderer,
  sessionManager,
});

// --- Dormant session persistence ---
// On boot we read state.json; those entries become dormant (sidebar entries
// with no live PTY). User clicks dormant session → resume-session IPC spawns
// PTY with `claude --resume <ccSessionId>`.
//
// 2026-05-07 道雪：boot 走 loadAndSelfHeal，扫 sessions/ + meetings/ 目录把孤儿
// 条目（state.json 已丢但 per-id JSON 仍在）合并回来。多 Hub 并发覆盖、
// state.json 损坏、外部清理工具误删这三类灾难都能自我修复。
const bootState = stateStore.loadAndSelfHeal({ sessionStore, meetingStore });
// loadAndSelfHeal 内部已经把 cleanShutdown 翻成 false（运行中状态），
//   bootWasCleanShutdown 是它额外暴露的"原始盘上值"，告知是否上次优雅退出。
const bootWasClean = !!bootState.bootWasCleanShutdown;
let lastPersistedSessions = Array.isArray(bootState.sessions) ? bootState.sessions : [];
// Card optimization Task 9（2026-05-01）— 沉浸/调试模式 per-meeting 状态（持久化）
//   key = meetingId，value = boolean（true=沉浸，false=调试）。
//   每个 stateStore.save 调用都把这份 dict 一起写回，避免被覆盖。
let _immersiveByMeeting = (bootState.immersiveByMeeting && typeof bootState.immersiveByMeeting === 'object')
  ? bootState.immersiveByMeeting : {};
const bootMeetings = Array.isArray(bootState.meetings) ? bootState.meetings : [];
for (const m of bootMeetings) {
  meetingManager.restoreMeeting(m);
}

registerMeetingTimelineIpc(ipcMain, {
  meetingManager,
  sendToRenderer,
});

// 2026-05-07：loadAndSelfHeal 内部已经写过一次 cleanShutdown=false 的快照，
//   这里不再重复写。原本的"flip flag immediately on boot"语义由 selfHeal 承担。

// 跟踪上一次 persist 的 hubId/meetingId 集合，用于 diff 出"用户主动移除"的条目。
//   stateStore.markRemovedSession 把 id 推到 state-store 的 removed set，
//   merge 时显式删除——不依赖"内存里没有 = 删了"，避免多 Hub 启动期间互相把对方
//   未感知到的条目抹掉。
let _lastPersistedSessionIds = new Set(lastPersistedSessions.map(s => s.hubId).filter(Boolean));
let _lastPersistedMeetingIds = new Set(bootMeetings.map(m => m && m.id).filter(Boolean));

registerPersistenceIpc(ipcMain, {
  bootWasClean,
  getImmersiveByMeeting: () => _immersiveByMeeting,
  getLastPersistedMeetingIds: () => _lastPersistedMeetingIds,
  getLastPersistedSessionIds: () => _lastPersistedSessionIds,
  getLastPersistedSessions: () => lastPersistedSessions,
  meetingManager,
  meetingStore,
  sessionStore,
  setLastPersistedMeetingIds: (ids) => { _lastPersistedMeetingIds = ids; },
  setLastPersistedSessionIds: (ids) => { _lastPersistedSessionIds = ids; },
  setLastPersistedSessions: (sessions) => { lastPersistedSessions = sessions; },
  stateStore,
});

registerResumeSessionIpc(ipcMain, {
  defaultCodexSessionsRoot: DEFAULT_CODEX_SESSIONS_ROOT,
  findCodexRolloutBySid,
  findTranscriptByCCSessionId,
  fs,
  getHookPort: () => hookPort,
  getHubDataDir,
  hookToken: HOOK_TOKEN,
  isClaudeFamily,
  isCodexBaseKind,
  meetingManager,
  os,
  path,
  readTranscriptTail,
  registerSessionForTap,
  scenes,
  sendToRenderer,
  sessionManager,
  slotIds: SLOT_IDS,
});

const imageDir = path.join(getHubDataDir(), 'images');
registerAppUtilityIpc(ipcMain, {
  clipboard,
  crypto,
  fs,
  getHookPort: () => hookPort,
  getMainWindow: () => mainWindow,
  imageDir,
  Notification,
  path,
});

registerPathIpc(ipcMain);

// Detect which AI CLIs are available on PATH — powers the first-run welcome guide.
ipcMain.handle('detect-clis', async () => detectCliCommands());
ipcMain.handle('get-ai-readiness', async () => getProviderReadiness());

// --- Hook HTTP server ---
// Receives POSTs from ~/.claude/scripts/session-hub-hook.py when Claude Code
// fires Stop / UserPromptSubmit hooks. Forwards to renderer as IPC events.
const hookServer = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');

  const isHook = req.method === 'POST' && req.url.startsWith('/api/hook/');
  const isStatus = req.method === 'POST' && req.url === '/api/status';
  // 2026-05-16 道雪：防卡死 — 外部 HTTP 救援入口，tools/hub-escape.ps1 调
  const isEscapeHome = req.method === 'POST' && req.url === '/api/escape-home';
  if (!isHook && !isStatus && !isEscapeHome) {
    res.writeHead(404); res.end('{}'); return;
  }

  // Cap body size at 16KB — statusline payloads are tiny, hooks tinier
  let body = '';
  let tooBig = false;
  req.on('data', (c) => {
    if (tooBig) return;
    if (body.length + c.length > 16384) { tooBig = true; return; }
    body += c;
  });
  req.on('end', async () => {
    if (tooBig) { res.writeHead(413); res.end('{}'); return; }
    let parsed;
    try { parsed = JSON.parse(body || '{}'); } catch { parsed = {}; }
    // 2026-05-16 道雪：外部 HTTP 救援 — tools/hub-escape.ps1 调这条路由触发 escapeToHome()
    if (isEscapeHome) {
      if (parsed.token !== HOOK_TOKEN) {
        console.warn('[escape-home] 403 wrong token from', req.socket && req.socket.remoteAddress);
        res.writeHead(403); res.end('{}'); return;
      }
      // 检查 renderer 真的可达 — mainWindow.isDestroyed() 不够，renderer 进程 crash 时
      // webContents.send 会静默 drop。这种场景下回 503 让 ps1 提示"需手动重启 Hub"。
      const rendererReachable = mainWindow && !mainWindow.isDestroyed()
        && mainWindow.webContents && !mainWindow.webContents.isCrashed();
      if (!rendererReachable) {
        console.warn('[escape-home] renderer unreachable (destroyed or crashed) — endpoint returns 503');
        res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, pid: process.pid, error: 'renderer unreachable' }));
        return;
      }
      console.log('[escape-home] HTTP triggered');
      // 2026-05-17 道雪：主 webContents 可能已被外部 URL navigate 走（renderer 跑的
      //   是远程网页，preload IPC 失效，sendToRenderer('escape-home') 收不到）。
      //   此时直接 loadFile 拉回 index.html — Hub 主进程没死，session 子进程没丢，
      //   只是 renderer 重新初始化从 state.json 恢复。
      const currentUrl = mainWindow.webContents.getURL();
      const navigatedAway = !currentUrl.startsWith('file:') || !currentUrl.includes('/renderer/index.html');
      if (navigatedAway) {
        console.warn('[escape-home] main webContents has been navigated to', currentUrl, '→ loadFile back to index.html');
        mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true, pid: process.pid, recovered: 'loadFile', from: currentUrl }));
        return;
      }
      sendToRenderer('escape-home');
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, pid: process.pid }));
      return;
    }
    if (parsed.token !== HOOK_TOKEN) {
      res.writeHead(403); res.end('{}'); return;
    }
    if (parsed.sessionId && sessionManager.getSession(parsed.sessionId)) {
      if (isHook) {
        const event = req.url.slice('/api/hook/'.length); // 'stop' or 'prompt'
        // Prefer the UserPromptSubmit payload's `prompt` field when present —
        // it's the just-submitted text and doesn't depend on CC having flushed
        // the new transcript entry to disk. For Stop events (no `prompt` in
        // payload) fall back to reading the transcript JSONL tail (async —
        // long transcripts used to block the main-process event loop).
        let latestUserMessage = null;
        if (typeof parsed.prompt === 'string' && parsed.prompt.trim()) {
          latestUserMessage = parsed.prompt;
        } else if (parsed.transcriptPath) {
          latestUserMessage = await readLastUserMessage(parsed.transcriptPath);
        }
        // Feed the Claude transcript tap so the Hub timeline (research/general)
        // gets the authoritative final assistant turn. Only fire on Stop events
        // — UserPromptSubmit fires before the assistant has responded, so the
        // transcript tail's last-assistant entry would be the previous turn
        // and immediately trigger a stale update.
        if (parsed.claudeSessionId || parsed.transcriptPath) {
          updateSessionTranscriptBinding(parsed.sessionId, {
            ccSessionId: parsed.claudeSessionId,
            transcriptPath: parsed.transcriptPath,
          });
        }
        if (event === 'stop' && parsed.transcriptPath) {
          transcriptTap.notifyClaudeStop(parsed.sessionId, parsed.transcriptPath).catch(() => {});
        }
        if (event === 'prompt' && latestUserMessage) {
          maybeAutoTitleSessionFromPrompt({
            hubSessionId: parsed.sessionId,
            text: latestUserMessage,
            submittedAt: Date.now(),
            signalSource: 'hook_prompt',
          });
        }
        sendToRenderer('hook-event', {
          event,
          sessionId: parsed.sessionId,
          claudeSessionId: parsed.claudeSessionId,
          cwd: parsed.cwd,
          latestUserMessage,
        });
      } else {
        const filtered = claudeUsageFilter.filter(parsed.usage5h, parsed.usage7d);
        sendToRenderer('status-event', {
          sessionId: parsed.sessionId,
          contextPct: parsed.contextPct,
          contextUsed: parsed.contextUsed,
          contextMax: parsed.contextMax,
          usage5h: filtered.usage5h,
          usage7d: filtered.usage7d,
          model: parsed.model,
          sessionName: parsed.sessionName,
          cwd: parsed.cwd,
          apiMs: parsed.apiMs,
          linesAdded: parsed.linesAdded,
          linesRemoved: parsed.linesRemoved,
        });
        if (filtered.anyAccepted) cacheAccountUsage({ usage5h: filtered.usage5h, usage7d: filtered.usage7d });
      }
    }
    res.writeHead(200); res.end('{}');
  });
});

// Try candidate ports in order; return the first that listens successfully.
// Any bind error on a candidate (EADDRINUSE, EACCES, EPERM, …) falls through
// to the next; only when all candidates fail do we give up.
function listenWithFallback() {
  return new Promise((resolve) => {
    let idx = 0;
    const tryNext = () => {
      if (idx >= HOOK_PORT_CANDIDATES.length) return resolve(null);
      const port = HOOK_PORT_CANDIDATES[idx++];
      hookServer.removeAllListeners('error');
      hookServer.removeAllListeners('listening');
      hookServer.once('error', (e) => {
        console.warn(`[群聊] hook server bind failed on :${port} (${e.code}): ${e.message}`);
        tryNext();
      });
      hookServer.once('listening', () => resolve(port));
      hookServer.listen(port, '127.0.0.1');
    };
    tryNext();
  });
}

// --- Account usage cache ---
// Persist the latest Claude account usage so the sidebar renders immediately on
// restart without waiting for the first statusline callback.
const USAGE_CACHE_FILE = path.join(getHubDataDir(), 'usage-cache.json');
const STATUSLINE_CACHE_FILE = path.join(getHubDataDir(), 'statusline-cache.json');

// See core/usage-filter.js for why this filter exists (rate_limits monotonic
// within a window — stale low-pct snapshots from idle sessions must not
// overwrite the true usage from heavy sessions).
const claudeUsageFilter = createUsageFilter();
try { claudeUsageFilter.seed(loadUsageCache().claude); } catch {}

function cacheAccountUsage(data) {
  try {
    const existing = loadUsageCache();
    const cur = existing.claude || {};
    existing.claude = {
      usage5h: data.usage5h || cur.usage5h || null,
      usage7d: data.usage7d || cur.usage7d || null,
      ts: data.ts || Date.now(),
    };
    fs.mkdirSync(path.dirname(USAGE_CACHE_FILE), { recursive: true });
    fs.writeFileSync(USAGE_CACHE_FILE, JSON.stringify(existing));
  } catch {}
}

function loadStatuslineCache() {
  try { return JSON.parse(fs.readFileSync(STATUSLINE_CACHE_FILE, 'utf8')); } catch { return {}; }
}

function refreshClaudeAccountUsageFromStatuslineCache() {
  const before = loadUsageCache().claude || null;
  const snapshot = selectClaudeStatuslineUsage(loadStatuslineCache());
  if (!snapshot) {
    return {
      data: before,
      changed: false,
      observedAt: before && (before.observedAt || before.ts) || 0,
      source: 'statusline-cache',
    };
  }
  const filtered = claudeUsageFilter.filter(snapshot.usage5h, snapshot.usage7d);
  if (filtered.anyAccepted) {
    cacheAccountUsage({
      usage5h: filtered.usage5h,
      usage7d: filtered.usage7d,
      ts: snapshot.ts,
    });
  }
  const data = loadUsageCache().claude || null;
  return {
    data,
    changed: didClaudeSnapshotAdvance(before, { ...data, observedAt: snapshot.ts }),
    observedAt: snapshot.ts,
    source: snapshot.source,
  };
}

function cacheAgentUsage(provider, tokenData, scope = null) {
  try {
    const existing = loadUsageCache();
    const scoped = provider === 'codex' && scope
      ? attachCodexUsageScope(tokenData, scope)
      : tokenData;
    const observedAt = tokenData && (tokenData.observedAt || tokenData._ts) || Date.now();
    existing[provider] = { ...scoped, ts: observedAt };
    fs.mkdirSync(path.dirname(USAGE_CACHE_FILE), { recursive: true });
    fs.writeFileSync(USAGE_CACHE_FILE, JSON.stringify(existing));
  } catch {}
}

function loadUsageCache() {
  try { return JSON.parse(fs.readFileSync(USAGE_CACHE_FILE, 'utf8')); } catch { return {}; }
}

function currentCodexUsageScope() {
  return resolveCodexUsageScope(getHubConfig(), {
    hubDataDir: getHubDataDir(),
    homeDir: os.homedir(),
  });
}

let _codexLiveUsage = null;

async function refreshCodexAccountUsageLive() {
  const scope = currentCodexUsageScope();
  if (scope.backend !== 'subscription') {
    throw new Error('Codex API 模式没有订阅配额窗口');
  }
  const config = getHubConfig();
  const raw = await readCodexAccountUsage({
    home: scope.home,
    proxy: config.proxy,
    cwd: os.homedir(),
    timeoutMs: 8000,
  });
  const payload = { ...raw, _ts: raw.observedAt };
  _codexLiveUsage = attachCodexUsageScope(payload, scope);
  cacheAgentUsage('codex', payload, scope);
  return _codexLiveUsage;
}

function loadUsageCacheForCurrentConfig() {
  const scoped = filterUsageCacheForCodexScope(loadUsageCache(), currentCodexUsageScope());
  if (scoped.codex && scoped.codex.source === 'app-server') {
    scoped.codex = expireCodexUsageWindows(scoped.codex, Date.now());
  }
  return scoped;
}

try {
  const cachedCodex = loadUsageCacheForCurrentConfig().codex;
  if (cachedCodex && cachedCodex.source === 'app-server') _codexLiveUsage = cachedCodex;
} catch {}

registerUsageIpc(ipcMain, {
  clearCodexJsonlCache: () => _codexJsonlCachedByRoot.clear(),
  loadUsageCacheForCurrentConfig,
  refreshClaudeAccountUsage: refreshClaudeAccountUsageFromStatuslineCache,
  refreshCodexAccountUsage: refreshCodexAccountUsageLive,
  scanAgentSessions,
});

registerConfigIpc(ipcMain, {
  attachCodexUsageScope,
  clearCodexJsonlCache: () => _codexJsonlCachedByRoot.clear(),
  clearSessionManagerConfigCache,
  currentCodexUsageScope,
  scanAgentSessions,
  sendToRenderer,
});

// --- Gemini/Codex ring-buffer usage scanner ---
// Periodically scans agent sessions' ring buffers for token/model patterns
// and emits status-event so the renderer can show context/usage badges.
const _agentLastStatus = new Map();
const _agentQuota = { gemini: null };
const _codexCliQuotaBySession = new Map();
const CODEX_CLI_USAGE_FRESH_MS = 2 * 60 * 1000;

// --- Codex JSONL-based usage scanner ---
// Codex CLI writes rate-limit snapshots to ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl.
// They are a passive fallback; manual refresh uses app-server for the selected profile.
// Each file contains token_count events with primary (5h) and secondary (7d) windows.
let _codexJsonlLastScan = 0;
let _codexJsonlCached = null;
const _codexJsonlCachedByRoot = new Map();
const CODEX_JSONL_THROTTLE_MS = 5_000;
const CODEX_JSONL_CANDIDATE_LIMIT = 20;

function scanCodexJsonlUsage(sessionsDir = DEFAULT_CODEX_SESSIONS_ROOT, opts = {}) {
  try {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const datePaths = [];
    datePaths.push(path.join(sessionsDir, String(now.getFullYear()), pad(now.getMonth() + 1), pad(now.getDate())));
    const yesterday = new Date(now.getTime() - 86400000);
    datePaths.push(path.join(sessionsDir, String(yesterday.getFullYear()), pad(yesterday.getMonth() + 1), pad(yesterday.getDate())));

    const candidates = [];
    for (const dir of datePaths) {
      let files;
      try { files = fs.readdirSync(dir).filter(f => f.startsWith('rollout-') && f.endsWith('.jsonl')); } catch { continue; }
      const withStats = files.map(f => {
        const fp = path.join(dir, f);
        try { return { path: fp, mtime: fs.statSync(fp).mtimeMs }; } catch { return null; }
      }).filter(Boolean);
      withStats.sort((a, b) => b.mtime - a.mtime);
      for (const file of withStats.slice(0, CODEX_JSONL_CANDIDATE_LIMIT)) {
        const entry = extractCodexRateLimits(file.path);
        if (entry) {
          candidates.push({
            ...entry,
            rolloutPath: file.path,
            observedAt: entry.observedAt || file.mtime,
          });
        }
      }
    }
    return mergeCodexRateLimitCandidates(candidates, Date.now(), {
      minObservedAt: opts.minObservedAt || 0,
    });
  } catch { return null; }
}

function scanCodexJsonlUsageThrottled(sessionsDir = DEFAULT_CODEX_SESSIONS_ROOT, opts = {}) {
  const now = Date.now();
  const key = [
    path.resolve(sessionsDir || DEFAULT_CODEX_SESSIONS_ROOT).toLowerCase(),
    Math.floor(Number(opts.minObservedAt) || 0),
  ].join('|');
  const cached = _codexJsonlCachedByRoot.get(key);
  if (!opts.force && cached && now - cached.ts < CODEX_JSONL_THROTTLE_MS) return cached.data;
  const data = scanCodexJsonlUsage(sessionsDir, opts);
  _codexJsonlCachedByRoot.set(key, { ts: now, data });
  _codexJsonlLastScan = now;
  _codexJsonlCached = data;
  return data;
}

// Token-based rolling-window tracker for Gemini/Codex (fallback).
const AGENT_LIMITS = {
  gemini: { tokens5h: 2_000_000, tokens7d: 50_000_000 },
  codex:  { tokens5h: 1_000_000, tokens7d: 10_000_000 },
};
const _agentTokenLog = { gemini: [], codex: [] }; // [{ts, tokens}]

function agentUsageScopeKey(sessionsRoot) {
  return path.resolve(sessionsRoot || DEFAULT_CODEX_SESSIONS_ROOT).toLowerCase();
}

function recordAgentTokens(kind, tokens, scopeKey = null) {
  if (!_agentTokenLog[kind]) return;
  _agentTokenLog[kind].push({ ts: Date.now(), tokens, scopeKey });
}

function calcAgentUsage(kind, scopeOrRoot = null) {
  const log = _agentTokenLog[kind];
  if (!log) return null;
  const now = Date.now();
  const H5 = 5 * 3600 * 1000;
  const D7 = 7 * 86400 * 1000;
  // Prune entries older than 7d
  while (log.length && log[0].ts < now - D7) log.shift();
  const scopeKey = scopeOrRoot ? agentUsageScopeKey(scopeOrRoot) : null;
  const scopedLog = scopeKey ? log.filter(e => e.scopeKey === scopeKey) : log;
  const tok5h = scopedLog.filter(e => e.ts >= now - H5).reduce((s, e) => s + e.tokens, 0);
  const tok7d = scopedLog.reduce((s, e) => s + e.tokens, 0);
  const lim = AGENT_LIMITS[kind];
  if (!lim) return null;
  if (tok5h === 0 && tok7d === 0) return null;
  return {
    usage5h: { pct: Math.min(100, Math.round(tok5h / lim.tokens5h * 100)), resetsAt: now + H5 },
    usage7d: { pct: Math.min(100, Math.round(tok7d / lim.tokens7d * 100)), resetsAt: now + D7 },
  };
}

function scanAgentSessions(opts = {}) {
  const force = !!opts.force;
  const allSessions = sessionManager.getAllSessions();
  for (const s of allSessions) {
    if (s.kind !== 'gemini' && !isCodexBaseKind(s.kind)) continue;
    if (s.status === 'dormant') continue;
    const buf = sessionManager.getSessionBuffer(s.id);
    if (!buf) continue;
    const plain = stripAnsi(buf);
    const parsed = s.kind === 'gemini' ? parseGeminiUsage(plain) : parseCodexUsage(plain);
    if (isCodexBaseKind(s.kind) && (parsed.usage5h || parsed.usage7d)) {
      const usageSig = JSON.stringify({ usage5h: parsed.usage5h || null, usage7d: parsed.usage7d || null });
      const usageKey = s.id + ':codex-cli-usage';
      if (_agentLastStatus.get(usageKey) !== usageSig) {
        _agentLastStatus.set(usageKey, usageSig);
        recordCodexCliUsage(
          _codexCliQuotaBySession,
          s,
          parsed,
          Date.now(),
          DEFAULT_CODEX_SESSIONS_ROOT,
        );
      }
    }
    if (parsed.tokensUsed) {
      const prev = _agentLastStatus.get(s.id + ':tok');
      if (prev !== parsed.tokensUsed) {
        const delta = prev ? parsed.tokensUsed - prev : parsed.tokensUsed;
        const scopeKey = isCodexBaseKind(s.kind)
          ? agentUsageScopeKey(s.codexSessionsRoot || DEFAULT_CODEX_SESSIONS_ROOT)
          : null;
        if (delta > 0) recordAgentTokens(isCodexBaseKind(s.kind) ? 'codex' : s.kind, delta, scopeKey);
        _agentLastStatus.set(s.id + ':tok', parsed.tokensUsed);
      }
    }
    // Gemini quotaPct → direct sidebar usage (real API quota from CLI footer)
    if (parsed.quotaPct != null) {
      const now = Date.now();
      const H5 = 5 * 3600 * 1000;
      const usageObj = { usage5h: { pct: parsed.quotaPct, resetsAt: now + H5 }, _ts: now };
      _agentQuota.gemini = usageObj;
    }
    if (!parsed.model && !parsed.tokensUsed && parsed.contextPct == null && parsed.quotaPct == null) continue;
    const prev = _agentLastStatus.get(s.id);
    const sig = JSON.stringify(parsed);
    if (prev === sig) continue;
    _agentLastStatus.set(s.id, sig);
    const payload = { sessionId: s.id };
    if (parsed.contextPct != null) payload.contextPct = parsed.contextPct;
    if (parsed.contextUsed != null) payload.contextUsed = parsed.contextUsed;
    if (parsed.contextMax != null) payload.contextMax = parsed.contextMax;
    if (parsed.model) payload.model = parsed.model;
    sendToRenderer('status-event', payload);
  }
  // Expire stale CLI quota entries (no fresh CLI data for >10 min).
  const now = Date.now();
  if (_agentQuota.gemini && _agentQuota.gemini._ts && now - _agentQuota.gemini._ts > 10 * 60 * 1000) {
    _agentQuota.gemini = null;
  }
  pruneCodexCliUsage(_codexCliQuotaBySession, now, 10 * 60 * 1000);
  // Build and broadcast per-provider usage.
  // Manual app-server reads are authoritative for the selected profile. Newer
  // CLI/JSONL snapshots may supersede them only when the weekly reset boundary
  // proves they belong to the same account/window.
  const agentData = {};
  // Codex: visible `/usage` output is the freshest user-triggered source.
  // Fall back to JSONL token_count snapshots, then local token estimates.
  const codexScope = currentCodexUsageScope();
  const freshCodexCliUsage = selectCodexCliUsageForScope(_codexCliQuotaBySession, codexScope, {
    now,
    maxAgeMs: CODEX_CLI_USAGE_FRESH_MS,
    defaultSessionsRoot: DEFAULT_CODEX_SESSIONS_ROOT,
  });
  const cachedCodexCliUsage = selectCodexCliUsageForScope(_codexCliQuotaBySession, codexScope, {
    now,
    maxAgeMs: 10 * 60 * 1000,
    defaultSessionsRoot: DEFAULT_CODEX_SESSIONS_ROOT,
  });
  const codexJsonl = freshCodexCliUsage ? null : scanCodexJsonlUsageThrottled(codexScope.sessionsRoot, {
    force,
    minObservedAt: codexScope.authSinceMs || 0,
  });
  if (freshCodexCliUsage) {
    const payload = { ...freshCodexCliUsage, source: 'cli-usage', observedAt: freshCodexCliUsage._ts, _ts: freshCodexCliUsage._ts };
    agentData.codex = attachCodexUsageScope(payload, codexScope);
    cacheAgentUsage('codex', payload, codexScope);
  } else if (codexJsonl) {
    const payload = { ...codexJsonl, source: 'jsonl', _ts: codexJsonl.observedAt || now };
    agentData.codex = attachCodexUsageScope(payload, codexScope);
    cacheAgentUsage('codex', payload, codexScope);
  } else if (cachedCodexCliUsage) {
    const payload = { ...cachedCodexCliUsage, source: 'cli', observedAt: cachedCodexCliUsage._ts, _ts: cachedCodexCliUsage._ts };
    agentData.codex = attachCodexUsageScope(payload, codexScope);
    cacheAgentUsage('codex', payload, codexScope);
  } else {
    const usage = calcAgentUsage('codex', codexScope.sessionsRoot);
    if (usage) {
      const payload = { ...usage, source: 'estimate', observedAt: now, _ts: now };
      agentData.codex = attachCodexUsageScope(payload, codexScope);
      cacheAgentUsage('codex', payload, codexScope);
    } else {
      agentData.codex = attachCodexUsageScope({ usage5h: null, usage7d: null, unavailable: true }, codexScope);
    }
  }
  const liveForScope = _codexLiveUsage && _codexLiveUsage.scopeKey === codexScope.scopeKey
    ? expireCodexUsageWindows(_codexLiveUsage, now)
    : null;
  if (shouldPreferCodexLiveUsage(liveForScope, agentData.codex, now)) {
    agentData.codex = liveForScope;
    cacheAgentUsage('codex', liveForScope, codexScope);
  }
  // Gemini: quota from CLI footer > token estimates
  if (_agentQuota.gemini) {
    const gemData = { usage5h: _agentQuota.gemini.usage5h };
    const tokenUsage = calcAgentUsage('gemini');
    if (tokenUsage && tokenUsage.usage7d) gemData.usage7d = tokenUsage.usage7d;
    agentData.gemini = gemData;
    cacheAgentUsage('gemini', gemData);
  } else {
    const usage = calcAgentUsage('gemini');
    if (usage) { agentData.gemini = usage; cacheAgentUsage('gemini', usage); }
  }
  if (Object.keys(agentData).length > 0) sendToRenderer('agent-usage', agentData);
  return agentData;
}

let _agentScanInterval = null;
function startAgentScanner() {
  if (_agentScanInterval) return;
  _agentScanInterval = setInterval(scanAgentSessions, 5000);
}

app.whenReady().then(async () => {
  traceStartup('app.whenReady');
  const _home = process.env.USERPROFILE || process.env.HOME || os.homedir();
  traceStartup('deploy hooks start');
  // Hook deployment requires Python. DeepSeek uses a Hub-managed config and
  // always receives the hook when possible; the user's primary Claude config
  // receives it only after explicit opt-in. Transcript terminal-state polling
  // remains the no-hook fallback.
  let pythonAvailable = false;
  try {
    require('child_process').execFileSync('where', ['python'], { stdio: 'ignore', timeout: 4000, windowsHide: true });
    pythonAvailable = true;
  } catch {}
  const primaryClaudeDir = path.join(_home, '.claude');
  if (pythonAvailable && getHubConfig().claudeHookIntegration) {
    ensureHooksDeployed(primaryClaudeDir, { hubManaged: false });
  } else {
    // Also migrates v1.0.0 users away from the old implicit global hooks.
    removeHubHooksFromPrimarySettings(primaryClaudeDir);
  }
  if (pythonAvailable) {
    ensureHooksDeployed(path.join(_home, '.claude-deepseek'), { hubManaged: true });
  } else {
    console.warn('[群聊] python not found on PATH — skipping hook deployment (card auto-sync disabled until python is installed)');
  }
  traceStartup('deploy hooks done');
  traceStartup('createWindow start');
  createWindow();
  traceStartup('createWindow done');
  traceStartup('hook listen start');
  hookPort = await listenWithFallback();
  if (hookPort) {
    console.log(`[群聊] hook server listening on 127.0.0.1:${hookPort}`);
    sessionManager.hookPort = hookPort;
  } else {
    console.warn('[群聊] hook server failed to bind — falling back to silence detection');
  }
  traceStartup(`hook listen done (${hookPort || 'none'})`);
  sendToRenderer('hook-status', { up: hookPort !== null, port: hookPort });

  // 2026-06-05 联邦记忆下线：claude-memory-loader 只做 readFileSync，无需预热

  // 2026-05-16 道雪：写 per-PID 控制文件（含 hookPort + cdpPort + HOOK_TOKEN）。
  //   救援脚本 tools/hub-escape.ps1 通过 <dataDir>/control/<pid>.json 发现 Hub
  //   端口和 token。CDP 端口从 <userData>/DevToolsActivePort 读取（Chromium 写入）。
  try {
    const dataDir = getHubDataDir();
    let cdpPort = null;
    if (_cdpEnabled) {
      // Chromium 只在 --remote-debugging-port=0（OS 自动分配）时才写 DevToolsActivePort 文件；
      // 当 CLI 已传明确端口（E2E hub-launcher 场景）时直接从 argv 解析。
      if (_hasCdpSwitch) {
        const m = process.argv.find(a => a.startsWith('--remote-debugging-port='));
        if (m) {
          const p = parseInt(m.split('=')[1], 10);
          if (!isNaN(p) && p > 0) cdpPort = p;
        }
      } else {
        cdpPort = await hubControl.readDevToolsActivePort(app.getPath('userData'));
        if (!cdpPort) console.warn('[hub-control] DevToolsActivePort not ready within 3s — CDP backdoor may be unreachable');
      }
    }
    const removed = hubControl.cleanStale(dataDir);
    if (removed.length) console.log(`[hub-control] cleaned stale entries for pids: ${removed.join(', ')}`);
    hubControl.writeControlFile({
      pid: process.pid,
      hookPort,
      cdpPort,
      token: HOOK_TOKEN,
      dataDir,
      startedAt: Date.now(),
    });
    console.log(`[hub-control] control file written: pid=${process.pid} hookPort=${hookPort} cdpPort=${cdpPort}`);
  } catch (e) {
    console.warn('[hub-control] init failed:', e.message);
  }

  traceStartup('startAgentScanner');
  startAgentScanner();
});

app.on('before-quit', async () => {
  // 2026-05-07 道雪：退出时保证三层都同步落盘——state.json（lock + merge）、
  //   per-meeting JSON、per-session JSON。任意一层丢了，下次 boot 的 selfHeal
  //   都能从另一层恢复。
  stateStore.save({ version: 1, cleanShutdown: true, sessions: lastPersistedSessions, meetings: meetingManager.getAllMeetings(), immersiveByMeeting: _immersiveByMeeting }, { sync: true });
  try {
    await meetingStore.flushAll();
    console.log('[群聊] meeting-store flushed on quit');
  } catch (err) {
    console.warn('[群聊] meeting-store flush failed:', err.message);
  }
  try {
    sessionStore.flushAll();
    console.log('[hub] session-store flushed on quit');
  } catch (err) {
    console.warn('[hub] session-store flush failed:', err.message);
  }

  // 2026-05-16 道雪：清理自己的控制文件。unlinkSelf 内部已 try/catch + warn 非 ENOENT 错误，
  // 不外抛，所以这里裸调即可，不再加外层 catch（避免盖住内部 warn）。
  hubControl.unlinkSelf(getHubDataDir(), process.pid);

});

app.on('window-all-closed', () => {
  hookServer.close();
  sessionManager.dispose();
  app.quit();
});
