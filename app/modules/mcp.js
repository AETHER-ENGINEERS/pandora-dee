/* =====================================================================
   MCP — modelled on pi's built-in MCP (pi ≥ 0.99, "Codemode and MCP")
   Config: /Pandora/mcp.json  { "mcpServers": { "<name>": { url, headers, type, timeout, enabled,
           exposure, toolExposure, description } } }
   Tools are named mcp__<server>__<tool>. Per-server `exposure` (and per-tool `toolExposure`, keys are
   exact names or * patterns; exact names win):
     codemode (default)  callable only from codemode scripts: await tools.mcp__s__t(args)
     deferred            hidden until tool_search loads it for the next model call
     direct              declared to the model like a built-in tool (and callable from codemode)
     hidden              registered but unreachable
   Resources: list_mcp_resources / list_mcp_resource_templates / read_mcp_resource.
   Transport: streamable HTTP only (a browser cannot spawn stdio servers; legacy SSE is rejected like pi).
   Servers connect in the background at startup and stay connected; edits to mcp.json apply live.
   ===================================================================== */
const MCP_PATH = '/Pandora/mcp.json';
const MCP_PROTOCOL = '2025-06-18';
const MCP_EXPOSURES = ['codemode', 'deferred', 'direct', 'hidden'];
const MCP = { servers: new Map(), loadedKey: '', cfgText: '', reloadT: 0 };
const mcpSafe = s => String(s).replace(/[^A-Za-z0-9_-]/g, '_');
const mcpToolName = (server, tool) => `mcp__${mcpSafe(server)}__${mcpSafe(tool)}`;

