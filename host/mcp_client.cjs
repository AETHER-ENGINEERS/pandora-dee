// Her tool servers (MCP), from the host: her /Pandora/mcp.json, read the way her Atelier reads it (app/modules/mcp.js).
//   { "mcpServers": { "<name>": { url, headers, timeout, enabled, exposure, toolExposure, description,
//                                 command, args, env, cwd } } }
// Tools are named mcp__<server>__<tool>. Exposure, per server (and per tool in toolExposure, * patterns allowed):
//   direct     declared to her model like her own tools
//   deferred   found with tool_search, then declared for her next step
//   codemode   (her Atelier's default: scripts call them) — on the host, found with tool_search like deferred
//   hidden     not offered
// Transports:
//   - streamable HTTP (url), as in her Atelier. Header values may use ${NAME}: her MCP secrets, kept on the host
//     (atelier-secrets.json, never shown or logged);
//   - stdio (command, args): a program the host starts. Only the host can do this (a browser can't), and it runs on
//     the computer, so it needs her hands there (host_shell on). Header "!command" values likewise.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const PROTOCOL = '2025-06-18';
const EXPOSURES = ['codemode', 'deferred', 'direct', 'hidden'];

function exposureFor(cfg, tool) {
  const te = cfg.toolExposure || {};
  if (Object.prototype.hasOwnProperty.call(te, tool)) return te[tool];
  for (const [pat, ex] of Object.entries(te)) if (pat.includes('*') && new RegExp('^' + pat.split('*').map((x) => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$').test(tool)) return ex;
  const e = cfg.exposure === 'codemode-deferred' ? 'codemode' : cfg.exposure;
  return EXPOSURES.includes(e) ? e : 'codemode';
}

/** One server's connection: initialize, list its tools, call them. */
function connectServer(name, cfg, { secrets, mayRun, log }) {
  let seq = 0, sid = null, child = null, buf = '';
  const pending = new Map();
  const timeoutMs = (Number(cfg.timeout) || 60) * 1000;
  const resolveValue = async (v) => {
    v = String(v ?? '');
    if (/^!/.test(v)) { if (!mayRun()) throw new Error('a header command needs her hands on this computer (host_shell)'); return await new Promise((ok, no) => { const c = spawn(v.slice(1), { shell: true }); let o = ''; c.stdout.on('data', (d) => { o += d; }); c.on('exit', (code) => (code === 0 ? ok(o.trim()) : no(new Error('header command failed')))); }); }
    return v.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (m, k) => { const s = secrets() || {}; return (s.mcpSecrets && s.mcpSecrets[k]) ?? s[k] ?? ''; });
  };
  async function httpRpc(method, params, notify) {
    const h = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': PROTOCOL };
    for (const [k, v] of Object.entries(cfg.headers || {})) h[k] = await resolveValue(v);
    if (sid) h['Mcp-Session-Id'] = sid;
    const id = notify ? undefined : ++seq;
    const r = await fetch(cfg.url, { method: 'POST', headers: h, body: JSON.stringify({ jsonrpc: '2.0', method, ...(params ? { params } : {}), ...(notify ? {} : { id }) }), signal: AbortSignal.timeout(timeoutMs) });
    const s = r.headers.get('mcp-session-id'); if (s) sid = s;
    if (notify || r.status === 202) return null;
    const text = await r.text();
    if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`);
    let msg = null;
    if (/event-stream/i.test(r.headers.get('content-type') || '')) {
      for (const block of text.split(/\n\n/)) { const data = block.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('\n'); if (!data) continue; try { const j = JSON.parse(data); if (j.id === id) msg = j; } catch { /* a ping */ } }
    } else msg = JSON.parse(text);
    if (!msg) throw new Error(`${name}: no answer`);
    if (msg.error) throw new Error(`${name}: ${msg.error.message || 'error'}`);
    return msg.result;
  }
  function stdioStart() {
    if (!mayRun()) throw new Error('a server the host starts needs her hands on this computer (host_shell)');
    child = spawn(cfg.command, Array.isArray(cfg.args) ? cfg.args.map(String) : [], { cwd: cfg.cwd || undefined, env: { ...process.env, ...(cfg.env || {}) }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    child.stdout.on('data', (d) => {
      buf += d; let i;
      while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (!line) continue; let j; try { j = JSON.parse(line); } catch { continue; } const p = pending.get(j.id); if (p) { pending.delete(j.id); if (j.error) p.no(new Error(`${name}: ${j.error.message || 'error'}`)); else p.ok(j.result); } }
    });
    child.stderr.on('data', () => { /* the server's own chatter stays with it */ });
    child.on('exit', () => { for (const p of pending.values()) p.no(new Error(`${name}: the server stopped`)); pending.clear(); child = null; });
  }
  function stdioRpc(method, params, notify) {
    if (!child) stdioStart();
    if (notify) { child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, ...(params ? { params } : {}) }) + '\n'); return Promise.resolve(null); }
    const id = ++seq;
    return new Promise((ok, no) => {
      const t = setTimeout(() => { pending.delete(id); no(new Error(`${name}: timed out`)); }, timeoutMs);
      pending.set(id, { ok: (v) => { clearTimeout(t); ok(v); }, no: (e) => { clearTimeout(t); no(e); } });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) }) + '\n');
    });
  }
  const rpc = cfg.command ? stdioRpc : httpRpc;
  let ready = null;
  const init = () => (ready ||= (async () => {
    await rpc('initialize', { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'pandora-dee-host', version: '1' } });
    await rpc('notifications/initialized', null, true);
    const tools = []; let cursor;
    do { const r = await rpc('tools/list', cursor ? { cursor } : {}); tools.push(...((r && r.tools) || [])); cursor = r && r.nextCursor; } while (cursor);
    log('mcp.connected', { server: name, tools: tools.length, transport: cfg.command ? 'stdio' : 'http' });
    return tools;
  })().catch((e) => { ready = null; throw e; }));
  return {
    name, cfg,
    tools: () => init(),
    call: async (tool, args) => { await init(); return rpc('tools/call', { name: tool, arguments: args || {} }); },
    close() { if (child) { try { child.kill(); } catch { /* gone */ } child = null; } ready = null; },
  };
}

/** opts: { root, secrets() → object, mayRun() → bool, log } */
function createMcp(opts) {
  const root = path.resolve(opts.root);
  const log = opts.log || (() => {});
  let loaded = '', servers = new Map();
  function config() {
    const f = ['Pandora', 'Jade'].map((d) => path.join(root, d, 'mcp.json')).find((x) => fs.existsSync(x));
    if (!f) return {};
    try { const j = JSON.parse(fs.readFileSync(f, 'utf8').replace(/^\s*\/\/.*$/gm, '')); return j.mcpServers || j.servers || {}; } catch { log('mcp.config.invalid', {}); return {}; }
  }
  /** Her servers, connected again when her mcp.json changes. */
  function current() {
    const cfg = config(); const key = JSON.stringify(cfg);
    if (key !== loaded) {
      for (const s of servers.values()) s.close();
      servers = new Map();
      for (const [n, c] of Object.entries(cfg)) if (c && c.enabled !== false && (c.url || c.command) && /^[A-Za-z0-9_-]{1,40}$/.test(n)) servers.set(n, connectServer(n, c, opts));
      loaded = key;
    }
    return servers;
  }
  /** Every tool of every server she has (servers that can't be reached are left out, and the log says so). */
  async function catalog() {
    const out = [];
    for (const s of current().values()) {
      try { for (const t of await s.tools()) { const ex = exposureFor(s.cfg, t.name); if (ex !== 'hidden') out.push({ name: `mcp__${s.name}__${t.name}`, server: s.name, tool: t.name, description: String(t.description || '').slice(0, 1000), inputSchema: t.inputSchema || { type: 'object', properties: {} }, exposure: ex }); } }
      catch (e) { log('mcp.unreachable', { server: s.name }); }
    }
    return out;
  }
  const def = (t) => ({ type: 'function', function: { name: t.name, description: `${t.description} (from her tool server "${t.server}")`, parameters: t.inputSchema } });
  async function call(name, args) {
    const m = /^mcp__([A-Za-z0-9_-]+)__(.+)$/.exec(name); if (!m) throw new Error('not a tool server tool');
    const s = current().get(m[1]); if (!s) throw new Error(`no tool server called ${m[1]}`);
    const r = await s.call(m[2], args);
    const text = ((r && r.content) || []).map((c) => (c.type === 'text' ? c.text : c.type === 'image' ? '[an image]' : c.type === 'resource' ? (c.resource && c.resource.text) || '[a resource]' : '')).filter(Boolean).join('\n');
    return (r && r.isError ? 'The tool said no: ' : '') + (text || JSON.stringify((r && r.structuredContent) || r || {}));
  }
  /** tool_search: words → the best matching tools of hers (deferred and codemode ones too), to declare next. */
  async function search(query, limit = 8) {
    const q = String(query || '').toLowerCase().split(/\W+/).filter((w) => w.length > 2);
    const all = await catalog();
    return all.map((t) => ({ t, n: q.reduce((a, w) => a + ((t.name + ' ' + t.description).toLowerCase().includes(w) ? 1 : 0), 0) })).filter((x) => x.n).sort((a, b) => b.n - a.n).slice(0, limit).map((x) => x.t);
  }
  return { catalog, call, search, def, close: () => { for (const s of servers.values()) s.close(); servers = new Map(); loaded = ''; } };
}

module.exports = { createMcp, exposureFor };
