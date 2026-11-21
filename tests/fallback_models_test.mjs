// Fallback models on the same provider, and a second Ollama address as its own provider.
// One Ollama serves cloud models (through its account) and local ones: when the cloud model hits its limit, she goes
// on with a local model on the same Ollama, and the cloud model comes back once it has rested. When the whole Ollama
// (on another machine) is out, a second Ollama at another address takes over.
import { autoTabs } from './_tabs.mjs';
import pw from 'playwright';
import fs from 'node:fs';
const { chromium } = pw;
const URL_ = 'file://' + process.env.JV_WEB;
const css = fs.readFileSync('tw.css', 'utf8');
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' };
const log = [], fail = []; const ok = (c, m) => (c ? log : fail).push((c ? 'PASS ' : 'FAIL ') + m);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
await ctx.addInitScript(() => { if (!localStorage.getItem('jvault:settings')) localStorage.setItem('jvault:settings', JSON.stringify({
  provider: 'local', host: 'http://localhost:11434', model: 'kimi-k2.7-code:cloud', modelBy: { local: 'kimi-k2.7-code:cloud' },
  modelFallbacks: { local: ['qwen3.8:27b'] }, journalOn: false, memoryOn: false })); });
const page = autoTabs(await ctx.newPage());
page.on('pageerror', e => fail.push('[pageerror] ' + e.message));

let cloudOut = true, macDown = false; const asked = [];
const ndjson = text => [{ message: { role: 'assistant', content: text }, done: false }, { message: { role: 'assistant', content: '' }, done: true, prompt_eval_count: 100, eval_count: 5, eval_duration: 1e8 }].map(x => JSON.stringify(x)).join('\n') + '\n';
const limit = { status: 429, headers: CORS, contentType: 'application/json', body: JSON.stringify({ error: 'you (mrrowr) have reached your weekly usage limit, upgrade for higher limits' }) };
await page.route('**/*', async route => {
  const req = route.request(); const url = req.url();
  if (url.startsWith('file://') || url.startsWith('data:') || url.startsWith('blob:')) return route.continue();
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
  if (url.startsWith('https://cdn.tailwindcss.com/')) return route.fulfill({ contentType: 'text/javascript', body: `window.tailwind={};(function(){var s=document.createElement('style');s.textContent=${JSON.stringify(css)};document.head.prepend(s);})();` });
  if (url.includes('marked.min.js')) return route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(process.env.JV_NM + 'marked/lib/marked.umd.js', 'utf8') });
  if (url.includes('katex.min.js')) return route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(process.env.JV_NM + 'katex/dist/katex.min.js', 'utf8') });
  if (url.includes('purify.min.js')) return route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(process.env.JV_NM + 'dompurify/dist/purify.min.js', 'utf8') });
  // "the Mac": an Ollama on another machine, with a cloud model and a local one
  for (const [base, name] of [['http://localhost:11434/', 'this'], ['http://mac.test:11434/', 'mac']]) {
    if (!url.startsWith(base)) continue;
    if (name === 'mac' && macDown) return route.abort('connectionrefused');
    if (url.endsWith('/api/tags')) return route.fulfill({ headers: CORS, contentType: 'application/json', body: JSON.stringify({ models: name === 'mac' ? [{ name: 'kimi-k2.7-code:cloud' }] : [{ name: 'kimi-k2.7-code:cloud' }, { name: 'qwen3.8:27b' }] }) });
    if (url.endsWith('/api/chat')) {
      const m = JSON.parse(req.postData()).model; asked.push(`${name}:${m}`);
      if (/:cloud$/.test(m) && (cloudOut || name === 'mac')) return route.fulfill(limit);
      return route.fulfill({ headers: CORS, contentType: 'application/x-ndjson', body: ndjson(`Answered by ${m} on ${name}.`) });
    }
  }
  return route.abort();
});

await page.goto(URL_);
await page.waitForFunction(() => /BUSYBOX|JS APPLETS/.test(document.querySelector('#txtShell')?.textContent || ''), null, { timeout: 90000 });
await page.waitForFunction(() => typeof getProv === 'function' && getProv().models.length > 0, null, { timeout: 30000 });
const send = async (text) => {
  const n = await page.evaluate(() => document.querySelectorAll('#chat .msg-ai').length);
  await page.fill('#input', text); await page.click('#btnSend');
  await page.waitForFunction(k => !running && document.querySelectorAll('#chat .msg-ai').length > k, n, { timeout: 30000 }); await page.waitForTimeout(300);
  return page.evaluate(() => [...document.querySelectorAll('#chat .msg-ai')].at(-1).textContent);
};