function ensureMcpFile() {
  if (vfs.exists(MCP_PATH) || ls.get('mcpSeeded', false)) return;
  vfs.write(MCP_PATH, JSON.stringify({ mcpServers: {} }, null, 2) + '\n', { mkdirs: true }); ls.set('mcpSeeded', true);
}
function readMcpConfig() {
  if (!vfs.isFile(MCP_PATH)) return { servers: {}, error: null };
  const raw = vfs.read(MCP_PATH);
  try {
    const j = JSON.parse(raw.replace(/^\s*\/\/.*$/gm, ''));
    return { servers: j.mcpServers || j.servers || {}, autoEnableCodemode: j.autoEnableCodemode !== false, error: null };
  } catch (e) { return { servers: {}, error: 'mcp.json is not valid JSON: ' + e.message }; }
}
function writeMcpConfig(mutate) {
  let j = { mcpServers: {} };
  if (vfs.isFile(MCP_PATH)) { try { j = JSON.parse(vfs.read(MCP_PATH).replace(/^\s*\/\/.*$/gm, '')); } catch { throw new Error('fix the JSON in /Pandora/mcp.json first'); } }
  j.mcpServers ||= {}; mutate(j.mcpServers, j);
  vfs.write(MCP_PATH, JSON.stringify(j, null, 2) + '\n', { mkdirs: true });
}
// ${NAME} → MCP secret (Config → MCP), "!command" → output of a shell command (like pi)
async function mcpResolveValue(v) {
  v = String(v ?? '');
  if (/^!/.test(v)) { try { return String(await new Shell({}).capture(v.slice(1))).trim(); } catch (e) { throw new Error(`header command failed: ${e.message}`); } }
  return v.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (m, k) => (S.mcpSecrets || {})[k] ?? '');
}
function mcpExposureFor(srv, toolName) {
  const te = srv.cfg.toolExposure || {};
  if (Object.prototype.hasOwnProperty.call(te, toolName)) return te[toolName];
  for (const [pat, ex] of Object.entries(te)) if (pat.includes('*') && new RegExp('^' + pat.split('*').map(x => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$').test(toolName)) return ex;
  const e = srv.cfg.exposure === 'codemode-deferred' ? 'codemode' : srv.cfg.exposure;
  return MCP_EXPOSURES.includes(e) ? e : 'codemode';
}

/* ---------- streamable HTTP JSON-RPC client ---------- */
class McpHttpClient {
  constructor(name, cfg) { this.name = name; this.cfg = cfg; this.seq = 0; this.sessionId = null; this.protocol = MCP_PROTOCOL; this.ctrls = new Set(); }
  async headers(extra = {}) {
    const h = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...extra };
    for (const [k, v] of Object.entries(this.cfg.headers || {})) h[k] = await mcpResolveValue(v);
    if (this.sessionId) h['Mcp-Session-Id'] = this.sessionId;
    if (this.initialized) h['MCP-Protocol-Version'] = this.protocol;
    return h;
  }
  close() { for (const c of this.ctrls) c.abort(); this.ctrls.clear(); if (this.sessionId) { this.headers().then(h => fetch(this.cfg.url, { method: 'DELETE', headers: h }).catch(() => {})); } this.sessionId = null; this.initialized = false; }
  async post(body, { notify = false, timeoutMs, onProgress, retry = 2 } = {}) {
    const ms = timeoutMs || (Math.max(1, +this.cfg.timeout || 60) * 1000);
    for (let attempt = 0; ; attempt++) {
      const ctrl = new AbortController(); this.ctrls.add(ctrl);
      let timer = setTimeout(() => ctrl.abort(new Error('timeout')), ms);
      const bump = () => { clearTimeout(timer); timer = setTimeout(() => ctrl.abort(new Error('timeout')), ms); };   // progress resets the timeout
      try {
        let r;
        try { r = await fetch(this.cfg.url, { method: 'POST', headers: await this.headers(), body: JSON.stringify(body), signal: ctrl.signal }); }
        catch (e) { if (attempt < retry && !ctrl.signal.reason) { await new Promise(res => setTimeout(res, 400 * (attempt + 1))); continue; } throw new Error(ctrl.signal.aborted ? `${this.name}: request timed out after ${ms / 1000}s` : `${this.name}: could not reach ${this.cfg.url} (${e.message}). If this is a browser tab, the server must allow CORS.`); }
        const sid = r.headers.get('mcp-session-id'); if (sid) this.sessionId = sid;
        if ([408, 429, 500, 502, 503, 504].includes(r.status) && attempt < retry) { await new Promise(res => setTimeout(res, 500 * (attempt + 1))); continue; }
        if (r.status === 404 && this.sessionId && body.method !== 'initialize') { const e = new Error('session expired'); e.code = 'SESSION'; throw e; }
        if (!r.ok && r.status !== 202) { let m = `HTTP ${r.status}`; try { const t = await r.text(); const j = JSON.parse(t); m = j.error?.message || j.message || m; } catch {} if (r.status === 401 || r.status === 403) m += ' (check the headers / token for this server)'; if (r.status === 405 && body.method === 'initialize') m += ' (this looks like a legacy SSE endpoint; use the streamable HTTP URL, usually ending in /mcp)'; throw new Error(`${this.name}: ${m}`); }
        if (notify || r.status === 202) return null;
        const ct = r.headers.get('content-type') || '';
        if (ct.includes('text/event-stream')) return await this.readSSE(r, body.id, bump, onProgress);
        const txt = await r.text(); if (!txt.trim()) return null;
        const j = JSON.parse(txt); const msg = Array.isArray(j) ? j.find(x => x.id === body.id) : j;
        if (msg?.error) throw new Error(`${this.name}: ${msg.error.message || JSON.stringify(msg.error)}`);
        return msg?.result;
      } finally { clearTimeout(timer); this.ctrls.delete(ctrl); }
    }
  }
  async readSSE(r, id, bump, onProgress) {
    const reader = r.body.getReader(); let buf = '', data = [];
    const handle = async (raw) => {
      let m; try { m = JSON.parse(raw); } catch { return; }
      for (const x of Array.isArray(m) ? m : [m]) {
        if (x.id === id && (x.result !== undefined || x.error)) { if (x.error) throw new Error(`${this.name}: ${x.error.message || JSON.stringify(x.error)}`); return { done: true, result: x.result }; }
        if (x.method === 'notifications/progress') { bump(); onProgress?.(x.params); }
        else if (x.method === 'ping' && x.id != null) this.post({ jsonrpc: '2.0', id: x.id, result: {} }, { notify: true }).catch(() => {});
        else if (x.method && x.id != null) this.post({ jsonrpc: '2.0', id: x.id, error: { code: -32601, message: 'not supported by this client' } }, { notify: true }).catch(() => {});
      }
    };
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      buf += dec.decode(value, { stream: true }); let i;
      while ((i = buf.search(/\r?\n/)) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + (buf[i] === '\r' ? 2 : 1));
        if (line === '') { if (data.length) { const out = await handle(data.join('\n')); data = []; if (out?.done) { try { reader.cancel(); } catch {} return out.result; } } continue; }
        if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
      }
    }
    if (data.length) { const out = await handle(data.join('\n')); if (out?.done) return out.result; }
    throw new Error(`${this.name}: the stream ended without a response`);
  }
  async request(method, params, opts) {
    const send = () => this.post({ jsonrpc: '2.0', id: ++this.seq, method, ...(params ? { params } : {}) }, opts);
    try { return await send(); }
    catch (e) { if (e.code === 'SESSION') { this.sessionId = null; this.initialized = false; await this.initialize(); return await send(); } throw e; }
  }
  async initialize() {
    const r = await this.post({ jsonrpc: '2.0', id: ++this.seq, method: 'initialize', params: { protocolVersion: MCP_PROTOCOL, capabilities: {}, clientInfo: { name: 'jade-vault', title: 'Jade Vault', version: '1.5' } } }, { timeoutMs: 20000, retry: 1 });
    if (!r) throw new Error(`${this.name}: no answer to initialize`);
    this.protocol = r.protocolVersion || MCP_PROTOCOL; this.serverInfo = r.serverInfo || {}; this.capabilities = r.capabilities || {}; this.instructions = r.instructions || '';
    this.initialized = true;
    await this.post({ jsonrpc: '2.0', method: 'notifications/initialized' }, { notify: true }).catch(() => {});
    return r;
  }
  async listAll(method, key) { const out = []; let cursor; for (let n = 0; n < 50; n++) { const r = await this.request(method, cursor ? { cursor } : {}); out.push(...(r?.[key] || [])); cursor = r?.nextCursor; if (!cursor) break; } return out; }
}

