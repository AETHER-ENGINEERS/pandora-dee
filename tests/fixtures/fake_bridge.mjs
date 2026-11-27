// A stand-in for pandora-discord / pandora-vector: the same MCP over HTTP (POST /mcp, a bearer token, JSON answers),
// with the tools the Atelier uses most. Messages to hand out are put in through /admin/inject; what was sent can be
// read at /admin/sent. FAKE_PORT and FAKE_TOKEN come from the environment.
import http from 'node:http';
const port = Number(process.env.FAKE_PORT), token = process.env.FAKE_TOKEN || '';
const inbox = [], sent = [];
const TOOLS = ['get_new_messages', 'send_message', 'status', 'list_channels', 'react', 'send_typing'].map((name) => ({ name, description: `fake ${name}`, inputSchema: { type: 'object', properties: {} } }));
const text = (t) => ({ content: [{ type: 'text', text: typeof t === 'string' ? t : JSON.stringify(t) }] });
http.createServer((req, res) => {
  let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => {
    const json = (s, o) => { res.writeHead(s, { 'Content-Type': 'application/json', 'Mcp-Session-Id': 'fake' }); res.end(JSON.stringify(o)); };
    if (req.url === '/admin/inject') { inbox.push(...JSON.parse(b)); return json(200, { ok: true }); }
    if (req.url === '/admin/sent') return json(200, sent);
    if (req.url !== '/mcp' || req.headers.authorization !== 'Bearer ' + token) return json(401, { error: 'unauthorized' });
    const m = JSON.parse(b || '{}');
    if (m.id == null) { res.writeHead(202); return res.end(); }
    const r = (result) => json(200, { jsonrpc: '2.0', id: m.id, result });
    if (m.method === 'initialize') return r({ protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'fake-bridge', version: '1' } });
    if (m.method === 'tools/list') return r({ tools: TOOLS });
    if (m.method === 'tools/call') {
      const { name, arguments: a = {} } = m.params || {};
      if (name === 'get_new_messages') return r(text(inbox.splice(0)));
      if (['send_message', 'react', 'send_typing'].includes(name)) { sent.push({ tool: name, ...a }); return r(text({ message_id: 'm' + sent.length, chat_id: a.chat_id })); }
      if (name === 'status') return r(text({ ready: true, user: 'fake-bot' }));
      if (name === 'list_channels') return r(text([{ id: 'general', name: 'general' }]));
    }
    return json(200, { jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'no' } });
  });
}).listen(port, '127.0.0.1', () => console.log('fake bridge on', port));
