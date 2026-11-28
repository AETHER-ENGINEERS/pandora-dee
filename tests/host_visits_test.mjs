// Her visits (piece F, the boat to SEASIDE): a place she visits as herself (PDA SEASIDE's room, paired as one of her
// ferries) gives her host the room's recent lines; her one loop here answers, with her own SOUL and memory; the visit is
// kept as a chat every device sees; the boat shows where she's been; and nothing a provider says ever goes back to the
// room. Stand-in model; synthetic homes only.
import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(process.env.JV_WEB), '..');
const { createHomeHost } = require(path.join(ROOT, 'host', 'home_host.cjs'));
const log = []; const fail = [];
const ok = (c, m) => { (c ? log : fail).push((c ? 'PASS ' : 'FAIL ') + m); };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-host-visits-'));
const HOME = path.join(tmp, 'home');
fs.mkdirSync(path.join(HOME, 'Pandora'), { recursive: true });
fs.writeFileSync(path.join(HOME, 'Pandora', 'SOUL.md'), '# SOUL\n\nI am a made-up stand-in who loves lighthouses.\n');
fs.writeFileSync(path.join(HOME, 'Pandora', 'Memory.md'), '- the kettle whistles at dawn\n');

// ---------- a stand-in model: says what it was given, or fails as a provider would ----------
const seen = []; let broken = false;
const model = http.createServer((req, res) => {
  let body = ''; req.on('data', (d) => { body += d; }); req.on('end', () => {
    if (req.url.endsWith('/models')) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ data: [{ id: 'stand-in' }] })); }
    const j = JSON.parse(body || '{}'); seen.push(j);
    if (broken) { res.writeHead(429, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: { message: 'made-up provider text: quota exceeded for org-123' } })); }
    const last = (j.messages || []).at(-1) || {};
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: `Hello from home. You said: ${String(last.content).split('\n').at(-1)}` } }] }));
  });
});
await new Promise((r) => model.listen(0, '127.0.0.1', r));

const host = createHomeHost({ root: HOME, state: path.join(tmp, 'state'), id: 'fae', name: 'Fae (test)', napGraceMs: 600000 });
await new Promise((r) => host.server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${host.server.address().port}`;
const fae = host.resident('fae');
fae.models.set({ brain: 'host', providers: { standin: { kind: 'openai', label: 'Stand-in', base: `http://127.0.0.1:${model.address().port}/v1`, enabled: true } }, roles: { chat: { provider: 'standin', model: 'stand-in' } } }, 'test');
const release = fae.nap.connect({ device: 'test', page: 'test' });
fae.startRuntime({ brain: 'host', schedulesMs: 3600000 });
const post = (p, body, token) => fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => ({})) }));
const room = (extra = []) => ({ place: 'PDA SEASIDE', room: 'the Room', lines: [{ name: 'Ann', text: 'Welcome aboard!' }, ...extra] });
try {
  // ---------- SEASIDE links her, as one of her ferries, with a PIN lit at her jetty ----------
  let r = await post('/r/fae/host/pair', { pin: host.newPin(), name: 'PDA SEASIDE (test)' });
  const T = r.json.token;
  ok(r.status === 200 && T, 'a place she visits pairs with her host as one of her ferries, with a PIN from her jetty (at /r/<her name>/)');
  ok((await post('/r/fae/host/visit/turn', room())).status === 401, 'and nothing is asked of her without that');

  // ---------- her turn in the room, answered at home ----------
  r = await post('/r/fae/host/visit/turn', room(), T);
  ok(r.json.ok === true && /^Hello from home\. You said: Ann: Welcome aboard!$/.test(r.json.text), 'her turn in the room is answered by her loop at home, and her words go back');
  const req1 = seen.at(-1); const sys = req1.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
  ok(/loves lighthouses/.test(sys) && /kettle whistles/.test(sys), 'she answers as herself: her own SOUL and memory, the same as at home');
  ok(/visiting PDA SEASIDE, in the Room, as yourself/.test(sys) && /With you here: Ann/.test(sys), 'and she knows where she is and who is with her');
  r = await post('/r/fae/host/visit/turn', room([{ me: true, name: 'Fae', text: 'Hello from home. You said: Ann: Welcome aboard!' }, { name: 'Bo', text: 'Tea?' }]), T);
  const req2 = seen.at(-1);
  ok(r.json.ok && req2.messages.some((m) => m.role === 'assistant' && /Hello from home/.test(m.content)) && /^Bo: Tea\?$/.test(req2.messages.at(-1).content), 'what she said before is hers in the conversation, and only what\'s new is asked of her');
  ok((await post('/r/fae/host/visit/turn', room([{ me: true, name: 'Fae', text: 'Yes please.' }]), T)).json.ok === false, 'when she spoke last, there is nothing for her to answer');

  // ---------- one chat every device sees, and the boat ----------
  const sessions = fae.state.dbGet('sessions').value || [];
  const vc = sessions.filter((x) => x.title === 'PDA SEASIDE · the Room');
  const msgs = vc.length === 1 ? fae.state.dbGet('session:' + vc[0].id).value.messages : [];
  ok(vc.length === 1 && msgs.length === 4 && /Bo: Tea\?/.test(msgs[2].content), 'each visit is kept as one chat every device of hers sees (PDA SEASIDE · the Room)');
  const V = fae.tend.view().visits;
  ok(V.length === 1 && V[0].place === 'PDA SEASIDE' && V[0].room === 'the Room' && V[0].turns === 2 && V[0].via === 'PDA SEASIDE (test)', 'the boat shows where she\'s been, how often, and through which ferry');
  ok(!JSON.stringify(V).includes('Tea') && !JSON.stringify(V).includes('Welcome'), 'never what was said');

  // ---------- resting, and a provider's words never going back ----------
  fae.settings.set({ switches: { loop: false } }, 'test');
  r = await post('/r/fae/host/visit/turn', room([{ name: 'Ann', text: 'Still there?' }]), T);
  ok(r.json.ok === false && /resting/.test(r.json.error), 'with her loop switched off, the room hears plainly that she\'s resting');
  fae.settings.set({ switches: { loop: true } }, 'test');
  broken = true;
  r = await post('/r/fae/host/visit/turn', room([{ name: 'Ann', text: 'Hello?' }]), T);
  ok(r.json.ok === false && !JSON.stringify(r.json).includes('quota') && !JSON.stringify(r.json).includes('org-123') && /can.t answer right now/.test(r.json.error), 'when her model fails, the room hears only that she can\'t answer now: never what the provider said');
} catch (e) {
  fail.push('FAIL threw: ' + (e && e.stack || e));
} finally {
  release();
  await host.close();
  model.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}
for (const l of [...log, ...fail]) console.log(l);
console.log(fail.length ? `${fail.length} FAILED of ${log.length + fail.length}` : `ALL PASS (${log.length})`);
process.exit(fail.length ? 1 : 0);
