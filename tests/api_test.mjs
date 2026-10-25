import pw from 'playwright';
import fs from 'node:fs';
const { chromium } = pw;
const URL_ = process.argv[2] || 'file://' + process.env.JV_WEB;
const css = fs.readFileSync('tw.css', 'utf8');
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' };
const log = [], fail = []; const ok = (c, m) => (c ? log : fail).push((c ? 'PASS ' : 'FAIL ') + m);
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
// a fake Android shell: records what the page tells the native API server and hands back answers
await ctx.addInitScript(() => {
  if (!localStorage.getItem('jvault:settings')) localStorage.setItem('jvault:settings', JSON.stringify({ model: 'qwen3:8b', journalOn: false }));
  window.__apiWait = {}; window.__cfg = []; window.__keep = [];
  window.NetrunnerAndroid = {
    apiConfigure(on, port, lan, token) { window.__cfg.push({ on, port, lan, token }); return JSON.stringify({ enabled: on, listening: on, port, lan, addresses: on ? ['http://127.0.0.1:' + port] : [], error: '' }); },
    apiStatus() { const c = window.__cfg.at(-1) || { on: false, port: 8787, lan: false }; return JSON.stringify({ enabled: c.on, listening: c.on, port: c.port, lan: c.lan, addresses: c.on ? ['http://127.0.0.1:' + c.port] : [], error: '' }); },
    apiResult(id, status, body) { const w = window.__apiWait[id]; if (w) w({ status, body: JSON.parse(body) }); },
    keepAlive(on, text) { window.__keep.push([on, text]); return true; }, batteryOptimized() { return false; }, requestNotifications() {}, openBatterySettings() {},
    ttsAvailable() { return false; }, speak() { return false; }, stop() {}, notify() {}, saveFile() {}, openTtsSettings() {},
  };
});
const page = await ctx.newPage();
page.on('pageerror', e => fail.push('[pageerror] ' + e.message));
const sentToModel = [];
let holdModel = null;   // a promise that stalls the fake model, to test "busy"
await page.route('**/*', async route => {
  const req = route.request(); const url = req.url();
  if (url.startsWith('file://') || url.startsWith('data:') || url.startsWith('blob:')) return route.continue();
  if (url.startsWith('https://cdn.tailwindcss.com/')) return route.fulfill({ contentType: 'text/javascript', body: `window.tailwind={};(function(){var s=document.createElement('style');s.textContent=${JSON.stringify(css)};document.head.prepend(s);})();` });
  if (url.includes('marked.min.js')) return route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(process.env.JV_NM + 'marked/lib/marked.umd.js', 'utf8') });
  if (url.includes('purify.min.js')) return route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(process.env.JV_NM + 'dompurify/dist/purify.min.js', 'utf8') });
  if (url === 'http://localhost:11434/api/tags') return route.fulfill({ headers: CORS, contentType: 'application/json', body: JSON.stringify({ models: [{ name: 'qwen3:8b' }] }) });
  if (url === 'http://localhost:11434/api/chat') {
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const b = JSON.parse(req.postData());
    if (!b.stream) return route.fulfill({ headers: CORS, contentType: 'application/json', body: JSON.stringify({ message: { role: 'assistant', content: '- ok' }, done: true }) });
    sentToModel.push(b.messages.at(-1));
    if (holdModel) await holdModel;
    const last = b.messages.at(-1);
    const userText = [...b.messages].reverse().find(m => m.role === 'user')?.content || '';
    const step = last.role === 'user' && /use a tool/.test(userText) ? { tool_calls: [{ function: { name: 'bash', arguments: { command: 'ls /' } } }] } : { content: last.role === 'tool' ? 'Tool done.' : 'Echo: ' + userText.replace(/^\[[^\]]*\]\s*/, '') };
    return route.fulfill({ headers: CORS, contentType: 'application/x-ndjson', body: JSON.stringify({ message: { role: 'assistant', content: step.content || '', ...(step.tool_calls ? { tool_calls: step.tool_calls } : {}) }, done: false }) + '\n' + JSON.stringify({ message: { role: 'assistant', content: '' }, done: true, prompt_eval_count: 10, eval_count: 5 }) + '\n' });
  }
  return route.abort();
});
await page.goto(URL_);
await page.waitForFunction(() => typeof __jadeApi === 'function' && typeof userShell !== 'undefined' && S.model, null, { timeout: 90000 });
await page.waitForTimeout(1200);
const call = (route, params = {}) => page.evaluate(([r, p]) => new Promise(res => { const id = 't' + Math.random(); window.__apiWait[id] = res; window.__jadeApi(id, r, p); }), [route, params]);

