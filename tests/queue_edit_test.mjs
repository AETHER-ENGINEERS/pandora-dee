// A message sent while she's on a tool run waits in the queue; it can be taken back and fixed (app/queue_edit.py).
// Edit puts it back in the message box and out of the queue, ✕ drops it, Up in an empty box takes back the last one,
// and only the fixed text steers the turn.
import { start } from './_harness.mjs';
const { page, ok, model, done } = await start();
const E = (fn, arg) => page.evaluate(fn, arg);
const queued = () => E(() => [...document.querySelectorAll('#queueNote .queued-text')].map(x => x.textContent));
const typeAndSend = async (t) => { await page.fill('#input', t); await E(() => document.querySelector('#btnSend').click()); };

await E(() => newSession());
let release; model.hold = new Promise(r => { release = r; });
model.chatReply = (msgs, u) => u === 'start' && msgs.at(-1).role === 'user' ? { content: 'Looking.', tool_calls: [{ function: { name: 'notes_search', arguments: { query: 'tide' } } }] } : null;
await typeAndSend('start');
await page.waitForFunction(() => running, null, { timeout: 10000 });

await typeAndSend('helo wrold');
await typeAndSend('second thought');
let q = await queued();
ok(JSON.stringify(q) === JSON.stringify(['helo wrold', 'second thought']), 'the note lists each queued message: ' + JSON.stringify(q));
ok(await E(() => /QUEUED ▸ 2 messages/.test(document.querySelector('#queueNote').textContent) && !document.querySelector('#queueNote').hidden), 'and still says how many are waiting');

await page.click('#queueNote .queued-msg >> nth=0 >> [data-qact="edit"]');
ok(await page.inputValue('#input') === 'helo wrold', 'Edit puts the message back in the box');
q = await queued();
ok(JSON.stringify(q) === JSON.stringify(['second thought']), 'and takes it out of the queue: ' + JSON.stringify(q));
ok(await E(() => document.activeElement === document.querySelector('#input')), 'the box has the focus');

await typeAndSend('hello world');
q = await queued();
ok(JSON.stringify(q) === JSON.stringify(['second thought', 'hello world']), 'sending the fixed text queues it again: ' + JSON.stringify(q));

await page.click('#queueNote .queued-msg >> nth=0 >> [data-qact="drop"]');
q = await queued();
ok(JSON.stringify(q) === JSON.stringify(['hello world']), '✕ drops a queued message: ' + JSON.stringify(q));

await page.fill('#input', ''); await page.press('#input', 'ArrowUp');
ok(await page.inputValue('#input') === 'hello world' && !(await queued()).length, 'Up in an empty box takes back the last queued message');
ok(await E(() => document.querySelector('#queueNote').hidden), 'the note hides when the queue is empty');
await page.press('#input', 'ArrowUp');
ok(await page.inputValue('#input') === 'hello world', 'Up with text in the box leaves the text alone');

// a draft already in the box stays, after the message taken back
await typeAndSend('hello world');
await page.fill('#input', 'and also');
await E(() => editQueued(0));
ok(await page.inputValue('#input') === 'hello world\nand also', 'a draft in the box is kept, after the message taken back: ' + JSON.stringify(await page.inputValue('#input')));
await typeAndSend('hello world');

release(); model.hold = null;
await page.waitForFunction(() => !running && cur.messages.some(m => m.role === 'assistant' && /Agent says: hello world/.test(m.content)), null, { timeout: 15000 });
const users = await E(() => cur.messages.filter(m => m.role === 'user').map(m => String(m.content).replace(/^\[[^\]]*\]\s*/, '')));
ok(users.some(u => /^hello world$/.test(u)) && !users.some(u => /helo wrold|second thought|and also/.test(u)), 'only the fixed message steers the turn: ' + JSON.stringify(users));
ok(!(await queued()).length, 'nothing is left in the queue');
await done('queue_edit_test');
