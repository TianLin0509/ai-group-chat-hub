'use strict';

function parsedUrl(value) {
  try { return new URL(String(value || '')); } catch { return null; }
}

function normalizeFileUrl(value) {
  const parsed = parsedUrl(value);
  if (!parsed || parsed.protocol !== 'file:') return '';
  parsed.hash = '';
  parsed.search = '';
  return parsed.href.toLowerCase();
}

function isTrustedMainNavigation(candidate, trustedIndexUrl) {
  const candidateFile = normalizeFileUrl(candidate);
  const trustedFile = normalizeFileUrl(trustedIndexUrl);
  return !!candidateFile && !!trustedFile && candidateFile === trustedFile;
}

function isAllowedExternalUrl(value) {
  const parsed = parsedUrl(value);
  return !!parsed && ['https:', 'http:', 'mailto:', 'tel:'].includes(parsed.protocol);
}

function isAllowedPreviewUrl(value) {
  const parsed = parsedUrl(value);
  if (!parsed) return false;
  if (parsed.protocol === 'https:' || parsed.protocol === 'http:') return true;
  if (parsed.protocol !== 'file:') return false;
  // Block both canonical and four-slash UNC forms. A remote file host can
  // trigger implicit SMB authentication on Windows even before content loads.
  return !parsed.hostname && !parsed.pathname.startsWith('//');
}

function isLocalHtmlPreviewUrl(value) {
  const parsed = parsedUrl(value);
  return !!parsed
    && parsed.protocol === 'file:'
    && isAllowedPreviewUrl(value)
    && /\.(?:html?|xhtml)$/i.test(parsed.pathname);
}

module.exports = {
  isAllowedExternalUrl,
  isAllowedPreviewUrl,
  isTrustedMainNavigation,
  isLocalHtmlPreviewUrl,
};
