// The last check before a message leaves the host for Vector or Discord: provider details are taken out, so a model
// that repeats them (an Ollama address from an error, an account name from its context) can't post them to other
// people. This is a backstop, not the main protection: those details shouldn't reach a bridge turn's context at all,
// and error text is never sent to a bridge. Patterns can't catch a paraphrase, so see host/README.md for its limits.

'use strict';
const os = require('node:os');

const HIDDEN = '[hidden]';

// what an address or a key looks like, wherever it came from
const PATTERNS = [
  ['address', /\b(?:https?:\/\/)?(?:localhost|127(?:\.\d{1,3}){3}|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])(?:\.\d{1,3}){2})(?::\d{2,5})?(?:\/[^\s)\]>"']*)?/gi], // this computer, home networks, the tailnet
  ['address', /\b(?:https?:\/\/)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.ts\.net(?::\d{2,5})?(?:\/[^\s)\]>"']*)?/gi], // tailnet names
  ['address', /\[?\bf[cd][0-9a-f]{2}:[0-9a-f:]{2,}\]?(?::\d{2,5})?/gi], // private IPv6 (the tailnet's included)
  ['address', /\b(?:https?:\/\/)?[a-z0-9.-]+:11434\b(?:\/[^\s)\]>"']*)?/gi], // anything on Ollama's port
  ['key', /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}/g],
  ['key', /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}|\bgithub_pat_[A-Za-z0-9_]{20,}/g],
  ['key', /\bxox[abprs]-[A-Za-z0-9-]{10,}/g],
  ['key', /\bAIza[0-9A-Za-z_-]{30,}/g],
  ['key', /\bnsec1[02-9ac-hj-np-z]{20,}/g],
  ['key', /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/g],
  ['key', /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g],
];

/**
 * known: exact strings to hide wherever they appear (provider account names, a provider's host name, this computer's
 * name, the home folder). Short ones (under 4 characters) are left out: they would hide ordinary words.
 */
function createRedactor({ known = [], hostDetails = true } = {}) {
  const words = new Set(known.map((s) => String(s || '').trim()).filter((s) => s.length >= 4));
  if (hostDetails) {
    try { const h = os.hostname(); if (h && h.length >= 4) words.add(h); } catch { /* none */ }
    try { const u = os.userInfo().username; if (u && u.length >= 4) words.add(u); } catch { /* none */ }
  }
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // longest first, so a full path goes before the user name inside it; slashes either way round
  const knownRe = words.size
    ? new RegExp([...words].sort((a, b) => b.length - a.length).map((w) => esc(w).replace(/\\\\|\//g, '[\\\\/]')).join('|'), 'gi')
    : null;

  /** → { text, hits: { address: n, key: n, known: n } }. Never returns what it hid. */
  return function redact(text) {
    let t = String(text ?? '');
    const hits = {};
    const count = (k) => () => { hits[k] = (hits[k] || 0) + 1; return HIDDEN; };
    for (const [kind, re] of PATTERNS) t = t.replace(re, count(kind));
    if (knownRe) t = t.replace(knownRe, count('known'));
    return { text: t, hits };
  };
}

module.exports = { createRedactor, HIDDEN };
