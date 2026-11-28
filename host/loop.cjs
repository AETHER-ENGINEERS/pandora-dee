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
// Her device tools (phone, screen, senses, …), through the devices that visit and have them (host/devices.cjs).
// Her tool servers (MCP): direct tools declared; deferred and codemode ones found with tool_search; and codemode, her
// Atelier's own, a script that calls them and her other tools together (host/codemode.cjs), when she has codemode ones.
//
// What she is: her SOUL, AGENTS and the end of her Memory.md, as her system prompt, with the time.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { runCodemode, codemodeDef } = require('./codemode.cjs');

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
  def('skill', 'Load one of your skills (instruction packs) by name, then follow what it returns.', { name: { type: 'string' }, input: { type: 'string' } }, ['name']),
  def('find_skill', 'Find which of your skills fits a request.', { query: { type: 'string' } }, ['query']),
  def('tool_search', 'Find tools from your tool servers (MCP) by what they do; the ones found are yours to use from your next step.', { query: { type: 'string' } }, ['query']),
  def('delegate', 'Hand a self-contained task to a helper of yours with a fresh mind and your tools; you get back what it found or did.', { task: { type: 'string' }, context: { type: 'string' } }, ['task']),
];

/**
 * opts: { root, chat(role, { messages, tools }), state, isHers(vp), mayWrite() → reason or null, hostTools: [{ def, run(args) }],
 *         trace(kind, fields), log(kind, fields), fetch?, steer (host/steer.cjs), mcp (host/mcp_client.cjs),
 *         context() → { numCtx, compactPct, compactKeep, compactAuto },
 *         devices() → [{ def, run(args) }]: her device tools, as the devices that visit now offer them (host/devices.cjs) }
 */
