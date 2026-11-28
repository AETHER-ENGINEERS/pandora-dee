// Her loop on the host, the rest of its core (host/steer.cjs, host/mcp_client.cjs, host/loop.cjs): her steering and
// skills read as her Atelier reads them, her tool servers (HTTP with her secret header, and one the host starts), tool
// search for the ones not declared up front, a helper she can delegate to, and the context guard that summarises a
// conversation about to outgrow her context. A stand-in model, a stand-in tool server, synthetic homes only.
import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(process.env.JV_WEB), '..');
const { createHomeHost } = require(path.join(ROOT, 'host', 'home_host.cjs'));
const { createMcp } = require(path.join(ROOT, 'host', 'mcp_client.cjs'));
const log = []; const fail = [];
const ok = (c, m) => { (c ? log : fail).push((c ? 'PASS ' : 'FAIL ') + m); };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-host-loop2-'));
const HOME = path.join(tmp, 'home');
const w = (vp, t) => { const f = path.join(HOME, ...vp.split('/').filter(Boolean)); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t); };
w('/Pandora/SOUL.md', '---\nname: Stand-in\n---\n# SOUL\n\nI am a made-up stand-in. <!-- a note for the person only -->\n');
w('/AGENTS.md', '# AGENTS\n\nAlways sign off with a small star.\n');
w('/Pandora/skills/tea/SKILL.md', '---\nname: tea\ndescription: Make a cup of tea. Use when someone asks for tea.\n---\n1. Boil water.\n2. Steep for three minutes.\n');
w('/Pandora/skills/tea/notes.md', 'Green tea likes cooler water.');
w('/Pandora/skills/garden/SKILL.md', '---\nname: garden\ndescription: Look after the garden.\n---\nWater the tomatoes.\n');

// ---------- a stand-in tool server (streamable HTTP), checking her secret header ----------
let authSeen = '';
const tools = http.createServer((req, res) => {
  let b = ''; req.on('data', (d) => { b += d; }); req.on('end', () => {
    authSeen = req.headers.authorization || '';
    if (authSeen !== 'Bearer made-up-token') { res.writeHead(401); return res.end(); }
    const j = JSON.parse(b || '{}');
    if (!('id' in j)) { res.writeHead(202); return res.end(); }
    const reply = (result) => { res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Mcp-Session-Id': 's1' }); res.end(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: j.id, result })}\n\n`); };
    if (j.method === 'initialize') return reply({ protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'wx' } });
    if (j.method === 'tools/list') return reply({ tools: [{ name: 'ping', description: 'Check the weather station answers.', inputSchema: { type: 'object', properties: {} } }, { name: 'forecast', description: 'The weather forecast for tomorrow.', inputSchema: { type: 'object', properties: {} } }] });
    if (j.method === 'tools/call') return reply({ content: [{ type: 'text', text: j.params.name === 'ping' ? 'pong' : 'sunny and mild' }] });
    reply({});
  });
});
await new Promise((r) => tools.listen(0, '127.0.0.1', r));
// ---------- a tiny stdio tool server, for the host to start ----------
const stdioScript = path.join(tmp, 'echo-server.cjs');
fs.writeFileSync(stdioScript, `const rl = require('readline').createInterface({ input: process.stdin });
rl.on('line', (l) => { const j = JSON.parse(l); if (!('id' in j)) return; const out = (result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: j.id, result }) + '\\n');
  if (j.method === 'initialize') return out({ protocolVersion: '2025-06-18', capabilities: { tools: {} } });
  if (j.method === 'tools/list') return out({ tools: [{ name: 'echo', description: 'Say it back.', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } }] });
  if (j.method === 'tools/call') return out({ content: [{ type: 'text', text: 'echo: ' + j.params.arguments.text }] }); });`);
w('/Pandora/mcp.json', JSON.stringify({ mcpServers: {
  wx: { url: `http://127.0.0.1:${tools.address().port}/mcp`, headers: { Authorization: 'Bearer ${WX}' }, exposure: 'deferred', toolExposure: { ping: 'direct' } },
  local: { command: process.execPath, args: [stdioScript], exposure: 'direct' },
} }, null, 1));

