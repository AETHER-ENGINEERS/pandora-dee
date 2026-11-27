// Her switches (host/settings.cjs), a model that goes away, the host as her bridge (host/bridges.cjs), her own tool
// for what waited, the trace, and the host's settings page. Synthetic homes, a stand-in model, and a stand-in bridge
// the host starts itself (tests/fixtures/fake_bridge.mjs, shaped like pandora-discord).
import pw from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
const { chromium } = pw;
const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(process.env.JV_WEB), '..');
const { createHomeHost } = require(path.join(ROOT, 'host', 'home_host.cjs'));
const { createBridgeLink } = require(path.join(ROOT, 'host', 'bridges.cjs'));
const { classifyModelError, looksLikeProviderError } = require(path.join(ROOT, 'host', 'errors.cjs'));
const log = []; const fail = [];
const ok = (c, m) => { (c ? log : fail).push((c ? 'PASS ' : 'FAIL ') + m); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-switches-'));
const HOME = path.join(tmp, 'home');
const freePort = () => new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });

// The error the person saw posted into channels during an outage (account and ids are made up here)
const USAGE_LIMIT = 'you (tidepool-account) have reached your session usage limit, upgrade for higher limits: https://ollama.com/upgrade or add usage credits: https://ollama.com/settings (ref: 3f9c2e1a-77b0)';

// ---------- telling errors apart ----------
ok(classifyModelError(new Error(USAGE_LIMIT)) === 'usage-limit', 'the usage-limit error counts as the model being gone (usage limit)');
ok(classifyModelError(new Error('HTTP 401: invalid api key')) === 'auth' && classifyModelError(new Error('fetch failed: ECONNREFUSED')) === 'unreachable', 'so do a refused key and an unreachable server');
ok(classifyModelError(new Error('the tool returned nothing useful')) === null, 'an ordinary failure does not');
for (const t of [USAGE_LIMIT, '⚠ ' + USAGE_LIMIT, '⚠ HTTP 429: Too Many Requests', 'Error: 401 Unauthorized', '{"type":"error","error":{"type":"overloaded_error"}}', 'see https://platform.openai.com/account/billing']) ok(looksLikeProviderError(t), `stopped before a bridge: ${t.slice(0, 50)}`);
for (const t of ['I hit the rate limit on my bike app lol', 'Error handling in Rust is lovely.', 'The meeting is at 10.30.', 'Here is the link: https://example.org/upgrade-guide']) ok(!looksLikeProviderError(t), `ordinary words go out: ${t}`);

