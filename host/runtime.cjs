// The host's runtime: the one place its turns, schedules and bridge traffic pass through, so the nap rule
// (host/nap.cjs) and the outbound check (host/redact.cjs) can't be stepped around.
//
// Today the model and the bridges are given to it (tests give stand-ins); the Atelier's own agent loop moves in behind
// `model` in the next step. What it guarantees already:
//   - while napping: no model call of any kind (a turn is refused, a due schedule is skipped and logged), and nothing is
//     sent through a bridge (a send is refused, even one already on its way when the host fell asleep);
//   - messages arriving on a bridge while napping are kept, not answered: the host still collects them (collecting
//     sends nothing), and on waking it answers the ones that are still fresh and holds the older ones for her and the
//     person to see (GET /host/waiting), instead of answering a conversation that has moved on;
//   - every message for a bridge passes the redactor first, and the log notes what was hidden (never the values).

'use strict';

class Napping extends Error {
  constructor(what) { super(`The host is napping (no client is connected), so it won't ${what}.`); this.code = 'NAPPING'; }
}

/**
 * opts:
 *   nap        from createNap()
 *   model      async ({ messages, why }) → reply text: the only way the runtime reaches a model
 *   bridges    [{ name, poll: async () → [{ id, chat, from, text, at }], send: async ({ chat, text, replyTo }) }]
 *   schedules  [{ id, everyMs, prompt }]   (heartbeats included)
 *   redact     from createRedactor()
 *   log        (kind, fields)
 *   freshMs    how old a waiting message may be and still be answered on waking (default 10 minutes, the same as the
 *              Discord bridge's own limit)
 *   pollMs, tickMs
 */
function createRuntime(opts) {
  const { nap, model, redact } = opts;
  const bridges = opts.bridges || [];
  const schedules = (opts.schedules || []).map((s) => ({ ...s, next: Date.now() + s.everyMs }));
  const log = opts.log || (() => {});
  const freshMs = opts.freshMs ?? 10 * 60 * 1000;
  const pollMs = opts.pollMs ?? 2000, tickMs = opts.tickMs ?? 1000;
  const waiting = []; // { bridge, msg, keptAt }
  const held = [];    // waited too long: for her and the person, not answered automatically
  let timers = [];
  let busy = Promise.resolve();

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

  async function answer(bridge, msg) {
    let reply;
    try { reply = await turn({ text: msg.text, from: `${bridge.name}:${msg.chat}` }); }
    catch (e) {
      // the error itself never goes to the bridge: it's where provider addresses turn up
      if (e.code === 'NAPPING') return keep(bridge, msg);
      log('turn.failed', { bridge: bridge.name, chat: msg.chat });
      return;
    }
    try { await send(bridge, { chat: msg.chat, text: reply, replyTo: msg.id }); }
    catch (e) {
      // fell asleep while the answer was being made: it isn't sent; the message waits to be answered on waking
      if (e.code === 'NAPPING') return keep(bridge, msg);
      log('bridge.send.failed', { bridge: bridge.name, chat: msg.chat });
    }
  }
  function keep(bridge, msg) {
    waiting.push({ bridge, msg, keptAt: Date.now() });
    log('bridge.kept', { bridge: bridge.name, chat: msg.chat, id: msg.id });
  }

  async function pollOnce() {
    for (const b of bridges) {
      let got = [];
      try { got = (await b.poll()) || []; } catch { log('bridge.poll.failed', { bridge: b.name }); continue; }
      for (const m of got) {
        if (!nap.awake()) keep(b, m);
        else await answer(b, m);
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
  async function wakeUp() {
    const now = Date.now();
    const list = waiting.splice(0);
    for (const w of list) {
      const age = now - (Number(w.msg.at) || w.keptAt);
      if (age <= freshMs) await answer(w.bridge, w.msg);
      else { held.push({ bridge: w.bridge.name, ...w.msg }); log('bridge.held', { bridge: w.bridge.name, chat: w.msg.chat, id: w.msg.id }); }
    }
  }
  // one thing at a time: polls, ticks and the waking catch-up never overlap
  const serial = (f) => () => (busy = busy.then(f, f).catch(() => {}));
  const offWake = nap.onWake(serial(wakeUp));

  return {
    turn: (a) => (busy = busy.then(() => turn(a), () => turn(a))),
    pollOnce: serial(pollOnce),
    tickOnce: serial(tickOnce),
    idle: () => busy,
    waiting: () => waiting.map((w) => ({ bridge: w.bridge.name, ...w.msg })),
    held: () => held.slice(),
    start() { timers = [setInterval(serial(pollOnce), pollMs), setInterval(serial(tickOnce), tickMs)]; return this; },
    stop() { for (const t of timers) clearInterval(t); timers = []; offWake(); },
  };
}

module.exports = { createRuntime, Napping };