// ---------- a stand-in model ----------
const seen = [];
const model = http.createServer((req, res) => {
  let body = ''; req.on('data', (d) => { body += d; }); req.on('end', () => {
    if (req.url.endsWith('/models')) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ data: [{ id: 'stand-in' }] })); }
    const j = JSON.parse(body || '{}'); seen.push(j);
    const msgs = j.messages || []; const last = msgs[msgs.length - 1] || {};
    const user = [...msgs].reverse().find((m) => m.role === 'user') || {};
    const say = (content, tc) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content, ...(tc ? { tool_calls: tc } : {}) } }] })); };
    const call = (name, args) => say('', [{ id: 'c' + seen.length, type: 'function', function: { name, arguments: JSON.stringify(args) } }]);
    if (/Summarise this earlier part/.test((msgs[0] || {}).content || '')) return say('A summary of the long talk before.');
    if (last.role === 'tool' && last.name === 'tool_search') return call('mcp__wx__forecast', {});
    if (last.role === 'tool') return say(`Done. (${String(last.content).slice(0, 600)})`);
    const t = String(user.content || '');
    if (/use the skill/i.test(t)) return call('skill', { name: 'tea' });
    if (/which skill/i.test(t)) return call('find_skill', { query: 'tea please' });
    if (/ping/i.test(t)) return call('mcp__wx__ping', {});
    if (/weather/i.test(t)) return call('tool_search', { query: 'weather forecast' });
    if (/echo/i.test(t)) return call('mcp__local__echo', { text: 'hello' });
    if (/ask a helper/i.test(t)) return call('delegate', { task: 'Please write a note.' });
    if (/write a note/i.test(t)) return call('write', { path: '/Notes/From the helper.md', content: 'The helper wrote this.' });
    return say('Hello.');
  });
});
await new Promise((r) => model.listen(0, '127.0.0.1', r));

