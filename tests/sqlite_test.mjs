import pw from 'playwright';
import fs from 'node:fs';
const { chromium } = pw;
const URL_ = process.argv[2] || 'file://' + process.env.JV_WEB;
const OUT = process.cwd() + '/sqshots'; fs.mkdirSync(OUT, { recursive: true });
const css = fs.readFileSync('tw.css', 'utf8');
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' };
const log = [], fail = []; const ok = (c, m) => (c ? log : fail).push((c ? 'PASS ' : 'FAIL ') + m);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/UQ1A.240205.004; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/128.0.6613.127 Mobile Safari/537.36' });
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
  if (url.includes('micropython-webassembly-pyscript@1.27.0/')) {
    if (url.endsWith('micropython.mjs')) return route.fulfill({ headers: CORS, contentType: 'text/javascript', body: fs.readFileSync('mpymock/micropython.min.mjs', 'utf8') });
    if (url.endsWith('micropython.wasm')) return route.fulfill({ headers: CORS, contentType: 'application/wasm', body: Buffer.concat([Buffer.from([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]), Buffer.from('MOCK-27')]) });
  }
  if (url === 'http://localhost:11434/api/tags') return route.fulfill({ headers: CORS, contentType: 'application/json', body: JSON.stringify({ models: [{ name: 'qwen3:8b' }] }) });
  if (url === 'http://localhost:11434/api/chat') {
    const b = JSON.parse(req.postData()); const n = b.messages.filter(m => m.role === 'tool').length;
    const step = n === 0 ? { tool_calls: [{ function: { name: 'bash', arguments: { command: 'sqlite3 -json data/app.db "select count(*) as n from t"' } } }] } : { content: 'The table has rows.' };
    return route.fulfill({ headers: CORS, contentType: 'application/x-ndjson', body: JSON.stringify({ message: { role: 'assistant', content: step.content || '', ...(step.tool_calls ? { tool_calls: step.tool_calls } : {}) }, done: false }) + '\n' + JSON.stringify({ message: { role: 'assistant', content: '' }, done: true }) + '\n' });
  }
  return route.abort();
});
const boot = async () => { await page.waitForFunction(() => /BUSYBOX|JS APPLETS/.test(document.querySelector('#txtShell')?.textContent || '') && typeof runSqliteCli === 'function', null, { timeout: 90000 }); await page.waitForTimeout(800); };
await page.goto(URL_); await boot();
const sh = async (cmd) => page.evaluate(async (cmd) => { const s = new (Object.getPrototypeOf(userShell).constructor)({}); s.timeoutMs = 8000; const r = await s.run(cmd); return { out: r.chunks.filter(c => !c.err).map(c => c.s).join(''), err: r.chunks.filter(c => c.err).map(c => c.s).join(''), code: r.code }; }, cmd);
const isDb = p => page.evaluate(p => vfs.isFile(p) && isSqliteBytes(vfs.readBytes(p)), p);
let r = await sh('sqlite3 --version');
ok(/^3\.53\./.test(r.out) && r.code === 0, 'sqlite3 --version: ' + JSON.stringify(r));
r = await sh(`sqlite3 data/app.db "create table t(a integer, b text); insert into t values(1,'x'),(2,'y');"`);
ok(r.code === 0 && await isDb('/data/app.db'), 'creates data/app.db (real SQLite file, dir made): ' + JSON.stringify(r));
r = await sh('sqlite3 -json data/app.db "select * from t order by a"');
ok(JSON.stringify(JSON.parse(r.out)) === '[{"a":1,"b":"x"},{"a":2,"b":"y"}]', '-json query: ' + r.out);
await page.evaluate(() => vfs.write('/data/people.csv', 'name,age\nAda,36\nLin,29\n"Mo, Jr",41\n', { mkdirs: true }));
r = await sh('cd data && sqlite3 app.db ".import --csv people.csv people" && sqlite3 -box app.db "select name, age from people order by age"');
ok(r.code === 0 && /Mo, Jr/.test(r.out) && /│|\|/.test(r.out), '.import CSV relative to cwd, -box output: ' + JSON.stringify(r));
r = await sh(`echo "select count(*) from people;" | sqlite3 data/app.db`);
ok(r.out.trim() === '3', 'SQL piped on stdin: ' + JSON.stringify(r));
r = await sh(`sqlite3 data/app.db .dump | grep -c INSERT`);
ok(/^5/.test(r.out.trim()), '.dump pipes into BusyBox grep: ' + JSON.stringify(r));
r = await sh(`sqlite3 data/app.db "select nope from t"`);
ok(r.code !== 0 && /no such column/.test(r.err), 'SQL errors reported: ' + JSON.stringify(r));
r = await sh(`sqlite3 Inbox.md "select 1"`);
ok(r.code === 1 && /not a database/.test(r.err) && await page.evaluate(() => vfs.read('/Inbox.md').startsWith('# Inbox')), 'refuses a markdown note, leaves it alone');
r = await sh(`sqlite3 -readonly data/app.db "select count(*) from t" ; sqlite3 :memory: "select 6*7"`);
ok(/2\n42/.test(r.out), 'read-only and :memory: work: ' + JSON.stringify(r));
// node
r = await sh(`node -e "const { DatabaseSync } = require('node:sqlite'); const db = new DatabaseSync('/data/app.db'); db.prepare('insert into t values (?, ?)').run(3, 'node'); console.log(JSON.stringify(db.prepare('select count(*) n from t').get())); db.close()"`);
ok(r.out.trim() === '{"n":3}' && r.code === 0, 'node:sqlite DatabaseSync: ' + JSON.stringify(r));
r = await sh('sqlite3 data/app.db "select b from t where a=3"');
ok(r.out.trim() === 'node', 'node write saved to the vault file');
await page.evaluate(() => vfs.write('/scripts/b.js', "const Database = require('better-sqlite3');\nconst db = new Database('data/b.db');\ndb.exec('create table if not exists k(v)');\nconst ins = db.prepare('insert into k values (?)');\ndb.transaction(xs => xs.forEach(x => ins.run(x)))(['a','b','c']);\nconsole.log(db.prepare('select count(*) from k').pluck().get());\n", { mkdirs: true }));
r = await sh('node scripts/b.js');
ok(r.out.trim() === '3' && await isDb('/data/b.db'), 'better-sqlite3 from a script file (no close, still saved): ' + JSON.stringify(r));
r = await sh(`node -e "const fs=require('fs'); console.log(fs.readFileSync('/data/app.db').length > 4000, fs.readFileSync('Inbox.md','utf8').slice(0,7))"`);
ok(/true # Inbox/.test(r.out), 'other scripts still see text files: ' + JSON.stringify(r));
r = await sh(`node -e "console.log(1+1)"`);
ok(r.out === '2\n', 'plain node unaffected');
// python (test-double runtime: drives the real bridge + real SQLite in the worker)
r = await sh(`python -c "JSCALL _jvsqlite.open(\\"data/app.db\\")\nJSCALL _jvsqlite.script(1, \\"insert into t values (4, 'py')\\")\nJSCALL _jvsqlite.execute(1, \\"select count(*) from t\\", \\"\\")"`);
ok(/^1\n\{\}\n.*"rows":\[\[4\]\]/s.test(r.out), 'python bridge registered as _jvsqlite: ' + JSON.stringify(r));
r = await sh('sqlite3 data/app.db "select b from t where a=4"');
ok(r.out.trim() === 'py', 'python write flushed back to the vault: ' + JSON.stringify(r));
// editor must not touch database files
const before = await page.evaluate(() => Array.from(vfs.readBytes('/data/app.db')).join());
await page.evaluate(() => { try { openFile('/data/app.db'); } catch (e) { window.__openErr = e.message; } });
await page.waitForTimeout(1500);
const after = await page.evaluate(() => Array.from(vfs.readBytes('/data/app.db')).join());
ok(before === after, 'opening the .db in the file view does not corrupt it');
await page.screenshot({ path: OUT + '/1_open_db.png' });
// agent
await page.tap('.tab[data-tab="chat"]'); await page.waitForTimeout(200);
await page.fill('#input', 'how many rows in t?'); await page.tap('#btnSend');
await page.waitForFunction(() => !running && /The table has rows/.test(document.querySelector('#chat').textContent), null, { timeout: 30000 });
const toolOut = await page.evaluate(() => cur.messages.filter(m => m.role === 'tool').map(m => m.content));
ok(/"n":\s*4/.test(toolOut[0] || ''), 'agent queried SQLite through bash: ' + JSON.stringify(toolOut[0]));
ok(await page.evaluate(() => /SQLite 3\.53 is built in/.test(systemPrompt())), 'system prompt tells Jade about SQLite');
// backup + persistence
const bk = await page.evaluate(async () => { try { const b = await buildBackup(); return JSON.stringify(b).length; } catch (e) { return 'ERR ' + e.message; } });
ok(typeof bk === 'number', 'backup still builds with a .db in the vault: ' + bk);
await page.waitForTimeout(1500);
await page.reload(); await boot();
r = await sh('sqlite3 data/app.db "select count(*) from t"');
ok(r.out.trim() === '4', 'database survives a reload: ' + JSON.stringify(r));
await page.tap('.tab[data-tab="term"]'); await page.waitForTimeout(200);
await page.fill('#termCmd', 'sqlite3 -box data/app.db "select * from t"'); await page.press('#termCmd', 'Enter'); await page.waitForTimeout(1500);
ok(/node/.test(await page.evaluate(() => document.querySelector('#term').innerText)), 'works in the Shell tab');
await page.screenshot({ path: OUT + '/2_shell.png' });
console.log(log.join('\n')); console.log('\n' + (fail.length ? fail.join('\n') : 'ALL PASS'));
await browser.close();
