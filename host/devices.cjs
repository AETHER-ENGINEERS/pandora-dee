// Her device tools, through the devices that visit (parity step 4). A phone or a computer has things the host doesn't:
// the phone's own apps, calls and texts (phone), its screen (screen), its sensors, camera and microphone (senses), its
// event watcher (sentry), USB, the Android app's own browser and SSH client, and models run on its own chip (litert,
// onnx). While her loop runs on the host, each paired device served by the host says which of these it has; her loop
// offers them, and each call goes to a device that has it (the one she names, or the one seen last), which runs it
// there, with its own checks and the person's own yes where her Atelier asks for one, and sends back what happened.
// Nothing is lost when she moves: the tools are the device's, and they go where the device goes. The host itself can
// hold one too (her own browser on the host, host/browser.cjs): it is listed like a device, as "this host".
//
// The way between them is plain HTTP, so old devices can take part: a device offers its tools, then asks for its next
// call (a long poll), and posts the answer. A device is here while it is asking (it always is, but for a moment between
// asks); one that stops asking is gone from her list a few seconds later.
'use strict';
const crypto = require('node:crypto');

// the device tools her Atelier has (app/modules: phone_tool, screen_tool, world (senses, litert, onnx), sentry_tool, usb,
// browser_tool, ssh_tool); only these travel this way
const DEVICE_TOOLS = ['phone', 'screen', 'senses', 'sentry', 'usb', 'browser', 'ssh', 'litert', 'onnx'];
const GONE_MS = 8000; // between one ask's end and the next
const CALL_MS = { browser: 300000, ssh: 300000, litert: 300000, onnx: 300000 };
const OUT_MAX = 200 * 1024;
const RECENT = 30;

