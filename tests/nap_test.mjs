// Nap mode (host/nap.cjs, host/runtime.cjs) and the outbound check (host/redact.cjs), against a synthetic host with a
// stand-in model and a stand-in bridge. The host is awake only while a client holds its presence stream open: with
// none connected there are no model calls, no scheduled runs and nothing sent through a bridge.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(process.env.JV_WEB), '..');
const { createHomeHost } = require(path.join(ROOT, 'host', 'home_host.cjs'));
const { createRuntime } = require(path.join(ROOT, 'host', 'runtime.cjs'));
const { createRedactor } = require(path.join(ROOT, 'host', 'redact.cjs'));
const log = []; const fail = [];
const ok = (c, m) => { (c ? log : fail).push((c ? 'PASS ' : 'FAIL ') + m); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-nap-'));

// ---------- the redactor on its own ----------
{
  const red = createRedactor({ known: ['tidepool-ollama-account', 'tidepool-mac.example'], hostDetails: false });
  const cases = [
    ['Ask http://100.101.102.103:11434/api/chat for it', /100\.101|11434/],
    ['My Ollama is at 192.168.1.50:11434', /192\.168/],
    ['try 10.0.0.7 or 172.20.1.1', /10\.0\.0\.7|172\.20/],
    ['the mac is tidepool-mac.tail1234.ts.net', /ts\.net/],
    ['localhost:11434 is down', /11434/],
    ['ollama.example.org:11434 answered', /11434/],
    ['the key sk-proj-abcdefghijklmnopqrstuvwx works', /sk-proj/],
    ['token ghp_abcdefghijklmnopqrstuvwxyz0123', /ghp_/],
    ['nsec1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq is mine', /nsec1/],
    ['Authorization: Bearer abcdefghijklmnop1234', /abcdefghijklmnop1234/],
    ['signed in as Tidepool-Ollama-Account on the mac', /ollama-account/i],
    ['reach tidepool-mac.example later', /tidepool-mac/],
    ['address fd7a:115c:a1e0::1234 on the tailnet', /fd7a/],
  ];
  for (const [t, leak] of cases) { const r = red(t); ok(!leak.test(r.text) && r.text.includes('[hidden]'), `hidden: ${t.slice(0, 40)} → ${r.text.slice(0, 50)}`); }
  for (const t of ['Version 2.10.11 is out.', 'The meeting is at 10.30 tomorrow.', 'DNS at 1.1.1.1 is public.', 'A sketch of a cat, 4 by 6.', 'She read 192 pages.']) ok(red(t).text === t, `ordinary text left alone: ${t}`);
  const r = red('see http://192.168.1.50:11434 and sk-abcdefghijklmnopqrstuv');
  ok(r.hits.address === 1 && r.hits.key === 1, 'it counts what it hid, by kind');
  const withHost = createRedactor({ known: [path.join(tmp, 'home')] })(`files in ${path.join(tmp, 'home')}\\Pandora and ${os.hostname()}`);
  ok(!withHost.text.includes(path.join(tmp, 'home')) && (os.hostname().length < 4 || !withHost.text.includes(os.hostname())), 'the home folder and this computer\'s name are hidden too');
}

// ---------- a host, a stand-in model, a stand-in bridge ----------
const host = createHomeHost({ root: path.join(tmp, 'home'), napGraceMs: 400 });
await new Promise(r => host.server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${host.server.address().port}`;
const T = (await (await fetch(BASE + '/host/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: host.newPin(), name: 'Test client' }) })).json()).token;

let modelCalls = 0, modelDelay = 0, modelSays = (m) => `answer to: ${m.messages[m.messages.length - 1].content}`;
const model = async (m) => { modelCalls++; if (modelDelay) await sleep(modelDelay); return modelSays(m); };
const inbox = [], sent = [];
const bridge = { name: 'vector', poll: async () => inbox.splice(0), send: async (m) => { sent.push(m); } };
const events = [];
const rt = createRuntime({
  nap: host.nap, model, bridges: [bridge], schedules: [{ id: 'heartbeat', everyMs: 60, prompt: 'heartbeat' }],
  redact: createRedactor({ known: ['tidepool-ollama-account'], hostDetails: false }),
  log: (kind, f) => { events.push({ kind, ...f }); host.event(kind, f); }, pollMs: 25, tickMs: 15, freshMs: 3000,
}).start();
host.attach(rt);
const presence = async () => (await (await fetch(BASE + '/host/presence', { headers: { Authorization: 'Bearer ' + T } })).json());
/** A client: holds the presence stream open until closed, as the page's bridge does. */
const connect = () => new Promise((resolve, reject) => {
  const req = http.get(BASE + '/host/presence/stream', { headers: { Authorization: 'Bearer ' + T } }, (res) => { res.once('data', () => resolve({ close: () => req.destroy() })); });
  req.on('error', (e) => { if (e.code !== 'ECONNRESET') reject(e); });
});

// asleep at the start: nothing runs
ok((await presence()).awake === false, 'the host starts napping (no client yet)');
await sleep(250);
ok(modelCalls === 0 && events.some(e => e.kind === 'schedule.skipped'), 'napping: the heartbeat is skipped, no model call');
let refused = ''; try { await rt.turn({ text: 'hello?' }); } catch (e) { refused = e.code; }
ok(refused === 'NAPPING' && modelCalls === 0, 'napping: a turn is refused');
inbox.push({ id: 'v1', chat: 'dm-friend', from: 'friend', text: 'are you there?', at: Date.now() });
await sleep(120);
ok(sent.length === 0 && modelCalls === 0 && rt.waiting().length === 1, 'napping: a Vector message is kept, not answered, and no model sees it');
const unpaired = await fetch(BASE + '/host/presence/stream');
ok(unpaired.status === 401, "an unpaired device can't wake the host");

// connect: it wakes, answers what waited, and its schedules run
const c1 = await connect();
await sleep(200);
ok((await presence()).awake === true, 'a client connects: the host wakes');
ok(sent.some(s => s.chat === 'dm-friend' && /are you there/.test(s.text)) && rt.waiting().length === 0, 'the message that waited is answered now');
ok(events.some(e => e.kind === 'schedule.ran'), 'and the heartbeat runs again');
const reply = await rt.turn({ text: 'a turn from the client' });
ok(/a turn from the client/.test(reply), 'the client runs a turn');

// disconnect: a grace period, then silence
c1.close();
await sleep(150);
ok((await presence()).awake === true, 'the client leaves: still awake during the grace period');
await sleep(450);
ok((await presence()).awake === false, 'after the grace period, the host naps');
const callsAtNap = modelCalls, sentAtNap = sent.length;
inbox.push({ id: 'v2', chat: 'group-room', from: 'someone', text: 'what model are you on?', at: Date.now() });
inbox.push({ id: 'v3', chat: 'dm-old', from: 'old', text: 'from an hour ago', at: Date.now() - 3600_000 });
await sleep(400);
ok(modelCalls === callsAtNap, `napping: no further model calls (${modelCalls} before and after)`);
ok(sent.length === sentAtNap, 'napping: nothing sent through the bridge');
ok(rt.waiting().length === 2, 'napping: new messages are kept');
const waitingSeen = await (await fetch(BASE + '/host/waiting', { headers: { Authorization: 'Bearer ' + T } })).json();
ok(waitingSeen.waiting.length === 2, 'what waits can be seen at /host/waiting');

// a refresh inside the grace period doesn't nap
const c2 = await connect();
await sleep(100);
const napsBefore = events.filter(e => e.kind === 'nap').length;
c2.close(); await sleep(100);
const c3 = await connect(); await sleep(500);
ok(events.filter(e => e.kind === 'nap').length === napsBefore && (await presence()).awake, 'a refresh (leave and come back within the grace) never naps');
ok(sent.some(s => s.chat === 'group-room'), 'reconnected: the fresh waiting message is answered');
ok(!sent.some(s => s.chat === 'dm-old') && rt.held().some(h => h.id === 'v3'), 'one that waited too long is held for her and the person, not answered');
ok(events.filter(e => e.kind === 'schedule.ran').length > 2, 'reconnected: the heartbeat resumes');

// what leaves for a bridge is checked
modelSays = () => 'I run on http://100.101.102.103:11434 as tidepool-ollama-account, key sk-abcdefghijklmnopqrstuvwx';
inbox.push({ id: 'v4', chat: 'group-room', from: 'curious', text: 'where do you run?', at: Date.now() });
await sleep(200);
const leaked = sent.find(s => s.replyTo === 'v4');
ok(leaked && !/100\.101|11434|tidepool-ollama-account|sk-abcdef/.test(leaked.text) && /\[hidden\]/.test(leaked.text), 'a reply repeating provider details is sent with them hidden: ' + (leaked?.text || '').slice(0, 80));
ok(events.some(e => e.kind === 'redacted' && e.hits.address >= 1 && e.hits.known === 1 && e.hits.key === 1), 'the log says what kinds were hidden');
const logText = fs.readFileSync(path.join(host.stateDir, 'events.jsonl'), 'utf8');
ok(!/100\.101\.102|tidepool-ollama-account|sk-abcdef/.test(logText), 'and never the values themselves');
modelSays = () => { throw new Error('could not reach http://192.168.1.50:11434 (ECONNREFUSED)'); };
const before = sent.length;
inbox.push({ id: 'v5', chat: 'group-room', from: 'curious', text: 'still there?', at: Date.now() });
await sleep(200);
ok(sent.length === before && events.some(e => e.kind === 'turn.failed'), "a model error is never sent to the bridge (that's where addresses turn up)");

// an answer still being made when the host falls asleep isn't sent
modelSays = (m) => `slow answer to: ${m.messages[m.messages.length - 1].content}`; modelDelay = 700;
inbox.push({ id: 'v6', chat: 'dm-late', from: 'late', text: 'quick question', at: Date.now() });
await sleep(60);
c3.close();
await sleep(1100);
ok((await presence()).awake === false && !sent.some(s => s.chat === 'dm-late'), 'an answer finished after the host fell asleep is not sent');
ok(rt.waiting().some(w => w.id === 'v6') && events.some(e => e.kind === 'bridge.send.refused'), 'its message waits to be answered on waking instead');
modelDelay = 0;
const c4 = await connect(); await sleep(250);
ok(sent.some(s => s.chat === 'dm-late'), 'and is answered once a client is back');
c4.close();

// the log tells the story
const kinds = fs.readFileSync(path.join(host.stateDir, 'events.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l).kind);
ok(['client.connected', 'wake', 'client.left', 'nap', 'bridge.kept', 'schedule.skipped'].every(k => kinds.includes(k)), 'the host log records connections, waking, napping and what was kept or skipped');

rt.stop(); await host.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log(log.join('\n')); console.log('\n' + (fail.length ? fail.join('\n') : 'ALL PASS'));
process.exit(fail.length ? 1 : 0);
