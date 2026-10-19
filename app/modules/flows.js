/* =====================================================================
   FLOWS (rituals) — small n8n-style automations. A ritual is a JSON file in /Pandora/Rituals/<name>.ritual.json
   (<name>.flow.json, from Jade Vault, still loads):
     { "name", "description", "enabled", "trigger": {"type": "manual"|"schedule"|"note", "when", "path"},
       "vars": {…}, "timeout": seconds, "steps": [ step, … ] }
   Steps run in order; each one's output is $json for the next. if / switch / each hold nested steps.
   Strings may contain {{ expressions }} (JavaScript, evaluated in a sandbox) with $json, $input, $node,
   $vars, $item, $index, $now, $today, $flow, $run and $date(fmt, date, days).
   Runs: by hand (Flows tab), on a schedule, when a note changes, from the shell (flow run), from
   JavaScript (jade.flow), by Jade (flow tool), from the Schedule tab / crontab, or over the HTTP API.
   ===================================================================== */
const FLOW_DIR = '/Pandora/Rituals', FLOW_EXT = '.ritual.json', FLOW_EXT_OLD = '.flow.json', FLOW_MAX_STEPS = 5000;
const flowExt = p => p.endsWith(FLOW_EXT) ? FLOW_EXT : p.endsWith(FLOW_EXT_OLD) ? FLOW_EXT_OLD : '';
// field: [key, label, kind, placeholder, required]. kinds: tpl, area, code, expr, json, bool, num, sel:<a|b>, tool, flowsel, lines
const FLOW_TYPES = {
  tool:   { label: 'Tool', icon: '🛠', help: 'Call one of Jade\'s tools. Output: what the tool returns (text).', fields: [['tool', 'Tool', 'tool', '', true], ['args', 'Arguments (JSON; strings may use {{ }})', 'json', '{"query": "{{ $json.topic }}"}'], ['parse', 'Parse the result as JSON', 'bool']] },
  js:     { label: 'JavaScript', icon: 'ƒ', help: 'Runs in the node sandbox: fs, path, fetch, and jade.* (tools, decide, ask, flows). $json, $input, $node, $vars, $item are set. Output: the returned value (or what it printed).', fields: [['code', 'Code', 'code', 'const notes = fs.readdirSync(\'/projects\');\nreturn { count: notes.length };', true], ['timeout', 'Time limit (seconds, default 60)', 'num']] },
  shell:  { label: 'Shell', icon: '$', help: 'Runs a command line in the BusyBox shell (pipes, redirects, node, python, sqlite3, flow, jade…). Output: {code, stdout, stderr}. A non-zero exit fails the step unless "Allow failure" is on.', fields: [['command', 'Command', 'tpl', 'ls /projects | wc -l', true], ['cwd', 'Folder (default /)', 'tpl', '/'], ['allowFail', 'Allow failure (non-zero exit)', 'bool'], ['timeout', 'Time limit (seconds, default 60)', 'num']] },
  decide: { label: 'Decide', icon: '⚖', help: 'Ollaya decision model: calibrated probabilities. Output: {result, choice|score|answer, confidence, probabilities}.', fields: [['state', 'Text to judge', 'area', '{{ $json }}', true], ['question', 'Question', 'tpl', 'Is this urgent?', true], ['kind', 'Type', 'sel:choice|score|yesno'], ['options', 'Options (one per line; choice and score)', 'lines', 'urgent\nnormal\nlow']] },
  llm:    { label: 'Ask AI', icon: '✦', help: 'One answer from the chat model (no tools, no chat). Output: the text, or parsed JSON when "Expect JSON" is on.', fields: [['prompt', 'Prompt', 'area', 'Summarise in 3 bullets:\n{{ $json }}', true], ['system', 'System prompt (optional)', 'area'], ['json', 'Expect JSON back', 'bool']] },
  agent:  { label: 'Jade agent', icon: '◆', help: 'A full chat turn: Jade gets the message, uses her tools and answers in the chat. Output: {reply, chat}. Cannot run while she is busy in a chat (or from her own flow tool).', fields: [['prompt', 'Message to Jade', 'area', 'File each line of {{ $json }} into its own note.', true], ['chat', 'Chat', 'sel:new|same']] },
  note:   { label: 'Note', icon: '✎', help: 'Read or write a note. read → its text. write / append / prepend → {path, bytes}.', fields: [['action', 'Action', 'sel:read|append|prepend|write'], ['path', 'Note (name or /path)', 'tpl', '/Inbox.md', true], ['content', 'Text (write / append / prepend)', 'area', '- {{ $now }} {{ $json }}']] },
  set:    { label: 'Set fields', icon: '≔', help: 'Build an object. Output: the fields (merged into the incoming object when "Keep" is on).', fields: [['fields', 'Fields (JSON; strings may use {{ }})', 'json', '{"title": "{{ $json.name }}", "when": "{{ $today }}"}', true], ['keep', 'Keep the incoming fields', 'bool']] },
  if:     { label: 'If', icon: '⑂', help: 'Runs "then" or "else". Output: the last output of the branch that ran.', fields: [['condition', 'Condition (JavaScript)', 'expr', '$json.count > 0', true]], branches: [['then', 'Then'], ['else', 'Else']] },
  switch: { label: 'Switch', icon: '☰', help: 'Runs the first case whose "match" equals the value (or one of a list), else "default".', fields: [['value', 'Value (JavaScript)', 'expr', '$json.result', true]], cases: true },
  each:   { label: 'For each', icon: '↻', help: 'Runs its steps once per item ($item, $index; $json starts as the item). Output: the list of results.', fields: [['items', 'List (JavaScript)', 'expr', '$json.split("\\n").filter(Boolean)', true]], branches: [['steps', 'Do']] },
  wait:   { label: 'Wait', icon: '⏸', help: 'Pause (up to 300 s). Output: unchanged.', fields: [['seconds', 'Seconds', 'num', '5', true]] },
  notify: { label: 'Notify me', icon: '🔔', help: 'A phone notification (and a toast in the app). Output: unchanged.', fields: [['title', 'Title', 'tpl', '{{ $flow.name }}'], ['body', 'Message', 'area', '{{ $json }}']] },
  flow:   { label: 'Run flow', icon: '⇢', help: 'Runs another flow with an input. Output: that flow\'s output.', fields: [['flow', 'Flow', 'flowsel', '', true], ['input', 'Input (JSON or {{ }}; default: $json)', 'json']] },
  stop:   { label: 'Stop', icon: '■', help: 'Ends the flow (successfully). Output: the value, or $json.', fields: [['value', 'Result (optional; {{ }})', 'tpl']] },
};
const FLOW_COMMON = ['id', 'type', 'name', 'onError', 'retries', 'disabled', 'then', 'else', 'steps', 'cases', 'default', 'note'];

/* ---------- storage ---------- */
const flowSafe = n => String(n || '').trim().replace(/[\\/:*?"<>|#^\[\]]+/g, '-').replace(/\s+/g, ' ').slice(0, 80) || 'Flow';
// <name>.ritual.json wins over a <name>.flow.json left beside it
function flowFiles() {
  const all = [...vfs.nodes.keys()].filter(p => p.startsWith(FLOW_DIR + '/') && flowExt(p) && vfs.isFile(p));
  return all.filter(p => !(p.endsWith(FLOW_EXT_OLD) && all.includes(p.slice(0, -FLOW_EXT_OLD.length) + FLOW_EXT))).sort((a, b) => a.localeCompare(b));
}
function flowRead(p) {
  const base = vfs.base(p).slice(0, -flowExt(p).length);
  try { const f = JSON.parse(vfs.read(p)); if (!f || typeof f !== 'object' || Array.isArray(f)) throw new Error('not a JSON object'); return { ...f, name: String(f.name || base), _path: p }; }
  catch (e) { return { name: base, _path: p, _bad: e.message, steps: [] }; }
}
function flowList() { return flowFiles().map(flowRead); }
function flowFind(name) {
  const k = String(name ?? '').trim().toLowerCase(); if (!k) return null;
  const all = flowList();
  return all.find(f => f.name.toLowerCase() === k) || all.find(f => f._path.toLowerCase() === k || vfs.base(f._path).toLowerCase() === k || vfs.base(f._path).toLowerCase() === k + FLOW_EXT || vfs.base(f._path).toLowerCase() === k + FLOW_EXT_OLD) || null;
}
function flowWalk(steps, fn, path = 'steps') {
  (Array.isArray(steps) ? steps : []).forEach((st, i) => {
    const p = `${path}.${i}`; fn(st, p);
    if (!st || typeof st !== 'object') return;
    for (const k of ['then', 'else', 'steps', 'default']) if (Array.isArray(st[k])) flowWalk(st[k], fn, `${p}.${k}`);
    if (Array.isArray(st.cases)) st.cases.forEach((c, j) => flowWalk(c?.steps, fn, `${p}.cases.${j}.steps`));
  });
}
// a copy without the editor's private keys, with an id on every step
function flowClean(f) {
  const strip = v => Array.isArray(v) ? v.map(strip) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([k]) => !k.startsWith('_')).map(([k, x]) => [k, strip(x)])) : v;
  const out = strip(f); out.steps = Array.isArray(out.steps) ? out.steps : [];
  const used = new Set(); let n = 0;
  flowWalk(out.steps, st => { if (st && typeof st === 'object' && st.id) { if (used.has(st.id)) delete st.id; else used.add(String(st.id)); } });
  flowWalk(out.steps, st => { if (st && typeof st === 'object' && !st.id) { do n++; while (used.has('s' + n)); st.id = 's' + n; used.add(st.id); } });
  const order = ['name', 'description', 'enabled', 'trigger', 'vars', 'timeout', 'steps'];
  return Object.fromEntries([...order.filter(k => k in out).map(k => [k, out[k]]), ...Object.entries(out).filter(([k]) => !order.includes(k))]);
}
function flowSave(f, oldPath) {
  const clean = flowClean(f); clean.name = String(clean.name || '').trim() || 'Flow';
  const p = `${FLOW_DIR}/${flowSafe(clean.name)}${FLOW_EXT}`;
  vfs.write(p, JSON.stringify(clean, null, 2) + '\n', { mkdirs: true });
  if (oldPath && oldPath !== p && vfs.isFile(oldPath)) vfs.rm(oldPath);
  flowsChanged(); return { ...clean, _path: p };
}
function flowDelete(f) { if (vfs.isFile(f._path)) vfs.rm(f._path); flowsChanged(); }
function flowToolNames() { return [...new Set([...TOOL_DEFS.map(t => t.name), ...(typeof VEC_TOOL_DEFS !== 'undefined' ? VEC_TOOL_DEFS.map(t => t.name) : []), ...(typeof DC_TOOL_DEFS !== 'undefined' ? DC_TOOL_DEFS.map(t => t.name) : []), ...mcpToolDefs().map(t => t.function.name)])].filter(n => n !== 'ritual' && n !== 'flow').sort(); }

