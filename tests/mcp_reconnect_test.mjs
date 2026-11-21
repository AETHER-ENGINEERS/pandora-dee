// MCP entries that can't work say why, even on Reconnect (it used to try to reach "undefined" and blame CORS);
// serverUrl / httpUrl work as the address; a "command" entry that also has a "url" connects through the url.
import { start } from './_harness.mjs';
const { page, ok, done } = await start();
const E = (fn, arg) => page.evaluate(fn, arg);

// a small MCP server over streamable HTTP
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Expose-Headers': '*' };
let hits = 0;
await page.route('http://mcp.test/**', async route => {
  const req = route.request(); hits++;
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
  if (req.method() === 'DELETE') return route.fulfill({ status: 200, headers: CORS, body: '' });
  const b = JSON.parse(req.postData() || '{}');
  if (b.method === 'notifications/initialized') return route.fulfill({ status: 202, headers: CORS, body: '' });
  const result = b.method === 'initialize' ? { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'multi', version: '1' } }
    : b.method === 'tools/list' ? { tools: [{ name: 'hello', description: 'Say hello', inputSchema: { type: 'object', properties: {} } }] } : {};
  return route.fulfill({ headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: b.id, result }) });
});

await E(() => vfs.write('/Pandora/mcp.json', JSON.stringify({ mcpServers: {
  'stdio-only': { command: 'node', args: ['/Pandora/mcp/multi/server.js'], transport: 'stdio', exposure: 'direct' },
  'windsurf-style': { serverUrl: 'http://mcp.test/a/mcp' },
  'gemini-style': { httpUrl: 'http://mcp.test/b/mcp' },
  'stdio-with-bridge': { command: 'node', args: ['server.js'], url: 'http://mcp.test/c/mcp' },
} }, null, 2)));
await page.waitForFunction(() => ['windsurf-style', 'gemini-style', 'stdio-with-bridge'].every(n => MCP.servers.get(n)?.state === 'connected') && MCP.servers.get('stdio-only')?.state === 'invalid', null, { timeout: 15000 }).catch(() => {});
const st = await E(() => Object.fromEntries([...MCP.servers.values()].map(s => [s.name, { state: s.state, error: s.error, tools: (s.tools || []).length }])));
ok(st['stdio-only']?.state === 'invalid' && /stdio servers \("command"\) cannot run in a browser/.test(st['stdio-only'].error), 'a command-only entry is invalid and says why: ' + JSON.stringify(st['stdio-only']));
ok(st['windsurf-style']?.state === 'connected' && st['windsurf-style'].tools === 1, 'serverUrl works as the address: ' + JSON.stringify(st['windsurf-style']));
ok(st['gemini-style']?.state === 'connected', 'httpUrl works as the address: ' + JSON.stringify(st['gemini-style']));
ok(st['stdio-with-bridge']?.state === 'connected', 'a command entry that also has a url connects through the url: ' + JSON.stringify(st['stdio-with-bridge']));

// Reconnect on the invalid one: the same reason, no request sent, no "undefined"
const before = hits;
await page.fill('#input', '/mcp reconnect stdio-only'); await E(() => document.querySelector('#btnSend').click());
await page.waitForTimeout(800);
const after = await E(() => ({ state: MCP.servers.get('stdio-only').state, error: MCP.servers.get('stdio-only').error }));
ok(after.state === 'invalid' && /cannot run in a browser/.test(after.error) && !/undefined/.test(after.error), 'Reconnect says why instead of trying: ' + JSON.stringify(after));
ok(hits === before, 'and sends nothing');

// fixed the way it should be: connects
await E(() => { const j = JSON.parse(vfs.read('/Pandora/mcp.json')); j.mcpServers['stdio-only'] = { url: 'http://mcp.test/d/mcp', exposure: 'direct' }; vfs.write('/Pandora/mcp.json', JSON.stringify(j, null, 2)); });
await page.waitForFunction(() => MCP.servers.get('stdio-only')?.state === 'connected', null, { timeout: 15000 }).then(() => ok(true, 'given a url, it connects'), () => ok(false, 'given a url, it connects'));
await done('mcp_reconnect_test');
