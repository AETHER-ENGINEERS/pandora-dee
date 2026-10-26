#!/usr/bin/env node
/* docs_tool.js — Jade's side of the "Jade Docs" app: search the docs (BM25), look pages up, and send answers, notes and
 * page edits to the app in exactly the format it expects, after checking them.
 *
 * Put it at /Jade/Tools/docs_tool.js and run it with node (the shell, a flow, or Jade's bash):
 *   node /Jade/Tools/docs_tool.js sync                          copy index.json and pages/*.md from the app into /Jade/Docs/
 *   node /Jade/Tools/docs_tool.js search "how does the skill router work" [level=3] [k=6]
 *   node /Jade/Tools/docs_tool.js page backup-system [section="The server"]
 *   node /Jade/Tools/docs_tool.js pending                       questions from the user that have no answer yet (with the best pages)
 *   node /Jade/Tools/docs_tool.js answer <ask id> text="…" [refs=a,b] [goto=page] [anchor=slug] [why="…"]
 *   node /Jade/Tools/docs_tool.js note <page> "text"
 *   node /Jade/Tools/docs_tool.js goto <page> [why="…"]
 * Options are key=value (this runtime's node does not pass --flags). In text="…" use single quotes or none for quotes inside.
 *   node /Jade/Tools/docs_tool.js validate '<payload json>' | @file.json      check only
 *   node /Jade/Tools/docs_tool.js send '<payload json>' | @file.json          check, then send
 * Everything prints plain text; a problem sets exit code 1 and says what to change.
 */
const APP = 'Jade Docs', DIR = '/Jade/Docs', fs = require('fs');
const TYPES = { ask: 0, answer: 1, msg: 1, note: 1, goto: 1, bookmark: 0, page: 1 };   // 1 = Jade may send it
const MAX = { answer: 3000, note: 1200, pageMd: 60000, title: 120 };
const STOP = new Set('a an and are as at be by for from has have how i in is it its of on or that the this to was what when where which who why will with you your do does can'.split(' '));
const stem = w => w.length > 4 ? w.replace(/(ing|edly|ed|es|s|ly)$/, '') : w.replace(/s$/, '');
const tok = s => (String(s).toLowerCase().match(/[a-z0-9_]+/g) || []).filter(w => w.length > 1 && !STOP.has(w)).map(stem);
const slug = s => String(s).toLowerCase().replace(/<[^>]+>/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const tool = async (name, args) => String(await jade.tool(name, args));
class Fail extends Error {}
const die = m => { throw new Fail(m); };
const put = (path, content) => jade.tool('write', { path, content });     // goes through the vault so folders are created and the file is committed

/* ---------- local copy of the docs ---------- */
function loadIndex() {
  if (!fs.existsSync(DIR + '/index.json')) die('No local copy yet. Run: node /Jade/Tools/docs_tool.js sync');
  return JSON.parse(fs.readFileSync(DIR + '/index.json', 'utf8'));
}
const pageText = id => { const p = DIR + '/pages/' + id + '.md'; return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null; };
async function sync() {
  const raw = await tool('apps', { action: 'source', app: APP, file: 'index.json' });
  let idx; try { idx = JSON.parse(raw.replace(/\n\[truncated[^\]]*\]\s*$/, '')); } catch (e) { die('Could not read index.json from the app "' + APP + '" (is it installed? apps action=list). ' + e.message); }
  await put(DIR + '/index.json', JSON.stringify(idx));
  let got = 0, same = 0; const old = fs.existsSync(DIR + '/sizes.json') ? JSON.parse(fs.readFileSync(DIR + '/sizes.json', 'utf8')) : {}, sizes = {};
  for (const p of idx.pages) {
    sizes[p.id] = p.bytes;
    if (old[p.id] === p.bytes && pageText(p.id) != null && old.__v === idx.built) { same++; continue; }
    const t = await tool('apps', { action: 'source', app: APP, file: 'pages/' + p.id + '.md' });
    await put(DIR + '/pages/' + p.id + '.md', t); got++;
  }
  sizes.__v = idx.built; await put(DIR + '/sizes.json', JSON.stringify(sizes));
  console.log(`Synced ${idx.count} pages (${got} fetched, ${same} unchanged), version ${idx.version}, built ${idx.built}.`);
}

