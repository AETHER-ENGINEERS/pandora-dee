// Nap mode: the host is awake only while a client (the app, or a browser with the Atelier open) is connected to it.
//
// Why: her work is meant to happen with someone there. A loop running on its own, answering Vector and Discord, can
// put the person's provider details (an Ollama address, an account name) into a channel or a DM with other people.
// So with no client connected the host naps: no agent turns, no scheduled or heartbeat model calls, no replies through
// the bridges. It stays up for files, pairing, the shell when a client calls it, and its log.
//
// A client is connected while it holds a presence stream open (GET /host/presence/stream: the page's bridge opens
// one and reopens it if it drops). When the last one closes, a short grace period (a refresh, a dropped Wi-Fi) passes
// before the host naps. The first client to connect wakes it at once.

'use strict';

const DEFAULT_GRACE_MS = 60 * 1000;

/**
 * opts: { graceMs?, log?(kind, fields), now? }
 * Returns { connect(client) → release(), awake(), state(), onWake(fn), onNap(fn), close() }
 */
function createNap(opts = {}) {
  const graceMs = Number.isFinite(Number(opts.graceMs)) && Number(opts.graceMs) >= 0 ? Number(opts.graceMs) : DEFAULT_GRACE_MS;
  const log = opts.log || (() => {});
  const now = opts.now || Date.now;
  const clients = new Map(); // key → { device, page, since }
  let seq = 0;
  let awake = false;
  let since = now();
  let timer = null;
  const wakeFns = new Set(), napFns = new Set();

  function wake() {
    if (timer) { clearTimeout(timer); timer = null; }
    if (awake) return;
    awake = true; since = now();
    log('wake', { clients: clients.size });
    for (const f of wakeFns) { try { f(); } catch { /* a listener never stops the others */ } }
  }
  function nap() {
    timer = null;
    if (!awake || clients.size) return;
    awake = false; since = now();
    log('nap', {});
    for (const f of napFns) { try { f(); } catch { /* as above */ } }
  }
  function connect(client = {}) {
    const key = ++seq;
    clients.set(key, { device: client.device || '', page: client.page || '', since: now() });
    log('client.connected', { device: client.device || '', clients: clients.size });
    wake();
    let gone = false;
    return function release() {
      if (gone) return; gone = true;
      clients.delete(key);
      log('client.left', { device: client.device || '', clients: clients.size });
      if (!clients.size && awake && !timer) timer = setTimeout(nap, graceMs);
    };
  }
  return {
    connect,
    awake: () => awake,
    graceMs,
    state: () => ({ awake, since: new Date(since).toISOString(), clients: clients.size, graceMs, napsIn: timer ? graceMs : null }),
    onWake: (f) => (wakeFns.add(f), () => wakeFns.delete(f)),
    onNap: (f) => (napFns.add(f), () => napFns.delete(f)),
    close() { if (timer) clearTimeout(timer); timer = null; },
  };
}

module.exports = { createNap, DEFAULT_GRACE_MS };
