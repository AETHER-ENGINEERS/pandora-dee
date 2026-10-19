/* =====================================================================
   SCRIPT BRIDGE — JavaScript (the shell's node, flow steps, note scripts) can call Jade:
   jade.tool(), jade.decide(), jade.ask(), jade.agent(), jade.flow(), jade.shell(), jade.notify(), jade.kv.
   The script runs in a Web Worker (node_prelude.js); each call is a postMessage round trip answered here.
   Files the script wrote are applied to the vault before a call, and files the call changed are sent
   back, so fs and the tools see the same vault.
   ===================================================================== */
const FLOW_MAX_DEPTH = 5;

// what changed in the vault while a tool ran
function vfsStamp() { const m = new Map(); for (const [p, n] of vfs.nodes) m.set(p, n.dir ? 'd' : n); return m; }
function vfsChangesSince(before) {
  const files = {}, deleted = [], dirs = [], rmdirs = [];
  for (const [p, n] of vfs.nodes) {
    const b = before.get(p);
    if (n.dir) { if (b !== 'd') dirs.push(p); continue; }
    if (b === n) continue;
    if (isSqliteBytes(n.data)) files[p] = n.data; else if (n.data.length < 2e6) files[p] = dec.decode(n.data);
  }
  for (const [p, b] of before) if (!vfs.nodes.has(p)) (b === 'd' ? rmdirs : deleted).push(p);
  return Object.keys(files).length || deleted.length || dirs.length || rmdirs.length ? { files, deleted, dirs, rmdirs } : null;
}
function applyNodeWrites(r, onErr) {
  if (!r) return;
  const W = Object.entries(r.writes || {});
  for (const [p, d] of W) if (d === null && vfs.isFile(p)) vfs.rm(p);
  for (const p of r.rmdirs || []) if (vfs.isDir(p) && p !== '/') vfs.rm(p, true);
  for (const p of r.mkdirs || []) { try { vfs.mkdirp(p); } catch {} }
  for (const [p, d] of W) if (d !== null) { try { vfs.write(p, d, { mkdirs: true }); } catch (e) { onErr?.(`node: could not save ${p}: ${e.message}\n`); } }
}
const cloneSafe = v => { if (v === undefined) return null; try { return JSON.parse(JSON.stringify(v)); } catch { return String(v); } };

/* Run JavaScript in the node sandbox. Used by the shell's `node`, flow JavaScript steps and note scripts.
   globals: names made available to the code ($json, …). readOnly: file writes are not saved.
   bridge: allow jade.* calls; allow: only these jade ops; ui: jade.prompt/suggest may ask the user.
   Returns { out: [[kind, text]], code, ret }. */
