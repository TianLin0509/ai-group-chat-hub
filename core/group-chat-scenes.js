'use strict';
// Group chat scene helpers.
//
// The standalone "general" edition ships no stock-research MCP tools and no
// external ai-team MCP. Every helper here is an intentional no-op, kept only so
// that any remaining legacy call site (e.g. the deprecated runtime scene-switch
// path) resolves without crashing. Returning null / empty means each group
// member starts as a plain CLI session with no extra MCP servers attached.

function writeResearchMcpConfig() { return null; }
function buildResearchMcpEntryForCodex() { return null; }
function buildAiTeamMcpEntryForCodex() { return null; }
function getScene() { return null; }
function writePromptFile() { return null; }
function writeCovenantSnapshot() { return null; }
function readCovenantSnapshot() { return ''; }
const COVENANT_RESEARCH = '';

module.exports = {
  writeResearchMcpConfig,
  buildResearchMcpEntryForCodex,
  buildAiTeamMcpEntryForCodex,
  getScene,
  writePromptFile,
  writeCovenantSnapshot,
  readCovenantSnapshot,
  COVENANT_RESEARCH,
};
