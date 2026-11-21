// Read-only tools asked for together run at the same time (app/parallel_tools.py): consecutive read-only calls in one reply
// are one group (Promise.all), a call that writes or acts runs on its own and splits the groups, and the tool messages and
// cards keep the order the model asked, whatever order the calls finish in.
import { start } from './_harness.mjs';
const { page, ok, model, done } = await start();
const E = (fn, arg) => page.evaluate(fn, arg);

// the grouping on its own
const g = await E(() => toolGroups([
  { function: { name: 'read', arguments: {} } }, { function: { name: 'web_search', arguments: {} } }, { function: { name: 'write', arguments: {} } },
  { function: { name: 'notes_search', arguments: {} } }, { function: { name: 'chat_history', arguments: { action: 'search' } } }, { function: { name: 'bash', arguments: {} } },
  { function: { name: 'bash', arguments: {} } }, { function: { name: 'chat_history', arguments: { action: 'index' } } }, { function: { name: 'ssh', arguments: {} } }, { function: { name: 'web_fetch', arguments: {} } },
]).map(x => x.map(c => c.function.name).join('+')));
ok(JSON.stringify(g) === JSON.stringify(['read+web_search', 'write', 'notes_search+chat_history', 'bash', 'bash', 'chat_history', 'ssh', 'web_fetch']), 'reads group together, writes and actions each stand alone: ' + JSON.stringify(g));
ok(await E(() => ['phone', 'screen', 'browser', 'edit', 'memory', 'delegate', 'open_note'].every(n => !toolParallelOK(n, {}))), 'phone, screen, browser, edit, memory, delegate and open_note never run in a group');

// a real turn: fetch a, fetch b, write c, fetch d, fetch e. Each fetch is held (the second of each pair finishes first).
await E(() => {
  newSession(); window.__log = []; const f0 = window.__f0 = window.fetch;
  window.fetch = async (u, o) => { const m = /r\.jina\.ai\/https:\/\/slow\.test\/(\w)/.exec(String(u)); if (!m) return f0(u, o);
    const t0 = performance.now(); await new Promise(r => setTimeout(r, 'be'.includes(m[1]) ? 150 : 300)); window.__log.push({ k: 'fetch:' + m[1], t0, t1: performance.now() });
    return new Response('page ' + m[1], { headers: { 'Content-Type': 'text/plain' } }); };
  const w0 = vfs.write.bind(vfs); window.__w0 = vfs.write;
  vfs.write = (p, ...a) => { const t0 = performance.now(); const r = w0(p, ...a); if (/^\/par\//.test(p)) window.__log.push({ k: 'write:' + p.slice(5), t0, t1: performance.now() }); return r; };
});
const F = (x) => ({ function: { name: 'web_fetch', arguments: { url: 'https://slow.test/' + x } } });
model.chatReply = (msgs) => msgs.at(-1).role === 'tool' ? { content: 'All five done.' } : { content: 'On it.', tool_calls: [F('a'), F('b'), { function: { name: 'write', arguments: { path: '/par/c.md', content: 'gamma' } } }, F('d'), F('e')] };
await page.fill('#input', 'fetch them all'); await E(() => document.querySelector('#btnSend').click());
await page.waitForFunction(() => !running && cur.messages.some(m => m.role === 'assistant' && m.content === 'All five done.'), null, { timeout: 20000 });
const r = await E(() => ({
  log: Object.fromEntries(window.__log.map(x => [x.k, x])),
  finished: window.__log.map(x => x.k),
  tools: cur.messages.filter(m => m.role === 'tool').map(m => m.content),
  forOk: (() => { const a = cur.messages.find(m => m.tool_calls?.length === 5); const t = cur.messages.filter(m => m.role === 'tool'); return t.length === 5 && t.every((m, i) => m._for === a.tool_calls[i]._id); })(),
  cards: [...document.querySelectorAll('#chat details.tool')].slice(-5).map(d => d.querySelector('.targ').textContent),
  done: [...document.querySelectorAll('#chat details.tool')].slice(-5).every(d => !d.classList.contains('run')),
}));
const Lg = r.log, A = Lg['fetch:a'], B = Lg['fetch:b'], C = Lg['write:c.md'], D = Lg['fetch:d'], Ee = Lg['fetch:e'];
ok(A && B && C && D && Ee, 'all five calls ran: ' + r.finished.join(', '));
if (A && B && C && D && Ee) {
  ok(B.t0 < A.t1 && A.t0 < B.t1, `the two fetches before the write overlap in time (a ${A.t0.toFixed(0)}–${A.t1.toFixed(0)}, b ${B.t0.toFixed(0)}–${B.t1.toFixed(0)})`);
  ok(r.finished.indexOf('fetch:b') < r.finished.indexOf('fetch:a'), 'b finished before a: ' + r.finished.join(', '));
  ok(C.t0 >= Math.max(A.t1, B.t1) && C.t1 <= Math.min(D.t0, Ee.t0), 'the write splits the groups: it waits for both fetches, and the next fetches wait for it');
  ok(Ee.t0 < D.t1 && D.t0 < Ee.t1, 'the two fetches after the write overlap too');
}
ok(/page a/.test(r.tools[0]) && /page b/.test(r.tools[1]) && /Successfully wrote/.test(r.tools[2]) && /page d/.test(r.tools[3]) && /page e/.test(r.tools[4]), 'tool results are kept in the order the model asked: ' + JSON.stringify(r.tools.map(t => t.slice(0, 24))));
ok(r.forOk, 'each tool message points at its own call (_for), in order');
ok(JSON.stringify(r.cards.map(c => c.replace(/.*\//, ''))) === JSON.stringify(['a', 'b', 'c.md', 'd', 'e']), 'the tool cards are in the asked order too: ' + JSON.stringify(r.cards));
ok(r.done, 'every card is finished');

// the sub-agent groups its read-only calls the same way, and still refuses a write
model.chatReply = (msgs) => !/sub-agent/.test(msgs[0]?.content || '') ? null : msgs.at(-1).role === 'tool' ? { content: 'Sub-agent done.' }
  : { content: '', tool_calls: [{ function: { name: 'web_fetch', arguments: { url: 'https://slow.test/a' } } }, { function: { name: 'web_fetch', arguments: { url: 'https://slow.test/b' } } }, { function: { name: 'write', arguments: { path: '/par/x.md', content: 'no' } } }] };
const sub = await E(async () => {
  window.__log = [];
  try { const out = await delegateTool({ task: 'fetch two pages' }); return { out, log: window.__log.map(x => x), x: vfs.isFile('/par/x.md') }; } finally { window.fetch = window.__f0; vfs.write = window.__w0; }
});
const sa = sub.log.find(x => x.k === 'fetch:a'), sb = sub.log.find(x => x.k === 'fetch:b');
ok(sa && sb && sb.t0 < sa.t1 && sa.t0 < sb.t1, 'the sub-agent fetches both at the same time: ' + JSON.stringify(sub.log.map(x => x.k)));
ok(!sub.x && /Sub-agent done/.test(sub.out), 'a read-only sub-agent still cannot write: ' + sub.out.slice(-60));
await done('parallel_tools_test');
