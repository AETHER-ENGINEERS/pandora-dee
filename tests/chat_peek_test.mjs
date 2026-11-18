// Reading another chat while a turn runs (app/chat_peek.py): the chat list used to ignore clicks until the turn was
// done. Now a click opens that chat to read, the running turn carries on in its own chat, what's typed there waits,
// and the chat opens for real (and gets it) once the turn ends.
import { start } from './_harness.mjs';
const { page, ok, model, done } = await start();
const E = (fn, arg) => page.evaluate(fn, arg);
const send = async (text) => { await page.fill('#input', text); await E(() => document.querySelector('#btnSend').click()); };
const idle = () => page.waitForFunction(() => !running, null, { timeout: 15000 });
const click = id => E(id => document.querySelector(`#sessList .sess[data-id="${id}"]`).click(), id);

// two chats: A (older, with one exchange) and B, where the long turn will run
await E(() => newSession());
await send('first chat'); await idle(); await page.waitForTimeout(400);
const A = await E(() => cur.id);
await E(() => newSession());
await send('second chat'); await idle(); await page.waitForTimeout(400);
const B = await E(() => cur.id);

// a turn in B that doesn't finish until we say so
let release; model.hold = new Promise(r => (release = r));
await send('long job');
await page.waitForFunction(() => running, null, { timeout: 5000 });

await click(A);
await page.waitForSelector('#chatPeek:not([hidden])', { timeout: 5000 });
ok(await E(() => document.querySelector('#chat').hidden && /first chat/.test(document.querySelector('#chatPeek').textContent)), 'a click during a turn opens the other chat to read');
ok(await E(B => cur.id === B && running, B), 'the turn keeps its own chat');
ok(await E(() => /A turn is running in/.test(document.querySelector('#chatPeek .peek-bar').textContent)), 'it says a turn is running elsewhere');
ok(await E(A => document.querySelector(`#sessList .sess[data-id="${A}"]`).classList.contains('on'), A), 'the list marks the chat being read');
ok(await E(B => document.querySelector(`#sessList .sess[data-id="${B}"]`).classList.contains('busy'), B), 'and the one the turn is running in');

// typed while reading A: it waits for A, not for the running turn in B
await send('for chat A');
ok(await E(() => PEEK.queue.length === 1 && queue.length === 0 && document.querySelector('#chatPeek .peek-wait')), 'what is typed while reading waits for that chat');

// "Back" goes to the running chat with the turn's own drawing intact, and the waiting text goes back in the box
await E(() => document.querySelector('[data-peek-back]').click());
ok(await E(() => !document.querySelector('#chat').hidden && document.querySelector('#chatPeek').hidden && /long job/.test(document.querySelector('#chat').textContent)), 'Back shows the running chat again');
ok(await E(() => document.querySelector('#input').value === 'for chat A' && PEEK.queue.length === 0), 'Back puts the unsent text back in the box');
await page.fill('#input', '');

// read A again, send, then let the turn finish: A opens and gets the message
await click(A);
await page.waitForSelector('#chatPeek:not([hidden])', { timeout: 5000 });
await send('hello A');
release(); model.hold = null;
await page.waitForFunction(A => cur?.id === A && !PEEK.id, A, { timeout: 15000 });
await idle(); await page.waitForTimeout(300);
const a = await E(() => cur.messages.filter(m => m.role === 'user').map(m => m.content));
ok(a.length === 2 && /hello A/.test(a[1]), 'once the turn ends, the chat being read opens and gets what was sent to it: ' + JSON.stringify(a));
const b = await E(async B => (await idb.get('session:' + B)).messages.filter(m => m.role !== 'user').length, B);
ok(b >= 2, 'the long turn finished in its own chat');
ok(await E(() => !document.querySelector('#chat').hidden && document.querySelector('#chatPeek').hidden), 'the reading pane is closed');

// when nothing runs, a click opens a chat as before
await click(B);
await page.waitForFunction(B => cur?.id === B, B, { timeout: 5000 });
ok(await E(() => document.querySelector('#chatPeek').hidden), 'with no turn running, a click just opens the chat');

await done('chat_peek_test');