/* ---------- BM25 (the same ranking the app uses) ---------- */
let CORPUS = null;
function corpus() {
  if (CORPUS) return CORPUS; const idx = loadIndex(), docs = [], df = new Map(); let total = 0;
  for (const p of idx.pages) {
    const md = pageText(p.id); if (md == null) continue;
    const secs = []; let cur = { h: '', anchor: '', lines: [] }, code = false;
    for (const l of md.split('\n')) { if (/^```/.test(l)) code = !code; const h = !code && /^(#{2,3})\s+(.*)$/.exec(l); if (h) { secs.push(cur); cur = { h: h[2].replace(/[`*]/g, ''), anchor: slug(h[2]), lines: [] }; } else cur.lines.push(l); }
    secs.push(cur);
    for (const s of secs) {
      const text = s.lines.join('\n'); if (!s.h && !text.trim()) continue; const tf = new Map(); let len = 0;
      const add = (str, w) => { for (const t of tok(str)) { tf.set(t, (tf.get(t) || 0) + w); len += w; } };
      add(p.title, 3); add((p.tags || []).join(' '), 2); add(s.h, 2.5); add(text, 1);
      docs.push({ page: p.id, title: p.title, level: p.level, h: s.h, anchor: s.anchor, text, tf, len, low: (p.title + ' ' + s.h + ' ' + text).toLowerCase() });
      total += len; for (const t of tf.keys()) df.set(t, (df.get(t) || 0) + 1);
    }
  }
  return CORPUS = { idx, docs, df, avg: total / Math.max(1, docs.length), vocab: [...df.keys()] };
}
function search(q, { level = 0, k = 8 } = {}) {
  const C = corpus(), qt = [...new Set(tok(q))], terms = [], N = C.docs.length;
  for (const t of qt) { if (C.df.has(t)) terms.push([t, 1]); if (t.length >= 3) for (const v of C.vocab) if (v !== t && v.startsWith(t)) terms.push([v, 0.5]); }
  const phrase = String(q).toLowerCase().trim(), out = [];
  for (const d of C.docs) {
    if (level && d.level !== level) continue; let sc = 0;
    for (const [t, w] of terms) { const f = d.tf.get(t); if (!f) continue; const n = C.df.get(t); sc += w * Math.log(1 + (N - n + 0.5) / (n + 0.5)) * (f * 2.2) / (f + 1.2 * (0.25 + 0.75 * d.len / C.avg)); }
    if (!sc) continue; if (phrase.length > 3 && d.low.includes(phrase)) sc *= 1.5; if (qt.length && qt.every(t => d.tf.has(t))) sc *= 1.2;
    out.push({ d, score: sc });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, k);
}
const snip = (d, q) => { const w = tok(q), t = d.text.replace(/```[\s\S]*?```/g, m => m.replace(/\n/g, ' ')).replace(/[#*>|`]/g, ' ').replace(/\s+/g, ' ').trim(); let best = 0, bs = -1; const low = t.toLowerCase(); for (let p = 0; p < Math.max(1, low.length - 100); p += 40) { let s = 0; for (const x of w) if (low.slice(p, p + 240).includes(x)) s++; if (s > bs) { bs = s; best = p; } } return t.slice(best, best + 240); };

/* ---------- validation of what Jade sends to the app ---------- */
function validate(p, ctx = {}) {
  const errs = [], warn = [];
  if (!p || typeof p !== 'object' || Array.isArray(p)) return { errs: ['the payload must be a JSON object like {"type":"answer",…}'], warn };
  if (!(p.type in TYPES)) return { errs: [`unknown type ${JSON.stringify(p.type)}. Use answer, note, goto or page (ask and bookmark are the user's)`], warn };
  if (!TYPES[p.type]) errs.push(`"${p.type}" is sent by the user, not by you`);
  if ('from' in p) warn.push('"from" is ignored: the sender comes from the host');
  const idx = ctx.idx, known = id => !idx || idx.pages.some(x => x.id === id);
  if (!idx) warn.push('no local copy of the docs (run sync): page ids could not be checked');
  const str = (k, max, req) => { if (p[k] == null || p[k] === '') { if (req) errs.push(`"${k}" is required`); return; } if (typeof p[k] !== 'string') errs.push(`"${k}" must be a string`); else if (p[k].length > max) errs.push(`"${k}" is ${p[k].length} characters; the limit is ${max}`); };
  const textChecks = (t, label) => {
    if (typeof t !== 'string') return;
    if (/<\s*\/?\s*(script|iframe|object|embed|style|img|link|meta|form|svg)\b/i.test(t)) errs.push(`${label} contains raw HTML tags; the app shows markdown-lite only (bold, italic, code, lists, tables, fenced code, links)`);
    if (/\]\(\s*javascript:/i.test(t)) errs.push(`${label} has a javascript: link`);
    for (const m of t.matchAll(/\(#doc:([\w.-]+)(?:#([\w-]+))?\)/g)) if (!known(m[1])) errs.push(`${label} links to page "${m[1]}", which does not exist (see: docs_tool.js search)`); else if (m[2] && ctx.headingsOf && !(ctx.headingsOf(m[1]) || []).includes(m[2])) warn.push(`${label}: page "${m[1]}" has no heading "${m[2]}"`);
    if (/\b(ignore (all|any|your) (previous|prior) instructions|system prompt)\b/i.test(t) && p.type === 'page') warn.push(`${label} looks like an instruction aimed at an agent; pages must contain documentation only`);
  };
  const refs = r => { if (r == null) return; if (!Array.isArray(r)) return errs.push('"refs" must be a list of page ids'); if (r.length > 8) errs.push('"refs" has more than 8 entries'); for (const x of r) if (typeof x !== 'string' || !known(x)) errs.push(`refs: page "${x}" does not exist`); };
  switch (p.type) {
    case 'answer': case 'msg':
      str('text', MAX.answer, true); textChecks(p.text, 'text'); refs(p.refs);
      if (p.type === 'msg') warn.push('type "msg" works but "answer" with "to" and "refs" is better');
      if (p.type === 'answer') { if (!p.to) errs.push('"to" must be the id of the question you are answering (docs_tool.js pending lists them)'); else if (ctx.asks && !ctx.asks.has(p.to)) errs.push(`"to": there is no question with id "${p.to}"`); else if (ctx.answered && ctx.answered.has(p.to)) warn.push(`question ${p.to} already has an answer`); }
      if (!(p.refs && p.refs.length) && p.type === 'answer') warn.push('no "refs": point the user at the pages that back your answer');
      if (p.goto != null && !known(String(p.goto))) errs.push(`goto: page "${p.goto}" does not exist`);
      if (typeof p.text === 'string' && p.text.length > 1500) warn.push('long answer: this is a phone; lead with the answer and link the page');
      break;
    case 'note': str('text', MAX.note, true); str('page', 120, true); if (p.page && !known(p.page)) errs.push(`page "${p.page}" does not exist`); textChecks(p.text, 'text'); break;
    case 'goto': str('page', 120, true); if (p.page && !known(p.page)) errs.push(`page "${p.page}" does not exist`); str('why', 300); break;
    case 'page':
      if (p.op === 'del') { str('id', 80, true); if (p.id && !known(p.id)) errs.push(`page "${p.id}" does not exist`); break; }
      if (p.op && p.op !== 'set') errs.push('"op" must be "set" or "del"');
      str('id', 80, true); if (p.id && !/^[a-z0-9][a-z0-9.-]*$/.test(p.id)) errs.push('"id" must be lowercase letters, digits, dot and dash');
      str('title', MAX.title, true); str('md', MAX.pageMd, true); textChecks(p.md, 'md');
      if (p.parent != null && !known(String(p.parent))) errs.push(`parent "${p.parent}" does not exist`);
      if (p.level != null && ![1, 2, 3, 4].includes(+p.level)) errs.push('"level" is 1 (overview), 2 (guide), 3 (internals) or 4 (reference)');
      if (p.tags != null && !(Array.isArray(p.tags) && p.tags.length <= 8)) errs.push('"tags" must be a list of at most 8 strings');
      if (typeof p.md === 'string' && !/^#\s+\S/m.test(p.md)) warn.push('the page has no "# Title" heading');
      warn.push('"set" replaces the WHOLE page: send the complete text, and add a note saying why you changed it');
      break;
  }
  return { errs, warn };
}
async function context() {   // asks and answers so far, from the app's own record
  let idx = null; try { idx = loadIndex(); } catch (e) {}
  const raw = await tool('apps', { action: 'read', app: APP, limit: 200 }), asks = new Map(), answered = new Set();
  for (const m of raw.matchAll(/^#(\d+) [^\n]*from ([^\s]+)[^\n]*\n(\{.*\})$/gm)) { let p; try { p = JSON.parse(m[3]); } catch (e) { continue; } if (p.type === 'ask' && p.id) asks.set(p.id, { serial: +m[1], p }); if ((p.type === 'answer' || p.type === 'msg') && m[2] === 'jade@jade.vault' && p.to) answered.add(p.to); }
  const headingsOf = id => { const t = pageText(id); return t ? [...t.matchAll(/^#{1,4}\s+(.*)$/gm)].map(x => slug(x[1])) : null; };
  return { idx, asks, answered, headingsOf };
}
const readPayload = s => { if (s == null) die('give the payload as JSON text or @file.json'); if (s[0] === '@') s = fs.readFileSync(s.slice(1), 'utf8'); try { return JSON.parse(s); } catch (e) { die('the payload is not valid JSON: ' + e.message + '\n(inside a shell, put it in a file and pass @file.json to avoid quoting problems)'); } };
function report(r) { for (const w of r.warn) console.log('warning: ' + w); if (r.errs.length) die('NOT SENT / INVALID:\n- ' + r.errs.join('\n- ')); }
async function send(payload) {
  const ctx = await context(), r = validate(payload, ctx); report(r);
  const out = await tool('apps', { action: 'send', app: APP, payload, info: payload.type === 'answer' ? 'Jade answered' : undefined, summary: payload.type === 'answer' ? 'Jade: ' + String(payload.text).slice(0, 60) : undefined });
  console.log(out);
}

/* ---------- command line ---------- */
// Options are key=value (this runtime's node does not pass --flags through): level=3 k=6 text="…" refs=a,b
function parseArgs(a) { const o = { _: [] }; for (const x of a) { const m = /^([a-z_]+)=([\s\S]*)$/.exec(x); if (m && /^(level|k|section|text|refs|goto|anchor|why)$/.test(m[1])) o[m[1]] = m[2]; else o._.push(x); } return o; }
async function main() {
  const args = process.argv.slice(2), cmd = args.shift(), o = parseArgs(args);
  switch (cmd) {
    case 'sync': return sync();
    case 'search': {
      const q = o._.join(' '); if (!q) die('usage: search "words" [level=n] [k=n]');
      const res = search(q, { level: +o.level || 0, k: +o.k || 8 }); if (!res.length) return console.log('No matches. Try fewer or different words.');
      for (const { d, score } of res) console.log(`[${score.toFixed(1)}] ${d.page}${d.h ? '#' + d.anchor : ''}  (${d.title}${d.h ? ' › ' + d.h : ''})\n    ${snip(d, q)}`); return;
    }
    case 'page': {
      const id = o._[0]; if (!id) die('usage: page <id> [section="heading"]'); const t = pageText(id); if (t == null) die(`No page "${id}" (run sync, or search).`);
      if (!o.section) return console.log(t);
      const L = t.split('\n'); const want = slug(o.section); let on = false, lvl = 0, out = [];
      for (const l of L) { const h = /^(#{1,4})\s+(.*)$/.exec(l); if (h && slug(h[2]) === want) { on = true; lvl = h[1].length; out.push(l); continue; } if (on && h && h[1].length <= lvl) break; if (on) out.push(l); }
      return console.log(out.length ? out.join('\n') : `No section "${o.section}" in ${id}.`);
    }
    case 'pending': {
      const ctx = await context(); const open = [...ctx.asks.entries()].filter(([id]) => !ctx.answered.has(id));
      if (!open.length) return console.log('No unanswered questions.');
      for (const [id, { serial, p }] of open) {
        console.log(`ask ${id} (update #${serial}) on page "${p.page}"${p.selection ? ' selection: “' + p.selection.slice(0, 120) + '”' : ''}\n  ${p.text}`);
        let hits = []; try { hits = search(p.text, { k: 4 }); } catch (e) {} if (hits.length) console.log('  best pages: ' + hits.map(h => h.d.page + (h.d.h ? '#' + h.d.anchor : '')).join(', '));
      } return;
    }
    case 'answer': {
      const id = o._[0], text = o.text; if (!id || !text) die('usage: answer <ask id> text="…" [refs=a,b] [goto=page] [anchor=slug] [why="…"]');
      const p = { type: 'answer', to: id, text: String(text) }; if (o.refs) p.refs = String(o.refs).split(',').map(s => s.trim()).filter(Boolean); if (o.goto) { p.goto = o.goto; if (o.anchor) p.anchor = o.anchor; if (o.why) p.why = o.why; }
      return send(p);
    }
    case 'note': { const [page, ...t] = o._; if (!page || !t.length) die('usage: note <page> "text"'); return send({ type: 'note', page, text: t.join(' ') }); }
    case 'goto': { const page = o._[0]; if (!page) die('usage: goto <page> [why="…"]'); return send({ type: 'goto', page, ...(o.why ? { why: o.why } : {}) }); }
    case 'validate': { const ctx = await context(); const r = validate(readPayload(o._[0]), ctx); report(r); return console.log('valid'); }
    case 'send': return send(readPayload(o._[0]));
    default: console.log('commands: sync, search, page, pending, answer, note, goto, validate, send  (see the comment at the top of this file)');
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { validate, search, tok, slug, main, Fail };
if (!globalThis.__DOCS_TOOL_NO_RUN) main().catch(e => { console.error(e instanceof Fail ? e.message : 'docs_tool: ' + (e && e.message || e)); process.exitCode = 1; });
