// Nap mode (host/nap.cjs, host/runtime.cjs), the waiting queue (host/queue.cjs) and the outbound check
// (host/redact.cjs), against synthetic hosts with a stand-in model and stand-in bridges.
//   - The host is awake only while a client holds its presence stream open: with none connected there are no model
//     calls, no scheduled runs and nothing sent through a bridge.
//   - Messages that arrive while it naps are kept on disk, in arrival order, with where they came from. They never
//     expire, and waking doesn't hand them to her: the person chooses to give them to her now (all, or the next few,
//     oldest first), later, or to write them to a file in her home. Clearing the queue needs the person's word and a
//     written file.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(process.env.JV_WEB), '..');
const { createHomeHost } = require(path.join(ROOT, 'host', 'home_host.cjs'));
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
  ok(!withHost.text.includes(path.join(tmp, 'home')) && (os.hostname().length < 4 || !withHost.text.includes(os.hostname())), "the home folder and this computer's name are hidden too");
}

// ---------- a host, a stand-in model, stand-in bridges ----------
const HOME = path.join(tmp, 'home');
let modelDelay = 0, modelFails = false;
const calls = []; // every model call: why, and the last message
let modelSays = (m) => `answer to: ${m.messages[m.messages.length - 1].content}`;
const model = async (m) => { calls.push({ why: m.why, text: m.messages[m.messages.length - 1].content }); if (modelDelay) await sleep(modelDelay); if (modelFails) throw new Error('could not reach http://192.168.1.50:11434 (ECONNREFUSED)'); return modelSays(m); };
const sent = [];
const mkBridge = (name) => { const inbox = []; return { inbox, name, poll: async () => inbox.splice(0), send: async (m) => { sent.push({ bridge: name, ...m }); } }; };
const vector = mkBridge('vector'), discord = mkBridge('discord');
const turnCalls = () => calls.filter(c => c.why.startsWith('turn:vector') || c.why.startsWith('turn:discord'));
const events = [];

