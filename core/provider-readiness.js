'use strict';

const { ALL_AI_KINDS } = require('./ai-kinds.js');

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

function findUnavailableKinds(slots = [], readiness = {}) {
  const unavailable = [];
  for (const slot of slots) {
    const kind = String(slot && slot.kind || '').trim();
    if (!kind || unavailable.includes(kind)) continue;
    if (!ALL_AI_KINDS.includes(kind) || readiness[kind] !== true) unavailable.push(kind);
  }
  return unavailable;
}

module.exports = {
  buildProviderReadiness,
  findUnavailableKinds,
};