/* ---------- validation ---------- */
function flowValidate(f) {
  const errs = [];
  if (!f || typeof f !== 'object' || Array.isArray(f)) return ['the flow must be a JSON object'];
  if (f._bad) return [`the file is not valid JSON: ${f._bad}`];
  if (!String(f.name || '').trim()) errs.push('the flow needs a "name"');
  if (!Array.isArray(f.steps)) errs.push('"steps" must be a list of steps');
  const tr = f.trigger == null ? { type: 'manual' } : f.trigger;
  if (typeof tr !== 'object') errs.push('"trigger" must be an object like {"type": "manual"}');
  else {
    const t = tr.type || 'manual';
    if (!['manual', 'schedule', 'note'].includes(t)) errs.push('trigger.type must be manual, schedule or note');
    if (t === 'schedule') { try { const spec = Cron.fromText(cronMacro(String(tr.when || ''))); if (spec.once) errs.push('trigger.when must repeat (like "every day at 9am" or a cron line), not one date'); } catch (e) { errs.push('trigger.when: ' + e.message); } }
    if (t === 'note' && !String(tr.path || '').trim()) errs.push('trigger.path: which note or folder to watch');
  }
  if (f.vars != null && (typeof f.vars !== 'object' || Array.isArray(f.vars))) errs.push('"vars" must be an object');
  const ids = new Set(), tools = flowToolNames();
  flowWalk(f.steps, (st, p) => {
    if (!st || typeof st !== 'object' || Array.isArray(st)) { errs.push(`${p}: each step must be an object`); return; }
    const where = `${p} (${st.name || st.id || st.type || '?'})`;
    const T = FLOW_TYPES[st.type]; if (!T) { errs.push(`${where}: unknown type "${st.type}". Types: ${Object.keys(FLOW_TYPES).join(', ')}`); return; }
    if (st.id != null) { if (ids.has(String(st.id))) errs.push(`${where}: the id ${st.id} is used twice`); ids.add(String(st.id)); }
    for (const [k, , kind, , req] of T.fields) {
      const v = st[k];
      if (req && (v == null || (typeof v === 'string' && !v.trim()))) errs.push(`${where}: "${k}" is required`);
      if (kind === 'json' && v != null && typeof v === 'string' && !v.includes('{{')) errs.push(`${where}: "${k}" must be JSON (an object or list), or a {{ }} expression`);
      if (kind === 'num' && v != null && v !== '' && !Number.isFinite(+v)) errs.push(`${where}: "${k}" must be a number`);
      if (kind.startsWith('sel:') && v != null && v !== '' && !kind.slice(4).split('|').includes(v)) errs.push(`${where}: "${k}" must be one of ${kind.slice(4).split('|').join(', ')}`);
    }
    if (st.type === 'tool' && st.tool) { if (st.tool === 'ritual' || st.tool === 'flow') errs.push(`${where}: use a "flow" step (Run ritual) to run another ritual`); else if (!tools.includes(st.tool) && !/^mcp__/.test(st.tool)) errs.push(`${where}: no tool named "${st.tool}"`); }
    if (st.type === 'tool' && st.args != null && (typeof st.args !== 'object' || Array.isArray(st.args))) errs.push(`${where}: "args" must be an object`);
    if (st.type === 'set' && st.fields != null && (typeof st.fields !== 'object' || Array.isArray(st.fields))) errs.push(`${where}: "fields" must be an object`);
    if (st.type === 'switch' && st.cases != null && (!Array.isArray(st.cases) || st.cases.some(c => !c || typeof c !== 'object'))) errs.push(`${where}: "cases" must be a list of {"match": value, "steps": [...]}`);
    for (const k of ['then', 'else', 'steps', 'default']) if (st[k] != null && !Array.isArray(st[k])) errs.push(`${where}: "${k}" must be a list of steps`);
    if (st.onError != null && !['stop', 'continue'].includes(st.onError)) errs.push(`${where}: onError must be "stop" or "continue"`);
    if (st.retries != null && !(Number.isInteger(+st.retries) && +st.retries >= 0 && +st.retries <= 3)) errs.push(`${where}: retries must be 0-3`);
  });
  return errs;
}

/* ---------- dates: $date(fmt, date, days) — moment-style tokens ---------- */
function jvDate(fmt, d, days) {
  fmt = fmt == null || fmt === '' ? 'YYYY-MM-DD' : String(fmt);
  let t = d instanceof Date ? new Date(d.getTime()) : d == null || d === '' ? new Date() : new Date(typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d + 'T00:00:00' : d);
  if (isNaN(t.getTime())) t = new Date();
  if (days) t.setDate(t.getDate() + Number(days));
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const p = (n, w = 2) => String(n).padStart(w, '0'); const h = t.getHours(), D = t.getDate();
  const iso = (() => { const x = new Date(Date.UTC(t.getFullYear(), t.getMonth(), D)); const dn = x.getUTCDay() || 7; x.setUTCDate(x.getUTCDate() + 4 - dn); const y0 = new Date(Date.UTC(x.getUTCFullYear(), 0, 1)); return Math.ceil(((x - y0) / 864e5 + 1) / 7); })();
  const ord = n => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
  const map = { YYYY: t.getFullYear(), YY: p(t.getFullYear() % 100), MMMM: MONTHS[t.getMonth()], MMM: MONTHS[t.getMonth()].slice(0, 3), MM: p(t.getMonth() + 1), M: t.getMonth() + 1, Do: ord(D), DD: p(D), D,
    dddd: DAYS[t.getDay()], ddd: DAYS[t.getDay()].slice(0, 3), d: t.getDay(), HH: p(h), H: h, hh: p(h % 12 || 12), h: h % 12 || 12, mm: p(t.getMinutes()), m: t.getMinutes(), ss: p(t.getSeconds()), s: t.getSeconds(),
    A: h < 12 ? 'AM' : 'PM', a: h < 12 ? 'am' : 'pm', ww: p(iso), w: iso, X: Math.floor(t.getTime() / 1000), x: t.getTime() };
  return fmt.replace(/\[([^\]]*)\]|YYYY|YY|MMMM|MMM|MM|Do|DD|dddd|ddd|HH|hh|mm|ss|ww|M|D|d|H|h|m|s|A|a|w|X|x/g, (m, lit) => lit !== undefined ? lit : String(map[m]));
}

/* ---------- expressions: evaluated in a small sandboxed worker (no network, no vault, no tools) ---------- */
function flowExprMain() {
  self.fetch = undefined; self.XMLHttpRequest = undefined; self.WebSocket = undefined; self.EventSource = undefined; self.importScripts = undefined;
  const cache = new Map();
  const fn = src => { let f = cache.get(src); if (!f) { f = new Function('$', '$date', 'with ($) { return (' + src + '\n); }'); cache.set(src, f); } return f; };
  const str = v => v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
  const tpl = (s, $) => {
    const one = /^\s*\{\{([\s\S]+?)\}\}\s*$/.exec(s);
    if (one && s.indexOf('{{') === s.lastIndexOf('{{')) return fn(one[1])($, $date);
    return s.replace(/\{\{([\s\S]+?)\}\}/g, (_, e) => str(fn(e)($, $date)));
  };
  self.onmessage = e => {
    const { id, jobs, ctx } = e.data; const out = []; let i = 0;
    try { for (; i < jobs.length; i++) out.push(jobs[i].mode === 'expr' ? fn(jobs[i].src)(ctx, $date) : tpl(jobs[i].src, ctx)); self.postMessage({ id, ok: true, out: JSON.parse(JSON.stringify(out, (k, v) => v === undefined ? null : v)) }); }
    catch (err) { self.postMessage({ id, ok: false, error: (err && err.message) || String(err), src: jobs[i] && jobs[i].src }); }
  };
}
const FlowExpr = { w: null, seq: 0, pend: new Map() };
function flowExprWorker() {
  if (FlowExpr.w) return FlowExpr.w;
  const src = `const $date = ${jvDate.toString()};\n(${flowExprMain.toString()})();`;
  const w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
  w.onmessage = e => { const p = FlowExpr.pend.get(e.data.id); if (!p) return; FlowExpr.pend.delete(e.data.id); clearTimeout(p.t); e.data.ok ? p.res(e.data.out) : p.rej(new Error(`${e.data.src ? `{{ ${String(e.data.src).trim().slice(0, 80)} }}: ` : ''}${e.data.error}`)); };
  w.onerror = e => { e.preventDefault?.(); const msg = 'expression error: ' + (e.message || 'syntax error'); for (const [id, p] of FlowExpr.pend) { clearTimeout(p.t); p.rej(new Error(msg)); FlowExpr.pend.delete(id); } };
  return (FlowExpr.w = w);
}
function flowEvalJobs(jobs, ctx) {
  if (!jobs.length) return Promise.resolve([]);
  let payload; try { payload = JSON.parse(JSON.stringify(ctx, (k, v) => v === undefined ? null : v)); } catch (e) { return Promise.reject(new Error('the data could not be passed to the expressions: ' + e.message)); }
  return new Promise((res, rej) => {
    const id = ++FlowExpr.seq; const w = flowExprWorker();
    const t = setTimeout(() => {
      try { w.terminate(); } catch {} FlowExpr.w = null;
      for (const [k, p] of FlowExpr.pend) { clearTimeout(p.t); if (k !== id) p.rej(new Error('expression worker restarted')); }
      FlowExpr.pend.clear(); rej(new Error('an expression ran longer than 5 s (an endless loop?)'));
    }, 5000);
    FlowExpr.pend.set(id, { res, rej, t });
    w.postMessage({ id, jobs, ctx: payload });
  });
}
function flowCtxView(ctx) { const d = new Date(); return { ...ctx, $now: d.toISOString(), $today: jvDate('YYYY-MM-DD', d) }; }
async function flowResolve(st, ctx) {
  const T = FLOW_TYPES[st.type]; const jobs = [], sets = [], out = {};
  const add = (src, mode, set) => { jobs.push({ src, mode }); sets.push(set); };
  const walk = (v, set) => {
    if (typeof v === 'string') { if (v.includes('{{')) add(v, 'tpl', set); else set(v); }
    else if (Array.isArray(v)) { const a = v.slice(); set(a); a.forEach((x, i) => walk(x, y => { a[i] = y; })); }
    else if (v && typeof v === 'object') { const o = { ...v }; set(o); for (const k of Object.keys(o)) walk(o[k], y => { o[k] = y; }); }
    else set(v);
  };
  for (const [k, , kind] of T.fields) {
    const v = st[k]; if (v === undefined || v === null) continue;
    if (kind === 'expr') { const src = String(v).trim().replace(/^\{\{([\s\S]*)\}\}$/, '$1').trim(); if (src) add(src, 'expr', x => { out[k] = x; }); }
    else if (kind === 'code' || kind === 'bool' || kind === 'num' || kind.startsWith('sel:') || kind === 'tool' || kind === 'flowsel') out[k] = v;
    else walk(v, x => { out[k] = x; });
  }
  const vals = await flowEvalJobs(jobs, flowCtxView(ctx)); vals.forEach((x, i) => sets[i](x));
  return out;
}

