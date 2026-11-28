// Her models on the host (host/models.cjs), and where settings may be changed from (host/places.cjs).
//
// The person's decisions, 2026-11-27:
//   - her models, on the host, are as configurable as the browser Atelier's Config → Model provider, or more so:
//     any number of providers (another computer's Ollama is one more), and each job (her turns, heartbeat, schedules,
//     sparks, compaction, vision) with its own provider, model, fallbacks and options; keys write-only;
//   - settings can only be changed from the house's own network or the tailnet (and this machine), never from elsewhere.
// Stand-in model servers here: one shaped like Ollama, one like an OpenAI-compatible endpoint.
import pw from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
const { chromium } = pw;
const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(process.env.JV_WEB), '..');
const { createHomeHost } = require(path.join(ROOT, 'host', 'home_host.cjs'));
const { placeOf, requestPlace } = require(path.join(ROOT, 'host', 'places.cjs'));
const { createSettings } = require(path.join(ROOT, 'host', 'settings.cjs'));
const log = []; const fail = [];
const ok = (c, m) => { (c ? log : fail).push((c ? 'PASS ' : 'FAIL ') + m); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-models-'));
const HOME = path.join(tmp, 'home');
const USAGE_LIMIT = 'you (tidepool-account) have reached your session usage limit, upgrade for higher limits: https://ollama.com/upgrade (ref: 3f9c2e1a)';

// ---------- where a request comes from ----------
const places = {
  '127.0.0.1': 'this machine', '::1': 'this machine', '::ffff:127.0.0.1': 'this machine',
  '192.168.1.20': 'lan', '10.4.0.9': 'lan', '172.20.1.1': 'lan', '::ffff:10.0.0.1': 'lan', 'fe80::1': 'lan', 'fd12:3456::7': 'lan',
  '100.101.2.3': 'tailnet', '100.64.0.1': 'tailnet', 'fd7a:115c:a1e0::1234': 'tailnet',
  '8.8.8.8': 'elsewhere', '172.32.0.1': 'elsewhere', '100.128.0.1': 'elsewhere', '2001:db8::1': 'elsewhere', 'not an address': 'elsewhere',
};
const wrong = Object.entries(places).filter(([a, w]) => placeOf(a) !== w);
ok(!wrong.length, `addresses sorted into this machine, the LAN, the tailnet and elsewhere${wrong.length ? ': wrong for ' + wrong.map(([a]) => a).join(', ') : ''}`);
const fake = (addr, headers = {}) => ({ socket: { remoteAddress: addr }, headers });
ok(requestPlace(fake('127.0.0.1', { 'x-forwarded-for': '203.0.113.9' })).place === 'elsewhere', 'through a proxy on this machine, from the internet: elsewhere');
ok(requestPlace(fake('127.0.0.1', { 'x-forwarded-for': '100.101.2.3' })).place === 'elsewhere', "through a proxy, a tailnet-range address alone doesn't count (Funnel's relays use that range)");
ok(requestPlace(fake('127.0.0.1', { 'x-forwarded-for': '100.101.2.3', 'tailscale-user-login': 'someone@example.org' })).place === 'tailnet', "Tailscale Serve on the tailnet (it adds the user's login, which nobody can fake through it): tailnet");
ok(requestPlace(fake('127.0.0.1', { 'x-forwarded-for': '192.168.1.20' })).place === 'lan', 'through a proxy, from the house network: LAN');
ok(requestPlace(fake('203.0.113.9', { 'tailscale-user-login': 'someone@example.org', 'x-forwarded-for': '192.168.1.20' })).place === 'elsewhere', 'a request straight from the internet is elsewhere, whatever its headers say');
ok(placeOf('203.0.113.9', ['203.0.113.0/24']) === 'lan', 'the person can count more ranges as home (--trust), on the host only');

// ---------- stand-in model servers ----------
const seen = [];
let macMode = 'ok', apiMode = 'ok';
function serve(handler) { const s = http.createServer(async (req, res) => { let b = ''; for await (const d of req) b += d; const j = b ? JSON.parse(b) : null; seen.push({ url: req.url, auth: req.headers.authorization || '', body: j }); const [code, out] = handler(req, j); res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(out)); }); return new Promise(r => s.listen(0, '127.0.0.1', () => r(s))); }
const ollama = await serve((req, j) => {
  if (req.url === '/api/tags') return [200, { models: [{ name: 'small:3b' }, { name: 'qwen3:8b' }] }];
  if (macMode === 'limit') return [429, { error: USAGE_LIMIT }];
  if (macMode === 'down') return [503, { error: 'service unavailable' }];
  return [200, { message: { role: 'assistant', content: `ollama ${j.model} t=${j.options.temperature} ctx=${j.options.num_ctx}: ${j.messages[j.messages.length - 1].content}` } }];
});
const oai = await serve((req, j) => {
  if (req.url === '/v1/models') return [200, { data: [{ id: 'big-model' }, { id: 'whisper-1' }] }];
  if (req.headers.authorization !== 'Bearer api-key-for-test') return [401, { error: { message: 'invalid api key' } }];
  if (apiMode === 'limit') return [429, { error: { message: 'rate limit reached for requests' } }];
  return [200, { choices: [{ message: { role: 'assistant', content: `api ${j.model} t=${j.temperature}: ${j.messages[j.messages.length - 1].content}` } }] }];
});
const MAC = `http://127.0.0.1:${ollama.address().port}`, API = `http://127.0.0.1:${oai.address().port}/v1`;

