// Embedding says how far it is ("Embedding 400 of 2,350 · about 6 min left") wherever you are in the app, saves the
// index along the way so a closed page loses little, and the next run does only what's left (app/modules/embed.js).
import { start } from './_harness.mjs';
const { page, ok, done } = await start({ settings: { memoryOn: true, embedOn: true, embedNotes: true, embedHost: 'http://embed.test:11434', embedModel: 'test-embed', embedSaveMs: 300 } });
const E = (fn, arg) => page.evaluate(fn, arg);

// a fake embedding server: 8 numbers per text, 60 ms per batch; it can be told to fail
let failAfter = Infinity, calls = 0;
await page.route('http://embed.test:11434/**', async route => {
  const b = JSON.parse(route.request().postData() || '{}'); calls++;
  await new Promise(r => setTimeout(r, 60));
  if (calls > failAfter) return route.fulfill({ status: 500, headers: { 'Access-Control-Allow-Origin': '*' }, contentType: 'application/json', body: JSON.stringify({ error: 'server went away (test)' }) });
  const embeddings = (b.input || []).map((t, i) => Array.from({ length: 8 }, (_, k) => ((t.length + i + k) % 7) + 1));
  return route.fulfill({ headers: { 'Access-Control-Allow-Origin': '*' }, contentType: 'application/json', body: JSON.stringify({ model: b.model, embeddings }) });
});

// 200 notes to embed
await E(() => { for (let i = 0; i < 200; i++) vfs.write(`/emb/note-${i}.md`, `# Note ${i}\n\nThe tide is ${i % 3 ? 'high' : 'low'} on day ${i}. ` + 'Words to embed. '.repeat(8), { mkdirs: true }); });

// a full rebuild, watched from the chip at the top of the screen
await E(() => { window.__seen = []; window.__saves = 0; const w0 = vfs.write.bind(vfs); vfs.write = (p, ...a) => { if (p === '/Pandora/.index/vectors.db' && window.__vmemRunning) window.__saves++; return w0(p, ...a); };
  window.__vmemRunning = true; window.__rb = window.__vmem.rebuild((n, total, eta) => window.__seen.push({ n, total, eta })).finally(() => { window.__vmemRunning = false; }); });
await page.waitForFunction(() => document.getElementById('embedChip') && !document.getElementById('embedChip').hidden && /Embedding \d+ of \d+ · /.test(document.getElementById('embedChip').textContent), null, { timeout: 20000 });
const mid = await E(() => document.getElementById('embedChip').textContent);
ok(/^Embedding \d[\d,]* of \d[\d,]* · (under a minute left|about \d+ min left|working out how long…)$/.test(mid), 'a chip at the top says how many of how many, and how long is left: ' + mid);
await E(() => window.__rb);
const seen = await E(() => window.__seen);
const total = seen.at(-1)?.total;
ok(total >= 200 && seen.every(s => s.total === total), `the total is known from the start and holds (${total}) across ${seen.length} updates`);
ok(seen.at(-1).n === total && seen.at(-1).eta === 0 && seen.slice(1, -1).every(s => s.eta > 0), 'time left counts down to nothing');
ok(await E(() => window.__saves) >= 2, `the index was saved along the way (${await E(() => window.__saves)} times during the run)`);
ok(/^Embedded [\d,]+ texts\.$/.test(await E(() => document.getElementById('embedChip').textContent)), 'when done it says so: ' + await E(() => document.getElementById('embedChip').textContent));
await page.waitForFunction(() => document.getElementById('embedChip').hidden, null, { timeout: 8000 }).then(() => ok(true, 'and then goes away'), () => ok(false, 'and then goes away'));
const st = await E(async () => (await window.__vmem.status()).collections.find(c => c.name === 'notes'));
ok(st && st.embedded === st.chunks && st.chunks >= 200, `every note is embedded (${st?.embedded}/${st?.chunks})`);

// a run that stops halfway keeps what it did: the next run does only what's left
calls = 0; failAfter = 4;
await E(() => { window.__err = window.__vmem.rebuild(); });
await page.waitForFunction(() => /^Embedding stopped at \d+ of \d+: .*server went away \(test\)/.test(document.getElementById('embedChip')?.textContent || ''), null, { timeout: 20000 })
  .then(() => ok(true, 'a failure says where it stopped and why'), () => ok(false, 'a failure says where it stopped and why: ' + document.getElementById('embedChip')?.textContent));
await E(() => window.__err);
const left = await E(async () => { const s = await window.__vmem.status(); return s.collections.reduce((a, c) => a + (c.chunks - c.embedded), 0); });
ok(left > 0 && left < total, `what was embedded before it stopped is kept (${total - left} done, ${left} left)`);
calls = 0; failAfter = Infinity;
await E(() => { window.__seen = []; window.__sync = window.__vmem.sync({ progress: (n, t, eta) => window.__seen.push({ n, total: t }) }); });
await E(() => window.__sync);
const again = await E(() => window.__seen);
ok(again.length && again[0].total === left, `the next run starts from what's left (${again[0]?.total} of ${left})`);

// two runs at once take turns instead of embedding the same texts twice
calls = 0;
await E(() => { vfs.write('/emb/extra.md', '# Extra\n\n' + 'More words. '.repeat(20), { mkdirs: true }); });
const both = await E(async () => { const a = window.__vmem.sync(), b = window.__vmem.sync(); await Promise.all([a, b]); const s = await window.__vmem.status(); return s.collections.every(c => c.embedded === c.chunks); });
ok(both, 'two runs at once end with everything embedded once');
await done('embed_progress_test');