/* ---------- running ---------- */
const FlowRuns = { active: new Map(), recent: [], loaded: false };
class FlowStop { constructor(v) { this.value = v; } }
class FlowStepError extends Error {}
function flowClip(v, n = 2000) {
  if (v === undefined) return null;
  let s; try { s = typeof v === 'string' ? v : JSON.stringify(v); } catch { s = String(v); }
  if (s == null) return null;
  return s.length <= n ? (typeof v === 'string' ? v : JSON.parse(s)) : s.slice(0, n) + `… [${s.length - n} more characters]`;
}
async function flowRecordsLoad() { if (FlowRuns.loaded) return; FlowRuns.recent = (await idb.get('flowRuns')) || []; FlowRuns.loaded = true; }
async function flowRecord(run) {
  await flowRecordsLoad();
  const copy = { ...run, input: flowClip(run.input, 4000), output: flowClip(run.output, 8000), steps: run.steps.slice(0, 300) };
  delete copy.stop; delete copy._full;
  FlowRuns.recent = [copy, ...FlowRuns.recent.filter(r => r.id !== run.id)].slice(0, 100);
  try { await idb.set('flowRuns', FlowRuns.recent); } catch {}
}
const flowLines = v => (Array.isArray(v) ? v : typeof v === 'string' ? v.split('\n') : v == null ? [] : [v]).map(x => typeof x === 'string' ? x.trim() : JSON.stringify(x)).filter(Boolean);
const flowMatch = (m, v) => Array.isArray(m) ? m.some(x => flowMatch(x, v)) : m === v || String(m) === String(v) || (m && typeof m === 'object' && JSON.stringify(m) === JSON.stringify(v));
async function flowRunByName(name, input, o = {}) { const f = flowFind(name); if (!f) throw new Error(`no flow named "${name}"`); return flowRun(f, input, o); }
async function flowRun(flow, input = null, o = {}) {
  const run = { id: uid(), flow: flow.name, path: flow._path || null, via: o.via || 'manual', started: Date.now(), ended: 0, status: 'running', input: input ?? null, output: null, error: null, steps: [], stop: false };
  const errs = flowValidate(flow);
  if (errs.length || (o.depth || 0) > FLOW_MAX_DEPTH) {
    run.status = 'error'; run.error = errs.length ? 'the flow is not valid: ' + errs.join('; ') : 'flows call each other too deeply'; run.ended = Date.now();
    await flowRecord(run); flowRunUi(run); return run;
  }
  FlowRuns.active.set(run.id, run); flowsBadge(); flowRunUi(run);
  const ctx = { $input: input ?? null, $json: input ?? null, $node: {}, $vars: flow.vars && typeof flow.vars === 'object' ? flow.vars : {}, $flow: { name: flow.name }, $run: { id: run.id, via: run.via }, $item: null, $index: null };
  const st = { run, flow, depth: o.depth || 0, deadline: Date.now() + Math.min(3600, Math.max(5, +flow.timeout || 600)) * 1000, count: 0, signal: { get aborted() { return run.stop; } } };
  try { run.output = await flowSeq(flow.steps || [], ctx, st); run.status = 'ok'; }
  catch (e) {
    if (e instanceof FlowStop) { run.output = e.value; run.status = 'ok'; run.stopped = true; }
    else { run.status = run.stop ? 'stopped' : 'error'; run.error = String(e?.message || e); }
  } finally {
    run.ended = Date.now(); FlowRuns.active.delete(run.id); flowsBadge();
    await flowRecord(run); flowRunUi(run, true); if (FUI.view === 'list') flowsRender();
  }
  return run;
}
async function flowSeqIn(steps, ctx, st) { st.level = (st.level || 0) + 1; try { return await flowSeq(steps, ctx, st); } finally { st.level--; } }
async function flowSeq(steps, ctx, st) {
  let last = ctx.$json;
  for (const step of steps || []) {
    if (st.run.stop) throw new Error('stopped');
    if (Date.now() > st.deadline) throw new Error(`the flow ran past its time limit (${Math.round((st.deadline - st.run.started) / 1000)} s)`);
    if (++st.count > FLOW_MAX_STEPS) throw new Error('too many steps ran (an endless loop?)');
    last = await flowStep(step, ctx, st);
    ctx.$json = last;
  }
  return last;
}
async function flowStep(step, ctx, st) {
  const label = String(step.name || step.id || step.type);
  const rec = { id: step.id || null, name: label, type: step.type, depth: st.level || 0, status: 'running', started: Date.now(), ms: 0, input: flowClip(ctx.$json, 1500) };
  st.run.steps.push(rec); flowRunUi(st.run);
  const keep = out => { if (step.name) ctx.$node[step.name] = out; if (step.id) ctx.$node[step.id] = out; };
  if (step.disabled) { rec.status = 'skipped'; rec.output = rec.input; keep(ctx.$json); return ctx.$json; }
  const container = ['if', 'switch', 'each'].includes(step.type);
  const tries = container ? 1 : Math.min(3, Math.max(0, step.retries | 0)) + 1; let err;
  for (let a = 0; a < tries; a++) {
    try {
      const out = await flowExec(step, ctx, st, rec);
      rec.status = 'ok'; rec.ms = Date.now() - rec.started; rec.output = flowClip(out, 1500); keep(out); flowRunUi(st.run);
      return out;
    } catch (e) {
      if (e instanceof FlowStop) { rec.status = 'ok'; rec.ms = Date.now() - rec.started; rec.output = flowClip(e.value, 1500); rec.note = 'stopped the flow'; flowRunUi(st.run); throw e; }
      err = e; if (e instanceof FlowStepError || st.run.stop) break;
      if (a < tries - 1) { rec.note = `retry ${a + 1}`; flowRunUi(st.run); await sleep(800 * (a + 1)); }
    }
  }
  rec.ms = Date.now() - rec.started; rec.status = 'error';
  if (err instanceof FlowStepError) { rec.error = 'a step inside failed'; flowRunUi(st.run); throw err; }
  rec.error = String(err?.message || err);
  if (step.onError === 'continue' && !st.run.stop) { rec.note = 'continued'; const out = { error: rec.error }; keep(out); flowRunUi(st.run); return out; }
  flowRunUi(st.run);
  throw new FlowStepError(`step "${label}" failed: ${rec.error}`);
}
async function flowExec(step, ctx, st, rec) {
  const p = await flowResolve(step, ctx);
  switch (step.type) {
    case 'tool': {
      const name = String(p.tool || '');
      if (name === 'ritual' || name === 'flow') throw new Error('use a "flow" step (Run ritual) to run another ritual');
      if (!activeTools().some(t => t.function.name === name) && !/^mcp__/.test(name)) throw new Error(`the tool "${name}" is not available right now`);
      let r = await runTool(name, p.args && typeof p.args === 'object' ? p.args : {}, null);
      if (p.parse && typeof r === 'string') { try { r = JSON.parse(r); } catch { const m = /[\[{][\s\S]*[\]}]/.exec(r); if (!m) throw new Error('the result is not JSON'); r = JSON.parse(m[0]); } }
      return r;
    }
    case 'js': {
      const r = await runNodeScript({ code: String(p.code || ''), argv: [`/flow/${st.flow.name}`], globals: flowCtxView(ctx), timeoutMs: Math.min(600, Math.max(1, +p.timeout || 60)) * 1000, signal: st.signal, depth: st.depth, via: 'flow' });
      const text = r.out.map(x => x[1]).join(''); const errText = r.out.filter(x => x[0] === 'e').map(x => x[1]).join('').split('\n').filter(l => !/^\s+at\s/.test(l)).join('\n').trim();
      if (text.trim()) rec.log = redactSecrets(text).slice(-3000);
      if (r.code !== 0) throw new Error((errText || `exit code ${r.code}`).slice(-800));
      return r.ret !== undefined ? r.ret : r.out.some(x => x[0] === 'o') ? r.out.filter(x => x[0] === 'o').map(x => x[1]).join('').replace(/\n$/, '') : ctx.$json;
    }
    case 'shell': {
      const r = await runShellLine(p.command, { timeoutMs: Math.min(600, Math.max(1, +p.timeout || 60)) * 1000, cwd: p.cwd || '/', echo: 'flow' });
      rec.log = redactSecrets(r.out + r.err).slice(-3000);
      if (r.code !== 0 && !p.allowFail) throw new Error(`exit ${r.code}${(r.err || r.out).trim() ? ': ' + (r.err || r.out).trim().slice(-500) : ''}`);
      return { code: r.code, stdout: r.out, stderr: r.err };
    }
    case 'decide': return await decideData({ state: p.state, question: p.question, type: p.kind || 'choice', options: flowLines(p.options) });
    case 'llm': return await askOnce(typeof p.prompt === 'string' ? p.prompt : JSON.stringify(p.prompt), { system: p.system, json: !!p.json });
    case 'agent': { if ((st.depth || 0) > 0 && running) throw new Error('Jade is busy'); return await runAgentPrompt(typeof p.prompt === 'string' ? p.prompt : JSON.stringify(p.prompt), { chat: p.chat === 'same' ? 'same' : 'new', key: `flow:${st.flow.name}:${step.id || ''}`, title: `⚙ ${st.flow.name}` }); }
    case 'note': return flowNoteOp(p);
    case 'set': { const f = p.fields && typeof p.fields === 'object' && !Array.isArray(p.fields) ? p.fields : {}; return p.keep && ctx.$json && typeof ctx.$json === 'object' && !Array.isArray(ctx.$json) ? { ...ctx.$json, ...f } : f; }
    case 'if': { const ok = !!p.condition; rec.note = ok ? 'then' : 'else'; flowRunUi(st.run); const br = ok ? step.then : step.else; return Array.isArray(br) && br.length ? await flowSeqIn(br, ctx, st) : ctx.$json; }
    case 'switch': {
      const cases = Array.isArray(step.cases) ? step.cases : []; const i = cases.findIndex(c => flowMatch(c.match, p.value));
      rec.note = i >= 0 ? `case ${JSON.stringify(cases[i].match)}` : 'default'; flowRunUi(st.run);
      const br = i >= 0 ? cases[i].steps : step.default; return Array.isArray(br) && br.length ? await flowSeqIn(br, ctx, st) : ctx.$json;
    }
    case 'each': {
      let items = p.items;
      if (typeof items === 'string') items = items.split('\n').filter(s => s.trim());
      else if (items && typeof items === 'object' && !Array.isArray(items)) items = Object.entries(items).map(([key, value]) => ({ key, value }));
      if (!Array.isArray(items)) throw new Error('"items" must give a list');
      if (items.length > 1000) throw new Error(`too many items (${items.length}; at most 1000)`);
      const save = { $item: ctx.$item, $index: ctx.$index }, out = [];
      rec.note = `${items.length} item${items.length === 1 ? '' : 's'}`;
      try { for (let i = 0; i < items.length; i++) { ctx.$item = items[i]; ctx.$index = i; ctx.$json = items[i]; out.push(await flowSeqIn(step.steps || [], ctx, st)); } }
      finally { Object.assign(ctx, save); }
      return out;
    }
    case 'wait': { const end = Date.now() + Math.min(300, Math.max(0, +p.seconds || 0)) * 1000; while (Date.now() < end) { if (st.run.stop) throw new Error('stopped'); await sleep(Math.min(250, end - Date.now())); } return ctx.$json; }
    case 'notify': { const t = String(p.title ?? '') || st.flow.name; const b = p.body == null ? '' : typeof p.body === 'string' ? p.body : JSON.stringify(p.body); schedNotify(t, b); toast(`${esc(t)}${b ? ': ' + esc(b.slice(0, 140)) : ''}`, 'ok'); return ctx.$json; }
    case 'flow': {
      const sub = flowFind(p.flow); if (!sub) throw new Error(`no flow named "${p.flow}"`);
      if (st.depth + 1 > FLOW_MAX_DEPTH) throw new Error('flows call each other too deeply');
      const r = await flowRun(sub, p.input === undefined ? ctx.$json : p.input, { via: `flow:${st.flow.name}`, depth: st.depth + 1 });
      if (r.status !== 'ok') throw new Error(`flow "${sub.name}" ${r.status}: ${r.error}`);
      return r.output;
    }
    case 'stop': throw new FlowStop(p.value === undefined || p.value === '' ? ctx.$json : p.value);
  }
  throw new Error(`unknown step type ${step.type}`);
}
function flowNoteOp(p) {
  const act = p.action || 'read'; const raw = String(p.path ?? '').trim(); if (!raw) throw new Error('"path" is empty');
  if (act === 'read') { const r = vfs.isFile(vfs.norm(raw)) ? vfs.norm(raw) : resolveNote(raw, null); if (!r) throw new Error(`no note "${raw}"`); return vfs.read(r); }
  let full = vfs.isFile(vfs.norm(raw)) ? vfs.norm(raw) : (resolveNote(raw, null) || vfs.norm(raw.startsWith('/') ? raw : '/' + raw));
  if (!/\.[A-Za-z0-9]+$/.test(full)) full += '.md';
  const text = p.content == null ? '' : typeof p.content === 'string' ? p.content : JSON.stringify(p.content, null, 2);
  const prev = vfs.isFile(full) ? vfs.read(full) : '';
  if (act === 'write') vfs.write(full, text, { mkdirs: true });
  else if (act === 'append') vfs.write(full, prev + (prev && !prev.endsWith('\n') ? '\n' : '') + text + (text.endsWith('\n') ? '' : '\n'), { mkdirs: true });
  else if (act === 'prepend') { const head = prev.slice(0, prev.length - splitFrontmatter(prev).body.length); vfs.write(full, head + text + (text.endsWith('\n') ? '' : '\n') + prev.slice(head.length), { mkdirs: true }); }
  else throw new Error('action must be read, write, append or prepend');
  if (editing === full && typeof openFile === 'function' && !$('#fileEd').matches(':focus')) { try { $('#fileEd').value = vfs.read(full); if ($('#noteBody').dataset.mode !== 'edit') renderNotePreview(); } catch {} }
  return { path: full, bytes: vfs.nodes.get(full)?.data.length || 0 };
}

