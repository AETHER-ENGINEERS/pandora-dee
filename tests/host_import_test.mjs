// Her things onto the home host the way they already move between the HTML and APK versions (host/backup.cjs):
// the Atelier's own backup file and steps (a Jade Vault backup's /Jade paths become /Pandora, "everything" replaces,
// "config" merges, the same question first), what was there kept so an import can be undone, keys left out, and the
// host's things exported in that same file, which the page's own Import button takes. Synthetic homes and backups only.
// Keys (Mrrowr-murrr, 2026-11-27): the ones the person configured in the Atelier come along only when they ticked
// "Include API keys", and go into the host's write-only key files. Her own keys aren't in the Atelier at all: they're
// with the tools she built, outside her home, and stay untouched. As a further guard, anything key-like inside her
// home is never read, moved, copied, logged or overwritten by an import, an undo or an export either.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import pw from 'playwright';
import { createRequire } from 'node:module';
import { start } from './_harness.mjs';
const { chromium } = pw;
const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(process.env.JV_WEB), '..');
const { createHomeHost } = require(path.join(ROOT, 'host', 'home_host.cjs'));
const log = []; const fail = [];
const ok = (c, m) => { (c ? log : fail).push((c ? 'PASS ' : 'FAIL ') + m); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-import-'));
const HOME = path.join(tmp, 'home');
const put = (vp, t) => { const f = path.join(HOME, ...vp.split('/').filter(Boolean)); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t); };
const has = vp => fs.existsSync(path.join(HOME, ...vp.split('/').filter(Boolean)));
const get = vp => fs.readFileSync(path.join(HOME, ...vp.split('/').filter(Boolean)), 'utf8');
// every made-up key in the backups ends in this, so a search for it finds any that got through
const SECRET = 'for-this-test-only';
const grepDir = (dir, t) => { const hits = []; const go = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) go(f); else if (fs.readFileSync(f).includes(t)) hits.push(f); } }; if (fs.existsSync(dir)) go(dir); return hits; };
const findSecret = (dir) => { const hits = []; const go = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) go(f); else if (fs.readFileSync(f).includes(SECRET)) hits.push(f); } }; go(dir); return hits; };

