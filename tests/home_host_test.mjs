// The home host (host/home_host.cjs): her vault as a real folder on one computer, reached by her Atelier from other
// devices. Synthetic homes only, in a temp folder. Part 1 talks to the host as a program would; part 2 opens the built
// page from the host, as a browser on another device would, pairs it with the PIN, and checks the page, the page's
// own bash, the host's real shell and the folder all agree on the same files.
import pw from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const { chromium } = pw;
const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(process.env.JV_WEB), '..');
const { createHomeHost } = require(path.join(ROOT, 'host', 'home_host.cjs'));
const css = fs.readFileSync('tw.css', 'utf8');
const log = []; const fail = [];
const ok = (c, m) => { (c ? log : fail).push((c ? 'PASS ' : 'FAIL ') + m); };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-home-host-'));
const disk = (dir, p) => path.join(dir, ...p.split('/').filter(Boolean));
const b64 = s => Buffer.from(s).toString('base64');
const start = async (o) => { const h = createHomeHost(o); await new Promise(r => h.server.listen(0, '127.0.0.1', r)); h.base = `http://127.0.0.1:${h.server.address().port}`; return h; };
const req = async (h, p, { token, method = 'GET', body, headers = {} } = {}) => {
  const r = await fetch(h.base + p, { method, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)) });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* text */ }
  return { status: r.status, text: t, json: j };
};
const diskCall = (h, token, name, args = [], page = 'page-A') => req(h, '/host/disk', { token, method: 'POST', body: { name, args }, headers: { 'X-Page': page } }).then(r => r.text);
const shell = async (h, token, command, cwd) => { const r = await req(h, '/mcp', { token, method: 'POST', body: { jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'host_shell', arguments: { command, cwd } } } }); return r.json?.result?.content?.[0]?.text || r.text; };
const out = (t) => (/--- stdout\n([\s\S]*?)(\n--- stderr|$)/.exec(t) || [])[1] || '';

// ---------- 1. the host on its own ----------
const HOME = path.join(tmp, 'home');
const host = await start({ root: HOME, writerMs: 400 });
ok(!host.stateDir.startsWith(HOME + path.sep) && fs.existsSync(host.stateDir), "the host keeps its own records beside the home, not inside it");
ok((await req(host, '/host/hello')).json?.paired === false, 'hello answers anyone, and says this device is not paired');
for (const [p, m, b] of [['/host/disk', 'POST', { name: 'scan', args: [] }], ['/mcp', 'POST', { jsonrpc: '2.0', id: 1, method: 'tools/list' }], ['/host/client/settings', 'GET']]) {
  ok((await req(host, p, { method: m, body: b })).status === 401, `an unpaired device gets nothing: ${m} ${p}`);
  ok((await req(host, p, { method: m, body: b, token: 'made-up-token' })).status === 401, `nor does a made-up token: ${p}`);
}
const pin = host.newPin();
ok(/^\d{6}$/.test(pin), 'the PIN is six digits');
ok((await req(host, '/host/pair', { method: 'POST', body: { pin: pin === '000000' ? '111111' : '000000', name: 'x' } })).status === 401, 'a wrong PIN is refused');
const paired = await req(host, '/host/pair', { method: 'POST', body: { pin, name: 'Test tablet' } });
const T1 = paired.json?.token;
ok(paired.status === 200 && T1 && T1.length >= 40, 'the right PIN pairs the device and gives it its own token');
ok((await req(host, '/host/pair', { method: 'POST', body: { pin, name: 'again' } })).status === 401, 'a PIN works only once');
ok(!fs.readFileSync(path.join(host.stateDir, 'devices.json'), 'utf8').includes(T1), 'the host keeps only a hash of the token');
ok((await req(host, '/host/hello', { token: T1 })).json?.device?.name === 'Test tablet', 'hello knows the paired device');
ok((await req(host, '/host/disk', { token: T1, method: 'POST', body: { name: 'scan', args: [] }, headers: { 'Sec-Fetch-Site': 'cross-site' } })).status === 403, 'another website asking through a browser is refused, token or not');