async function runNodeScript({ code, argv = ['[eval]'], cwd = '/', globals = null, timeoutMs = 60000, readOnly = false, bridge = true, bridgeWhy = '', allow = null, ui = false, noNet = false, signal = null, depth = 0, via = 'script', lineShift = 0, onErr = null } = {}) {
  code = String(code ?? '').replace(/^#!.*\n/, '');
  if (/^\s*(import|export)\s/m.test(code)) code = code.replace(/^\s*import\s+\*\s+as\s+(\w+)\s+from\s+['"]([^'"]+)['"];?/gm, 'const $1 = require("$2");').replace(/^\s*import\s+(\w+)\s+from\s+['"]([^'"]+)['"];?/gm, 'const $1 = require("$2");').replace(/^\s*import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?/gm, (x, a, b) => 'const {' + a.replace(/\s+as\s+/g, ': ') + '} = require("' + b + '");').replace(/^\s*import\s+['"]([^'"]+)['"];?/gm, 'require("$1");').replace(/^\s*export\s+(default\s+)?/gm, '');
  const useSq = !noNet && (/sqlite/i.test(code) || [...vfs.nodes].some(([p, n]) => !n.dir && /\.[cm]?js$/.test(p) && n.data.length < 2e6 && /sqlite/i.test(dec.decode(n.data))));
  const files = {}, dirs = [], bins = {}; for (const [p, n] of vfs.nodes) { if (n.dir) dirs.push(p); else if (isSqliteBytes(n.data)) { bins[p] = n.data; files[p] = n.data; } else if (n.data.length < 2e6) files[p] = dec.decode(n.data); }
  let sqMod = null; if (useSq) { try { sqMod = await sqliteModule(); } catch (e) { onErr?.(`node: could not load SQLite (${e.message})\n`); } }
  // TensorFlow.js 4.22 (embedded): loaded when the script (or a local .js it may require) uses tf; not in note scripts
  const useTf = !noNet && tfUsed(code, argv[0] && String(argv[0]).startsWith('/') ? vfs.parent(argv[0]) : cwd);
  let tfSrc = ''; if (useTf) { try { tfSrc = await tfjsSource(); } catch (e) { onErr?.(`node: could not load TensorFlow.js (${e.message})\n`); } }
  const names = globals ? Object.keys(globals).filter(k => /^[$A-Za-z_][\w$]*$/.test(k)) : [];
  const head = names.length ? `const { ${names.join(', ')} } = __globals;\n` : '';
  const src = NODE_PRELUDE + `\nasync function __main() {\n${head}${code}\n}\n` + (sqMod ? '\n' + SQLITE_GLUE_SRC + '\n' : '') + (tfSrc ? `\n(function () { var exports, module, define;\n${tfSrc}\n}).call(self);\nself.__tfInit = ${tfInitWorker.toString()};\n` : '');
  const off = NODE_PRELUDE.split('\n').length + 1 + (head ? 1 : 0) + lineShift;
  const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
  const ctx = { depth, via, ui, allow };
  const r = await new Promise(resolve => {
    let w; try { w = new Worker(url); } catch (e) { resolve({ out: [['e', `node: could not start a worker (${e.message})\n`]], writes: {}, code: 1 }); return; }
    let done = false;
    const finish = v => { if (done) return; done = true; clearTimeout(t); clearInterval(ab); w.terminate(); resolve(v); };
    const t = setTimeout(() => finish({ out: [['e', `node: killed after ${timeoutMs / 1000}s timeout\n`]], writes: {}, code: 124 }), timeoutMs);
    const ab = setInterval(() => { if (signal?.aborted) finish({ out: [['e', 'node: stopped\n']], writes: {}, code: 130 }); }, 250);
    w.onmessage = async e => {
      const m = e.data;
      if (m && m.t === 'jade') {
        let reply;
        try {
          if (m.sync && !readOnly) applyNodeWrites(m.sync, onErr);
          const before = vfsStamp();
          const value = await jadeBridge(m.op, m.a || {}, ctx);
          reply = { t: 'jret', id: m.id, ok: true, value: cloneSafe(value), sync: readOnly ? null : vfsChangesSince(before) };
        } catch (err) { reply = { t: 'jret', id: m.id, ok: false, error: String(err?.message || err) }; }
        if (!done) { try { w.postMessage(reply); } catch (err) { w.postMessage({ t: 'jret', id: m.id, ok: false, error: 'could not send the result back: ' + err.message }); } }
        return;
      }
      finish(m);
    };
    w.onerror = e => { e.preventDefault?.(); finish({ out: [['e', `${e.message || 'SyntaxError'}${e.lineno ? ` (line ${Math.max(1, e.lineno - off)})` : ''}\n`]], writes: {}, code: 1 }); };
    if (!bridge) ctx.off = bridgeWhy || 'turned off';
    w.postMessage({ files, dirs, bins, sqliteModule: sqMod, env: noNet ? {} : { ...secretsMap() }, cwd, argv, globals: globals ? cloneSafe(globals) : {}, bridge, bridgeWhy, noNet });
  });
  URL.revokeObjectURL(url);
  if (!readOnly) applyNodeWrites(r, onErr);
  r.out ||= []; return r;
}
const TF_USE = /\btf\s*\.\s*[A-Za-z_$]|@tensorflow\/tfjs/;
// runs in the worker before the script: use the GPU (WebGL) when it really works there, else the CPU backend,
// so a phone or browser without WebGL in workers still computes instead of failing
async function tfInitWorker() {
  const tf = self.tf; if (!tf) return;
  try { tf.env().set('IS_NODE', false); } catch (e) {}   // the sandbox has a `process` object, but this is a browser: no "install tfjs-node" banner
  let gl = false;
  try { if (typeof OffscreenCanvas !== 'undefined') { const c = new OffscreenCanvas(2, 2); gl = !!(c.getContext('webgl2') || c.getContext('webgl')); } } catch (e) { gl = false; }
  const keep = { log: console.log, info: console.info, warn: console.warn, error: console.error }; console.log = console.info = console.warn = console.error = () => {};   // TensorFlow logs its WebGL probing
  try {
    if (gl) { try { gl = await tf.setBackend('webgl'); if (gl) { await tf.ready(); tf.tensor([1]).add(1).dataSync(); } } catch (e) { gl = false; } }
    if (!gl) { try { tf.removeBackend('webgl'); } catch (e) {} await tf.setBackend('cpu'); }
    await tf.ready();
  } finally { Object.assign(console, keep); }
}
// does the script (or a local file it requires, followed a few levels) use tf?
function tfUsed(code, dir, depth = 0, seen = new Set()) {
  if (TF_USE.test(code)) return true;
  if (depth > 4) return false;
  for (const m of String(code).matchAll(/(?:require\(\s*|from\s+|import\s+)['"](\.{0,2}\/[^'"]+)['"]/g)) {
    const base = vfs.norm(m[1], dir); const p = [base, base + '.js', base + '.mjs', base + '.cjs', base + '/index.js'].find(x => vfs.isFile(x));
    if (!p || seen.has(p)) continue; seen.add(p);
    let src = ''; try { src = vfs.read(p); } catch {}
    if (tfUsed(src, vfs.parent(p), depth + 1, seen)) return true;
  }
  return false;
}
let tfjsP = null;
const tfjsSource = () => (tfjsP ||= gunzipB64('tfjs-src').then(b => dec.decode(b)).catch(e => { tfjsP = null; throw e; }));
async function runNode(c) {
  const { f, rest } = opts(c.argv, 'e:p:'); let code, argv;
  if (f.e != null || f.p != null) { code = f.p != null ? `console.log(${f.p})` : f.e; argv = rest; }
  else if (rest.length) { const p = c.P(rest[0]); code = vfs.read(p); argv = [p, ...rest.slice(1)]; }
  else { code = c.stdin; argv = ['[stdin]']; }
  if (!String(code || '').trim()) { c.e('node: no script given. Use node file.js or node -e "code"\n'); return 1; }
  const r = await runNodeScript({ code, argv, cwd: c.sh.cwd, timeoutMs: c.sh.timeoutMs, signal: { get aborted() { return !!c.sh.aborted; } }, onErr: m => c.e(m), via: 'script' });
  for (const [k, v] of r.out) k === 'o' ? c.o(redactSecrets(v)) : c.e(redactSecrets(v));
  return r.code;
}

/* ---------- what jade.* can do ---------- */
function jadeToolList() { return activeTools().map(t => ({ name: t.function.name, description: String(t.function.description || '').slice(0, 240) })); }
async function jadeBridge(op, a, ctx = {}) {
  if (ctx.off) throw new Error(`jade.${op} is not available here (${ctx.off})`);
  if (ctx.allow && !ctx.allow.has(op)) throw new Error(ctx.allowWhy || `jade.${op} is off for note scripts. Turn on "Let note scripts call Jade's tools" in Config → Tools → Note scripts & templates`);
  switch (op) {
    case 'tool': {
      const name = String(a.name || '');
      if (!name) throw new Error('jade.tool needs a tool name');
      if ((name === 'ritual' || name === 'flow') && (ctx.depth || 0) >= FLOW_MAX_DEPTH) throw new Error('rituals call each other too deeply');
      vecGuard(name); if (typeof dcGuard === 'function') dcGuard(name);
      if (!activeTools().some(t => t.function.name === name) && !(name === 'flow' && activeTools().some(t => t.function.name === 'ritual')) && !/^mcp__/.test(name)) throw new Error(`no tool named ${name}. pandora.list() shows them`);
      return await runTool(name, a.args && typeof a.args === 'object' ? a.args : {}, null);
    }
    case 'list': return jadeToolList();
    case 'decide': return await decideData(a);
    case 'ask': return await askOnce(a.prompt, a);
    case 'agent': return await runAgentPrompt(a.message ?? a.prompt, a);
    case 'flow': {
      if ((ctx.depth || 0) >= FLOW_MAX_DEPTH) throw new Error('flows call each other too deeply');
      const run = await flowRunByName(a.name, a.input, { via: ctx.via || 'script', depth: (ctx.depth || 0) + 1 });
      if (run.status !== 'ok') throw new Error(`flow "${run.flow}" ${run.status}: ${run.error || ''}`);
      return run.output;
    }
    case 'flows': return flowList().filter(f => !f._bad).map(f => ({ name: f.name, description: f.description || '', enabled: f.enabled !== false, trigger: flowTriggerText(f) }));
    case 'shell': { const r = await runShellLine(a.command, { timeoutMs: 120000, echo: 'script' }); return { code: r.code, stdout: r.out, stderr: r.err }; }
    case 'notify': { const t = String(a.title || 'Jade'), b = String(a.body || ''); schedNotify(t, b); toast(esc(t) + (b ? ': ' + esc(b.slice(0, 140)) : ''), 'ok'); return true; }
    case 'kv': return await kvOp(a);
    case 'ui.prompt': if (!ctx.ui) throw new Error('jade.prompt / tp.system.prompt only work in a template you insert (nobody is there to answer here)'); return await jvDialog({ title: 'Template', message: a.message, def: a.def });
    case 'ui.suggest': {
      if (!ctx.ui) throw new Error('jade.suggest / tp.system.suggester only work in a template you insert');
      const items = Array.isArray(a.items) ? a.items : []; const texts = items.map(x => typeof x === 'string' ? x : JSON.stringify(x));
      const i = await jvDialog({ title: a.placeholder || 'Choose one', items: texts });
      if (i == null) return null; const vals = Array.isArray(a.values) && a.values.length === items.length ? a.values : items; return vals[i];
    }
    default: throw new Error(`unknown jade call: ${op}`);
  }
}

/* ---------- decisions (Ollaya) as data, not prose ---------- */
async function decideData({ state, question, type = 'choice', options } = {}) {
  if (!S.ollayaOn) throw new Error('Ollaya is turned off (Config → Model → Ollaya decisions).');
  if (!S.ollayaModel) throw new Error('No Ollaya model is selected (Config → Model → Ollaya decisions → Scan).');
  const t = type === 'yesno' ? 'noul' : type;
  const q = { type: t, instructions: String(question || '') };
  const opts = (Array.isArray(options) ? options : typeof options === 'string' ? options.split('\n') : []).map(String).map(x => x.trim()).filter(Boolean);
  if (t === 'choice') { if (opts.length < 2) throw new Error('type "choice" needs at least 2 options'); q.criteria = opts.slice(0, 255); }
  else if (t === 'score') { if (opts.length < 2) throw new Error('type "score" needs 2-10 level descriptions, lowest first'); q.criteria = opts.slice(0, 10); }
  else if (t !== 'noul') throw new Error('type must be choice, score or yesno');
  const body = { model: S.ollayaModel, state: typeof state === 'string' ? state : JSON.stringify(state ?? ''), questions: { q } };
  const r = await ollayaFetch('/v1/systemone', { method: 'POST', body: JSON.stringify(body) });
  if (!r.ok) throw new Error(await ollayaErr(r));
  const j = await r.json(); const ans = j.answers?.q;
  if (!ans) throw new Error('Ollaya returned no answer');
  const probs = Array.isArray(ans.probabilities) ? Object.fromEntries(ans.probabilities.map((v, i) => [String(i), +v])) : Object.fromEntries(Object.entries(ans.probabilities || {}).map(([k, v]) => [k, +v]));
  const out = { type: type === 'yesno' ? 'yesno' : t, confidence: ans.confidence != null ? +ans.confidence : null, probabilities: probs, model: j.model || S.ollayaModel };
  if ('choice' in ans) { out.choice = ans.choice; out.result = ans.choice; }
  if ('score' in ans) { out.score = ans.score; out.result = ans.score; if (ans.legend != null) out.legend = ans.legend; }
  if ('noul' in ans) { out.answer = ans.noul; out.result = ans.noul; }
  return out;
}

/* ---------- one question to the chat model, no tools, no chat ---------- */
async function askOnce(prompt, o = {}) {
  if (!S.model) throw new Error('No model is selected (Config → Model provider).');
  prompt = String(prompt ?? '').trim(); if (!prompt) throw new Error('ask needs a prompt');
  const sys = [String(o.system || '').trim(), o.json ? 'Reply with valid JSON only: no prose, no code fences.' : ''].filter(Boolean).join('\n');
  const messages = []; if (sys) messages.push({ role: 'system', content: sys }); messages.push({ role: 'user', content: prompt });
  let r;
  try { r = await postWith(client, { model: S.model, stream: false, think: false, messages, options: { temperature: o.temperature != null ? +o.temperature : 0.3, num_ctx: +S.numCtx } }, { method: 'POST', headers: { 'Content-Type': 'application/json' } }); }
  catch (e) { throw new Error(`could not reach ${providerName()}`); }
  if (!r.ok) { let m = 'HTTP ' + r.status; try { m = (await r.json()).error || m; } catch {} throw new Error(m); }
  const text = String((await r.json()).message?.content || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  if (!o.json) return text;
  const t = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try { return JSON.parse(t); } catch {}
  const m = /[\[{][\s\S]*[\]}]/.exec(t); if (m) { try { return JSON.parse(m[0]); } catch {} }
  throw new Error('the model did not reply with valid JSON: ' + text.slice(0, 200));
}

/* ---------- a full chat turn (shows up in the chat like a typed message) ---------- */
async function runAgentPrompt(message, o = {}) {
  message = String(message ?? '').trim(); if (!message) throw new Error('the message is empty');
  if (running || (typeof apiBusy !== 'undefined' && apiBusy)) throw new Error('Jade is busy in a chat right now, so an agent step cannot start (it also cannot run from inside her own chat turn)');
  if (!S.model) throw new Error('No model is selected (Config → Model provider).');
  const map = ls.get('agentChats', {}); const key = o.key || '';
  if (o.chat === 'same' && key && map[key] && sessions.some(x => x.id === map[key])) await openSession(map[key]);
  else { newSession(); if (o.title) { cur.title = String(o.title).slice(0, 60); cur._named = true; } if (o.chat === 'same' && key) { map[key] = cur.id; ls.set('agentChats', map); } }
  const sess = cur, n0 = sess.messages.length;
  await send(message);
  const slice = sess.messages.slice(n0);
  const err = slice.find(m => m._error)?._error;
  const asst = slice.filter(m => m.role === 'assistant' && String(m.content || '').trim());
  const fin = [...asst].reverse().find(m => !m.tool_calls?.length) || asst.at(-1);
  const reply = fin ? String(fin.content).replace(/<think>[\s\S]*?<\/think>/g, '').trim() : '';
  if (!reply && err) throw new Error(String(err));
  return { reply, chat: sess.id, title: sess.title };
}

/* ---------- small persistent key/value store for scripts and flows ---------- */
let kvCache = null;
async function kvOp(a) {
  if (!kvCache) kvCache = (await idb.get('jadekv')) || {};
  if (a.op === 'all') return kvCache;
  const k = String(a.k || ''); if (!k) throw new Error('kv needs a key');
  if (a.op === 'get') return kvCache[k] === undefined ? null : kvCache[k];
  if (a.op === 'set') {
    if (a.v === null) delete kvCache[k];
    else { if (JSON.stringify(a.v).length > 200000) throw new Error('kv values are limited to 200 KB'); if (!(k in kvCache) && Object.keys(kvCache).length >= 1000) throw new Error('kv holds at most 1000 keys'); kvCache[k] = a.v; }
    await idb.set('jadekv', kvCache); return true;
  }
  throw new Error('kv: use get, set or all');
}

/* ---------- a small dialog: a text question, or a pick from a list ---------- */
function jvDialog({ title, message = '', def = '', items = null, placeholder = '' }) {
  return new Promise(resolve => {
    const bg = document.createElement('div'); bg.className = 'modal-bg jv-dlg';
    bg.innerHTML = `<div class="frame cut w-full" style="max-width:460px;height:auto"><div class="inner p-4 flex flex-col gap-3">
      <div class="pane-h">${esc(title || 'Jade')}</div>${message ? `<div class="text-sm leading-relaxed">${esc(message)}</div>` : ''}
      ${items ? `<div class="flex flex-col gap-1" style="max-height:55vh;overflow:auto">${items.map((t, i) => `<button type="button" class="btn jv-dlg-item" data-i="${i}">${esc(t)}</button>`).join('') || '<div class="hint">Nothing to choose from.</div>'}</div>` : `<input class="field" autocomplete="off" value="${esc(def)}" placeholder="${esc(placeholder)}">`}
      <div class="flex justify-end gap-2"><button type="button" class="btn" data-x="cancel">Cancel</button>${items ? '' : '<button type="button" class="btn btn-solid cut cut-sm" data-x="ok">OK</button>'}</div></div></div>`;
    const done = v => { bg.remove(); resolve(v); };
    bg.addEventListener('click', e => {
      if (e.target === bg) return done(null);
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.x === 'cancel') done(null); else if (b.dataset.x === 'ok') done(bg.querySelector('input').value); else if (b.dataset.i != null) done(+b.dataset.i);
    });
    bg.querySelector('input')?.addEventListener('keydown', e => { if (e.key === 'Enter') done(e.target.value); if (e.key === 'Escape') done(null); });
    document.body.appendChild(bg); setTimeout(() => (bg.querySelector('input') || bg.querySelector('.jv-dlg-item') || bg.querySelector('button'))?.focus(), 30);
  });
}

/* ---------- run one shell command line (cron, flows, jade.shell) ---------- */
async function runShellLine(cmd, o = {}) {
  cmd = String(cmd ?? '').trim(); if (!cmd) throw new Error('the command is empty');
  const sh = new Shell({ cwd: o.cwd ? vfs.norm(o.cwd) : '/' }); sh.timeoutMs = Math.min(Math.max(1000, o.timeoutMs || 60000), 600000);
  if (o.echo) { try { term.write(`\r\x1b[K\x1b[38;2;31;229;165m▍${o.echo}\x1b[0m $ ${cmd.replace(/\n/g, '\r\n  ')}\r\n`); sh.onOutput = (s, err) => termPrint(s, err); } catch {} }
  const r = await Promise.race([sh.run(cmd), sleep(sh.timeoutMs + 2000).then(() => { sh.aborted = true; return { chunks: [{ s: `timed out after ${sh.timeoutMs / 1000}s\n`, err: true }], code: 124 }; })]);
  if (o.echo) { try { if (!termState.busy) redraw(); } catch {} }
  const strip = s => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
  return { code: r.code, out: strip(r.chunks.filter(c => !c.err).map(c => c.s).join('')), err: strip(r.chunks.filter(c => c.err).map(c => c.s).join('')) };
}

/* ---------- shell commands: jade, flow, crontab ---------- */
// arguments: one JSON object, key=value pairs, or JSON on stdin
function shArgs(list, stdin) {
  const a = list.filter(x => x !== '');
  if (a.length === 1 && /^\s*[\[{]/.test(a[0])) return JSON.parse(a[0]);
  if (!a.length && String(stdin || '').trim()) { const t = stdin.trim(); return /^[\[{]/.test(t) ? JSON.parse(t) : t; }
  const o = {};
  for (const x of a) {
    const m = /^([\w.$-]+)=([\s\S]*)$/.exec(x); if (!m) throw new Error(`expected key=value or one JSON object, got "${x}"`);
    let v = m[2]; try { if (/^(-?\d+(\.\d+)?|true|false|null|\[[\s\S]*\]|\{[\s\S]*\})$/.test(v)) v = JSON.parse(v); } catch {}
    o[m[1]] = v;
  }
  return o;
}
const shShow = v => typeof v === 'string' ? (v.endsWith('\n') ? v : v + '\n') : JSON.stringify(v, null, 2) + '\n';
const JADE_SHELL_HELP = `pandora — call Pandora from the shell (and from node scripts as pandora.*)
  pandora tools                          list her tools
  pandora tool <name> [json | k=v …]     call a tool, e.g. pandora tool notes_search query=inbox
  pandora decide '<json>'                Ollaya: {"state":"…","question":"…","type":"choice","options":["a","b"]}
  pandora ask "<prompt>" [--json] [-s "<system prompt>"]   one answer from the model, no tools
  pandora agent "<message>"              a full chat turn (shows up in the chat)
  pandora notify "<title>" ["<body>"]    phone notification
  pandora kv get <key> | set <key> <json> | list
Arguments can also come as JSON on stdin: echo '{"query":"x"}' | pandora tool notes_search
In node: await pandora.tool('notes_search', {query:'x'}), pandora.tools.read({path:'/Inbox.md'}), pandora.decide({...}),
  pandora.ask('…'), pandora.agent('…'), pandora.ritual('Name', input), pandora.shell('ls'), pandora.notify('t','b'), pandora.kv.get/set.
Jade Vault's names work too: the jade command, jade.* in node, and jade.flow() for pandora.ritual().
`;
async function jadeShell(c) {
  const [sub, ...rest] = c.argv; const cmd = c.name === 'jade' ? 'jade' : 'pandora';
  try {
    if (!sub || sub === 'help' || sub === '-h' || sub === '--help') { c.o(JADE_SHELL_HELP); return 0; }
    if (sub === 'tools') { for (const t of jadeToolList()) c.o(`${t.name.padEnd(18)} ${t.description.split(/(?<=\.)\s/)[0].slice(0, 100)}\n`); return 0; }
    if (sub === 'tool') { const [name, ...a] = rest; if (!name) throw new Error(`usage: ${cmd} tool <name> [json | key=value …]`); const args = shArgs(a, c.stdin); c.o(shShow(await jadeBridge('tool', { name, args: typeof args === 'object' ? args : {} }, { via: 'shell' }))); return 0; }
    if (sub === 'decide') {
      let a = shArgs(rest.length === 1 || !rest.length ? rest : [], c.stdin);
      if (rest.length > 1) { const [state, question, ...options] = rest; a = { state, question, type: options.length ? 'choice' : 'yesno', options }; }
      c.o(shShow(await decideData(a))); return 0;
    }
    if (sub === 'ask') { const { f, rest: r } = opts(rest, 's:'); const prompt = r.join(' ') || c.stdin; c.o(shShow(await askOnce(prompt, { json: !!f.json, system: typeof f.system === 'string' ? f.system : f.s }))); return 0; }
    if (sub === 'agent') { const r = await runAgentPrompt(rest.join(' ') || c.stdin, {}); c.o(shShow(r.reply)); return 0; }
    if (sub === 'notify') { await jadeBridge('notify', { title: rest[0] || 'Pandora', body: rest.slice(1).join(' ') }, {}); return 0; }
    if (sub === 'kv') {
      const [op, k, ...v] = rest;
      if (op === 'list' || op === 'all') { c.o(shShow(await kvOp({ op: 'all' }))); return 0; }
      if (op === 'get') { c.o(shShow(await kvOp({ op: 'get', k }))); return 0; }
      if (op === 'set') { let val = v.join(' '); try { val = JSON.parse(val); } catch {} await kvOp({ op: 'set', k, v: val }); return 0; }
      if (op === 'rm' || op === 'del') { await kvOp({ op: 'set', k, v: null }); return 0; }
      throw new Error(`usage: ${cmd} kv get <key> | set <key> <json> | rm <key> | list`);
    }
    throw new Error(`unknown subcommand "${sub}". Try: ${cmd} help`);
  } catch (e) { c.e(`${cmd}: ${e.message}\n`); return 1; }
}

const FLOW_SHELL_HELP = `ritual — run and manage rituals (the Rituals tab)
  ritual list                           all rituals, their triggers and last runs
  ritual run <name> [json | k=v …]      run one; the input is $input. Also: echo '{"a":1}' | ritual run Name
         -q                             print only the output
  ritual show <name>                    the ritual as JSON
  ritual runs [name]                    recent runs
  ritual enable|disable <name>
  ritual import <file.json>             add or replace a ritual from a JSON file
  ritual export <name> [file.json]      write it to a file (default: print)
Schedule one: crontab add "every day at 9am" ritual run Name   (or give the ritual a schedule trigger)
Jade Vault's flow command works too (flow run Name …).
`;
async function flowShell(c) {
  const [sub, ...rest0] = c.argv; const cmd = c.name === 'flow' ? 'flow' : 'ritual'; const quiet = rest0.includes('-q'); const rest = rest0.filter(x => x !== '-q');
  try {
    if (!sub || sub === 'help' || sub === '-h' || sub === '--help') { c.o(FLOW_SHELL_HELP); return 0; }
    if (sub === 'list' || sub === 'ls') {
      await flowRecordsLoad(); const all = flowList();
      if (!all.length) { c.o('no rituals yet (Rituals tab, or ask Pandora to build one)\n'); return 0; }
      for (const f of all) { const last = FlowRuns.recent.find(r => r.path === f._path); c.o(`${(f.enabled === false ? '○ ' : '● ') + f.name.padEnd(24)} ${(f._bad ? 'INVALID JSON: ' + f._bad : flowTriggerText(f)).padEnd(34)} ${last ? `${last.status} ${relTime(last.started)}` : 'never run'}\n`); }
      return 0;
    }
    const name = rest[0]; const need = () => { const f = flowFind(name); if (!f) throw new Error(name ? `no ritual named "${name}". ${cmd} list shows them` : 'say which ritual'); if (f._bad) throw new Error(`${f._path} is not valid JSON: ${f._bad}`); return f; };
    if (sub === 'run') {
      const f = need(); let input = null; const a = rest.slice(1);
      if (a.length || String(c.stdin || '').trim()) { try { input = shArgs(a, c.stdin); } catch (e) { throw new Error('input: ' + e.message); } }
      const run = await flowRun(f, input, { via: 'shell' });
      if (!quiet) for (const s of run.steps) c.o(`${s.status === 'ok' ? '✓' : s.status === 'skipped' ? '–' : s.status === 'error' ? '✗' : '…'} ${s.name} (${s.type}${s.ms ? ', ' + s.ms + ' ms' : ''}${s.note ? ', ' + s.note : ''})${s.error ? ': ' + s.error : ''}\n`);
      if (run.status !== 'ok') { c.e(`${cmd}: ${run.flow} ${run.status}: ${run.error}\n`); return 1; }
      c.o(shShow(run.output ?? null)); return 0;
    }
    if (sub === 'show' || sub === 'get') { const f = need(); c.o(JSON.stringify(flowClean(f), null, 2) + '\n'); return 0; }
    if (sub === 'runs') {
      await flowRecordsLoad(); const f = name ? need() : null;
      const list = FlowRuns.recent.filter(r => !f || r.path === f._path).slice(0, 20);
      if (!list.length) { c.o('no runs yet\n'); return 0; }
      for (const r of list) c.o(`${new Date(r.started).toLocaleString()}  ${r.flow.padEnd(22)} ${r.status.padEnd(8)} ${((r.ended - r.started) / 1000).toFixed(1)}s  via ${r.via}${r.error ? '  ' + r.error.slice(0, 100) : ''}\n`);
      return 0;
    }
    if (sub === 'enable' || sub === 'disable') { const f = need(); f.enabled = sub === 'enable'; flowSave(f, f._path); c.o(`${f.name}: ${sub}d\n`); return 0; }
    if (sub === 'import') {
      if (!name) throw new Error(`usage: ${cmd} import <file.json>`);
      const f = JSON.parse(vfs.read(c.P(name))); const errs = flowValidate(f); if (errs.length) throw new Error('not a valid ritual:\n  ' + errs.join('\n  '));
      const old = flowFind(f.name); const saved = flowSave(f, old?._path); c.o(`${old ? 'replaced' : 'added'} ${saved.name} (${saved._path})\n`); return 0;
    }
    if (sub === 'export') { const f = need(); const text = JSON.stringify(flowClean(f), null, 2) + '\n'; if (rest[1]) { vfs.write(c.P(rest[1]), text, { mkdirs: true }); c.o(`wrote ${c.P(rest[1])}\n`); } else c.o(text); return 0; }
    throw new Error(`unknown subcommand "${sub}". Try: ${cmd} help`);
  } catch (e) { c.e(`${cmd}: ${e.message}\n`); return 1; }
}
