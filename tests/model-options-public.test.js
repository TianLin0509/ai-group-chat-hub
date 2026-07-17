'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MODEL_OPTIONS_BY_KIND,
  DEFAULT_MODEL_BY_KIND,
  modelFlag,
} = require('../core/model-options.js');

test('official CLI providers follow each user CLI default unless explicitly selected', () => {
  assert.equal(DEFAULT_MODEL_BY_KIND.claude, '');
  assert.equal(DEFAULT_MODEL_BY_KIND.codex, '');
  assert.equal(DEFAULT_MODEL_BY_KIND.gemini, '');
  assert.equal(modelFlag(''), '');
  assert.equal(modelFlag(null), '');
  assert.equal(modelFlag('gpt-5.6'), ' --model gpt-5.6');
});

test('public model options contain no private aliases or bracket suffixes', () => {
  const ids = Object.values(MODEL_OPTIONS_BY_KIND).flat().map((option) => option.id);
  assert.ok(ids.includes('deepseek-v4-pro'));
  assert.ok(ids.includes('deepseek-v4-flash'));
  assert.ok(ids.includes('gpt-5.6'));
  assert.doesNotMatch(ids.join('\n'), /\[1m\]|-sol\b/);
});