/* ---------- triggers: schedule, note change ---------- */
const FlowTrig = { next: new Map(), sig: new Map(), busy: new Set(), timer: 0, nt: 0, files: '' };
function flowTriggerText(f) {
  const tr = f.trigger || {}; const off = f.enabled === false ? ' · off' : '';
  if (tr.type === 'schedule') { let d = String(tr.when || ''); try { const sp = Cron.fromText(cronMacro(d)); if (sp.cron) d = Cron.describe(sp.cron); } catch {} const n = FlowTrig.next.get(f._path); return `⏰ ${d}${n && f.enabled !== false ? ' · next ' + relTime(n) : ''}${off}`; }
  if (tr.type === 'note') return `✎ when ${tr.path || '?'} changes${off}`;
  return 'Manual';
}
function flowWatchPath(spec) { const raw = String(spec || '').trim(); if (!raw) return ''; const n = vfs.norm(raw.startsWith('/') ? raw : '/' + raw); return vfs.exists(n) ? n : (resolveNote(raw, null) || n); }
function flowWatchSig(spec) {
  const p = flowWatchPath(spec); if (!p) return '';
  if (vfs.isDir(p)) { const pre = p === '/' ? '/' : p + '/'; const out = []; for (const [k, n] of vfs.nodes) if (!n.dir && k.startsWith(pre) && !k.startsWith(FLOW_DIR + '/') && k !== CRON_LOG) out.push(k + '\u0001' + n.mtime); return out.sort().join('\u0002'); }
  const n = vfs.nodes.get(p); return n && !n.dir ? p + '\u0001' + n.mtime : '';
}
function flowSigDiff(a, b) {
  const m = s => new Map(String(s || '').split('\u0002').filter(Boolean).map(x => x.split('\u0001')));
  const A = m(a), B = m(b);
  return { changed: [...B].filter(([k, v]) => A.get(k) !== v).map(([k]) => k), removed: [...A.keys()].filter(k => !B.has(k)) };
}
function flowsChanged() { FlowTrig.next.clear(); flowsArm(); if (document.body.dataset.screen === 'flows' && FUI.view === 'list') flowsRender(); }
function flowsArm() {
  const now = Date.now();
  for (const f of flowList()) {
    if (f._bad || f.enabled === false) continue;
    const tr = f.trigger || {};
    if (tr.type === 'schedule' && !FlowTrig.next.has(f._path)) { try { const sp = Cron.fromText(cronMacro(String(tr.when || ''))); FlowTrig.next.set(f._path, sp.cron ? Cron.next(sp.cron, now) : null); } catch { FlowTrig.next.set(f._path, null); } }
    if (tr.type === 'note' && !FlowTrig.sig.has(f._path)) FlowTrig.sig.set(f._path, flowWatchSig(tr.path));
  }
}
function flowFire(f, input, via) {
  if (FlowTrig.busy.has(f._path)) return null;
  FlowTrig.busy.add(f._path);
  return flowRun(f, input, { via }).then(run => { if (run.status !== 'ok') schedNotify(`Flow "${f.name}" failed`, String(run.error || '').slice(0, 180)); return run; })
    .finally(() => { FlowTrig.busy.delete(f._path); if (f.trigger?.type === 'note') FlowTrig.sig.set(f._path, flowWatchSig(f.trigger.path)); });
}
function flowTick() {
  const now = Date.now();
  for (const f of flowList()) {
    if (f._bad || f.enabled === false || f.trigger?.type !== 'schedule') continue;
    if (!FlowTrig.next.has(f._path)) { flowsArm(); continue; }
    const due = FlowTrig.next.get(f._path); if (!due || now < due) continue;
    try { FlowTrig.next.set(f._path, Cron.next(Cron.fromText(cronMacro(String(f.trigger.when))).cron, now)); } catch { FlowTrig.next.set(f._path, null); }
    flowFire(f, { trigger: 'schedule', at: new Date(due).toISOString() }, 'schedule');
  }
}
function flowNoteCheck() {
  const sig = flowFiles().map(p => p + ':' + vfs.nodes.get(p)?.mtime).join('|');
  if (sig !== FlowTrig.files) { FlowTrig.files = sig; flowsChanged(); }
  for (const f of flowList()) {
    if (f._bad || f.enabled === false || f.trigger?.type !== 'note' || FlowTrig.busy.has(f._path)) continue;
    const now = flowWatchSig(f.trigger.path), old = FlowTrig.sig.get(f._path);
    if (old === undefined) { FlowTrig.sig.set(f._path, now); continue; }
    if (now === old) continue;
    FlowTrig.sig.set(f._path, now);
    const d = flowSigDiff(old, now); if (!d.changed.length && !d.removed.length) continue;
    const path = flowWatchPath(f.trigger.path); const input = { trigger: 'note', path, changed: d.changed, removed: d.removed };
    if (vfs.isFile(path) && isNote(path)) { try { input.content = vfs.read(path).slice(0, 50000); } catch {} }
    flowFire(f, input, 'note');
  }
}
function flowsInit() {
  flowRecordsLoad().then(() => { if (document.body.dataset.screen === 'flows') flowsRender(); });
  FlowTrig.files = flowFiles().map(p => p + ':' + vfs.nodes.get(p)?.mtime).join('|');
  flowsArm();
  clearInterval(FlowTrig.timer); FlowTrig.timer = setInterval(flowTick, 15000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) flowTick(); });
  vfs.listeners.add(() => { clearTimeout(FlowTrig.nt); FlowTrig.nt = setTimeout(flowNoteCheck, 3000); });
}

/* ---------- her ritual tool (Jade Vault called it flow: calls to flow still work) ---------- */
const FLOW_TOOL_DEFS = [{ name: 'ritual', description: 'Rituals: automations (like n8n flows), a list of steps that run in order — your tools, JavaScript, shell commands, Ollaya decisions, AI answers, a full chat turn of yours, leaves (notes), if / switch / for-each, wait, notify, other rituals. A ritual runs by hand, on a schedule, when a leaf changes, from the shell (ritual run), from scripts (pandora.ritual) or over the API. Actions: help (the JSON format and every step type: read it before you create or change a ritual), list, get, create, update, delete, run, runs, enable, disable.',
  parameters: { type: 'object', properties: {
    action: { type: 'string', enum: ['help', 'list', 'get', 'create', 'update', 'delete', 'run', 'runs', 'enable', 'disable'] },
    name: { type: 'string', description: 'The ritual\'s name (get, update, delete, run, runs, enable, disable)' },
    ritual: { type: 'object', description: 'create / update: the whole ritual as JSON (see help). update replaces the ritual; to rename, give the new name here and the old one in "name"' },
    input: { type: 'object', description: 'run: input data for the ritual (it is $input and the first $json)' },
    limit: { type: 'number', description: 'runs: how many (default 10)' } }, required: ['action'] } }];
