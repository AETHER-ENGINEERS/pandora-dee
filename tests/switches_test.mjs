// Her switches (host/settings.cjs), a model that goes away, the host as her bridge (host/bridges.cjs), her notice
// while she can't answer, her own tools for what waited and for that notice, the trace, and the host's settings page.
// Synthetic homes, a stand-in model, and a stand-in bridge the host starts itself (tests/fixtures/fake_bridge.mjs,
// shaped like pandora-discord).
//
// The rules (Mrrowr-murrr, 2026-11-27):
//   - a nap turns the loop, heartbeat, schedules, sparks and sending off, and reconnecting changes nothing: they stay
//     off until the person turns them on ("come back by themselves" is a setting, off by default);
//   - a model outage turns the heartbeat, schedules, sparks and sending off; a model attached again (checked, or the
//     person's word) brings none of them back. Receiving stays on throughout;
//   - while she can't send, someone writing gets her notice once: once per person in a DM, once per shared channel,
//     never twice to the same person; then silence until her sending is on again. Her words, configurable by her and
//     the person, never a model's, never with provider details.
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
const { NOTICE } = require(path.join(ROOT, 'host', 'settings.cjs'));
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
for (const t of ['I hit the rate limit on my bike app lol', 'Error handling in Rust is lovely.', 'The meeting is at 10.30.', 'Here is the link: https://example.org/upgrade-guide', NOTICE]) ok(!looksLikeProviderError(t), `ordinary words go out: ${t}`);