/* ---------- server manager ---------- */
function mcpServerValidate(name, cfg) {
  if (!/^[A-Za-z0-9_-]+$/.test(name)) return 'server names may only use letters, digits, _ and -';
  if (cfg.command) return 'stdio servers ("command") cannot run in a browser. Expose it over streamable HTTP (for example: npx -y supergateway --stdio "<command>" --outputTransport streamableHttp) and use its url';
  const t = cfg.type; if (t && !['http', 'streamable-http'].includes(t)) return t === 'sse' ? 'legacy SSE servers are not supported (pi rejects them too); use the streamable HTTP endpoint' : `unknown type "${t}"`;
  if (!/^https?:\/\//.test(cfg.url || '')) return 'needs a "url" starting with http:// or https://';
  if (cfg.exposure && !MCP_EXPOSURES.includes(cfg.exposure) && cfg.exposure !== 'codemode-deferred') return `exposure must be one of ${MCP_EXPOSURES.join(', ')}`;
  return '';
}
async function mcpConnect(srv) {
  srv.client?.close(); srv.state = 'connecting'; srv.error = ''; renderMcpPanel();
  const c = srv.client = new McpHttpClient(srv.name, srv.cfg);
  try {
    await c.initialize();
    srv.tools = await c.listAll('tools/list', 'tools').catch(e => { if (c.capabilities.tools) throw e; return []; });
    srv.hasResources = !!c.capabilities.resources;
    srv.state = 'connected'; srv.connectedAt = Date.now();
  } catch (e) { srv.state = 'error'; srv.error = String(e.message || e); }
  renderMcpPanel();
}
async function mcpReload({ force = false } = {}) {
  const { servers, error } = readMcpConfig(); MCP.configError = error;
  const seen = new Set();
  for (const [name, cfg0] of Object.entries(servers)) {
    const cfg = { ...cfg0 }; seen.add(name);
    const key = JSON.stringify(cfg); let srv = MCP.servers.get(name);
    if (srv && srv.key === key && !force) continue;
    const onlyExposure = srv && JSON.stringify({ ...srv.cfg, exposure: 0, toolExposure: 0, description: 0 }) === JSON.stringify({ ...cfg, exposure: 0, toolExposure: 0, description: 0 });
    if (!srv) { srv = { name, tools: [], state: 'idle' }; MCP.servers.set(name, srv); }
    srv.cfg = cfg; srv.key = key;
    const bad = mcpServerValidate(name, cfg);
    if (bad) { srv.client?.close(); srv.state = 'invalid'; srv.error = bad; continue; }
    if (cfg.enabled === false) { srv.client?.close(); srv.state = 'disabled'; srv.error = ''; continue; }
    if (onlyExposure && srv.state === 'connected' && !force) continue;          // exposure changes apply without reconnecting
    mcpConnect(srv);                                                             // background, like pi
  }
  for (const [name, srv] of MCP.servers) if (!seen.has(name)) { srv.client?.close(); MCP.servers.delete(name); }
  renderMcpPanel();
}
vfs.listeners.add(() => {
  const t = vfs.isFile(MCP_PATH) ? vfs.read(MCP_PATH) : '';
  if (t !== MCP.cfgText) { MCP.cfgText = t; clearTimeout(MCP.reloadT); MCP.reloadT = setTimeout(() => mcpReload(), 400); }
});
function mcpAllTools() {   // [{name, server, tool, description, inputSchema, exposure, annotations}]
  const out = [];
  for (const srv of MCP.servers.values()) if (srv.state === 'connected') for (const t of srv.tools) {
    const ex = mcpExposureFor(srv, t.name); if (ex === 'hidden') continue;
    out.push({ name: mcpToolName(srv.name, t.name), server: srv.name, tool: t.name, description: t.description || t.title || '', inputSchema: t.inputSchema || { type: 'object', properties: {} }, exposure: ex, annotations: t.annotations });
  }
  return out;
}
const mcpFind = name => mcpAllTools().find(t => t.name === name);
const mcpHasResources = () => [...MCP.servers.values()].some(s => s.state === 'connected' && s.hasResources);
const mcpConnected = () => [...MCP.servers.values()].filter(s => s.state === 'connected');

/* ---------- tool_search (BM25 over deferred tools) ---------- */
const mcpTok = s => String(s).replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 1);
function bm25(docs, query, k1 = 1.2, b = 0.75) {
  const q = mcpTok(query); if (!q.length) return docs.map(d => ({ d, s: 0 }));
  const toks = docs.map(d => mcpTok(d.text)); const avg = toks.reduce((a, t) => a + t.length, 0) / (toks.length || 1);
  const df = {}; for (const t of toks) for (const w of new Set(t)) df[w] = (df[w] || 0) + 1;
  return docs.map((d, i) => { let s = 0; const tf = {}; for (const w of toks[i]) tf[w] = (tf[w] || 0) + 1;
    for (const w of q) { const f = tf[w] || 0; if (!f) continue; const idf = Math.log(1 + (docs.length - df[w] + 0.5) / (df[w] + 0.5)); s += idf * f * (k1 + 1) / (f + k1 * (1 - b + b * toks[i].length / avg)); }
    if (d.name.toLowerCase().includes(String(query).toLowerCase().replace(/\s+/g, '_'))) s += 2;
    return { d, s }; }).filter(x => x.s > 0).sort((a, b2) => b2.s - a.s);
}
const schemaHint = s => { const p = s?.properties || {}; const req = new Set(s?.required || []); return Object.entries(p).map(([k, v]) => `${k}${req.has(k) ? '' : '?'}: ${v.type || (v.enum ? 'enum' : 'any')}`).join(', '); };
function toolSearch(args) {
  const pool = mcpAllTools().filter(t => t.exposure === 'deferred');
  if (!pool.length) return 'No deferred MCP tools are available.';
  const limit = Math.min(Math.max(1, +args.limit || 5), 20);
  const ranked = bm25(pool.map(t => ({ ...t, text: `${t.name} ${t.tool} ${t.server} ${t.description} ${MCP.servers.get(t.server)?.cfg.description || ''}` })), args.query || '');
  const hits = ranked.filter(x => x.s >= ranked[0]?.s * 0.5).slice(0, limit).map(x => x.d);   // only strong matches, so the prompt stays lean
  if (!hits.length) return `No deferred tools match "${args.query}". Servers: ${[...new Set(pool.map(t => t.server))].join(', ')}.`;
  cur.mcpLoaded = [...new Set([...(cur.mcpLoaded || []), ...hits.map(h => h.name)])]; saveSession();
  return `Loaded ${hits.length} tool${hits.length > 1 ? 's' : ''}; you can call ${hits.length > 1 ? 'them' : 'it'} directly from your next step:\n` + hits.map(h => `- ${h.name}(${schemaHint(h.inputSchema)}): ${h.description.slice(0, 200)}`).join('\n');
}

