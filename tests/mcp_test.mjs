import { autoTabs } from './_tabs.mjs';
import pw from 'playwright';
import fs from 'node:fs';
const { chromium } = pw;
const URL_ = process.argv[2] || 'file://' + process.env.JV_WEB;
const OUT = process.cwd() + '/mshots2'; fs.mkdirSync(OUT, { recursive: true });
const css = fs.readFileSync('tw.css', 'utf8');
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS', 'Access-Control-Expose-Headers': 'Mcp-Session-Id' };
const log = [], fail = []; const ok = (c, m) => (c ? log : fail).push((c ? 'PASS ' : 'FAIL ') + m);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
await ctx.addInitScript(() => { if (!localStorage.getItem('jvault:settings')) localStorage.setItem('jvault:settings', JSON.stringify({ model: 'qwen3:8b', journalOn: false, mcpSecrets: { CALC_TOKEN: 'secret123' } })); });
const page = autoTabs(await ctx.newPage());
page.on('pageerror', e => fail.push('[pageerror] ' + e.message));
const chats = []; const mcpLog = []; let expireNotes = false; let notesSession = 'sessA-1';
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
function mcpServer(name, req) {
  const b = JSON.parse(req.postData() || '{}'); const h = req.headers(); mcpLog.push({ name, method: b.method, sid: h['mcp-session-id'], pv: h['mcp-protocol-version'], auth: h.authorization });
  if (name === 'calc' && h.authorization !== 'Bearer secret123') return { status: 401, body: { error: { message: 'unauthorized' } } };
  if (b.method === 'initialize') {
    if (name === 'notes') notesSession = 'sessA-' + Math.random().toString(36).slice(2, 6);
    return { headers: { 'Mcp-Session-Id': name === 'notes' ? notesSession : 'sess-' + name }, body: { jsonrpc: '2.0', id: b.id, result: { protocolVersion: '2025-06-18', capabilities: { tools: {}, ...(name === 'notes' ? { resources: {} } : {}) }, serverInfo: { name, version: '1.0' }, instructions: name === 'notes' ? 'Use get_weather for forecasts.' : '' } } };
  }
  if (b.method === 'notifications/initialized') return { status: 202 };
  if (name === 'notes' && expireNotes && h['mcp-session-id']) { expireNotes = false; return { status: 404, body: { error: { message: 'session not found' } } }; }
  const R = result => ({ body: { jsonrpc: '2.0', id: b.id, result } });
  if (b.method === 'tools/list') {
    if (name === 'notes') return R(!b.params?.cursor ? { tools: [{ name: 'get_weather', description: 'Get the weather forecast for a city', inputSchema: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] } }], nextCursor: 'p2' }
      : { tools: [{ name: 'add', description: 'Add two numbers', inputSchema: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } } } }, { name: 'snapshot', description: 'Take a picture', inputSchema: { type: 'object', properties: {} } }] });
    if (name === 'docs') return R({ tools: [{ name: 'search_docs', description: 'Search the documentation library for pages about a topic', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } }, { name: 'fetch_page', description: 'Fetch a documentation page by url', inputSchema: { type: 'object', properties: { url: { type: 'string' } } } }] });
    if (name === 'calc') return R({ tools: [{ name: 'multiply', description: 'Multiply two numbers', inputSchema: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } }, required: ['a', 'b'] } }] });
  }
  if (b.method === 'tools/call') {
    const { name: t, arguments: a } = b.params;
    if (t === 'get_weather') return R({ content: [{ type: 'text', text: `Sunny in ${a.city}, 21°C` }] });
    if (t === 'add') return R({ content: [{ type: 'text', text: String(a.a + a.b) }], structuredContent: { sum: a.a + a.b } });
    if (t === 'snapshot') return R({ content: [{ type: 'image', data: PNG, mimeType: 'image/png' }] });
    if (t === 'search_docs') return { sse: true, events: [{ jsonrpc: '2.0', method: 'notifications/progress', params: { progressToken: 'x', progress: 1, total: 2 } }, { jsonrpc: '2.0', id: b.id, result: { content: [{ type: 'text', text: `3 pages about ${a.query}: intro.md, api.md, faq.md` }] } }] };
    if (t === 'multiply') return R({ content: [{ type: 'text', text: String(a.a * a.b) }] });
    return R({ content: [{ type: 'text', text: 'unknown tool' }], isError: true });
  }
  if (b.method === 'resources/list') return R({ resources: [{ uri: 'res://hello', name: 'hello', mimeType: 'text/plain' }] });
  if (b.method === 'resources/templates/list') return R({ resourceTemplates: [{ uriTemplate: 'res://day/{date}', name: 'day' }] });
  if (b.method === 'resources/read') return R({ contents: [{ uri: b.params.uri, text: 'Hello from a resource' }] });
  return { body: { jsonrpc: '2.0', id: b.id, error: { code: -32601, message: 'no method ' + b.method } } };
}
let script = [];
await page.route('**/*', async route => {
  const req = route.request(); const url = req.url();
  if (url.startsWith('file://') || url.startsWith('data:') || url.startsWith('blob:')) return route.continue();
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
  if (url.startsWith('https://cdn.tailwindcss.com/')) return route.fulfill({ contentType: 'text/javascript', body: `window.tailwind={};(function(){var s=document.createElement('style');s.textContent=${JSON.stringify(css)};document.head.prepend(s);})();` });
  if (url.includes('marked.min.js')) return route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(process.env.JV_NM + 'marked/lib/marked.umd.js', 'utf8') });
  if (url.includes('katex.min.js')) return route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(process.env.JV_NM + 'katex/dist/katex.min.js', 'utf8') });
  if (url.includes('purify.min.js')) return route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(process.env.JV_NM + 'dompurify/dist/purify.min.js', 'utf8') });
  const m = /^https:\/\/(notes|docs|calc)\.example\.com\/mcp/.exec(url);
  if (m) {
    if (req.method() === 'DELETE') return route.fulfill({ status: 200, headers: CORS, body: '' });
    const r = mcpServer(m[1], req);
    if (r.sse) return route.fulfill({ status: 200, headers: { ...CORS, 'Content-Type': 'text/event-stream' }, body: r.events.map(e => `event: message\ndata: ${JSON.stringify(e)}\n\n`).join('') });
    return route.fulfill({ status: r.status || 200, headers: { ...CORS, ...(r.headers || {}), 'Content-Type': 'application/json' }, body: r.body ? JSON.stringify(r.body) : '' });
  }
  if (url === 'http://localhost:11434/api/tags') return route.fulfill({ headers: CORS, contentType: 'application/json', body: JSON.stringify({ models: [{ name: 'qwen3:8b' }] }) });
  if (url === 'http://localhost:11434/api/chat') {
    const b = JSON.parse(req.postData()); chats.push(b);
    const step = script.shift() || { content: 'Done.' };
    const lines = [{ message: { role: 'assistant', content: step.content || '', ...(step.tool ? { tool_calls: [{ function: { name: step.tool, arguments: step.args } }] } : {}) }, done: false }, { message: { role: 'assistant', content: '' }, done: true }];
    return route.fulfill({ headers: CORS, contentType: 'application/x-ndjson', body: lines.map(l => JSON.stringify(l)).join('\n') + '\n' });
  }
  return route.abort();
});
await page.goto(URL_);
await page.waitForFunction(() => /BUSYBOX|JS APPLETS/.test(document.querySelector('#txtShell')?.textContent || '') && typeof mcpReload === 'function', null, { timeout: 90000 });
await page.waitForTimeout(800);
ok(await page.evaluate(() => vfs.isFile('/Pandora/mcp.json') && JSON.parse(vfs.read('/Pandora/mcp.json')).mcpServers && MCP.servers.size === 0), 'mcp.json seeded empty');
ok(await page.evaluate(() => !activeTools().some(t => ['codemode', 'tool_search'].includes(t.function.name))), 'no MCP tools without servers');
// write config (live reload, like editing the note)
await page.evaluate(() => vfs.write('/Pandora/mcp.json', JSON.stringify({ mcpServers: {
  notes: { url: 'https://notes.example.com/mcp', description: 'Weather and maths helpers' },
  docs: { url: 'https://docs.example.com/mcp', exposure: 'deferred' },
  calc: { url: 'https://calc.example.com/mcp', exposure: 'direct', headers: { Authorization: 'Bearer ${CALC_TOKEN}' } },
  local_fs: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem'] },
  old: { url: 'https://old.example.com/sse', type: 'sse' },
} }, null, 2)));
await page.waitForFunction(() => ['notes', 'docs', 'calc'].every(n => MCP.servers.get(n)?.state === 'connected'), null, { timeout: 15000 }).catch(() => {});
const st = await page.evaluate(() => Object.fromEntries([...MCP.servers.values()].map(s => [s.name, s.state + ':' + (s.tools?.length || 0)])));
ok(st.notes === 'connected:3' && st.docs === 'connected:2' && st.calc === 'connected:1', 'servers connected in background (paged tool list): ' + JSON.stringify(st));
ok(st.local_fs === 'invalid:0' && st.old === 'invalid:0', 'stdio and legacy SSE entries rejected');
const errs = await page.evaluate(() => [MCP.servers.get('local_fs').error, MCP.servers.get('old').error]);
ok(/supergateway/.test(errs[0]) && /legacy SSE/.test(errs[1]), 'helpful errors for stdio/SSE');
const sess = mcpLog.filter(x => x.name === 'notes' && x.method === 'tools/list');
ok(sess.length === 2 && sess.every(x => /^sessA-/.test(x.sid) && x.pv === '2025-06-18'), 'session id + protocol version headers sent');
ok(mcpLog.some(x => x.name === 'calc' && x.method === 'tools/list' && x.auth === 'Bearer secret123'), '${SECRET} header resolved from MCP secrets');
const names = await page.evaluate(() => activeTools().map(t => t.function.name));
ok(names.includes('codemode') && names.includes('tool_search') && names.includes('mcp__calc__multiply') && names.includes('read_mcp_resource'), 'codemode, tool_search, resource tools and direct tool declared');
ok(!names.includes('mcp__notes__get_weather') && !names.includes('mcp__docs__search_docs'), 'codemode and deferred tools NOT declared');
const cmDesc = await page.evaluate(() => activeTools().find(t => t.function.name === 'codemode').function.description);
ok(/mcp__notes \(3 tools\): Weather and maths helpers/.test(cmDesc) && !/get_weather/.test(cmDesc), 'codemode description lists namespaces, not tools');
const sp = await page.evaluate(() => systemPrompt());
ok(/MCP servers \(connected\):/.test(sp) && /Server instructions: Use get_weather/.test(sp), 'system prompt lists servers + instructions');
// ---------- agent: codemode → tool_search → loaded deferred tool → direct tool ----------
script = [
  { tool: 'codemode', args: { code: `const [w, s] = await Promise.all([tools.mcp__notes__get_weather({ city: 'Detroit' }), tools.mcp__notes__add({ a: 2, b: 3 })]);
const found = searchTools('weather forecast');
const notes = await tools.notes_search({ query: 'graph' });
const d = describeTool('mcp__notes__add');
store('last', { city: 'Detroit' });
console.log(w.content[0].text);
return { sum: s.structuredContent.sum, found: found.map(f => f.name), notesIsText: typeof notes === 'string' && notes.includes('Graph View'), schema: Object.keys(d.inputSchema.properties), net: typeof fetch, all: ALL_TOOLS.includes('mcp__calc__multiply') };` } },
  { tool: 'tool_search', args: { query: 'search documentation' } },
  { tool: 'mcp__docs__search_docs', args: { query: 'heartbeat' } },
  { tool: 'mcp__calc__multiply', args: { a: 6, b: 7 } },
  { content: 'Sunny in Detroit; 2+3=5; docs found; 6×7=42.' },
];
await page.fill('#input', 'Use the MCP tools please'); await page.tap('#btnSend');
await page.waitForFunction(() => !running && /6×7=42/.test(document.querySelector('#chat').textContent), null, { timeout: 30000 }).catch(() => {});
const toolMsgs = chats.at(-1).messages.filter(m => m.role === 'tool');
const cm = toolMsgs[0]?.content || '';
ok(/Sunny in Detroit, 21°C/.test(cm) && /"sum": 5/.test(cm) && /mcp__notes__get_weather/.test(cm) && /"notesIsText": true/.test(cm), 'codemode ran MCP + built-in tools: ' + cm.slice(0, 160).replace(/\n/g, ' '));
ok(/"net": "undefined"/.test(cm) && /"schema": \[\s*"a",\s*"b"\s*\]/.test(cm) && /"all": true/.test(cm), 'sandbox has no network; describeTool and ALL_TOOLS work');
ok(await page.evaluate(() => cur.codemodeStore?.last?.city === 'Detroit'), 'store() persisted in the chat');
ok(/Loaded 1 tool/.test(toolMsgs[1]?.content || '') && /mcp__docs__search_docs\(query: string\)/.test(toolMsgs[1].content), 'tool_search loaded the deferred tool: ' + (toolMsgs[1]?.content || '').slice(0, 100));
const declaredAfter = chats[2].tools.map(t => t.function.name);
ok(!chats[1].tools.some(t => t.function.name === 'mcp__docs__search_docs') && declaredAfter.includes('mcp__docs__search_docs') && !declaredAfter.includes('mcp__docs__fetch_page'), 'loaded tool declared from the next model call only');
ok(/3 pages about heartbeat/.test(toolMsgs[2]?.content || ''), 'deferred tool call over SSE (with progress) works');
ok(toolMsgs[3]?.content === '42', 'direct tool works');
await page.screenshot({ path: OUT + '/1_chat.png' });
// codemode errors
const errsCM = await page.evaluate(async () => { const r = {}; const t = async (code) => { try { return await runCodemode(code, null); } catch (e) { return 'ERR ' + e.message; } };
  r.syntax = await t('return (1 +'); r.unknown = await t('return await tools.mcp__notes__get_wether({city:"x"})'); r.timeout = await t('// @options {"timeout": 1}\nawait new Promise(() => {});');
  r.img = await t('const p = await tools.mcp__notes__snapshot({}); image(p.content[0]); return "ok"'); r.empty = await t('const x = 1;'); return r; });