// ---- chat: JSON out, and the message goes through the normal chat UI ----
let r = await call('chat', { message: 'hello there', new: '1' });
ok(r.status === 200 && r.body.ok === true && r.body.api === 1 && r.body.reply === 'Echo: hello there' && r.body.error === null, 'chat -> 200 JSON with the reply text: ' + JSON.stringify(r.body).slice(0, 200));
ok(r.body.session?.id && r.body.model === 'qwen3:8b' && typeof r.body.elapsed_ms === 'number' && Array.isArray(r.body.tool_calls), 'reply carries session, model, elapsed_ms, tool_calls');
const ui = await page.evaluate(() => document.querySelector('#chat').textContent);
ok(/hello there/.test(ui) && /Echo: hello there/.test(ui), 'the API message and answer appear in the normal chat');
const sid = r.body.session.id;
ok(await page.evaluate(id => cur.id === id && cur.messages.filter(m => m.role === 'user').length === 1, sid), '"new" started a fresh chat');

// ---- same chat is continued by default; tool calls are reported ----
r = await call('chat', { message: 'please use a tool' });
ok(r.status === 200 && r.body.session.id === sid && r.body.reply === 'Tool done.', 'default continues the open chat: ' + JSON.stringify(r.body).slice(0, 160));
ok(r.body.tool_calls.length === 1 && r.body.tool_calls[0].name === 'bash' && r.body.tool_calls[0].arguments.command === 'ls /' && r.body.tool_calls[0].ok === true && typeof r.body.tool_calls[0].result === 'string', 'tool_calls: name, arguments, ok, result');
r = await call('chat', { message: 'please use a tool', tools: '0' });
ok(r.status === 200 && !('tool_calls' in r.body), 'tools=0 leaves tool_calls out');

// ---- input as one JSON object ----
r = await call('chat', { json: JSON.stringify({ message: 'from json', new: true }) });
ok(r.status === 200 && r.body.reply === 'Echo: from json' && r.body.session.id !== sid, 'json={...} works like query keys (and new:true)');
r = await call('chat', { json: '{nope' });
ok(r.status === 400 && r.body.ok === false && r.body.error.code === 'bad_json', 'bad json -> 400 bad_json');

// ---- errors are JSON too ----
r = await call('chat', {});
ok(r.status === 400 && r.body.error.code === 'missing_message', 'no message -> 400');
r = await call('chat', { message: '/clear' });
ok(r.status === 400 && r.body.error.code === 'slash_command', 'slash commands are refused');
r = await call('chat', { message: 'x', session: 'does-not-exist' });
ok(r.status === 404 && r.body.error.code === 'unknown_session', 'unknown session -> 404');
r = await call('nope', {});
ok(r.status === 404 && r.body.error.code === 'not_found', 'unknown route -> 404');

// ---- busy + wait=0 ----
let release; holdModel = new Promise(res => { release = res; });
r = await call('chat', { message: 'slow one', wait: '0' });
ok(r.status === 202 && r.body.accepted === true, 'wait=0 -> 202 accepted at once');
await page.waitForFunction(() => running === true, null, { timeout: 5000 });
let st = await call('status');
ok(st.status === 200 && st.body.busy === true, 'status says busy while she works');
r = await call('chat', { message: 'another' });
ok(r.status === 409 && r.body.error.code === 'busy' && r.body.busy === true, 'second message while busy -> 409');
release(); holdModel = null;
for (let i = 0; i < 80; i++) { st = await call('status'); if (!st.body.busy) break; await page.waitForTimeout(100); }
ok(st.body.busy === false && st.body.model === 'qwen3:8b' && st.body.session?.id, 'status is idle again, with model and session');

// ---- history + chats ----
let h = await call('history', { limit: '2' });
ok(h.status === 200 && h.body.messages.length === 2 && h.body.messages.at(-1).role === 'assistant' && h.body.messages.at(-1).content === 'Echo: slow one', 'history returns the last messages as JSON: ' + JSON.stringify(h.body.messages));
let c = await call('chats');
ok(c.status === 200 && c.body.chats.length >= 2 && c.body.chats.some(x => x.current) && c.body.chats.every(x => x.id && 'title' in x), '/chats lists chats, one marked current');
h = await call('history', { session: sid });
ok(h.status === 200 && h.body.session.id === sid && h.body.messages.some(m => m.content === 'Echo: hello there'), 'history of another chat by id, without switching to it');
r = await call('chat', { message: 'back in the first one', session: sid });
ok(r.status === 200 && r.body.session.id === sid && await page.evaluate(id => cur.id === id, sid), 'session=<id> continues that chat (and opens it in the app)');