/* ---------- calling MCP tools ---------- */
async function mcpCallRaw(name, args, onProgress) {
  const t = mcpFind(name); if (!t) throw new Error(`Unknown MCP tool ${name}. Connected servers: ${mcpConnected().map(s => s.name).join(', ') || 'none'}.`);
  const srv = MCP.servers.get(t.server);
  return await srv.client.request('tools/call', { name: t.tool, arguments: args || {}, _meta: { progressToken: 'jv' + Date.now() } }, { onProgress });
}
async function mcpSaveBlob(b64, mime, hint) {
  const ext = (mime || '').split('/')[1]?.replace('jpeg', 'jpg').replace(/[^a-z0-9]/gi, '') || 'bin';
  const base = `/attachments/mcp/${todayStr()}-${mcpSafe(hint).slice(0, 40)}`; let p = `${base}.${ext}`, i = 2; while (vfs.exists(p)) p = `${base}-${i++}.${ext}`;
  vfs.write(p, b64dec(b64 || ''), { mkdirs: true }); return p;
}
async function mcpResultText(res, hint) {   // CallToolResult → text for the model
  const parts = [];
  for (const c of res?.content || []) {
    if (c.type === 'text') parts.push(c.text);
    else if (c.type === 'image' || c.type === 'audio') parts.push(`[${c.type} saved to ${await mcpSaveBlob(c.data, c.mimeType, hint)}]`);
    else if (c.type === 'resource') parts.push(c.resource?.text != null ? `[resource ${c.resource.uri}]\n${c.resource.text}` : `[resource ${c.resource?.uri}${c.resource?.blob ? ' saved to ' + await mcpSaveBlob(c.resource.blob, c.resource.mimeType, hint) : ''}]`);
    else if (c.type === 'resource_link') parts.push(`[resource link ${c.uri}${c.name ? ' (' + c.name + ')' : ''}]`);
  }
  if (!parts.length && res?.structuredContent !== undefined) parts.push(JSON.stringify(res.structuredContent, null, 1));
  return parts.join('\n') || '(no content)';
}
async function mcpRunTool(name, args, ui) {
  if (name === 'codemode') return await runCodemode(String(args.code ?? args.script ?? ''), ui);
  if (name === 'tool_search') return toolSearch(args);
  if (name === 'list_mcp_resources' || name === 'list_mcp_resource_templates') {
    const tmpl = name.endsWith('templates'); const servers = mcpConnected().filter(s => s.hasResources && (!args.server || s.name === args.server));
    if (!servers.length) throw new Error(args.server ? `${args.server} is not connected or has no resources` : 'no connected server offers resources');
    const out = {};
    for (const s of servers) { const r = await s.client.request(tmpl ? 'resources/templates/list' : 'resources/list', args.cursor ? { cursor: args.cursor } : {}); out[s.name] = { [tmpl ? 'resourceTemplates' : 'resources']: (tmpl ? r?.resourceTemplates : r?.resources) || [], ...(r?.nextCursor ? { nextCursor: r.nextCursor } : {}) }; }
    return JSON.stringify(out, null, 1);
  }
  if (name === 'read_mcp_resource') {
    const s = MCP.servers.get(args.server); if (!s || s.state !== 'connected') throw new Error(`server ${args.server} is not connected`);
    const r = await s.client.request('resources/read', { uri: args.uri }); const parts = [];
    for (const c of r?.contents || []) parts.push(c.text != null ? c.text : `[${c.mimeType || 'binary'} saved to ${await mcpSaveBlob(c.blob, c.mimeType, 'resource')}]`);
    return parts.join('\n\n') || '(empty resource)';
  }
  const res = await mcpCallRaw(name, args, p => ui?.meta?.(`progress ${p.progress ?? ''}${p.total ? '/' + p.total : ''} ${p.message || ''}`));
  const text = await mcpResultText(res, name.split('__').pop());
  if (res?.isError) throw new Error(text);
  return truncateHead(text);
}

