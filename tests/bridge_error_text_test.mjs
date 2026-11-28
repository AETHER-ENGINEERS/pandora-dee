// Provider and model error text never goes to Vector or Discord, and a usage limit switches both bridges off.
// During an outage the Atelier used to post "⚠ <the provider's error>" into the chat it was answering, and a
// usage-limit error names the person's account. Stand-in bridge clients record what would have been sent.
import { autoTabs } from './_tabs.mjs';
import pw from 'playwright';
import fs from 'node:fs';
const { chromium } = pw;
const URL_ = 'file://' + process.env.JV_WEB;
const css = fs.readFileSync('tw.css', 'utf8');
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' };
const log = [], fail = []; const ok = (c, m) => (c ? log : fail).push((c ? 'PASS ' : 'FAIL ') + m);
// the error the person saw posted into channels (account and ids made up here)
const USAGE_LIMIT = 'you (tidepool-account) have reached your session usage limit, upgrade for higher limits: https://ollama.com/upgrade or add usage credits: https://ollama.com/settings (ref: 3f9c2e1a-77b0)';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
await ctx.addInitScript(() => { if (!localStorage.getItem('jvault:settings')) localStorage.setItem('jvault:settings', JSON.stringify({ provider: 'local', host: 'http://localhost:11434', model: 'qwen3:8b', journalOn: false, memoryOn: false, vecOn: true, dcOn: true })); });
const page = autoTabs(await ctx.newPage());
page.on('pageerror', e => fail.push('[pageerror] ' + e.message));
let mode = 'limit';
const ndjson = text => [{ message: { role: 'assistant', content: text }, done: false }, { message: { role: 'assistant', content: '' }, done: true, prompt_eval_count: 10, eval_count: 5, eval_duration: 1e8 }].map(x => JSON.stringify(x)).join('\n') + '\n';
await page.route('**/*', async route => {
  const req = route.request(); const url = req.url();
  if (url.startsWith('file://') || url.startsWith('data:') || url.startsWith('blob:')) return route.continue();
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
  if (url.startsWith('https://cdn.tailwindcss.com/')) return route.fulfill({ contentType: 'text/javascript', body: `window.tailwind={};(function(){var s=document.createElement('style');s.textContent=${JSON.stringify(css)};document.head.prepend(s);})();` });
  if (url.includes('marked.min.js')) return route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(process.env.JV_NM + 'marked/lib/marked.umd.js', 'utf8') });
  if (url.includes('katex.min.js')) return route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(process.env.JV_NM + 'katex/dist/katex.min.js', 'utf8') });
  if (url.includes('purify.min.js')) return route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(process.env.JV_NM + 'dompurify/dist/purify.min.js', 'utf8') });
  if (url === 'http://localhost:11434/api/tags') return route.fulfill({ headers: CORS, contentType: 'application/json', body: JSON.stringify({ models: [{ name: 'qwen3:8b' }] }) });
  if (url === 'http://localhost:11434/api/chat') {
    const b = JSON.parse(req.postData());
    if (!b.stream) return route.fulfill({ headers: CORS, contentType: 'application/json', body: JSON.stringify({ message: { role: 'assistant', content: 'ok' }, done: true }) });
    if (mode === 'limit') return route.fulfill({ status: 429, headers: CORS, contentType: 'application/json', body: JSON.stringify({ error: USAGE_LIMIT }) });
    if (mode === 'auth') return route.fulfill({ status: 401, headers: CORS, contentType: 'application/json', body: JSON.stringify({ error: 'unauthorized' }) });
    if (mode === 'echo') return route.fulfill({ headers: CORS, contentType: 'application/x-ndjson', body: ndjson('⚠ HTTP 429: ' + USAGE_LIMIT) });
    return route.fulfill({ headers: CORS, contentType: 'application/x-ndjson', body: ndjson('Hello! Lovely to hear from you.') });
  }
  return route.abort();
});
await page.goto(URL_);
await page.waitForFunction(() => typeof vecWake === 'function' && typeof dcWake === 'function' && typeof S !== 'undefined', null, { timeout: 30000 });
await page.waitForTimeout(1500);
// stand-in bridge clients: everything that would go out is recorded
await page.evaluate(() => {
  window.__sent = [];
  const fake = (bridge) => ({ request: async (m, p) => { window.__sent.push({ bridge, tool: p.name, args: p.arguments }); return { content: [{ type: 'text', text: p.name === 'send_message' ? JSON.stringify({ chat_id: p.arguments.chat_id, message_id: 'x' }) : '' }] }; }, close() {} });
  VEC.client = fake('vector'); VEC.connected = true; DC.client = fake('discord'); DC.connected = true;
});
const sent = () => page.evaluate(() => window.__sent.filter(s => s.tool === 'send_message'));
const reset = () => page.evaluate(() => { window.__sent.length = 0; S.vecOn = true; S.dcOn = true; delete S.bridgesOffBy; const f = (bridge) => ({ request: async (m, p) => { window.__sent.push({ bridge, tool: p.name, args: p.arguments }); return { content: [{ type: 'text', text: p.name === 'send_message' ? JSON.stringify({ chat_id: p.arguments.chat_id, message_id: 'x' }) : '' }] }; }, close() {} }); VEC.client = f('vector'); DC.client = f('discord'); VEC.connected = DC.connected = true; });
const OWNER_NPUB = 'npub1owner000000000000000000000000000000000000000000000000000';
const vecItem = { kind: 'msg', chat_id: OWNER_NPUB, is_group: false, sender: OWNER_NPUB, role: 'owner', msgs: [{ id: 'v1', content: 'are you there?' }] };
const dcItem = { chat_id: '80000000000000800', is_group: true, sender: '10000000000000100', guild_id: '70000000000000700', role: 'owner', msgs: [{ id: 'd1', content: 'hi Pandora', author: { id: '10000000000000100' } }] };

