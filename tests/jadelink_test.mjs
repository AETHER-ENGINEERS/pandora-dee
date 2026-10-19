import pw from 'playwright';
import fs from 'node:fs';
const { chromium } = pw;
const URL_ = process.argv[2] || 'file://' + process.env.JV_WEB;
const css = fs.readFileSync('tw.css', 'utf8');
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' };
const log = [], fail = []; const ok = (c, m) => (c ? log : fail).push((c ? 'PASS ' : 'FAIL ') + m);
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, timezoneId: 'America/Detroit' });
await ctx.addInitScript(() => { try { if (window !== window.top) return; } catch {} if (!localStorage.getItem('jvault:settings')) localStorage.setItem('jvault:settings', JSON.stringify({ model: 'qwen3:8b', journalOn: false })); });
const page = await ctx.newPage();
page.on('pageerror', e => fail.push('[pageerror] ' + e.message));
const wakes = []; let mainChats = 0;
await ctx.route('**/*', async route => {
  const req = route.request(); const url = req.url();
  if (url.startsWith('file://') || url.startsWith('data:') || url.startsWith('blob:')) return route.continue();
  if (url.startsWith('https://cdn.tailwindcss.com/')) return route.fulfill({ contentType: 'text/javascript', body: `window.tailwind={};(function(){var s=document.createElement('style');s.textContent=${JSON.stringify(css)};document.head.prepend(s);})();` });
  if (url.includes('marked.min.js')) return route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(process.env.JV_NM + 'marked/lib/marked.umd.js', 'utf8') });
  if (url.includes('purify.min.js')) return route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(process.env.JV_NM + 'dompurify/dist/purify.min.js', 'utf8') });
  if (url === 'http://localhost:11434/api/tags') return route.fulfill({ headers: CORS, contentType: 'application/json', body: JSON.stringify({ models: [{ name: 'qwen3:8b' }] }) });
  if (url === 'http://localhost:11434/api/chat') {
    const b = JSON.parse(req.postData()); if (!b.stream) return route.fulfill({ headers: CORS, contentType: 'application/json', body: JSON.stringify({ message: { role: 'assistant', content: 'SUMMARY:\n- x\nREMEMBER:\n- none' }, done: true }) });
    const li = b.messages.findLastIndex(m => m.role === 'user'); const u = b.messages[li].content; const k = b.messages.slice(li).filter(m => m.role === 'tool').length;
    let step;
    if (u.includes('[webxdc app "Jade Link"')) {
      if (k === 0) wakes.push(u);
      if (/nofallbacktool/.test(u)) step = { content: 'Plain chat answer, no tool.' };
      else if (k === 0) step = { tool_calls: [{ function: { name: 'apps', arguments: { action: 'send', app: 'Jade Link', payload: { type: 'msg', text: 'Here is your **evening**.', cards: [{ op: 'add', title: 'Cook dinner' }, { op: 'add', title: 'Read 20 pages', col: 'doing' }] } } } }] };
      else step = { content: 'Sent it in the app.' };
      await new Promise(r => setTimeout(r, 700));
    } else { mainChats++; step = { content: 'main chat reply' }; }
    return route.fulfill({ headers: CORS, contentType: 'application/x-ndjson', body: JSON.stringify({ message: { role: 'assistant', content: step.content || '', ...(step.tool_calls ? { tool_calls: step.tool_calls } : {}) }, done: false }) + '\n' + JSON.stringify({ message: { role: 'assistant', content: '' }, done: true }) + '\n' });
  }
  return route.abort();
});
await page.goto(URL_);
await page.waitForFunction(() => typeof appsTool === 'function' && typeof userShell !== 'undefined', null, { timeout: 90000 });
await page.waitForFunction(() => XDC.apps.some(a => a.name === 'Jade Link' && a.origin === 'builtin'), null, { timeout: 15000 });
ok(true, 'Jade Link is pre-installed');
await page.fill('#input', 'hello'); await page.evaluate(() => document.querySelector('#btnSend').click());
await page.waitForFunction(() => !running && /main chat reply/.test(document.querySelector('#chat').textContent), null, { timeout: 20000 });
const mainId = await page.evaluate(() => cur.id);
await page.tap('.tab[data-tab="apps"]'); await page.waitForTimeout(300);
await page.screenshot({ path: 'jl_tab.png' });
await page.click('.app-tile:has-text("Jade Link") .app-open');
const fr = page.frameLocator('#xdcOverlay iframe');
await fr.locator('#empty').waitFor({ timeout: 10000 });
await page.screenshot({ path: 'jl_empty.png' });
await fr.locator('#text').fill('Plan my evening please'); await fr.locator('#send').click();
await fr.locator('#typing').waitFor({ state: 'visible', timeout: 5000 });
ok(/thinking/.test(await fr.locator('#statusText').textContent()), 'status shows Jade thinking (realtime from the host)');
await fr.locator('.msg.jade').waitFor({ timeout: 20000 });
await page.waitForFunction(() => !XWAKE.busy, null, { timeout: 20000 });
const view = await fr.locator('body').evaluate(() => ({ me: [...document.querySelectorAll('.msg.me .bub')].map(x => x.textContent), jade: [...document.querySelectorAll('.msg.jade .bub')].map(x => x.innerHTML), notes: [...document.querySelectorAll('.opnote')].map(x => x.textContent), typing: document.getElementById('typing').hidden, status: document.getElementById('statusText').textContent, count: document.getElementById('boardCount').textContent }));
ok(view.me[0] === 'Plan my evening please' && view.jade[0] === 'Here is your <b>evening</b>.', 'message → Jade wakes → her reply lands in the app: ' + JSON.stringify(view.jade));
ok(view.notes.join('|') === 'Jade added “Cook dinner”|Jade added “Read 20 pages”' && view.count === '(2)', 'her card ops applied: ' + JSON.stringify(view.notes));
ok(view.typing && await fr.locator('#typing').isHidden() && /last reply/.test(view.status), 'indicator clears, status shows last reply: ' + view.status);
await page.screenshot({ path: 'jl_chat.png' });
ok(wakes.length === 1 && /update #1 for you/.test(wakes[0]) && /"text":"Plan my evening please"/.test(wakes[0]) && /Jade Link — protocol/.test(wakes[0]), 'wake prompt carries the update + README the first time');
const sess = await page.evaluate((mainId) => ({ back: cur.id === mainId, app: sessions.find(s => s.title === '📱 Jade Link')?.id }), mainId);
ok(sess.back && sess.app, 'ran in its own "📱 Jade Link" chat, then returned to the chat you were in');
// board from the user: no wake
await fr.locator('.seg button[data-view=board]').click();
await fr.locator('#cardTitle').fill('Laundry'); await fr.locator('#addCard button').click(); await page.waitForTimeout(300);
await fr.locator('.card:has-text("Laundry") button.adv').click(); await page.waitForTimeout(300);
await fr.locator('.card:has-text("Cook dinner") button[data-act=del]').click(); await page.waitForTimeout(500);
const board = await fr.locator('body').evaluate(() => Object.fromEntries(['todo', 'doing', 'done'].map(c => [c, [...document.querySelectorAll(`.col[data-col=${c}] .card .t`)].map(x => x.firstChild.textContent)])));
ok(JSON.stringify(board) === '{"todo":[],"doing":["Read 20 pages","Laundry"],"done":[]}' && wakes.length === 1, 'board edits sync and do not wake Jade: ' + JSON.stringify(board));
await page.screenshot({ path: 'jl_board.png' });
// Jade acts on the board by id (proactively, e.g. from a heartbeat)
const cardId = await page.evaluate(async () => { const ups = await XdcDB.updates(XDC.apps.find(a => a.name === 'Jade Link').id); return ups.find(u => u.payload.type === 'card' && u.payload.title === 'Laundry').payload.id; });
await page.evaluate((id) => appsTool({ action: 'send', app: 'Jade Link', payload: { type: 'msg', text: 'Laundry done?', cards: [{ op: 'move', id, col: 'done' }] } }), cardId);
await page.waitForTimeout(400);
ok((await fr.locator('.col[data-col=done] .card .t').allTextContents()).some(t => /Laundry/.test(t)), 'Jade moves a card by id');
// second message: same app session, no README again
await fr.locator('.seg button[data-view=chat]').click();
await fr.locator('#text').fill('nofallbacktool test'); await fr.locator('#text').press('Enter');
await page.waitForFunction(() => !XWAKE.busy && !running, null, { timeout: 20000 }); await page.waitForTimeout(1200);
ok(wakes.length === 2 && !/Jade Link — protocol/.test(wakes[1]), 'second wake reuses the chat (no README repeat)');
ok((await fr.locator('.msg.jade .bub').allTextContents()).at(-1) === 'Plain chat answer, no tool.', 'if she answers in chat instead, the app still gets her answer');
ok(await page.evaluate(() => sessions.filter(s => s.title === '📱 Jade Link').length === 1), 'one app chat');
// switch off
await page.evaluate(() => closeApp()); await page.waitForTimeout(200);
await page.click('.app-tile:has-text("Jade Link") .app-more'); await page.click('[data-m=wake]'); await page.waitForTimeout(300);
ok(/OFF/.test(await page.textContent('[data-m=wake]')), 'menu toggle: Jade answers OFF');
await page.click('[data-m=close]');
await page.click('.app-tile:has-text("Jade Link") .app-open'); const fr3 = page.frameLocator('#xdcOverlay iframe');
await fr3.locator('#text').waitFor(); await fr3.locator('#text').fill('are you there?'); await fr3.locator('#send').click(); await page.waitForTimeout(2500);
ok(wakes.length === 2, 'no wake when switched off');
// reload: not installed twice, history intact
await page.reload(); await page.waitForFunction(() => typeof appsTool === 'function' && typeof userShell !== 'undefined', null, { timeout: 90000 }); await page.waitForTimeout(2500);
ok(await page.evaluate(async () => (await XdcDB.apps()).filter(a => a.name === 'Jade Link').length === 1), 'not re-installed on reload');
const r = await page.evaluate(() => appsTool({ action: 'read', app: 'Jade Link', limit: 3 }));
ok(/from jade@jade\.vault/.test(r) && /are you there\?/.test(r), 'Jade can read the conversation: ' + r.split('\n')[0]);
console.log(log.join('\n')); console.log('\n' + (fail.length ? fail.join('\n') : 'ALL PASS'));
await browser.close();
