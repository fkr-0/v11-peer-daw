// V11 Peer DAW/src/core/html.js
// Shared HTML escaping helpers for renderer templates.

const HTML_ESCAPE = Object.freeze({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
});

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => HTML_ESCAPE[char]);
}

export const escapeAttr = escapeHtml;
