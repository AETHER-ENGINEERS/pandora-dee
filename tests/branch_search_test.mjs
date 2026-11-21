// Search the branches by what was said in them (app/branch_search.py): titles, messages, tool calls and results,
// every word in any order and case; matching branches show a line around the match; Esc clears.
import { start } from './_harness.mjs';
const { page, ok, done } = await start();
const E = (fn, arg) => page.evaluate(fn, arg);

const ids = await E(async () => {
  const mk = (title, messages) => { newSession(); cur.title = title; cur._named = true; cur.messages = messages; saveSession.flush(); return cur.id; };
  const a = mk('Morning chat', [{ role: 'user', content: "what's the weather like?" }, { role: 'assistant', content: 'Sunny all day.' }]);
  const b = mk('Untitled thing', [
    { role: 'user', content: 'can you set up the shrine for the moods' },
    { role: 'assistant', content: 'On it.', tool_calls: [{ function: { name: 'write', arguments: { path: '/mcp/mode-shrine-server.cjs', content: 'const MODES = {}' } } }] },
    { role: 'tool', tool_name: 'write', content: 'Successfully wrote 16 bytes to /mcp/mode-shrine-server.cjs' },
    { role: 'assistant', content: 'The Mode Shrine is ready, with CORS on.' }]);
  const c = mk('Groceries', [{ role: 'user', content: 'remind me to buy oat milk' }, { role: 'assistant', content: 'Added oat milk to the list.' }]);
  await new Promise(r => setTimeout(r, 400));
  return { a, b, c };
});
const shown = () => E(() => [...document.querySelectorAll('#sessList .sess')].map(b => b.dataset.id));
const find = q => E(q => branchSearch(q), q);

let r = await find('mode shrine');
ok(JSON.stringify(r) === JSON.stringify([ids.b]), 'words said in a branch find it, though its title says nothing: ' + JSON.stringify(r));
ok(JSON.stringify(await shown()) === JSON.stringify([ids.b]), 'the list shows only the matching branch');
const snip = await E(() => document.querySelector('#sessList .sess .sess-snip')?.innerHTML || '');
ok(/<mark>/.test(snip) && /shrine/i.test(snip), 'with a line around the match, highlighted: ' + snip);
ok(await E(() => /1 of \d+ branches match/.test(document.querySelector('#sessSearchNote').textContent)), 'and says how many match');

ok(JSON.stringify(await find('mode-shrine-server.cjs')) === JSON.stringify([ids.b]), 'tool calls and results are searched too (file names)');
ok(JSON.stringify(await find('SUNNY')) === JSON.stringify([ids.a]), 'any case');
ok(JSON.stringify(await find('milk oat')) === JSON.stringify([ids.c]), 'words in any order');
ok(JSON.stringify(await find('groceries')) === JSON.stringify([ids.c]), 'titles count');
r = await find('oat cors');
ok(Array.isArray(r) && r.length === 0 && (await shown()).length === 0, 'every word must appear in the same branch');
ok(await E(() => /No branch mentions/.test(document.querySelector('#sessSearchNote').textContent)), 'an empty result says so');

// a branch that changes is read again
await E(async () => { const s = await idb.get('session:' + sessions.find(x => x.title === 'Morning chat').id); s.messages.push({ role: 'user', content: 'and the mode shrine too' }); s.updated = Date.now(); await idb.set('session:' + s.id, s); sessions.find(x => x.id === s.id).updated = s.updated; });
r = await find('mode shrine');
ok(r.length === 2 && r.includes(ids.a) && r.includes(ids.b), 'a branch that changed is searched again: ' + JSON.stringify(r));

// the box itself: typing searches, a result opens, Esc clears
await page.evaluate(() => { const d = document.querySelector('#drawer'); d.style.transform = 'none'; d.style.visibility = 'visible'; });
await page.fill('#sessSearch', 'oat milk');
await page.waitForFunction(id => { const x = [...document.querySelectorAll('#sessList .sess')].map(b => b.dataset.id); return x.length === 1 && x[0] === id; }, ids.c, { timeout: 5000 });
ok(true, 'typing in the box searches');
await E(id => document.querySelector(`#sessList .sess[data-id="${id}"]`).click(), ids.c);
await page.waitForFunction(id => cur?.id === id, ids.c, { timeout: 5000 });
ok(true, 'a result opens its branch');
ok(await E(() => document.querySelector('#sessSearch').value === 'oat milk' && document.querySelectorAll('#sessList .sess').length === 1), 'the search stays while you look at it');
await page.focus('#sessSearch'); await page.keyboard.press('Escape');
await page.waitForFunction(() => document.querySelectorAll('#sessList .sess').length >= 3, null, { timeout: 5000 });
ok(await E(() => !document.querySelector('#sessSearch').value && document.querySelector('#sessSearchNote').hidden && !document.querySelector('#sessList .sess-snip')), 'Esc clears it and every branch is back');
await done('branch_search_test');
