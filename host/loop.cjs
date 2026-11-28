// Her loop on the host (parity step 2): her turns, schedules, heartbeat and sparks, with her tools, when her loop runs
// on the host (brain 'host'). The model is asked along her chain (host/models.cjs: providers, fallbacks, resting), and
// every tool call it makes is run here, on her home, until it answers in words.
//
// Her core tools, on the host:
//   read, write, edit, list           her vault: real files in her home (never her own key files, never outside it)
//   notes_search                      words in her notes
//   memory                            her Memory.md: read it, or add to it
//   chat_history                      her chats and branches, kept on the host (host/state.cjs)
//   web_fetch                         a web page as text (http and https only)
//   think                             a moment to think, kept in the trace
// and the host's own tools for her (host_shell when it's in her hands, waiting_messages, away_notices, host_info).
//
// What she is: her SOUL, AGENTS and the end of her Memory.md, as her system prompt, with the time.
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const MAX_ROUNDS = 12;
const READ_MAX = 200 * 1024;
const FETCH_MAX = 300 * 1024;

const def = (name, description, properties, required = []) => ({ type: 'function', function: { name, description, parameters: { type: 'object', properties, required } } });
const TOOLS = [
  def('read', 'Read a file in your vault (a path like /Notes/idea.md).', { path: { type: 'string' } }, ['path']),
  def('write', 'Write a file in your vault, replacing it if it is there.', { path: { type: 'string' }, content: { type: 'string' } }, ['path', 'content']),
  def('edit', 'Change part of a file in your vault: the exact text to find, and what to put instead.', { path: { type: 'string' }, find: { type: 'string' }, replace: { type: 'string' } }, ['path', 'find', 'replace']),
  def('list', 'List a folder in your vault.', { path: { type: 'string' } }),
  def('notes_search', 'Find notes in your vault that contain some words.', { query: { type: 'string' } }, ['query']),
  def('memory', 'Your Memory.md: read it, or add a line to it.', { action: { type: 'string', enum: ['read', 'append'] }, text: { type: 'string' } }, ['action']),
  def('chat_history', 'Search your past chats and branches for some words.', { query: { type: 'string' } }, ['query']),
  def('web_fetch', 'Read a web page as text.', { url: { type: 'string' } }, ['url']),
  def('think', 'Think something through before acting. Nothing happens but the thought.', { thought: { type: 'string' } }, ['thought']),
];

/**
 * opts: { root, chat(role, { messages, tools }), state, isHers(vp), mayWrite() → reason or null, hostTools: [{ def, run(args) }],
 *         trace(kind, fields), log(kind, fields), fetch? }
 */
