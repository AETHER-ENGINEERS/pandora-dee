// The desktop app's vault: a real folder (desktop/disk_host.cjs), reached through the same synchronous bridge the
// Android app offers. Part 1 checks the folder host on its own. Part 2 opens the built page with that bridge (the
// app's preload answers through Electron's synchronous IPC; here a synchronous request to a small local server stands
// in for it, calling the very same host) and checks: the vault is ordinary files, bash and the folder agree, changes
// made outside come in, a full backup from a plain browser moves in without losing anything, and a wipe goes to trash.
import pw from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
const { chromium } = pw;
const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(process.env.JV_WEB), '..');
const { createDiskHost } = require(path.join(ROOT, 'desktop', 'disk_host.cjs'));
const css = fs.readFileSync('tw.css', 'utf8');
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' };
const log = []; const fail = [];
const ok = (c, m) => { (c ? log : fail).push((c ? 'PASS ' : 'FAIL ') + m); };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-desktop-'));
const disk = (dir, p) => path.join(dir, ...p.split('/').filter(Boolean));

// ---------- 1. the folder host on its own ----------
{
  const dir = path.join(tmp, 'unit', 'vault');
  const h = createDiskHost(dir);
  const b64 = s => Buffer.from(s).toString('base64');
  ok(JSON.parse(h.call('info')).mode === 'desktop', 'info says desktop');
  ok(/^ok:\d{10,}$/.test(h.call('put', ['/Pandora/SOUL.md', b64('# SOUL'), true, true])), 'put answers ok:<mtime>');
  ok(fs.readFileSync(disk(dir, '/Pandora/SOUL.md'), 'utf8') === '# SOUL', 'the file is an ordinary file in the folder');
  h.call('put', ['/big.bin', b64('abc'), true, false]); h.call('put', ['/big.bin', b64('def'), false, false]);
  ok(!fs.existsSync(disk(dir, '/big.bin')), 'a write arriving in pieces is not in place until its last piece');
  h.call('put', ['/big.bin', b64('ghi'), false, true]);
  ok(fs.readFileSync(disk(dir, '/big.bin'), 'utf8') === 'abcdefghi', 'pieces join in order');
  ok(Buffer.from(h.call('get', ['/big.bin', 3, 4]), 'base64').toString() === 'defg', 'get reads from an offset');
  const scan = JSON.parse(h.call('scan'));
  const st = fs.statSync(disk(dir, '/Pandora/SOUL.md'));
  ok(scan.some(([p, d, z, m]) => p === '/Pandora/SOUL.md' && !d && z === 6 && m === Math.floor(st.mtimeMs)) && scan.some(([p, d]) => p === '/Pandora' && d), 'scan lists paths, sizes and times');
  fs.writeFileSync(disk(dir, '/half.md.jvtmp'), 'x');
  ok(!JSON.parse(h.call('scan')).some(([p]) => p.endsWith('.jvtmp')) && !fs.existsSync(disk(dir, '/half.md.jvtmp')), 'a write that never finished is cleared, not listed');
  for (const bad of ['/../outside.md', '/Pandora/../../outside.md', 'relative.md', '/']) ok(h.call('put', [bad, b64('x'), true, true]).startsWith('ERR:'), `refused: ${bad}`);
  ok(!fs.existsSync(path.join(tmp, 'unit', 'outside.md')), 'nothing was written outside the folder');
  ok(h.call('mkdir', ['/notes/deep']) === 'ok' && fs.statSync(disk(dir, '/notes/deep')).isDirectory(), 'mkdir');
  ok(h.call('move', ['/big.bin', '/notes/big.bin']) === 'ok' && fs.existsSync(disk(dir, '/notes/big.bin')), 'move');
  ok(h.call('del', ['/notes/big.bin']) === 'ok' && !fs.existsSync(disk(dir, '/notes/big.bin')), 'del removes it from the vault');
  const trashed = (rel) => { const out = []; const walk = d => { if (!fs.existsSync(d)) return; for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else out.push(f); } }; walk(h.trash); return out.filter(f => f.split(path.sep).join('/').endsWith(rel)); };
  ok(trashed('/notes/big.bin').length === 1, 'and it waits in the trash beside the vault, not inside it');
  ok(h.call('clear') === 'ok' && fs.readdirSync(dir).length === 0 && trashed('/Pandora/SOUL.md').length === 1, 'clear moves everything to the trash');
  ok(/^ok:\d+$/.test(h.call('touch', ['/x.md', 5])) === false, 'touch on a missing file is an error');
  if (process.platform !== 'win32') {
    fs.mkdirSync(path.join(tmp, 'unit', 'elsewhere'), { recursive: true }); fs.writeFileSync(path.join(tmp, 'unit', 'elsewhere', 'secret'), 's');
    fs.symlinkSync(path.join(tmp, 'unit', 'elsewhere'), disk(dir, '/link'));
    ok(h.call('get', ['/link/secret', 0, 10]).startsWith('ERR:') && !JSON.parse(h.call('scan')).some(([p]) => p.startsWith('/link')), 'a link leading out of the folder is not followed');
  }
}