function flowHelp() {
  const types = Object.entries(FLOW_TYPES).map(([k, T]) => `- ${k} (${T.label}): ${T.help}\n  fields: ${T.fields.map(([f, , kind, ph, req]) => `${f}${req ? '*' : ''}${kind.startsWith('sel:') ? ' = ' + kind.slice(4) : kind === 'bool' ? ' (true/false)' : kind === 'num' ? ' (number)' : kind === 'json' ? ' (JSON)' : kind === 'expr' ? ' (JavaScript expression)' : ''}`).join(', ')}${T.branches ? `; nested step lists: ${T.branches.map(b => b[0]).join(', ')}` : ''}${T.cases ? '; cases: [{"match": value or [values], "steps": [...]}], default: [steps]' : ''}`).join('\n');
  return `A flow is JSON:
{"name": "Inbox triage", "description": "…", "enabled": true,
 "trigger": {"type": "manual"} | {"type": "schedule", "when": "every weekday at 9am" or "0 9 * * 1-5"} | {"type": "note", "path": "/Inbox.md" (a note or a folder)},
 "vars": {"key": "value"}, "timeout": 600,
 "steps": [ {"id": "s1", "type": "…", "name": "Short name", …fields…, "onError": "stop"|"continue", "retries": 0-3, "disabled": false}, … ]}
Steps run top to bottom; each step's output becomes $json for the next. The flow's output is the last step's output.
Expressions: any text field may contain {{ JavaScript }}. A field that is only one {{ }} keeps the value's type (object, number…); otherwise it is text.
Available: $json (previous output), $input (what the flow was started with), $node["Step name"] or $node.s1 (any earlier step's output), $vars, $item and $index (inside for-each), $now (ISO time), $today (YYYY-MM-DD), $flow.name, $run.via, and $date(format, date, days) e.g. $date("dddd D MMM", $now, 1).
"condition", "value" and "items" are plain JavaScript expressions (no braces). JavaScript steps get the same names as variables, plus fs, path, fetch and jade (jade.tool(name, args), jade.decide({...}), jade.ask(prompt), jade.flow(name, input), jade.shell(cmd), jade.kv.get/set) and return their output.
A note trigger starts the flow with {trigger, path, changed: [paths], removed: [paths], content} a few seconds after the note stops changing. A schedule trigger starts it with {trigger, at}.
Step types (* = required):
${types}
Errors: a failing step stops the flow, unless "onError": "continue" (its output is then {"error": "…"}). "agent" steps cannot run while you are in a chat turn, so do not run such flows with this tool; tell the user to run them from the Flows tab or a schedule.
Example:
{"name": "Daily digest", "trigger": {"type": "schedule", "when": "every day at 18:00"}, "steps": [
 {"type": "js", "name": "Changed today", "code": "const out = []; for (const f of fs.readdirSync('/', {recursive: true})) { const p = '/' + f; if (p.endsWith('.md') && fs.statSync(p).mtimeMs > Date.now() - 864e5) out.push(p); } return out;"},
 {"type": "if", "condition": "$json.length > 0", "else": [{"type": "stop", "value": "nothing changed"}]},
 {"type": "llm", "name": "Summary", "prompt": "Summarise what changed today in these notes, one line each:\\n{{ $json.join('\\\\n') }}"},
 {"type": "note", "action": "append", "path": "/Journal/Digest.md", "content": "## {{ $today }}\\n{{ $json }}"},
 {"type": "notify", "title": "Digest ready", "body": "{{ $node['Summary'].slice(0, 120) }}"}]}`;
}
function flowRunText(run) {
  const lines = run.steps.map(s => `${s.status === 'ok' ? '✓' : s.status === 'skipped' ? '–' : s.status === 'error' ? '✗' : '…'} ${s.name} (${s.type}${s.note ? ', ' + s.note : ''}, ${s.ms} ms)${s.error ? ': ' + s.error : ''}`);
  let out = run.output; try { out = typeof out === 'string' ? out : JSON.stringify(out, null, 1); } catch {}
  out = String(out ?? 'null'); if (out.length > 4000) out = out.slice(0, 4000) + `… [${out.length - 4000} more characters]`;
  return `Flow "${run.flow}" ${run.status}${run.error ? ': ' + run.error : ''} in ${((run.ended - run.started) / 1000).toFixed(1)} s\n${lines.join('\n')}\nOutput: ${out}`;
}
async function flowTool(a = {}) {
  const act = String(a.action || 'list');
  if (a.ritual !== undefined && a.flow === undefined) a = { ...a, flow: a.ritual };   // the ritual tool's word for it
  const get = () => { const f = flowFind(a.name ?? a.flow?.name); if (!f) throw new Error(`no flow named "${a.name ?? ''}". Use action list.`); return f; };
  const parseFlow = () => { let f = a.flow; if (typeof f === 'string') { try { f = JSON.parse(f); } catch (e) { throw new Error('"flow" is not valid JSON: ' + e.message); } } if (!f || typeof f !== 'object') throw new Error('give the whole flow in "flow" (see action help)'); return f; };
  if (act === 'help') return flowHelp();
  if (act === 'list') { await flowRecordsLoad(); const all = flowList(); if (!all.length) return 'No flows yet. Use action help, then create.'; return all.map(f => { const last = FlowRuns.recent.find(r => r.path === f._path); return `- ${f.name}${f.enabled === false ? ' (off)' : ''}: ${f._bad ? 'INVALID: ' + f._bad : flowTriggerText(f)} · ${(f.steps || []).length} steps${f.description ? ' · ' + f.description : ''}${last ? ` · last run ${last.status} ${relTime(last.started)}` : ''}`; }).join('\n'); }
  if (act === 'get') { const f = get(); return JSON.stringify(flowClean(f), null, 2); }
  if (act === 'create') {
    const f = parseFlow(); const errs = flowValidate(f); if (errs.length) throw new Error('not saved, fix these:\n- ' + errs.join('\n- '));
    if (flowFind(f.name)) throw new Error(`a flow named "${f.name}" already exists: use update`);
    const s = flowSave(f); return `Created flow "${s.name}" (${s._path}) with ${flowCount(s.steps)} steps. Trigger: ${flowTriggerText(s)}. The user can see and edit it in the Flows tab.`;
  }
  if (act === 'update') {
    const old = get(); const f = parseFlow(); if (!f.name) f.name = old.name;
    const errs = flowValidate(f); if (errs.length) throw new Error('not saved, fix these:\n- ' + errs.join('\n- '));
    const clash = flowFind(f.name); if (clash && clash._path !== old._path) throw new Error(`another flow is already named "${f.name}"`);
    const s = flowSave(f, old._path); return `Updated flow "${s.name}" (${flowCount(s.steps)} steps). Trigger: ${flowTriggerText(s)}.`;
  }
  if (act === 'delete') { const f = get(); flowDelete(f); return `Deleted flow "${f.name}".`; }
  if (act === 'enable' || act === 'disable') { const f = get(); f.enabled = act === 'enable'; flowSave(f, f._path); return `${f.name} is ${act}d.`; }
  if (act === 'run') { const f = get(); if (flowHasAgent(f.steps)) throw new Error('this flow has a Jade agent step, which cannot run inside your chat turn. Ask the user to run it from the Flows tab.'); const run = await flowRun(f, a.input ?? null, { via: 'jade' }); return flowRunText(run); }
  if (act === 'runs') { await flowRecordsLoad(); const f = a.name ? get() : null; const list = FlowRuns.recent.filter(r => !f || r.path === f._path).slice(0, Math.min(50, +a.limit || 10)); return list.length ? list.map(r => `${new Date(r.started).toLocaleString()} ${r.flow}: ${r.status}${r.error ? ' (' + r.error.slice(0, 160) + ')' : ''} via ${r.via}, ${((r.ended - r.started) / 1000).toFixed(1)} s`).join('\n') : 'No runs yet.'; }
  throw new Error(`unknown action ${act}`);
}
function flowCount(steps) { let n = 0; flowWalk(steps, () => n++); return n; }
function flowHasAgent(steps) { let y = false; flowWalk(steps, st => { if (st?.type === 'agent' && !st.disabled) y = true; }); return y; }

/* ---------- examples ---------- */
const FLOW_EXAMPLES = [
  { name: 'Blank flow', steps: [] },
  { name: 'Inbox triage', description: 'Sorts each line of Inbox.md with the model and files urgent ones', trigger: { type: 'manual' }, steps: [
    { type: 'note', name: 'Inbox', action: 'read', path: '/Inbox.md' },
    { type: 'each', name: 'Each line', items: '$json.split("\\n").filter(l => /^\\s*[-*] /.test(l)).map(l => l.replace(/^\\s*[-*]\\s+/, ""))', steps: [
      { type: 'llm', name: 'Classify', prompt: 'Is this inbox item urgent, normal or someday? Reply with one word.\n\n{{ $item }}' },
      { type: 'if', name: 'Urgent?', condition: '/urgent/i.test($json)', then: [{ type: 'note', name: 'File it', action: 'append', path: '/Urgent.md', content: '- [ ] {{ $item }}' }] }] },
    { type: 'notify', name: 'Done', title: 'Inbox triaged', body: '{{ $node["Each line"].length }} items checked' }] },
  { name: 'Daily digest', description: 'Every evening: what changed today, summarised into a note', trigger: { type: 'schedule', when: 'every day at 18:00' }, enabled: false, steps: [
    { type: 'js', name: 'Changed today', code: "const out = [];\nfor (const f of fs.readdirSync('/', { recursive: true })) {\n  const p = '/' + f;\n  if (p.endsWith('.md') && !p.startsWith('/Pandora/') && fs.statSync(p).mtimeMs > Date.now() - 864e5) out.push(p);\n}\nreturn out;" },
    { type: 'if', name: 'Anything?', condition: '$json.length > 0', else: [{ type: 'stop', value: 'nothing changed today' }] },
    { type: 'llm', name: 'Summary', prompt: 'In 3-6 bullets, what did I work on today? These notes changed:\n{{ $json.join("\\n") }}' },
    { type: 'note', name: 'Save', action: 'append', path: '/Journal/Digest.md', content: '## {{ $today }}\n{{ $json }}\n' }] },
  { name: 'Urgent check', description: 'Ollaya decides if a message is urgent; urgent ones notify you', trigger: { type: 'manual' }, steps: [
    { type: 'decide', name: 'Urgent?', state: '{{ typeof $input === "string" ? $input : JSON.stringify($input) }}', question: 'Does this need the user\'s attention today?', kind: 'yesno' },
    { type: 'if', name: 'Notify?', condition: '$json.result === true || $json.result === "yes"', then: [{ type: 'notify', title: 'Needs you today', body: '{{ $input }}' }] }] },
  { name: 'Folder backup', description: 'Copies /projects into a dated folder every night', trigger: { type: 'schedule', when: '@daily' }, enabled: false, steps: [
    { type: 'shell', name: 'Copy', command: 'mkdir -p /Backups && cp -r /projects /Backups/projects-$(date +%Y-%m-%d) && ls /Backups' }] },
  { name: 'When Inbox changes', description: 'Runs a few seconds after you edit Inbox.md', trigger: { type: 'note', path: '/Inbox.md' }, enabled: false, steps: [
    { type: 'set', name: 'Count', fields: { lines: '{{ $json.content.split("\\n").filter(l => /^\\s*[-*] /.test(l)).length }}', path: '{{ $json.path }}' } },
    { type: 'notify', title: 'Inbox changed', body: '{{ $json.lines }} items in {{ $json.path }}' }] },
];

/* =====================================================================
   FLOWS TAB
   ===================================================================== */