const host = createHomeHost({ root: HOME, state: path.join(tmp, 'state'), id: 'fae', name: 'Fae (test)', napGraceMs: 600000 });
const fae = host.resident('fae');
fs.writeFileSync(path.join(tmp, 'state', 'atelier-secrets.json'), JSON.stringify({ mcpSecrets: { WX: 'made-up-token' } }));
fae.models.set({ brain: 'host', providers: { standin: { kind: 'openai', label: 'Stand-in', base: `http://127.0.0.1:${model.address().port}/v1`, enabled: true } }, roles: { chat: { provider: 'standin', model: 'stand-in' }, compaction: { provider: 'standin', model: 'stand-in' } } }, 'test');
const release = fae.nap.connect({ device: 'test', page: 'test' });
const rt = fae.startRuntime({ brain: 'host', schedulesMs: 3600000 });
const lastReq = () => seen.filter((x) => !/Summarise this earlier part/.test(((x.messages || [])[0] || {}).content || '')).at(-1);
try {
  // ---------- her steering and skills ----------
  const sys = fae.loop().system();
  ok(/made-up stand-in/.test(sys) && /small star/.test(sys) && !/a note for the person only/.test(sys), 'her prompt carries her SOUL and standing instructions, never the comments meant for the person');
  ok(/- tea: Make a cup of tea/.test(sys) && /- garden:/.test(sys), 'her skills are listed, as in her Atelier');
  let r = await rt.turn({ text: 'Please use the skill.' });
  ok(/Boil water/.test(r) && /notes\.md/.test(r), 'she loads a skill, with the files that come with it');
  fae.state.lsSet('skillsOff', ['garden'], 'test', 'test');
  ok(!/- garden:/.test(fae.loop().system()), 'a skill she has set aside (in her Atelier, kept on the host) is left out');
  r = await rt.turn({ text: 'Which skill for tea?' });
  ok(/- tea:/.test(r), 'she finds the right skill for a request');
  w('/Pandora/SYSTEM.md', 'You are a lighthouse keeper.');
  ok(/^You are a lighthouse keeper\./.test(fae.loop().system()) && /made-up stand-in/.test(fae.loop().system()), 'her SYSTEM.md replaces the base intro, and her SOUL stays');
  fs.rmSync(path.join(HOME, 'Pandora', 'SYSTEM.md'));

  // ---------- her tool servers ----------
  r = await rt.turn({ text: 'Ping the station.' });
  ok(/pong/.test(r) && authSeen === 'Bearer made-up-token', 'a direct tool of her HTTP tool server answers, with her secret header filled in on the host');
  const declared = lastReq().tools.map((t) => t.function.name);
  ok(declared.includes('mcp__wx__ping') && !declared.includes('mcp__wx__forecast'), 'direct tools are declared up front; deferred ones are not');
  r = await rt.turn({ text: 'What is the weather tomorrow?' });
  ok(/sunny and mild/.test(r) && lastReq().tools.some((t) => t.function.name === 'mcp__wx__forecast'), 'tool_search finds a deferred tool, and it is hers from the next step');
  r = await rt.turn({ text: 'Echo something.' });
  ok(/echo: hello/.test(r), 'a tool server the host starts itself (stdio) answers, with her hands on this computer');
  const trace = fs.readFileSync(path.join(tmp, 'state', 'trace.jsonl'), 'utf8') + fs.readFileSync(path.join(tmp, 'state', 'events.jsonl'), 'utf8');
  ok(!trace.includes('made-up-token'), 'her secret never reaches the trace or the log');
  const noHands = createMcp({ root: HOME, secrets: () => ({}), mayRun: () => false, log: () => {} });
  let refused = ''; try { await noHands.call('mcp__local__echo', { text: 'x' }); } catch (e) { refused = e.message; }
  ok(/needs her hands/.test(refused), 'without her hands on this computer, the host starts no server for her');
  noHands.close();

  // ---------- a helper ----------
  r = await rt.turn({ text: 'Please ask a helper.' });
  const helperReq = seen.find((x) => (x.messages || []).some((m) => m.role === 'user' && m.content === 'Please write a note.'));
  ok(/The helper says/.test(r) && fs.readFileSync(path.join(HOME, 'Notes', 'From the helper.md'), 'utf8') === 'The helper wrote this.', 'she hands a task to a helper, which does it with her tools');
  ok(helperReq && !helperReq.tools.some((t) => t.function.name === 'delegate'), 'a helper can\'t hand work on again');

  // ---------- the context guard ----------
  fae.models.set({ roles: { chat: { numCtx: 400 } } }, 'test');
  fae.state.lsSet('settings', { compactPct: 50, compactKeep: 1 }, 'test', 'test');
  const long = Array.from({ length: 12 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `Earlier line ${i}: ` + 'lorem ipsum dolor sit amet '.repeat(12) }));
  r = await rt.turn({ text: 'Hello again.', history: long });
  const sent = lastReq().messages;
  ok(sent.some((m) => m.role === 'system' && /Earlier in this conversation[\s\S]*A summary of the long talk before/.test(m.content)) && !sent.some((m) => /Earlier line 0:/.test(m.content || '')), 'a conversation about to outgrow her context: the older part becomes a summary, the recent part stays');
  ok(sent.at(-1).content === 'Hello again.', 'and what was just said is kept whole');
} catch (e) {
  fail.push('FAIL threw: ' + (e && e.stack || e));
} finally {
  release();
  await host.close();
  model.close(); tools.close();
  await new Promise((r) => setTimeout(r, 200));
  fs.rmSync(tmp, { recursive: true, force: true });
}
for (const l of [...log, ...fail]) console.log(l);
console.log(fail.length ? `${fail.length} FAILED of ${log.length + fail.length}` : `ALL PASS (${log.length})`);
process.exit(fail.length ? 1 : 0);