/** opts: { log(kind, fields), trace(kind, fields), now? } */
function createDevices(opts = {}) {
  const log = opts.log || (() => {}), trace = opts.trace || (() => {});
  const now = opts.now || Date.now;
  const pages = new Map(); // page id → { page, device, name, tools: [def], seen, queue: [call], waiter }
  const waiting = new Map(); // call id → { resolve, timer, page, tool, at }
  const recent = []; // her latest calls, as facts: { tool, device, at, ok, ms }

  const clean = (d) => {
    const f = d && d.type === 'function' ? d.function : d;
    if (!f || !DEVICE_TOOLS.includes(f.name)) return null;
    const params = f.parameters && typeof f.parameters === 'object' ? f.parameters : { type: 'object', properties: {} };
    const s = JSON.stringify(params); if (s.length > 32768) return null;
    return { name: f.name, description: String(f.description || '').slice(0, 4000), parameters: JSON.parse(s) };
  };
  const locals = []; // the host's own: { name, tools() → [def], run(tool, args) → text }
  const localPages = () => locals.map((l) => ({ page: 'local:' + l.name, device: 'host', name: l.name, tools: (l.tools() || []).map(clean).filter(Boolean), seen: now(), local: l })).filter((x) => x.tools.length);
  const live = () => [...[...pages.values()].filter((p) => p.waiter || now() - p.seen < GONE_MS), ...localPages()];

  /** A device's page says what it has. → { tools: [names] } */
  function offer({ page, device, name, tools }) {
    if (!page || typeof page !== 'string' || page.length > 80) throw Object.assign(new Error('Which page?'), { status: 400 });
    const list = (Array.isArray(tools) ? tools : []).map(clean).filter(Boolean);
    const had = pages.get(page);
    const p = had || { page, queue: [], waiter: null };
    Object.assign(p, { device: String(device || ''), name: String(name || 'a device').slice(0, 60), tools: list, seen: now() });
    pages.set(page, p);
    if (!had || JSON.stringify((had.toolsWas || [])) !== JSON.stringify(list.map((t) => t.name))) log('devices.offer', { device: p.device, tools: list.map((t) => t.name) });
    p.toolsWas = list.map((t) => t.name);
    return { tools: p.toolsWas };
  }
  /** A device's page asks for its next call, waiting up to waitMs for one. → a call, or null */
  function next(page, waitMs = 25000) {
    const p = pages.get(page); if (!p) return Promise.resolve({ offer: true }); // it must say what it has first
    p.seen = now();
    if (p.queue.length) return Promise.resolve(p.queue.shift());
    if (p.waiter) { p.waiter.resolve(null); p.waiter = null; } // a newer ask from the same page takes over
    return new Promise((resolve) => {
      const timer = setTimeout(() => done(null), Math.max(1000, Math.min(30000, waitMs)));
      const done = (v) => { clearTimeout(timer); if (p.waiter && p.waiter.resolve === done) p.waiter = null; p.seen = now(); resolve(v); };
      p.waiter = { resolve: done };
    });
  }
  /** A device's ask was cut off (the page closed, the network went): gone in a few seconds unless it asks again; a
   *  call that was on its way goes back in line for it. */
  function dropped(page, c) {
    const p = pages.get(page); if (!p) return;
    if (c && c.id && waiting.has(c.id)) p.queue.unshift(c);
    if (p.waiter) { const w = p.waiter; p.waiter = null; w.resolve(null); }
    p.seen = Math.min(p.seen, now() - GONE_MS + 3000);
  }
  /** A device's page answers a call. */
  function result(page, id, { ok, out }) {
    const w = waiting.get(id);
    if (!w || w.page !== page) return { ok: false };
    waiting.delete(id); clearTimeout(w.timer);
    const p = pages.get(page); if (p) p.seen = now();
    let text = typeof out === 'string' ? out : JSON.stringify(out ?? '');
    if (text.length > OUT_MAX) text = text.slice(0, OUT_MAX) + '\n…(cut: the device sent more)';
    w.resolve({ ok: !!ok, out: text });
    return { ok: true };
  }
  /** The devices that have a tool, the one seen last first. */
  const holders = (tool) => live().filter((p) => p.tools.some((t) => t.name === tool)).sort((a, b) => b.seen - a.seen);
  /** Her loop calls a device tool. → text (what the device said, or why it couldn't) */
  async function call(tool, args = {}) {
    const a = { ...(args || {}) }; const named = String(a.device || '').trim(), want = named.toLowerCase(); delete a.device;
    const all = holders(tool);
    if (!all.length) return `None of your devices that can do ${tool} is here right now: it comes back when one that has it is open.`;
    const p = want ? all.find((x) => x.name.toLowerCase() === want) || all.find((x) => x.name.toLowerCase().includes(want)) : all[0];
    if (!p) return `None of your devices called "${named}" has ${tool} right now. These have it: ${all.map((x) => x.name).join(', ')}.`;
    const id = crypto.randomBytes(8).toString('hex'); const at = now();
    trace('her.device.call', { tool, device: p.device, name: p.name, args: a });
    const r = p.local ? await p.local.run(tool, a).then((out) => ({ ok: true, out: String(out) }), (e) => ({ ok: false, out: String((e && e.message) || e) })) : await new Promise((resolve) => {
      const ms = CALL_MS[tool] || 120000;
      const timer = setTimeout(() => { waiting.delete(id); p.queue = p.queue.filter((c) => c.id !== id); resolve({ ok: false, out: `${p.name} didn't answer within ${Math.round(ms / 1000)} seconds.`, late: true }); }, ms);
      waiting.set(id, { resolve, timer, page: p.page, tool, at });
      const c = { id, tool, args: a };
      if (p.waiter) { const w = p.waiter; p.waiter = null; w.resolve(c); } else p.queue.push(c);
    });
    recent.unshift({ tool, device: p.name, at, ok: r.ok, ms: now() - at }); recent.length = Math.min(recent.length, RECENT);
    log('devices.call', { tool, device: p.device, ok: r.ok });
    trace('her.device.result', { tool, device: p.device, ok: r.ok, out: String(r.out).slice(0, 4000) });
    return r.ok ? `(${tool}, on ${p.name})\n${r.out}` : `Not done on ${p.name}: ${r.out}`;
  }
  /** Her loop's view: one tool per kind, from the device seen last, with which devices have it. */
  function defs() {
    const out = [];
    for (const name of DEVICE_TOOLS) {
      const all = holders(name); if (!all.length) continue;
      const d = all[0].tools.find((t) => t.name === name);
      const params = JSON.parse(JSON.stringify(d.parameters));
      params.type = 'object'; params.properties = { ...(params.properties || {}), device: { type: 'string', description: `Which of your devices does it (${all.map((x) => x.name).join(', ')}); the one seen last when not said.` } };
      out.push({ type: 'function', function: { name, description: `${d.description} (On your devices: ${all.map((x) => x.name).join(', ')}.)`, parameters: params } });
    }
    return out;
  }
  /** Facts for the keeper: which devices visit, what each has, and her latest calls (never what was asked or said). */
  function facts() {
    return {
      devices: live().sort((a, b) => b.seen - a.seen).map((p) => ({ name: p.name, tools: p.tools.map((t) => t.name), seen: p.seen })),
      recent: recent.slice(0, 12).map((r) => ({ ...r })),
    };
  }
  /** A page closes, or the device is released. */
  function forget(match) {
    for (const [k, p] of pages) if (k === match || p.device === match) { if (p.waiter) p.waiter.resolve(null); pages.delete(k); for (const [id, w] of waiting) if (w.page === k) { clearTimeout(w.timer); waiting.delete(id); w.resolve({ ok: false, out: 'the device went away before it answered' }); } }
  }
  function close() { for (const k of [...pages.keys()]) forget(k); }
  /** The host's own device tool (her browser on the host): always here while it has the tool to offer. */
  function local(l) { locals.push(l); return () => { const i = locals.indexOf(l); if (i >= 0) locals.splice(i, 1); }; }
  return { offer, next, result, dropped, call, defs, facts, forget, close, local, has: (tool) => holders(tool).length > 0 };
}

module.exports = { createDevices, DEVICE_TOOLS };
