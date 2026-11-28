// The host's runtime: the one place her turns, schedules, sparks and bridge traffic pass through, so the switches
// (host/settings.cjs), the queue (host/queue.cjs), the error guard (host/errors.cjs) and the redactor (host/redact.cjs)
// can't be stepped around.
//
// Who thinks ("the brain"):
//   - 'client': the connected Atelier, as today. Its loop answers; the host hands it the bridge messages it may answer
//     now and checks everything it sends back out. With no client connected there's no brain, which is nap mode.
//   - 'host': a model given to the runtime. Used by the tests today; the Atelier's own loop moves in here next.
//
// What it guarantees:
//   - a switch that's off is off: no turn without the loop, no heartbeat, schedule or spark without its switch, nothing
//     to or from a bridge's people without the bridges switch. The host's settings page says why each is off;
//   - when her model goes away (a usage limit, a refused key, unreachable), every switch goes off and stays off until
//     the person says it's back (or, if they chose so, a check finds it back);
//   - provider and model error text never reaches a channel or a DM. A message that looks like one is stopped, logged,
//     and taken as a sign the model is gone. At most, the person's own fixed line goes out instead;
//   - bridge messages that arrive while she can't answer wait in the queue on disk, in order, never expiring. She's
//     told they're there (a short notice: how many, which bridge, who from; never their words) and has her own tool
//     for them; the person has their three choices (give them to her now, later, write them to a file);
//   - everything is traced: what went to which model and what came back, each tool, each bridge message in and out,
//     what was stopped and why.

'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { classifyModelError, looksLikeProviderError } = require('./errors.cjs');

class Off extends Error {
  constructor(what, why) { super(`${what}: off right now (${why.join(', ')}).`); this.code = why.includes('napping') ? 'NAPPING' : 'OFF'; this.why = why; }
}

