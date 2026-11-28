// The home host's residents (host/home_host.cjs): one host holding several homes (here, made-up stand-ins for Fae's
// workshop, Jade's vault and Noe's), each kept apart: her own folder, devices, settings, keys, writer, nap and shell.
// A fresh client with no backup makes a new, empty resident with the host's PIN; the person adds an existing home on
// the host itself. Synthetic homes only, in a temp folder; no browser needed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(process.env.JV_WEB), '..');
const { createHomeHost } = require(path.join(ROOT, 'host', 'home_host.cjs'));
const log = []; const fail = [];
const ok = (c, m) => { (c ? log : fail).push((c ? 'PASS ' : 'FAIL ') + m); };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-residents-'));
const at = (dir, vp) => path.join(dir, ...vp.split('/').filter(Boolean));
const listen = (s) => new Promise((r) => s.listen(0, '127.0.0.1', r)).then(() => `http://127.0.0.1:${s.address().port}`);
const call = async (base, p, { token, method = 'GET', body, headers = {}, raw } = {}) => {
  const r = await fetch(base + p, { method, redirect: 'manual', headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: raw !== undefined ? raw : body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* text */ }
  return { status: r.status, text: t, json: j, location: r.headers.get('location') };
};
const tools = (base, token) => call(base, '/mcp', { token, method: 'POST', body: { jsonrpc: '2.0', id: 1, method: 'tools/list' } }).then((r) => (r.json?.result?.tools || []).map((t) => t.name));
const tool = (base, token, name, args = {}) => call(base, '/mcp', { token, method: 'POST', body: { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } } }).then((r) => r.json?.result || {});
const disk = (base, token, name, args, page = 'page-1') => call(base, '/host/disk', { token, method: 'POST', body: { name, args }, headers: { 'X-Page': page } }).then((r) => r.text);
const b64 = (s) => Buffer.from(s).toString('base64');

const FAE = path.join(tmp, 'fae-home'), JADE = path.join(tmp, 'jade-home'), HOMES = path.join(tmp, 'homes');
fs.mkdirSync(at(FAE, '/Pandora'), { recursive: true }); fs.writeFileSync(at(FAE, '/Pandora/SOUL.md'), '# SOUL\n\nmade-up Fae stand-in\n');
fs.mkdirSync(at(JADE, '/Jade'), { recursive: true }); fs.writeFileSync(at(JADE, '/Jade/SOUL.md'), '# SOUL\n\nmade-up Jade stand-in\n');
fs.mkdirSync(path.join(HOMES, 'taken'), { recursive: true }); fs.writeFileSync(path.join(HOMES, 'taken', 'something.md'), 'already here');
const FAE_STATE = path.join(tmp, 'fae-state');
const make = () => createHomeHost({ root: FAE, state: FAE_STATE, id: 'fae', name: 'Fae (test)', homes: HOMES, page: process.env.JV_WEB, napGraceMs: 0, writerMs: 300 });