/* ---------- tool declarations for the agent loop ---------- */
function mcpToolDefs() {
  const all = mcpAllTools(); const defs = []; const { autoEnableCodemode } = readMcpConfig();
  const cm = all.filter(t => t.exposure === 'codemode' || t.exposure === 'direct');
  if (all.some(t => t.exposure === 'codemode') && autoEnableCodemode !== false) {
    const ns = mcpConnected().filter(s => all.some(t => t.server === s.name && (t.exposure === 'codemode' || t.exposure === 'direct')))
      .map(s => `- mcp__${mcpSafe(s.name)} (${all.filter(t => t.server === s.name && (t.exposure === 'codemode' || t.exposure === 'direct')).length} tools)${s.cfg.description || s.client?.serverInfo?.title ? ': ' + (s.cfg.description || s.client.serverInfo.title) : ''}`).join('\n');
    defs.push({ name: 'codemode', description: `Run JavaScript in a sandbox that can call tools, to use MCP servers. Call a tool with \`await tools.<name>(args)\`: MCP tools are named mcp__<server>__<tool> and resolve to {content, structuredContent, isError}; your built-in tools work too and resolve to their text (e.g. await tools.read({path: "Inbox.md"})). Run independent calls together with Promise.all. Find tools with searchTools("words"), describeTool(name) (gives the inputSchema), describeNamespace("mcp__<server>") and ALL_TOOLS. Only console.log output, text(...), the return value and image(block) reach you, so filter and summarise inside the script. store(key, value) / load(key) keep JSON between scripts in this chat. Optional first line: // @options {"timeout": 120}\nMCP servers:\n${ns}`,
      parameters: { type: 'object', properties: { code: { type: 'string', description: 'JavaScript (the body of an async function; use await and return)' } }, required: ['code'] } });
  }
  if (all.some(t => t.exposure === 'deferred')) defs.push({ name: 'tool_search', description: `Find MCP tools that are not loaded yet and load them so you can call them directly on your next step. Servers with loadable tools: ${[...new Set(all.filter(t => t.exposure === 'deferred').map(t => t.server))].join(', ')}.`, parameters: { type: 'object', properties: { query: { type: 'string', description: 'What you want to do, in a few words' }, limit: { type: 'number', description: 'Max tools to load (default 5)' } }, required: ['query'] } });
  if (mcpHasResources()) {
    const srvs = mcpConnected().filter(s => s.hasResources).map(s => s.name);
    defs.push({ name: 'list_mcp_resources', description: `List resources (files, records, documents) offered by MCP servers: ${srvs.join(', ')}. Returns JSON.`, parameters: { type: 'object', properties: { server: { type: 'string' }, cursor: { type: 'string' } } } },
      { name: 'list_mcp_resource_templates', description: 'List MCP resource URI templates.', parameters: { type: 'object', properties: { server: { type: 'string' }, cursor: { type: 'string' } } } },
      { name: 'read_mcp_resource', description: 'Read one MCP resource by server and uri.', parameters: { type: 'object', properties: { server: { type: 'string' }, uri: { type: 'string' } }, required: ['server', 'uri'] } });
  }
  const loaded = new Set(cur?.mcpLoaded || []);
  for (const t of all) if (t.exposure === 'direct' || (t.exposure === 'deferred' && loaded.has(t.name)))
    defs.push({ name: t.name, description: (t.description || t.tool).slice(0, 1024), parameters: t.inputSchema?.type ? t.inputSchema : { type: 'object', properties: {} } });
  return defs.map(d => ({ type: 'function', function: d }));
}
const mcpHandles = name => ['codemode', 'tool_search', 'list_mcp_resources', 'list_mcp_resource_templates', 'read_mcp_resource'].includes(name) || /^mcp__/.test(name);
function mcpPromptBlock() {
  const srvs = mcpConnected(); if (!srvs.length) return '';
  const all = mcpAllTools();
  const lines = srvs.map(s => { const ts = all.filter(t => t.server === s.name); const ex = [...new Set(ts.map(t => t.exposure))].join('/') || 'no tools'; const ins = (s.client?.instructions || '').replace(/\s+/g, ' ').slice(0, 300);
    return `- ${s.name} (${ts.length} tools, ${ex})${s.cfg.description ? ': ' + s.cfg.description : ''}${ins ? `\n  Server instructions: ${ins}` : ''}`; }).join('\n');
  return `\n\nMCP servers (connected):\n${lines}\nUse codemode for codemode servers (await tools.mcp__<server>__<tool>(args) inside the script; searchTools/describeTool to discover), tool_search to load deferred tools, and call direct tools like any other tool.`;
}