// ---------- a host that runs her bridge itself ----------
const FAKE_PORT = await freePort(), FAKE_TOKEN = 'fake-bridge-key';
const admin = async (p, body) => { const r = await fetch(`http://127.0.0.1:${FAKE_PORT}${p}`, { method: body ? 'POST' : 'GET', body: body ? JSON.stringify(body) : undefined }); return r.json(); };
let probeOk = false;
const calls = [];
const model = async (m) => { calls.push(m); return `answer to: ${m.messages[m.messages.length - 1].content}`; };
const events = [];
let host, rt, link;
async function boot({ brain = 'host' } = {}) {
  host = createHomeHost({ root: HOME, napGraceMs: 300 });
  await new Promise(r => host.server.listen(0, '127.0.0.1', r));
  host.base = `http://127.0.0.1:${host.server.address().port}`;
  if (!host.settings.get().bridges) host.settings.set({ bridges: { discord: { url: `http://127.0.0.1:${FAKE_PORT}/mcp`, command: process.execPath, args: [path.join(ROOT, 'tests', 'fixtures', 'fake_bridge.mjs')], env: { FAKE_PORT: String(FAKE_PORT) }, keyEnv: 'FAKE_TOKEN' } } }, 'test');
  link = createBridgeLink(host.bridgeConfigs()[0], { log: host.event }).start();
  rt = host.startRuntime({ brain, model, probe: async () => probeOk, bridges: [link], log: (k, f) => { events.push({ kind: k, ...f }); host.event(k, f); },
    schedules: [{ id: 'hb', kind: 'heartbeat', everyMs: 60, prompt: 'heartbeat' }, { id: 'spark', kind: 'sparks', everyMs: 60, prompt: 'wonder' }, { id: 'daily', kind: 'schedules', everyMs: 60, prompt: 'the daily review' }],
    pollMs: 40, tickMs: 20, probeMs: 100 });
}
async function shutdown() { link.stop(); rt.stop(); await rt.idle(); await host.close(); await sleep(200); }
await boot();
const T = (await (await fetch(host.base + '/host/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: host.newPin(), name: 'Test client' }) })).json()).token;
const api = async (p, method = 'GET', body) => { const r = await fetch(host.base + p, { method, headers: { Authorization: 'Bearer ' + T, 'Content-Type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }); return { status: r.status, json: await r.json().catch(() => null) }; };
ok((await api('/host/bridges/discord/key', 'PUT', { key: FAKE_TOKEN })).status === 200, 'the bridge key is set through the host');
const status0 = (await api('/host/status')).json;
ok(status0.bridges[0].tokenSet === true && !JSON.stringify(status0).includes(FAKE_TOKEN) && !fs.readFileSync(path.join(host.stateDir, 'settings.json'), 'utf8').includes(FAKE_TOKEN), 'the host says a key is set, and never shows it (not in the status, not in the settings file)');
ok(status0.settings.afterNap === 'ask' && status0.settings.afterModel === 'ask' && status0.settings.notices.discord.default === NOTICE, 'the defaults: after a nap the person turns things on; her notice: "' + NOTICE + '"');
await shutdown(); await boot(); // a new key is used after a restart
await sleep(800);
ok(Array.isArray(await admin('/admin/sent')), 'the host started the bridge itself, as its own child (it answers)');
const connect = () => new Promise((resolve) => { const c = { last: null }; const req = http.get(host.base + '/host/presence/stream', { headers: { Authorization: 'Bearer ' + T } }, (res) => { let buf = ''; res.on('data', (d) => { buf += d; const ls = buf.split('\n'); buf = ls.pop(); for (const l of ls) if (l.trim()) c.last = JSON.parse(l); if (!c.close) { c.close = () => req.destroy(); resolve(c); } }); }); req.on('error', () => {}); });
const sw = async () => (await api('/host/status')).json.switches;
const offOnly = (s, names) => Object.entries(s).every(([k, v]) => names.includes(k) ? !v.on : v.on);

// ---------- napping ----------
let s = await sw();
ok(['loop', 'heartbeat', 'schedules', 'sparks', 'send'].every(k => !s[k].on && s[k].why.includes('napping')) && s.receive.on, 'napping: loop, heartbeat, schedules, sparks and sending read off ("napping"); receiving stays on');
await sleep(200);
ok(calls.length === 0 && events.some(e => e.kind === 'heartbeat.skipped') && events.some(e => e.kind === 'sparks.skipped') && events.some(e => e.kind === 'schedules.skipped'), 'napping: no heartbeat, no sparks, no schedules, no model call');
let c = await connect(); await sleep(150);
s = await sw();
ok(Object.values(s).every(v => v.on), 'the first client of a fresh host: everything the person left on is on');
ok(c.last && c.last.switches && c.last.switches.heartbeat === true && c.last.switches.send === true && c.last.model === true && c.last.accent === '#BD72F3', 'and the client is told the switches, the model, and the accent colour');
await sleep(150);
ok(events.some(e => e.kind === 'heartbeat.ran') && events.some(e => e.kind === 'sparks.ran') && events.some(e => e.kind === 'schedules.ran'), 'heartbeat, sparks and schedules run');
await api('/host/settings', 'PUT', { switches: { heartbeat: false } });
s = await sw();
const hbBefore = events.filter(e => e.kind === 'heartbeat.ran').length;
await sleep(200);
ok(!s.heartbeat.on && s.heartbeat.why.join() === 'off' && s.sparks.on && events.filter(e => e.kind === 'heartbeat.ran').length === hbBefore, "turning the heartbeat off stops it alone, and says it's the person's choice");
await api('/host/settings', 'PUT', { switches: { heartbeat: true } });

// a nap, then reconnecting: nothing comes back by itself
c.close(); await sleep(500);
c = await connect(); await sleep(200);
s = await sw();
ok(offOnly(s, ['loop', 'heartbeat', 'schedules', 'sparks', 'send']) && ['loop', 'heartbeat', 'schedules', 'sparks', 'send'].every(k => s[k].why.join() === 'off since the nap' && s[k].offBy === 'nap'), 'after a nap, reconnecting changes nothing: loop, heartbeat, schedules, sparks and sending stay off, "off since the nap"; receiving is on');
const callsHeld = calls.length; await sleep(200);
ok(calls.length === callsHeld, 'and nothing runs');
let refused = ''; try { await rt.turn({ text: 'hello?' }); } catch (e) { refused = e.why?.join(); }
ok(/off since the nap/.test(refused), 'a turn is refused, and says why');
await api('/host/settings', 'PUT', { switches: { loop: true, sparks: true } });
await sleep(200);
s = await sw();
ok(s.loop.on && s.sparks.on && !s.heartbeat.on && !s.send.on && events.filter(e => e.kind === 'sparks.ran').length > 0, 'the person turns on just the loop and sparks: those run; the heartbeat and sending stay off');
await api('/host/switches/resume', 'POST', {});
ok(Object.values(await sw()).every(v => v.on), '"Turn on everything the host turned off" brings the rest back');
// the setting for later: back by themselves
await api('/host/settings', 'PUT', { afterNap: 'auto' });
c.close(); await sleep(500);
c = await connect(); await sleep(200);
ok(Object.values(await sw()).every(v => v.on), 'with "come back by themselves" (the setting for later), a reconnect brings everything back');
await api('/host/settings', 'PUT', { afterNap: 'ask' });

// ---------- the Atelier answering, through the host as its bridge ----------
c.close(); await shutdown(); await boot({ brain: 'client' });
c = await connect(); await sleep(200);
await api('/host/switches/resume', 'POST', {}); // the nap the restart caused turned things off: the person turns them on
const bridgeCall = async (name, args = {}) => { const r = await api('/bridges/discord/mcp', 'POST', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }); return r.json.result; };
const tl = (await api('/bridges/discord/mcp', 'POST', { jsonrpc: '2.0', id: 1, method: 'tools/list' })).json.result.tools.map(t => t.name);
ok(tl.includes('send_message') && tl.includes('get_new_messages'), "the Atelier sees the bridge's own tools, through the host");
await admin('/admin/inject', [{ id: 'm1', chat_id: 'general', guild_id: 'g1', author: { id: 'u-ana', name: 'Ana' }, text: 'hello Pandora' }]);
await sleep(200);
const got1 = JSON.parse((await bridgeCall('get_new_messages')).content[0].text);
ok(got1.length === 1 && got1[0].id === 'm1' && got1[0].author.name === 'Ana', "a message comes to the Atelier exactly as the bridge gave it (so its Discord handling doesn't change)");
await bridgeCall('send_message', { chat_id: 'general', content: 'Hello Ana! (I run at 192.168.1.50:11434)', replied_to: 'm1' });
let sentNow = await admin('/admin/sent');
ok(sentNow.length === 1 && /Hello Ana!/.test(sentNow[0].content) && !/192\.168/.test(sentNow[0].content), 'her reply goes out through the host, with the address hidden');
ok((await bridgeCall('list_channels')).content[0].text.includes('general'), 'reading tools pass straight through');

// ---------- the outage ----------
const r1 = await bridgeCall('send_message', { chat_id: 'general', content: '⚠ ' + USAGE_LIMIT, replied_to: 'm1' });
sentNow = await admin('/admin/sent');
ok(sentNow.length === 1 && r1.isError, 'the usage-limit error the Atelier tried to post: nothing goes out');
ok(!sentNow.some(x => /tidepool-account|ollama\.com|ref:/.test(x.content)), 'the account name, links and ref never reach the channel');
let st1 = (await api('/host/status')).json;
ok(st1.model.attached === false && st1.model.kind === 'usage-limit', 'the host takes it as her model gone');
ok(['heartbeat', 'schedules', 'sparks', 'send'].every(k => !st1.switches[k].on && st1.switches[k].offBy === 'outage') && !st1.switches.loop.on && st1.switches.loop.why.join() === 'no model' && st1.switches.receive.on, 'heartbeat, schedules, sparks and sending are turned off ("off since the model outage"); the loop waits for a model; receiving stays on');
await sleep(3200);
ok(c.last && c.last.model === false && c.last.switches.send === false && c.last.switches.receive === true, 'the connected client is told');
const logText = fs.readFileSync(path.join(host.stateDir, 'events.jsonl'), 'utf8');
ok(logText.includes('"bridge.blocked"') && logText.includes('"model.lost"') && !logText.includes('tidepool-account'), 'the log says what was stopped and why, without the account name');
ok(fs.readFileSync(path.join(host.stateDir, 'trace.jsonl'), 'utf8').includes('tidepool-account'), 'the trace (on the host, for the person) keeps what it said');
const r2 = await bridgeCall('send_message', { chat_id: 'general', content: 'an ordinary sentence' });
ok(r2.isError && /off right now/.test(r2.content[0].text) && (await admin('/admin/sent')).length === 1, 'while sending is off nothing she writes goes out');

// her notice: once per person in a DM, once per shared channel, never twice to one person
const notices = async () => (await admin('/admin/sent')).slice(1);
const inject = async (list) => { await admin('/admin/inject', list); await sleep(250); };
await inject([{ id: 'b1', chat_id: 'dm-bo', author: { id: 'u-bo', name: 'Bo' }, text: 'are you there?' }, { id: 'b2', chat_id: 'dm-bo', author: { id: 'u-bo', name: 'Bo' }, text: 'hello?' }]);
let n = await notices();
ok(n.length === 1 && n[0].chat_id === 'dm-bo' && n[0].content === NOTICE, `Bo writes twice in a DM: one notice, her words exactly ("${NOTICE}")`);
await inject([{ id: 'c1', chat_id: 'general', guild_id: 'g1', author: { id: 'u-cy', name: 'Cy' }, text: 'Pandora?' }, { id: 'd1', chat_id: 'general', guild_id: 'g1', author: { id: 'u-di', name: 'Di' }, text: 'Pandora, hi' }]);
n = await notices();
ok(n.length === 2 && n[1].chat_id === 'general', 'Cy and Di write in a shared channel: one notice, to the channel');
await inject([{ id: 'c2', chat_id: 'dm-cy', author: { id: 'u-cy', name: 'Cy' }, text: 'in private now' }]);
ok((await notices()).length === 2, "Cy, who saw it in the channel, then writes in a DM: no second notice for Cy");
await inject([{ id: 'a2', chat_id: 'dm-ana', author: { id: 'u-ana', name: 'Ana' }, text: 'quick one' }, { id: 'a3', chat_id: 'dev', guild_id: 'g1', author: { id: 'u-ana', name: 'Ana' }, text: 'and here' }]);
n = await notices();
ok(n.length === 4 && n[2].chat_id === 'dm-ana' && n[3].chat_id === 'dev', 'Ana writes in a DM (one for Ana), then in a channel that has had none (one for the channel, for everyone there)');
// her own words, per person or chat, through her tool
const mcp = async (method, params) => (await api('/mcp', 'POST', { jsonrpc: '2.0', id: 1, method, params })).json.result;
const herNotice = async (args) => JSON.parse((await mcp('tools/call', { name: 'away_notices', arguments: args })).content[0].text);
ok((await herNotice({ action: 'set', bridge: 'discord', scope: 'person', key: 'u-eve', text: "Eve, I'll write back tonight." })).ok, 'she sets her own words for one person, with her tool');
ok((await herNotice({ action: 'set', bridge: 'discord', scope: 'chat', key: 'quiet-room', text: '' })).ok, 'and silence for one chat');
const refusedA = await herNotice({ action: 'set', bridge: 'discord', scope: 'default', text: USAGE_LIMIT });
const refusedB = await herNotice({ action: 'set', bridge: 'discord', scope: 'default', text: 'my model lives at 192.168.1.50:11434' });
ok(refusedA.error && refusedB.error && (await api('/host/status')).json.settings.notices.discord.default === NOTICE, 'a notice with provider details is refused (error text, or an address); the old one stays');
await inject([{ id: 'e1', chat_id: 'dm-eve', author: { id: 'u-eve', name: 'Eve' }, text: 'hey' }, { id: 'q1', chat_id: 'quiet-room', guild_id: 'g2', author: { id: 'u-fay', name: 'Fay' }, text: 'anyone?' }]);
n = await notices();
ok(n.length === 5 && n[4].content === "Eve, I'll write back tonight." && !n.some(x => x.chat_id === 'quiet-room'), "Eve gets the words she chose for Eve; the quiet room gets nothing");
ok(host.queue.list().filter(m => !m.live).length === 9, 'every message waits in the queue all the same');

// her model again: checked, but sending stays off
probeOk = false;
let chk = (await api('/host/model/check', 'POST', {})).json;
ok(chk.ok === false && !(await api('/host/status')).json.model.attached, '"Try the model again" while it still fails: says so, nothing changes');
probeOk = true;
chk = (await api('/host/model/check', 'POST', {})).json;
st1 = (await api('/host/status')).json;
ok(chk.ok === true && st1.model.attached && st1.switches.loop.on && st1.switches.receive.on, '"Try the model again" when it answers: it works, the loop is free again');
ok(['heartbeat', 'schedules', 'sparks', 'send'].every(k => !st1.switches[k].on && st1.switches[k].why.join() === 'off since the model outage'), 'and sending, heartbeat, schedules and sparks stay off until the person turns them on');
await inject([{ id: 'b3', chat_id: 'dm-bo', author: { id: 'u-bo', name: 'Bo' }, text: 'still there?' }]);
ok(JSON.parse((await bridgeCall('get_new_messages')).content[0].text).length === 0 && (await notices()).length === 5, "receiving goes on (Bo's message waits; no second notice), and the Atelier is handed nothing to answer");
await api('/host/settings', 'PUT', { switches: { send: true } });
st1 = (await api('/host/status')).json;
ok(st1.switches.send.on && !st1.switches.heartbeat.on, 'the person turns sending on (the heartbeat stays off: that\'s a separate choice)');
const d = await api('/host/waiting/deliver', 'POST', {});
const handed = JSON.parse((await bridgeCall('get_new_messages')).content[0].text);
ok(d.json.delivered === 10 && handed.map(m => m.id).join() === 'b1,b2,c1,d1,c2,a2,a3,e1,q1,b3', 'give them to her now: the Atelier gets all ten that waited, oldest first');
// re-armed after she's been sending
await api('/host/settings', 'PUT', { switches: { send: false } });
await inject([{ id: 'b4', chat_id: 'dm-bo', author: { id: 'u-bo', name: 'Bo' }, text: 'and now?' }]);
ok((await notices()).length === 6 && (await notices())[5].chat_id === 'dm-bo', 'once her sending has been on, the notice is re-armed: Bo gets one again the next time');
await api('/host/settings', 'PUT', { switches: { send: true } });
await api('/host/waiting/deliver', 'POST', {}); await bridgeCall('get_new_messages');
// "auto": a regular check marks the model back; still nothing switched on
await api('/host/settings', 'PUT', { afterModel: 'auto' });
host.settings.modelLost('unreachable', 'could not reach the model');
probeOk = false; await sleep(300);
ok(!host.settings.model().attached, 'with "auto", while the check fails it stays gone');
probeOk = true; await sleep(300);
ok(host.settings.model().attached && !(await sw()).send.on, 'when the regular check succeeds the model counts as back; sending still waits for the person');
await api('/host/settings', 'PUT', { afterModel: 'ask' });
await api('/host/switches/resume', 'POST', {});

// ---------- her tool for what waited ----------
c.close(); await sleep(500);
await inject([{ id: 'w1', chat_id: 'dm-ana', author: { id: 'u-ana', name: 'Ana' }, text: 'a secret about the party' }, { id: 'w2', chat_id: 'general', guild_id: 'g1', author: { id: 'u-bo', name: 'Bo' }, text: 'news' }]);
c = await connect(); await sleep(200);
await api('/host/switches/resume', 'POST', {});
const her = (await mcp('tools/list')).tools.find(t => t.name === 'waiting_messages');
ok(her && /2 messages came while you were away/.test(her.description) && /Discord from Ana/.test(her.description) && !/secret about the party/.test(her.description), 'her tools tell her: 2 waiting, which bridge, who from, never the words');
const lst = JSON.parse((await mcp('tools/call', { name: 'waiting_messages', arguments: { action: 'list' } })).content[0].text);
ok(lst.count === 2 && !JSON.stringify(lst).includes('secret about the party'), 'list: who and where, without the words');
const rd = JSON.parse((await mcp('tools/call', { name: 'waiting_messages', arguments: { action: 'read', seq: lst.messages[0].seq } })).content[0].text);
ok(rd.messages[0].text === 'a secret about the party' && host.queue.list().filter(m => !m.live).length === 2, 'read: she reads one when she chooses; reading leaves it queued');
const hd = JSON.parse((await mcp('tools/call', { name: 'waiting_messages', arguments: { action: 'handled', all: true } })).content[0].text);
ok(hd.handled === 2 && hd.left === 0, 'handled: she marks them dealt with, and they leave the queue');
const info = JSON.parse((await mcp('tools/call', { name: 'host_info', arguments: {} })).content[0].text);
ok(info.model === 'attached' && info.switches.loop === 'on' && info.switches.send === 'on' && info.waiting === 'nothing', 'host_info tells her her switches, her model and what waits');
const got = await herNotice({ action: 'get' });
ok(got.notices.discord.people['u-eve'] === "Eve, I'll write back tonight.", 'and her tool shows her notices back to her');
c.close(); await shutdown();

// a turn the host runs itself starts with the notice of what waited
await boot({ brain: 'host' });
c = await connect(); await sleep(150);
c.close(); await sleep(450);
await inject([{ id: 'n1', chat_id: 'dm-di', author: { id: 'u-di', name: 'Di' }, text: 'later please' }]);
c = await connect(); await sleep(150);
await api('/host/switches/resume', 'POST', {});
calls.length = 0;
await rt.turn({ text: 'hello from the person' });
ok(calls[0] && calls[0].messages[0].role === 'system' && /1 message came while you were away/.test(calls[0].messages[0].content) && /Discord from Di/.test(calls[0].messages[0].content) && !/later please/.test(calls[0].messages[0].content), "a turn begins with her notice of what waited (count, bridge, who), not the message's words");
const trace = fs.readFileSync(path.join(host.stateDir, 'trace.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
ok(['model.request', 'model.reply', 'model.check', 'bridge.in', 'bridge.out', 'bridge.blocked'].every(k => trace.some(t => t.kind === k)), 'the trace holds what went to the model and what came back, model checks, each bridge message in and out, and what was stopped');

// ---------- the host's settings page ----------
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
await ctx.addInitScript(t => localStorage.setItem('pdhost:token', t), T);
const page = await ctx.newPage();
page.on('pageerror', e => fail.push('[pageerror] ' + e.message));
page.on('dialog', dl => dl.accept());
await page.goto(host.base + '/host/');
await page.waitForSelector('[data-sw="heartbeat"]', { timeout: 15000 });
ok(/^Awake/.test(await page.textContent('#napPill')) && /Model attached/.test(await page.textContent('#modelPill')), 'the settings page shows awake and the model attached');
ok((await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim())).toUpperCase() === '#BD72F3' && await page.evaluate(() => getComputedStyle(document.querySelector('h1')).color) === 'rgb(189, 114, 243)', "in the Atelier's new colour, #BD72F3 (189, 114, 243)");
ok(await page.locator('[data-sw="receive"]').count() === 1 && await page.locator('[data-sw="send"]').count() === 1, 'receiving and sending are separate switches on the page');
await page.uncheck('[data-sw="sparks"]'); await sleep(400);
ok((await api('/host/settings')).json.switches.sparks === false, "turning a switch off on the page changes the host's one setting");
await api('/host/settings', 'PUT', { switches: { sparks: true }, queueWarnAt: 1234 });
await page.waitForFunction(() => document.querySelector('[data-sw="sparks"]').checked && document.querySelector('[data-set="queueWarnAt"]').value === '1234', null, { timeout: 5000 }).catch(() => {});
ok(await page.isChecked('[data-sw="sparks"]') && await page.inputValue('[data-set="queueWarnAt"]') === '1234', 'and a change made elsewhere shows on the page (one source of truth)');
c.close(); await sleep(700);
await page.waitForFunction(() => /turned off by the nap/.test(document.querySelector('#swList').textContent), null, { timeout: 5000 }).catch(() => {});
ok(/turned off by the nap/.test(await page.textContent('#swList')) && await page.isVisible('#resume'), 'after a nap the page says which switches the nap turned off, and offers to turn them back on');
host.settings.modelLost('usage-limit', USAGE_LIMIT);
await page.waitForFunction(() => /No model/.test(document.querySelector('#modelPill').textContent), null, { timeout: 5000 }).catch(() => {});
ok(/No model \(usage-limit\)/.test(await page.textContent('#modelPill')) && await page.isVisible('#modelCheck') && await page.isVisible('#modelBack'), 'with no model: the page says so, and offers "Try the model again" and "She has a model again"');
probeOk = true;
await page.click('#modelCheck');
await page.waitForFunction(() => /it works/.test(document.querySelector('#note').textContent), null, { timeout: 5000 }).catch(() => {});
ok(/it works/.test(await page.textContent('#note')) && host.settings.model().attached && !host.settings.on('send'), '"Try the model again" shows it works, and leaves sending off');
await page.selectOption('#noticeForm [name="scope"]', 'person');
await page.fill('#noticeForm [name="key"]', 'u-gus');
await page.fill('#noticeForm [name="text"]', 'Gus! Back soon.');
await page.click('#noticeForm button'); await sleep(400);
ok((await api('/host/status')).json.settings.notices.discord.people['u-gus'] === 'Gus! Back soon.', "the person can set her notice for someone on the page too");
await page.selectOption('#noticeForm [name="scope"]', 'default');
await page.fill('#noticeForm [name="text"]', 'reach me at 10.0.0.7');
await page.click('#noticeForm button'); await sleep(400);
ok(/address, a key/.test(await page.textContent('#note')) && (await api('/host/status')).json.settings.notices.discord.default === NOTICE, 'and the page shows why a notice with an address is refused');
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

await shutdown();
fs.rmSync(tmp, { recursive: true, force: true });
console.log(log.join('\n')); console.log('\n' + (fail.length ? fail.join('\n') : 'ALL PASS'));
process.exit(fail.length ? 1 : 0);