const FUI = { view: 'list', flow: null, path: null, dirty: false, mode: 'steps', open: new Set(), runId: null, bad: new Map(), rt: 0 };
const flowsPanel = () => $('#flowsPanel');
function flowsBadge() { const b = $('#flowBadge'); if (!b) return; const n = FlowRuns.active.size; b.hidden = !n; b.textContent = n; }
function flowRunUi(run, final) {
  if (FUI.view !== 'run' || FUI.runId !== run.id) return;
  clearTimeout(FUI.rt); if (final) flowsRender(); else FUI.rt = setTimeout(flowsRender, 120);
}
function flowsRender() {
  const el = flowsPanel(); if (!el) return;
  const st = el.parentElement?.scrollTop || 0;
  el.innerHTML = FUI.view === 'edit' ? flowEdHtml() : FUI.view === 'run' ? flowRunHtml() : flowListHtml();
  if (FUI.view === 'edit') flowEdSync();
  if (el.parentElement && FUI.keepScroll) el.parentElement.scrollTop = st; FUI.keepScroll = false;
}
const fStatus = s => `<span class="fl-st fl-st-${esc(s)}">${s === 'ok' ? '✓ ok' : s === 'error' ? '✗ error' : s === 'running' ? '● running' : s === 'stopped' ? '■ stopped' : s === 'skipped' ? '– skipped' : esc(s)}</span>`;
function flowListHtml() {
  const all = flowList(); const recent = FlowRuns.recent.slice(0, 8);
  const active = [...FlowRuns.active.values()];
  return `<div class="flex items-center justify-between gap-2"><div class="pane-h">Flows</div><div class="flex gap-1"><button class="btn btn-ghost" data-fa="ask">Ask Jade</button><button class="btn btn-solid cut cut-sm" data-fa="new">+ New</button></div></div>
  <p class="hint leading-relaxed">Chains of steps: Jade's tools, JavaScript, shell commands, decisions, AI and logic. Start them here, on a schedule, when a note changes, from the shell (<span class="mono text-cy">flow run Name</span>), from scripts (<span class="mono text-cy">jade.flow()</span>) or over the API. Saved as JSON in <span class="mono">${FLOW_DIR}</span>.</p>
  <div class="fl-new" id="flNew" hidden><div class="lbl">Start from</div>${FLOW_EXAMPLES.map((x, i) => `<button type="button" class="fl-ex" data-fa="example" data-i="${i}"><b>${esc(x.name)}</b>${x.description ? `<span>${esc(x.description)}</span>` : ''}</button>`).join('')}</div>
  ${active.length ? `<div class="fl-active">${active.map(r => `<button type="button" class="fl-runrow" data-fa="openrun" data-id="${r.id}">${fStatus('running')} <b>${esc(r.flow)}</b> <span class="hint">${r.steps.length} steps so far</span></button>`).join('')}</div>` : ''}
  <div class="flex flex-col gap-2" id="flCards">${all.length ? all.map(f => {
    const last = FlowRuns.recent.find(r => r.path === f._path);
    return `<div class="sched-card fl-card ${f.enabled === false ? 'off' : ''}" data-path="${esc(f._path)}">
      <div class="flex items-center gap-2"><span class="sched-name flex-1 min-w-0 truncate">${esc(f.name)}</span>${f.trigger?.type && f.trigger.type !== 'manual' ? `<label class="sched-switch" title="${f.enabled === false ? 'Off: tap to turn on' : 'On: tap to turn off'}"><input type="checkbox" data-fa="toggle" ${f.enabled === false ? '' : 'checked'} aria-label="Enable ${esc(f.name)}"><span></span></label>` : ''}</div>
      <div class="mono text-[11.5px] text-cy">${f._bad ? '<span class="text-rd">invalid JSON: ' + esc(f._bad) + '</span>' : esc(flowTriggerText(f))}</div>
      ${f.description ? `<div class="sched-prompt">${esc(f.description)}</div>` : ''}
      <div class="hud">${flowCount(f.steps)} step${flowCount(f.steps) === 1 ? '' : 's'} · ${last ? `last ${fStatus(last.status)} ${esc(relTime(last.started))}` : 'never run'}</div>
      <div class="flex gap-1 flex-wrap"><button class="btn btn-ghost" data-fa="run">Run</button><button class="btn btn-ghost" data-fa="edit">Edit</button><button class="btn btn-ghost" data-fa="dup">Duplicate</button><button class="btn btn-ghost" data-fa="del">Delete</button></div>
    </div>`; }).join('') : `<div class="text-sm text-dim leading-relaxed border border-dashed border-line p-4">No flows yet. Press <b class="text-yl">+ New</b> to start from an example, or ask Jade: <span class="mono text-cy">build a flow that summarises my inbox every morning</span>.</div>`}</div>
  ${recent.length ? `<div class="pane-h mt-2">Recent runs</div><div class="flex flex-col">${recent.map(r => `<button type="button" class="fl-runrow" data-fa="openrun" data-id="${r.id}">${fStatus(r.status)} <b>${esc(r.flow)}</b> <span class="hint">${esc(relTime(r.started))} · ${((r.ended - r.started) / 1000).toFixed(1)} s · ${esc(r.via)}</span></button>`).join('')}</div>` : ''}`;
}
function flowRunHtml() {
  const run = FlowRuns.active.get(FUI.runId) || FlowRuns.recent.find(r => r.id === FUI.runId);
  if (!run) return `<div><button class="btn btn-ghost" data-fa="back">← Flows</button></div><p class="hint">That run is gone.</p>`;
  const show = v => { let s; try { s = typeof v === 'string' ? v : JSON.stringify(v, null, 2); } catch { s = String(v); } return esc(s ?? 'null'); };
  const live = run.status === 'running';
  return `<div class="flex items-center gap-2"><button class="btn btn-ghost" data-fa="back">← Flows</button><div class="sched-name flex-1 min-w-0 truncate">${esc(run.flow)}</div>${live ? '<button class="btn btn-red" data-fa="stop">Stop</button>' : ''}${run.path && vfs.isFile(run.path) ? '<button class="btn btn-ghost" data-fa="editrun">Edit</button>' : ''}</div>
  <div class="hud">${fStatus(run.status)} · ${live ? 'running for ' + ((Date.now() - run.started) / 1000).toFixed(0) + ' s' : ((run.ended - run.started) / 1000).toFixed(2) + ' s'} · via ${esc(run.via)} · ${esc(new Date(run.started).toLocaleString())}</div>
  ${run.error ? `<div class="fl-err">${esc(run.error)}</div>` : ''}
  ${run.input != null ? `<details class="fl-io"><summary>Input</summary><pre>${show(run.input)}</pre></details>` : ''}
  <div class="pane-h mt-1">Steps</div>
  <div class="flex flex-col gap-1">${run.steps.length ? run.steps.map(s => `<details class="fl-srow ${s.status === 'error' ? 'bad' : ''}" style="margin-left:${Math.min(5, s.depth || 0) * 14}px"><summary>${fStatus(s.status)} <b>${esc(s.name)}</b> <span class="hint">${esc(FLOW_TYPES[s.type]?.label || s.type)}${s.ms ? ' · ' + s.ms + ' ms' : ''}${s.note ? ' · ' + esc(s.note) : ''}</span></summary>
    ${s.error ? `<div class="fl-err">${esc(s.error)}</div>` : ''}<div class="lbl">In</div><pre>${show(s.input)}</pre>${s.status !== 'running' ? `<div class="lbl">Out</div><pre>${show(s.output)}</pre>` : ''}${s.log ? `<div class="lbl">Log</div><pre>${esc(s.log)}</pre>` : ''}</details>`).join('') : '<p class="hint">No steps ran.</p>'}</div>
  ${!live ? `<div class="pane-h mt-2">Output</div><pre class="fl-out">${show(run.output)}</pre>` : ''}`;
}

