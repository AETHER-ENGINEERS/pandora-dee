// Send and Abort sit side by side and each does one thing (app/send_button.py). It used to be one button that said a
// red "Abort" during a turn and, pressed with the box empty, stopped her (easy to hit while fixing a queued message).
import { start } from './_harness.mjs';
const { page, ok, model, done } = await start();
const E = (fn, a) => page.evaluate(fn, a);
const state = () => E(() => { const s = document.querySelector('#btnSend'), a = document.querySelector('#btnAbort'); const rs = s.getBoundingClientRect(), ra = a.getBoundingClientRect();
  return { send: s.textContent, sendRed: s.classList.contains('btn-red'), abortShown: !a.hidden && ra.width > 0, abortLeftOfSend: ra.right <= rs.left + 1 && Math.abs(ra.top - rs.top) < 6, aborted: /Aborted by operator/.test(document.querySelector('#chat').textContent) }; });

// a turn with a slow tool, so there's time to type
let release; const held = new Promise(r => { release = r; });
await page.route('https://r.jina.ai/**', async r => { await held; r.fulfill({ status: 200, headers: { 'Access-Control-Allow-Origin': '*' }, contentType: 'text/plain', body: 'page text' }); });
model.chatReply = (msgs, u) => msgs.at(-1).role === 'user' && /^(start|again)$/.test(u) ? { content: 'Working.', tool_calls: [{ function: { name: 'web_fetch', arguments: { url: 'https://slow.test/page' } } }] } : msgs.at(-1).role === 'tool' ? { content: 'Tool finished.' } : null;

await E(() => newSession());
let s = await state(); ok(s.send === 'Send' && !s.abortShown, 'idle: Send, no Abort');
await page.fill('#input', 'start'); await page.click('#btnSend');
await page.waitForFunction(() => running && document.querySelector('#chat details.tool.run'), null, { timeout: 10000 });

s = await state(); ok(s.send === 'Queue' && !s.sendRed && s.abortShown && s.abortLeftOfSend, 'running: Send says Queue, and a separate Abort sits beside it, not stacked: ' + JSON.stringify(s));
await page.click('#btnSend');
s = await state(); ok(!s.aborted && await E(() => running), 'Queue with an empty box does nothing: it never stops her');
await page.type('#input', 'helo typo'); await page.click('#btnSend');
ok(await E(() => document.querySelectorAll('#queueNote .queued-msg').length === 1), 'Queue with text queues the message');

// take it back, empty the box, press Queue: still nothing stops
await page.locator('#queueNote [data-qact="edit"]').click();
ok(await page.inputValue('#input') === 'helo typo', 'Edit puts it back in the box');
await page.fill('#input', ''); await page.click('#btnSend');
s = await state(); ok(!s.aborted && await E(() => running), 'mid-edit, an empty box and a press of Queue still stop nothing');
await page.fill('#input', 'hello, fixed'); await page.click('#btnSend');

release();
await page.waitForFunction(() => !running, null, { timeout: 15000 });
const users = await E(() => cur.messages.filter(m => m.role === 'user').map(m => String(m.content).replace(/^\[[^\]]*\]\s*/, '')));
s = await state();
ok(!s.aborted && users.includes('hello, fixed') && !users.includes('helo typo'), 'the turn finished on its own and the fixed message reached her: ' + JSON.stringify(users));
ok(s.send === 'Send' && !s.abortShown, 'idle again: Send, and Abort is gone');

// Abort does stop a turn
let release2; const held2 = new Promise(r => { release2 = r; });
await page.unroute('https://r.jina.ai/**'); await page.route('https://r.jina.ai/**', async r => { await held2; r.fulfill({ status: 200, headers: { 'Access-Control-Allow-Origin': '*' }, contentType: 'text/plain', body: 'x' }); });
await page.fill('#input', 'again'); await page.click('#btnSend');
await page.waitForFunction(() => running && !document.querySelector('#btnAbort').hidden, null, { timeout: 10000 });
await page.click('#btnAbort'); release2();
await page.waitForFunction(() => !running, null, { timeout: 15000 });
s = await state(); ok(s.aborted && !s.abortShown, 'Abort stops the turn, and then hides');
await done('send_button_test');