// ---------- the host ----------
let host;
async function boot() { host = createHomeHost({ root: HOME }); await new Promise(r => host.server.listen(0, '127.0.0.1', r)); host.base = `http://127.0.0.1:${host.server.address().port}`; }
await boot();
const T = (await (await fetch(host.base + '/host/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: host.newPin(), name: 'Test client' }) })).json()).token;
const api = async (p, method = 'GET', body, extra = {}) => { const r = await fetch(host.base + p, { method, headers: { Authorization: 'Bearer ' + T, 'Content-Type': 'application/json', ...extra }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }); return { status: r.status, json: await r.json().catch(() => null) }; };

let m = (await api('/host/models')).json;
ok(['local', 'cloud', 'groq', 'llamacpp', 'openai', 'aicord'].every(id => m.providers[id]) && m.roles.chat.provider === 'local' && m.brain === 'client', "to start with: the Atelier's six providers, her turns on the local Ollama, her loop in the Atelier");
ok(['chat', 'heartbeat', 'schedules', 'sparks', 'compaction', 'vision'].every(r => m.roles[r]), 'a model for each job: her turns, heartbeat, schedules, sparks, compaction and vision');

// another computer's Ollama is one more provider; an OpenAI-compatible endpoint with a key
m = (await api('/host/models', 'PUT', { providers: { mac: { kind: 'ollama', label: "The Mac's Ollama", base: MAC }, api2: { kind: 'openai', label: 'Second API', base: API } } })).json;
ok(m.providers.mac && m.providers.api2 && m.providers.local, 'any number of providers: the Mac and a second OpenAI-compatible endpoint, beside the six');
ok((await api('/host/models/api2/key', 'PUT', { key: 'api-key-for-test' })).json.set === true, 'its key is set, write-only');
const st = (await api('/host/status')).json;
ok(st.models.providers.api2.keySet === true && !JSON.stringify(st).includes('api-key-for-test') && !fs.readFileSync(path.join(host.stateDir, 'settings.json'), 'utf8').includes('api-key-for-test'), 'the host says a key is set and never shows it (not in the status, not in the settings)');
const listed = (await api('/host/models/mac/list')).json.models;
const listed2 = (await api('/host/models/api2/list')).json.models;
ok(listed.join() === 'qwen3:8b,small:3b' && listed2.join() === 'big-model', 'each provider says which models it has (speech models left out, as in the Atelier)');

// jobs
await api('/host/models', 'PUT', { roles: { chat: { provider: 'mac', model: 'qwen3:8b', fallbacks: ['api2/big-model'] }, sparks: { provider: 'mac', model: 'small:3b', temperature: 0.9 }, heartbeat: { numCtx: 4096 } }, options: { temperature: 0.3 } });
m = (await api('/host/models')).json;
ok(m.roles.chat.fallbacks[0].provider === 'api2' && m.roles.chat.fallbacks[0].model === 'big-model' && m.roles.sparks.temperature === 0.9, 'each job keeps its own provider, model, fallbacks and options');
let r = await host.models.chat('chat', { messages: [{ role: 'user', content: 'hello' }] });
ok(r.content === 'ollama qwen3:8b t=0.3 ctx=16384: hello' && r.provider === 'mac', 'her turns go to the Mac, with the options set for all jobs');
r = await host.models.chat('sparks', { messages: [{ role: 'user', content: 'wonder' }] });
ok(r.content.startsWith('ollama small:3b t=0.9'), 'sparks go to their own small model, warmer');
r = await host.models.chat('heartbeat', { messages: [{ role: 'user', content: 'beat' }] });
ok(r.content === 'ollama qwen3:8b t=0.3 ctx=4096: beat', "a job with no provider of its own uses her turns' chain, with its own context size");
ok(seen.some(s => s.url === '/v1/models' && s.auth === 'Bearer api-key-for-test'), 'the key goes to its provider, and only there');

// a provider at its usage limit rests; the next one answers
macMode = 'limit';
r = await host.models.chat('chat', { messages: [{ role: 'user', content: 'still there?' }] });
ok(r.provider === 'api2' && r.content === 'api big-model t=0.3: still there?', 'the Mac hits its usage limit: the next in line answers');
ok((await api('/host/models')).json.providers.mac.restingFor > 0, 'and the Mac rests (30 minutes by default) instead of being asked first every time');
const before = seen.length;
await host.models.chat('chat', { messages: [{ role: 'user', content: 'again' }] });
ok(!seen.slice(before).some(s => s.url === '/api/chat'), 'while it rests, it is not asked');
const evs = fs.readFileSync(path.join(host.stateDir, 'events.jsonl'), 'utf8');
ok(evs.includes('"model.resting"') && evs.includes('"model.failover"') && !evs.includes('tidepool-account'), 'the log says it rested and moved on, never what the provider said');

// all of them gone: the runtime takes her model as gone (and nothing goes to anyone)
apiMode = 'limit';
host.settings.set({ afterNap: 'auto' }, 'test');
const rt = host.startRuntime({ brain: 'host', bridges: [], pollMs: 100000, tickMs: 100000, probeMs: 100000 });
host.settings.setNapping(false);
let err = null; try { await rt.turn({ text: 'hi' }); } catch (e) { err = e; }
ok(err && !host.settings.model().attached && host.settings.model().kind === 'usage-limit', "with every provider at its limit, her model counts as gone (usage limit), on the host's own loop");
ok(fs.readFileSync(path.join(host.stateDir, 'trace.jsonl'), 'utf8').includes('rate limit reached for requests'), 'what they said is in the trace, for the person, on the host (the Mac was resting, so only the second API was asked)');
macMode = 'ok'; apiMode = 'ok';
const chk = (await api('/host/model/check', 'POST', {})).json;
ok(chk.ok === true && host.settings.model().attached && !host.settings.on('send'), '"Try the model again" asks her models (even a resting one): it works; sending stays off for the person to turn on');
rt.stop();

// removing a provider keeps it removed, after a restart too
await api('/host/models', 'PUT', { providers: { groq: null } });
ok(!createSettings(host.stateDir).get().models.providers.groq && createSettings(host.stateDir).get().models.providers.mac, 'a provider the person removes stays removed (one of the six too), kept on disk');
await api('/host/models', 'PUT', { providers: { mac: { enabled: false } } });
m = (await api('/host/models')).json;
ok(m.providers.mac.enabled === false && m.providers.mac.base === MAC && m.providers.mac.kind === 'ollama', 'turning one off changes only that');
r = await host.models.chat('chat', { messages: [{ role: 'user', content: 'x' }] });
ok(r.provider === 'api2', 'a provider turned off is passed over');
await api('/host/models', 'PUT', { providers: { mac: { enabled: true } } });
ok((await api('/host/models', 'PUT', { providers: { 'Bad Id': { kind: 'ollama', base: MAC }, bad2: { kind: 'ollama', base: 'file:///etc' } } })).json.providers['bad2'] === undefined, "a provider that can't be used isn't saved (an id with spaces, an address that isn't http or https)");

// ---------- settings only from the house's network or the tailnet ----------
const FROM_OUT = { 'X-Forwarded-For': '203.0.113.9' };
const out = await api('/host/status', 'GET', undefined, FROM_OUT);
ok(out.status === 200 && out.json.you.place === 'elsewhere' && out.json.you.mayChange === false, 'a paired device from elsewhere can still look');
const tries = [
  ['/host/settings', 'PUT', { napGraceSec: 5 }], ['/host/switches/resume', 'POST', {}], ['/host/model/back', 'POST', {}], ['/host/model/check', 'POST', {}],
  ['/host/notices', 'POST', { action: 'set', bridge: 'discord', scope: 'default', text: 'hi' }], ['/host/bridges/discord/key', 'PUT', { key: 'x' }],
  ['/host/models', 'PUT', { brain: 'host' }], ['/host/models/api2/key', 'PUT', { key: 'stolen' }], ['/host/client/settings', 'PUT', { a: 1 }],
];
const res = []; for (const [p, mth, b] of tries) res.push((await api(p, mth, b, FROM_OUT)).status);
ok(res.every(s => s === 403), `from elsewhere, nothing about her settings changes (${tries.length} kinds of change, all refused)`);
ok(createSettings(host.stateDir).get().napGraceSec === 60 && (await api('/host/models')).json.brain === 'client', 'and nothing did change');
const mcpOut = await api('/mcp', 'POST', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'away_notices', arguments: { action: 'set', bridge: 'discord', scope: 'default', text: 'from outside' } } }, FROM_OUT);
ok(mcpOut.json.result.isError && /house's own network or the tailnet/.test(mcpOut.json.result.content[0].text), "her own notice tool, reached from elsewhere, doesn't change it either");
ok((await api('/host/waiting', 'GET', undefined, FROM_OUT)).status === 200 && (await api('/host/models', 'GET', undefined, FROM_OUT)).status === 200, 'reading still works from elsewhere');
ok((await api('/host/settings', 'PUT', { napGraceSec: 61 }, { 'X-Forwarded-For': '100.101.2.3', 'Tailscale-User-Login': 'someone@example.org' })).status === 200, 'from the tailnet (through Tailscale Serve), a change is made');
ok((await api('/host/settings', 'PUT', { napGraceSec: 60 }, { 'X-Forwarded-For': '192.168.1.20' })).status === 200 && (await api('/host/settings', 'PUT', { napGraceSec: 60 })).status === 200, 'from the house network and from this machine too');
ok(fs.readFileSync(path.join(host.stateDir, 'events.jsonl'), 'utf8').includes('"refused.settings-from-elsewhere"') && !fs.readFileSync(path.join(host.stateDir, 'events.jsonl'), 'utf8').includes('203.0.113.9'), 'each refusal is logged, without the address');

// ---------- the settings page ----------
const browser = await chromium.launch();
for (const [label, headers] of [['home', {}], ['elsewhere', FROM_OUT]]) {
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 900 }, extraHTTPHeaders: headers });
  await ctx.addInitScript((t) => { localStorage.setItem('pdhost:token', t); }, T);
  const page = await ctx.newPage();
  page.on('pageerror', e => fail.push(`[pageerror ${label}] ` + e.message));
  page.on('dialog', dl => dl.accept());
  await page.goto(host.base + '/host/');
  await page.waitForSelector('#roleRows tr', { timeout: 15000 });
  if (label === 'home') {
    ok(await page.locator('#roleRows tr').count() === 6 && await page.locator('#provRows tr').count() >= 7, 'the settings page shows each job and every provider');
    ok(/Here:/.test(await page.textContent('#wherePill')), 'and says where this device is');
    await page.fill('#provForm [name="id"]', 'hall');
    await page.fill('#provForm [name="label"]', 'Box down the hall');
    await page.selectOption('#provForm [name="kind"]', 'ollama');
    await page.fill('#provForm [name="base"]', MAC);
    await page.fill('#provForm [name="key"]', 'typed-hall-key');
    await page.click('#provForm button'); await sleep(600);
    m = (await api('/host/models')).json;
    ok(m.providers.hall && m.providers.hall.label === 'Box down the hall' && m.providers.hall.keySet && !JSON.stringify(m).includes('typed-hall-key'), 'a provider added on the page is saved, its key write-only');
    await page.waitForFunction(() => document.querySelector('#roleRows tr[data-role="vision"] [data-f="provider"] option[value="hall"]'), null, { timeout: 5000 }).catch(() => {});
    await page.selectOption('#roleRows tr[data-role="vision"] [data-f="provider"]', 'hall');
    await page.fill('#roleRows tr[data-role="vision"] [data-f="model"]', 'qwen3:8b');
    await page.fill('#roleRows tr[data-role="vision"] [data-f="fallbacks"]', 'api2/big-model');
    await page.click('#roleRows tr[data-role="vision"] [data-rolesave]'); await sleep(600);
    m = (await api('/host/models')).json;
    ok(m.roles.vision.provider === 'hall' && m.roles.vision.model === 'qwen3:8b' && m.roles.vision.fallbacks[0].provider === 'api2', 'a job set on the page: provider, model and fallbacks');
    await page.click('#roleRows tr[data-role="vision"] [data-listfor]');
    await page.waitForFunction(() => /models offered/.test(document.querySelector('#note').textContent), null, { timeout: 5000 }).catch(() => {});
    ok(await page.locator('#ml-vision option').count() === 2, 'the page asks a provider which models it has');
  } else {
    await page.waitForFunction(() => /look only/.test(document.querySelector('#wherePill').textContent), null, { timeout: 5000 }).catch(() => {});
    const lo = [/look only/.test(await page.textContent('#wherePill')), await page.isDisabled('[data-sw="heartbeat"]'), await page.isDisabled('#provForm button'), await page.isDisabled('[data-colour="accent"]')];
    ok(lo.every(Boolean), `from elsewhere the page says "look only" and its controls are off (${lo})`);
  }
  await ctx.close();
}
await browser.close();

await host.close(); ollama.close(); oai.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log(log.join('\n')); console.log('\n' + (fail.length ? fail.join('\n') : 'ALL PASS'));
process.exit(fail.length ? 1 : 0);