/* ---------- codemode sandbox (Web Worker, no network) ---------- */
const CODEMODE_PRELUDE = `
const __out = []; const __images = []; let __seq = 0; const __pending = new Map(); let __catalog = []; let __ns = {}; let __store = {};
const __fmt = a => a.map(x => typeof x === 'string' ? x : (() => { try { return JSON.stringify(x, null, 1); } catch { return String(x); } })()).join(' ');
const console = { log: (...a) => __out.push(__fmt(a)), info: (...a) => __out.push(__fmt(a)), warn: (...a) => __out.push('[warn] ' + __fmt(a)), error: (...a) => __out.push('[error] ' + __fmt(a)), table: x => __out.push(__fmt([x])) };
const text = (...a) => { __out.push(__fmt(a)); };
const __call = (name, args) => new Promise((res, rej) => { const id = ++__seq; __pending.set(id, { res, rej }); postMessage({ t: 'call', id, name, args: args ?? {} }); });
const tools = new Proxy({}, { get: (_, name) => typeof name === 'string' && name !== 'then' ? (args) => __call(name, args) : undefined, has: (_, n) => __catalog.some(t => t.name === n) });
let ALL_TOOLS = [];
const __tok = s => String(s).replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 1);
function searchTools(query, limit = 10) { const q = __tok(query); return __catalog.map(t => { const d = __tok(t.name + ' ' + t.description); let s = 0; for (const w of q) s += d.filter(x => x === w || x.startsWith(w)).length; return { t, s }; }).filter(x => x.s > 0).sort((a, b) => b.s - a.s).slice(0, limit).map(x => ({ name: x.t.name, description: x.t.description })); }
function describeTool(name) { const t = __catalog.find(x => x.name === name); if (!t) throw new Error('no tool ' + name + '. Try searchTools().'); return { name: t.name, description: t.description, inputSchema: t.inputSchema }; }
function describeNamespace(ns) { const k = String(ns).replace(/__$/, ''); const n = __ns[k]; if (!n) throw new Error('no namespace ' + ns + '. Known: ' + Object.keys(__ns).join(', ')); return n; }
function image(block) { if (!block || !block.data) throw new Error('image() needs an image content block {type:"image", data, mimeType}'); __images.push({ data: block.data, mimeType: block.mimeType || 'image/png' }); return '[image attached]'; }
function store(key, value) { __store[key] = JSON.parse(JSON.stringify(value)); postMessage({ t: 'store', key, value: __store[key] }); return value; }
function load(key) { return __store[key]; }
self.fetch = undefined; self.XMLHttpRequest = undefined; self.WebSocket = undefined; self.EventSource = undefined; self.importScripts = undefined;
self.onmessage = async (ev) => {
  const m = ev.data;
  if (m.t === 'ret') { const p = __pending.get(m.id); if (!p) return; __pending.delete(m.id); m.ok ? p.res(m.value) : p.rej(new Error(m.error)); return; }
  if (m.t !== 'init') return;
  __catalog = m.catalog; ALL_TOOLS = __catalog.map(t => t.name); __ns = m.ns; __store = m.store || {};
  let ret, err = null;
  try { ret = await __main(); } catch (e) { err = (e && e.stack) || String(e); }
  postMessage({ t: 'done', out: __out, images: __images, ret: ret === undefined ? undefined : (() => { try { return JSON.parse(JSON.stringify(ret)); } catch { return String(ret); } })(), err });
};
`;
async function runCodemode(code, ui) {
  if (!code.trim()) throw new Error('codemode needs JavaScript in "code"');
  let timeout = 60; const om = /^\s*\/\/\s*@options\s+(\{.*\})\s*$/m.exec(code.split('\n')[0] || ''); if (om) { try { timeout = Math.min(600, Math.max(1, +JSON.parse(om[1]).timeout || 60)); } catch {} }
  const all = mcpAllTools().filter(t => t.exposure === 'codemode' || t.exposure === 'direct');
  const builtins = activeTools().map(t => t.function).filter(f => !mcpHandles(f.name) && !/^mcp__/.test(f.name));
  const catalog = [...all.map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema, mcp: true })), ...builtins.map(f => ({ name: f.name, description: f.description, inputSchema: f.parameters }))];
  const ns = {}; for (const s of mcpConnected()) ns['mcp__' + mcpSafe(s.name)] = { name: s.name, description: s.cfg.description || s.client?.serverInfo?.title || '', instructions: s.client?.instructions || '', tools: all.filter(t => t.server === s.name).map(t => t.name) };
  const src = CODEMODE_PRELUDE + `\nasync function __main() {\n${code}\n}\n`;
  const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
  let calls = 0;
  const r = await new Promise(resolve => {
    let w; try { w = new Worker(url); } catch (e) { resolve({ err: 'could not start the sandbox: ' + e.message, out: [], images: [] }); return; }
    const kill = setTimeout(() => { w.terminate(); resolve({ err: `codemode: script stopped after ${timeout}s (raise it with // @options {"timeout": N})`, out: [], images: [] }); }, timeout * 1000);
    const stop = () => { if (abortReq) { clearTimeout(kill); w.terminate(); resolve({ err: 'aborted', out: [], images: [] }); } }; const abortPoll = setInterval(stop, 300);
    w.onerror = e => { e.preventDefault?.(); clearTimeout(kill); clearInterval(abortPoll); w.terminate(); resolve({ err: `${e.message || 'SyntaxError'}${e.lineno ? ` (line ${Math.max(1, e.lineno - CODEMODE_PRELUDE.split('\n').length - 1)})` : ''}`, out: [], images: [] }); };
    w.onmessage = async e => {
      const m = e.data;
      if (m.t === 'done') { clearTimeout(kill); clearInterval(abortPoll); w.terminate(); resolve(m); return; }
      if (m.t === 'store') { (cur.codemodeStore ||= {})[m.key] = m.value; saveSession(); return; }
      if (m.t === 'call') {
        calls++; ui?.meta?.(`${calls} call${calls > 1 ? 's' : ''} · ${m.name}`);
        try {
          let value;
          if (/^mcp__/.test(m.name)) {
            if (!catalog.some(t => t.name === m.name)) {
              const pre = String(m.name).split('__').slice(0, 2).join('__') + '__'; const near = catalog.map(t => t.name).filter(n => n.startsWith(pre)).slice(0, 8);
              const hiddenOrDeferred = mcpAllTools().some(t => t.name === m.name);
              throw new Error(hiddenOrDeferred ? `${m.name} is a deferred tool: load it with tool_search instead of codemode` : `no tool named ${m.name}${near.length ? '. Tools on that server: ' + near.join(', ') : '. Use searchTools("…")'}`);
            }
            value = await mcpCallRaw(m.name, m.args);
          }
          else if (builtins.some(f => f.name === m.name)) value = await runTool(m.name, m.args, null);
          else { const near = catalog.map(t => t.name).filter(n => n.includes(String(m.name).split('__').pop())).slice(0, 5); throw new Error(`no tool named ${m.name}${near.length ? '. Did you mean ' + near.join(', ') + '?' : '. Use searchTools("…").'}`); }
          w.postMessage({ t: 'ret', id: m.id, ok: true, value });
        } catch (err) { w.postMessage({ t: 'ret', id: m.id, ok: false, error: String(err.message || err) }); }
      }
    };
    w.postMessage({ t: 'init', catalog, ns, store: cur?.codemodeStore || {} });
  });
  URL.revokeObjectURL(url);
  const notes = [];
  for (const [i, im] of (r.images || []).entries()) notes.push(`[image ${i + 1} saved to ${await mcpSaveBlob(im.data, im.mimeType, 'codemode')}]`);
  let out = [...(r.out || [])].join('\n');
  if (r.ret !== undefined) out += (out ? '\n' : '') + (typeof r.ret === 'string' ? r.ret : JSON.stringify(r.ret, null, 1));
  if (notes.length) out += '\n' + notes.join('\n');
  if (r.err) throw new Error((out ? out + '\n' : '') + 'Error: ' + String(r.err).replace(/^(Error:\s*)+/, '').replace(/\n\s+at [\s\S]*$/, ''));
  out = out || '(the script returned nothing: return a value or console.log what you need)';
  if (out.length > 20000) { const p = `/tmp/codemode-${Date.now().toString(36)}.txt`; vfs.write(p, out, { mkdirs: true }); out = out.slice(0, 12000) + `\n\n…[${out.length - 18000} characters cut; full output in ${p}]…\n\n` + out.slice(-6000); }
  ui?.meta?.(`${calls} tool call${calls === 1 ? '' : 's'}`);
  return out;
}

