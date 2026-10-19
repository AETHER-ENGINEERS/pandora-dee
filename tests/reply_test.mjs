// The bar under Jade's replies: Copy · 👍 · 👎 · Retry (Retry on the newest reply only).
import { start } from './_harness.mjs';
const { page, ok, model, done } = await start();
const E = (fn, arg) => page.evaluate(fn, arg);
await E(() => { const clip = { writeText: async t => { window.__clip = t; } }; try { Object.defineProperty(navigator, 'clipboard', { value: clip, configurable: true }); } catch { navigator.clipboard.writeText = clip.writeText; } });
const send = async (text) => {
  const n0 = await E(() => cur?.messages.length || 0);
  await page.fill('#input', text); await E(() => document.querySelector('#btnSend').click());
  await page.waitForFunction(n0 => !running && cur.messages.length > n0 + 1, n0, { timeout: 15000 });
  await page.waitForTimeout(100);
};
const bars = () => E(() => [...document.querySelectorAll('#chat .reply-bar')].map(b => [...b.querySelectorAll('button')].filter(x => !x.hidden && getComputedStyle(x).display !== 'none').map(x => x.textContent.replace(/^COPIED$/i, 'Copy')).join(' ')));
const lastBar = sel => `#chat .reply-bar >> nth=-1 >> ${sel}`;

await E(() => newSession());
await send('hello');
let b = await bars();
ok(b.length === 1 && b[0] === 'Copy 👍 👎 Retry', 'a reply gets Copy · 👍 · 👎 · Retry (trajectory log off): ' + JSON.stringify(b));
await page.click(lastBar('[data-ract="copy"]'));
ok(await E(() => window.__clip) === 'Agent says: hello', 'Copy puts what she said on the clipboard');
ok(await E(() => /COPIED/i.test(document.querySelector('#chat .reply-bar [data-ract="copy"]').textContent)), 'Copy says it worked');
await page.click(lastBar('[data-rate="1"]'));
ok(await E(() => cur.messages.at(-1).rating === 1 && document.querySelector('#chat .reply-bar [data-rate="1"]').classList.contains('on')), '👍 rates the reply');
await page.click(lastBar('[data-rate="-1"]'));
ok(await E(() => cur.messages.at(-1).rating === -1), '👎 switches the rating');
await page.click(lastBar('[data-rate="-1"]'));
ok(await E(() => cur.messages.at(-1).rating === null), 'tapping it again clears it');
await page.click(lastBar('[data-rate="1"]'));

// a turn with a tool call: one bar, and Copy takes all her text (Markdown), not the tool output
model.chatReply = (msgs, u) => msgs.at(-1).role === 'tool' ? { content: 'Found **3** notes:\n- a\n- b' } : /use a tool/.test(u) ? { content: 'Let me look.', tool_calls: [{ function: { name: 'bash', arguments: { command: 'ls /' } } }] } : null;
await send('please use a tool');
b = await bars();
ok(b.length === 2 && b[0] === 'Copy 👍 👎' && b[1] === 'Copy 👍 👎 Retry', 'one bar per turn; only the newest reply offers Retry: ' + JSON.stringify(b));
ok(await E(() => [...document.querySelectorAll('#chat .msg-ai')].at(-1).querySelectorAll('.reply-bar').length === 1), 'a turn with tool calls still has one bar');
await page.click(lastBar('[data-ract="copy"]'));
ok(await E(() => window.__clip) === 'Let me look.\n\nFound **3** notes:\n- a\n- b', 'Copy takes everything she said in the turn, as Markdown, without tool output: ' + JSON.stringify(await E(() => window.__clip)));

