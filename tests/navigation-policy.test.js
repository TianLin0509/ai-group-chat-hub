'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isAllowedExternalUrl,
  isAllowedPreviewUrl,
  isLocalHtmlPreviewUrl,
  isTrustedMainNavigation,
} = require('../core/navigation-policy.js');

test('Node-enabled main frame may only stay on the packaged renderer entry', () => {
  const entry = 'file:///C:/app/renderer/index.html';
  assert.equal(isTrustedMainNavigation(entry, entry), true);
  assert.equal(isTrustedMainNavigation(entry + '#home', entry), true);
  assert.equal(isTrustedMainNavigation('file:///C:/Users/Public/untrusted.html', entry), false);
  assert.equal(isTrustedMainNavigation('https://example.com', entry), false);
});

test('external and preview URL policies fail closed on executable schemes', () => {
  assert.equal(isAllowedExternalUrl('https://example.com'), true);
  assert.equal(isAllowedExternalUrl('mailto:test@example.com'), true);
  assert.equal(isAllowedExternalUrl('javascript:alert(1)'), false);
  assert.equal(isAllowedExternalUrl('file:///C:/temp/page.html'), false);
  assert.equal(isAllowedPreviewUrl('file:///C:/temp/page.html'), true);
  assert.equal(isAllowedPreviewUrl('file://attacker.example/share/page.html'), false);
  assert.equal(isAllowedPreviewUrl('file:////attacker.example/share/page.html'), false);
  assert.equal(isAllowedPreviewUrl('https://example.com'), true);
  assert.equal(isAllowedPreviewUrl('data:text/html,<script>alert(1)</script>'), false);
  assert.equal(isLocalHtmlPreviewUrl('file:///C:/temp/page.html'), true);
  assert.equal(isLocalHtmlPreviewUrl('file:///C:/temp/report.pdf'), false);
});
