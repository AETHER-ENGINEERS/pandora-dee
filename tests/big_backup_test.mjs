// Big backups are written and read in pieces (app/big_backups.py). The browser's string limit is lowered to 50 MB here
// (JSON.stringify / JSON.parse fail above it, as they do at ~0.5–1 GB for real), and a ~120 MB vault is exported and
// read back. A failure says why, never "undefined".
import { start } from './_harness.mjs';
const { page, ok, done } = await start();
const E = (fn, arg) => page.evaluate(fn, arg);

// a vault worth backing up: text, a binary file, chats
await E(async () => {
  const two = 'The tide comes in. '.repeat(110000);   // ~2 MB of text per file
  for (let i = 0; i < 60; i++) vfs.write(`/big/part-${i}.md`, `# Part ${i}\n\n` + two, { mkdirs: true });
  const bin = new Uint8Array(300000); for (let i = 0; i < bin.length; i++) bin[i] = (i * 7) & 255; vfs.write('/big/blob.bin', bin, { mkdirs: true });
  vfs.write('/small/ünïcode "quotes".md', 'Line one\nLine "two" \\ ✓ 🌊\n', { mkdirs: true });
  newSession(); cur.title = 'A chat'; cur.messages = [{ role: 'user', content: 'hello\nthere' }, { role: 'assistant', content: 'Hi! "quoted"' }]; saveSession.flush();
  await new Promise(r => setTimeout(r, 500));
});

// the pieces are an ordinary backup when joined (small case: JSON.parse of the whole still works)
const same = await E(async () => {
  const data = await buildBackup('config', false); const joined = backupPieces(data).join('');
  const norm = o => JSON.stringify(o, (k, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort()) : v);   // key order doesn't matter in JSON
  return norm(JSON.parse(joined)) === norm(data);
});
ok(same, 'joined, the pieces are exactly the backup as JSON (any version can open it)');

// now the browser can't hold more than 50 MB in one string
await E(() => {
  const s0 = JSON.stringify, p0 = JSON.parse; window.__json = { s0, p0 };
  JSON.stringify = function (...a) { const r = s0.apply(JSON, a); if (typeof r === 'string' && r.length > 50e6) throw new RangeError('Invalid string length'); return r; };
  JSON.parse = function (t, ...a) { if (typeof t === 'string' && t.length > 50e6) throw new RangeError('Invalid string length'); return p0.call(JSON, t, ...a); };
  window.__blobs = []; const c0 = URL.createObjectURL; URL.createObjectURL = b => { if (b instanceof Blob) window.__blobs.push(b); return c0.call(URL, b); };
  delete window.NetrunnerAndroid.saveFile;   // the browser's own download path
});
const oldWay = await E(async () => { try { JSON.stringify(await buildBackup('full', false), null, 1); return 'no error'; } catch (e) { return String(e.message || e); } });
ok(/Invalid string length/.test(oldWay), 'the old way (one string) fails at this size: ' + oldWay);

// Export everything: works, and the file is the whole backup
await E(() => { openSettings(); document.querySelector('#btnExportAll').click(); });
await page.waitForFunction(() => window.__blobs.length > 0 || [...document.querySelectorAll('.toast, #toasts *')].some(t => /Export failed/.test(t.textContent)), null, { timeout: 60000 });
const fail = await E(() => [...document.querySelectorAll('.toast, #toasts *')].map(t => t.textContent).find(t => /Export failed/.test(t)));
ok(!fail, 'Export everything works on a vault too big for one string' + (fail ? ': ' + fail : ''));
const size = await E(() => window.__blobs.at(-1)?.size || 0);
ok(size > 120e6, `the saved file holds it all (${(size / 1e6).toFixed(0)} MB)`);
ok(await E(() => document.querySelector('#btnBackupCopy').hidden && /Full backup: \d+ files, .* · 1\d\d(\.\d)?M/.test(document.querySelector('#backupNote').textContent)), 'Copy JSON is offered only for small backups, and the note gives the size');

// read it back: too big for one piece, so line by line, and everything is there
const back = await E(async () => {
  const blob = window.__blobs.at(-1); const data = await readBackupFile(new File([blob], 'b.json'));
  const f = data.vault.files;
  return { app: data.app, kind: data.kind, n: Object.keys(f).length, part: typeof f['/big/part-7.md'] === 'string' && f['/big/part-7.md'].length > 2e6,
    uni: f['/small/ünïcode "quotes".md'], bin: f['/big/blob.bin']?.base64?.length, chats: Object.keys(data.db || {}).filter(k => k.startsWith('session:')).length };
});
ok(back.app === 'jade-vault' && back.kind === 'full' && back.n >= 62, `read back in full: ${back.n} files`);
ok(back.part && back.uni === 'Line one\nLine "two" \\ ✓ 🌊\n' && back.bin > 300000, 'big text, quotes, backslashes, emoji and a binary file come back exactly');
ok(back.chats >= 1, `chats come back too (${back.chats})`);

// the same through gzip (as the scheduled backup to a server writes it)
const gz = await E(async () => {
  const pieces = backupPieces(await buildBackup('full', false));
  const bytes = await new Response(new Blob(pieces).stream().pipeThrough(new CompressionStream('gzip'))).blob();
  const data = await readBackupFile(new File([bytes], 'b.json.gz'));
  return { n: Object.keys(data.vault.files).length, mb: bytes.size / 1e6 };
});
ok(gz.n >= 62, `a gzipped big backup reads back too (${gz.n} files from ${gz.mb.toFixed(1)} MB)`);

// a big backup in the old indented form says why it can't be opened
const old = await E(async () => {
  const head = '{\n "app": "jade-vault",\n "vault": {\n  "files": {\n'; const filler = ' "x": "' + 'y'.repeat(1e6) + '",\n';
  try { await readBackupLines(new Blob([head, filler.repeat(3), '}}}'])); return 'opened'; } catch (e) { return e.message; }
});
ok(/made before 2\.10\.9/.test(old), 'an old-style big backup says why it can\'t be opened: ' + old.slice(0, 80));

// a failure shows its reason, not "undefined"
await E(() => { JSON.stringify = window.__json.s0; JSON.parse = window.__json.p0; window.__bb = window.buildBackup; });
await E(() => { const t0 = document.querySelectorAll('.toast').length; window.__fakeOOM = true; });
await E(async () => { const orig = Blob; window.Blob = function () { throw 'out of memory'; }; try { document.querySelector('#btnExportCfg').click(); await new Promise(r => setTimeout(r, 800)); } finally { window.Blob = orig; } });
const msg = await E(() => [...document.querySelectorAll('.toast, #toasts *')].map(t => t.textContent).filter(t => /Export failed/.test(t)).at(-1) || '');
ok(/Export failed: out of memory \(the browser ran out of memory for this\)/.test(msg) && !/undefined/.test(msg), 'a bare "out of memory" is shown as such: ' + msg);
await done('big_backup_test');
