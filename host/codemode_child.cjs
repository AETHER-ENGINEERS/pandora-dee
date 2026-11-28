// Her codemode sandbox, on the host: one script, in a Node process of its own that the host starts with the permission
// system on (no files, no child processes, no workers, no addons) and no string-to-code in its own realm. The script
// itself runs in a fresh vm context that holds nothing of Node's: no require, no process, no fetch, no timers. It
// reaches the world only through `tools`, which asks the host (host/codemode.cjs) over this process's IPC channel,
// and the host decides. Everything that crosses into the script crosses as JSON text, parsed inside the script's own
// realm, so no object of the host's is ever in its hands. As her Atelier's codemode (app/modules/mcp.js, a Web
// Worker with no network): the same helpers, the same answers.
'use strict';
const vm = require('node:vm');

const PRELUDE = `(function (__h, __initJson) {
  const __init = JSON.parse(__initJson);
  const __out = []; const __images = [];
  const __catalog = __init.catalog || []; const __ns = __init.ns || {}; const __store = __init.store || {};
  const __fmt = a => a.map(x => typeof x === 'string' ? x : (() => { try { return JSON.stringify(x, null, 1); } catch { return String(x); } })()).join(' ');
  const console = { log: (...a) => { __out.push(__fmt(a)); }, info: (...a) => { __out.push(__fmt(a)); }, warn: (...a) => { __out.push('[warn] ' + __fmt(a)); }, error: (...a) => { __out.push('[error] ' + __fmt(a)); }, table: x => { __out.push(__fmt([x])); } };
  const text = (...a) => { __out.push(__fmt(a)); };
  const __call = (name, args) => new Promise((res, rej) => __h('call', JSON.stringify({ name: String(name), args: args ?? {} }), v => res(JSON.parse(v)), e => rej(new Error(e))));
  const tools = new Proxy({}, { get: (_, name) => typeof name === 'string' && name !== 'then' ? (args) => __call(name, args) : undefined, has: (_, n) => __catalog.some(t => t.name === n) });
  const ALL_TOOLS = __catalog.map(t => t.name);
  const __tok = s => String(s).replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 1);
  function searchTools(query, limit = 10) { const q = __tok(query); return __catalog.map(t => { const d = __tok(t.name + ' ' + t.description); let s = 0; for (const w of q) s += d.filter(x => x === w || x.startsWith(w)).length; return { t, s }; }).filter(x => x.s > 0).sort((a, b) => b.s - a.s).slice(0, limit).map(x => ({ name: x.t.name, description: x.t.description })); }
  function describeTool(name) { const t = __catalog.find(x => x.name === name); if (!t) throw new Error('no tool ' + name + '. Try searchTools().'); return { name: t.name, description: t.description, inputSchema: t.inputSchema }; }
  function describeNamespace(ns) { const k = String(ns).replace(/__$/, ''); const n = __ns[k]; if (!n) throw new Error('no namespace ' + ns + '. Known: ' + Object.keys(__ns).join(', ')); return n; }
  function image(block) { if (!block || !block.data) throw new Error('image() needs an image content block {type:"image", data, mimeType}'); __images.push({ data: String(block.data), mimeType: block.mimeType || 'image/png' }); return '[image attached]'; }
  function store(key, value) { __store[key] = JSON.parse(JSON.stringify(value)); __h('store', JSON.stringify({ key: String(key), value: __store[key] })); return value; }
  function load(key) { return __store[key]; }
  const env = [console, text, tools, ALL_TOOLS, searchTools, describeTool, describeNamespace, image, store, load];
  return (fn) => { (async () => {
    let ret, err = null;
    try { ret = await fn(...env); } catch (e) { err = (e && e.stack) || String(e); }
    let r; try { r = ret === undefined ? undefined : JSON.parse(JSON.stringify(ret)); } catch { r = String(ret); }
    __h('done', JSON.stringify({ out: __out, images: __images, ret: r, err }));
  })(); };
})`;
const PARAMS = 'console, text, tools, ALL_TOOLS, searchTools, describeTool, describeNamespace, image, store, load';

let seq = 0; const pending = new Map();
const send = (m, then) => { try { process.send(m, then); } catch { process.exit(1); } };

function start(m) {
  const ctx = vm.createContext({}, { codeGeneration: { strings: true, wasm: false } });
  // the one way out of the script: kind + JSON text in; JSON text back through the script's own callbacks
  const host = (kind, payload, res, rej) => {
    try {
      const p = JSON.parse(String(payload));
      if (kind === 'call') { const id = ++seq; pending.set(id, { res, rej }); send({ t: 'call', id, name: p.name, args: p.args }); }
      else if (kind === 'store') send({ t: 'store', key: p.key, value: p.value });
      else if (kind === 'done') send({ t: 'done', ...p }, () => process.exit(0));
    } catch (e) { try { if (rej) rej('could not pass that on: ' + String((e && e.message) || e)); } catch { /* nothing */ } }
  };
  let runner, fn;
  try {
    runner = new vm.Script(PRELUDE, { filename: 'prelude' }).runInContext(ctx)(host, JSON.stringify({ catalog: m.catalog, ns: m.ns, store: m.store }));
  } catch (e) { return send({ t: 'done', out: [], images: [], err: 'could not start the sandbox' }, () => process.exit(0)); }
  try {
    fn = new vm.Script(`(async function (${PARAMS}) {\n${m.code}\n})`, { filename: 'script', lineOffset: -1 }).runInContext(ctx);
  } catch (e) {
    const line = /script:(\d+)/.exec(String(e && e.stack)); // a syntax error: its message, and the line in her script
    return send({ t: 'done', out: [], images: [], err: `${(e && e.name) || 'SyntaxError'}: ${(e && e.message) || e}${line ? ` (line ${Math.max(1, +line[1])})` : ''}` }, () => process.exit(0));
  }
  runner(fn);
}

process.on('message', (m) => {
  if (!m || typeof m !== 'object') return;
  if (m.t === 'ret') {
    const p = pending.get(m.id); if (!p) return; pending.delete(m.id);
    try { if (m.ok) p.res(JSON.stringify(m.value === undefined ? null : m.value)); else p.rej(String(m.error || 'failed')); } catch { /* the script's own */ }
    return;
  }
  if (m.t === 'init') start(m);
});
process.on('disconnect', () => process.exit(0));
