// AICord provider: characters as models, one non-streamed reply per call, error messages, settings UI, backup hygiene.
import { autoTabs } from './_tabs.mjs';
import pw from 'playwright';
import fs from 'node:fs';
const { chromium } = pw;
const URL_ = process.argv[2] || 'file://' + process.env.JV_WEB;
const OUT = process.cwd() + '/ashots'; fs.mkdirSync(OUT, { recursive: true });
const css = fs.readFileSync('tw.css', 'utf8');
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' };
const log = [], fail = []; const ok = (c, m) => (c ? log : fail).push((c ? 'PASS ' : 'FAIL ') + m);
const UUID_A = '11111111-1111-4111-8111-111111111111', UUID_B = '22222222-2222-4222-8222-222222222222';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
await ctx.addInitScript(() => { if (!localStorage.getItem('jvault:settings')) localStorage.setItem('jvault:settings', JSON.stringify({ provider: 'aicord', aicKey: 'aic_test', journalOn: false })); });
const page = autoTabs(await ctx.newPage());
page.on('pageerror', e => fail.push('[pageerror] ' + e.message));
const chats = []; const auth = []; let mode = 'ok';
await page.route('**/*', async route => {
  const req = route.request(); const url = req.url();
  if (url.startsWith('file://') || url.startsWith('data:') || url.startsWith('blob:')) return route.continue();
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
  if (url.startsWith('https://cdn.tailwindcss.com/')) return route.fulfill({ contentType: 'text/javascript', body: `window.tailwind={};(function(){var s=document.createElement('style');s.textContent=${JSON.stringify(css)};document.head.prepend(s);})();` });
  if (url.includes('marked.min.js')) return route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(process.env.JV_NM + 'marked/lib/marked.umd.js', 'utf8') });
  if (url.includes('katex.min.js')) return route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(process.env.JV_NM + 'katex/dist/katex.min.js', 'utf8') });
  if (url.includes('purify.min.js')) return route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(process.env.JV_NM + 'dompurify/dist/purify.min.js', 'utf8') });
  if (url === 'https://aicordapp.com/api/v1/characters') {
    auth.push(req.headers().authorization);
    if (mode === '401') return route.fulfill({ status: 401, headers: CORS, contentType: 'application/json', body: '{}' });
    return route.fulfill({ headers: CORS, contentType: 'application/json', body: JSON.stringify([{ id: UUID_A, name: 'Mira', model: 'x' }, { id: UUID_B, name: 'Mira' }]) });
  }
  if (url === 'https://aicordapp.com/api/v1/chat') {
    auth.push(req.headers().authorization); const b = JSON.parse(req.postData()); chats.push(b);
    if (mode === '402') return route.fulfill({ status: 402, headers: CORS, contentType: 'application/json', body: '{}' });
    return route.fulfill({ headers: CORS, contentType: 'application/json', body: JSON.stringify({ id: 'r1', created: Date.now(), character: b.character, text: 'Hello from **Mira**.', tools_used: [], selfie: null, voice_message: null, usage: 1.5 }) });
  }
  return route.abort();
});
await page.goto(URL_);
await page.waitForFunction(() => /BUSYBOX|JS APPLETS/.test(document.querySelector('#txtShell')?.textContent || ''), null, { timeout: 90000 });
await page.waitForFunction(() => /AICORD|OFFLINE/.test(document.querySelector('#txtOllama')?.textContent || ''), null, { timeout: 30000 });
const st = await page.evaluate(() => ({ chip: $('#txtOllama').textContent, p: getProv() }));
ok(st.p.activeProv === 'aicord' && /AICORD LINKED/.test(st.chip), 'AICord links: ' + st.chip);
ok(JSON.stringify(st.p.models) === '["Mira","Mira (2)"]', 'characters are the model list, duplicate names disambiguated: ' + JSON.stringify(st.p.models));
ok(auth[0] === 'aic_test', 'the key goes in Authorization as given: ' + auth[0]);
await page.fill('#input', 'Hi there'); await page.tap('#btnSend');
await page.waitForFunction(() => !running && /Hello from/.test(document.querySelector('#chat').textContent), null, { timeout: 30000 });
const b = chats[0];
ok(b.character === UUID_A, 'chat goes to the chosen character UUID');
ok(b.messages.every(m => ['user', 'character'].includes(m.role) && Array.isArray(m.content) && m.content.every(p => p.type === 'text' || p.type === 'image_url')), 'history uses AICord roles and content parts');
ok(b.messages[0].role === 'user' && /Context from Jade Vault/.test(b.messages[0].content[0].text) && /Hi there/.test(b.messages.at(-1).content.at(-1).text), 'system prompt folded into the first user turn');
ok(!('tools' in b) && !('model' in b) && !('stream' in b), 'no tools / model / stream fields sent');
ok(/Hello from\s*Mira/.test((await page.textContent('#chat')).replace(/\s+/g, ' ')), 'reply rendered');
await page.screenshot({ path: OUT + '/1_chat.png' });
// second turn: assistant history goes back as "character"
await page.fill('#input', 'And again'); await page.tap('#btnSend');
await page.waitForFunction(() => !running && document.querySelectorAll('#chat .msg-ai').length >= 2, null, { timeout: 30000 });
ok(chats[1].messages.some(m => m.role === 'character' && /Hello from/.test(m.content[0].text)), 'earlier reply sent back as a character turn');
// 402 → readable error
mode = '402'; await page.fill('#input', 'no credits'); await page.tap('#btnSend');
await page.waitForFunction(() => !running && /no credits left/i.test(document.querySelector('#chat').textContent), null, { timeout: 30000 });
ok(true, '402 shows "no credits left"');
// settings UI
mode = 'ok';
await page.tap('#btnSettings'); await page.waitForTimeout(300);
const vis = async () => page.evaluate(() => [...document.querySelectorAll('[data-prov]')].filter(e => !e.hidden).map(e => e.querySelector('input').id).join(','));
ok((await vis()).split(',').includes('sAicKey'), 'AICord key field shown: ' + await vis());
ok(await page.inputValue('#sAicKey') === 'aic_test', 'key field loads the saved key');
ok(await page.locator('#sProvider option[value=aicord]').count() === 1 && await page.locator('#provSel option[value=aicord]').count() === 1, 'AICord in the provider menus');
await page.selectOption('#sProvider', 'openai'); ok(!(await vis()).includes('sAicKey'), 'field hidden for other providers');
await page.screenshot({ path: OUT + '/2_settings.png' });
// backups leave the key out
await page.addInitScript?.(() => {});
await page.evaluate(() => { window.NetrunnerAndroid = { saveFile(n, m, t) { window.__saved = [n, m, t]; setTimeout(() => window.__jadeSaved && window.__jadeSaved(true, n), 10); }, keepAlive() {}, batteryOptimized() { return true; } }; });
await page.tap('#btnExportAll'); await page.waitForFunction(() => window.__saved, null, { timeout: 15000 });
const bk = JSON.parse(await page.evaluate(() => window.__saved[2]));
ok(!('aicKey' in bk.settings) && !JSON.stringify(bk).includes('aic_test'), 'the AICord key is left out of backups');
// 401 → readable error on connect
await page.evaluate(() => { document.querySelector('#settings').hidden = true; S.provider = 'aicord'; });
await page.fill('#input', '/new'); await page.tap('#btnSend'); await page.waitForTimeout(400);
mode = '401'; await page.evaluate(() => connect({ quiet: true })); await page.waitForTimeout(500);
ok(/rejected the API key/.test(await page.textContent('#chat')), '401 → "rejected the API key"');
await page.evaluate(() => { S.aicKey = ''; }); await page.evaluate(() => connect({ quiet: true })); await page.waitForTimeout(500);
ok(/no AICord API key/.test(await page.textContent('#chat')), 'missing key is reported');
await page.screenshot({ path: OUT + '/3_errors.png' });
console.log(log.join('\n')); console.log('\n' + (fail.length ? fail.join('\n') : 'ALL PASS'));
await browser.close();
process.exit(fail.length ? 1 : 0);