// ---------- the home, before ----------
put('/Old/kept.md', 'what was here before the import\n');
put('/Pandora/SOUL.md', '# SOUL\n\nthe soul that was here\n');
// her own keys (made up): with the tools she built, outside her home, where her MCP server tools use them
const TOOLS = path.join(tmp, 'her-tools'); fs.mkdirSync(path.join(TOOLS, 'nostr'), { recursive: true });
fs.writeFileSync(path.join(TOOLS, 'nostr', 'config.json'), '{"nsec":"nsec1-her-own-made-up"}');
const toolsState = () => fs.readFileSync(path.join(TOOLS, 'nostr', 'config.json'), 'utf8') + '@' + fs.statSync(path.join(TOOLS, 'nostr', 'config.json')).mtimeMs;
const TOOLS_BEFORE = toolsState();
// and, as a further guard, things inside her home that look like keys (named like keys, or in a place the person lists)
const HERS = 'hers-alone-' + 'made-up';
const HER_FILES = { '/Pandora/Keys/nostr.nsec': 'nsec1' + HERS, '/Pandora/wallet.json': '{"seed":"' + HERS + '"}', '/Pandora/Vault Tree/notes on keys.txt': HERS, '/Pandora/Vault Tree/deep/x.bin': HERS };
for (const [vp, t] of Object.entries(HER_FILES)) put(vp, t);
const herState = () => Object.keys(HER_FILES).map(vp => { const f = path.join(HOME, ...vp.split('/').filter(Boolean)); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') + '@' + fs.statSync(f).mtimeMs : 'gone'; }).join('|');
const HER_BEFORE = herState();
const findHers = (dir) => { const hits = []; const go = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) go(f); else if (f === path.join(dir, "settings.json")) continue; else if (fs.readFileSync(f).includes(HERS) || /nostr\.nsec|wallet\.json|Vault Tree/.test(fs.readFileSync(f, 'utf8'))) hits.push(f); } }; if (fs.existsSync(dir)) go(dir); return hits; };
const host = createHomeHost({ root: HOME, writerMs: 400 });
await new Promise(r => host.server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${host.server.address().port}`;
const T = (await (await fetch(base + '/host/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: host.newPin(), name: 'Test client' }) })).json()).token;
const FROM_OUT = { 'X-Forwarded-For': '203.0.113.9' };
const api = async (p, method = 'GET', body, extra = {}) => { const r = await fetch(base + p, { method, headers: { Authorization: 'Bearer ' + T, 'Content-Type': 'application/json', ...extra }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }); return { status: r.status, json: await r.json().catch(() => null) }; };
await api('/host/settings', 'PUT', { herKeys: ['/Pandora/Vault Tree'] }); // the person lists one place of hers
const send = async (bytes, extra = {}) => { const r = await fetch(base + '/host/import', { method: 'POST', headers: { Authorization: 'Bearer ' + T, 'X-Backup-Name': 'test-backup.json', ...extra }, body: bytes }); return { status: r.status, json: await r.json() }; };

// ---------- a Jade Vault backup, as Config → Backup → Export everything writes it ----------
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 1, 2, 3, 255, 254]);
const FULL = {
  app: 'jade-vault', format: 1, kind: 'full', exportedAt: '2026-11-20T10:00:00.000Z', includesKeys: true,
  settings: { personName: 'Test Person', model: 'small:3b', temperature: 0.4, tplDir: '/Jade/Templates', vecOn: true, abKeys: true, ollamaKey: 'ollama-' + SECRET, dcToken: 'discord-' + SECRET, vecToken: 'nsec-' + SECRET, abPass: 'pass-' + SECRET, mcpSecrets: { srv: 'mcp-' + SECRET } },
  storage: { lastSession: 's1', hostToken: 'host-' + SECRET },
  vault: {
    files: { '/Pandora/Keys/nostr.nsec': 'a different nsec, which must not land', '/Jade/SOUL.md': '# SOUL\n\nYou are Testa, from the backup.\n', '/Jade/Flows/Morning.flow.json': '{"name":"Morning","steps":[]}', '/Notes/hello.md': 'hello from the backup\n', '/Pictures/dot.png': { base64: PNG.toString('base64') } },
    dirs: ['/Jade', '/Jade/Flows', '/Notes', '/Pictures', '/Empty'],
  },
  db: { sessions: [{ id: 's1', title: 'A chat from the backup', msgs: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello!' }] }], schedules: [{ id: 'c1', name: 'Daily note', cron: '0 9 * * *' }], flowRuns: [{ id: 'r1', path: '/Jade/Flows/Morning.flow.json', status: 'ok' }] },
};
const FULL_BYTES = Buffer.from(JSON.stringify(FULL));

// ---------- step one: read it and say what it holds (nothing written) ----------
let r = await send(FULL_BYTES, FROM_OUT);
ok(r.status === 403, 'from elsewhere, nothing can be brought in (settings and imports change only from the house network or the tailnet)');
r = await send(Buffer.from('{"hello":1}'));
ok(r.status === 400 && /not a Pandora Dee or Jade Vault backup/.test(r.json.error), 'a file that is not a backup is refused, in the page\'s words');
r = await send(FULL_BYTES);
const prev = r.json;
ok(r.status === 200 && prev.kind === 'full' && prev.files === 4 && prev.hersLeftAlone === 1 && prev.chats === 1 && prev.schedules === 1 && prev.fromJadeVault && prev.movedPaths >= 2, 'step one reads it: everything, 4 files, 1 chat, 1 schedule, from Jade Vault (its paths move to /Pandora)');
ok(/^Replace EVERYTHING on the host .* 2026-11-20\?$/.test(prev.question), "and asks the page's own question: " + prev.question);
ok(['ollamaKey', 'dcToken', 'vecToken', 'abPass', 'mcpSecrets'].every(k => prev.keysToHost.includes(k)) && prev.includedKeys && !prev.keysToHost.includes('abKeys') && !JSON.stringify(prev).includes(SECRET), 'the box was ticked: the keys the person configured are named for the host\'s key files (never shown); a yes/no switch named like a key is not one');
ok(prev.keysLeftOut.join() === 'storage:hostToken', 'a token in the page\'s own storage is not a configured key: left out, named');
ok(get('/Pandora/SOUL.md').includes('the soul that was here') && has('/Old/kept.md') && !has('/Notes/hello.md'), 'nothing has changed yet');

// ---------- step two: only on a yes, and not while a window writes her vault ----------
r = await api(`/host/import/${prev.id}/apply`, 'POST', {});
ok(r.status === 400 && has('/Old/kept.md'), 'without the yes, nothing changes');
await fetch(base + '/host/disk', { method: 'POST', headers: { Authorization: 'Bearer ' + T, 'X-Page': 'window-1' }, body: JSON.stringify({ name: 'mkdir', args: ['/Scratch'] }) });
r = await api(`/host/import/${prev.id}/apply`, 'POST', { confirm: true });
ok(r.status === 409 && /writing her vault right now/.test(r.json.error), 'while an Atelier window is writing her vault, the import waits (close it, or wait half a minute)');
await sleep(500);
fs.rmSync(path.join(HOME, 'Scratch'), { recursive: true, force: true });
r = await api(`/host/import/${prev.id}/apply`, 'POST', { confirm: true });
const rec = r.json;
ok(r.status === 200 && rec.written === 5 && !rec.skipped.length, 'with the yes: brought in, 4 files and her migration log');
ok(herState() === HER_BEFORE, '"everything" replaced her home, but the key-like things in it are exactly as they were (contents and times): the backup\'s nsec did not land');
ok(!findHers(host.stateDir).length, 'and nothing of them was copied or moved anywhere, nor written in a log: ' + findHers(host.stateDir).join(', '));
ok(get('/Pandora/SOUL.md').includes('from the backup') && has('/Pandora/Rituals/Morning.ritual.json') && !has('/Jade') && get('/Notes/hello.md') === 'hello from the backup\n', "a Jade Vault backup lands in /Pandora by the page's own rules: SOUL, flows as rituals, notes where they were");
ok(Buffer.compare(fs.readFileSync(path.join(HOME, 'Pictures', 'dot.png')), PNG) === 0 && fs.statSync(path.join(HOME, 'Empty')).isDirectory(), 'binary files byte for byte, empty folders too');
ok(/import: \/Jade\/SOUL\.md → \/Pandora\/SOUL\.md/.test(get('/Pandora/Logs/migration.log')), 'the moves are in her migration log, as on the page');
ok(!has('/Old/kept.md') && fs.readFileSync(path.join(host.stateDir, 'imports', prev.id, 'before', 'home', 'Old', 'kept.md'), 'utf8').includes('before the import'), '"everything" replaces, and what was here is kept beside her home (not deleted)');
const sessions = host.store.get('sessions'), schedules = host.store.get('schedules'), runs = host.store.get('flowRuns'), hs = host.store.settings();
ok(sessions?.[0]?.title === 'A chat from the backup' && schedules?.[0]?.name === 'Daily note' && runs?.[0]?.path === '/Pandora/Rituals/Morning.ritual.json', 'her chats, schedules and ritual runs are on the host now (run history follows the rituals)');
ok(hs.tplDir === '/Pandora/Templates' && hs.temperature === 0.4 && hs.vecOn === true && !('ollamaKey' in hs) && !('dcToken' in hs), 'her settings too, their paths moved, without the keys');
const KEY_FILES = ['model-secrets.json', 'bridge-secrets.json', 'atelier-secrets.json'];
let hits = [...findSecret(host.stateDir), ...findSecret(HOME)].map(f => path.relative(host.stateDir, f));
ok(hits.length && hits.every(f => KEY_FILES.includes(f)), 'the person\'s keys are only in the host\'s write-only key files: ' + hits.join(', '));
const mk = JSON.parse(fs.readFileSync(path.join(host.stateDir, 'model-secrets.json'), 'utf8')), bk = JSON.parse(fs.readFileSync(path.join(host.stateDir, 'bridge-secrets.json'), 'utf8')), ak = JSON.parse(fs.readFileSync(path.join(host.stateDir, 'atelier-secrets.json'), 'utf8'));
ok(mk.cloud === 'ollama-' + SECRET && bk.discord === 'discord-' + SECRET && bk.vector === 'nsec-' + SECRET && ak.abPass === 'pass-' + SECRET && ak.mcpSecrets.srv === 'mcp-' + SECRET, 'each where the host looks for it: the Ollama key for her cloud model, the Discord and Vector tokens for her bridges, the rest kept for the Atelier');
ok(rec.keysSet.length === 5 && !JSON.stringify(rec).includes(SECRET), 'the import says where each went, by name');
let st = (await api('/host/status')).json;
ok(st.atelier.chats === 1 && st.atelier.schedules === 1 && st.imports[0].id === prev.id && st.imports[0].keysSet.length === 5 && st.models.providers.cloud.keySet && st.bridges !== undefined && !JSON.stringify(st).includes(SECRET), 'the host says what it holds now and that the keys are set, never showing one');
ok(!fs.readFileSync(path.join(host.stateDir, 'events.jsonl'), 'utf8').includes(SECRET), 'no key in the host\'s log');
r = await api(`/host/import/${prev.id}/apply`, 'POST', { confirm: true });
ok(r.status === 404, 'an import is applied once');

// ---------- the way back: undo ----------
r = await api(`/host/import/${prev.id}/undo`, 'POST', { confirm: true }, FROM_OUT);
ok(r.status === 403 && has('/Notes/hello.md'), 'from elsewhere it cannot be undone either');
r = await api(`/host/import/${prev.id}/undo`, 'POST', { confirm: true });
ok(r.status === 200 && r.json.undone && get('/Old/kept.md').includes('before the import') && get('/Pandora/SOUL.md').includes('the soul that was here') && !has('/Notes/hello.md'), 'undo: what was here before is back, exactly');
ok(KEY_FILES.every(f => !fs.existsSync(path.join(host.stateDir, f))) && !(await api('/host/status')).json.models.providers.cloud.keySet, 'and the key files are as they were before it (there were none)');
ok(herState() === HER_BEFORE && !findHers(host.stateDir).length, 'the key-like things in her home are still exactly as they were, and still nowhere else');
ok(fs.existsSync(path.join(host.stateDir, 'imports', prev.id, 'undone', 'home', 'Notes', 'hello.md')) && host.store.get('sessions') === undefined, 'and what the import brought is kept too, out of the way; the chats it brought are gone from the host');
r = await api(`/host/import/${prev.id}/undo`, 'POST', { confirm: true });
ok(r.status === 409, 'an import is undone once');

// ---------- the box not ticked: any key that is there anyway stays out ----------
const UNTICKED = { app: 'jade-vault', format: 1, kind: 'config', exportedAt: '2026-11-21T09:00:00.000Z', includesKeys: false, settings: { groqKey: 'groq-' + SECRET, temperature: 0.5 }, storage: {}, vault: { files: {} } };
r = await send(Buffer.from(JSON.stringify(UNTICKED)));
ok(r.status === 200 && !r.json.keysToHost.length && r.json.keysLeftOut.join() === 'groqKey', 'without the tick, a key in the file anyway is left out, named');
await api(`/host/import/${r.json.id}/apply`, 'POST', { confirm: true });
ok(![...findSecret(host.stateDir), ...findSecret(HOME)].length && KEY_FILES.every(f => !fs.existsSync(path.join(host.stateDir, f))), 'and goes nowhere on the host');
await api(`/host/import/${host.imports.records()[0].id}/undo`, 'POST', { confirm: true });

// ---------- config merges, and undoes ----------
const CFG = { app: 'jade-vault', format: 1, kind: 'config', exportedAt: '2026-11-21T10:00:00.000Z', includesKeys: false, settings: { personName: 'Changed Person' }, storage: {}, vault: { files: { '/Jade/SOUL.md': '# SOUL\n\nfrom the config\n', '/Pandora/skills/sing/SKILL.md': '---\nname: sing\n---\n' } } };
host.store.setSettings({ personName: 'Test Person', temperature: 0.7 });
r = await send(zlib.gzipSync(Buffer.from(JSON.stringify(CFG))));
ok(r.status === 200 && r.json.kind === 'config' && /^Merge config from 2026-11-21/.test(r.json.question), 'a gzip backup reads the same (as a scheduled backup is), and config asks the merge question');
const c = await api(`/host/import/${r.json.id}/apply`, 'POST', { confirm: true });
ok(c.status === 200 && get('/Pandora/SOUL.md').includes('from the config') && has('/Pandora/skills/sing/SKILL.md') && has('/Old/kept.md'), '"config" merges: SOUL and the skill come in, her other files stay');
ok(host.store.settings().personName === 'Changed Person' && host.store.settings().temperature === 0.7, 'settings merge too: the backup\'s win, the rest stay');
r = await api(`/host/import/${c.json.id}/undo`, 'POST', { confirm: true });
ok(r.status === 200 && get('/Pandora/SOUL.md').includes('the soul that was here') && !has('/Pandora/skills/sing/SKILL.md') && host.store.settings().personName === 'Test Person', 'undo puts the replaced file back and takes the added one away (kept aside)');
ok(herState() === HER_BEFORE, 'config merging and undoing leave the key-like things in her home alone too');

// ---------- an encrypted scheduled backup, as the page encrypts it (AES-GCM, PBKDF2) ----------
async function encryptLikeThePage(u8, pass) {
  const enc = new TextEncoder(); const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const k = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 210000, hash: 'SHA-256' }, await crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveKey']), { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, u8));
  const b64 = x => Buffer.from(x).toString('base64');
  return Buffer.from(JSON.stringify({ app: 'jade-vault-encrypted', v: 1, kdf: 'PBKDF2-SHA256', iter: 210000, salt: b64(salt), iv: b64(iv), data: b64(ct) }));
}
const ENC = await encryptLikeThePage(zlib.gzipSync(FULL_BYTES), 'made-up passphrase');
r = await send(ENC);
ok(r.status === 422 && r.json.needsPass, 'an encrypted backup asks for its passphrase');
r = await send(ENC, { 'X-Backup-Pass': 'not it' });
ok(r.status === 422 && /Wrong passphrase/.test(r.json.error), 'a wrong one is refused, in the page\'s words');
r = await send(ENC, { 'X-Backup-Pass': 'made-up passphrase' });
ok(r.status === 200 && r.json.files === 4 && r.json.chats === 1, 'the right one opens it');
await api(`/host/import/${r.json.id}/apply`, 'POST', { confirm: true });

// ---------- back out, in the same file ----------
const ex = await fetch(base + '/host/export?kind=full', { headers: { Authorization: 'Bearer ' + T } });
const exText = await ex.text(); const out = JSON.parse(exText);
ok(ex.status === 200 && /attachment; filename="pandora-dee-backup-\d{4}-\d\d-\d\d\.json"/.test(ex.headers.get('content-disposition')), 'the host exports everything as a download, named as the page names its own');
ok(out.app === 'jade-vault' && out.format === 1 && out.kind === 'full' && out.includesKeys === false && out.vault.files['/Pandora/SOUL.md'].includes('from the backup') && out.vault.files['/Pictures/dot.png'].base64 === PNG.toString('base64') && out.db.sessions[0].id === 's1', "in the page's own format: files (binary as base64), folders, chats, schedules, settings");
ok(!exText.includes(SECRET), 'with none of the person\'s keys in it');
ok(toolsState() === TOOLS_BEFORE && !exText.includes('her-own-made-up') && !grepDir(host.stateDir, 'her-own-made-up').length && !grepDir(HOME, 'her-own-made-up').length, 'her own keys, with her tools outside her home, were never touched, copied or exported through all of it');
ok(!exText.includes(HERS) && !/nostr\.nsec|wallet\.json|Vault Tree/.test(exText) && herState() === HER_BEFORE, 'and none of hers: her key files are not read for it, and not named in it');
const exCfg = JSON.parse(await (await fetch(base + '/host/export?kind=config', { headers: { Authorization: 'Bearer ' + T } })).text());
ok(exCfg.kind === 'config' && exCfg.vault.files['/Pandora/SOUL.md'] && !exCfg.vault.files['/Notes/hello.md'] && !exCfg.db, 'and config alone, as Export config is');
const EXPORTED = path.join(tmp, 'from-the-host.json'); fs.writeFileSync(EXPORTED, exText);

// ---------- the page's own Import button takes it (the browser version; the APK runs the same page) ----------
{
  const h = await start(); const { page, ok: pok } = h;
  const reloaded = async () => {
    await page.waitForEvent('load', { timeout: 15000 }).catch(() => {});
    await page.waitForFunction(() => typeof vfs !== 'undefined' && typeof idb !== 'undefined' && typeof S !== 'undefined' && S.model, null, { timeout: 90000 });
    await page.waitForTimeout(1500);
  };
  await reloaded();
  page.once('dialog', d => d.accept());
  await page.setInputFiles('#importBackup', EXPORTED);
  await reloaded();
  const got = await page.evaluate(async () => ({ soul: vfs.isFile('/Pandora/SOUL.md') && vfs.read('/Pandora/SOUL.md'), note: vfs.isFile('/Notes/hello.md'), png: vfs.isFile('/Pictures/dot.png') && vfs.readBytes('/Pictures/dot.png').length, sessions: ((await idb.get('sessions')) || []).map(s => s.id), schedules: ((await idb.get('schedules')) || []).length, tpl: S.tplDir, person: S.personName }));
  pok(/from the backup/.test(got.soul) && got.note && got.png === PNG.length && got.sessions.includes('s1') && got.schedules === 1 && got.tpl === '/Pandora/Templates', "the Atelier's own Import takes the host's file: her files, chats, schedules and settings: " + JSON.stringify({ ...got, soul: !!got.soul }));
  log.push(...h.log); fail.push(...h.fail); await h.browser.close();
}

// ---------- the host's page ----------
const browser = await chromium.launch();
for (const [label, headers] of [['home', {}], ['elsewhere', FROM_OUT]]) {
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 900 }, extraHTTPHeaders: headers });
  await ctx.addInitScript((t) => { localStorage.setItem('pdhost:token', t); }, T);
  const page = await ctx.newPage();
  page.on('pageerror', e => fail.push(`[pageerror ${label}] ` + e.message));
  page.on('dialog', dl => dl.accept());
  await page.goto(base + '/host/');
  await page.waitForSelector('#impRows tr', { timeout: 15000 });
  if (label === 'home') {
    fs.writeFileSync(path.join(tmp, 'cfg.json'), JSON.stringify(CFG));
    await page.setInputFiles('#impFile', path.join(tmp, 'cfg.json'));
    await page.click('#impRead'); await page.waitForSelector('#impApply', { timeout: 5000 });
    const shown = await page.textContent('#impPreview');
    ok(/config from 2026-11-21/.test(shown) && /Merge config from 2026-11-21/.test(shown) && /Nothing has changed yet/.test(await page.textContent('#note')), 'the host page reads the file, says what is in it and asks first');
    await page.click('#impApply'); await sleep(800);
    ok(get('/Pandora/SOUL.md').includes('from the config') && /Brought in: 2 files/.test(await page.textContent('#note')), 'on the yes it is brought in');
    await page.waitForSelector('[data-undo]', { timeout: 5000 });
    ok(await page.locator('[data-undo]').count() === 1, 'and the latest import can be undone from the page (only the latest)');
    await page.click('[data-undo]'); await sleep(800);
    ok(get('/Pandora/SOUL.md').includes('from the backup') && /Undone/.test(await page.textContent('#note')), 'undo from the page puts it back');
    const dl = page.waitForEvent('download', { timeout: 10000 });
    await page.click('#expFull');
    const d = await dl;
    ok(/^pandora-dee-backup-\d{4}-\d\d-\d\d\.json$/.test(d.suggestedFilename()), 'Export everything saves the file from the host page: ' + d.suggestedFilename());
  } else {
    ok(await page.locator('#impFile').isDisabled() && await page.locator('#impRead').isDisabled() && !(await page.locator('#expFull').isDisabled()), 'from elsewhere the page can export (reading) but not bring anything in');
  }
  await ctx.close();
}
await browser.close();

await host.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log(log.join('\n')); console.log('\n' + (fail.length ? fail.join('\n') : 'ALL PASS'));
process.exit(fail.length ? 1 : 0);