const pad = (n) => String(n).padStart(2, '0');
const stamp = (t) => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}.${pad(d.getMinutes())}`; };
const when = (t) => (t == null ? 'unknown' : new Date(t).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }));

/**
 * opts:
 *   settings   from createSettings(): the switches
 *   queue      from createQueue()
 *   brain      'client' (default) or 'host'
 *   model      async ({ messages, why }) → reply text (brain 'host')
 *   probe      async () → true when the model answers again (for afterModel 'auto')
 *   bridges    links from createBridgeLink(), or stand-ins with { name, poll, send, callTool?, forClient? }
 *   schedules  [{ id, kind: 'heartbeat' | 'schedules' | 'sparks', everyMs, prompt }]
 *   redact     (text) → { text, hits }
 *   log        (kind, fields): facts only
 *   trace      (kind, fields): what happened, contents included (stays on the host, for the person to look at)
 *   home, writeDir, pollMs, tickMs, probeMs
 */
function createRuntime(opts) {
  const { settings, queue, redact } = opts;
  const brain = opts.brain || 'client';
  const bridges = opts.bridges || [];
  const byName = new Map(bridges.map((b) => [b.name, b]));
  for (const b of bridges) if (!b.forClient) b.forClient = [];
  const schedules = (opts.schedules || []).map((s) => ({ kind: 'schedules', ...s, next: Date.now() + s.everyMs }));
  const log = opts.log || (() => {});
  const trace = opts.trace || (() => {});
  const pollMs = opts.pollMs ?? 2000, tickMs = opts.tickMs ?? 1000, probeMs = opts.probeMs ?? 60000;
  const writeDir = opts.writeDir || '/Pandora/Waiting Messages';
  // where her notice has gone while she can't answer: once per channel or DM (by bridge + chat), whoever writes there,
  // so the same person on Discord and on Vector gets it once in each place, and a new channel gets its own (the
  // person's decision, 2026-11-27: no identity-linking). Re-armed when her sending is on again (she's awake and ready).
  const noticed = new Set();
  let written = null;
  let timers = [];
  let busy = Promise.resolve();
  const serial = (f) => (...a) => { const run = busy.then(() => f(...a), () => f(...a)); busy = run.catch(() => {}); return run; };
  const need = (what, ...sw) => { const why = [...new Set(sw.flatMap((s) => settings.holds(s)))]; if (why.length) { log('refused', { what, why }); throw new Off(what, why); } };
  let wasSending = settings.on('send');
  settings.onChange(() => {
    const now = settings.on('send');
    if (now && !wasSending) { noticed.clear(); log('notice.rearmed', {}); }
    wasSending = now;
  });

  // ---------- the model ----------
  async function callModel(messages, why, ...sw) {
    need(why, 'loop', ...sw);
    trace('model.request', { why, messages });
    try {
      const reply = String(await opts.model({ messages, why }));
      trace('model.reply', { why, text: reply });
      return reply;
    } catch (e) {
      const kind = classifyModelError(e);
      trace('model.error', { why, cause: kind, text: String(e && e.message || e) });
      if (kind) settings.modelLost(kind, String(e && e.message || e));
      throw e;
    }
  }
  /** Her notice: what's waiting, without its words. '' when nothing is. */
  function notice() {
    const list = queue.list().filter((m) => !m.live);
    if (!list.length) return '';
    const by = new Map();
    for (const m of list) { const k = `${m.bridge === 'vector' ? 'Vector' : m.bridge === 'discord' ? 'Discord' : m.bridge} from ${m.from || 'someone'}`; by.set(k, (by.get(k) || 0) + 1); }
    return `${list.length} message${list.length === 1 ? '' : 's'} came while you were away and ${list.length === 1 ? 'is' : 'are'} waiting for you: ${[...by].map(([k, n]) => `${k}${n > 1 ? ` (${n})` : ''}`).join(', ')}. Look at them with waiting_messages whenever you choose.`;
  }
  async function turn({ text, from = 'client', history = [] }) {
    const n = notice();
    return callModel([...(n ? [{ role: 'system', content: n }] : []), ...history, { role: 'user', content: String(text) }], `turn:${from}`);
  }

  // ---------- bridges: out ----------
  /** Everything for a bridge's people goes through here. → true if it went out. */
  async function sendOut(bridge, tool, args, { fixedNotice = false } = {}) {
    if (!fixedNotice) need(`${bridge.name}: ${tool}`, 'send');
    const texts = TEXT_ARGS_OF(args);
    const bad = texts.find((t) => looksLikeProviderError(t));
    if (bad) {
      // never to a channel or a DM; and it means her model is gone
      log('bridge.blocked', { bridge: bridge.name, tool, chat: args.chat_id ?? null, why: 'provider error text' });
      trace('bridge.blocked', { bridge: bridge.name, tool, args });
      settings.modelLost(classifyModelError(bad) || 'usage-limit', bad);
      return false;
    }
    const out = { ...args }; const hits = {};
    for (const k of Object.keys(out)) if (typeof out[k] === 'string' && TEXT_KEYS.has(k)) { const r = redact(out[k]); out[k] = r.text; for (const [h, n] of Object.entries(r.hits)) hits[h] = (hits[h] || 0) + n; }
    if (Object.keys(hits).length) log('redacted', { bridge: bridge.name, chat: out.chat_id ?? null, hits });
    if (tool === 'send_message' && !bridge.callTool) await bridge.send({ chat: out.chat_id, text: out.content, replyTo: out.replied_to });
    else await bridge.callTool(tool, out);
    log('bridge.sent', { bridge: bridge.name, tool, chat: out.chat_id ?? null });
    trace('bridge.out', { bridge: bridge.name, tool, args: out, hidden: hits });
    return true;
  }
  const TEXT_KEYS = new Set(['content', 'text', 'message', 'caption', 'bio', 'about', 'name', 'reason']);
  const TEXT_ARGS_OF = (a) => Object.entries(a || {}).filter(([k, v]) => TEXT_KEYS.has(k) && typeof v === 'string').map(([, v]) => v);
  /** Her notice to the first message in each channel or DM while she can't answer: her own configured words, once. */
  async function sendNotice(bridge, m) {
    const place = `${bridge.name}
