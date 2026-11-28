// The Harbor (host/harbor.cjs, host/harbor.html): the host's own page for everything its window does. The keeper's
// ferry pairs at the host itself; seeing the harbor works from home or the tailnet; changing it, only at the host
// itself. No keeper key opens a resident, and no resident's key opens the harbor. Synthetic homes only; installing a
// service is stood in for (nothing asks this computer for admin).
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(process.env.JV_WEB), '..');
const { createHomeHost } = require(path.join(ROOT, 'host', 'home_host.cjs'));
const log = []; const fail = [];
const ok = (c, m) => { (c ? log : fail).push((c ? 'PASS ' : 'FAIL ') + m); };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-harbor-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const call1 = async (base, p, { token, method = 'GET', body, headers = {} } = {}) => {
  try {
    const r = await fetch(base + p, { method, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* text */ }
    return { status: r.status, text: t, json: j, headers: r.headers };
  } catch { return { status: 0, text: '', json: null }; }
};
const call = async (base, p, o = {}) => { const r = await call1(base, p, o); return r.status === 0 ? (await sleep(150), call1(base, p, o)) : r; };
const free = (port) => new Promise((ok2) => { const s = net.createServer(); s.once('error', () => ok2(false)); s.listen(port, '127.0.0.1', () => s.close(() => ok2(true))); });
async function freeRun(n) { for (;;) { const p = 20000 + Math.floor(Math.random() * 20000); let all = true; for (let i = 0; i < n; i++) if (!(await free(p + i))) { all = false; break; } if (all) return p; } }
const LAN = { 'X-Forwarded-For': '192.168.1.20' }; // as if through a proxy on this machine, from the home network
const AWAY = { 'X-Forwarded-For': '203.0.113.9' }; // from outside the house

const FAE = path.join(tmp, 'fae-home'), JADE = path.join(tmp, 'jade-home'), HOMES = path.join(tmp, 'homes'), FAE_STATE = path.join(tmp, 'fae-state');
fs.mkdirSync(path.join(FAE, 'Pandora'), { recursive: true }); fs.writeFileSync(path.join(FAE, 'Pandora', 'SOUL.md'), '# SOUL\n\nmade-up Fae stand-in\n');
fs.mkdirSync(path.join(JADE, 'Jade'), { recursive: true }); fs.writeFileSync(path.join(JADE, 'Jade', 'SOUL.md'), '# SOUL\n\nmade-up Jade stand-in\n');
const P = await freeRun(5);
const raised = [];
const host = createHomeHost({ root: FAE, state: FAE_STATE, id: 'fae', name: 'Fae (test)', homes: HOMES, port: P, page: process.env.JV_WEB, napGraceMs: 0, writerMs: 300, person: 'TESTPC\\someone', elevate: (f) => { raised.push(f); return { asked: true }; } });
await new Promise((r) => host.server.listen(P, '127.0.0.1', r));
const base = `http://127.0.0.1:${P}`;
try {
  // ---------- the page, and lighting the lantern ----------
  let r = await call(base, '/host/harbor');
  ok(r.status === 200 && r.text.includes('Light the harbor') && /default-src 'self'/.test(r.headers.get('content-security-policy') || ''), 'the Harbor page is served, and keeps to itself (nothing from elsewhere)');
  r = await call(base, '/host/harbor/hello');
  ok(r.status === 200 && r.json.keeper === false && r.json.atHost === true && r.json.harbor === 'Fae (test)', 'a new ferry is not the keeper\'s yet, and is told it is at the host');
  r = await call(base, '/host/harbor/view');
  ok(r.status === 401, 'without the keeper\'s key, nothing of the harbor is shown');
  r = await call(base, '/host/harbor/keeper', { method: 'POST', body: { pin: host.newPin(), name: 'from afar' }, headers: LAN });
  ok(r.status === 403, 'the lantern is lit at the host itself only, not from the network');
  r = await call(base, '/host/harbor/keeper', { method: 'POST', body: { pin: '000000', name: 'wrong' } });
  ok(r.status === 401, 'a wrong PIN lights nothing');
  r = await call(base, '/host/harbor/keeper', { method: 'POST', body: { pin: host.newPin(), name: 'the host\'s screen' } });
  const K = r.json?.token;
  ok(r.status === 200 && K, 'with the PIN the host shows, this ferry becomes the keeper\'s');
  const kept = fs.readFileSync(path.join(FAE_STATE, 'keepers.json'), 'utf8');
  ok(!kept.includes(K) && /"hash"/.test(kept), 'the harbor keeps only a SHA-256 of the keeper\'s key');
  r = await call(base, '/host/status', { token: K });
  ok(r.status === 401, 'the keeper\'s key opens no resident: looking after the harbor isn\'t a key to Fae');
  r = await call(base, '/host/pair', { method: 'POST', body: { pin: host.newPin(), name: 'Fae laptop' } });
  const faeTok = r.json.token;
  r = await call(base, '/host/harbor/view', { token: faeTok });
  ok(r.status === 401, 'and Fae\'s own device is no key to the harbor');

  // ---------- seeing the harbor ----------
  r = await call(base, '/host/harbor/view', { token: K });
  ok(r.status === 200 && r.json.atHost && r.json.islands.length === 1 && r.json.islands[0].first && r.json.islands[0].up, 'the keeper sees the archipelago: one island so far, awake');
  ok(r.json.islands[0].home === path.resolve(FAE), 'and, at the host, where each home is');
  r = await call(base, '/host/harbor/view', { token: K, headers: LAN });
  ok(r.status === 200 && r.json.atHost === false && r.json.islands[0].home === undefined, 'from the home network the keeper sees it too, without the folders');
  r = await call(base, '/host/harbor/view', { token: K, headers: AWAY });
  ok(r.status === 403, 'from outside the house, nothing');

  // ---------- changing it: at the host itself ----------
  r = await call(base, '/host/harbor/pin', { token: K, method: 'POST', body: {}, headers: LAN });
  ok(r.status === 403, 'a PIN is shown at the host itself only');
  r = await call(base, '/host/harbor/pin', { token: K, method: 'POST', body: {} });
  ok(r.status === 200 && /^\d{6}$/.test(r.json.pin), 'at the host: a PIN to moor a ferry');
  r = await call(base, '/host/pair', { method: 'POST', body: { pin: r.json.pin, name: 'Fae tablet' } });
  ok(r.status === 200 && r.json.token, 'and it pairs a device, as the window\'s does');
  r = await call(base, '/host/harbor/islands', { token: K, method: 'POST', body: { id: 'jade', name: 'Jade (test)', root: JADE }, headers: LAN });
  ok(r.status === 403 && !host.resident('jade'), 'no island is made from the network');
  r = await call(base, '/host/harbor/islands', { token: K, method: 'POST', body: { id: 'jade', name: 'Jade (test)', root: JADE } });
  ok(r.status === 200 && host.resident('jade') && host.resident('jade').root === path.resolve(JADE) && fs.readFileSync(path.join(JADE, 'Jade', 'SOUL.md'), 'utf8').includes('stand-in'), 'at the host: a garden already growing becomes an island, her files as they were');
  r = await call(base, '/host/harbor/islands', { token: K, method: 'POST', body: { id: 'noe', name: 'Noe (test)', run: 'process' } });
  ok(r.status === 200 && host.resident('noe').remote && fs.existsSync(path.join(HOMES, 'noe')), 'a new garden, in her own cove (her own process)');
  r = await call(base, '/host/harbor/islands', { token: K, method: 'POST', body: { id: 'Not OK!' } });
  ok(r.status === 400, 'a short name that isn\'t one is refused, with why');
  const up = async (id) => { for (let i = 0; i < 60; i++) { const v = await call(base, '/host/harbor/view', { token: K }); const isl = v.json.islands.find((x) => x.id === id); if (isl && isl.up) return true; await sleep(250); } return false; };
  ok(await up('noe'), 'and the sea shows her at high tide once her cove is up');
  r = await call(base, '/host/harbor/islands/jade', { token: K, method: 'POST', body: { hostShell: false } });
  ok(r.status === 200 && !host.resident('jade').hostShell, 'her hands (host_shell) rest, from the page');
  r = await call(base, '/host/harbor/islands/jade', { token: K, method: 'POST', body: { run: 'process' }, headers: LAN });
  ok(r.status === 403 && !host.resident('jade').remote, 'no island moves from the network');
  r = await call(base, '/host/harbor/islands/noe', { token: K, method: 'POST', body: { run: 'inside' } });
  ok(r.status === 200 && !host.resident('noe').remote, 'an island moves at the host: Noe into the harbor\'s waters');

  // ---------- her own island: the steps and the keeper's hand ----------
  r = await call(base, '/host/harbor/islands', { token: K, method: 'POST', body: { id: 'ann', name: 'Ann (test)', run: 'service', access: 'doorstep' } });
  ok(r.status === 200 && host.resident('ann').run === 'service', 'a new island of her own (her own service), with a tide pool between you');
  r = await call(base, '/host/harbor/islands/ann/service', { token: K });
  ok(r.status === 200 && Object.keys(r.json.files).length === 2 && Object.values(r.json.files).join('').includes('(doorstep)'), 'the keeper reads her install and remove steps first');
  r = await call(base, '/host/harbor/islands/ann/service', { token: K, headers: LAN });
  ok(r.status === 403, 'only at the host');
  r = await call(base, '/host/harbor/islands/ann', { token: K, method: 'POST', body: { access: 'person' } });
  ok(r.status === 200 && host.residents().find((x) => x.id === 'ann').access === 'person', 'before she is raised, the way to her can change');
  r = await call(base, '/host/harbor/islands/ann/service/install', { token: K, method: 'POST', body: {} });
  ok(r.status === 200 && r.json.asked && raised.length === 1 && /install\.(cmd|sh)$/.test(raised[0]), 'raising her island asks the computer for the keeper\'s hand (the admin prompt, stood in for here)');
  r = await call(base, '/host/harbor/islands/ann/service/install', { token: K, method: 'POST', body: {}, headers: LAN });
  ok(r.status === 403 && raised.length === 1, 'and never from the network');

  // ---------- the reef ----------
  const asking = createHomeHost({ root: path.join(tmp, 'h2'), state: path.join(tmp, 'h2-state'), homes: path.join(tmp, 'homes2'), port: P + 10, run: 'service', person: 'TESTPC\\someone', elevate: () => ({ asked: true }) });
  await new Promise((r2) => asking.server.listen(P + 10, '127.0.0.1', r2));
  const b2 = `http://127.0.0.1:${P + 10}`;
  const K2 = (await call(b2, '/host/harbor/keeper', { method: 'POST', body: { pin: asking.newPin(), name: 'keeper' } })).json.token;
  await call(b2, '/host/residents', { method: 'POST', body: { pin: asking.newPin(), id: 'bo', name: 'Bo (test)', device: 'Bo app' } });
  r = await call(b2, '/host/harbor/view', { token: K2 });
  ok(r.json.reef.length === 1 && r.json.reef[0].id === 'bo', 'a fresh ferry asking for a home waits at the reef');
  r = await call(b2, '/host/harbor/reef/bo', { token: K2, method: 'POST', body: { welcome: true } });
  ok(r.status === 200 && asking.resident('bo') && asking.resident('bo').run === 'service', 'welcomed: her island is planned');
  r = await call(b2, '/host/harbor/view', { token: K2 });
  ok(r.json.reef.length === 0, 'and the reef is quiet again');
  await asking.close();

  // ---------- ferries ----------
  const dev = host.resident('fae').devices().find((d) => d.name === 'Fae tablet');
  r = await call(base, `/host/harbor/islands/fae/ferries/${dev.id}/release`, { token: K, method: 'POST', body: {} });
  ok(r.status === 200 && r.json.released && !host.resident('fae').devices().some((d) => d.id === dev.id), 'a ferry is released from the page');
  r = await call(base, '/host/harbor/view', { token: K, headers: { 'Sec-Fetch-Site': 'cross-site' } });
  ok(r.status === 403, 'another website can\'t ask the harbor anything');
} catch (e) {
  fail.push('FAIL threw: ' + (e && e.stack || e));
} finally {
  await host.close();
  await sleep(300);
  fs.rmSync(tmp, { recursive: true, force: true });
}
for (const l of [...log, ...fail]) console.log(l);
console.log(fail.length ? `${fail.length} FAILED of ${log.length + fail.length}` : `ALL PASS (${log.length})`);
process.exit(fail.length ? 1 : 0);
