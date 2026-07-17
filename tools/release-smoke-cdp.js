'use strict';

const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const cdpBase = process.env.E2E_CDP || 'http://127.0.0.1:9333';
const mode = process.env.E2E_MODE || 'positive';
const screenshotDir = process.env.E2E_SCREENSHOT_DIR || path.join(__dirname, '..', 'docs', 'screenshots');
const previewFixture = process.env.E2E_PREVIEW_FIXTURE || path.join(__dirname, '..', 'tests', 'fixtures', 'untrusted-preview.html');

function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function targetList() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${cdpBase}/json/list`);
      const targets = await response.json();
      if (targets.some((target) => target.type === 'page')) return targets;
    } catch {}
    await delay(250);
  }
  throw new Error(`CDP target not available: ${cdpBase}`);
}

async function connect() {
  const targets = await targetList();
  const target = targets.find((item) => item.type === 'page' && /index\.html/.test(item.url))
    || targets.find((item) => item.type === 'page');
  const ws = new WebSocket(target.webSocketDebuggerUrl, { perMessageDeflate: false });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('CDP websocket timeout')), 5000);
    ws.once('open', () => { clearTimeout(timer); resolve(); });
    ws.once('error', reject);
  });
  let nextId = 0;
  const pending = new Map();
  ws.on('message', (raw) => {
    const message = JSON.parse(raw.toString());
    if (message.id == null || !pending.has(message.id)) return;
    const { resolve, reject, method } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(`${method}: ${message.error.message}`));
    else resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject, method });
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => {
      if (!pending.has(id)) return;
      pending.delete(id);
      reject(new Error(`${method}: timeout`));
    }, 30000).unref?.();
  });
  const evaluate = async (body) => {
    const result = await send('Runtime.evaluate', {
      expression: `(async () => { ${body} })()`,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (result.exceptionDetails) {
      const exception = result.exceptionDetails.exception;
      throw new Error(exception && (exception.description || exception.value) || 'renderer evaluation failed');
    }
    return result.result.value;
  };
  return { ws, send, evaluate };
}

async function main() {
  const cdp = await connect();
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  const checks = [];
  const check = (condition, label, detail) => {
    checks.push({ ok: !!condition, label, detail: detail == null ? undefined : detail });
    if (!condition) throw new Error(`${label}${detail == null ? '' : `: ${JSON.stringify(detail)}`}`);
  };
  const waitFor = async (expression, timeoutMs = 10000) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (await cdp.evaluate(`return !!(${expression});`)) return;
      await delay(100);
    }
    throw new Error(`waitFor timeout: ${expression}`);
  };
  const screenshot = async (name) => {
    fs.mkdirSync(screenshotDir, { recursive: true });
    const result = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    const output = path.join(screenshotDir, name);
    fs.writeFileSync(output, Buffer.from(result.data, 'base64'));
    return output;
  };

  await waitFor(`document.readyState === 'complete' && document.body`);
  const boot = await cdp.evaluate(`return {
    title: document.title,
    body: document.body.innerText,
    location: location.href,
    launcherVersion: document.querySelector('.launcher-version')?.textContent || '',
    errors: window.__releaseSmokeErrors || []
  };`);
  check(/AI 群聊 Hub/.test(boot.title), 'main renderer loaded', boot.title);
  check(boot.launcherVersion === `v${require('../package.json').version}`, 'launcher version matches package metadata', boot.launcherVersion);
  check(!/gpt-5\.6-sol|claude-opus-4-8|deepseek-v4-pro\[1m\]/.test(boot.body), 'private model aliases absent');

  if (mode === 'positive') {
    await cdp.evaluate(`window.showOnboarding(); return true;`);
    await waitFor(`document.querySelector('#onboarding-overlay')`);
    const onboardingText = await cdp.evaluate(`return document.querySelector('#onboarding-overlay').innerText;`);
    check(onboardingText.includes('不等于已验证登录'), 'onboarding distinguishes detection from login');
    check(onboardingText.includes('启动条件已具备'), 'DeepSeek composite readiness is visible');
    checks.push({ ok: true, label: 'welcome screenshot', detail: await screenshot('welcome-guide.png') });
    await cdp.evaluate(`document.querySelector('#ob-start').click(); return true;`);
    await waitFor(`!document.querySelector('#onboarding-overlay')`);
    const mainText = await cdp.evaluate(`return document.body.innerText;`);
    check(!/lintian050/i.test(mainText), 'isolated UI contains no personal session label');
    checks.push({ ok: true, label: 'main screenshot', detail: await screenshot('main-empty.png') });

    await cdp.evaluate(`openConfigModal(); return true;`);
    await waitFor(`!document.querySelector('#config-modal').classList.contains('hidden')`);
    const configState = await cdp.evaluate(`return {
      execution: document.querySelector('#cfg-execution-mode').value,
      hook: document.querySelector('#cfg-claude-hook-integration').value,
      text: document.querySelector('#config-modal').innerText
    };`);
    check(configState.execution === 'safe', 'safe execution is the first-run default', configState.execution);
    check(configState.hook === 'off', 'primary Claude hook is opt-in', configState.hook);
    check(configState.text.includes('跳过审批与沙箱'), 'dangerous mode warning is visible');
    await cdp.evaluate(`document.querySelector('#config-close').click(); return true;`);

    const originalLocation = await cdp.evaluate(`return location.href;`);
    await cdp.evaluate(`location.href = 'file:///C:/Windows/win.ini'; return true;`);
    await delay(500);
    const guardedLocation = await cdp.evaluate(`return location.href;`);
    check(guardedLocation === originalLocation, 'main frame blocks arbitrary local files', guardedLocation);

    await cdp.evaluate(`await window.openPreviewPanel(${JSON.stringify(previewFixture)}); return true;`);
    await waitFor(`document.querySelector('#preview-body webview')`);
    const guestProbe = await cdp.evaluate(`
      const guest = document.querySelector('#preview-body webview');
      if (!guest) return null;
      await new Promise((resolve) => {
        if (guest.getURL && guest.getURL()) return resolve();
        guest.addEventListener('dom-ready', resolve, { once: true });
        setTimeout(resolve, 3000);
      });
      try {
        return await guest.executeJavaScript(` + JSON.stringify(`({ requireType: typeof require, processType: typeof process, inlineScriptRan: document.documentElement.hasAttribute('data-require-type') })`) + `);
      } catch (error) {
        return { executionBlocked: true, error: error.message || String(error) };
      }
    `);
    check(guestProbe && guestProbe.executionBlocked === true, 'local HTML preview blocks page JavaScript', guestProbe);
    await cdp.evaluate(`document.querySelector('#preview-close').click(); return true;`);

    await cdp.evaluate(`window.openMeetingCreateModal(); return true;`);
    await waitFor(`document.querySelector('.mcm-create').textContent !== '检测中...'`);
    const modal = await cdp.evaluate(`return {
      slots: document.querySelectorAll('.mcm-slot').length,
      createDisabled: document.querySelector('.mcm-create').disabled,
      addDisabled: document.querySelector('#mcm-add-member').disabled,
      modelLabels: Array.from(document.querySelectorAll('.mcm-model-select')).map((select) => select.selectedOptions[0]?.textContent || ''),
      deepseekDisabled: document.querySelector('.mcm-ai-select option[value="deepseek"]').disabled,
      text: document.querySelector('#meeting-create-modal').innerText
    };`);
    check(modal.slots === 3, 'positive modal seeds exactly three members', modal.slots);
    check(modal.createDisabled === false, 'positive modal can create');
    check(modal.addDisabled === true, 'fourth member is blocked');
    check(modal.modelLabels.every(Boolean), 'follow-CLI model choices have visible labels', modal.modelLabels);
    check(modal.deepseekDisabled === false, 'DeepSeek is available when Claude CLI and key exist');
    checks.push({ ok: true, label: 'positive group screenshot', detail: await screenshot('create-group.png') });
  } else {
    await cdp.evaluate(`document.querySelector('#onboarding-overlay #ob-start')?.click(); window.openMeetingCreateModal(); return true;`);
    await waitFor(`document.querySelector('.mcm-create').textContent !== '检测中...'`);
    const modal = await cdp.evaluate(`return {
      slots: document.querySelectorAll('.mcm-slot').length,
      createDisabled: document.querySelector('.mcm-create').disabled,
      addDisabled: document.querySelector('#mcm-add-member').disabled,
      disabledKinds: Array.from(document.querySelector('.mcm-ai-select').options).filter((option) => option.disabled).map((option) => option.value),
      deepseekLabel: document.querySelector('.mcm-ai-select option[value="deepseek"]').textContent,
      text: document.querySelector('#meeting-create-modal').innerText
    };`);
    check(modal.slots === 1, 'negative modal falls back to one explanatory slot', modal.slots);
    check(modal.createDisabled === true && modal.addDisabled === true, 'negative modal blocks create and add');
    check(modal.disabledKinds.length === 4, 'all unavailable providers are disabled', modal.disabledKinds);
    check(modal.deepseekLabel.includes('Claude CLI + API Key'), 'DeepSeek dependency is explicit', modal.deepseekLabel);
    check(modal.text.includes('状态检测失败') === false && modal.text.includes('尚未具备启动条件'), 'negative readiness warning rendered', modal.text);
    checks.push({ ok: true, label: 'negative group screenshot', detail: await screenshot('create-group-notready.png') });

    const backendGuard = await cdp.evaluate(`
      const ipc = require('electron').ipcRenderer;
      const before = (await ipc.invoke('get-meetings')).length;
      let message = '';
      try { await ipc.invoke('create-meeting', { slots: [{ kind: 'claude' }] }); } catch (error) { message = error.message || String(error); }
      const after = (await ipc.invoke('get-meetings')).length;
      return { before, after, message };
    `);
    check(backendGuard.before === backendGuard.after, 'backend rejection creates no persistent meeting', backendGuard);
    check(/Claude.*尚未就绪/.test(backendGuard.message), 'backend rejects unavailable provider', backendGuard.message);
  }

  cdp.ws.close();
  console.log(JSON.stringify({ mode, checks }, null, 2));
}

main().catch((error) => {
  console.error(error && error.stack || error);
  process.exit(1);
});