${m.chat}`;
    if (noticed.has(place)) return;
    noticed.add(place);
    const line = settings.noticeFor(bridge.name, m.chat, m.fromId, m.from).trim();
    if (!line) { log('notice.silent', { bridge: bridge.name, chat: m.chat }); return; }
    if (checkNotice(line)) { log('notice.refused', { bridge: bridge.name, chat: m.chat, why: 'provider details' }); return; } // never, whatever it says
    try {
      await sendOut(bridge, 'send_message', { chat_id: String(m.chat), content: line, ...(m.id != null ? { replied_to: String(m.id) } : {}) }, { fixedNotice: true });
      log('notice.sent', { bridge: bridge.name, chat: m.chat, group: !!m.group });
    } catch { log('notice.failed', { bridge: bridge.name, chat: m.chat }); } // never retried
  }
  /** Whether a notice text can be used: plain words, no provider details, not too long. → why not, or null. */
  function checkNotice(text) {
    const t = String(text || '');
    if (t.length > 500) return 'A notice is at most 500 characters.';
    if (looksLikeProviderError(t)) return 'That reads like a provider or model error, which never goes to a channel or a DM.';
    if (Object.keys(redact(t).hits).length) return 'That has an address, a key, or a hidden word in it, which a notice never carries.';
    return null;
  }

  // ---------- bridges: in ----------
  /** Hand one queued message to the brain. → true once it's handled (and has left the queue). */
  async function handle(m) {
    const bridge = byName.get(m.bridge);
    if (!bridge) { log('queue.no-bridge', { seq: m.seq, bridge: m.bridge }); return false; }
    if (brain === 'client') {
      // the Atelier answers it, as it does today: it gets the bridge's own message on its next read
      bridge.forClient.push(m.raw || { id: m.id, chat_id: m.chat, author: m.from, text: m.text });
      queue.done(m.seq);
      log('bridge.handed', { bridge: m.bridge, seq: m.seq, chat: m.chat });
      return true;
    }
    queue.trying(m.seq);
    let reply;
    try {
      const note = m.tries > 1 ? ' (handed to her again: the host stopped during her last turn for it)' : '';
      reply = await turn({ text: m.text, from: `${m.bridge}:${m.chat}${note}` });
    } catch (e) {
      log(e.code === 'NAPPING' || e.code === 'OFF' ? 'queue.kept' : 'turn.failed', { seq: m.seq, bridge: m.bridge, chat: m.chat });
      return false; // the error itself never goes to the bridge
    }
    try { if (!(await sendOut(bridge, 'send_message', { chat_id: String(m.chat), content: reply, ...(m.id != null ? { replied_to: String(m.id) } : {}) }))) return false; }
    catch (e) { log(e.code ? 'queue.kept' : 'bridge.send.failed', { seq: m.seq, bridge: m.bridge, chat: m.chat }); return false; }
    queue.done(m.seq);
    return true;
  }
  async function pollOnce() {
    // receiving is its own switch: on through naps and outages, so messages keep landing in the queue
    if (!settings.on('receive')) return;
    for (const b of bridges) {
      let got = [];
      try { got = (await b.poll()) || []; } catch { log('bridge.poll.failed', { bridge: b.name }); continue; }
      for (const m of got) {
        // answered now only while she's there and may send; otherwise it waits, and the sender gets her notice once
        const now = settings.on('send') && settings.on('loop');
        const rec = queue.add(b.name, { ...m, live: now });
        if (!rec) continue;
        trace('bridge.in', { bridge: b.name, id: rec.id, chat: rec.chat, from: rec.from, group: rec.group, text: rec.text, answeredNow: now });
        if (now) await handle(rec);
        else { log('bridge.kept', { bridge: b.name, chat: rec.chat }); if (!settings.on('send')) await sendNotice(b, rec); }
      }
    }
  }
  async function tickOnce() {
    const t = Date.now();
    for (const s of schedules) {
      if (t < s.next) continue;
      s.next = t + s.everyMs;
      const why = [...new Set([...settings.holds('loop'), ...settings.holds(s.kind)])];
      // logged when the reason changes, not at every tick (the log stays readable through a long nap)
      if (why.length) { const k = why.join(); if (s.lastSkip !== k) { s.lastSkip = k; log(`${s.kind}.skipped`, { id: s.id, why }); } continue; }
      s.lastSkip = null;
      try { await callModel([{ role: 'user', content: s.prompt }], `${s.kind}:${s.id}`, s.kind); log(`${s.kind}.ran`, { id: s.id }); }
      catch (e) { if (!e.code) log(`${s.kind}.failed`, { id: s.id }); }
    }
  }
  async function probeOnce() {
    if (settings.model().attached || settings.get().afterModel !== 'auto' || !opts.probe) return;
    try { if (await opts.probe()) settings.modelBack('a check found it answering again'); } catch { /* still gone */ }
  }
  /** "Try the model again": check it, and say so. It counts as back if it answers, but nothing is switched on: sending,
   *  heartbeat, schedules and sparks stay as they are until the person turns them on. */
  async function checkModel(by = 'someone') {
    if (!opts.probe) return { ok: null, note: "Her loop runs in the Atelier, with the Atelier's own models, so its next turn will show whether hers answers. Use \"She has a model again\" when it does. (To have the host check, run her loop on the host: Her models → where her loop runs.)" };
    let ok = false, detail = '';
    try { ok = !!(await opts.probe()); } catch (e) { detail = String(e && e.message || e).slice(0, 2000); }
    trace('model.check', { by, ok, detail });
    log('model.checked', { by, ok });
    if (ok) settings.modelBack(by + ' (a check that worked)');
    return { ok, detail, sending: settings.on('send') };
  }

  // ---------- the Atelier, reaching a bridge through the host ----------
  async function clientCall(name, tool, args = {}) {
    const bridge = byName.get(name);
    if (!bridge) throw Object.assign(new Error(`No bridge called ${name} on this host.`), { code: 'NONE' });
    if (tool === 'get_new_messages') {
      // only what she may answer now; anything else waits in the queue
      if (!settings.on('send') || !settings.on('loop')) return { content: [{ type: 'text', text: '[]' }] };
      const list = bridge.forClient.splice(0);
      return { content: [{ type: 'text', text: JSON.stringify(list) }] };
    }
    if (bridge.READS && bridge.READS.has(tool)) return bridge.callTool(tool, args);
    try {
      const went = await sendOut(bridge, tool, args);
      return went ? { content: [{ type: 'text', text: JSON.stringify({ ok: true }) }] } : { isError: true, content: [{ type: 'text', text: 'Not sent: it looked like a provider or model error, which never goes to a channel or a DM. Her model may be gone; the host has turned sending off.' }] };
    } catch (e) {
      if (e.code) return { isError: true, content: [{ type: 'text', text: `Not sent: sending to Vector and Discord is off right now (${e.why.join(', ')}).` }] };
      throw e;
    }
  }

  // ---------- what waited: her tool, and the person's choices ----------
  function herTool({ action = 'list', seq, all } = {}) {
    const list = queue.list().filter((m) => !m.live);
    const head = (m) => ({ seq: m.seq, bridge: m.bridge, from: m.from, chat: m.chat, arrived: new Date(m.receivedAt).toISOString() });
    if (action === 'list') { log('her.waiting.list', { count: list.length }); return { count: list.length, messages: list.map(head) }; }
    const pick = all ? list : list.filter((m) => m.seq === Number(seq));
    if (action === 'read') { log('her.waiting.read', { count: pick.length }); trace('her.waiting.read', { seqs: pick.map((m) => m.seq) }); return { messages: pick.map((m) => ({ ...head(m), text: m.text })) }; }
    if (action === 'handled') { for (const m of pick) queue.done(m.seq); log('her.waiting.handled', { count: pick.length }); return { handled: pick.length, left: queue.list().filter((m) => !m.live).length }; }
    return { error: 'action is list, read or handled' };
  }
  async function deliver({ count } = {}) {
    need('give her the waiting messages', 'loop', 'send');
    const n = Number(count) > 0 ? Number(count) : Infinity;
    let done = 0;
    log('queue.deliver', { asked: Number.isFinite(n) ? n : 'all', pending: queue.size() });
    while (done < n) { const m = queue.first(); if (!m) break; if (!(await handle(m))) break; done++; }
    return { delivered: done, left: queue.size() };
  }
  function later() { log('queue.later', { pending: queue.size() }); return { left: queue.size() }; }
  function writeFile() {
    const list = queue.list();
    if (!list.length) return { count: 0, path: null };
    const t = Date.now();
    let vp = `${writeDir}/${stamp(t)}.md`;
    const real = (p) => path.join(opts.home, ...p.split('/').filter(Boolean));
    for (let i = 2; fs.existsSync(real(vp)); i++) vp = `${writeDir}/${stamp(t)} (${i}).md`;
    const lines = [`# Messages that waited while she couldn't answer`, '', `${list.length} message${list.length === 1 ? '' : 's'}, oldest first, written ${when(t)}. They're still in the host's queue too, until the person clears it.`, ''];
    for (const m of list) {
      lines.push(`## ${when(m.receivedAt)} · ${m.bridge} · ${m.from || 'someone'}`, '', `- Where: ${m.chat || 'unknown'}${m.id != null ? ` · message ${m.id}` : ''}`);
      if (m.at != null && Math.abs(m.at - m.receivedAt) > 60_000) lines.push(`- Sent: ${when(m.at)}`);
      if (m.tries) lines.push(`- Handed to her ${m.tries} time${m.tries === 1 ? '' : 's'} before without finishing`);
      lines.push('', String(m.text).split('\n').map((l) => '> ' + l).join('\n'), '');
    }
    fs.mkdirSync(path.dirname(real(vp)), { recursive: true });
    fs.writeFileSync(real(vp) + '.jvtmp', lines.join('\n')); fs.renameSync(real(vp) + '.jvtmp', real(vp));
    written = { path: vp, upTo: list[list.length - 1].seq, count: list.length, at: t };
    log('queue.written', { path: vp, count: list.length });
    return { count: list.length, path: vp };
  }
  function clear({ confirm } = {}) {
    if (confirm !== true) return { cleared: 0, error: 'Clearing needs the person to confirm it.' };
    const list = queue.list();
    if (!written || list.some((m) => m.seq > written.upTo)) return { cleared: 0, error: 'Write them to a file first: clearing only removes messages a written file already holds.' };
    for (const m of list) queue.done(m.seq);
    log('queue.cleared', { count: list.length, file: written.path });
    return { cleared: list.length, file: written.path };
  }

  return {
    brain,
    turn: serial((a) => turn(a)),
    /** One of her timed things (her own schedules, run on the host): through the loop's and its own switch. */
    ask: serial((prompt, kind = 'schedules', id = '') => callModel([{ role: 'user', content: String(prompt) }], `${kind}:${id}`, kind)),
    pollOnce: serial(pollOnce), tickOnce: serial(tickOnce), probeOnce: serial(probeOnce),
    clientCall, herTool, notice, checkNotice,
    checkModel: serial((by) => checkModel(by)),
    /** Her notices (her tool and the person's page): see them, or change one. Plain words only, checked. */
    notices(args = {}, by = 'someone') {
      if (!args.action || args.action === 'get') return { notices: settings.get().notices };
      if (args.action === 'set' || args.action === 'remove') return settings.setNotice({ ...args, remove: args.action === 'remove' }, by, checkNotice);
      return { error: 'action is get, set or remove' };
    },
    /** The bridge's own tool list, for the Atelier (the host adds nothing and hides nothing). */
    async bridgeTools(name) { const b = byName.get(name); if (!b) throw Object.assign(new Error(`No bridge called ${name} on this host.`), { code: 'NONE' }); return b.listTools ? b.listTools() : { tools: [] }; },
    deliver: serial(deliver), later, writeFile: serial(writeFile), clear: serial(clear),
    idle: () => busy,
    waiting: () => ({ count: queue.size(), large: queue.large(), warnAt: queue.warnAt, messages: queue.list(), written }),
    start() { timers = [setInterval(serial(pollOnce), pollMs), setInterval(serial(tickOnce), tickMs), setInterval(serial(probeOnce), probeMs)]; return this; },
    stop() { for (const t of timers) clearInterval(t); timers = []; },
  };
}

module.exports = { createRuntime, Off };