let host = make();
let base = await listen(host.server);
try {
  // ---------- one resident, as before ----------
  let r = await call(base, '/host/hello');
  ok(r.status === 200 && r.json.resident.id === 'fae' && r.json.resident.name === 'Fae (test)', 'the host says whose address this is');
  r = await call(base, '/host/pair', { method: 'POST', body: { pin: host.newPin(), name: 'her laptop' } });
  const faeTok = r.json.token;
  ok(r.status === 200 && faeTok, 'a device pairs with her, as before');
  ok(host.residents().length === 1 && host.residents()[0].first, 'one resident so far');

  // ---------- an existing home, added on the host itself ----------
  const jade = host.addResident({ id: 'jade', name: 'Jade (test)', root: JADE, local: true }, 'the host window');
  ok(jade.root === path.resolve(JADE) && jade.hostShell && fs.readFileSync(at(JADE, '/Jade/SOUL.md'), 'utf8').includes('Jade stand-in'), 'the person adds an existing home on the host: her files stay as they are, with host_shell');
  ok(jade.stateDir === path.resolve(JADE) + ' (host)', 'and her records beside her home, not in it, nor in anyone else\'s');

  // ---------- a fresh client, no backup: a new resident with the PIN ----------
  r = await call(base, '/host/residents', { method: 'POST', body: { pin: '000000', id: 'noe', name: 'Noe (test)', device: 'Noe app' } });
  ok(r.status === 401 && !host.resident('noe'), 'without the host\'s PIN, no new resident');
  r = await call(base, '/host/residents', { method: 'POST', body: { pin: host.newPin(), id: 'noe', name: 'Noe (test)', device: 'Noe app' }, headers: { 'Sec-Fetch-Site': 'cross-site' } });
  ok(r.status === 403 && !host.resident('noe'), 'another website can\'t ask for one');
  r = await call(base, '/host/residents', { method: 'POST', body: { pin: host.newPin(), id: 'noe', name: 'Noe (test)', device: 'Noe app' } });
  const noeTok = r.json?.token;
  ok(r.status === 200 && noeTok && r.json.resident.id === 'noe' && r.json.resident.name === 'Noe (test)', 'with it: a new resident under the name the client gave, and the client paired with her');
  const noe = host.resident('noe');
  ok(noe.root === path.join(HOMES, 'noe') && fs.existsSync(noe.root) && !fs.readdirSync(noe.root).length, 'her home is new and empty, in the folder for new residents (her SOUL is hers to write)');
  ok(!noe.hostShell && !(await tools(base + '/r/noe', noeTok)).includes('host_shell'), 'a resident made from a client has no host_shell (the shell isn\'t walled off from the other homes)');
  const refused = await tool(base + '/r/noe', noeTok, 'host_shell', { command: 'ls ..' });
  ok(refused.isError && /off for you/.test(refused.content[0].text), 'and asking for it is refused, saying why');
  ok((await tools(base, faeTok)).includes('host_shell') && (await tools(base + '/r/jade', faeTok)).length === 0, 'Fae keeps hers');

  r = await call(base, '/host/residents', { method: 'POST', body: { pin: host.newPin(), id: 'noe', name: 'again' } });
  ok(r.status === 409, 'the same id twice: refused');
  r = await call(base, '/host/residents', { method: 'POST', body: { pin: host.newPin(), id: 'Not An Id!' } });
  ok(r.status === 400, 'an id that isn\'t lowercase letters, digits and dashes: refused');
  r = await call(base, '/host/residents', { method: 'POST', body: { pin: host.newPin(), id: 'taken' } });
  ok(r.status === 409 && fs.readFileSync(path.join(HOMES, 'taken', 'something.md'), 'utf8') === 'already here' && !host.resident('taken'), 'a client never takes over a folder that already holds things');
  r = await call(base, '/host/residents', { method: 'POST', body: { pin: host.newPin(), id: 'host' } });
  ok(r.status === 400, 'a name the host uses itself: refused');

  // ---------- kept apart ----------
  ok((await call(base + '/r/noe', '/host/status', { token: faeTok })).status === 401, 'Fae\'s device has no key to Noe');
  ok((await call(base, '/host/status', { token: noeTok })).status === 401, 'and Noe\'s none to Fae');
  ok((await call(base + '/r/jade', '/host/status', { token: noeTok })).status === 401, 'nor to Jade');
  r = await call(base + '/r/noe', '/host/status', { token: noeTok });
  ok(r.status === 200 && r.json.resident.id === 'noe' && r.json.devices.length === 1 && r.json.devices[0].name === 'Noe app', 'Noe sees her own host: her own devices only');
  ok((await call(base + '/r/nobody', '/host/status', { token: noeTok })).status === 404, 'a resident who isn\'t here: not found');

  ok(/^ok:\d+$/.test(await disk(base + '/r/noe', noeTok, 'put', ['/hello.md', b64('noe was here'), true, true], 'noe-page')), 'Noe writes her vault');
  ok(fs.readFileSync(at(noe.root, '/hello.md'), 'utf8') === 'noe was here' && !fs.existsSync(at(FAE, '/hello.md')) && !fs.existsSync(at(JADE, '/hello.md')), 'the file is in her home, and only there');
  ok(!(await disk(base, faeTok, 'scan', [])).includes('hello.md'), 'Fae\'s vault doesn\'t show it');
  ok(/^ok:\d+$/.test(await disk(base, faeTok, 'put', ['/Pandora/note.md', b64('fae'), true, true], 'fae-page')), 'each has her own writer: Noe\'s window writing doesn\'t stop Fae\'s');

  r = await call(base + '/r/noe', '/host/settings', { token: noeTok, method: 'PUT', body: { herKeys: ['/Noe/private'] } });
  ok(r.status === 200 && (await call(base, '/host/settings', { token: faeTok })).json.herKeys?.join() !== '/Noe/private', 'her settings are hers: Noe\'s change doesn\'t touch Fae\'s');
  await call(base + '/r/noe', '/host/models/cloud/key', { token: noeTok, method: 'PUT', body: { key: 'made-up-key-for-noe-only' } });
  const keyIn = (dir) => fs.existsSync(dir) && fs.readdirSync(dir).some((f) => fs.statSync(path.join(dir, f)).isFile() && fs.readFileSync(path.join(dir, f), 'utf8').includes('made-up-key-for-noe-only'));
  ok(keyIn(noe.stateDir) && !keyIn(FAE_STATE) && !keyIn(jade.stateDir) && !keyIn(noe.root), 'her keys are in her own key file, nowhere else');
  ok((await call(base, '/host/status', { token: faeTok })).json.models.providers.cloud?.keySet !== true, 'and Fae\'s model has no key from it');

  // her own nap: a client on Noe wakes Noe, not Fae
  const ac = new AbortController();
  const stream = await fetch(base + '/r/noe/host/presence/stream', { headers: { Authorization: 'Bearer ' + noeTok, 'X-Page': 'noe-page' }, signal: ac.signal });
  await stream.body.getReader().read();
  ok(noe.nap.awake() && !host.nap.awake() && !jade.nap.awake(), 'each naps on her own: a client with Noe wakes Noe only');
  ac.abort();

  // ---------- a backup into the new resident (#48's import, unchanged) ----------
  const bk = { app: 'jade-vault', format: 1, kind: 'full', exportedAt: '2026-11-20T10:00:00.000Z', includesKeys: false, settings: { personName: 'Test Person' }, storage: {}, vault: { files: { '/Pandora/SOUL.md': '# SOUL\n\nfrom a made-up backup\n' } } };
  r = await call(base + '/r/noe', '/host/import', { token: noeTok, method: 'POST', raw: JSON.stringify(bk), headers: { 'X-Backup-Name': 'noe.json' } });
  ok(r.status === 200 && r.json.id, 'a backup can come into her, the same way');
  await new Promise((w) => setTimeout(w, 400)); // her window has been quiet long enough
  r = await call(base + '/r/noe', `/host/import/${r.json.id}/apply`, { token: noeTok, method: 'POST', body: { confirm: true } });
  ok(r.status === 200 && fs.readFileSync(at(noe.root, '/Pandora/SOUL.md'), 'utf8').includes('made-up backup') && fs.readFileSync(at(FAE, '/Pandora/SOUL.md'), 'utf8').includes('Fae stand-in'), 'into her home only: Fae\'s SOUL is as it was');
  ok(host.resident('noe').store.settings().personName === 'Test Person' && host.store.settings().personName !== 'Test Person', 'and into her own Atelier store');

  // ---------- pages: each at her own address ----------
  r = await call(base, '/r/noe/', {});
  ok(r.status === 409, 'Noe\'s pages need her own address; none is open yet, and the host says so');
  const noeBase = await listen(host.serverFor('noe'));
  r = await call(base, '/r/noe/host/', {});
  ok(r.status === 302 && r.location === noeBase + '/host/', 'with one open, /r/noe/ pages send a browser there (so it keeps her key and storage apart)');
  r = await call(noeBase, '/host/hello', { token: noeTok });
  ok(r.json.resident.id === 'noe' && r.json.paired, 'at her own address, everything is hers, without the prefix');
  ok((await call(noeBase, '/', {})).text.includes('/host/bridge.js'), 'and her Atelier page is served there');
  ok((await call(noeBase, '/host/status', { token: faeTok })).status === 401, 'Fae\'s key doesn\'t open it');

  r = await call(base, '/host/residents', { token: faeTok });
  ok(r.status === 200 && r.json.map((x) => x.id).join() === 'fae,jade,noe' && r.json.find((x) => x.you).id === 'fae', 'who lives here, for a paired device at home');
  ok((await call(base, '/host/residents', {})).status === 401, 'and not for an unpaired one');

  // ---------- after a restart, everyone is still here ----------
  await host.close();
  host = make(); base = await listen(host.server);
  ok(host.residents().map((x) => x.id).join() === 'fae,jade,noe', 'after a restart: the same residents');
  r = await call(base + '/r/noe', '/host/status', { token: noeTok });
  ok(r.status === 200 && r.json.resident.id === 'noe', 'Noe\'s device still pairs with her, and only her');
  ok(!host.resident('noe').hostShell && host.resident('jade').hostShell, 'host_shell is as it was for each');
  host.setHostShell('noe', true);
  ok((await tools(base + '/r/noe', noeTok)).includes('host_shell') && JSON.parse(fs.readFileSync(path.join(FAE_STATE, 'residents.json'), 'utf8')).find((e) => e.id === 'noe').hostShell === true, 'the person can turn it on for her on the host, and it\'s kept');
  host.setHostShell('noe', false);
  ok(!(await tools(base + '/r/noe', noeTok)).includes('host_shell'), 'and off again');
  const reg = JSON.parse(fs.readFileSync(path.join(FAE_STATE, 'residents.json'), 'utf8'));
  ok(!JSON.stringify(reg).includes('made-up-key') && reg.every((e) => !('token' in e)), 'the residents list holds no keys or tokens');

  // ---------- a host without a folder for new residents ----------
  const bare = createHomeHost({ root: path.join(tmp, 'bare'), state: path.join(tmp, 'bare-state') });
  const bareBase = await listen(bare.server);
  r = await call(bareBase, '/host/residents', { method: 'POST', body: { pin: bare.newPin(), id: 'someone' } });
  ok(r.status === 409 && /--homes/.test(r.json.error), 'started without --homes, a host makes no residents from a client, and says why');
  await bare.close();
} catch (e) {
  fail.push('FAIL threw: ' + (e && e.stack || e));
} finally {
  await host.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}
for (const l of [...log, ...fail]) console.log(l);
console.log(fail.length ? `${fail.length} FAILED of ${log.length + fail.length}` : `ALL PASS (${log.length})`);
process.exit(fail.length ? 1 : 0);
