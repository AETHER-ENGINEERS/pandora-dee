import pw from 'playwright';
import fs from 'node:fs';
const { chromium } = pw;
const URL_ = process.argv[2] || 'file://' + process.env.JV_WEB;
const OUT = process.cwd() + '/pyshots'; fs.mkdirSync(OUT, { recursive: true });
const css = fs.readFileSync('tw.css', 'utf8');
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' };
const log = [], fail = []; const ok = (c, m) => (c ? log : fail).push((c ? 'PASS ' : 'FAIL ') + m);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let cdnHits = [], cdnUp = true;
async function makePage() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, userAgent: process.env.UA || 'Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/UQ1A.240205.004; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/128.0.6613.127 Mobile Safari/537.36' });
  await ctx.addInitScript(() => { if (!localStorage.getItem('jvault:settings')) localStorage.setItem('jvault:settings', JSON.stringify({ model: 'qwen3:8b', journalOn: false })); });
  const page = await ctx.newPage();
  page.on('pageerror', e => fail.push('[pageerror] ' + e.message));
  await page.route('**/*', async route => {
    const req = route.request(); const url = req.url();
    if (url.startsWith('file://') || url.startsWith('data:') || url.startsWith('blob:')) return route.continue();
    if (url.startsWith('https://cdn.tailwindcss.com/')) return route.fulfill({ contentType: 'text/javascript', body: `window.tailwind={};(function(){var s=document.createElement('style');s.textContent=${JSON.stringify(css)};document.head.prepend(s);})();` });
    if (url.includes('marked.min.js')) return route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(process.env.JV_NM + 'marked/lib/marked.umd.js', 'utf8') });
    if (url.includes('katex.min.js')) return route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(process.env.JV_NM + 'katex/dist/katex.min.js', 'utf8') });
    if (url.includes('purify.min.js')) return route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(process.env.JV_NM + 'dompurify/dist/purify.min.js', 'utf8') });
    if (url.startsWith('https://cdn.jsdelivr.net/npm/@micropython/micropython-webassembly-pyscript@1.27.0/')) {
      cdnHits.push(url.split('/').pop()); if (!cdnUp) return route.abort('internetdisconnected');
      if (url.endsWith('micropython.mjs')) return route.fulfill({ headers: CORS, contentType: 'text/javascript', body: fs.readFileSync(process.env.MPY_MOCK || 'mpymock/micropython.min.mjs', 'utf8') });
      if (url.endsWith('micropython.wasm')) return route.fulfill({ headers: CORS, contentType: 'application/wasm', body: Buffer.concat([Buffer.from([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]), Buffer.from('MOCK-27')]) });
    }
    if (url === 'http://localhost:11434/api/tags') return route.fulfill({ headers: CORS, contentType: 'application/json', body: JSON.stringify({ models: [{ name: 'qwen3:8b' }] }) });
    if (url === 'http://localhost:11434/api/chat') {
      const b = JSON.parse(req.postData()); const n = b.messages.filter(m => m.role === 'tool').length;
      const step = n === 0 ? { tool_calls: [{ function: { name: 'write', arguments: { path: '/scripts/count.py', content: "import os\nprint(len(os.listdir('/guides')))\nos.mkdir('/out')\nopen('/out/py.md', 'w').write('# from python')\n" } } }] }
        : n === 1 ? { tool_calls: [{ function: { name: 'bash', arguments: { command: 'python scripts/count.py && cat /out/py.md' } } }] } : { content: 'Python says 3 guides.' };
      return route.fulfill({ headers: CORS, contentType: 'application/x-ndjson', body: JSON.stringify({ message: { role: 'assistant', content: step.content || '', ...(step.tool_calls ? { tool_calls: step.tool_calls } : {}) }, done: false }) + '\n' + JSON.stringify({ message: { role: 'assistant', content: '' }, done: true }) + '\n' });
    }
    return route.abort();
  });
  await page.goto(URL_);
  await page.waitForFunction(() => /BUSYBOX|JS APPLETS/.test(document.querySelector('#txtShell')?.textContent || '') && typeof runPython === 'function', null, { timeout: 90000 });
  await page.waitForTimeout(800);
  return { ctx, page };
}
const sh = async (page, cmd) => page.evaluate(async (cmd) => { const s = new (Object.getPrototypeOf(userShell).constructor)({}); s.timeoutMs = 4000; const r = await s.run(cmd); return { out: r.chunks.filter(c => !c.err).map(c => c.s).join(''), err: r.chunks.filter(c => c.err).map(c => c.s).join(''), code: r.code }; }, cmd);
let { ctx, page } = await makePage();
// ---------- basics ----------
let r = await sh(page, 'python --version');
ok(/MicroPython 1\.27\.0/.test(r.out) && cdnHits.length === 0, 'python --version (no download needed)');
r = await sh(page, `python -c "print('hello from python')"`);
ok(r.out === 'hello from python\n' && r.code === 0, 'python -c: ' + JSON.stringify(r));
ok(cdnHits.includes('micropython.mjs') && cdnHits.includes('micropython.wasm'), 'runtime downloaded from jsDelivr (PyScript build 1.27.0)');
const cached = await page.evaluate(async () => { const c = await idb.get('mpy:1.27.0'); return !!c?.mjs && c.wasm.length === 15; });
ok(cached, 'runtime cached in IndexedDB');
// a corrupt cache entry (empty wasm, the "BufferSource argument is empty" crash) is discarded and downloaded again
const hits0 = cdnHits.length;
await page.evaluate(async () => { await idb.set('mpy:1.27.0', { mjs: 'x', wasm: new Uint8Array(0) }); });
await page.reload();
await page.waitForFunction(() => /BUSYBOX|JS APPLETS/.test(document.querySelector('#txtShell')?.textContent || '') && typeof runPython === 'function', null, { timeout: 90000 });
r = await sh(page, `python -c "print('after repair')"`);
ok(r.out === 'after repair\n' && cdnHits.length > hits0 && await page.evaluate(async () => (await idb.get('mpy:1.27.0')).wasm.length === 15), 'empty cached wasm is repaired by re-downloading: ' + JSON.stringify(r));
// files in both directions
await page.evaluate(() => vfs.write('/scripts/demo.py', "import sys, os\nprint(sys.argv)\nprint(open('/Inbox.md').read())\nopen('/py/new.md', 'w').write('# made by python')\nos.remove('/Todo List.md')\n"));
await page.evaluate(() => vfs.mkdirp('/py'));
r = await sh(page, 'python scripts/demo.py one two');
ok(/\['\/scripts\/demo\.py', 'one', 'two'\]/.test(r.out) && /# Inbox/.test(r.out), 'script runs with argv and reads vault files');
const fsAfter = await page.evaluate(() => ({ made: vfs.isFile('/py/new.md') && vfs.read('/py/new.md'), removed: !vfs.exists('/Todo List.md'), tmp: vfs.exists('/tmp'), dev: vfs.exists('/dev') }));
ok(fsAfter.made === '# made by python' && fsAfter.removed, 'writes and deletes come back to the vault');
ok(!fsAfter.tmp && !fsAfter.dev, "runtime's own /tmp, /dev are not copied into the vault");
// stdin, exit codes, errors, pipes
r = await sh(page, `echo Jade | python -c "print(input())"`);
ok(r.out === 'Jade\n', 'stdin piped into input()');
r = await sh(page, `python -c "import sys\nsys.exit(3)"`);
ok(r.code === 3 && !r.err, 'sys.exit(3) → exit code 3, no traceback');
r = await sh(page, `python -c "raise ValueError('bad input')" || echo failed`);
ok(/ValueError: bad input/.test(r.err) && /failed/.test(r.out), 'exceptions show a traceback and fail the command');
r = await sh(page, `printf "print('from stdin script')" | python`);
ok(r.out === 'from stdin script\n', 'script from stdin');
r = await sh(page, `python -c "print(6*7)" | wc -l`);
ok(/1/.test(r.out), 'python output pipes into BusyBox');
r = await sh(page, 'python nope.py');
ok(r.code === 2 && /can't open file/.test(r.err), 'missing file');
r = await sh(page, 'pip install numpy');
ok(r.code === 1 && /no package installer/.test(r.err), 'pip explains itself');
const t0 = Date.now(); r = await sh(page, `python -c "while True: pass"`);
ok(r.code === 124 && /timeout/.test(r.err) && Date.now() - t0 < 9000, 'runaway script killed by timeout');
// ---------- agent: write a .py file, run it through bash ----------
await page.fill('#input', 'count my guides with python'); await page.tap('#btnSend');
await page.waitForFunction(() => !running && /Python says 3 guides/.test(document.querySelector('#chat').textContent), null, { timeout: 30000 });
const toolOut = await page.evaluate(() => cur.messages.filter(m => m.role === 'tool').map(m => m.content));
ok(/^3\n# from python/.test(toolOut[1] || ''), 'agent ran python via bash: ' + JSON.stringify(toolOut[1]));
ok(await page.evaluate(() => /MicroPython 1\.27\.0 on the same files/.test(systemPrompt())), 'system prompt tells Jade about python');
// terminal UI
await page.tap('.tab[data-tab="term"]'); await page.waitForTimeout(200);
await page.fill('#termCmd', `python -c "print('hi from the shell tab')"`); await page.press('#termCmd', 'Enter'); await page.waitForTimeout(1500);
ok(/hi from the shell tab/.test(await page.evaluate(() => document.querySelector('#term').innerText)), 'works in the Shell tab');
await page.screenshot({ path: OUT + '/1_shell.png' });
await ctx.close();
// ---------- offline after first download ----------
cdnUp = false; cdnHits = [];
({ ctx, page } = await makePage());
r = await sh(page, `python -c "print('first run offline')"`);
ok(r.code === 1 && /needs internet once/.test(r.err), 'fresh install offline: clear message');
await ctx.close();
cdnUp = true;
const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 } });
const p2 = await ctx2.newPage(); p2.on('pageerror', e => fail.push('[pageerror2] ' + e.message));
await p2.route('**/*', async route => { const u = route.request().url(); if (u.startsWith('file:') || u.startsWith('blob:') || u.startsWith('data:')) return route.continue(); if (u.includes('micropython')) { cdnHits.push('second:' + u.split('/').pop()); if (!cdnUp) return route.abort(); return route.fulfill({ headers: CORS, contentType: u.endsWith('.mjs') ? 'text/javascript' : 'application/wasm', body: u.endsWith('.mjs') ? fs.readFileSync(process.env.MPY_MOCK || 'mpymock/micropython.min.mjs', 'utf8') : Buffer.concat([Buffer.from([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]), Buffer.from('MOCK-27')]) }); } if (u.includes('marked')) return route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(process.env.JV_NM + 'marked/lib/marked.umd.js', 'utf8') }); if (u.includes('purify')) return route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(process.env.JV_NM + 'dompurify/dist/purify.min.js', 'utf8') }); return route.abort(); });
await p2.goto(URL_); await p2.waitForFunction(() => typeof runPython === 'function' && typeof userShell !== 'undefined', null, { timeout: 90000 });
let rr = await sh(p2, `python -c "print('online once')"`);
cdnUp = false; await p2.reload(); await p2.waitForFunction(() => typeof runPython === 'function' && typeof userShell !== 'undefined', null, { timeout: 90000 });
const before = cdnHits.length;
rr = await sh(p2, `python -c "print('offline now')"`);
ok(rr.out === 'offline now\n' && cdnHits.length === before, 'works offline after the first download');
console.log(log.join('\n')); console.log('\n' + (fail.length ? fail.join('\n') : 'ALL PASS'));
await browser.close();
