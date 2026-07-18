'use strict';

const { ALL_AI_KINDS, isCustomKind } = require('./ai-kinds.js');

function buildProviderReadiness(clis = {}, config = {}) {
  return {
    claude: clis.claude === true,
    codex: clis.codex === true,
    gemini: clis.gemini === true,
    // DeepSeek is launched through Claude Code with a custom API endpoint, so
    // both the local Claude CLI and a DeepSeek key are required.
    deepseek: clis.claude === true && !!config.deepseekApiKey,
  };
}

function findUnavailableKinds(slots = [], readiness = {}, opts = {}) {
  // Custom command members cannot be pre-checked (any command the user saved is
  // taken on trust); validate only that the referenced id still exists.
  const customIds = new Set(Array.isArray(opts.customMembers) ? opts.customMembers.map(m => m && m.id).filter(Boolean) : []);
  const unavailable = [];
  for (const slot of slots) {
    const kind = String(slot && slot.kind || '').trim();
    if (!kind || unavailable.includes(kind)) continue;
    if (isCustomKind(kind)) {
      const id = kind.slice('custom:'.length);
      if (!customIds.has(id)) unavailable.push(kind);
      continue;
    }
    if (!ALL_AI_KINDS.includes(kind) || readiness[kind] !== true) unavailable.push(kind);
  }
  return unavailable;
}

module.exports = {
  buildProviderReadiness,
  findUnavailableKinds,
};