function createLoop(opts) {
  const root = path.resolve(opts.root);
  const trace = opts.trace || (() => {}), log = opts.log || (() => {});
  const fetchFn = opts.fetch || globalThis.fetch;
  const hostTools = opts.hostTools || [];
  const herDir = () => ['Pandora', 'Jade'].find((d) => fs.existsSync(path.join(root, d))) || '';

  /** A vault path to a real file in her home, or an error. Never outside her home, never one of her own keys. */
  function at(vp) {
    const clean = '/' + String(vp || '/').replace(/\\/g, '/').split('/').filter((s) => s && s !== '.').join('/');
    if (clean.split('/').includes('..')) throw new Error('That path leaves your vault.');
    if (opts.isHers && opts.isHers(clean)) throw new Error('That is one of your own keys: the host never reads or writes it.');
    const full = path.resolve(root, '.' + clean);
    if (full !== root && !full.startsWith(root + path.sep)) throw new Error('That path leaves your vault.');
    return { vp: clean, full };
  }
  const writable = () => { const why = opts.mayWrite && opts.mayWrite(); if (why) throw new Error(why); };
  function* walk(dir, n = { c: 0 }) {
    let list = []; try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of list) {
      if (n.c++ > 5000 || e.name.startsWith('.') || e.isSymbolicLink()) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) yield* walk(full, n); else yield full;
    }
  }
  const vpOf = (full) => '/' + path.relative(root, full).split(path.sep).join('/');

  const run = {
    read({ path: p }) { const f = at(p); const b = fs.readFileSync(f.full); return b.length > READ_MAX ? b.subarray(0, READ_MAX).toString('utf8') + '\n…(cut: the file goes on)' : b.toString('utf8'); },
    write({ path: p, content }) { writable(); const f = at(p); fs.mkdirSync(path.dirname(f.full), { recursive: true }); fs.writeFileSync(f.full, String(content ?? '')); log('her.write', { path: f.vp }); return `Written: ${f.vp}`; },
    edit({ path: p, find, replace }) {
      writable(); const f = at(p); const t = fs.readFileSync(f.full, 'utf8'); const n = t.split(String(find)).length - 1;
      if (!find || n === 0) throw new Error('That text is not in the file.');
      if (n > 1) throw new Error(`That text is in the file ${n} times: give more of it, so it is found once.`);
      fs.writeFileSync(f.full, t.replace(String(find), String(replace ?? ''))); log('her.edit', { path: f.vp }); return `Changed: ${f.vp}`;
    },
    list({ path: p = '/' } = {}) { const f = at(p); return fs.readdirSync(f.full, { withFileTypes: true }).filter((e) => !e.name.startsWith('.') && !(opts.isHers && opts.isHers(path.posix.join(f.vp, e.name)))).map((e) => (e.isDirectory() ? e.name + '/' : e.name)).sort().join('\n') || '(empty)'; },
    notes_search({ query }) {
      const q = String(query || '').toLowerCase().trim(); if (!q) throw new Error('Search for some words.');
      const hits = [];
      for (const full of walk(root)) {
        if (!/\.md$/i.test(full) || hits.length >= 20) continue;
        const vp = vpOf(full); if (opts.isHers && opts.isHers(vp)) continue;
        let t = ''; try { t = fs.readFileSync(full, 'utf8'); } catch { continue; }
        const i = t.toLowerCase().indexOf(q); if (i < 0 && !vp.toLowerCase().includes(q)) continue;
        hits.push(`${vp}${i >= 0 ? ': …' + t.slice(Math.max(0, i - 60), i + 100).replace(/\s+/g, ' ') + '…' : ''}`);
      }
      return hits.length ? hits.join('\n') : 'No notes with those words.';
    },
    memory({ action, text }) {
      const f = at(`/${herDir() ? herDir() + '/' : ''}Memory.md`);
      if (action === 'append') { writable(); if (!String(text || '').trim()) throw new Error('Nothing to add.'); fs.mkdirSync(path.dirname(f.full), { recursive: true }); fs.appendFileSync(f.full, (fs.existsSync(f.full) && fs.readFileSync(f.full, 'utf8').endsWith('\n') ? '' : '\n') + String(text).trim() + '\n'); log('her.memory', {}); return 'Added to your Memory.md.'; }
      try { return fs.readFileSync(f.full, 'utf8') || '(empty)'; } catch { return '(no Memory.md yet)'; }
    },
    chat_history({ query }) {
      const q = String(query || '').toLowerCase().trim(); if (!q || !opts.state) throw new Error('Search for some words.');
      const list = opts.state.dbGet('sessions').value || [];
      const hits = [];
      for (const s of list) {
        if (hits.length >= 10) break;
        const full = opts.state.dbGet('session:' + s.id).value; const title = String(s.title || '');
        const msgs = (full && full.messages) || [];
        const m = msgs.find((x) => String(x.content || '').toLowerCase().includes(q));
        if (m || title.toLowerCase().includes(q)) hits.push(`"${title}" (${new Date(s.updated || Date.now()).toISOString().slice(0, 10)})${m ? `: ${m.role}: …${String(m.content).slice(0, 160).replace(/\s+/g, ' ')}…` : ''}`);
      }
      return hits.length ? hits.join('\n') : 'Nothing in your chats with those words.';
    },
    async web_fetch({ url }) {
      let u; try { u = new URL(String(url)); } catch { throw new Error('That is not an address.'); }
      if (!/^https?:$/.test(u.protocol)) throw new Error('Only http and https pages.');
      const r = await fetchFn(u.href, { redirect: 'follow', signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'pandora-dee-host' } });
      const buf = Buffer.from(await r.arrayBuffer()).subarray(0, FETCH_MAX).toString('utf8');
      const text = /html/i.test(r.headers.get('content-type') || '') ? buf.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim() : buf;
      return `${r.status} ${u.href}\n\n${text.slice(0, 60000)}`;
    },
    think({ thought }) { trace('her.think', { thought: String(thought || '') }); return 'Thought noted.'; },
  };

  function system() {
    const read = (vp, max) => { try { const t = fs.readFileSync(at(vp).full, 'utf8'); return max && t.length > max ? '…' + t.slice(-max) : t; } catch { return ''; } };
    const d = herDir() ? '/' + herDir() : '';
    const parts = [read(`${d}/SOUL.md`), read(`${d}/AGENTS.md`) || read('/AGENTS.md')].filter(Boolean);
    const mem = read(`${d}/Memory.md`, 4000);
    if (mem) parts.push('## Your memory (the end of Memory.md)\n' + mem);
    parts.push(`It is now ${new Date().toString()}. Your vault is your home's folder; your tools act on it.`);
    return parts.join('\n\n');
  }

  async function callTool(name, args) {
    const own = run[name], host = hostTools.find((t) => t.def.function.name === name);
    if (!own && !host) return `There is no tool called ${name}.`;
    try { const out = own ? await own(args || {}) : await host.run(args || {}); return typeof out === 'string' ? out : JSON.stringify(out); }
    catch (e) { return `Not done: ${e && e.message ? e.message : e}`; }
  }

  /** One of her turns: the model, her tools, until she answers in words. → { content, rounds, tools: [names] } */
  async function turn({ messages, role = 'chat', why = '' }) {
    const msgs = messages.some((m) => m.role === 'system') ? [...messages] : [{ role: 'system', content: system() }, ...messages];
    const tools = [...TOOLS, ...hostTools.map((t) => t.def)];
    const used = [];
    for (let round = 1; round <= MAX_ROUNDS; round++) {
      const r = await opts.chat(role, { messages: msgs, tools });
      const calls = Array.isArray(r.tool_calls) ? r.tool_calls : [];
      if (!calls.length) return { content: r.content, rounds: round, tools: used };
      msgs.push({ role: 'assistant', content: r.content || '', tool_calls: calls });
      for (const c of calls) {
        const name = c.function && c.function.name; let args = c.function && c.function.arguments;
        if (typeof args === 'string') { try { args = JSON.parse(args || '{}'); } catch { args = {}; } }
        trace('her.tool', { why, name, args });
        const out = await callTool(name, args);
        trace('her.tool.result', { why, name, out: out.slice(0, 4000) });
        used.push(name);
        msgs.push({ role: 'tool', tool_call_id: c.id, name, content: out });
      }
    }
    log('loop.rounds', { why, rounds: MAX_ROUNDS });
    return { content: 'I did a lot of steps and stopped before finishing: ask me to carry on.', rounds: MAX_ROUNDS, tools: used };
  }

  return { turn, system, TOOLS, callTool };
}

module.exports = { createLoop, TOOLS };