// ---------- 2. the page with the bridge ----------
const VAULT = path.join(tmp, 'Pandora Atelier');
let host = createDiskHost(VAULT);
const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
  let body = ''; req.on('data', d => body += d); req.on('end', () => {
    let out; try { const { name, args } = JSON.parse(body); out = host.call(name, args); } catch (e) { out = 'ERR:' + e.message; }
    res.writeHead(200, { ...CORS, 'Content-Type': 'text/plain' }); res.end(String(out));
  });
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BRIDGE = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const route = async r => {
  const req = r.request(); const url = req.url();
  if (url.startsWith('file://') || url.startsWith('data:') || url.startsWith('blob:') || url.startsWith(BRIDGE)) return r.continue();
  if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
  if (url.startsWith('https://cdn.tailwindcss.com/')) return r.fulfill({ contentType: 'text/javascript', body: `window.tailwind={};(function(){var s=document.createElement('style');s.textContent=${JSON.stringify(css)};document.head.prepend(s);})();` });
  if (url.includes('marked.min.js')) return r.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(process.env.JV_NM + 'marked/lib/marked.umd.js', 'utf8') });
  if (url.includes('katex.min.js')) return r.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(process.env.JV_NM + 'katex/dist/katex.min.js', 'utf8') });
  if (url.includes('katex.min.css')) return r.fulfill({ contentType: 'text/css', body: fs.readFileSync(process.env.JV_NM + 'katex/dist/katex.min.css', 'utf8') });
  if (url.includes('purify.min.js')) return r.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(process.env.JV_NM + 'dompurify/dist/purify.min.js', 'utf8') });
  if (url === 'http://localhost:11434/api/tags') return r.fulfill({ headers: CORS, contentType: 'application/json', body: JSON.stringify({ models: [{ name: 'qwen3:8b' }] }) });
  return r.abort();
};
const open = async (withBridge) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  await ctx.addInitScript(() => { if (!localStorage.getItem('jvault:settings')) localStorage.setItem('jvault:settings', JSON.stringify({ model: 'qwen3:8b' })); });
  // the desktop app's preload, in miniature: the same calls, answered synchronously
  if (withBridge) await ctx.addInitScript(base => {
    const call = name => (...args) => { const x = new XMLHttpRequest(); x.open('POST', base, false); x.setRequestHeader('Content-Type', 'text/plain'); x.send(JSON.stringify({ name, args })); return x.responseText; };
    window.PandoraDesk = { app: 'test', diskInfo: call('info'), diskScan: call('scan'), diskGet: call('get'), diskPut: call('put'), diskMkdir: call('mkdir'), diskDel: call('del'), diskMove: call('move'), diskTouch: call('touch'), diskClear: call('clear'), diskUseShared: call('useShared') };
  }, BRIDGE);
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error') log.push(`[${m.type()}] ${m.text().slice(0, 240)}`); });
  page.on('pageerror', e => fail.push('[pageerror] ' + e.message));
  page.on('dialog', d => d.accept());
  await page.route('**/*', route);
  await page.goto('file://' + process.env.JV_WEB);
  await ready(page);
  return { ctx, page };
};
const ready = page => page.waitForFunction(() => typeof vfs !== 'undefined' && vfs.nodes.size > 3 && /BUSYBOX|JS APPLETS/.test(document.querySelector('#txtShell')?.textContent || ''), null, { timeout: 90000 }).then(() => page.waitForTimeout(800));
const flush = page => page.evaluate(() => vfs.flush(true));
const bash = (page, command) => page.evaluate(c => runTool('bash', { command: c }, null), command);

// (a) her vault in a plain browser (as in Firefox): IndexedDB, then a full backup of it
const ff = await open(false);
ok(await ff.page.evaluate(() => !vfs.diskOn), 'a plain browser keeps the vault in IndexedDB, as before');
await ff.page.evaluate(() => { vfs.write('/Pandora/SOUL.md', '# Pandora Dee Fae\nthe browser copy\n', { mkdirs: true }); vfs.write('/Pandora/Journal/2026-11-20.md', 'a day in the browser', { mkdirs: true }); vfs.write('/Pandora/pic.bin', new Uint8Array([0, 1, 2, 250, 255]), { mkdirs: true }); });
await ff.page.waitForTimeout(500);
const backup = await ff.page.evaluate(async () => JSON.stringify(await buildBackup('full', false)));
ok(JSON.parse(backup).vault.files['/Pandora/SOUL.md'].includes('the browser copy'), 'the browser makes a full backup');
await ff.ctx.close();

// (b) the person copies what she wants into the new folder first; one file is also in the backup, with other contents
fs.mkdirSync(disk(VAULT, '/Pandora'), { recursive: true });
fs.writeFileSync(disk(VAULT, '/Pandora/SOUL.md'), '# Pandora Dee Fae\nthe folder copy\n');
fs.writeFileSync(disk(VAULT, '/Pandora/copied-in.md'), 'copied by hand');

