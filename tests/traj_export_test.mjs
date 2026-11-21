// Config → Trajectory log → Export JSONL: it says at once that it's working, a big log is saved in pieces (never one
// giant string), and a failure says why. It used to fail in silence: no file, no message.
import { start } from './_harness.mjs';
const { page, ok, done } = await start();
const E = (fn, arg) => page.evaluate(fn, arg);
const toasts = () => E(() => [...document.querySelectorAll('.toast, #toasts *')].map(t => t.textContent).filter(Boolean));

// one real run, then copies of it with a 500 KB tool result each, for a ~150 MB log
await E(() => newSession());
await page.fill('#input', 'hello there'); await E(() => document.querySelector('#btnSend').click());
await page.waitForFunction(() => !running && cur.messages.length > 1, null, { timeout: 15000 });
await page.waitForFunction(async () => (await TrajDB.all()).length > 0, null, { timeout: 10000 });
await E(async () => {
  const big = 'x'.repeat(500 * 1024); const base = (await TrajDB.all())[0];
  for (let i = 0; i < 300; i++) { const r = JSON.parse(JSON.stringify(base)); r.id = 'big' + i; r.started = Date.now() + i; r.messages.push({ role: 'tool', tool_name: 'read', content: big }, { role: 'assistant', content: 'ok' }); await TrajDB.put(r); }
  // watch what the button hands to the browser to save
  // the harness is the Android app (NetrunnerAndroid.saveFile): record what it is handed
  window.__android = []; window.NetrunnerAndroid.saveFile = (n, m, text) => window.__android.push({ n, m, len: text.length });
  window.__blobs = []; const c0 = URL.createObjectURL; URL.createObjectURL = b => { if (b instanceof Blob) window.__blobs.push({ size: b.size, type: b.type }); return c0.call(URL, b); };
  openSettings(); document.querySelector('#btnTrajExport').scrollIntoView();
});

// the button: says it's working, then saves the whole log
await E(() => document.querySelector('#btnTrajExport').click());
const early = await E(() => ({ label: document.querySelector('#btnTrajExport').textContent, disabled: document.querySelector('#btnTrajExport').disabled }));
ok(early.label === 'Exporting…' && early.disabled, 'the button says it is working at once, and can\'t be pressed twice: ' + JSON.stringify(early));
ok((await toasts()).some(t => /Exporting the trajectory log/.test(t)), 'and a message says so');
await page.waitForFunction(() => [...document.querySelectorAll('.toast, #toasts *')].some(t => /Exported \d+ of \d+ runs/.test(t.textContent)), null, { timeout: 60000 });
const t = (await toasts()).find(x => /Exported/.test(x));
ok(/Exported 301 of 301 runs \(1\d\d\.\d MB\)/.test(t), 'a ~150 MB log exports in full: ' + t);
const expect = await E(async () => { const r = await exportTrajectories({ filter: 'clean' }); return r.bytes; });
const andr = await E(() => window.__android[0]);
ok(andr && andr.m === 'application/x-ndjson' && andr.len === expect && andr.len > 150e6, `in the Android app the whole log is saved (${andr?.len} characters, expected ${expect})`);
// in a browser (no Android bridge) it goes out as a file made of the pieces
const blob = await E(async () => { const keep = window.NetrunnerAndroid.saveFile; delete window.NetrunnerAndroid.saveFile; try { window.__blobs = []; await exportTrajectories({ filter: 'clean' }); return window.__blobs.at(-1); } finally { window.NetrunnerAndroid.saveFile = keep; } });
const expectBytes = await E(async () => new Blob([(await exportTrajectories({ filter: 'clean' })).text]).size);   // UTF-8 bytes of the same text as one string
ok(blob && blob.type === 'application/x-ndjson' && blob.size === expectBytes && blob.size > 150e6, `in a browser the saved file is the whole log, byte for byte (${blob?.size} bytes, expected ${expectBytes})`);
ok(await E(() => document.querySelector('#btnTrajExport').textContent === 'Export JSONL' && !document.querySelector('#btnTrajExport').disabled), 'the button is back when it is done');

// the lines are still whole JSON, one run each, in order
const lines = await E(async () => { const r = await exportTrajectories({ filter: 'all' }); const L = r.text.trim().split('\n'); return { n: L.length, of: r.of, json: L.every(l => { try { JSON.parse(l); return true; } catch { return false; } }) }; });
ok(lines.n === lines.of && lines.json, `every run is one whole JSON line (${lines.n} of ${lines.of})`);

// a failure says why instead of nothing
await E(() => { window.__all0 = TrajDB.all; TrajDB.all = async () => { throw new Error('the log could not be read (test)'); }; });
await E(() => document.querySelector('#btnTrajExport').click());
await page.waitForFunction(() => [...document.querySelectorAll('.toast, #toasts *')].some(t => /Export failed/.test(t.textContent)), null, { timeout: 10000 });
ok((await toasts()).some(x => /Export failed: the log could not be read \(test\)/.test(x)), 'a failure is shown with its reason');
ok(await E(() => !document.querySelector('#btnTrajExport').disabled), 'and the button can be tried again');
await E(() => { TrajDB.all = window.__all0; });

// /traj export says so too
await E(() => { TrajDB.all = async () => { throw new Error('read failed again (test)'); }; });
await page.fill('#input', '/traj export'); await E(() => document.querySelector('#btnSend').click());
await page.waitForFunction(() => [...document.querySelectorAll('.toast, #toasts *')].some(t => /Export failed: read failed again/.test(t.textContent)), null, { timeout: 10000 }).then(() => ok(true, '/traj export shows a failure too'), () => ok(false, '/traj export shows a failure too'));
await E(() => { TrajDB.all = window.__all0; });
await done('traj_export_test');
