// Residents in their own processes and services (host/separate.cjs, host/services.cjs, host/resident_main.cjs).
// The front keeps the PIN, the list and the routes; each resident runs on her own, at her own port, and the two
// reach each other over this machine only, with her key. A resident as her own service waits for the person's yes on
// the host, and her install and remove steps are written for them to run as admin (nothing here installs a service:
// the test plays the computer's part by starting her process itself). Synthetic homes only, in a temp folder.
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(process.env.JV_WEB), '..');
const { createHomeHost } = require(path.join(ROOT, 'host', 'home_host.cjs'));
const services = require(path.join(ROOT, 'host', 'services.cjs'));
const log = []; const fail = [];
const ok = (c, m) => { (c ? log : fail).push((c ? 'PASS ' : 'FAIL ') + m); };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-services-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// (after a host restarts, fetch may first try a kept-alive connection the old one closed: once more, then)
const call = async (base, p, o = {}) => { const r = await call1(base, p, o); return r.status === 0 ? (await sleep(150), call1(base, p, o)) : r; };
const call1 = async (base, p, { token, method = 'GET', body, headers = {} } = {}) => {
  try {
    const r = await fetch(base + p, { method, redirect: 'manual', headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* text */ }
    return { status: r.status, text: t, json: j };
  } catch { return { status: 0, text: '', json: null }; }
};
const until = async (f, ms = 15000) => { const end = Date.now() + ms; for (;;) { const v = await f(); if (v) return v; if (Date.now() > end) return null; await sleep(250); } };
const free = (port) => new Promise((ok2) => { const s = net.createServer(); s.once('error', () => ok2(false)); s.listen(port, '127.0.0.1', () => s.close(() => ok2(true))); });
async function freeRun(n) { for (;;) { const p = 20000 + Math.floor(Math.random() * 20000); let all = true; for (let i = 0; i < n; i++) if (!(await free(p + i))) { all = false; break; } if (all) return p; } }
const b64 = (s) => Buffer.from(s).toString('base64');
const disk = (base, token, name, args) => call(base, '/host/disk', { token, method: 'POST', body: { name, args }, headers: { 'X-Page': 'page-1' } }).then((r) => r.text);

const FAE = path.join(tmp, 'fae-home'), HOMES = path.join(tmp, 'homes'), FAE_STATE = path.join(tmp, 'fae-state');
fs.mkdirSync(path.join(FAE, 'Pandora'), { recursive: true }); fs.writeFileSync(path.join(FAE, 'Pandora', 'SOUL.md'), '# SOUL\n\nmade-up Fae stand-in\n');
const P = await freeRun(4);
const make = (run) => createHomeHost({ root: FAE, state: FAE_STATE, id: 'fae', name: 'Fae (test)', homes: HOMES, port: P, run, page: process.env.JV_WEB, napGraceMs: 0, writerMs: 300 });
const base = `http://127.0.0.1:${P}`;
const listen = (h) => new Promise((r) => h.server.listen(P, '127.0.0.1', r));
const kids = [];

let host = make('process');
await listen(host);
try {
  // ---------- a fresh client: a new resident in her own process ----------
  let r = await call(base, '/host/residents', { method: 'POST', body: { pin: host.newPin(), id: 'noe', name: 'Noe (test)', device: 'Noe app' } });
  const noeTok = r.json?.token;
  const noe = host.resident('noe');
  ok(r.status === 200 && noeTok && r.json.resident.run === 'process', 'a fresh client makes a resident who runs in her own process, and comes back paired with her');
  ok(noe.remote && noe.pid && noe.pid !== process.pid, 'she is her own process, not the host\'s');
  r = await call(`http://127.0.0.1:${P + 1}`, '/host/hello');
  ok(r.status === 200 && r.json.resident.id === 'noe', 'her own process answers at her own port');
  r = await call(base + '/r/noe', '/host/status', { token: noeTok });
  ok(r.status === 200 && r.json.resident.id === 'noe', 'app clients reach her through the host at /r/noe/, as before');
  r = await call(base, '/host/status', { token: noeTok });
  ok(r.status === 401, 'her device\'s key opens nothing of Fae\'s');

  // ---------- the PIN stays the host's ----------
  r = await call(base + '/r/noe', '/host/pair', { method: 'POST', body: { pin: '000000', name: 'wrong' } });
  ok(r.status === 401, 'a wrong PIN, through her: refused by the host');
  r = await call(`http://127.0.0.1:${P + 1}`, '/host/pair', { method: 'POST', body: { pin: host.newPin(), name: 'Noe tablet' } });
  const noeTok2 = r.json?.token;
  ok(r.status === 200 && noeTok2, 'the PIN the host shows pairs a device at her own port too (she asks the host)');
  r = await call(base + '/r/noe', '/host/status', { token: noeTok2 });
  ok(r.status === 200, 'and that device reaches her');

  // ---------- between the front and her: this machine and her key only ----------
  r = await call(base, '/host/front/pin', { method: 'POST', body: { id: 'noe', code: '123456' }, headers: { 'X-Pdee-Front': 'not-her-key' } });
  ok(r.status === 403, 'asking the host about a PIN without her key: refused');
  const key = fs.readFileSync(path.join(FAE_STATE, 'residents', 'noe.key'), 'utf8').trim();
  r = await call(base, '/host/front/pin', { method: 'POST', body: { id: 'noe', code: '123456' }, headers: { 'X-Pdee-Front': key, 'X-Forwarded-For': '192.168.1.9' } });
  ok(r.status === 403, 'nor through a proxy, even with her key');
  r = await call(`http://127.0.0.1:${P + 1}`, '/host/front/pair', { method: 'POST', body: { name: 'sneaky' } });
  ok(r.status === 403, 'her process makes a device only when the host asks, with her key');
  ok(fs.readFileSync(path.join(noe.stateDir, 'front.key'), 'utf8').trim() === key, 'her key is in her state folder and the host\'s');
  const reg = fs.readFileSync(path.join(FAE_STATE, 'residents.json'), 'utf8');
  const logs = fs.readFileSync(path.join(FAE_STATE, 'events.jsonl'), 'utf8') + fs.readFileSync(path.join(noe.stateDir, 'events.jsonl'), 'utf8');
  ok(!reg.includes(key) && !logs.includes(key), 'and never in the residents list or anyone\'s log');

  // ---------- her disk is hers ----------
  const put = await disk(base + '/r/noe', noeTok, 'put', ['/hello.md', b64('from noe'), true, true]);
  ok(!put.startsWith('ERR') && fs.readFileSync(path.join(noe.root, 'hello.md'), 'utf8') === 'from noe' && !fs.existsSync(path.join(FAE, 'hello.md')), 'what she writes lands in her home only');
  r = await call(base + '/r/noe', '/host/settings', { token: noeTok, method: 'PATCH', body: { nap: { graceSec: 30 } } });
  ok(r.status === 200, 'a settings change from this machine, through the host, still counts as from this machine');

  // ---------- when her process stops ----------
  process.kill(noe.pid);
  await sleep(200);
  r = await call(base + '/r/noe', '/host/status', { token: noeTok });
  ok((r.status === 502 && /isn't running/.test(r.text)) || r.status === 200, 'while she is down the host says so plainly (no error text from inside)');
  r = await until(async () => { const x = await call(base + '/r/noe', '/host/status', { token: noeTok }); return x.status === 200 && x; });
  ok(!!r, 'and the host starts her again');

  // ---------- moving her ----------
  await host.setRun('noe', 'inside');
  ok(!host.resident('noe').remote, 'the person can move her into the host\'s own process');
  const inside = host.serverFor('noe'); await new Promise((ok2) => inside.listen(P + 1, '127.0.0.1', ok2));
  r = await call(base + '/r/noe', '/host/status', { token: noeTok });
  ok(r.status === 200 && fs.readFileSync(path.join(host.resident('noe').root, 'hello.md'), 'utf8') === 'from noe', 'with the same devices and things');
  await host.setRun('noe', 'process');
  r = await until(async () => { const x = await call(base + '/r/noe', '/host/status', { token: noeTok }); return x.status === 200 && x; });
  ok(!!r && host.resident('noe').remote, 'and back into her own process');

  // ---------- after a restart ----------
  await host.close();
  host = make('process'); await listen(host);
  r = await until(async () => { const x = await call(base + '/r/noe', '/host/status', { token: noeTok }); return x.status === 200 && x; });
  ok(!!r, 'after the host restarts, she runs in her own process again, with her devices');
  await host.close();

  // ---------- as her own service: the person says yes on the host ----------
  host = make('service'); await listen(host);
  r = await call(base, '/host/residents', { method: 'POST', body: { pin: '000000', id: 'ann', name: 'Ann (test)', device: 'Ann app' } });
  ok(r.status === 401 && !host.waiting().length, 'without the PIN, nobody is even asked');
  r = await call(base, '/host/residents', { method: 'POST', body: { pin: host.newPin(), id: 'ann', name: 'Ann (test)', device: 'Ann app' } });
  const ticket = r.json?.ticket;
  ok(r.status === 202 && ticket && !host.resident('ann') && host.waiting().some((w) => w.id === 'ann'), 'with it, a resident as her own service waits for the person\'s yes on the host');
  r = await call(base, '/host/residents/wait?ticket=' + ticket);
  ok(r.status === 202, 'the client is told it is still waiting');
  r = await call(base, '/host/residents/wait?ticket=nope');
  ok(r.status === 404, 'and nobody gets anywhere with a made-up ticket');
  const ann = host.approve('ann');
  const plan = host.servicePlan('ann');
  ok(ann.remote && ann.run === 'service' && ann.hostShell, 'yes: she is made, set to run as her own service, with host_shell (her shell is walled off)');
  const files = fs.readdirSync(plan.dir);
  ok(files.includes(plan.install) && files.includes(plan.remove), 'her install and remove steps are written for the person to run');
  if (process.platform === 'win32') {
    const inst = fs.readFileSync(plan.installFile, 'utf8');
    ok(inst.includes('obj= "NT SERVICE\\pdee-ann"') && inst.includes('/inheritance:r') && inst.includes(ann.root) && inst.includes('*S-1-5-32-544'), 'on Windows: her own service identity, and her home hers alone');
    ok(!/https?:\/\//.test(inst) && inst.includes('csc.exe'), 'its service program is built here, with nothing downloaded');
  }
  r = await call(base, '/host/residents/wait?ticket=' + ticket);
  ok(r.status === 202 && /service/.test(r.json?.waiting || ''), 'until her service runs, the client waits');
  // the computer's part: start her process the way her service would
  const kid = spawn(process.execPath, [services.MAIN, '--config', path.join(ann.stateDir, 'resident.json'), '--stdin-stop'], { stdio: ['pipe', 'ignore', 'ignore'] });
  kids.push(kid);
  r = await until(async () => { const x = await call(base, '/host/residents/wait?ticket=' + ticket); return x.status === 200 && x; });
  const annTok = r && r.json.token;
  ok(!!annTok && r.json.resident.id === 'ann', 'once she runs, the client that asked is paired with her');
  r = await call(base, '/host/residents/wait?ticket=' + ticket);
  ok(r.status === 404, 'and the ticket is used up');
  r = await call(base + '/r/ann', '/host/status', { token: annTok });
  ok(r.status === 200 && r.json.resident.id === 'ann', 'she is reached through the host like anyone');
  r = await call(base, '/host/residents', { method: 'POST', body: { pin: host.newPin(), id: 'bo', name: 'Bo (test)', device: 'Bo app' } });
  const t2 = r.json?.ticket; host.decline('bo');
  r = await call(base, '/host/residents/wait?ticket=' + t2);
  ok(r.status === 410 && !host.resident('bo'), 'and when the person says no, the client is told, and nobody is made');
  kid.stdin.end(); await new Promise((ok2) => kid.once('exit', ok2));
  ok(true, 'her process stops when asked, after finishing');

  // ---------- the steps on each system ----------
  const entry = { id: 'a-rather-long-resident-name-for-a-test', name: 'Long', root: '/srv/homes/long', state: '/srv/homes/long (host)' };
  const lin = services.plan({ entry, configFile: '/srv/homes/long (host)/resident.json', platform: 'linux', node: '/usr/bin/node' });
  const li = lin.files['install.sh'];
  ok(lin.identity.length <= 32 && li.includes('useradd --system') && li.includes(`User=${lin.identity}`) && li.includes('/usr/sbin/nologin') && li.includes('start-stop-daemon'), 'Linux: her own system user, no login; systemd, or init.d without it');
  ok(lin.files['remove.sh'].includes('userdel') && lin.files['remove.sh'].includes('SUDO_USER'), 'and remove gives her folders back');
  const mac = services.plan({ entry, configFile: '/srv/x.json', platform: 'darwin', node: '/usr/local/bin/node', dir: '/tmp/p' });
  ok(mac.files['install.sh'].includes('IsHidden 1') && Object.values(mac.files).some((f) => f.includes(`<key>UserName</key><string>${mac.identity}</string>`)) && mac.identity.startsWith('_pdee_'), 'macOS: a hidden service user like _www, and a LaunchDaemon run as her');
  const win = services.plan({ entry: { ...entry, root: 'C:\\homes\\100%', state: 'C:\\homes\\100% (host)' }, configFile: 'C:\\x.json', platform: 'win32', node: 'C:\\node\\node.exe', dir: 'C:\\plan' });
  ok(win.files['install.cmd'].includes('100%%') && !win.files['install.cmd'].includes('100% '), 'Windows steps keep odd folder names intact');

  // ---------- the service program builds here (Windows) ----------
  const csc = ['Framework64', 'Framework'].flatMap((f) => ['v4.0.30319', 'v3.5', 'v2.0.50727'].map((v) => path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', f, v, 'csc.exe'))).find((f) => fs.existsSync(f));
  if (process.platform === 'win32' && csc) {
    const out = path.join(tmp, 'pdee-service.exe');
    try { execFileSync(csc, ['/nologo', '/target:exe', `/out:${out}`, '/r:System.ServiceProcess.dll', path.join(ROOT, 'host', 'service', 'pdee-service.cs')], { stdio: 'pipe' }); } catch (e) { fail.push('FAIL csc: ' + String(e.stdout || e.message)); }
    ok(fs.existsSync(out), 'the Windows service program compiles with the .NET compiler Windows already has');
  }
} catch (e) {
  fail.push('FAIL threw: ' + (e && e.stack || e));
} finally {
  for (const k of kids) { try { k.kill(); } catch {} }
  await host.close();
  await sleep(300);
  fs.rmSync(tmp, { recursive: true, force: true });
}
for (const l of [...log, ...fail]) console.log(l);
console.log(fail.length ? `${fail.length} FAILED of ${log.length + fail.length}` : `ALL PASS (${log.length})`);
process.exit(fail.length ? 1 : 0);