// 1. the cloud model is out of its limit: the local model on the same Ollama answers, no other provider needed
ok(await page.evaluate(() => S.model) === 'kimi-k2.7-code:cloud', 'starts on the cloud model');
let said = await send('Hello?');
ok(/Answered by qwen3.8:27b on this/.test(said), 'a cloud model out of its limit → the next model on the same Ollama: ' + said.slice(0, 80));
ok(asked.join() === 'this:kimi-k2.7-code:cloud,this:qwen3.8:27b', 'tried the cloud model once, then the local one: ' + asked.join());
ok(await page.evaluate(() => getProv().activeProv) === 'local', 'still the same provider');
ok(await page.evaluate(() => S.modelBy.local === 'kimi-k2.7-code:cloud' && JSON.parse(localStorage.getItem('jvault:settings')).modelBy.local === 'kimi-k2.7-code:cloud'), 'her chosen model is still the remembered one');
asked.length = 0;
said = await send('Still there?');
ok(/qwen3.8:27b/.test(said) && asked.join() === 'this:qwen3.8:27b', 'while the cloud model rests, it isn\'t asked again: ' + asked.join());

// 2. its rest is over and the cloud has room again: the chosen model comes back by itself
cloudOut = false; asked.length = 0;
await page.evaluate(() => { for (const k of Object.keys(window.MODEL_REST)) window.MODEL_REST[k] = 0; });
said = await send('And now?');
ok(/Answered by kimi-k2.7-code:cloud on this/.test(said) && await page.evaluate(() => S.model) === 'kimi-k2.7-code:cloud', 'after its rest, the chosen model is back: ' + said.slice(0, 80));

// 3. a second Ollama: the main one is another machine (out of its limit, then unreachable); this computer's takes over
await page.evaluate(async () => { S.provider = 'local'; S.host = 'http://mac.test:11434'; S.modelBy = { local: 'kimi-k2.7-code:cloud', local2: 'qwen3.8:27b' }; S.modelFallbacks = {}; S.host2 = 'http://localhost:11434'; S.fallbacks = ['local2']; S.fallbackOrder = ['local', 'local2', 'llamacpp', 'cloud', 'groq', 'openai', 'aicord']; await connect(); });
ok(await page.evaluate(() => getProv().activeProv) === 'local', 'connected to the Mac\'s Ollama first');
asked.length = 0;
said = await send('Over to you, second Ollama.');
ok(/Answered by qwen3.8:27b on this/.test(said), 'the Mac\'s cloud model out → the second Ollama answers: ' + said.slice(0, 80));
ok(await page.evaluate(() => getProv().activeProv) === 'local2', 'now on the second Ollama');
macDown = true;
await page.evaluate(async () => { S.fallbacks = ['local2']; await connect(); });
ok(await page.evaluate(() => getProv().activeProv) === 'local2', 'with the Mac unreachable, connect goes straight to the second Ollama');

// 4. settings: the second address and the fallback models are in Config, and saved
await page.evaluate(() => openSettings());
await page.waitForTimeout(400);
const ui = await page.evaluate(() => ({ opt: !!document.querySelector('#sProvider option[value="local2"]'), hb: !!document.querySelector('#sHbProv option[value="local2"]'), fb: /Second Ollama/.test(document.querySelector('#fbList').textContent), host2: $('#sHost2').value, mfb: !!$('#sModelFb') }));
ok(ui.opt && ui.hb && ui.fb && ui.host2 === 'http://localhost:11434' && ui.mfb, 'Config: Second Ollama in the provider lists and fallback list, its address filled in: ' + JSON.stringify(ui));
await page.evaluate(() => { $('#sProvider').value = 'local'; $('#sProvider').onchange(); $('#sModelFb').value = 'qwen3.8:27b, kitti'; $('#sHost2').value = 'http://localhost:11434/'; readProvFields(); saveSettings(); });
const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('jvault:settings')));
ok(JSON.stringify(saved.modelFallbacks.local) === JSON.stringify(['qwen3.8:27b', 'kitti']) && saved.host2 === 'http://localhost:11434', 'saved: fallback models per provider, and the second address: ' + JSON.stringify({ m: saved.modelFallbacks, h: saved.host2 }));

console.log(log.join('\n')); console.log('\n' + (fail.length ? fail.join('\n') : 'ALL PASS'));
await browser.close();