const app = await open(true);
const p = app.page;
ok(await p.evaluate(() => vfs.diskOn && vfs.info?.mode === 'desktop'), 'with the desktop bridge the vault runs on the folder');
ok(await p.evaluate(() => vfs.read('/Pandora/SOUL.md')).then(t => t.includes('the folder copy')), 'the page reads /Pandora/SOUL.md from the real file');
ok(await p.evaluate(() => vfs.isFile('/Pandora/copied-in.md')), 'files copied in by hand are there');
ok(!(await p.evaluate(() => vfs.isFile('/Welcome.md'))), 'a folder that already has files is not filled with the sample vault');

// bash and the folder agree, both ways
ok(/the folder copy/.test(await bash(p, 'cat /Pandora/SOUL.md')), 'bash reads the real file');
await bash(p, 'echo "written by bash" > /Pandora/from-bash.md');
await flush(p);
ok(fs.readFileSync(disk(VAULT, '/Pandora/from-bash.md'), 'utf8').trim() === 'written by bash', 'what bash writes is an ordinary file in the folder');
fs.writeFileSync(disk(VAULT, '/Pandora/from-outside.md'), 'written by another app');
fs.writeFileSync(disk(VAULT, '/Pandora/copied-in.md'), 'changed by another app');
await p.evaluate(() => vfs.rescan(true));
ok(/written by another app/.test(await bash(p, 'cat /Pandora/from-outside.md')), 'a file another app adds shows up (rescan)');
ok(await p.evaluate(() => vfs.read('/Pandora/copied-in.md')) === 'changed by another app', 'and a change another app makes too');

// (c) the one-time move: her browser backup restored in the app
await p.evaluate(b => importBackup(new File([b], 'pandora-dee-backup.json', { type: 'application/json' })), backup);
await p.waitForTimeout(1500); await ready(p); await p.waitForTimeout(1200); await flush(p);
const files = fs.readdirSync(disk(VAULT, '/Pandora'));
ok(fs.readFileSync(disk(VAULT, '/Pandora/Journal/2026-11-20.md'), 'utf8') === 'a day in the browser', 'the browser vault moved into the folder as files');
ok(Buffer.compare(fs.readFileSync(disk(VAULT, '/Pandora/pic.bin')), Buffer.from([0, 1, 2, 250, 255])) === 0, 'binary files move byte for byte');
ok(fs.readFileSync(disk(VAULT, '/Pandora/SOUL.md'), 'utf8').includes('the folder copy'), "the folder's own SOUL.md is not overwritten");
const kept = files.filter(f => /^SOUL \(from the browser .+\)\.md$/.test(f));
ok(kept.length === 1 && fs.readFileSync(disk(VAULT, '/Pandora/' + kept[0]), 'utf8').includes('the browser copy'), "the browser's SOUL.md is kept beside it: " + kept.join(', '));
ok(fs.existsSync(disk(VAULT, '/Pandora/from-bash.md')) && fs.existsSync(disk(VAULT, '/Pandora/from-outside.md')), 'files already in the folder stay through a full restore');
ok(await p.evaluate(async () => (await idb.get('vfs')) === undefined), 'the browser database no longer holds the vault');
ok(await p.evaluate(async () => { const db = await new Promise(r => { const q = indexedDB.open('jade-vault', 1); q.onsuccess = () => r(q.result); }); return new Promise(r => { const q = db.transaction('kv').objectStore('kv').getAllKeys(); q.onsuccess = () => r(q.result.some(k => String(k).startsWith('vfs-before-folder-'))); }); }), 'the moved record is kept, under another name');

// survives a reload, from the folder alone
await p.reload(); await ready(p);
ok(await p.evaluate(() => vfs.read('/Pandora/Journal/2026-11-20.md')) === 'a day in the browser', 'after a reload the vault comes from the folder');

// (d) a wipe (a full restore that starts from nothing) moves the old files to the trash
await p.evaluate(() => { vfs.replace([['/', { dir: true, mtime: Date.now() }], ['/fresh.md', { data: new TextEncoder().encode('fresh'), mtime: Date.now() }]], true); });
await p.waitForTimeout(400); await flush(p);
ok(fs.readdirSync(VAULT).join() === 'fresh.md', 'a wipe leaves only the new vault in the folder');
const inTrash = []; const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else inTrash.push(e.name); } }; walk(host.trash);
ok(inTrash.includes('SOUL.md') && inTrash.includes('2026-11-20.md') && inTrash.includes('from-bash.md'), 'and every old file waits in the trash beside it');

// (e) Settings shows the folder
await p.evaluate(() => diskSync());
ok(await p.evaluate(() => !$('#diskSection').hidden && /this folder on the computer/.test($('#diskStatus').textContent)), 'Config shows the vault folder');

await browser.close(); server.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log(log.join('\n')); console.log('\n' + (fail.length ? fail.join('\n') : 'ALL PASS'));