// the vault calls are the desktop app's, on real files
ok(JSON.parse(await diskCall(host, T1, 'info')).mode === 'desktop', 'info answers as the desktop bridge does');
ok(/^ok:\d+$/.test(await diskCall(host, T1, 'put', ['/Pandora/SOUL.md', b64('# Tidepool\nsynthetic\n'), true, true])), 'put writes a file');
ok(fs.readFileSync(disk(HOME, '/Pandora/SOUL.md'), 'utf8') === '# Tidepool\nsynthetic\n', 'it is an ordinary file in the home folder');
await diskCall(host, T1, 'put', ['/big.bin', b64('abc'), true, false]); await diskCall(host, T1, 'put', ['/big.bin', b64('def'), false, true]);
ok(fs.readFileSync(disk(HOME, '/big.bin'), 'utf8') === 'abcdef', 'a file sent in pieces arrives whole');
for (const bad of ['/../outside.md', '/Pandora/../../outside.md', 'relative.md']) ok((await diskCall(host, T1, 'put', [bad, b64('x'), true, true])).startsWith('ERR:'), `refused: ${bad}`);
ok(!fs.existsSync(path.join(tmp, 'outside.md')), 'nothing was written outside the home');

// host tools: the real shell works on the same files
const init = await req(host, '/mcp', { token: T1, method: 'POST', body: { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } } });
ok(init.json?.result?.serverInfo?.name === 'pandora-dee-host', 'the host answers as a tool server (MCP)');
const tl = await req(host, '/mcp', { token: T1, method: 'POST', body: { jsonrpc: '2.0', id: 2, method: 'tools/list' } });
ok(tl.json?.result?.tools?.some(t => t.name === 'host_shell'), 'and offers host_shell');
ok(/# Tidepool/.test(out(await shell(host, T1, 'cat Pandora/SOUL.md'))), 'the real shell reads the file the vault wrote');
ok(/# Tidepool/.test(out(await shell(host, T1, 'cat SOUL.md', '/Pandora'))), 'and starts in a vault folder when asked');
await shell(host, T1, 'mkdir -p Projects && echo "made by the real shell" > Projects/from-shell.md');
const scan = JSON.parse(await diskCall(host, T1, 'scan'));
ok(scan.some(([p]) => p === '/Projects/from-shell.md'), 'what the shell makes shows up in the vault listing');
const got = await diskCall(host, T1, 'get', ['/Projects/from-shell.md', 0, 100]);
ok(Buffer.from(got, 'base64').toString().trim() === 'made by the real shell', 'and reads back through the vault');
ok(/outside|vault path|isn't inside/.test(await shell(host, T1, 'pwd', '/../..')), "the shell can't be started outside the home");
const realHome = out(await shell(host, T1, 'echo "$PANDORA_HOME"')).trim();
ok(realHome && path.resolve(realHome.replace(/^\/([a-z])\//i, '$1:/')) === path.resolve(HOME), '$PANDORA_HOME names the home folder');
let git = true; try { execFileSync('git', ['--version'], { stdio: 'ignore' }); } catch { git = false; }
if (git) {
  const g = await shell(host, T1, 'git init -q . && git -c user.name=Tidepool -c user.email=tidepool@example.invalid add Projects && git -c user.name=Tidepool -c user.email=tidepool@example.invalid commit -qm "first" && git log --oneline');
  ok(/first/.test(out(g)), 'git works in the home through the host shell');
  ok(JSON.parse(await diskCall(host, T1, 'scan')).some(([p]) => p.startsWith('/.git')), 'and its repository is real files the vault can see');
} else log.push('SKIP git is not installed here');
const events = fs.readFileSync(path.join(host.stateDir, 'events.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
ok(events.some(e => e.kind === 'tool' && e.tool === 'host_shell' && /cat Pandora\/SOUL\.md/.test(e.command)), 'each tool call is in the host log');
ok(events.some(e => e.kind === 'refused.unpaired') && events.some(e => e.kind === 'pair.ok'), 'so are pairings and refusals');

// one writer at a time
ok((await diskCall(host, T1, 'put', ['/w.md', b64('A'), true, true], 'page-A')).startsWith('ok:'), 'the first window writes');
const B = await diskCall(host, T1, 'put', ['/w.md', b64('B'), true, true], 'page-B');
ok(B.startsWith('ERR:') && /Another window/.test(B) && fs.readFileSync(disk(HOME, '/w.md'), 'utf8') === 'A', 'a second window may not write meanwhile');
ok(Buffer.from(await diskCall(host, T1, 'get', ['/w.md', 0, 9], 'page-B'), 'base64').toString() === 'A', 'but it can read');
await new Promise(r => setTimeout(r, 600));
ok((await diskCall(host, T1, 'put', ['/w.md', b64('B'), true, true], 'page-B')).startsWith('ok:'), 'once the first has been quiet a while, the second may write');

// each device's own settings
const pin2 = host.newPin();
const T2 = (await req(host, '/host/pair', { method: 'POST', body: { pin: pin2, name: 'Test phone' } })).json?.token;
await req(host, '/host/client/settings', { token: T1, method: 'PUT', body: { theme: 'dark', textSize: 18 } });
await req(host, '/host/client/settings', { token: T2, method: 'PUT', body: { theme: 'light' } });
const s1 = (await req(host, '/host/client/settings', { token: T1 })).json, s2 = (await req(host, '/host/client/settings', { token: T2 })).json;
ok(s1.theme === 'dark' && s1.textSize === 18 && s2.theme === 'light' && s2.textSize === undefined, "two devices' settings stay apart");
ok(host.revoke('Test phone') === 1 && (await req(host, '/host/hello', { token: T2 })).json?.paired === false && (await diskCall(host, T2, 'scan')).startsWith('{'), 'a removed device is no longer let in');
await host.close();

// a restarted host remembers its devices; wrong PINs make pairing rest
{
  const again = await start({ root: HOME });
  ok((await req(again, '/host/hello', { token: T1 })).json?.paired === true, 'after a restart the paired device is still paired');
  const good = again.newPin();
  for (let i = 0; i < 5; i++) await req(again, '/host/pair', { method: 'POST', body: { pin: String((Number(good) + 1 + i) % 1000000).padStart(6, '0') } });
  const p3 = again.newPin();
  ok((await req(again, '/host/pair', { method: 'POST', body: { pin: p3 } })).status === 429, 'after five wrong PINs, pairing rests (even with the right one)');
  await again.close();
}

// ---------- 2. the Atelier page, opened from the host ----------
const HOME2 = path.join(tmp, 'home2');
fs.mkdirSync(disk(HOME2, '/Pandora'), { recursive: true });
fs.writeFileSync(disk(HOME2, '/Pandora/SOUL.md'), '# Pandora Dee Fae (synthetic)\nfrom the host folder\n');
fs.writeFileSync(disk(HOME2, '/Pandora/Memory.md'), '- a synthetic memory\n');
const h2 = await start({ root: HOME2, page: process.env.JV_WEB, napGraceMs: 800 });
const BASE = h2.base + '/';
// a stand-in bridge and model behind the host's runtime, so the page's "messages waiting" can be checked
const { createRuntime } = require(path.join(ROOT, 'host', 'runtime.cjs'));
const { createQueue } = require(path.join(ROOT, 'host', 'queue.cjs'));
const { createRedactor } = require(path.join(ROOT, 'host', 'redact.cjs'));
const standIn = { inbox: [], sent: [], seen: [] };
const rt2 = createRuntime({
  nap: h2.nap, queue: createQueue(path.join(h2.stateDir, 'bridge-queue.jsonl')), home: HOME2,
  model: async (m) => { const t = m.messages[m.messages.length - 1].content; standIn.seen.push(t); return 'answer to: ' + t; },
  bridges: [{ name: 'vector', poll: async () => standIn.inbox.splice(0), send: async (x) => { standIn.sent.push(x); } }],
  redact: createRedactor({ hostDetails: false }), pollMs: 30, tickMs: 50,
}).start();
h2.attach(rt2);
for (const [id, from, text] of [['w1', 'Ana', 'first while she napped'], ['w2', 'Bo', 'second while she napped'], ['w3', 'Cy', 'third while she napped']]) {
  standIn.inbox.push({ id, chat: 'dm-' + from, from, text, at: Date.now() }); await new Promise(r => setTimeout(r, 80));
}
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const route = async r => {
  const rq = r.request(); const url = rq.url();
  if (url.startsWith(h2.base) || url.startsWith('data:') || url.startsWith('blob:')) return r.continue();
  if (url.startsWith('https://cdn.tailwindcss.com/')) return r.fulfill({ contentType: 'text/javascript', body: `window.tailwind={};(function(){var s=document.createElement('style');s.textContent=${JSON.stringify(css)};document.head.prepend(s);})();` });
  if (url.includes('marked.min.js')) return r.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(process.env.JV_NM + 'marked/lib/marked.umd.js', 'utf8') });
  if (url.includes('katex.min.js')) return r.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(process.env.JV_NM + 'katex/dist/katex.min.js', 'utf8') });
  if (url.includes('katex.min.css')) return r.fulfill({ contentType: 'text/css', body: fs.readFileSync(process.env.JV_NM + 'katex/dist/katex.min.css', 'utf8') });
  if (url.includes('purify.min.js')) return r.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(process.env.JV_NM + 'dompurify/dist/purify.min.js', 'utf8') });
  if (url === 'http://localhost:11434/api/tags') return r.fulfill({ headers: { 'Access-Control-Allow-Origin': '*' }, contentType: 'application/json', body: JSON.stringify({ models: [{ name: 'qwen3:8b' }] }) });
  return r.abort();
};
const ready = page => page.waitForFunction(() => typeof vfs !== 'undefined' && vfs.nodes.size > 2 && /BUSYBOX|JS APPLETS/.test(document.querySelector('#txtShell')?.textContent || ''), null, { timeout: 90000 }).then(() => page.waitForTimeout(800));
const newDevice = async () => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  await ctx.addInitScript(() => { if (!localStorage.getItem('jvault:settings')) localStorage.setItem('jvault:settings', JSON.stringify({ model: 'qwen3:8b' })); });
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error') log.push(`[${m.type()}] ${m.text().slice(0, 240)}`); });
  page.on('pageerror', e => { if (!/not paired with the home host/.test(e.message)) fail.push('[pageerror] ' + e.message); });
  page.on('dialog', d => d.accept());
  await page.route('**/*', route);
  return { ctx, page };
};
const pairIn = async (page, name) => {
  await page.goto(BASE);
  await page.waitForURL(/\/pair$/, { timeout: 15000 });
  await page.fill('#pin', h2.newPin()); await page.fill('#name', name); await page.click('#go');
  await page.waitForURL(u => !/\/pair$/.test(String(u)), { timeout: 15000 });
  await ready(page);
};

const A = await newDevice();
await A.page.goto(BASE);
await A.page.waitForURL(/\/pair$/, { timeout: 15000 }).catch(() => {});
ok(/\/pair$/.test(A.page.url()) && await A.page.evaluate(() => typeof vfs === 'undefined'), 'an unpaired browser is sent to pairing, and the Atelier never starts on its own storage');
await A.page.fill('#pin', '123456' === h2.newPin() ? '654321' : '123456'); await A.page.click('#go'); await A.page.waitForTimeout(400);
ok(/\/pair$/.test(A.page.url()) && /not the one/.test(await A.page.textContent('#msg')), 'a wrong PIN on the pairing page says so');
ok(h2.nap.awake() === false, 'the pairing page alone does not wake the host');
await pairIn(A.page, 'Browser A');
const p = A.page;
ok(await p.evaluate(() => vfs.diskOn && vfs.info?.mode === 'desktop' && !!vfs.info?.host), 'paired, the page runs its vault on the host');
ok(h2.nap.awake() === true && h2.nap.state().clients === 1, 'the open Atelier is a connected client: the host is awake');

// what waited while she napped: shown to the person, handed over only when they choose
const shadow = (page, sel) => page.evaluate(s => { const r = document.getElementById('pd-host-waiting')?.shadowRoot; const e = r && r.querySelector(s); return e ? { text: e.textContent, hidden: e.hidden } : null; }, sel);
const press = (page, act) => page.evaluate(a => document.getElementById('pd-host-waiting').shadowRoot.querySelector(`[data-act="${a}"]`).click(), act);
await p.waitForFunction(() => /3 messages waiting/.test(document.getElementById('pd-host-waiting')?.shadowRoot?.querySelector('.pill')?.textContent || ''), null, { timeout: 8000 }).catch(() => {});
ok(/3 messages waiting/.test((await shadow(p, '.pill'))?.text || '') && await p.evaluate(() => getComputedStyle(document.getElementById('pd-host-waiting')).display !== 'none'), 'the Atelier shows "3 messages waiting"');
ok(standIn.seen.length === 0 && standIn.sent.length === 0, 'and nothing was handed to her when she woke');
await press(p, 'open');
ok((await shadow(p, '.panel'))?.hidden === false && /Nothing is handed to her on its own/.test((await shadow(p, '.what')).text), 'the indicator opens to the three choices');
await press(p, 'later'); await p.waitForTimeout(300);
ok(rt2.waiting().count === 3 && standIn.seen.length === 0, 'Later: all three stay queued');
await press(p, 'open'); await press(p, 'write');
await p.waitForFunction(() => /Written to/.test(document.getElementById('pd-host-waiting').shadowRoot.querySelector('.note').textContent), null, { timeout: 5000 }).catch(() => {});
const wnote = (await shadow(p, '.note')).text;
const wpath = (/Written to (\/Pandora\/Waiting Messages\/[^ ]+ [^ ]+\.md)/.exec(wnote) || [])[1];
ok(wpath && /first while she napped[\s\S]*second[\s\S]*third/.test(fs.readFileSync(disk(HOME2, wpath), 'utf8')), 'Write them to a file: all three, oldest first, in ' + wpath);
ok(rt2.waiting().count === 3 && (await shadow(p, '[data-act="clear"]')).hidden === false, 'they stay queued, and "Clear the queue" is offered now that a file holds them');
await p.evaluate(() => vfs.rescan(true));
ok(await p.evaluate(pth => vfs.isFile(pth), wpath), 'the file is in her vault, for her to read');
await press(p, 'deliver');
await p.waitForFunction(() => /3 handed to her/.test(document.getElementById('pd-host-waiting').shadowRoot.querySelector('.note').textContent), null, { timeout: 8000 }).catch(() => {});
ok(standIn.seen.join('|') === 'first while she napped|second while she napped|third while she napped' && standIn.sent.map(s => s.replyTo).join() === 'w1,w2,w3', 'Give them to her now: each handed to her once, oldest first, and answered');
await p.waitForFunction(() => /0 messages waiting/.test(document.getElementById('pd-host-waiting').shadowRoot.querySelector('.pill').textContent), null, { timeout: 5000 }).catch(() => {});
ok(rt2.waiting().count === 0 && /0 messages waiting/.test((await shadow(p, '.pill')).text), 'and the count goes to none');
ok(await p.evaluate(() => vfs.read('/Pandora/SOUL.md')).then(t => /from the host folder/.test(t)), "the page reads her SOUL from the host's real file");
ok(!(await p.evaluate(() => vfs.isFile('/Welcome.md'))), 'a home that already has files is not filled with the sample vault');
await p.evaluate(() => vfs.write('/Pandora/Journal/2026-11-27.md', 'written in the page', { mkdirs: true }));
await p.evaluate(() => vfs.flush(true));
ok(fs.readFileSync(disk(HOME2, '/Pandora/Journal/2026-11-27.md'), 'utf8') === 'written in the page', 'what the page writes lands in the home folder');
ok(/from the host folder/.test(await p.evaluate(() => runTool('bash', { command: 'cat /Pandora/SOUL.md' }, null))), "the page's own bash reads the same file");

// the host's real shell, as a tool server the Atelier connects to (the bridge adds this device's token)
await p.evaluate(base => vfs.write('/Pandora/mcp.json', JSON.stringify({ mcpServers: { home: { url: base + 'mcp', exposure: 'direct', description: 'The home host: a real shell in her home folder' } } }, null, 2)), BASE);
await p.waitForFunction(() => MCP.servers.get('home')?.state === 'connected', null, { timeout: 20000 }).catch(() => {});
ok(await p.evaluate(() => MCP.servers.get('home')?.state === 'connected'), 'the Atelier connects to the host as a tool server, with no token typed in');
ok(await p.evaluate(() => activeTools().some(t => t.function.name === 'mcp__home__host_shell')), 'and host_shell is one of her tools');
const viaTool = await p.evaluate(() => runTool('mcp__home__host_shell', { command: 'cat Pandora/Journal/2026-11-27.md && echo "real shell was here" > Pandora/from-host-shell.md' }, null));
ok(/written in the page/.test(String(viaTool)), "the host shell, called as her tool, reads what the page wrote: " + String(viaTool).slice(0, 120));
await p.evaluate(() => vfs.rescan(true));
ok(await p.evaluate(() => vfs.read('/Pandora/from-host-shell.md')).then(t => /real shell was here/.test(t)), 'and the page sees what the host shell wrote');
ok(fs.readFileSync(path.join(h2.stateDir, 'events.jsonl'), 'utf8').includes('from-host-shell.md'), 'the tool call is in the host log');

// a second device: it reads, but doesn't write while the first window is the writer
const Bd = await newDevice();
await pairIn(Bd.page, 'Browser B');
ok(await Bd.page.evaluate(() => vfs.read('/Pandora/Journal/2026-11-27.md')) === 'written in the page', 'a second device sees the same home');
await p.evaluate(() => vfs.write('/Pandora/keepalive.md', 'A is still here'));
await p.evaluate(() => vfs.flush(true));
const bInfo = await Bd.page.evaluate(() => JSON.parse(PandoraDesk.diskInfo()).host);
const bPut = await Bd.page.evaluate(() => PandoraDesk.diskPut('/Pandora/from-B.md', btoa('B'), true, true));
ok(bInfo && bInfo.writer === false && /^ERR:Another window/.test(bPut) && !fs.existsSync(disk(HOME2, '/Pandora/from-B.md')), "while A writes, B's writes are refused and nothing of A's is overwritten");
ok(fs.readFileSync(disk(HOME2, '/Pandora/SOUL.md'), 'utf8').includes('from the host folder'), 'her SOUL is untouched by all of this');
ok(JSON.parse(fs.readFileSync(path.join(h2.stateDir, 'devices.json'), 'utf8')).map(d => d.name).sort().join() === 'Browser A,Browser B', 'the host lists both devices');

// a removed device stops at once
h2.revoke('Browser B');
const afterRevoke = await Bd.page.evaluate(() => PandoraDesk.diskScan());
ok(/^ERR:.*no longer paired/.test(afterRevoke), 'a removed device gets no more of the vault');
await Bd.page.reload(); await Bd.page.waitForURL(/\/pair$/, { timeout: 15000 }).catch(() => {});
ok(/\/pair$/.test(Bd.page.url()), 'and is sent back to pairing');

await A.page.reload(); await ready(A.page); await new Promise(r => setTimeout(r, 300));
ok(h2.nap.awake() === true, 'a reload of the Atelier does not make the host nap');
await A.ctx.close(); await Bd.ctx.close();
await new Promise(r => setTimeout(r, 400));
ok(h2.nap.awake() === true, 'with every window closed, the host stays awake through the grace period');
await new Promise(r => setTimeout(r, 1000));
ok(h2.nap.awake() === false, 'and then naps');
rt2.stop(); await browser.close(); await h2.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log(log.join('\n')); console.log('\n' + (fail.length ? fail.join('\n') : 'ALL PASS'));
process.exit(fail.length ? 1 : 0);