async function boot({ grace = 400 } = {}) {
  const host = createHomeHost({ root: HOME, napGraceMs: grace });
  await new Promise(r => host.server.listen(0, '127.0.0.1', r));
  host.settings.set({ redactWords: ['tidepool-ollama-account'] }, 'test');
  const logIt = (kind, f) => { events.push({ kind, ...f }); host.event(kind, f); };
  const rt = host.startRuntime({ brain: 'host', model, bridges: [vector, discord], schedules: [{ id: 'heartbeat', kind: 'heartbeat', everyMs: 60, prompt: 'heartbeat' }], log: logIt, pollMs: 25, tickMs: 15 });
  host.base = `http://127.0.0.1:${host.server.address().port}`;
  return { host, rt, queue: host.queue };
}
async function shutdown({ host, rt }) { rt.stop(); await rt.idle(); await host.close(); }
let { host, rt, queue } = await boot();
const T = (await (await fetch(host.base + '/host/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: host.newPin(), name: 'Test client' }) })).json()).token;
const api = async (p, body) => { const r = await fetch(host.base + p, body === undefined ? { headers: { Authorization: 'Bearer ' + T } } : { method: 'POST', headers: { Authorization: 'Bearer ' + T, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, json: await r.json() }; };
const presence = async () => (await api('/host/presence')).json;
/** A client: holds the presence stream open until closed, as the page's bridge does. Keeps the last status line. */
const connect = () => new Promise((resolve, reject) => {
  const c = { last: null };
  const req = http.get(host.base + '/host/presence/stream', { headers: { Authorization: 'Bearer ' + T } }, (res) => {
    let buf = '';
    res.on('data', (d) => { buf += d; const lines = buf.split('\n'); buf = lines.pop(); for (const l of lines) if (l.trim()) c.last = JSON.parse(l); if (!c.close) { c.close = () => req.destroy(); resolve(c); } });
  });
  req.on('error', (e) => { if (e.code !== 'ECONNRESET') reject(e); });
});
const msg = (b, id, chat, from, text, at = Date.now()) => b.inbox.push({ id, chat, from, text, at });
// one after another, as real messages arrive (the host's order is the order it received them in)
const arrive = async (...list) => { for (const a of list) { msg(...a); await sleep(60); } };

// ---------- asleep: nothing runs, messages wait ----------
ok((await presence()).awake === false, 'the host starts napping (no client yet)');
await sleep(250);
ok(calls.length === 0 && events.some(e => e.kind === 'heartbeat.skipped'), 'napping: the heartbeat is skipped, no model call');
let refused = ''; try { await rt.turn({ text: 'hello?' }); } catch (e) { refused = e.code; }
ok(refused === 'NAPPING' && calls.length === 0, 'napping: a turn is refused');
msg(vector, 'v1', 'dm-friend', 'friend', 'are you there?');
await sleep(120);
ok(sent.length === 0 && calls.length === 0 && queue.size() === 1, 'napping: a Vector message is queued, not answered, and no model sees it');
ok((await fetch(host.base + '/host/presence/stream')).status === 401, "an unpaired device can't wake the host");
ok((await api('/host/waiting/deliver', {})).status === 409, "napping: the waiting messages can't be handed to a model");

// ---------- awake: live messages answered, the queue untouched ----------
let c1 = await connect();
await sleep(200);
ok((await presence()).awake === true, 'a client connects: the host wakes');
ok(events.some(e => e.kind === 'heartbeat.ran'), 'and the heartbeat runs again');
ok(turnCalls().length === 0 && sent.length === 0 && queue.size() === 1, 'waking hands her nothing: the waiting message stays queued');
await sleep(3200);
ok(c1.last && c1.last.awake === true && c1.last.waiting === 1, 'the connected client is told "1 message waiting"');
msg(discord, 'd1', 'general', 'someone', 'hello Pandora');
await sleep(150);
ok(sent.some(s => s.replyTo === 'd1' && /hello Pandora/.test(s.text)) && queue.size() === 1, 'awake: a live message is answered straight away and leaves the queue (the waiting one stays)');
ok(/a turn from the client/.test(await rt.turn({ text: 'a turn from the client' })), 'the client runs a turn');

// ---------- disconnect: grace, then silence; everything is kept ----------
c1.close();
await sleep(150);
ok((await presence()).awake === true, 'the client leaves: still awake during the grace period');
await sleep(450);
ok((await presence()).awake === false, 'after the grace period, the host naps');
const callsAtNap = calls.length, sentAtNap = sent.length;
await arrive(
  [discord, 'd2', 'general', 'someone', 'what model are you on?'],
  [vector, 'v2', 'dm-old', 'old friend', 'from an hour ago', Date.now() - 3600_000],
  [vector, 'v2', 'dm-old', 'old friend', 'from an hour ago', Date.now() - 3600_000], // the same message handed over twice
  [vector, 'v3', 'dm-friend', 'friend', 'and one more thing']);
await sleep(400);
ok(calls.length === callsAtNap, `napping: no further model calls (${calls.length} before and after)`);
ok(sent.length === sentAtNap, 'napping: nothing sent through any bridge');
const w = (await api('/host/waiting')).json;
ok(w.count === 4 && w.messages.map(m => m.id).join() === 'v1,d2,v2,v3', 'all four are queued, once each, in arrival order: ' + w.messages.map(m => m.id).join());
ok(w.messages.every(m => m.bridge && m.from && m.receivedAt), 'each with its source: which bridge, who sent it, when');

// a refresh inside the grace period doesn't nap
const c2 = await connect(); await sleep(100);
const napsBefore = events.filter(e => e.kind === 'nap').length;
c2.close(); await sleep(100);
let c3 = await connect(); await sleep(300);
ok(events.filter(e => e.kind === 'nap').length === napsBefore && (await presence()).awake, 'a refresh (leave and come back within the grace) never naps');
ok(turnCalls().filter(c => !/a turn from|hello Pandora/.test(c.text)).length === 0, 'and waking again still hands her nothing on its own');

// ---------- the three choices ----------
// later: nothing moves
const later = await api('/host/waiting/later', {});
ok(later.status === 200 && queue.size() === 4 && turnCalls().length === 1, 'later: they all stay queued');
// write them to a file: everything, in order, with sources; the queue stays
const wr = await api('/host/waiting/write', {});
const file1 = path.join(HOME, ...String(wr.json.path).split('/').filter(Boolean));
ok(wr.status === 200 && /^\/Pandora\/Waiting Messages\/\d{4}-\d\d-\d\d \d\d\.\d\d\.md$/.test(wr.json.path) && fs.existsSync(file1), 'write: a Markdown file in her home: ' + wr.json.path);
const md = fs.readFileSync(file1, 'utf8');
const order = ['are you there?', 'what model are you on?', 'from an hour ago', 'and one more thing'].map(t => md.indexOf(t));
ok(order.every(i => i > 0) && order.every((x, i) => i === 0 || x > order[i - 1]), 'it holds every message, oldest first');
ok(/· vector · friend/.test(md) && /· discord · someone/.test(md) && /Where: dm-old/.test(md) && /Sent: /.test(md), 'each with when it arrived, the bridge, the sender, the chat (and when it was sent, if earlier)');
ok(queue.size() === 4, 'write: the queue is left as it was');
const wr2 = await api('/host/waiting/write', {});
ok(wr2.json.path !== wr.json.path && fs.existsSync(file1), 'writing again makes a new file, never over the earlier one');
// clearing: only with the person's word, and only what a written file holds
ok((await api('/host/waiting/clear', {})).status === 409 && queue.size() === 4, 'clear without the person confirming: refused');
c3.close(); await sleep(650); // nap, so a new message can arrive and wait
msg(vector, 'v4', 'dm-new', 'newcomer', 'arrived after the file was written');
await sleep(150);
c3 = await connect(); await sleep(150);
const cl1 = await api('/host/waiting/clear', { confirm: true });
ok(cl1.status === 409 && queue.size() === 5, "clear when a message arrived after the file was written: refused (it isn't in any file)");
const wr3 = await api('/host/waiting/write', {});
const cl2 = await api('/host/waiting/clear', { confirm: true });
const file3 = path.join(HOME, ...String(wr3.json.path).split('/').filter(Boolean));
ok(cl2.status === 200 && cl2.json.cleared === 5 && queue.size() === 0 && /arrived after the file/.test(fs.readFileSync(file3, 'utf8')), 'written again, then cleared on the person\'s word: the queue is empty, the file keeps all five');
ok(turnCalls().length === 1 && sent.length === sentAtNap, 'writing and clearing handed nothing to a model and sent nothing');
c3.close(); await sleep(650);

// ---------- restart with messages waiting, then "give them to her now" ----------
await arrive(
  [vector, 'r1', 'dm-a', 'Ana', 'first, before the restart'],
  [discord, 'r2', 'general', 'Bo', 'second'],
  [vector, 'r3', 'dm-c', 'Cy', 'third', Date.now() - 6 * 3600_000],
  [discord, 'r4', 'dev', 'Di', 'fourth'],
  [vector, 'r5', 'dm-a', 'Ana', 'fifth, last']);
await sleep(200);
ok(queue.size() === 5, 'five more queued while napping');
await shutdown({ host, rt });
({ host, rt, queue } = await boot());
const w2 = (await api('/host/waiting')).json;
ok(w2.count === 5 && w2.messages.map(m => m.id).join() === 'r1,r2,r3,r4,r5' && w2.messages[2].from === 'Cy', 'after a restart all five are still waiting, in order, with their sources');
const beforeDeliver = turnCalls().length, sentBefore = sent.length;
const c4 = await connect(); await sleep(250);
ok(turnCalls().length === beforeDeliver && sent.length === sentBefore, 'connecting after the restart hands her nothing on its own');
const d1 = await api('/host/waiting/deliver', { count: 2 });
ok(d1.json.delivered === 2 && d1.json.left === 3, 'give her the next two: delivered 2, 3 left');
const d2 = await api('/host/waiting/deliver', {});
ok(d2.json.delivered === 3 && d2.json.left === 0, 'give her the rest: delivered 3, none left');
const got = turnCalls().slice(beforeDeliver).map(c => c.text);
ok(got.join('|') === 'first, before the restart|second|third|fourth|fifth, last', 'she got every one, once, oldest first (the six-hour-old one too: nothing expires)');
const replies = sent.slice(sentBefore);
ok(replies.map(s => s.replyTo).join() === 'r1,r2,r3,r4,r5' && replies.every((s, i) => s.bridge === ['vector', 'discord', 'vector', 'discord', 'vector'][i]), 'and each reply went back once, through the bridge it came from');
c4.close(); await sleep(650);
await shutdown({ host, rt });
({ host, rt, queue } = await boot());
ok(queue.size() === 0, 'restarted again: nothing is handed over twice');

// ---------- a host stopped in the middle of her turn: the message is kept ----------
msg(vector, 'x1', 'dm-x', 'Xe', 'interrupted');
await sleep(150);
{ const m = queue.first(); queue.trying(m.seq); } // her turn starts, then the host stops before it finishes
await shutdown({ host, rt });
({ host, rt, queue } = await boot());
ok(queue.size() === 1 && queue.first().tries === 1, 'stopped mid-turn: after the restart the message is still waiting, marked as tried once');
const c5 = await connect(); await sleep(150);
const before5 = calls.length;
await api('/host/waiting/deliver', {});
ok(calls.slice(before5).some(c => /handed to her again/.test(c.why)) && queue.size() === 0, 'delivered, it tells her it was handed to her again; then it leaves the queue');

// ---------- failures keep messages; nothing leaks ----------
modelFails = true;
msg(discord, 'f1', 'general', 'curious', 'still there?');
await sleep(200);
ok(!sent.some(s => s.replyTo === 'f1') && queue.list().some(m => m.id === 'f1'), "a model error: nothing sent (that's where addresses turn up), and the message stays queued");
ok(host.settings.model().attached === false && host.settings.model().kind === 'unreachable', 'an unreachable model counts as gone: her switches go off');
modelFails = false;
await api('/host/model/back', {});
await api('/host/waiting/deliver', {});
ok(sent.some(s => s.replyTo === 'f1') && queue.size() === 0, 'delivered once the model is back');
modelSays = () => 'I run on http://100.101.102.103:11434 as tidepool-ollama-account, key sk-abcdefghijklmnopqrstuvwx';
msg(discord, 'l1', 'general', 'curious', 'where do you run?');
await sleep(200);
const leaked = sent.find(s => s.replyTo === 'l1');
ok(leaked && !/100\.101|11434|tidepool-ollama-account|sk-abcdef/.test(leaked.text) && /\[hidden\]/.test(leaked.text), 'a reply repeating provider details is sent with them hidden: ' + (leaked?.text || '').slice(0, 80));
ok(events.some(e => e.kind === 'redacted' && e.hits.address >= 1 && e.hits.known === 1 && e.hits.key === 1), 'the log says what kinds were hidden');
const logText = fs.readFileSync(path.join(host.stateDir, 'events.jsonl'), 'utf8');
ok(!/100\.101\.102|tidepool-ollama-account|sk-abcdef/.test(logText), 'and never the values themselves');
modelSays = (m) => `slow answer to: ${m.messages[m.messages.length - 1].content}`; modelDelay = 700;
msg(vector, 'z1', 'dm-late', 'late', 'quick question');
await sleep(60);
c5.close();
await sleep(1100);
modelDelay = 0;
ok((await presence()).awake === false && !sent.some(s => s.replyTo === 'z1') && queue.list().some(m => m.id === 'z1'), 'an answer finished after the host fell asleep is not sent; the message stays queued');
await shutdown({ host, rt });

// ---------- a large queue: said, never trimmed ----------
({ host, rt, queue } = await boot());
host.settings.set({ queueWarnAt: 3 }, 'test');
await shutdown({ host, rt });
({ host, rt, queue } = await boot());
for (let i = 0; i < 5; i++) msg(vector, 'big' + i, 'dm-big', 'many', 'message ' + i);
await sleep(200);
const c6 = await connect(); await sleep(3300);
ok(queue.size() === 6 && fs.readFileSync(path.join(host.stateDir, 'events.jsonl'), 'utf8').includes('"queue.large"') && c6.last.waitingLarge === true, 'past the warning size the host says the queue is large (to the client and in the log), and keeps every message');
c6.close();

// the log tells the story
const kinds = fs.readFileSync(path.join(host.stateDir, 'events.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l).kind);
ok(['client.connected', 'wake', 'client.left', 'nap', 'queue.add', 'queue.deliver', 'queue.written', 'queue.cleared', 'queue.choice', 'heartbeat.skipped'].every(k => kinds.includes(k)), 'the host log records connections, waking, napping, the queue and each choice');

await shutdown({ host, rt });
fs.rmSync(tmp, { recursive: true, force: true });
console.log(log.join('\n')); console.log('\n' + (fail.length ? fail.join('\n') : 'ALL PASS'));
process.exit(fail.length ? 1 : 0);