function createLoop(opts) {
  const root = path.resolve(opts.root);
  const trace = opts.trace || (() => {}), log = opts.log || (() => {});
  const fetchFn = opts.fetch || globalThis.fetch;
  const hostTools = opts.hostTools || [];
  const extra = []; // more of her tools, added after the loop is made (her playbook and ritual: host/engines.cjs)
  const deviceTools = () => { try { return (opts.devices && opts.devices()) || []; } catch { return []; } };
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
    skill(a) { if (!opts.steer) throw new Error('No skills here.'); return opts.steer.skillTool(a); },
    find_skill(a) { if (!opts.steer) throw new Error('No skills here.'); return opts.steer.findSkillTool(a); },
  };

  function system() {
    if (opts.steer) return opts.steer.system() + ' Your vault is your home\'s folder; your tools act on it.';
    const read = (vp, max) => { try { const t = fs.readFileSync(at(vp).full, 'utf8'); return max && t.length > max ? '…' + t.slice(-max) : t; } catch { return ''; } };
    const d = herDir() ? '/' + herDir() : '';
    const parts = [read(`${d}/SOUL.md`), read(`${d}/AGENTS.md`) || read('/AGENTS.md')].filter(Boolean);
    const mem = read(`${d}/Memory.md`, 4000);
    if (mem) parts.push('## Your memory (the end of Memory.md)\n' + mem);
    parts.push(`It is now ${new Date().toString()}. Your vault is your home's folder; your tools act on it.`);
    return parts.join('\n\n');
  }

  async function callTool(name, args, ctx = {}) {
    try {
      if (name === 'tool_search') {
        if (!opts.mcp) return 'No tool servers here.';
        const found = await opts.mcp.search(args && args.query);
        if (ctx.loaded) for (const t of found) ctx.loaded.set(t.name, t);
        return found.length ? `Found (yours from your next step):\n${found.map((t) => `- ${t.name}: ${t.description.slice(0, 200)}`).join('\n')}` : 'No tool of your tool servers matches that.';
      }
      if (name === 'codemode') return await codemode(args || {}, ctx);
      if (name === 'delegate') {
        if ((ctx.depth || 0) >= 1) return 'A helper can\'t hand work on again: do it yourself.';
        const task = String((args && args.task) || '').trim(); if (!task) return 'Say what the helper should do.';
        trace('her.delegate', { task });
        const r = await turn({ messages: [{ role: 'user', content: task + (args.context ? `\n\nWhat you need to know:\n${args.context}` : '') }], role: 'chat', why: (ctx.why || '') + ':delegate', depth: (ctx.depth || 0) + 1 });
        return `The helper says:\n${r.content}`;
      }
      if (/^mcp__/.test(name)) { if (!opts.mcp) return `There is no tool called ${name}.`; return await opts.mcp.call(name, args || {}); }
      const later = extra.find((t) => t.def.function.name === name) || deviceTools().find((t) => t.def.function.name === name);
      const own = later ? null : run[name], host = later || hostTools.find((t) => t.def.function.name === name);
      if (!own && !host) return `There is no tool called ${name}.`;
      const out = own ? await own(args || {}) : await host.run(args || {}); return typeof out === 'string' ? out : JSON.stringify(out);
    } catch (e) { return `Not done: ${e && e.message ? e.message : e}`; }
  }

  // ---- her codemode: a script of hers that calls her tool servers' codemode and direct tools and her own tools ----
  const STORE_KEY = 'codemodeStore', STORE_CHATS = 40, STORE_MAX = 64 * 1024;
  const chatKey = (why) => String(why || 'chat').slice(0, 200);
  function storeOf(why) { try { const all = (opts.state && opts.state.lsAll().values[STORE_KEY]) || {}; const v = all[chatKey(why)]; return v && typeof v === 'object' ? v.data || {} : {}; } catch { return {}; } }
  function keepStore(why, data) {
    if (!opts.state) return;
    try {
      if (JSON.stringify(data).length > STORE_MAX) throw new Error('too big');
      const all = { ...((opts.state.lsAll().values[STORE_KEY]) || {}) };
      all[chatKey(why)] = { at: Date.now(), data };
      const keys = Object.keys(all).sort((a, b) => (all[b].at || 0) - (all[a].at || 0));
      for (const k of keys.slice(STORE_CHATS)) delete all[k];
      opts.state.lsSet(STORE_KEY, all, 'her codemode', 'host');
    } catch { log('her.codemode.store.full', {}); }
  }
  /** Her tool servers' tools that codemode scripts call (codemode and direct ones), and whether codemode is offered. */
  async function codemodeTools(ctx) {
    if (ctx && ctx.mcpAll) return ctx.mcpAll;
    let all = []; try { all = opts.mcp ? await opts.mcp.catalog() : []; } catch { all = []; }
    if (ctx) ctx.mcpAll = all;
    return all;
  }
  function offerCodemode(all) {
    if (!opts.mcp || !all.some((t) => t.exposure === 'codemode')) return null;
    try { if (opts.mcp.autoCodemode && !opts.mcp.autoCodemode()) return null; } catch { /* offered */ }
    const cm = all.filter((t) => t.exposure === 'codemode' || t.exposure === 'direct');
    const servers = [...new Set(cm.map((t) => t.server))];
    const desc = Object.fromEntries(((opts.mcp.servers && opts.mcp.servers()) || []).map((x) => [x.name, x.description]));
    return codemodeDef(servers.map((s) => `- mcp__${s} (${cm.filter((t) => t.server === s).length} tools)${desc[s] ? ': ' + desc[s] : ''}`).join('\n'));
  }
  const NOT_IN_SCRIPTS = ['codemode', 'tool_search'];
  function builtinDefs(depth) {
    const own = TOOLS.filter((t) => !(depth >= 1 && t.function.name === 'delegate') && !extra.some((x) => x.def.function.name === t.function.name));
    return [...own, ...hostTools.map((t) => t.def), ...extra.map((t) => t.def), ...deviceTools().map((t) => t.def)].map((t) => t.function).filter((f) => !NOT_IN_SCRIPTS.includes(f.name) && !/^mcp__/.test(f.name));
  }
  /** A file her script made (an image, or output too long to hand back), written in her vault as her Atelier does. */
  function keepFile(vpBase, ext, data) {
    writable();
    let vp = `${vpBase}.${ext}`, i = 2; while (fs.existsSync(at(vp).full)) vp = `${vpBase}-${i++}.${ext}`;
    const f = at(vp); fs.mkdirSync(path.dirname(f.full), { recursive: true }); fs.writeFileSync(f.full, data); log('her.write', { path: f.vp }); return f.vp;
  }
  async function codemode(args, ctx) {
    const code = String(args.code ?? args.script ?? '');
    const all = await codemodeTools(ctx);
    const cm = all.filter((t) => t.exposure === 'codemode' || t.exposure === 'direct');
    const builtins = builtinDefs(ctx.depth || 0);
    const catalog = [...cm.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema, mcp: true })), ...builtins.map((f) => ({ name: f.name, description: f.description, inputSchema: f.parameters }))];
    const ns = {};
    for (const x of ((opts.mcp && opts.mcp.servers && opts.mcp.servers()) || [])) ns['mcp__' + x.name] = { name: x.name, description: x.description || '', instructions: '', tools: cm.filter((t) => t.server === x.name).map((t) => t.name) };
    const why = ctx.why || 'chat';
    const data = storeOf(why);
    trace('her.codemode', { why, code });
    const today = new Date().toISOString().slice(0, 10);
    return await runCodemode({
      code, catalog, ns, store: data,
      onStore: (k, v) => { data[k] = v; keepStore(why, data); },
      call: async (name, a) => {
        trace('her.codemode.call', { why, name, args: a });
        if (/^mcp__/.test(name)) {
          if (!catalog.some((t) => t.name === name)) {
            const pre = String(name).split('__').slice(0, 2).join('__') + '__'; const near = catalog.map((t) => t.name).filter((n) => n.startsWith(pre)).slice(0, 8);
            throw new Error(all.some((t) => t.name === name) ? `${name} is a deferred tool: load it with tool_search instead of codemode` : `no tool named ${name}${near.length ? '. Tools on that server: ' + near.join(', ') : '. Use searchTools("…")'}`);
          }
          return await opts.mcp.callRaw(name, a);
        }
        if (builtins.some((f) => f.name === name)) {
          const out = await callTool(name, a, { ...ctx, depth: ctx.depth || 0 });
          if (/^Not done: /.test(out)) throw new Error(out.replace(/^Not done: /, ''));
          return out;
        }
        const near = catalog.map((t) => t.name).filter((n) => n.includes(String(name).split('__').pop())).slice(0, 5);
        throw new Error(`no tool named ${name}${near.length ? '. Did you mean ' + near.join(', ') + '?' : '. Use searchTools("…").'}`);
      },
      saveImage: (b64, mime) => keepFile(`/attachments/mcp/${today}-codemode`, (String(mime || '').split('/')[1] || 'bin').replace('jpeg', 'jpg').replace(/[^a-z0-9]/gi, '') || 'bin', Buffer.from(String(b64 || ''), 'base64')),
      saveLong: (text) => keepFile(`/tmp/codemode-${Date.now().toString(36)}`, 'txt', text),
    });
  }

  // ---- the context guard: when a conversation is about to outgrow her context, the older part becomes a summary ----
  const tokens = (msgs) => Math.ceil(msgs.reduce((a, m) => a + String(m.content || '').length + (m.tool_calls ? JSON.stringify(m.tool_calls).length : 0), 0) / 3.5);
  async function guard(msgs, why) {
    const c = (opts.context && opts.context()) || {};
    if (c.compactAuto === false) return msgs;
    const budget = (Number(c.numCtx) || 16384) * ((Number(c.compactPct) || 85) / 100);
    if (tokens(msgs) <= budget) return msgs;
    const keep = Math.max(2, (Number(c.compactKeep) || 2) * 2);
    const head = msgs.filter((m) => m.role === 'system').slice(0, 1);
    let cut = msgs.length - keep; while (cut > 1 && msgs[cut].role === 'tool') cut--; // never split a tool call from its result
    const older = msgs.slice(head.length, cut), recent = msgs.slice(cut);
    if (!older.length) return msgs;
    const transcript = older.map((m) => `${m.role}: ${String(m.content || (m.tool_calls ? '[asked for ' + m.tool_calls.map((t) => t.function && t.function.name).join(', ') + ']' : '')).slice(0, 4000)}`).join('\n');
    let summary = '';
    try { summary = String((await opts.chat('compaction', { messages: [{ role: 'system', content: 'Summarise this earlier part of a conversation for the one who had it, keeping every fact, decision, name, file and open thread they will need. Plain prose, first person where it is theirs.' }, { role: 'user', content: transcript }] })).content || ''); }
    catch { summary = ''; }
    if (!summary.trim()) { log('loop.compact.failed', { why }); return [...head, ...recent]; }
    log('loop.compacted', { why, from: older.length }); trace('her.compacted', { why, summary });
    return [...head, { role: 'system', content: `Earlier in this conversation (a summary, made when it grew long):\n${summary}` }, ...recent];
  }

  /** One of her turns: the model, her tools, until she answers in words. → { content, rounds, tools: [names] } */
  async function turn({ messages, role = 'chat', why = '', depth = 0 }) {
    // who she is comes first, always; a caller's own notes (what's waiting, where she's visiting) follow it
    let msgs = [{ role: 'system', content: system() }, ...messages];
    const own = TOOLS.filter((t) => !(depth >= 1 && t.function.name === 'delegate') && !extra.some((x) => x.def.function.name === t.function.name));
    const tctx = { depth, why };
    const mcpAll = await codemodeTools(tctx);
    const direct = mcpAll.filter((t) => t.exposure === 'direct');
    const cmDef = offerCodemode(mcpAll);
    const loaded = new Map(); // tools found with tool_search, declared from the next step
    const used = [];
    for (let round = 1; round <= MAX_ROUNDS; round++) {
      msgs = await guard(msgs, why);
      const tools = [...own, ...hostTools.map((t) => t.def), ...extra.map((t) => t.def), ...deviceTools().map((t) => t.def), ...(cmDef ? [cmDef] : []), ...[...direct, ...loaded.values()].map((t) => opts.mcp.def(t))];
      const r = await opts.chat(role, { messages: msgs, tools });
      const calls = Array.isArray(r.tool_calls) ? r.tool_calls : [];
      if (!calls.length) return { content: r.content, rounds: round, tools: used };
      msgs.push({ role: 'assistant', content: r.content || '', tool_calls: calls });
      for (const c of calls) {
        const name = c.function && c.function.name; let args = c.function && c.function.arguments;
        if (typeof args === 'string') { try { args = JSON.parse(args || '{}'); } catch { args = {}; } }
        trace('her.tool', { why, name, args });
        const out = await callTool(name, args, { ...tctx, loaded });
        trace('her.tool.result', { why, name, out: out.slice(0, 4000) });
        used.push(name);
        msgs.push({ role: 'tool', tool_call_id: c.id, name, content: out });
      }
    }
    log('loop.rounds', { why, rounds: MAX_ROUNDS });
    return { content: 'I did a lot of steps and stopped before finishing: ask me to carry on.', rounds: MAX_ROUNDS, tools: used };
  }

  return {
    turn, system, TOOLS, callTool,
    addTools: (list) => { for (const t of list) if (!extra.some((x) => x.def.function.name === t.def.function.name)) extra.push(t); },
    allToolDefs: () => [...TOOLS.filter((t) => !extra.some((x) => x.def.function.name === t.function.name)), ...hostTools.map((t) => t.def), ...extra.map((t) => t.def), ...deviceTools().map((t) => t.def)],
  };
}

module.exports = { createLoop, TOOLS };