// ---------- the text check itself ----------
const checks = await page.evaluate((u) => ({
  stopped: [u, '⚠ ' + u, '⚠ HTTP 429: Too Many Requests', 'Error: 401 Unauthorized', 'Groq rejected the API key (401)', '{"type":"error","error":{"type":"overloaded_error"}}', 'see https://platform.openai.com/account/billing'].map(t => looksLikeProviderError(t)),
  passed: ['I hit the rate limit on my bike app lol', 'Error handling in Rust is lovely.', 'The meeting is at 10.30.', 'Here is the link: https://example.org/upgrade-guide', "Fae is napping, she'll respond to your messages as soon as she's able!"].map(t => looksLikeProviderError(t)),
}), USAGE_LIMIT);
ok(checks.stopped.every(Boolean), 'provider and model errors are recognised (the usage-limit text, "⚠ HTTP 429", a refused key, an error object, a billing link)');
ok(!checks.passed.some(Boolean), 'ordinary words are not (rate limits on a bike app, error handling in Rust, a link, her nap notice)');

// ---------- a Vector turn at the usage limit ----------
await page.evaluate((it) => vecWake(it), vecItem);
let s = await sent();
let st = await page.evaluate(() => ({ vec: S.vecOn, dc: S.dcOn, by: S.bridgesOffBy, saved: JSON.parse(localStorage.getItem('jvault:settings') || '{}') }));
ok(s.length === 0, 'a Vector turn that hits the usage limit posts nothing to the chat (it used to post "⚠ <the error>")');
ok(st.vec === false && st.dc === false && st.by && st.by.kind === 'usage-limit' && st.saved.vecOn === false && st.saved.dcOn === false, 'and Vector and Discord are both switched off, and stay off (saved) until the person turns them on');
const toastText = await page.evaluate(() => document.querySelector('#toastMsg').textContent);
ok(/Vector and Discord switched off: her model's usage limit was reached/.test(toastText) && !/tidepool-account/.test(toastText), 'the person is told here, on their own screen (not in a chat), and the notice carries no error text');
const n0 = await page.evaluate(() => window.__sent.length);
await page.evaluate((it) => vecWake(it), vecItem);
ok((await page.evaluate(() => window.__sent.length)) === n0, 'while Vector is off, a waiting message wakes nothing and nothing is sent');

// ---------- a Discord turn at the usage limit ----------
await reset();
await page.evaluate((it) => dcWake(it), dcItem);
s = await sent();
st = await page.evaluate(() => ({ vec: S.vecOn, dc: S.dcOn }));
ok(s.length === 0 && st.vec === false && st.dc === false, 'the same on Discord: nothing posted to the channel, both bridges off');

// ---------- a refused key: nothing posted, bridges left as they are ----------
await reset(); mode = 'auth';
await page.evaluate((it) => dcWake(it), dcItem);
s = await sent(); st = await page.evaluate(() => ({ vec: S.vecOn, dc: S.dcOn }));
ok(s.length === 0 && st.vec === true && st.dc === true, 'a refused key: nothing posted either; the bridges stay on (only a usage limit switches them off)');

// ---------- her reply reads like a provider error ----------
await reset(); mode = 'echo';
await page.evaluate((it) => vecWake(it), vecItem);
s = await sent(); st = await page.evaluate(() => ({ vec: S.vecOn, dc: S.dcOn }));
ok(s.length === 0 && st.vec === false, "a reply of hers that reads like the usage-limit error isn't posted, and counts as the limit");

// ---------- a tool call of hers ----------
await reset();
const r = await page.evaluate(async (u) => { try { await dcCall('send_message', { chat_id: '1', content: '⚠ ' + u }); return 'sent'; } catch (e) { return e.message; } }, USAGE_LIMIT);
ok(/Not sent/.test(r) && (await page.evaluate(() => window.__sent.length)) === 0, 'any bridge call carrying provider error text is refused before it leaves (her own discord or vector tool too)');

// ---------- ordinary replies still go out ----------
await reset(); mode = 'ok';
await page.evaluate((it) => vecWake(it), vecItem);
await page.evaluate((it) => dcWake(it), dcItem);
s = await sent();
ok(s.length === 2 && s.every(x => x.args.content === 'Hello! Lovely to hear from you.') && s[0].bridge === 'vector' && s[1].bridge === 'discord', 'ordinary replies still go out on both bridges');

await browser.close();
console.log(log.join('\n')); console.log('\n' + (fail.length ? fail.join('\n') : 'ALL PASS'));
process.exit(fail.length ? 1 : 0);