/* ---------- editor ---------- */
const pathGet = (o, p) => String(p).split('.').filter(Boolean).reduce((x, k) => x == null ? undefined : x[k], o);
function pathSet(o, p, v) { const ks = String(p).split('.'); let x = o; for (const k of ks.slice(0, -1)) { if (x[k] == null || typeof x[k] !== 'object') x[k] = {}; x = x[k]; } const last = ks.at(-1); if (v === undefined) delete x[last]; else x[last] = v; }
function flowEdOpen(f, path) { FUI.flow = JSON.parse(JSON.stringify(flowClean(f))); FUI.path = path || null; FUI.dirty = !path; FUI.view = 'edit'; FUI.mode = 'steps'; FUI.open = new Set(); FUI.bad = new Map(); FUI.keepScroll = false; flowsRender(); flowsPanel()?.parentElement?.scrollTo?.(0, 0); }
function flowEdHtml() {
  const f = FUI.flow; const tr = f.trigger || { type: 'manual' };
  const head = `<div class="flex items-center gap-2"><button class="btn btn-ghost" data-fa="back" id="flBack">← Flows</button><input class="field fl-title flex-1 min-w-0" data-f="name" value="${esc(f.name || '')}" placeholder="Flow name" aria-label="Flow name"><button class="btn btn-solid cut cut-sm" data-fa="save">Save</button></div>
  <div class="flex items-center gap-2 flex-wrap"><div class="seg" role="group" aria-label="Editor"><button data-fa="mode" data-m="steps" aria-pressed="${FUI.mode === 'steps'}">Steps</button><button data-fa="mode" data-m="json" aria-pressed="${FUI.mode === 'json'}">JSON</button></div><span class="hint flex-1" id="flDirty">${FUI.dirty ? 'unsaved changes' : FUI.path ? esc(FUI.path) : ''}</span><button class="btn" data-fa="testrun">Run</button></div>
  <div class="fl-errs" id="flErrs" hidden></div>`;
  if (FUI.mode === 'json') return head + `<textarea class="field mono fl-json" id="flJson" rows="22" spellcheck="false" autocapitalize="off">${esc(JSON.stringify(flowClean(f), null, 2))}</textarea><div class="flex justify-end"><button class="btn" data-fa="applyjson">Apply JSON</button></div>`;
  return head + `
  <div><label class="lbl" for="flDesc">Description</label><input id="flDesc" class="field mt-1" data-f="description" value="${esc(f.description || '')}" placeholder="What it does"></div>
  <div class="sched-row">
    <div><label class="lbl" for="flTrig">Starts</label><select id="flTrig" class="field mt-1" data-f="trigger.type"><option value="manual" ${tr.type === 'manual' || !tr.type ? 'selected' : ''}>By hand (and shell, scripts, API)</option><option value="schedule" ${tr.type === 'schedule' ? 'selected' : ''}>On a schedule</option><option value="note" ${tr.type === 'note' ? 'selected' : ''}>When a note or folder changes</option></select></div>
    <div data-show="schedule"><label class="lbl" for="flWhen">When</label><input id="flWhen" class="field mt-1 mono" data-f="trigger.when" value="${esc(tr.when || '')}" placeholder="every weekday at 9am · 0 9 * * 1-5 · @hourly" autocapitalize="off"></div>
    <div data-show="note"><label class="lbl" for="flPath">Note or folder</label><input id="flPath" class="field mt-1 mono" data-f="trigger.path" value="${esc(tr.path || '')}" placeholder="/Inbox.md or /projects" autocapitalize="off"></div>
  </div>
  <div class="mono text-[11.5px] text-yl" id="flTrigPv"></div>
  <label class="flex items-center gap-2 text-sm" data-show="schedule note"><input type="checkbox" class="accent-emerald-400 w-4 h-4" data-f="enabled" data-k="bool" ${f.enabled === false ? '' : 'checked'}> On (the trigger fires only while this is on and the app is open)</label>
  <details class="fl-io"><summary>Variables ($vars) and time limit</summary><div class="flex flex-col gap-2 mt-2"><textarea class="field mono" rows="3" data-f="vars" data-k="json" placeholder='{"folder": "/projects"}'>${esc(f.vars ? JSON.stringify(f.vars, null, 2) : '')}</textarea><div><label class="lbl">Time limit (seconds, default 600)</label><input class="field mt-1" type="number" min="5" max="3600" data-f="timeout" data-k="num" value="${esc(f.timeout ?? '')}"></div></div></details>
  <div class="pane-h mt-1">Steps</div>
  ${flowStepsHtml(f.steps || [], 'steps')}
  <div class="flex gap-2 flex-wrap mt-1"><button class="btn" data-fa="testrun">Run</button><button class="btn btn-ghost" data-fa="runinput">Run with input…</button><span class="flex-1"></span>${FUI.path ? '<button class="btn btn-ghost" data-fa="delete">Delete flow</button>' : ''}</div>`;
}
const flowAddSel = arr => `<select class="field fl-add" data-fa="add" data-arr="${arr}" aria-label="Add a step"><option value="">+ Add step…</option>${Object.entries(FLOW_TYPES).map(([k, T]) => `<option value="${k}">${T.icon} ${esc(T.label)}</option>`).join('')}</select>`;
function flowStepsHtml(steps, arr) { return `<div class="fl-list" data-arr="${arr}">${steps.map((st, i) => flowStepHtml(st, `${arr}.${i}`, i, steps.length)).join('')}${flowAddSel(arr)}</div>`; }
function flowSummary(st) {
  const s = v => String(v ?? '').replace(/\s+/g, ' ').slice(0, 60);
  switch (st.type) { case 'tool': return st.tool || ''; case 'js': return s(String(st.code || '').split('\n').find(l => l.trim() && !l.trim().startsWith('//'))); case 'shell': return '$ ' + s(st.command); case 'decide': return s(st.question); case 'llm': case 'agent': return s(st.prompt); case 'note': return `${st.action || 'read'} ${s(st.path)}`; case 'if': return s(st.condition); case 'switch': return s(st.value); case 'each': return s(st.items); case 'wait': return `${st.seconds || 0} s`; case 'notify': return s(st.title || st.body); case 'flow': return s(st.flow); case 'set': return s(Object.keys(st.fields || {}).join(', ')); default: return ''; }
}
function flowFieldHtml(st, sp, [k, label, kind, ph]) {
  const v = st[k]; const id = `fl_${sp.replace(/\./g, '_')}_${k}`; const tip = kind === 'tpl' || kind === 'area' || kind === 'json' ? ' fl-tpl' : '';
  if (kind === 'bool') return `<label class="flex items-center gap-2 text-sm"><input type="checkbox" class="accent-emerald-400 w-4 h-4" data-f="${k}" data-k="bool" ${v ? 'checked' : ''}> ${esc(label)}</label>`;
  let input;
  if (kind.startsWith('sel:')) input = `<select id="${id}" class="field mt-1" data-f="${k}">${kind.slice(4).split('|').map(o => `<option ${String(v ?? kind.slice(4).split('|')[0]) === o ? 'selected' : ''}>${o}</option>`).join('')}</select>`;
  else if (kind === 'tool') { const names = flowToolNames(); input = `<select id="${id}" class="field mt-1" data-f="${k}"><option value="">choose a tool…</option>${names.map(n => `<option ${v === n ? 'selected' : ''}>${esc(n)}</option>`).join('')}${v && !names.includes(v) ? `<option selected>${esc(v)}</option>` : ''}</select><div class="hint mt-1 fl-tooldesc">${esc(flowToolDesc(v))}</div>`; }
  else if (kind === 'flowsel') { const names = flowList().filter(x => !x._bad && x.name !== FUI.flow?.name).map(x => x.name); input = `<select id="${id}" class="field mt-1" data-f="${k}"><option value="">choose a flow…</option>${names.map(n => `<option ${v === n ? 'selected' : ''}>${esc(n)}</option>`).join('')}${v && !names.includes(v) ? `<option selected>${esc(v)}</option>` : ''}</select>`; }
  else if (kind === 'json') { const raw = FUI.bad.get(sp + '.' + k) ?? (v == null ? '' : typeof v === 'string' ? v : JSON.stringify(v, null, 2)); input = `<textarea id="${id}" class="field mt-1 mono${FUI.bad.has(sp + '.' + k) ? ' bad' : ''}" rows="${Math.min(10, Math.max(2, raw.split('\n').length))}" data-f="${k}" data-k="json" spellcheck="false" autocapitalize="off" placeholder="${esc(ph || '')}">${esc(raw)}</textarea>`; }
  else if (kind === 'lines') input = `<textarea id="${id}" class="field mt-1" rows="3" data-f="${k}" data-k="lines" placeholder="${esc(ph || '')}">${esc(Array.isArray(v) ? v.join('\n') : v ?? '')}</textarea>`;
  else if (kind === 'num') input = `<input id="${id}" type="number" class="field mt-1" data-f="${k}" data-k="num" value="${esc(v ?? '')}" placeholder="${esc(ph || '')}">`;
  else if (kind === 'area' || kind === 'code') input = `<textarea id="${id}" class="field mt-1${kind === 'code' ? ' mono' : ''}" rows="${kind === 'code' ? 8 : 3}" data-f="${k}" spellcheck="${kind === 'code' ? 'false' : 'true'}" autocapitalize="${kind === 'code' ? 'off' : 'sentences'}" placeholder="${esc(ph || '')}">${esc(v ?? '')}</textarea>`;
  else input = `<input id="${id}" class="field mt-1${kind === 'expr' ? ' mono' : ''}" data-f="${k}" value="${esc(v ?? '')}" placeholder="${esc(ph || '')}" autocapitalize="off" spellcheck="false">`;
  return `<div class="${tip}"><label class="lbl" for="${id}">${esc(label)}</label>${input}</div>`;
}
function flowToolDesc(name) { const t = TOOL_DEFS.find(x => x.name === name) || (typeof VEC_TOOL_DEFS !== 'undefined' ? VEC_TOOL_DEFS.find(x => x.name === name) : null) || (typeof DC_TOOL_DEFS !== 'undefined' ? DC_TOOL_DEFS.find(x => x.name === name) : null); if (!t) return name ? '' : 'Any of Jade\'s tools, with its arguments as JSON.'; const req = t.parameters?.required || []; return `${String(t.description || '').split(/(?<=\.)\s/)[0].slice(0, 160)}${Object.keys(t.parameters?.properties || {}).length ? ` Arguments: ${Object.keys(t.parameters.properties).map(p => req.includes(p) ? p + '*' : p).join(', ')}.` : ''}`; }
function flowStepHtml(st, sp, i, n) {
  const T = FLOW_TYPES[st?.type]; const open = FUI.open.has(sp);
  if (!T) return `<div class="fl-step bad" data-sp="${sp}"><div class="fl-step-h"><span class="fl-ico">?</span><span class="fl-sname">unknown step type "${esc(st?.type)}"</span><span class="fl-acts"><button type="button" data-fa="rm" aria-label="Remove">✕</button></span></div></div>`;
  let body = '';
  if (open) {
    body = `<div class="fl-step-b"><p class="hint leading-relaxed">${esc(T.help)}</p>
      <div><label class="lbl">Step name</label><input class="field mt-1" data-f="name" value="${esc(st.name || '')}" placeholder="${esc(T.label)} (names make $node['Name'] easy)"></div>
      ${T.fields.map(fd => flowFieldHtml(st, sp, fd)).join('')}
      ${T.branches ? T.branches.map(([k, lab]) => `<div class="fl-branch"><div class="fl-branch-h">${esc(lab)}</div>${flowStepsHtml(Array.isArray(st[k]) ? st[k] : [], `${sp}.${k}`)}</div>`).join('') : ''}
      ${T.cases ? `${(Array.isArray(st.cases) ? st.cases : []).map((c, j) => `<div class="fl-branch" data-cp="${sp}.cases.${j}"><div class="fl-branch-h flex items-center gap-2">When value is <input class="field mono flex-1" data-f="match" data-k="match" value="${esc(c.match === undefined ? '' : typeof c.match === 'string' ? c.match : JSON.stringify(c.match))}" placeholder="urgent"><button type="button" class="btn btn-ghost" data-fa="rmcase" aria-label="Remove case">✕</button></div>${flowStepsHtml(Array.isArray(c.steps) ? c.steps : [], `${sp}.cases.${j}.steps`)}</div>`).join('')}<button type="button" class="btn btn-ghost" data-fa="addcase">+ Case</button><div class="fl-branch"><div class="fl-branch-h">Default</div>${flowStepsHtml(Array.isArray(st.default) ? st.default : [], `${sp}.default`)}</div>` : ''}
      <div class="sched-row"><div><label class="lbl">If it fails</label><select class="field mt-1" data-f="onError"><option value="stop" ${st.onError !== 'continue' ? 'selected' : ''}>Stop the flow</option><option value="continue" ${st.onError === 'continue' ? 'selected' : ''}>Continue (output {error})</option></select></div>${['if', 'switch', 'each'].includes(st.type) ? '' : `<div><label class="lbl">Retries</label><select class="field mt-1" data-f="retries" data-k="num">${[0, 1, 2, 3].map(x => `<option ${(+st.retries || 0) === x ? 'selected' : ''}>${x}</option>`).join('')}</select></div>`}</div>
      <label class="flex items-center gap-2 text-sm"><input type="checkbox" class="accent-emerald-400 w-4 h-4" data-f="disabled" data-k="bool" ${st.disabled ? 'checked' : ''}> Skip this step</label>
    </div>`;
  }
  return `<div class="fl-step ${open ? 'open' : ''} ${st.disabled ? 'off' : ''}" data-sp="${sp}">
    <div class="fl-step-h" data-fa="toggle-step"><span class="fl-ico">${T.icon}</span><span class="fl-type">${esc(T.label)}</span><span class="fl-sname">${esc(st.name || flowSummary(st))}</span>
      <span class="fl-acts"><button type="button" data-fa="up" ${i === 0 ? 'disabled' : ''} aria-label="Move up">↑</button><button type="button" data-fa="down" ${i === n - 1 ? 'disabled' : ''} aria-label="Move down">↓</button><button type="button" data-fa="rm" aria-label="Remove step">✕</button></span></div>
    ${body}</div>`;
}
function flowEdSync() {
  if (FUI.view !== 'edit') return;
  const el = flowsPanel(); const tr = FUI.flow.trigger?.type || 'manual';
  el.querySelectorAll('[data-show]').forEach(x => { x.hidden = !x.dataset.show.split(' ').includes(tr); });
  const pv = $('#flTrigPv');
  if (pv) {
    pv.classList.remove('text-rd');
    if (tr === 'schedule') { try { const sp = Cron.fromText(cronMacro(String(FUI.flow.trigger.when || ''))); if (sp.once) throw new Error('a flow schedule must repeat'); pv.textContent = `${Cron.describe(sp.cron)} · next: ${Cron.upcoming(sp.cron, 3).map(clock).join(', ')}`; } catch (e) { pv.textContent = e.message; pv.classList.add('text-rd'); } }
    else if (tr === 'note') { const p = flowWatchPath(FUI.flow.trigger.path); pv.textContent = p ? `${vfs.isDir(p) ? 'Folder' : vfs.isFile(p) ? 'Note' : 'Not found yet'}: ${p} · starts a few seconds after it stops changing` : ''; }
    else pv.textContent = '';
  }
  const d = $('#flDirty'); if (d) d.textContent = FUI.dirty ? 'unsaved changes' : FUI.path || '';
}
function flowEdErrors(list) { const e = $('#flErrs'); if (!e) return; e.hidden = !list.length; e.innerHTML = list.length ? `<b>Fix before saving:</b><ul>${list.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''; }
function flowEdTarget(el) { const cp = el.closest('[data-cp]'); if (cp && el.dataset.k === 'match') return { obj: pathGet(FUI.flow, cp.dataset.cp), key: 'match', sp: cp.dataset.cp }; const s = el.closest('[data-sp]'); return s ? { obj: pathGet(FUI.flow, s.dataset.sp), key: el.dataset.f, sp: s.dataset.sp } : { obj: FUI.flow, key: el.dataset.f, sp: '' }; }
function flowEdInput(el) {
  const { obj, key, sp } = flowEdTarget(el); if (!obj || !key) return;
  const k = el.dataset.k; let v;
  if (k === 'bool') v = el.checked ? true : (key === 'enabled' ? false : undefined);
  else if (k === 'num') v = el.value === '' ? undefined : +el.value;
  else if (k === 'lines') v = el.value.split('\n').map(x => x.trim()).filter(Boolean);
  else if (k === 'json') {
    const raw = el.value.trim(); const id = (sp ? sp + '.' : '') + key;
    if (!raw) { FUI.bad.delete(id); el.classList.remove('bad'); v = undefined; }
    else if (raw.includes('{{') && !/^[\[{]/.test(raw)) { FUI.bad.delete(id); el.classList.remove('bad'); v = raw; }
    else { try { v = JSON.parse(raw); FUI.bad.delete(id); el.classList.remove('bad'); } catch { FUI.bad.set(id, el.value); el.classList.add('bad'); FUI.dirty = true; flowEdSync(); return; } }
  }
  else if (k === 'match') { const raw = el.value; try { v = /^[\[{"\d-]|^(true|false|null)$/.test(raw.trim()) ? JSON.parse(raw) : raw; } catch { v = raw; } }
  else v = el.value === '' && key !== 'name' ? undefined : el.value;
  if (key.includes('.')) pathSet(obj, key, v); else if (v === undefined) delete obj[key]; else obj[key] = v;
  FUI.dirty = true; flowEdSync();
  if (key === 'tool') { const t = el.closest('.fl-step-b')?.querySelector('.fl-tooldesc'); if (t) t.textContent = flowToolDesc(v); if (obj.args == null || !Object.keys(obj.args || {}).length) { const def = TOOL_DEFS.find(x => x.name === v); if (def?.parameters?.required?.length) { obj.args = Object.fromEntries(def.parameters.required.map(r => [r, ''])); FUI.keepScroll = true; flowsRender(); } } }
  if (sp && (key === 'name' || key === 'tool' || key === 'command' || key === 'prompt' || key === 'condition')) { const h = el.closest('.fl-step')?.querySelector(':scope > .fl-step-h .fl-sname'); if (h) h.textContent = obj.name || flowSummary(obj); }
}
function flowEdArr(arrPath) { let a = pathGet(FUI.flow, arrPath); if (!Array.isArray(a)) { a = []; pathSet(FUI.flow, arrPath, a); } return a; }
function flowEdNew(type) {
  const st = { type }; const T = FLOW_TYPES[type];
  for (const [k, , kind] of T.fields) if (kind.startsWith('sel:')) st[k] = kind.slice(4).split('|')[0];
  if (type === 'if') { st.then = []; st.else = []; } if (type === 'each') st.steps = []; if (type === 'switch') { st.cases = [{ match: '', steps: [] }]; st.default = []; }
  if (type === 'tool') st.args = {}; if (type === 'set') st.fields = {}; if (type === 'wait') st.seconds = 5;
  return st;
}
async function flowEdSave() {
  if (FUI.bad.size) { flowEdErrors([`fix the JSON in: ${[...FUI.bad.keys()].join(', ')}`]); return false; }
  const f = flowClean(FUI.flow); const errs = flowValidate(f);
  const clash = flowFind(f.name); if (clash && clash._path !== FUI.path) errs.push(`another flow is already named "${f.name}"`);
  if (errs.length) { flowEdErrors(errs); return false; }
  const saved = flowSave(f, FUI.path); FUI.path = saved._path; FUI.flow = JSON.parse(JSON.stringify(flowClean(saved))); FUI.dirty = false;
  flowEdErrors([]); toast(`Saved ${esc(saved.name)}`, 'ok'); flowEdSync(); return true;
}
async function flowStartRun(f, input) {
  const p = flowRun(f, input, { via: 'manual' });
  const id = [...FlowRuns.active.values()].find(r => r.flow === f.name && r.via === 'manual')?.id;
  if (id) { FUI.view = 'run'; FUI.runId = id; flowsRender(); }
  const run = await p; if (!id) { FUI.view = 'run'; FUI.runId = run.id; flowsRender(); }
  return run;
}
function flowsInitUi() {
  const el = flowsPanel(); if (!el) return;
  el.addEventListener('input', e => { if (FUI.view === 'edit' && e.target.matches('[data-f]') && e.target.type !== 'checkbox' && e.target.tagName !== 'SELECT') flowEdInput(e.target); });
  el.addEventListener('change', async e => {
    const t = e.target;
    if (t.matches('select[data-fa="add"]')) { const type = t.value; if (!type) return; const arr = flowEdArr(t.dataset.arr); arr.push(flowEdNew(type)); FUI.open.add(`${t.dataset.arr}.${arr.length - 1}`); FUI.dirty = true; FUI.keepScroll = true; flowsRender(); return; }
    if (t.matches('input[data-fa="toggle"]')) { const f = flowRead(t.closest('[data-path]').dataset.path); f.enabled = t.checked; flowSave(f, f._path); toast(`${esc(f.name)} ${t.checked ? 'on' : 'off'}`, 'ok'); return; }
    if (FUI.view === 'edit' && t.matches('[data-f]')) { flowEdInput(t); if (t.dataset.f === 'trigger.type') flowEdSync(); }
  });
  el.addEventListener('click', async e => {
    const b = e.target.closest('[data-fa]'); if (!b || b.tagName === 'SELECT' || (b.tagName === 'INPUT' && b.type === 'checkbox')) return;
    const a = b.dataset.fa; const card = b.closest('[data-path]');
    if (a === 'new') { const n = $('#flNew'); n.hidden = !n.hidden; return; }
    if (a === 'example') { const x = JSON.parse(JSON.stringify(FLOW_EXAMPLES[+b.dataset.i])); let name = x.name === 'Blank flow' ? 'New flow' : x.name, i = 2; while (flowFind(name)) name = `${x.name === 'Blank flow' ? 'New flow' : x.name} ${i++}`; x.name = name; x.trigger ||= { type: 'manual' }; flowEdOpen(x, null); return; }
    if (a === 'ask') { setTab('chat'); const inp = $('#input'); inp.value = 'Build me a flow that '; inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); try { autosize(); } catch {} return; }
    if (a === 'edit' && card) { const f = flowRead(card.dataset.path); if (f._bad) { openFile(f._path, { mode: 'edit' }); return; } flowEdOpen(f, f._path); return; }
    if (a === 'run' && card) { const f = flowRead(card.dataset.path); if (f._bad) { toast('That flow file is not valid JSON', 'err'); return; } flowStartRun(f, null); return; }
    if (a === 'dup' && card) { const f = flowRead(card.dataset.path); let name = f.name + ' copy', i = 2; while (flowFind(name)) name = `${f.name} copy ${i++}`; flowEdOpen({ ...flowClean(f), name }, null); return; }
    if (a === 'del' && card) { if (!b.classList.contains('armed')) { b.classList.add('armed'); b.textContent = 'Confirm'; setTimeout(() => { if (b.isConnected) { b.classList.remove('armed'); b.textContent = 'Delete'; } }, 3500); return; } const f = flowRead(card.dataset.path); flowDelete(f); toast(`Deleted ${esc(f.name)}`, 'ok'); return; }
    if (a === 'openrun') { FUI.view = 'run'; FUI.runId = b.dataset.id; flowsRender(); return; }
    if (a === 'stop') { const r = FlowRuns.active.get(FUI.runId); if (r) r.stop = true; return; }
    if (a === 'editrun') { const r = FlowRuns.recent.find(x => x.id === FUI.runId) || FlowRuns.active.get(FUI.runId); const f = r?.path && flowRead(r.path); if (f && !f._bad) flowEdOpen(f, f._path); return; }
    if (a === 'back') {
      if (FUI.view === 'edit' && FUI.dirty && !b.classList.contains('armed')) { b.classList.add('armed'); b.textContent = 'Discard changes?'; setTimeout(() => { if (b.isConnected) { b.classList.remove('armed'); b.textContent = '← Flows'; } }, 3500); return; }
      FUI.view = 'list'; FUI.flow = null; FUI.dirty = false; flowsRender(); return;
    }
    if (FUI.view !== 'edit') return;
    if (a === 'save') { await flowEdSave(); return; }
    if (a === 'mode') {
      const m = b.dataset.m; if (m === FUI.mode) return;
      if (FUI.mode === 'json') { try { FUI.flow = JSON.parse($('#flJson').value); FUI.bad = new Map(); FUI.dirty = true; } catch (err) { flowEdErrors(['the JSON is not valid: ' + err.message]); return; } }
      FUI.mode = m; flowsRender(); return;
    }
    if (a === 'applyjson') { try { FUI.flow = JSON.parse($('#flJson').value); FUI.bad = new Map(); FUI.dirty = true; const errs = flowValidate(FUI.flow); flowEdErrors(errs); if (!errs.length) toast('JSON applied: save to keep it', 'ok'); flowEdSync(); } catch (err) { flowEdErrors(['the JSON is not valid: ' + err.message]); } return; }
    if (a === 'testrun' || a === 'runinput') {
      let input = null;
      if (a === 'runinput') { const t = await jvDialog({ title: 'Run with input', message: 'JSON (or plain text) given to the flow as $input', def: '{}' }); if (t == null) return; try { input = JSON.parse(t); } catch { input = t; } }
      if (FUI.mode === 'json') { try { FUI.flow = JSON.parse($('#flJson').value); } catch (err) { flowEdErrors(['the JSON is not valid: ' + err.message]); return; } }
      if (FUI.dirty && !(await flowEdSave())) return;
      const f = flowFind(FUI.flow.name); if (f) flowStartRun(f, input); return;
    }
    if (a === 'delete') { if (!b.classList.contains('armed')) { b.classList.add('armed'); b.textContent = 'Tap again to delete'; setTimeout(() => { if (b.isConnected) { b.classList.remove('armed'); b.textContent = 'Delete flow'; } }, 3500); return; } const f = flowRead(FUI.path); flowDelete(f); FUI.view = 'list'; FUI.flow = null; toast(`Deleted ${esc(f.name)}`, 'ok'); flowsRender(); return; }
    const sEl = b.closest('[data-sp]'); const sp = sEl?.dataset.sp;
    if (a === 'toggle-step' && sp) { if (e.target.closest('.fl-acts')) return; FUI.open.has(sp) ? FUI.open.delete(sp) : FUI.open.add(sp); FUI.keepScroll = true; flowsRender(); return; }
    if ((a === 'up' || a === 'down' || a === 'rm') && sp) {
      const arrPath = sp.slice(0, sp.lastIndexOf('.')); const i = +sp.slice(sp.lastIndexOf('.') + 1); const arr = flowEdArr(arrPath);
      if (a === 'rm') { if (!b.classList.contains('armed')) { b.classList.add('armed'); b.textContent = '✕?'; setTimeout(() => { if (b.isConnected) { b.classList.remove('armed'); b.textContent = '✕'; } }, 3000); return; } arr.splice(i, 1); }
      else { const j = a === 'up' ? i - 1 : i + 1; if (j < 0 || j >= arr.length) return; [arr[i], arr[j]] = [arr[j], arr[i]]; }
      FUI.open = new Set(); FUI.dirty = true; FUI.keepScroll = true; flowsRender(); return;
    }
    if (a === 'addcase' && sp) { const st = pathGet(FUI.flow, sp); (st.cases ||= []).push({ match: '', steps: [] }); FUI.dirty = true; FUI.keepScroll = true; flowsRender(); return; }
    if (a === 'rmcase') { const cp = b.closest('[data-cp]').dataset.cp; const arr = flowEdArr(cp.slice(0, cp.lastIndexOf('.'))); arr.splice(+cp.slice(cp.lastIndexOf('.') + 1), 1); FUI.dirty = true; FUI.keepScroll = true; flowsRender(); return; }
  });
}
flowsInitUi();