/* ---------- settings panel ("/mcp") ---------- */
function renderMcpPanel() {
  const box = $('#mcpList'); if (!box) return;
  const cfgErr = MCP.configError ? `<div class="text-rd text-sm">${esc(MCP.configError)}</div>` : '';
  const rows = [...MCP.servers.values()].map(s => {
    const dot = { connected: 'ok', connecting: 'busy', error: 'bad', invalid: 'bad', disabled: '' }[s.state] || '';
    const n = s.state === 'connected' ? s.tools.length : 0; const ex = s.cfg.exposure || 'codemode';
    return `<div class="mcp-row" data-srv="${esc(s.name)}">
      <div class="flex items-center gap-2 min-w-0"><span class="dot ${dot}"></span><b class="text-yl">${esc(s.name)}</b><span class="hint truncate">${esc(s.state)}${n ? ` · ${n} tool${n === 1 ? '' : 's'}` : ''}${s.hasResources ? ' · resources' : ''}</span></div>
      <div class="hint truncate mono">${esc(s.cfg.url || s.cfg.command || '')}</div>
      ${s.error ? `<div class="text-rd text-[12px] leading-snug">${esc(s.error)}</div>` : ''}
      <div class="flex flex-wrap gap-2 items-center mt-1">
        <select class="field mcp-ex" aria-label="Exposure for ${esc(s.name)}" style="width:auto;min-height:34px;padding:4px 8px">${MCP_EXPOSURES.map(e => `<option ${e === ex ? 'selected' : ''}>${e}</option>`).join('')}</select>
        <button type="button" class="btn btn-ghost" data-mcp="toggle">${s.cfg.enabled === false ? 'Enable' : 'Disable'}</button>
        <button type="button" class="btn btn-ghost" data-mcp="reconnect">Reconnect</button>
        ${n ? `<button type="button" class="btn btn-ghost" data-mcp="tools">Tools</button>` : ''}
        <button type="button" class="btn btn-ghost" data-mcp="remove">Remove</button>
      </div>
      <div class="mcp-tools" hidden></div>
    </div>`;
  }).join('');
  box.innerHTML = cfgErr + (rows || '<div class="hint">No MCP servers yet. Add one below or edit Pandora/mcp.json.</div>');
  const n = mcpConnected().length; const chip = $('#mcpCount'); if (chip) chip.textContent = MCP.servers.size ? `${n}/${MCP.servers.size} connected` : '';
}
$('#mcpList').addEventListener('change', e => {
  const sel = e.target.closest('.mcp-ex'); if (!sel) return; const name = sel.closest('[data-srv]').dataset.srv;
  try { writeMcpConfig(m => { m[name].exposure = sel.value; }); toast(`${esc(name)}: exposure set to ${sel.value}`, 'ok'); } catch (err) { toast(esc(err.message), 'err'); }
});
$('#mcpList').addEventListener('click', async e => {
  const b = e.target.closest('[data-mcp]'); if (!b) return; const row = b.closest('[data-srv]'); const name = row.dataset.srv; const srv = MCP.servers.get(name);
  try {
    if (b.dataset.mcp === 'reconnect') { if (srv) await mcpConnect(srv); toast(srv?.state === 'connected' ? `${esc(name)} connected` : `${esc(name)}: ${esc(srv?.error || 'failed')}`, srv?.state === 'connected' ? 'ok' : 'err'); }
    else if (b.dataset.mcp === 'toggle') writeMcpConfig(m => { if (m[name].enabled === false) delete m[name].enabled; else m[name].enabled = false; });
    else if (b.dataset.mcp === 'remove') { if (b.dataset.armed) writeMcpConfig(m => { delete m[name]; }); else { b.dataset.armed = 1; b.textContent = 'Confirm remove'; b.style.color = 'var(--rd)'; } }
    else if (b.dataset.mcp === 'tools') {
      const box = row.querySelector('.mcp-tools'); box.hidden = !box.hidden;
      box.innerHTML = srv.tools.map(t => { const ex = mcpExposureFor(srv, t.name); return `<div class="mcp-tool"><span class="mono text-cy">${esc(mcpToolName(name, t.name))}</span> <span class="hint">${ex}</span><div class="text-[12.5px] text-dim leading-snug">${esc((t.description || '').slice(0, 220))}</div></div>`; }).join('');
    }
  } catch (err) { toast(esc(err.message), 'err'); }
});
$('#btnMcpAdd').onclick = () => {
  const name = $('#mcpName').value.trim(), url = $('#mcpUrl').value.trim(), hdr = $('#mcpHeader').value.trim(), ex = $('#mcpExposure').value;
  const cfg = { url }; if (ex !== 'codemode') cfg.exposure = ex;
  if (hdr) { const i = hdr.indexOf(':'); if (i < 1) return toast('Header must look like "Authorization: Bearer ${TOKEN}"', 'err'); cfg.headers = { [hdr.slice(0, i).trim()]: hdr.slice(i + 1).trim() }; }
  const bad = mcpServerValidate(name, cfg); if (bad) return toast(esc(bad), 'err');
  try { writeMcpConfig(m => { m[name] = cfg; }); $('#mcpName').value = $('#mcpUrl').value = $('#mcpHeader').value = ''; toast(`Added ${esc(name)}; connecting…`, 'ok'); } catch (err) { toast(esc(err.message), 'err'); }
};
$('#btnMcpEdit').onclick = () => { closeSettings(); ensureMcpFile(); openFile(MCP_PATH, { mode: 'edit' }); };
function renderMcpSettings() { $('#mcpSecrets').value = Object.entries(S.mcpSecrets || {}).map(([k, v]) => `${k}=${v}`).join('\n'); renderMcpPanel(); }
function readMcpSettings() { const o = {}; for (const l of $('#mcpSecrets').value.split('\n')) { const i = l.indexOf('='); if (i > 0) o[l.slice(0, i).trim()] = l.slice(i + 1).trim(); } const changed = JSON.stringify(o) !== JSON.stringify(S.mcpSecrets || {}); S.mcpSecrets = o; if (changed) setTimeout(() => mcpReload({ force: true }), 100); }