ok(/^ERR/.test(errsCM.syntax), 'syntax error reported');
ok(/no tool named mcp__notes__get_wether. Tools on that server: mcp__notes__get_weather/.test(errsCM.unknown) && !/Error: Error/.test(errsCM.unknown), 'unknown tool error: ' + errsCM.unknown.slice(0, 120));
ok(/stopped after 1s/.test(errsCM.timeout), 'timeout option works');
ok(/image 1 saved to \/attachments\/mcp\//.test(errsCM.img), 'image() saved into the vault: ' + errsCM.img.slice(0, 120));
ok(/returned nothing/.test(errsCM.empty), 'empty script hint');
// resources
const res = await page.evaluate(async () => [await runTool('list_mcp_resources', {}, null), await runTool('read_mcp_resource', { server: 'notes', uri: 'res://hello' }, null), await runTool('list_mcp_resource_templates', { server: 'notes' }, null)]);
ok(/res:\/\/hello/.test(res[0]) && res[1] === 'Hello from a resource' && /res:\/\/day\/\{date\}/.test(res[2]), 'resource tools');
// session expiry → re-initialize
expireNotes = true;
const re = await page.evaluate(async () => (await runCodemode('return (await tools.mcp__notes__add({a: 1, b: 1})).structuredContent.sum', null)));
ok(/^2$/.test(re.trim()), 'expired session re-initialised transparently');
// ---------- shell: mcp CLI ----------
await page.tap('.tab[data-tab="term"]'); await page.waitForTimeout(200);
for (const c of ['mcp list', 'mcp tools docs', `mcp call mcp__notes__add '{"a":40,"b":2}'`]) { await page.fill('#termCmd', c); await page.press('#termCmd', 'Enter'); await page.waitForTimeout(1200); }
const tt = await page.evaluate(() => document.querySelector('#term').innerText);
ok(/notes\s+connected\s+3 tools\s+codemode/.test(tt) && /local_fs\s+invalid/.test(tt), 'mcp list');
ok(/mcp__docs__search_docs\s+\[deferred\]/.test(tt), 'mcp tools');
ok(/\n42\n/.test(tt), 'mcp call');
await page.screenshot({ path: OUT + '/2_shell.png' });
// ---------- /mcp panel ----------
await page.tap('.tab[data-tab="chat"]');
await page.fill('#input', '/mcp'); await page.tap('#btnSend'); await page.waitForTimeout(500);
ok(!(await page.isHidden('#settings')) && await page.locator('#mcpList .mcp-row').count() === 5 && /3\/5 connected/.test(await page.textContent('#mcpCount')), '/mcp opens the server panel');
await page.locator('.mcp-row[data-srv="notes"] [data-mcp="tools"]').tap(); await page.waitForTimeout(200);
ok(await page.locator('.mcp-row[data-srv="notes"] .mcp-tool').count() === 3, 'inspect tools');
await page.locator('.mcp-row[data-srv="notes"]').scrollIntoViewIfNeeded(); await page.screenshot({ path: OUT + '/3_panel.png' });
const initsBefore = mcpLog.filter(x => x.name === 'notes' && x.method === 'initialize').length;
await page.selectOption('.mcp-row[data-srv="notes"] .mcp-ex', 'direct'); await page.waitForTimeout(900);
const after = await page.evaluate(() => ({ ex: JSON.parse(vfs.read('/Pandora/mcp.json')).mcpServers.notes.exposure, names: activeTools().map(t => t.function.name) }));
ok(after.ex === 'direct' && after.names.includes('mcp__notes__get_weather'), 'exposure change written to mcp.json and applied');
ok(mcpLog.filter(x => x.name === 'notes' && x.method === 'initialize').length === initsBefore, 'exposure change did not reconnect');
await page.locator('.mcp-row[data-srv="docs"] [data-mcp="toggle"]').tap(); await page.waitForTimeout(800);
ok(await page.evaluate(() => MCP.servers.get('docs').state === 'disabled' && JSON.parse(vfs.read('/Pandora/mcp.json')).mcpServers.docs.enabled === false && !activeTools().some(t => t.function.name === 'tool_search')), 'disable server');
// add via form
await page.fill('#mcpName', 'calc2'); await page.fill('#mcpUrl', 'https://calc.example.com/mcp'); await page.fill('#mcpHeader', 'Authorization: Bearer ${CALC_TOKEN}');
await page.tap('#btnMcpAdd'); await page.waitForTimeout(1500);
ok(await page.evaluate(() => MCP.servers.get('calc2')?.state === 'connected'), 'add server from the panel');
// secrets are not in mcp.json and stay out of backups unless keys are included
ok(await page.evaluate(() => !vfs.read('/Pandora/mcp.json').includes('secret123')), 'secret stays out of the vault');
const bk = await page.evaluate(async () => { const a = await buildBackup('config', false); const b = await buildBackup('config', true); return [!!a.settings.mcpSecrets, !!b.settings.mcpSecrets, !!a.vault.files['/Pandora/mcp.json']]; });
ok(JSON.stringify(bk) === '[false,true,true]', 'backup: mcp.json included, secrets only with keys');
await page.screenshot({ path: OUT + '/4_panel2.png' });
console.log(log.join('\n')); console.log('\n' + (fail.length ? fail.join('\n') : 'ALL PASS'));
await browser.close();
