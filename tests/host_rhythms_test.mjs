// Her rhythms on the host (host/engines.cjs with app/modules/think_tool.js, curiosity.js and autobackup.js): her
// rituals' own triggers, her curiosity wake-ups, her tree-of-thought think, and her scheduled backup, run on the host
// with her Atelier's own code while her loop is there; an open page leaves them to it. Stand-in model and backup
// server; synthetic homes only.
import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(process.env.JV_WEB), '..');
const { createHomeHost } = require(path.join(ROOT, 'host', 'home_host.cjs'));
const log = []; const fail = [];
const ok = (c, m) => { (c ? log : fail).push((c ? 'PASS ' : 'FAIL ') + m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-host-rhythms-'));
const HOME = path.join(tmp, 'home');
const w = (vp, t) => { const f = path.join(HOME, ...vp.split('/').filter(Boolean)); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, typeof t === 'string' ? t : JSON.stringify(t, null, 1)); };
const read = (vp) => { try { return fs.readFileSync(path.join(HOME, ...vp.split('/').filter(Boolean)), 'utf8'); } catch { return null; } };
w('/Pandora/SOUL.md', '# SOUL\n\nI am a made-up stand-in.\n');
w('/Pandora/Memory.md', '- likes lilac\n');
w('/Inbox.md', 'first\n');
w('/Pandora/Rituals/seen.ritual.json', { name: 'seen', enabled: true, trigger: { type: 'note', path: '/Inbox.md' }, steps: [{ id: 'a', type: 'note', action: 'write', path: '/Seen.md', content: 'saw: {{ $input.content }}' }] });

// a stand-in model: answers in words
const model = http.createServer((req, res) => {
  let body = ''; req.on('data', (d) => { body += d; }); req.on('end', () => {
    if (req.url.endsWith('/models')) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ data: [{ id: 'stand-in' }] })); }
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'I wandered a little and came back.' } }] }));
  });
});
await new Promise((r) => model.listen(0, '127.0.0.1', r));
// a stand-in backup server, as her Atelier's (server/jade-backup-server.py): a bearer token, and the upload's checksum
const stored = [];
const backups = http.createServer((req, res) => {
  const parts = []; req.on('data', (d) => parts.push(d)); req.on('end', () => {
    if (req.headers.authorization !== 'Bearer made-up-backup-token') { res.writeHead(401); return res.end('{}'); }
    const b = Buffer.concat(parts); const sha = crypto.createHash('sha256').update(b).digest('hex');
    if (req.method === 'PUT' && req.headers['x-sha256'] === sha) { stored.push({ name: decodeURIComponent(req.url.split('/').pop()), bytes: b }); res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ sha256: sha })); }
    res.writeHead(400); res.end('{}');
  });
});
await new Promise((r) => backups.listen(0, '127.0.0.1', r));