// ---------- a host that runs her bridge itself ----------
const FAKE_PORT = await freePort(), FAKE_TOKEN = 'fake-bridge-key';
const admin = async (p, body) => { const r = await fetch(`http://127.0.0.1:${FAKE_PORT}${p}`, { method: body ? 'POST' : 'GET', body: body ? JSON.stringify(body) : undefined }); return r.json(); };
let modelSays = (m) => `answer to: ${m.messages[m.messages.length - 1].content}`, modelFails = null, probeOk = false;
const calls = [];
const model = async (m) => { calls.push(m); if (modelFails) throw new Error(modelFails); return modelSays(m); };
const events = [];
let host, rt, link;
async function boot({ brain = 'host' } = {}) {
  host = createHomeHost({ root: HOME, napGraceMs: 300 });
  await new Promise(r => host.server.listen(0, '127.0.0.1', r));
  host.base = `http://127.0.0.1:${host.server.address().port}`;
  if (!host.settings.get().bridges) host.settings.set({ bridges: { discord: { url: `http://127.0.0.1:${FAKE_PORT}/mcp`, command: process.execPath, args: [path.join(ROOT, 'tests', 'fixtures', 'fake_bridge.mjs')], env: { FAKE_PORT: String(FAKE_PORT) }, keyEnv: 'FAKE_TOKEN' } } }, 'test');
  const cfg = host.bridgeConfigs()[0];
  link = createBridgeLink(cfg, { log: host.event }).start();
  rt = host.startRuntime({ brain, model, probe: async () => probeOk, bridges: [link], log: (k, f) => { events.push({ kind: k, ...f }); host.event(k, f); },
    schedules: [{ id: 'hb', kind: 'heartbeat', everyMs: 60, prompt: 'heartbeat' }, { id: 'spark', kind: 'sparks', everyMs: 60, prompt: 'wonder' }, { id: 'daily', kind: 'schedules', everyMs: 60, prompt: 'the daily review' }],
    pollMs: 40, tickMs: 20, probeMs: 100 });
}
async function shutdown() { link.stop(); rt.stop(); await rt.idle(); await host.close(); await sleep(200); }
await boot();
// the bridge's key: typed by the person into the settings page, never shown back
const T = (await (await fetch(host.base + '/host/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: host.newPin(), name: 'Test client' }) })).json()).token;
const api = async (p, method = 'GET', body) => { const r = await fetch(host.base + p, { method, headers: { Authorization: 'Bearer ' + T, 'Content-Type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }); return { status: r.status, json: await r.json().catch(() => null) }; };
ok((await api('/host/bridges/discord/key', 'PUT', { key: FAKE_TOKEN })).status === 200, 'the bridge key is set through the host');
const status0 = (await api('/host/status')).json;
ok(status0.bridges[0].tokenSet === true && !JSON.stringify(status0).includes(FAKE_TOKEN) && !fs.readFileSync(path.join(host.stateDir, 'settings.json'), 'utf8').includes(FAKE_TOKEN), 'the host says a key is set, and never shows it (not in the status, not in the settings file)');
await shutdown(); await boot(); // a new key is used after a restart
await sleep(800);
ok((await admin('/admin/sent')) && true, 'the host started the bridge itself, as its own child (it answers)');
const connect = () => new Promise((resolve) => { const c = { last: null }; const req = http.get(host.base + '/host/presence/stream', { headers: { Authorization: 'Bearer ' + T } }, (res) => { let buf = ''; res.on('data', (d) => { buf += d; const ls = buf.split('\n'); buf = ls.pop(); for (const l of ls) if (l.trim()) c.last = JSON.parse(l); if (!c.close) { c.close = () => req.destroy(); resolve(c); } }); }); req.on('error', () => {}); });
const sw = async () => (await api('/host/status')).json.switches;

// ---------- napping is switches off, with the reason shown ----------
let s = await sw();
ok(Object.values(s).every(v => !v.on && v.why.includes('napping')), 'napping: every switch reads off, because napping: ' + Object.keys(s).join(', '));
await sleep(200);
ok(calls.length === 0 && events.some(e => e.kind === 'heartbeat.skipped') && events.some(e => e.kind === 'sparks.skipped') && events.some(e => e.kind === 'schedules.skipped'), 'napping: no heartbeat, no sparks, no schedules, no model call');
let c = await connect(); await sleep(150);
s = await sw();
ok(Object.values(s).every(v => v.on && !v.why.length), 'a client connects: the switches read on (after-nap setting: back by themselves)');
ok(c.last && c.last.switches && c.last.switches.heartbeat === true && c.last.model === true && c.last.accent === '#BD72F3', 'and the client is told the switches, the model, and the accent colour');
await sleep(150);
ok(events.some(e => e.kind === 'heartbeat.ran') && events.some(e => e.kind === 'sparks.ran') && events.some(e => e.kind === 'schedules.ran'), 'heartbeat, sparks and schedules run');

// the person's own switch
await api('/host/settings', 'PUT', { switches: { heartbeat: false } });
s = await sw();
const hbBefore = events.filter(e => e.kind === 'heartbeat.ran').length;
await sleep(200);
ok(!s.heartbeat.on && s.heartbeat.why.join() === 'off' && s.sparks.on && events.filter(e => e.kind === 'heartbeat.ran').length === hbBefore, 'turning the heartbeat off stops it alone, and says why');
await api('/host/settings', 'PUT', { switches: { heartbeat: true } });

// after a nap, "they stay off until I turn them on"
await api('/host/settings', 'PUT', { afterNap: 'ask' });
c.close(); await sleep(500);
c = await connect(); await sleep(150);
s = await sw();
ok(Object.values(s).every(v => !v.on && v.why.includes('after a nap')) && (await api('/host/status')).json.heldAfterNap, 'with "ask": a client is back, but every switch stays off, because "after a nap"');
const callsHeld = calls.length; await sleep(200);
ok(calls.length === callsHeld, 'and nothing runs meanwhile');
await api('/host/switches/resume', 'POST', {});
s = await sw();
ok(Object.values(s).every(v => v.on), 'the person turns them back on');
await api('/host/settings', 'PUT', { afterNap: 'auto' });

// ---------- the Atelier answering, through the host as its bridge ----------
await shutdown(); await boot({ brain: 'client' });
c = await connect(); await sleep(200);
const bridgeCall = async (name, args = {}) => { const r = await api('/bridges/discord/mcp', 'POST', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }); return r.json.result; };
const tl = (await api('/bridges/discord/mcp', 'POST', { jsonrpc: '2.0', id: 1, method: 'tools/list' })).json.result.tools.map(t => t.name);
ok(tl.includes('send_message') && tl.includes('get_new_messages'), 'the Atelier sees the bridge\'s own tools, through the host');
await admin('/admin/inject', [{ id: 'm1', chat_id: 'general', author: { name: 'Ana' }, text: 'hello Pandora' }]);
await sleep(200);
const got1 = JSON.parse((await bridgeCall('get_new_messages')).content[0].text);
ok(got1.length === 1 && got1[0].id === 'm1' && got1[0].author.name === 'Ana', "a message comes to the Atelier exactly as the bridge gave it (so its Discord handling doesn't change)");
await bridgeCall('send_message', { chat_id: 'general', content: 'Hello Ana! (I run at 192.168.1.50:11434)', replied_to: 'm1' });
let sentNow = await admin('/admin/sent');
ok(sentNow.length === 1 && /Hello Ana!/.test(sentNow[0].content) && !/192\.168/.test(sentNow[0].content), 'her reply goes out through the host, with the address hidden');
ok((await bridgeCall('list_channels')).content[0].text.includes('general'), 'reading tools pass straight through');

// ---------- the outage: the exact error, never relayed; the bridges go off ----------
const r1 = await bridgeCall('send_message', { chat_id: 'general', content: '⚠ ' + USAGE_LIMIT, replied_to: 'm1' });
sentNow = await admin('/admin/sent');
ok(sentNow.length === 1 && r1.isError, 'the usage-limit error the Atelier tried to post: nothing goes out');
ok(!sentNow.some(x => /tidepool-account|ollama\.com|ref:/.test(x.content)), 'the account name, links and ref never reach the channel');
const st1 = (await api('/host/status')).json;
ok(st1.model.attached === false && st1.model.kind === 'usage-limit' && Object.values(st1.switches).every(v => !v.on && v.why.includes('no model')), 'the host takes it as her model gone: loop, heartbeat, schedules, sparks and bridges all off, "no model"');
ok(c.last && (await sleep(3200), c.last.model === false && c.last.switches.bridges === false), 'the connected client is told');
const logText = fs.readFileSync(path.join(host.stateDir, 'events.jsonl'), 'utf8');
ok(logText.includes('"bridge.blocked"') && logText.includes('"model.lost"') && !logText.includes('tidepool-account'), 'the log says what was stopped and why, without the account name' + '' + (logText.includes('tidepool-account') ? ': ' + logText.split(/\r?\n/).find(l => l.includes('tidepool-account')).slice(0, 300) : ''));
ok(fs.readFileSync(path.join(host.stateDir, 'trace.jsonl'), 'utf8').includes('tidepool-account'), 'the trace (on the host, for the person) keeps what it said');
const r2 = await bridgeCall('send_message', { chat_id: 'general', content: 'an ordinary sentence' });
ok(r2.isError && /off right now/.test(r2.content[0].text) && (await admin('/admin/sent')).length === 1, 'while she has no model nothing goes out at all');
await admin('/admin/inject', [{ id: 'm2', chat_id: 'dm-bo', author: { name: 'Bo' }, text: 'are you there?' }, { id: 'm3', chat_id: 'dm-bo', author: { name: 'Bo' }, text: 'hello?' }]);
await sleep(250);
ok(JSON.parse((await bridgeCall('get_new_messages')).content[0].text).length === 0 && host.queue.list().filter(m => !m.live).length === 2, 'messages arriving meanwhile wait in the queue; the Atelier is handed none');
ok((await admin('/admin/sent')).length === 1, 'silence: no notice is sent unless the person wrote one');
// the person's own fixed line, once per chat
await api('/host/settings', 'PUT', { offNotice: "Pandora can't answer right now; your message is kept for her." });
await admin('/admin/inject', [{ id: 'm4', chat_id: 'dm-cy', author: { name: 'Cy' }, text: 'hi' }, { id: 'm5', chat_id: 'dm-cy', author: { name: 'Cy' }, text: 'hi again' }]);
await sleep(250);
sentNow = await admin('/admin/sent');
ok(sentNow.filter(x => x.chat_id === 'dm-cy').length === 1 && sentNow.at(-1).content === "Pandora can't answer right now; your message is kept for her.", "with the person's fixed line set: it goes once to that chat, word for word, and nothing else");
// she has a model again (the person says so; "ask" is the default)
await sleep(300);
ok((await api('/host/status')).json.model.attached === false, 'the model stays gone until the person says otherwise (after-model: ask)');
await api('/host/model/back', 'POST', {});
ok(Object.values(await sw()).every(v => v.on), '"She has a model again": the switches come back on');
const d = await api('/host/waiting/deliver', 'POST', {});
const handed = JSON.parse((await bridgeCall('get_new_messages')).content[0].text);
ok(d.json.delivered === 4 && handed.map(m => m.id).join() === 'm2,m3,m4,m5', 'give them to her now: the Atelier gets the four that waited, oldest first');
// after-model "auto": a check finds it answering
await api('/host/settings', 'PUT', { afterModel: 'auto' });
host.settings.modelLost('unreachable', 'could not reach the model');
probeOk = false; await sleep(300);
ok(!host.settings.model().attached, 'with "auto", while the check fails it stays off');
probeOk = true; await sleep(300);
ok(host.settings.model().attached && Object.values(await sw()).every(v => v.on), 'and when the check succeeds, it comes back by itself');
await api('/host/settings', 'PUT', { afterModel: 'ask' });

// ---------- her own tool and her notice ----------
c.close(); await sleep(500);
await admin('/admin/inject', [{ id: 'w1', chat_id: 'dm-ana', author: { name: 'Ana' }, text: 'a secret about the party' }, { id: 'w2', chat_id: 'general', author: { name: 'Bo' }, text: 'news' }]);
await sleep(250);
c = await connect(); await sleep(200);
const mcp = async (method, params) => (await api('/mcp', 'POST', { jsonrpc: '2.0', id: 1, method, params })).json.result;
const her = (await mcp('tools/list')).tools.find(t => t.name === 'waiting_messages');
ok(her && /2 messages came while you were away/.test(her.description) && /Discord from Ana/.test(her.description) && !/secret about the party/.test(her.description), 'her tools tell her: 2 waiting, which bridge, who from, never the words');
const lst = JSON.parse((await mcp('tools/call', { name: 'waiting_messages', arguments: { action: 'list' } })).content[0].text);
ok(lst.count === 2 && !JSON.stringify(lst).includes('secret about the party'), 'list: who and where, without the words');
const rd = JSON.parse((await mcp('tools/call', { name: 'waiting_messages', arguments: { action: 'read', seq: lst.messages[0].seq } })).content[0].text);
ok(rd.messages[0].text === 'a secret about the party' && host.queue.list().filter(m => !m.live).length === 2, 'read: she reads one when she chooses; reading leaves it queued');
const hd = JSON.parse((await mcp('tools/call', { name: 'waiting_messages', arguments: { action: 'handled', all: true } })).content[0].text);
ok(hd.handled === 2 && hd.left === 0, 'handled: she marks them dealt with, and they leave the queue');
const info = JSON.parse((await mcp('tools/call', { name: 'host_info', arguments: {} })).content[0].text);
ok(info.model === 'attached' && info.switches.loop === 'on' && info.waiting === 'nothing', 'host_info tells her her switches, her model and what waits');
await shutdown();
// a turn the host runs itself starts with the notice
await boot({ brain: 'host' });
c = await connect(); await sleep(150);
c.close(); await sleep(450);
await admin('/admin/inject', [{ id: 'n1', chat_id: 'dm-di', author: { name: 'Di' }, text: 'later please' }]);
await sleep(200);
c = await connect(); await sleep(150);
calls.length = 0;
await rt.turn({ text: 'hello from the person' });
ok(calls[0] && calls[0].messages[0].role === 'system' && /1 message came while you were away/.test(calls[0].messages[0].content) && /Discord from Di/.test(calls[0].messages[0].content) && !/later please/.test(calls[0].messages[0].content), "a turn begins with her notice (count, bridge, who), not the message's words");
const trace = fs.readFileSync(path.join(host.stateDir, 'trace.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
ok(['model.request', 'model.reply', 'bridge.in', 'bridge.out', 'bridge.blocked'].every(k => trace.some(t => t.kind === k)), 'the trace holds what went to the model and what came back, each bridge message in and out, and what was stopped');

// ---------- the host's settings page ----------
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
await ctx.addInitScript(t => localStorage.setItem('pdhost:token', t), T);
const page = await ctx.newPage();
page.on('pageerror', e => fail.push('[pageerror] ' + e.message));
page.on('dialog', dl => dl.accept());
await page.goto(host.base + '/host/');
await page.waitForSelector('[data-sw="heartbeat"]', { timeout: 15000 });
ok(await page.textContent('#napPill') === 'Awake' && /Model attached/.test(await page.textContent('#modelPill')), 'the settings page shows awake and the model attached');
ok((await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim())).toUpperCase() === '#BD72F3' && await page.evaluate(() => getComputedStyle(document.querySelector('h1')).color) === 'rgb(189, 114, 243)', 'in the Atelier\'s new colour, #BD72F3 (189, 114, 243)');
await page.uncheck('[data-sw="sparks"]'); await sleep(400);
ok((await api('/host/settings')).json.switches.sparks === false, 'turning a switch off on the page changes the host\'s one setting');
await api('/host/settings', 'PUT', { switches: { sparks: true }, offNotice: 'changed elsewhere' });
await page.waitForFunction(() => document.querySelector('[data-sw="sparks"]').checked && document.querySelector('[data-set="offNotice"]').value === 'changed elsewhere', null, { timeout: 5000 }).catch(() => {});
ok(await page.isChecked('[data-sw="sparks"]') && await page.inputValue('[data-set="offNotice"]') === 'changed elsewhere', 'and a change made elsewhere shows on the page (one source of truth)');
host.settings.modelLost('usage-limit', USAGE_LIMIT);
await page.waitForFunction(() => /No model/.test(document.querySelector('#modelPill').textContent), null, { timeout: 5000 }).catch(() => {});
ok(/No model \(usage-limit\)/.test(await page.textContent('#modelPill')) && /no model/.test(await page.textContent('#swList')) && await page.isVisible('#modelBack'), 'with no model: the page says so, each switch says why, and offers "She has a model again"');
await page.click('#modelBack'); await sleep(400);
ok(host.settings.model().attached, 'and the button brings it back');
await page.fill('[data-colour="accent"]', '#336699').catch(() => page.evaluate(() => { const i = document.querySelector('[data-colour="accent"]'); i.value = '#336699'; i.dispatchEvent(new Event('change', { bubbles: true })); }));
await page.evaluate(() => { const i = document.querySelector('[data-colour="accent"]'); i.value = '#336699'; i.dispatchEvent(new Event('change', { bubbles: true })); });
await sleep(500);
ok((await api('/host/settings')).json.colors.accent === '#336699' && (await api('/host/settings')).json.colors.background === '#0b0912', 'colours can be changed; the others keep their defaults');
await page.selectOption('#bridgeForm [name="name"]', 'vector');
await page.fill('#bridgeForm [name="url"]', 'http://127.0.0.1:9/mcp');
await page.fill('#bridgeForm [name="key"]', 'typed-vector-key');
await page.click('#bridgeForm button'); await sleep(500);
const st2 = (await api('/host/status')).json;
ok(st2.bridges.some(b => b.name === 'vector' && b.tokenSet) && st2.bridges.some(b => b.name === 'discord'), 'a bridge set up on the page is saved, with its key, beside the others');
ok(!JSON.stringify(st2).includes('typed-vector-key') && !fs.readFileSync(path.join(host.stateDir, 'settings.json'), 'utf8').includes('typed-vector-key'), 'and its key is never shown or kept in the settings');
ok(await page.locator('#traceList details').count() > 3, 'the page lists what happened (the trace)');
await browser.close();

c.close();
await shutdown();
fs.rmSync(tmp, { recursive: true, force: true });
console.log(log.join('\n')); console.log('\n' + (fail.length ? fail.join('\n') : 'ALL PASS'));
process.exit(fail.length ? 1 : 0);