// ---- settings: tabs ----
await page.evaluate(() => openSettings());
await page.waitForTimeout(300);
const tabs = await page.evaluate(() => [...document.querySelectorAll('#setTabs .set-tab')].map(b => b.dataset.tab));
ok(tabs.join() === 'model,memory,tools,connect,app', 'five settings tabs: ' + tabs);
const vis = () => page.evaluate(() => [...document.querySelectorAll('#settings section[data-tab]')].filter(s => !s.classList.contains('tab-off') && !s.hidden && s.offsetParent !== null).map(s => s.querySelector('.pane-h').textContent.trim()));
const allSections = await page.evaluate(() => document.querySelectorAll('#settings section[data-tab]').length);
ok(allSections === 20, 'every settings section is on a tab: ' + allSections);
await page.screenshot({ path: 'set_model.png' });
let v = await vis();
ok(v.includes('Model provider') && !v.includes('Long-term memory') && v.length <= 3, 'Model tab shows only its sections: ' + v);
await page.click('#setTabs [data-tab="memory"]');
v = await vis();
ok(v.includes('Long-term memory') && v.includes('History compaction') && !v.includes('Model provider'), 'Memory tab: ' + v);
await page.click('#setTabs [data-tab="connect"]');
v = await vis();
ok(v.includes('API endpoint'), 'Connect tab has the API section: ' + v);
await page.fill('#setSearch', 'bm25');
v = await vis();
ok(v.length === 1 && v[0] === 'Long-term memory', 'search finds a setting on another tab: ' + v);
await page.fill('#setSearch', 'zzzzqqq');
ok((await vis()).length === 0 && await page.evaluate(() => !document.querySelector('#setNone').hidden), 'search with no match says so');
await page.fill('#setSearch', '');
ok((await vis()).includes('API endpoint'), 'clearing the search returns to the tab');

// ---- settings: API section ----
await page.click('#setTabs [data-tab="connect"]');
ok(await page.evaluate(() => !document.querySelector('#apiNative').hidden && document.querySelector('#apiWeb').hidden), 'API controls shown in the Android app');
await page.evaluate(() => document.querySelector('#settings .inner').scrollTo(0, 0));
await page.screenshot({ path: 'set_connect.png' });
await page.evaluate(() => { document.querySelector('#sApiOn').checked = true; document.querySelector('#sApiPort').value = '9123'; document.querySelector('#sApiLan').checked = true; });
await page.click('#btnSave');
await page.waitForTimeout(500);
const cfg = await page.evaluate(() => window.__cfg.at(-1));
ok(cfg.on === true && cfg.port === 9123 && cfg.lan === true && /^jv_[0-9a-f]{36}$/.test(cfg.token), 'Save starts the API with port, LAN flag and a generated token: ' + JSON.stringify(cfg));
const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('jvault:settings')));
ok(saved.apiOn === true && saved.apiPort === 9123 && saved.apiToken === cfg.token, 'API settings persist');
ok(await page.evaluate(() => window.__keep.some(k => k[0] === true && /9123/.test(k[1]))), 'while the API is on the app is kept alive in the background');
await page.evaluate(() => openSettings()); await page.waitForTimeout(200); await page.click('#setTabs [data-tab="connect"]');
ok(await page.evaluate(() => /9123/.test(document.querySelector('#apiExample').textContent) && document.querySelector('#apiExample').textContent.includes(S.apiToken) && /Listening/.test(document.querySelector('#apiStatus').textContent)), 'status line and curl example reflect the settings');
await page.evaluate(() => { document.querySelector('#sApiOn').checked = false; });
await page.click('#btnSave'); await page.waitForTimeout(400);
ok((await page.evaluate(() => window.__cfg.at(-1))).on === false, 'turning it off stops the server');
await page.screenshot({ path: 'api_settings.png' });

console.log(log.join('\n')); console.log('\n' + (fail.length ? fail.join('\n') : 'ALL PASS'));
await browser.close();
