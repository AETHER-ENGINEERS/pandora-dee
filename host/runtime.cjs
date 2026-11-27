// The host's runtime: the one place its turns, schedules and bridge traffic pass through, so the nap rule
// (host/nap.cjs), the queue (host/queue.cjs) and the outbound check (host/redact.cjs) can't be stepped around.
//
// Today the model and the bridges are given to it (tests give stand-ins); the Atelier's own agent loop moves in behind
// `model` in the next step. What it guarantees already:
//   - while napping: no model call of any kind (a turn is refused, a due schedule is skipped and logged), and nothing is
//     sent through a bridge (a send is refused, even one already on its way when the host fell asleep);
//   - every message that arrives on a bridge is written to the queue on disk first, in arrival order. While she's
//     awake it's answered straight away, as a live conversation. While she naps it waits, and it keeps waiting after
//     she wakes: nothing in the queue expires, is trimmed or is handed to a model on its own. The person (or she)
//     chooses: deliver them now (all, or the next few, oldest first), later (they stay), or write them to a Markdown
//     file in her home to read at her own pace (they stay queued until the person clears them);
//   - every message for a bridge passes the redactor first, and the log notes what was hidden (never the values).

'use strict';
const fs = require('node:fs');
const path = require('node:path');

class Napping extends Error {
  constructor(what) { super(`The host is napping (no client is connected), so it won't ${what}.`); this.code = 'NAPPING'; }
}