// Retry: runs the last message again and replaces her answer
let tries = 0; model.chatReply = (msgs, u) => msgs.at(-1).role === 'tool' ? { content: 'Done.' } : { content: `Try ${++tries}: ${u}` };
const before = await E(() => ({ n: cur.messages.length, users: cur.messages.filter(m => m.role === 'user').length }));
await page.click(lastBar('[data-ract="retry"]'));
await page.waitForFunction(() => !running && /Try 1/.test(cur.messages.at(-1).content || ''), null, { timeout: 15000 });
let after = await E(() => ({ users: cur.messages.filter(m => m.role === 'user').map(m => m.content), last: cur.messages.at(-1).content, text: document.querySelector('#chat').textContent }));
ok(after.users.length === before.users && after.users.at(-1) === 'please use a tool' && after.last === 'Try 1: please use a tool', 'Retry sends the same message again: ' + JSON.stringify(after.users));
ok(!/Let me look\./.test(after.text) && /Try 1: please use a tool/.test(after.text) && /Agent says: hello/.test(after.text), 'the old answer is replaced; earlier turns stay');
b = await bars(); ok(b.length === 2 && b[1] === 'Copy 👍 👎 Retry' && b[0] === 'Copy 👍 👎', 'the new reply gets the bar (and Retry) again');
await page.click(lastBar('[data-ract="retry"]'));
await page.waitForFunction(() => !running && /Try 2/.test(cur.messages.at(-1).content || ''), null, { timeout: 15000 });
ok(await E(() => cur.messages.filter(m => /Try \d/.test(m.content || '')).length === 1), 'retrying again keeps one answer (Try 2)');

// while she works, Retry is hidden
let release; model.hold = new Promise(r => { release = r; });
await page.fill('#input', 'slow one'); await E(() => document.querySelector('#btnSend').click());
await page.waitForFunction(() => running === true, null, { timeout: 5000 });
ok(await E(() => [...document.querySelectorAll('#chat .reply-bar [data-ract="retry"]')].every(x => getComputedStyle(x).display === 'none')), 'Retry is hidden while Jade is working');
ok(await E(async () => { const n = cur.messages.length; const m = cur.messages.filter(x => x.role === 'assistant').at(-1); await replyRetry(m); return cur.messages.length === n && running; }), 'retrying while she works is refused');
release(); model.hold = null;
await page.waitForFunction(() => !running && /slow one/.test(cur.messages.at(-1).content || ''), null, { timeout: 15000 });

// an error: only Retry, and Retry fixes it
model.chatReply = () => ({ status: 500, error: 'model crashed' });
await page.fill('#input', 'this will fail'); await E(() => document.querySelector('#btnSend').click());
await page.waitForFunction(() => !running && cur.messages.at(-1)._error, null, { timeout: 15000 }); await page.waitForTimeout(100);
b = await bars(); ok(b.at(-1) === 'Retry', 'a failed turn offers only Retry: ' + JSON.stringify(b.at(-1)));
model.chatReply = (msgs, u) => ({ content: 'Recovered: ' + u });
await page.click(lastBar('[data-ract="retry"]'));
await page.waitForFunction(() => !running && /Recovered/.test(cur.messages.at(-1).content || ''), null, { timeout: 15000 });
ok(await E(() => !cur.messages.some(m => m._error) && !/model crashed/.test(document.querySelector('#chat').textContent) && cur.messages.filter(m => m.role === 'user' && m.content === 'this will fail').length === 1), 'Retry after an error replaces the error with an answer');

// an older reply cannot be retried (it would drop the newer turns)
const r = await E(async () => { const first = cur.messages.find(m => m.role === 'assistant'); const n = cur.messages.length; await replyRetry(first); return n === cur.messages.length; });
ok(r, 'retrying an older reply does nothing (Edit on that message is the way)');

// after a reload the bars come back from the saved chat, with ratings, Retry on the newest
const sid = await E(() => cur.id); await page.waitForTimeout(800);
await page.reload(); await page.waitForFunction(() => typeof replyBar === 'function' && typeof cur !== 'undefined' && cur && cur.messages.length > 0, null, { timeout: 60000 });
await E(id => openSession(id), sid); await page.waitForTimeout(300);
b = await bars();
ok(b.length === 4 && b.slice(0, 3).every(x => x === 'Copy 👍 👎') && b[3] === 'Copy 👍 👎 Retry', 'after a reload every reply has its bar, Retry only on the newest: ' + JSON.stringify(b));
ok(await E(() => document.querySelector('#chat .reply-bar [data-rate="1"]').classList.contains('on')), 'ratings are kept with the chat');
await page.screenshot({ path: 'reply_bar.png' });
await done();
