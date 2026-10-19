import pw from 'playwright';
import fs from 'node:fs';
const { chromium } = pw;
const URL_ = process.argv[2] || 'file://' + process.env.JV_WEB;
const css = fs.readFileSync('tw.css', 'utf8');
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' };
const log = [], fail = []; const ok = (c, m) => (c ? log : fail).push((c ? 'PASS ' : 'FAIL ') + m);
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
await ctx.addInitScript(() => { if (!localStorage.getItem('jvault:settings')) localStorage.setItem('jvault:settings', JSON.stringify({ model: 'qwen3:8b', journalOn: false, numCtx: 16384 })); });
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
await page.waitForFunction(() => typeof fitContext === 'function' && typeof userShell !== 'undefined', null, { timeout: 90000 });
await page.waitForTimeout(1200);
const send = async (t) => { const n0 = await page.evaluate(() => cur?.messages.length || 0); await page.fill('#input', t); await page.evaluate(() => document.querySelector('#btnSend').click()); await page.waitForFunction((n0) => !running && cur && cur.messages.length > n0 + 1, n0, { timeout: 30000 }); await page.waitForTimeout(300); };
// ---- A: a long chat full of big tool results, local num_ctx 16k ----
await send('hello');
await page.evaluate(() => { const big = 'x'.repeat(45000); for (let i = 0; i < 12; i++) { cur.messages.push({ role: 'user', content: 'read file ' + i }, { role: 'assistant', content: '', tool_calls: [{ function: { name: 'read', arguments: { path: 'f' + i } } }] }, { role: 'tool', tool_name: 'read', content: big }, { role: 'assistant', content: 'read it' }); } });
sent.length = 0; await send("Open today's daily note");
const chats = sent.filter(x => !x.compact);
ok(sent.some(x => x.compact), 'compacted before sending: ' + JSON.stringify(sent));
ok(chats.every(x => x.len < 16384 * 3.3), 'every chat request fits 16k tokens: ' + JSON.stringify(chats.map(x => x.len)));
ok(await page.evaluate(() => /All done here/.test(document.querySelector('#chat').textContent)), 'reply arrived');
ok(/^~[\d.]+k? \/ 16\.4k$/.test(await page.textContent('#hudCtx')), 'HUD shows estimated whole request: ' + await page.textContent('#hudCtx'));
// ---- B: compaction unavailable, the current turn itself is huge -> trimmed ----
await page.evaluate(() => { S.compactAuto = false; const big = 'y'.repeat(60000); cur.messages.push({ role: 'user', content: 'go' }); for (let i = 0; i < 5; i++) cur.messages.push({ role: 'assistant', content: '', tool_calls: [{ function: { name: 'read', arguments: { path: 'g' + i } } }] }, { role: 'tool', tool_name: 'read', content: big }); });
const fitB = await page.evaluate(async () => { const r = await fitContext(buildApiMessages(), activeTools(), chatEl); return { est: r.est, lim: r.lim, how: r.how, n: r.msgs.length, lastTool: r.msgs.filter(m => m.role === 'tool').at(-1).content.length }; });
ok(fitB.est <= 16384 && /trimmed/.test(fitB.how) && fitB.lastTool < 60000, 'trims tool results when compaction cannot help: ' + JSON.stringify(fitB));
await page.evaluate(() => { S.compactAuto = true; });
// ---- C: server enforces a smaller real limit than we think -> learn + retry ----
await page.evaluate(() => { S.numCtx = 262144; newSession(); });
await page.evaluate(() => { const big = 'z'.repeat(40000); cur.messages.push({ role: 'user', content: 'start' }); for (let i = 0; i < 8; i++) cur.messages.push({ role: 'assistant', content: '', tool_calls: [{ function: { name: 'read', arguments: { path: 'h' + i } } }] }, { role: 'tool', tool_name: 'read', content: big }); cur.messages.push({ role: 'assistant', content: 'ok' }); });
SERVER_MAX = 120000; sent.length = 0;
await send('try again');
const errs = await page.evaluate(() => cur.messages.filter(m => m._error).map(m => m._error));
ok(!errs.length && await page.evaluate(() => /All done here/.test(document.querySelector('#chat').textContent)), 'recovered from "prompt is too long": ' + JSON.stringify({ errs, sent }));
ok(await page.evaluate(() => { const l = ls.get('ctxLimits', {}); return Object.values(l).some(v => v === 40000); }), 'learned the model limit from the error');
SERVER_MAX = Infinity;
// ---- D: a giant SYSTEM.md -> warning + still fits; /context explains ----
await page.evaluate(() => { localStorage.removeItem('jvault:ctxLimits'); S.numCtx = 16384; newSession(); vfs.write('/Pandora/SYSTEM.md', '# SYSTEM\n\n' + 'Be helpful. '.repeat(60000)); });
sent.length = 0; await send('hi');
ok(sent.every(x => x.len < 16384 * 3.3) && !await page.evaluate(() => cur.messages.some(m => m._error)), 'huge SYSTEM.md is cut to fit: ' + JSON.stringify(sent.map(x => x.len)));
ok(await page.evaluate(() => /SYSTEM\.md/.test(contextReport().rows[0][0])), '/context names SYSTEM.md as the biggest part');
await page.fill('#input', '/context'); await page.evaluate(() => document.querySelector('#btnSend').click()); await page.waitForTimeout(400);
const card = await page.evaluate(() => [...document.querySelectorAll('.compact-card')].at(-1)?.innerText || '');
ok(/Context: ~[\d.]+k of 16\.4k/i.test(card) && /SYSTEM\.md/.test(card), '/context card: ' + card.slice(0, 200));
await page.screenshot({ path: 'ctx_context.png' });
await page.evaluate(() => vfs.rm('/Pandora/SYSTEM.md'));
// ---- E: normal small chat is untouched ----
await page.evaluate(() => newSession()); sent.length = 0; await send('hello again');
ok(sent.length === 2 && !sent.some(x => x.compact), 'small chats: no compaction, no trimming');
const how = await page.evaluate(() => CTX.last.how); ok(how === '', 'nothing trimmed: ' + how);
console.log(log.join('\n')); console.log('\n' + (fail.length ? fail.join('\n') : 'ALL PASS'));
await browser.close();