const pad = (n) => String(n).padStart(2, '0');
const stamp = (t) => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}.${pad(d.getMinutes())}`; };
const when = (t) => (t == null ? 'unknown' : new Date(t).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }));

/**
 * opts:
 *   nap        from createNap()
 *   queue      from createQueue()
 *   model      async ({ messages, why }) → reply text: the only way the runtime reaches a model
 *   bridges    [{ name, poll: async () → [{ id, chat, from, text, at }], send: async ({ chat, text, replyTo }) }]
 *   schedules  [{ id, everyMs, prompt }]   (heartbeats included)
 *   redact     from createRedactor()
 *   home       her home folder (where "write them to a file" writes), and writeDir, the vault folder inside it
 *   log        (kind, fields)
 *   pollMs, tickMs
 */
function createRuntime(opts) {
  const { nap, model, redact, queue } = opts;
  const bridges = opts.bridges || [];
  const byName = new Map(bridges.map((b) => [b.name, b]));
  const schedules = (opts.schedules || []).map((s) => ({ ...s, next: Date.now() + s.everyMs }));
  const log = opts.log || (() => {});
  const pollMs = opts.pollMs ?? 2000, tickMs = opts.tickMs ?? 1000;
  const writeDir = opts.writeDir || '/Pandora/Waiting Messages';
  let written = null; // { path, upTo (seq), count, at }: the last file written, so clearing never loses anything
  let timers = [];
  let busy = Promise.resolve();
  const serial = (f) => (...a) => { const run = busy.then(() => f(...a), () => f(...a)); busy = run.catch(() => {}); return run; };

  async function callModel(messages, why) {
    if (!nap.awake()) { log('model.refused', { why }); throw new Napping('call a model'); }
    log('model.call', { why });
    return String(await model({ messages, why }));
  }
  async function send(bridge, { chat, text, replyTo }) {
    if (!nap.awake()) { log('bridge.send.refused', { bridge: bridge.name, chat }); throw new Napping('send a message'); }
    const r = redact(text);
    if (Object.keys(r.hits).length) log('redacted', { bridge: bridge.name, chat, hits: r.hits });
    await bridge.send({ chat, text: r.text, replyTo });
    log('bridge.sent', { bridge: bridge.name, chat });
  }

  /** A turn: one conversation's next answer. (The Atelier's loop, with tools, replaces the single call here.) */
  async function turn({ text, from = 'client', history = [] }) {
    return callModel([...history, { role: 'user', content: String(text) }], `turn:${from}`);
  }

  /** Her turn for one queued message, and its reply. → true once it's handled (and has left the queue). */
  async function handle(m) {
    const bridge = byName.get(m.bridge);
    if (!bridge) { log('queue.no-bridge', { seq: m.seq, bridge: m.bridge }); return false; }
    queue.trying(m.seq);
    let reply;
    try {
      const note = m.tries > 1 ? ' (handed to her again: the host stopped during her last turn for it)' : '';
      reply = await turn({ text: m.text, from: `${m.bridge}:${m.chat}${note}` });
    } catch (e) {
      // the error itself never goes to the bridge: it's where provider addresses turn up
      log(e.code === 'NAPPING' ? 'queue.kept' : 'turn.failed', { seq: m.seq, bridge: m.bridge, chat: m.chat });
      return false;
    }
    try { await send(bridge, { chat: m.chat, text: reply, replyTo: m.id }); }
    catch (e) {
      // fell asleep while the answer was being made: it isn't sent, and the message stays in the queue
      log(e.code === 'NAPPING' ? 'queue.kept' : 'bridge.send.failed', { seq: m.seq, bridge: m.bridge, chat: m.chat });
      return false;
    }
    queue.done(m.seq);
    return true;
  }

  async function pollOnce() {
    for (const b of bridges) {
      let got = [];
      try { got = (await b.poll()) || []; } catch { log('bridge.poll.failed', { bridge: b.name }); continue; }
      for (const m of got) {
        const awake = nap.awake();
        const rec = queue.add(b.name, { ...m, live: awake });
        if (!rec) continue;
        // awake: a live conversation, answered now. Napping: it waits in the queue for a choice.
        if (awake) await handle(rec);
        else log('bridge.kept', { bridge: b.name, chat: m.chat ?? null });
      }
    }
  }
  async function tickOnce() {
    const t = Date.now();
    for (const s of schedules) {
      if (t < s.next) continue;
      s.next = t + s.everyMs;
      if (!nap.awake()) { log('schedule.skipped', { id: s.id }); continue; }
      try { await callModel([{ role: 'user', content: s.prompt }], `schedule:${s.id}`); log('schedule.ran', { id: s.id }); }
      catch (e) { if (e.code !== 'NAPPING') log('schedule.failed', { id: s.id }); }
    }
  }

  // ---------- the three choices for what waited ----------
  /** 1. Send queued messages now: hand them to her, oldest first, all or the next `count`. Stops at the first that
   *  can't be handled (so the order holds), leaving it and the rest queued. */
  async function deliver({ count } = {}) {
    if (!nap.awake()) throw new Napping('hand her the waiting messages');
    const n = Number(count) > 0 ? Number(count) : Infinity;
    let done = 0;
    log('queue.deliver', { asked: Number.isFinite(n) ? n : 'all', pending: queue.size() });
    while (done < n) {
      const m = queue.first();
      if (!m) break;
      if (!(await handle(m))) break;
      done++;
    }
    return { delivered: done, left: queue.size() };
  }
  /** 2. Later: nothing moves; they stay queued, without expiring. */
  function later() { log('queue.later', { pending: queue.size() }); return { left: queue.size() }; }
  /** 3. Write them to a Markdown file in her home. The queue is left as it is until the person clears it. */
  function writeFile() {
    const list = queue.list();
    if (!list.length) return { count: 0, path: null };
    const t = Date.now();
    let vp = `${writeDir}/${stamp(t)}.md`;
    const real = (p) => path.join(opts.home, ...p.split('/').filter(Boolean));
    for (let i = 2; fs.existsSync(real(vp)); i++) vp = `${writeDir}/${stamp(t)} (${i}).md`; // never over an earlier one
    const lines = [
      `# Messages that waited while she napped`,
      '',
      `${list.length} message${list.length === 1 ? '' : 's'}, oldest first, written ${when(t)}. They're still in the host's queue too, until the person clears it.`,
      '',
    ];
    for (const m of list) {
      lines.push(`## ${when(m.receivedAt)} · ${m.bridge} · ${m.from || 'someone'}`, '');
      lines.push(`- Where: ${m.chat || 'unknown'}${m.id != null ? ` · message ${m.id}` : ''}`);
      if (m.at != null && Math.abs(m.at - m.receivedAt) > 60_000) lines.push(`- Sent: ${when(m.at)}`);
      if (m.tries) lines.push(`- Handed to her ${m.tries} time${m.tries === 1 ? '' : 's'} before without finishing`);
      lines.push('', String(m.text).split('\n').map((l) => '> ' + l).join('\n'), '');
    }
    fs.mkdirSync(path.dirname(real(vp)), { recursive: true });
    const tmp = real(vp) + '.jvtmp';
    fs.writeFileSync(tmp, lines.join('\n'));
    fs.renameSync(tmp, real(vp));
    written = { path: vp, upTo: list[list.length - 1].seq, count: list.length, at: t };
    log('queue.written', { path: vp, count: list.length });
    return { count: list.length, path: vp };
  }
  /** Clearing, only on the person's word, and only what a written file already holds. */
  function clear({ confirm } = {}) {
    if (confirm !== true) return { cleared: 0, error: 'Clearing needs the person to confirm it.' };
    const list = queue.list();
    if (!written || list.some((m) => m.seq > written.upTo)) return { cleared: 0, error: 'Write them to a file first: clearing only removes messages a written file already holds.' };
    for (const m of list) queue.done(m.seq);
    log('queue.cleared', { count: list.length, file: written.path });
    return { cleared: list.length, file: written.path };
  }

  return {
    turn: serial((a) => turn(a)),
    pollOnce: serial(pollOnce),
    tickOnce: serial(tickOnce),
    deliver: serial(deliver),
    later,
    writeFile: serial(writeFile),
    clear: serial(clear),
    idle: () => busy,
    waiting: () => ({ count: queue.size(), large: queue.large(), warnAt: queue.warnAt, messages: queue.list(), written }),
    start() { timers = [setInterval(serial(pollOnce), pollMs), setInterval(serial(tickOnce), tickMs)]; return this; },
    stop() { for (const t of timers) clearInterval(t); timers = []; },
  };
}

module.exports = { createRuntime, Napping };