/* ---------- `mcp` shell command (the pi mcp … CLI) ---------- */
async function mcpShell(c) {
  const [sub, ...rest] = c.argv; const o = s => c.o(s + '\n');
  if (!sub || sub === 'list') {
    if (!MCP.servers.size) { o('no MCP servers (add one: mcp add <name> <url> [--header "K: V"] [--exposure codemode|deferred|direct|hidden])'); return 0; }
    let bad = 0; for (const s of MCP.servers.values()) { o(`${s.name.padEnd(16)} ${s.state.padEnd(10)} ${String(s.tools?.length || 0).padStart(3)} tool${(s.tools?.length || 0) === 1 ? ' ' : 's'}  ${(s.cfg.exposure || 'codemode').padEnd(8)} ${s.cfg.url || s.cfg.command || ''}${s.error ? '\n    ' + s.error : ''}`); if (s.cfg.enabled !== false && s.state !== 'connected') bad = 1; } return bad;
  }
  if (sub === 'add') {
    const [name, url] = rest.filter(x => !x.startsWith('--')); if (!name || !url) { c.e('usage: mcp add <name> <url> [--header "K: V"] [--exposure X] [--description "…"]\n'); return 2; }
    const cfg = { url }; for (let i = 0; i < rest.length; i++) { if (rest[i] === '--header') { const h = rest[++i] || ''; const k = h.indexOf(':'); (cfg.headers ||= {})[h.slice(0, k).trim()] = h.slice(k + 1).trim(); } if (rest[i] === '--exposure') cfg.exposure = rest[++i]; if (rest[i] === '--description') cfg.description = rest[++i]; }
    const bad = mcpServerValidate(name, cfg); if (bad) { c.e(`mcp: ${bad}\n`); return 1; }
    writeMcpConfig(m => { m[name] = cfg; }); MCP.cfgText = vfs.read(MCP_PATH); await mcpReload(); const s = MCP.servers.get(name);
    for (let i = 0; i < 100 && s?.state === 'connecting'; i++) await new Promise(r => setTimeout(r, 100));
    o(`${name}: ${s?.state}${s?.state === 'connected' ? ` (${s.tools.length} tool${s.tools.length === 1 ? '' : 's'})` : s?.error ? ' — ' + s.error : ''}`); return s?.state === 'connected' ? 0 : 1;
  }
  if (sub === 'remove') { const n = rest[0]; if (!n) { c.e('usage: mcp remove <name>\n'); return 2; } writeMcpConfig(m => { delete m[n]; }); o(`removed ${n}`); return 0; }
  if (sub === 'reconnect') { const list = rest[0] ? [MCP.servers.get(rest[0])].filter(Boolean) : [...MCP.servers.values()].filter(s => s.cfg.enabled !== false && s.state !== 'invalid'); for (const s of list) { await mcpConnect(s); o(`${s.name}: ${s.state}${s.error ? ' — ' + s.error : ''}`); } return 0; }
  if (sub === 'tools') { const ts = mcpAllTools().filter(t => !rest[0] || t.server === rest[0]); for (const t of ts) o(`${t.name}  [${t.exposure}]  ${t.description.split('\n')[0].slice(0, 100)}`); if (!ts.length) o('no tools'); return 0; }
  if (sub === 'call') { const [name, json] = rest; let args = {}; try { args = json ? JSON.parse(json) : {}; } catch { c.e('mcp call: arguments must be JSON\n'); return 2; } const res = await mcpCallRaw(name, args); o(await mcpResultText(res, String(name).split('__').pop())); return res?.isError ? 1 : 0; }
  c.e('usage: mcp [list|add|remove|reconnect|tools|call]\n'); return 2;
}
