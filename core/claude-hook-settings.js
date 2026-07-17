'use strict';

function isHubHookCommand(hook) {
  return !!(hook && typeof hook.command === 'string' && hook.command.includes('session-hub-hook.py'));
}

function stripHubHookEntries(settings = {}) {
  const next = { ...settings };
  if (!settings.hooks || typeof settings.hooks !== 'object') {
    return { settings: next, changed: false };
  }

  const hooks = { ...settings.hooks };
  let changed = false;
  for (const eventName of ['Stop', 'UserPromptSubmit']) {
    if (!Array.isArray(hooks[eventName])) continue;
    const keptEntries = [];
    for (const entry of hooks[eventName]) {
      if (!entry || !Array.isArray(entry.hooks)) {
        keptEntries.push(entry);
        continue;
      }
      const keptHooks = entry.hooks.filter((hook) => !isHubHookCommand(hook));
      if (keptHooks.length !== entry.hooks.length) changed = true;
      if (keptHooks.length > 0) keptEntries.push({ ...entry, hooks: keptHooks });
    }
    hooks[eventName] = keptEntries;
  }
  next.hooks = hooks;
  return { settings: next, changed };
}

module.exports = { isHubHookCommand, stripHubHookEntries };
