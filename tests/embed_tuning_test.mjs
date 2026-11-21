// Config → Memory → Embeddings: texts per request, requests at once, how often progress is saved (app/embed_tuning.py,
// app/modules/embed.js). The build sends what was set, a change applies from the next round, and when one request of
// a round fails the others' results are kept.
import { start } from './_harness.mjs';
const { page, ok, done } = await start({ settings: { memoryOn: true, embedOn: true, embedNotes: true, embedHost: 'http://embed.test:11434', embedModel: 'test-embed' } });
const E = (fn, arg) => page.evaluate(fn, arg);

// a fake embedding server that remembers each request's size and how many were in flight together
let inflight = 0, maxInflight = 0, sizes = [], failNext = 0;
await page.route('http://embed.test:11434/**', async route => {
  const b = JSON.parse(route.request().postData() || '{}'); sizes.push(b.input.length); inflight++; maxInflight = Math.max(maxInflight, inflight);
  await new Promise(r => setTimeout(r, 120)); inflight--;
  if (failNext > 0) { failNext--; return route.fulfill({ status: 500, headers: { 'Access-Control-Allow-Origin': '*' }, contentType: 'application/json', body: JSON.stringify({ error: 'busy (test)' }) }); }
  return route.fulfill({ headers: { 'Access-Control-Allow-Origin': '*' }, contentType: 'application/json', body: JSON.stringify({ embeddings: b.input.map((t, i) => [1 + (t.length % 5), 2, 3 + i % 3, 4]) }) });
});
const reset = () => { inflight = 0; maxInflight = 0; sizes = []; };
await E(() => { for (let i = 0; i < 400; i++) vfs.write(`/emb/n-${i}.md`, `# N ${i}\n\nTide ${i}. ` + 'Words to embed. '.repeat(6), { mkdirs: true }); });
const pending = () => E(async () => { const s = await window.__vmem.status(); return s.collections.reduce((a, c) => a + (c.chunks - c.embedded), 0); });

// the defaults: 16 per request, one at a time
reset(); await E(() => window.__vmem.rebuild());
ok(Math.max(...sizes) === 16 && maxInflight === 1, `by default: 16 texts per request, one request at a time (max ${Math.max(...sizes)}, ${maxInflight} at once)`);
ok(await pending() === 0, 'and everything gets embedded');

// set in Config and saved
await E(() => { openSettings(); document.querySelector('#sEmbedBatch').value = '64'; document.querySelector('#sEmbedParallel').value = '4'; document.querySelector('#sEmbedSaveSecs').value = '10'; });
await E(() => document.querySelector('#btnSave').click()); await page.waitForTimeout(400);
const saved = await E(() => { const s = JSON.parse(localStorage.getItem('jvault:settings')); return [s.embedBatch, s.embedParallel, s.embedSaveSecs]; });
ok(JSON.stringify(saved) === '[64,4,10]', 'Save keeps the three settings: ' + JSON.stringify(saved));
ok(await E(() => { openSettings(); const v = ['#sEmbedBatch', '#sEmbedParallel', '#sEmbedSaveSecs'].map(s => document.querySelector(s).value); return v.join(','); }) === '64,4,10', 'and Config shows them again');
reset(); await E(() => window.__vmem.rebuild());
ok(Math.max(...sizes) === 64 && maxInflight === 4, `then a build sends 64 texts per request, 4 at once (max ${Math.max(...sizes)}, ${maxInflight} at once)`);
ok(await pending() === 0, 'and still embeds everything');

// out-of-range values are held in range
await E(() => { openSettings(); document.querySelector('#sEmbedBatch').value = '5000'; document.querySelector('#sEmbedParallel').value = '0'; document.querySelector('#sEmbedSaveSecs').value = '1'; document.querySelector('#btnSave').click(); });
await page.waitForTimeout(400);
ok(await E(() => [S.embedBatch, S.embedParallel, S.embedSaveSecs].join(',')) === '512,,5', 'too big or too small is held to 512 per request, the default at once, 5 s');

// a change applies to a build already running, from its next round
await E(() => { S.embedBatch = 8; S.embedParallel = 1; });
reset(); await E(() => { window.__run = window.__vmem.rebuild(); });
await new Promise(r => setTimeout(r, 700)); await E(() => { S.embedBatch = 32; });
await E(() => window.__run);
ok(sizes[0] === 8 && sizes.includes(32), `a build already running picks up the new size (${sizes.slice(0, 3).join(',')}… then ${[...new Set(sizes)].join('/')})`);

// one request of a round fails: the other three's texts are kept
await E(() => { S.embedBatch = 10; S.embedParallel = 4; });
await E(() => window.__vmem.rebuild().catch(() => {})); // fresh index
reset(); failNext = 1;
const before = await E(async () => { await window.__vmem.status(); return true; });
await E(() => { window.__err = window.__vmem.rebuild(); });
await E(() => window.__err);
const left = await pending();
ok(sizes.length >= 4 && left > 0, `the failed request's texts are left for later (${left} waiting)`);
ok(await E(async () => { const s = await window.__vmem.status(); return s.collections.reduce((a, c) => a + c.embedded, 0); }) >= 30, 'and the three that came back in that round are kept');
await page.waitForFunction(() => /Embedding stopped at \d+ of \d+: .*busy \(test\)/.test(document.getElementById('embedChip')?.textContent || ''), null, { timeout: 5000 }).then(() => ok(true, 'the stop is shown with its reason'), () => ok(false, 'the stop is shown with its reason'));
await done('embed_tuning_test');
