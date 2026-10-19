import pw from 'playwright';
import fs from 'node:fs';
const { chromium } = pw;
const URL_ = process.argv[2] || 'file://' + process.env.JV_WEB;
const css = fs.readFileSync('tw.css', 'utf8');
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' };
const log = [], fail = []; const ok = (c, m) => (c ? log : fail).push((c ? 'PASS ' : 'FAIL ') + m);
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
await ctx.addInitScript(() => { if (!localStorage.getItem('jvault:settings')) localStorage.setItem('jvault:settings', JSON.stringify({ model: 'qwen3:8b', journalOn: false, numCtx: 16384, memoryRag: false })); });
const page = await ctx.newPage();
page.on('pageerror', e => fail.push('[pageerror] ' + e.message));
let SERVER_MAX = Infinity;   // characters; above this the fake server rejects like the screenshot
const sent = [];
await page.route('**/*', async route => {
  const req = route.request(); const url = req.url();
  if (url.startsWith('file://') || url.startsWith('data:') || url.startsWith('blob:')) return route.continue();
  if (url.startsWith('https://cdn.tailwindcss.com/')) return route.fulfill({ contentType: 'text/javascript', body: `window.tailwind={};(function(){var s=document.createElement('style');s.textContent=${JSON.stringify(css)};document.head.prepend(s);})();` });
  if (url.includes('marked.min.js')) return route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(process.env.JV_NM + 'marked/lib/marked.umd.js', 'utf8') });
  if (url.includes('purify.min.js')) return route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(process.env.JV_NM + 'dompurify/dist/purify.min.js', 'utf8') });
  if (url === 'http://localhost:11434/api/tags') return route.fulfill({ headers: CORS, contentType: 'application/json', body: JSON.stringify({ models: [{ name: 'qwen3:8b' }] }) });
  if (url === 'http://localhost:11434/api/chat') {
    const raw = req.postData(); const b = JSON.parse(raw);
    const isCompact = !b.stream && /summar/i.test(b.messages[0].content);
    sent.push({ len: raw.length, compact: isCompact, n: b.messages.length, sys: b.messages[0].content.length });
    if (raw.length > SERVER_MAX) return route.fulfill({ status: 400, headers: CORS, contentType: 'application/json', body: JSON.stringify({ error: `The prompt is too long: ${Math.round(raw.length / 3)}, model maximum context length: ${Math.round(SERVER_MAX / 3)} (ref: 8bc6ce9c-2d89-412b-8f99-9be0c71644ed)` }) });
    if (isCompact) return route.fulfill({ headers: CORS, contentType: 'application/json', body: JSON.stringify({ message: { role: 'assistant', content: '- The user read many big files; nothing else pending.' }, done: true }) });
    const last = b.messages.at(-1);
    const step = last.role === 'user' ? { tool_calls: [{ function: { name: 'bash', arguments: { command: 'ls /daily' } } }] } : { content: 'All done here.' };
    return route.fulfill({ headers: CORS, contentType: 'application/x-ndjson', body: JSON.stringify({ message: { role: 'assistant', content: step.content || '', ...(step.tool_calls ? { tool_calls: step.tool_calls } : {}) }, done: false }) + '\n' + JSON.stringify({ message: { role: 'assistant', content: '' }, done: true, prompt_eval_count: 300, eval_count: 20 }) + '\n' });
  }
  return route.abort();
});
await page.goto(URL_);
await page.waitForFunction(() => typeof memoryContext === 'function' && typeof userShell !== 'undefined', null, { timeout: 90000 });
await page.waitForTimeout(1200);
// seed Memory.md and fake a chat whose last user message is about coffee
const ctxFor = (rag, msg) => page.evaluate(([rag, msg]) => {
  vfs.write('/Pandora/Memory.md', '# Memory\n\n## About you\n- Likes oat milk lattes\n- Sister Maya lives in Lisbon\n\n## Projects & people\n- Works on a Rust compiler project called Forge\n- Allergic to peanuts\n', { mkdirs: true });
  S.memoryOn = true; S.memoryRag = rag; S.memoryRagK = 1;
  if (!cur) newSession?.();
  cur.messages = [{ role: 'user', content: msg }];
  return memoryContext();
}, [rag, msg]);
const off = await ctxFor(false, 'what coffee do I like with milk?');
ok(off.includes('Sister Maya') && off.includes('peanuts') && off.includes('lattes'), 'RAG off: every memory line is injected');
const on = await ctxFor(true, 'what coffee do I like with milk?');
ok(on.includes('oat milk lattes') && !on.includes('Maya') && !on.includes('peanuts') && !on.includes('Forge'), 'RAG on: only the BM25 match is injected (K=1)');
const on2 = await ctxFor(true, 'how is the compiler going?');
ok(on2.includes('Forge') && !on2.includes('lattes'), 'RAG on: a different message retrieves a different memory');
const none = await ctxFor(true, 'zzzz qqqq');
ok(none.includes('nothing matched') && none.includes('peanuts'), 'RAG on, no match: falls back to newest lines');
await page.evaluate(() => { S.memoryOn = false; });
ok((await page.evaluate(() => memoryContext())) === '', 'memory off: nothing injected');
// settings UI round-trip
await page.evaluate(() => { S.memoryOn = true; openSettings(); });
await page.waitForTimeout(300);
await page.evaluate(() => { const c = document.querySelector('#sMemoryRag'); c.checked = true; document.querySelector('#sMemoryRagK').value = '5'; });
await page.evaluate(() => document.querySelector('#btnSave').click());
await page.waitForTimeout(300);
const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('jvault:settings') || '{}'));
ok(saved.memoryRag === true && saved.memoryRagK === 5, 'settings toggle + count persist');
console.log(log.join('\n')); console.log('\n' + (fail.length ? fail.join('\n') : 'ALL PASS'));
await browser.close();
