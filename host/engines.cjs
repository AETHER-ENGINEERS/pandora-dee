// Her playbooks and rituals on the host (parity steps 2 and 3): the very engines her Atelier runs
// (app/modules/playbook.js and app/modules/flows.js), loaded unchanged into a Node sandbox, with the host's own
// versions of what they reach for. So a playbook or a ritual does the same thing wherever it runs.
//
// What the engines reach for, on the host:
//   her tools                  her loop's tools (host/loop.cjs): her vault, memory, history, web, tool servers, …
//   her vault (vfs)            her home's real files (never outside it, never her own key files)
//   her secrets ({{NAME}})     the host's write-only key file (atelier-secrets.json): only what came in through the
//                              import's box; never logged (the engines redact them, as in her Atelier)
//   approvals, run records     her Atelier's own (pbApproved, flowRuns), kept on the host since step 1
//   a shell step, a js step    her shell and real Node on this computer: only when her hands are on it (host_shell)
//   an agent / llm / decide    her loop and her models
//   notify                     her log (the host has no screen of hers to show it on)
//   browser steps              not on the host: they need an open Atelier (the playbook says which step)
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { spawn } = require('node:child_process');

const MODULES = path.join(__dirname, '..', 'app', 'modules');

/**
 * opts: { root, state, loop, chat(role, req), secrets() → object, mayRun() → bool, runShell({ command, cwd, timeoutMs }),
 *         isHers(vp), mayWrite() → reason|null, log, trace, keepChat(title, prompt, reply) }
 */