const host = createHomeHost({ root: HOME, state: path.join(tmp, 'state'), id: 'fae', name: 'Fae (test)', napGraceMs: 600000 });
const fae = host.resident('fae');
fs.writeFileSync(path.join(tmp, 'state', 'atelier-secrets.json'), JSON.stringify({ secrets: { TOKEN: 'made-up-secret-value' } }));
fae.models.set({ brain: 'host', providers: { standin: { kind: 'openai', label: 'Stand-in', base: `http://127.0.0.1:${model.address().port}/v1`, enabled: true } }, roles: { chat: { provider: 'standin', model: 'stand-in' }, sparks: { provider: 'standin', model: 'stand-in' } } }, 'test');
const release = fae.nap.connect({ device: 'test', page: 'test' });
fae.startRuntime({ brain: 'host', schedulesMs: 3600000, ritualsMs: 3600000, curiosityMs: 3600000, backupMs: 3600000 });
try {
  // ---------- her tree-of-thought think, her Atelier's own ----------
  const thinkDef = fae.loop().allToolDefs().find((t) => t.function.name === 'think');
  ok(thinkDef && /Tree of thoughts/.test(thinkDef.function.description) && fae.loop().allToolDefs().filter((t) => t.function.name === 'think').length === 1, 'her loop offers her Atelier\'s own think (the tree of thoughts), in place of the simple one');
  const help = await fae.loop().callTool('think', { action: 'help' });
  ok(/verif/i.test(help) && /auto/.test(help), 'and it answers as in her Atelier');

  // ---------- her rituals' own triggers ----------
  await fae.herRituals(); // arms: notes what /Inbox.md is now
  ok(read('/Seen.md') === null, 'a ritual waiting for a note does nothing until the note changes');
  await sleep(1700); w('/Inbox.md', 'second\n'); await sleep(1700);
  await fae.herRituals(); await sleep(800);
  ok(/saw: second/.test(read('/Seen.md') || ''), 'when the note changes, the host fires the ritual, with what changed');
  fae.settings.set({ switches: { schedules: false } }, 'test');
  await sleep(1700); w('/Inbox.md', 'third\n'); await sleep(1700);
  await fae.herRituals(); await sleep(800);
  ok(!/third/.test(read('/Seen.md') || ''), 'with her schedules switch off, her rituals\' triggers rest');
  fae.settings.set({ switches: { schedules: true } }, 'test');

  // ---------- her curiosity ----------
  fae.state.lsSet('settings', { curiosityOn: true, cuMin: 1, cuMax: 2, cuFrom: '00:00', cuTo: '23:59', cuCap: 5, cuActsOff: ['rest'] }, 'test', 'test');
  fae.state.lsSet('cuNext', Date.now() - 1000, 'test', 'test');
  const woke = await fae.herCuriosity();
  const small = fae.state.lsAll().values;
  ok(woke && woke.chosen && small.cuToday && small.cuToday.n === 1, 'a curiosity wake-up comes when due, chosen by her Atelier\'s own curiosity');
  ok(small.curiosity && small.curiosity.log.length === 1 && typeof small.curiosity.log[0].reward === 'number', 'it is measured and learned from, as in her Atelier');
  ok(small.cuNext > Date.now(), 'and her next wake-up is set');
  const cs = (fae.state.dbGet('sessions').value || []).find((x) => x.id === small.cuSession);
  ok(cs && /wandered/.test(fae.state.dbGet('session:' + cs.id).value.messages.at(-1).content), 'the wake-up is kept in her curiosity chat, one chat every device sees');
  fae.settings.set({ switches: { sparks: false } }, 'test');
  fae.state.lsSet('cuNext', Date.now() - 1000, 'test', 'test');
  ok((await fae.herCuriosity()) === null && fae.state.lsAll().values.cuToday.n === 1, 'with her sparks switch off, she isn\'t woken');
  fae.settings.set({ switches: { sparks: true } }, 'test');

  // ---------- her scheduled backup ----------
  fae.state.lsSet('settings', { ...fae.state.lsAll().values.settings, abOn: true, abUrl: `http://127.0.0.1:${backups.address().port}`, abHours: 24, abKind: 'full' }, 'test', 'test');
  await fae.herBackup();
  ok(stored.length === 0, 'without her backup server\'s token, nothing is sent');
  await fae.tend.act('backupKey', { name: 'abToken', key: 'made-up-backup-token' }, 'the keeper');
  await fae.herBackup(); await sleep(300);
  ok(stored.length === 1 && /^jade-vault-full-.*\.json\.gz$/.test(stored[0].name), 'with it, her backup is sent to her backup server, gzipped and checksummed, as her Atelier sends it');
  const data = stored.length ? JSON.parse(zlib.gunzipSync(stored[0].bytes).toString('utf8')) : {};
  ok(data.vault && data.vault.files && /likes lilac/.test(data.vault.files['/Pandora/Memory.md'] || '') && (data.db && Array.isArray(data.db.sessions)), 'it holds her vault and her chats, from the host');
  const all = JSON.stringify(data);
  ok(!all.includes('made-up-secret-value') && !all.includes('made-up-backup-token'), 'and no keys: neither her secrets nor the server\'s token');
  const small2 = fae.state.lsAll().values;
  ok(small2.abLast > 0 && small2.abStatus && small2.abStatus.ok === true, 'her Atelier sees when it last went, and that it went well');
  const settingsFile = fs.readFileSync(path.join(tmp, 'state', 'atelier', 'settings.json'), 'utf8');
  const logs = fs.readFileSync(path.join(tmp, 'state', 'events.jsonl'), 'utf8') + fs.readFileSync(path.join(tmp, 'state', 'trace.jsonl'), 'utf8');
  ok(!settingsFile.includes('made-up-backup-token') && !logs.includes('made-up-backup-token'), 'the token is kept write-only on the host: never in her settings, the log or the trace');
  await fae.herBackup();
  ok(stored.length === 1, 'and the next one waits until it is due (every 24 hours here)');

  // ---------- an open page leaves these to the host ----------
  const page = fs.readFileSync(process.env.JV_WEB, 'utf8');
  ok((page.match(/her loop is on the home host, which runs this\n/g) || []).length === 4, 'the built page steps back from her rituals\' triggers, her curiosity and her backup while her loop is on the host');
} catch (e) {
  fail.push('FAIL threw: ' + (e && e.stack || e));
} finally {
  release();
  await host.close();
  model.close(); backups.close();
  await sleep(200);
  fs.rmSync(tmp, { recursive: true, force: true });
}
for (const l of [...log, ...fail]) console.log(l);
console.log(fail.length ? `${fail.length} FAILED of ${log.length + fail.length}` : `ALL PASS (${log.length})`);
process.exit(fail.length ? 1 : 0);