function createEngines(opts) {
  const root = path.resolve(opts.root);
  const log = opts.log || (() => {}), trace = opts.trace || (() => {});

  // ---- her vault, as the engines see it (the page's vfs calls) ----
  const norm = (p, base = '/') => { const parts = (String(p).startsWith('/') ? '' : base + '/') + String(p); const out = []; for (const s of parts.split('/')) { if (!s || s === '.') continue; if (s === '..') out.pop(); else out.push(s); } return '/' + out.join('/'); };
  const full = (vp) => { const v = norm(vp); if (opts.isHers && opts.isHers(v)) throw new Error('that is one of her own keys: never read or written here'); const f = path.resolve(root, '.' + v); if (f !== root && !f.startsWith(root + path.sep)) throw new Error('that path leaves her vault'); return f; };
  let nodesAt = 0, nodesCache = null;
  const writable = () => { const why = opts.mayWrite && opts.mayWrite(); if (why) throw new Error(why); };
  const vfs = {
    norm, parent: (p) => norm(p).replace(/\/[^/]*$/, '') || '/', base: (p) => norm(p).split('/').pop(),
    isFile: (p) => { try { return fs.statSync(full(p)).isFile(); } catch { return false; } },
    isDir: (p) => { try { return fs.statSync(full(p)).isDirectory(); } catch { return false; } },
    exists: (p) => { try { fs.statSync(full(p)); return true; } catch { return false; } },
    read: (p) => fs.readFileSync(full(p), 'utf8'),
    write: (p, data, o = {}) => { writable(); const f = full(p); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, typeof data === 'string' ? data : Buffer.from(data)); log('her.engine.write', { path: norm(p) }); },
    append: (p, text) => { writable(); const f = full(p); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.appendFileSync(f, String(text)); },
    rm: (p) => { writable(); fs.rmSync(full(p), { recursive: true, force: true }); },
    mkdir: (p) => { writable(); fs.mkdirSync(full(p), { recursive: true }); },
    list: (p) => { try { return fs.readdirSync(full(p)).map((n) => norm(p) + (norm(p) === '/' ? '' : '/') + n); } catch { return []; } },
    *walk(p) { const st = [norm(p)]; while (st.length) { const d = st.pop(); let l = []; try { l = fs.readdirSync(full(d), { withFileTypes: true }); } catch { continue; } for (const e of l) { if (e.name.startsWith('.')) continue; const vp = (d === '/' ? '' : d) + '/' + e.name; yield vp; if (e.isDirectory()) st.push(vp); } } },
    // her whole vault as the engines see it: every path, folder or not, with when it last changed (kept a moment)
    get nodes() {
      if (nodesAt && Date.now() - nodesAt < 1500) return nodesCache;
      const m = new Map([['/', { dir: true, mtime: 0 }]]); let n = 0;
      for (const vp of vfs.walk('/')) { if (++n > 20000) break; if (opts.isHers && opts.isHers(vp)) continue; try { const st = fs.statSync(full(vp)); m.set(vp, { dir: st.isDirectory(), mtime: st.mtimeMs, data: { length: st.size } }); } catch { /* gone */ } }
      nodesAt = Date.now(); nodesCache = m; return m;
    },
    listeners: new Set(),
  };

  // ---- her Atelier's small things (approvals, run records), on the host ----
  const ls = {
    get: (k, d) => { const v = opts.state.lsAll().values[k]; return v === undefined ? d : v; },
    set: (k, v) => { opts.state.lsSet(k, v, 'her engines', 'host'); },
  };
  const idb = {
    get: async (k) => { const g = opts.state.dbGet(k); return g.exists ? g.value : undefined; },
    set: async (k, v) => { opts.state.dbSet(k, v, undefined, 'her engines', 'host'); },
    del: async (k) => { opts.state.dbDel(k, 'host'); },
  };
  const secrets = () => { const a = (opts.secrets && opts.secrets()) || {}; return a.secrets && typeof a.secrets === 'object' ? a.secrets : {}; };

  // ---- her tools, as the engines call them ----
  const toolDefs = () => opts.loop.allToolDefs();
  const runTool = async (name, args) => {
    // what a playbook or ritual hands a tool can carry her secrets ({{NAME}}, filled in): never recorded as they are
    let shown; try { shown = JSON.parse(ctx.redactSecrets(JSON.stringify(args || {}))); } catch { shown = '(hidden)'; }
    trace('her.engine.tool', { name, args: shown });
    if (name === 'playbook') return api.playbookTool(args || {});
    if (name === 'ritual' || name === 'flow') return api.flowTool(args || {});
    return opts.loop.callTool(name, args || {});
  };

  // ---- a shell line, and a js step: real things on this computer, only in her hands ----
  async function runShellLine(command, o = {}) {
    if (!opts.mayRun()) throw new Error('a shell step needs her hands on this computer (host_shell)');
    const r = await opts.runShell({ command: String(command || ''), cwd: o.cwd || '/', timeoutMs: o.timeoutMs });
    return { code: r.code, out: r.stdout || '', err: r.stderr || '' };
  }
  async function runNodeScript({ code, globals, timeoutMs = 60000 }) {
    if (!opts.mayRun()) throw new Error('a JavaScript step needs her hands on this computer (host_shell)');
    const wrapper = `const $ctx = JSON.parse(process.env.PD_FLOW_CTX || '{}'); Object.assign(globalThis, $ctx);
(async () => { const r = await (async () => { ${code}\n })(); if (r !== undefined) process.stdout.write('\\u0000PDRET' + JSON.stringify(r)); })().catch((e) => { process.stderr.write(String(e && e.stack || e)); process.exit(1); });`;
    return await new Promise((ok) => {
      const c = spawn(process.execPath, ['-e', wrapper], { cwd: root, env: { ...process.env, PD_FLOW_CTX: JSON.stringify(globals || {}) }, windowsHide: true });
      let o = '', e = ''; const t = setTimeout(() => { try { c.kill(); } catch { /* gone */ } }, timeoutMs);
      c.stdout.on('data', (d) => { o += d; }); c.stderr.on('data', (d) => { e += d; });
      c.on('exit', (codeN) => { clearTimeout(t); const i = o.indexOf('\u0000PDRET'); let ret; if (i >= 0) { try { ret = JSON.parse(o.slice(i + 6)); } catch { /* not JSON */ } o = o.slice(0, i); } const out = []; if (o) out.push(['o', o]); if (e) out.push(['e', e]); ok({ code: codeN || 0, out, ret }); });
    });
  }

  // ---- her models, for the steps that ask them ----
  async function askOnce(prompt, o = {}) {
    const r = await opts.chat('chat', { messages: [...(o.system ? [{ role: 'system', content: String(o.system) }] : []), { role: 'user', content: String(prompt) + (o.json ? '\n\nAnswer with JSON only.' : '') }] });
    if (!o.json) return r.content;
    const m = /[\[{][\s\S]*[\]}]/.exec(r.content || ''); try { return JSON.parse(m ? m[0] : r.content); } catch { throw new Error('the answer was not JSON'); }
  }
  async function decideData({ state, question, type, options }) {
    const opt = Array.isArray(options) && options.length ? options : null;
    const r = await askOnce(`${question}\n\nWhat there is to go on:\n${typeof state === 'string' ? state : JSON.stringify(state)}${opt ? `\n\nChoose exactly one of: ${opt.join(' | ')}` : ''}\n\nAnswer as JSON: {"choice": …, "why": "…"}`, { json: true });
    if (opt && !opt.includes(r.choice)) throw new Error(`the decision was not one of the options (${opt.join(', ')})`);
    return { type: type || 'choice', ...r };
  }
  async function runAgentPrompt(prompt, o = {}) {
    const r = await opts.loop.turn({ messages: [{ role: 'user', content: String(prompt) }], role: 'chat', why: 'ritual' });
    if (opts.keepChat) opts.keepChat(o.title || 'A ritual', String(prompt), r.content);
    return r.content;
  }

  // ---- the sandbox: the page's names the engines use, then the engines themselves ----
  const noop = () => {};
  let loading = true;
  // the page's screen, for the bits of the engines' files that draw their own panels: on the host, a quiet stand-in
  // that takes any call and draws nothing
  const QUIET = new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => '' : k === 'then' ? undefined : k === 'length' ? 0 : QUIET), apply: () => QUIET, set: () => true, construct: () => QUIET });
  const ctx = {
    console: { log: noop, warn: noop, error: noop, info: noop }, setTimeout, clearTimeout, clearInterval, Promise, Date, Math, JSON, URL,
    setInterval: (f, ms) => (loading ? 0 : setInterval(f, ms)), // their own timers: the host's rhythms call them instead
    TextEncoder, TextDecoder, AbortController, structuredClone, crypto: globalThis.crypto, Blob, Response, File: globalThis.File,
    CompressionStream: globalThis.CompressionStream, DecompressionStream: globalThis.DecompressionStream,
    enc: new TextEncoder(), dec: new TextDecoder(), fmtSize: (n) => (n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB'),
    Cron: require('./cron.cjs').Cron, CRON_LOG: '/Pandora/Logs/cron.log',
    cronMacro: (w) => ({ '@yearly': '0 0 1 1 *', '@annually': '0 0 1 1 *', '@monthly': '0 0 1 * *', '@weekly': '0 0 * * 0', '@daily': '0 0 * * *', '@midnight': '0 0 * * *', '@hourly': '0 * * * *' })[String(w || '').trim().toLowerCase()] || w,
    stripComments: require('./steer.cjs').stripComments,
    isNote: (p) => /\.(md|markdown|txt)$/i.test(String(p)),
    MEM_PATH: '/Pandora/Memory.md',
    memoryLines: () => { if (!vfs.isFile('/Pandora/Memory.md')) return []; let sec = ''; const out = []; for (const line of vfs.read('/Pandora/Memory.md').split('\n')) { const h = /^##\s+(.+)/.exec(line); if (h) { sec = h[1].trim(); continue; } const b = /^\s*[-*]\s+(.+)/.exec(line); if (b && b[1].trim()) out.push({ sec, text: b[1].trim(), line }); } return out; },
    buildBackup: async (kind) => opts.buildBackup(kind), // the host's things, as her Atelier's backup file; never with keys
    HB: { running: false, lastActive: 0 }, Sched: { draining: false, list: [], queue: [] }, compacting: false,
    fetch: (...a) => fetch(...a),
    window: {}, document: QUIET, $: () => QUIET, $$: () => [], localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
    vfs, ls, idb, WORLD_TOOL_DEFS: [],
    mcpToolDefs: () => [], VEC_TOOL_DEFS: [], FLOW_MAX_DEPTH: 5, // as in her Atelier (app/modules/bridge.js)
    // approving a playbook is the person's yes, given in her Atelier's Playbooks tab: never here
    phoneApprove: async () => false,
    toast: noop, esc: (s) => String(s), uid: () => Math.random().toString(36).slice(2, 10), sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    clone: (x) => JSON.parse(JSON.stringify(x)), b64dec: (b) => Buffer.from(String(b), 'base64'), b64enc: (u) => Buffer.from(u).toString('base64'),
    running: false,
    activeTools: () => toolDefs(), runTool,
    runShellLine, runNodeScript, askOnce, decideData, runAgentPrompt,
    schedNotify: (title, body) => { log('her.notify', { title: String(title).slice(0, 120) }); trace('her.notify', { title, body }); },
    bsPage: async () => { throw new Error('browser steps need an open Atelier (the host has no browser of hers)'); },
    bsWaitTarget: async () => { throw new Error('browser steps need an open Atelier'); },
    bsHostOk: () => true, bsHost: (u) => { try { return new URL(u).host; } catch { return String(u); } },
    renderPlaybooks: noop, flowsRender: noop, flowRunUi: noop, flowsChanged: noop, renderSchedules: noop,
  };
  ctx.globalThis = ctx;
  Object.defineProperty(ctx, 'S', { get: () => { const s = { ...(opts.state.lsAll().values.settings || {}) }; const k = (opts.secrets && opts.secrets()) || {}; for (const f of ['abToken', 'abPass']) if (k[f]) s[f] = k[f]; s.browserOn = false; s.model = s.model || 'on the host'; return s; }, enumerable: true });
  // her tools by name, as the engines check them (the page's TOOL_DEFS): her loop's, live
  Object.defineProperty(ctx, 'TOOL_DEFS', { get: () => toolDefs().map((d) => d.function), enumerable: true });
  vm.createContext(ctx);
  const src = ['playbook.js', 'flows.js', 'think_tool.js', 'curiosity.js', 'autobackup.js'].map((f) => fs.readFileSync(path.join(MODULES, f), 'utf8')).join('\n;\n');
  // the page's live secrets: the host's write-only key file, read fresh each time
  vm.runInContext(`${src}\n;globalThis.FLOW_TOOL_DEFS = FLOW_TOOL_DEFS; globalThis.pbHash = pbHash; globalThis.pbCanon = pbCanon; globalThis.__CU = () => CU; globalThis.__AB = () => AB; Object.assign(globalThis, { cuState, cuSave, cuOpts, cuEnabledIds, cuToday, cuDay });\n;globalThis.secretsMap = () => globalThis.__hostSecrets();\nglobalThis.redactSecrets = (s) => { let out = String(s); for (const [k, v] of Object.entries(globalThis.__hostSecrets())) if (v && String(v).length >= 4) out = out.split(String(v)).join('{{' + k + '}}'); return out; };`, ctx, { filename: 'her-engines.js' });
  ctx.__hostSecrets = secrets;
  loading = false;
  // the engines' own panels and lists are drawn by her Atelier; on the host there is nothing to draw
  for (const f of ['flowsRender', 'flowRunUi', 'flowListHtml', 'renderPlaybooks', 'pbRender', 'abRenderStatus', 'cuRenderStatus']) if (typeof ctx[f] === 'function') ctx[f] = () => '';
  ctx.clock = (t) => new Date(t).toLocaleString();
  ctx.relTime = () => '';
  ctx.editing = null; // the note her Atelier has open: none, on the host
  ctx.splitFrontmatter = (t) => { const m = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(String(t || '')); return { front: m ? m[0] : '', body: m ? String(t).slice(m[0].length) : String(t || '') }; };
  // a note by path, or by name anywhere in her vault, as her wikilinks find it
  ctx.resolveNote = (target) => {
    let t = String(target ?? '').trim().replace(/\\/g, '/'); if (!t) return null;
    if (!/\.[A-Za-z0-9]+$/.test(t)) t += '.md';
    if (vfs.isFile(norm(t))) return norm(t);
    const want = t.toLowerCase().split('/').pop();
    let n = 0; for (const vp of vfs.walk('/')) { if (++n > 20000) break; if (vp.toLowerCase().split('/').pop() === want && vfs.isFile(vp)) return vp; }
    return null;
  };
  // ritual expressions: the page runs them in a Worker with no network; here, a fresh vm context, likewise, 5 s at most
  ctx.flowEvalJobs = (jobs, view) => {
    if (!jobs.length) return Promise.resolve([]);
    const payload = JSON.parse(JSON.stringify(view, (k, v) => (v === undefined ? null : v)));
    const box = vm.createContext({ $: payload, $date: ctx.jvDate, JSON, Math, Date, String, Number, Array, Object, Boolean, RegExp, parseInt, parseFloat, isNaN });
    const fn = (s) => `(function(){ with ($) { return (${s}\n); } })()`;
    const str = (v) => (v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));
    try {
      const out = jobs.map((j) => {
        if (j.mode === 'expr') return vm.runInContext(fn(j.src), box, { timeout: 5000 });
        const one = /^\s*\{\{([\s\S]+?)\}\}\s*$/.exec(j.src);
        if (one && j.src.indexOf('{{') === j.src.lastIndexOf('{{')) return vm.runInContext(fn(one[1]), box, { timeout: 5000 });
        return j.src.replace(/\{\{([\s\S]+?)\}\}/g, (_, e) => str(vm.runInContext(fn(e), box, { timeout: 5000 })));
      });
      return Promise.resolve(JSON.parse(JSON.stringify(out, (k, v) => (v === undefined ? null : v))));
    } catch (e) { return Promise.reject(new Error(`expression error: ${e && e.message ? e.message : e}`)); }
  };

  // the host's words for a playbook nobody has approved (the page's say the person said no, which on the host they
  // haven't: they approve in her Atelier)
  const approvals = (p) => p.catch((e) => { if (/not approved/.test(String(e && e.message))) throw new Error(`${e.message.replace(/\s*\(it changed[^)]*\)|,? and the user said no/g, '')}: the person approves a playbook in her Atelier's Playbooks tab, and from then on it runs here too`); throw e; });
  const api = {
    playbookTool: (a) => approvals(Promise.resolve().then(() => ctx.playbookTool(a))),
    flowTool: (a) => ctx.flowTool(a),
    runPlaybook: (name, vars, via) => approvals(Promise.resolve().then(() => ctx.pbRunUnattended(name, vars, via))),
    /** What her Atelier writes when the person approves a playbook (for tests that stand in for that yes). */
    approvalOf: (name) => ctx.pbHash(ctx.pbCanon(ctx.pbLoad(String(name)))),
    runRitual: (name, input, o) => ctx.flowRunByName(name, input, o || {}),
    /** Whether a playbook drives the browser (those stay with an open Atelier). */
    usesBrowser(name) {
      try { const pb = ctx.pbLoad(String(name)); let b = false; const walk = (ts) => { for (const t of ts || []) { if (t.do && ctx.pbModule(t).kind === 'browser') b = true; walk(t.block); walk(t.rescue); walk(t.always); } }; walk(pb.tasks); return b; } catch { return false; }
    },
    think: (a) => ctx.thinkTool(a),
    curiosity: (a) => ctx.curiosityTool(a),
    /** Her rituals' own triggers: a ritual on a schedule, or one waiting for a note to change. */
    ritualTick: () => ctx.flowTick(),
    noteTick: () => ctx.flowNoteCheck(),
    /** Her scheduled backup, as her Atelier sends it (to her backup server), when one is due. */
    backupTick: () => ctx.abTick(),
    backupNow: () => ctx.runAutoBackup({ manual: true }),
    /** A curiosity wake-up, chosen and measured by her Atelier's own curiosity, run through her loop. */
    async curiosityWake({ manual = false, ask } = {}) {
      const S = ctx.S, CU = ctx.__CU();
      if (CU.running) return null;
      if (!manual && ctx.cuToday().n >= (+S.cuCap || 5)) { const d = new Date(); d.setHours(24, 0, 0, 0); ls.set('cuNext', ctx.cuNextAt(d.getTime(), ctx.cuOpts())); return null; }
      const ids = ctx.cuEnabledIds(); if (!ids.length) return null;
      CU.running = true;
      let suggested = null;
      try { // everything from here clears "running" whatever happens, so one failure never stops her next wake-up
        ctx.ensureCuFile();
        const st = ctx.cuState(), wish = ctx.cuUserNotes().todo > 0 ? { explore: 0.35, anticipate: 0.35 } : null;
        const scores = ctx.cuScores(st, ids, Date.now(), (st.log.at(-1) || {}).id, wish); suggested = ctx.cuPick(scores, ctx.cuTemperature(st));
        CU.pending = { suggested, chosen: null, intent: '', before: ctx.cuSnapshot(), startedAt: Date.now(), done: false };
        const t = ctx.cuToday(); t.n++; ls.set('cuToday', t);
        const prompt = ctx.cuPrompt(st, scores, suggested);
        const reply = await ask(prompt);
        if (!CU.pending.done) ctx.cuFinish(null, 'no report was made');
        const chosen = CU.pending.chosen || suggested;
        if (chosen !== 'rest' && opts.keepChat) opts.keepChat('✦ Curiosity', '✦ Curiosity wake-up', reply, { sessionKey: 'cuSession' });
        return { suggested, chosen };
      } catch (e) { if (CU.pending && !CU.pending.done) ctx.cuFinish(null, 'error: ' + ((e && e.message) || e)); throw e; }
      finally { const nudge = (CU.pending && CU.pending.report && CU.pending.report.next) || ''; CU.running = false; CU.pending = null; ls.set('cuNext', ctx.cuNextAt(Date.now(), ctx.cuOpts(), Math.random, nudge)); }
    },
    /** Whether a curiosity wake-up is due (her settings: on, the window of hours, the next time). */
    curiosityDue() {
      const S = ctx.S; if (!S.curiosityOn || ctx.__CU().running) return false;
      let next = ls.get('cuNext', 0);
      if (!next || next < Date.now() - (ctx.cuOpts().max + 30) * 60000) { next = ctx.cuNextAt(Date.now(), ctx.cuOpts()); ls.set('cuNext', next); }
      return Date.now() >= next && ctx.cuInWindow(Date.now(), ctx.cuOpts().from, ctx.cuOpts().to);
    },
    toolDefs: () => [
      { type: 'function', function: { name: 'playbook', description: (ctx.WORLD_TOOL_DEFS.find((t) => t.name === 'playbook') || {}).description || 'Playbooks.', parameters: (ctx.WORLD_TOOL_DEFS.find((t) => t.name === 'playbook') || {}).parameters || { type: 'object', properties: {} } } },
      ...(ctx.FLOW_TOOL_DEFS || []).map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } })),
      ...['think', 'curiosity'].map((n) => ctx.WORLD_TOOL_DEFS.find((t) => t.name === n)).filter(Boolean).map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } })),
    ],
  };
  return api;
}

module.exports = { createEngines };
