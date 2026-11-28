// Her things onto the home host, the same way they already move between the HTML and APK versions: the Atelier's own
// backup file (Config → Backup → "Export everything" / "Export config"), the same steps, and the same ways back.
//
//   - The file: { app: 'jade-vault', format: 1, kind: 'full' | 'config', exportedAt, includesKeys, settings, storage,
//     vault: { files, dirs }, db? } as app/modules/extras.js writes it: plain JSON, gzip, or the encrypted envelope of a
//     scheduled backup (app/modules/autobackup.js), all three read here as the page reads them.
//   - The steps: a Jade Vault backup's /Jade paths become /Pandora paths first, by the page's own rules (this loads
//     app/modules/migrate.js itself, so there is one set of rules, not two copies), then "full" replaces everything
//     and "config" merges (settings, SOUL/AGENTS/SYSTEM, memory, skills), with the same question first.
//   - The way back: before anything is written, what was there is kept beside the home (never deleted), so an import
//     can be undone; and the host's things export in this same file, which the HTML and APK versions import as they are.
//
// Keys never come onto the host this way: each character's keys are entered on the host itself (her models, her
// bridges), so a backup's keys and tokens are left out, and the person is told which ones (by name, never value).

'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const zlib = require('node:zlib');
const crypto = require('node:crypto');

const TMP = '.jvtmp';
const APP = 'jade-vault';

// ---------- the page's own path rules (app/modules/migrate.js) ----------
let rules = null;
function migrateRules() {
  if (rules) return rules;
  const src = fs.readFileSync(path.join(__dirname, '..', 'app', 'modules', 'migrate.js'), 'utf8');
  // only the pure parts are used: pandoraPath and migrateBackup touch nothing but the backup they are given
  rules = vm.runInNewContext(src + '\n;({ pandoraPath, migrateBackup, MIGRATION_LOG })', { console }, { filename: 'migrate.js' });
  return rules;
}

// ---------- reading the file: plain JSON, gzip, or the encrypted envelope ----------
const isGzip = (b) => b.length > 2 && b[0] === 0x1f && b[1] === 0x8b;
function decrypt(env, pass) {
  if (!pass) throw Object.assign(new Error('This backup is encrypted: a passphrase is needed.'), { code: 'PASS' });
  try {
    const key = crypto.pbkdf2Sync(Buffer.from(String(pass), 'utf8'), Buffer.from(env.salt, 'base64'), Number(env.iter) || 210000, 32, 'sha256');
    const all = Buffer.from(env.data, 'base64');
    const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(env.iv, 'base64'));
    d.setAuthTag(all.subarray(all.length - 16)); // WebCrypto's AES-GCM puts the tag at the end
    return Buffer.concat([d.update(all.subarray(0, all.length - 16)), d.final()]);
  } catch { throw Object.assign(new Error('Wrong passphrase, or the backup is damaged.'), { code: 'PASS' }); }
}
/** The bytes of a backup file → the backup object (as app/modules/autobackup.js abDecode). */
function decode(bytes, pass) {
  let b = Buffer.from(bytes);
  if (isGzip(b)) b = zlib.gunzipSync(b);
  let data;
  try { data = JSON.parse(b.toString('utf8')); } catch { throw new Error('That file is not valid JSON.'); }
  if (data && data.app === 'jade-vault-encrypted') {
    let inner = decrypt(data, pass);
    if (isGzip(inner)) inner = zlib.gunzipSync(inner);
    data = JSON.parse(inner.toString('utf8'));
  }
  if (!data || data.app !== APP || !data.vault) throw new Error('That is not a Pandora Dee or Jade Vault backup.');
  return data;
}
const encrypted = (bytes) => { let b = Buffer.from(bytes); try { if (isGzip(b)) return false; return /"jade-vault-encrypted"/.test(b.subarray(0, 200).toString('utf8')); } catch { return false; } };

// ---------- keys stay out ----------
// the page's SECRET_KEYS (app/modules/extras.js), the other tokens a page's settings hold, and anything named like a key
const KEY_NAMES = new Set(['ollamaKey', 'groqKey', 'oaiKey', 'lcppKey', 'ollayaKey', 'mcpSecrets', 'apiToken', 'vecToken', 'dcToken', 'embedKey', 'abToken', 'abPass']);
const KEYLIKE = /(?:key|keys|token|tokens|secret|secrets|pass|passphrase|password|nsec|privkey|seed)$/i;
const isKey = (k, v) => KEY_NAMES.has(k) || (KEYLIKE.test(k) && v != null && typeof v !== 'boolean' && typeof v !== 'number' && v !== '');
function leaveKeysOut(obj) {
  const out = {}, left = [];
  for (const [k, v] of Object.entries(obj || {})) { if (isKey(k, v)) { if (v !== '' && v != null) left.push(k); } else out[k] = v; }
  return { out, left };
}

/** A decoded backup → what the host would bring in: paths moved by the page's rules, keys left out, and a summary. */
function prepare(data) {
  const d = JSON.parse(JSON.stringify(data));
  d.settings = d.settings || {}; d.storage = d.storage || {};
  const moved = migrateRules().migrateBackup(d);
  const s = leaveKeysOut(d.settings), st = leaveKeysOut(d.storage);
  d.settings = s.out; d.storage = st.out;
  const keysLeftOut = [...s.left, ...st.left.map((k) => 'storage:' + k)];
  if (d.db) { const db = leaveKeysOut(d.db); d.db = db.out; keysLeftOut.push(...db.left.map((k) => 'db:' + k)); }
  const kind = d.kind === 'full' ? 'full' : 'config';
  const files = Object.keys(d.vault.files || {});
  const summary = {
    kind, exportedAt: String(d.exportedAt || ''), files: files.length, dirs: (d.vault.dirs || []).length,
    chats: Array.isArray(d.db && d.db.sessions) ? d.db.sessions.length : 0,
    schedules: Array.isArray(d.db && d.db.schedules) ? d.db.schedules.length : 0,
    fromJadeVault: moved.length > 0, movedPaths: moved.filter((l) => / → \/Pandora/.test(l) && !/setting/.test(l)).length,
    keysLeftOut, includedKeys: !!d.includesKeys,
    question: kind === 'full'
      ? `Replace EVERYTHING on the host (her files, chats, schedules, settings) with the backup from ${String(d.exportedAt || '').slice(0, 10)}?`
      : `Merge config from ${String(d.exportedAt || '').slice(0, 10)} (settings, SOUL/AGENTS/SYSTEM, memory, skills)? Her other files and chats stay.`,
  };
  delete d.includesKeys;
  return { data: d, moved, summary };
}

// ---------- the host's Atelier store: the settings, storage and database a page keeps in its browser ----------
function atelierStore(dir) {
  const sFile = path.join(dir, 'settings.json'), stFile = path.join(dir, 'storage.json'), dbDir = path.join(dir, 'db');
  const read = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
  const write = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f + TMP, JSON.stringify(v)); fs.renameSync(f + TMP, f); };
  const dbName = (k) => encodeURIComponent(k) + '.json';
  return {
    dir,
    settings: () => read(sFile, {}), storage: () => read(stFile, {}),
    setSettings: (v) => write(sFile, v), setStorage: (v) => write(stFile, v),
    db() { const out = {}; let names = []; try { names = fs.readdirSync(dbDir); } catch { return out; } for (const n of names) if (n.endsWith('.json')) out[decodeURIComponent(n.slice(0, -5))] = read(path.join(dbDir, n), null); return out; },
    setDb(obj) { for (const [k, v] of Object.entries(obj || {})) write(path.join(dbDir, dbName(k)), v); },
    get: (k) => read(path.join(dbDir, dbName(k)), undefined),
    set: (k, v) => write(path.join(dbDir, dbName(k)), v),
  };
}

// ---------- writing the host's things out in the same file ----------
const isText = (b) => { if (b.length > 4e6) return false; try { new TextDecoder('utf-8', { fatal: true }).decode(b); return !/[\x00-\x08\x0e-\x1f]/.test(b.subarray(0, 4000).toString('latin1')); } catch { return false; } };
// as the page's isConfigPath (app/modules/extras.js)
const isConfigPath = (p) => /^\/(pandora|jade)\/(soul|system|agents|memory|heartbeat|curiosity)\.md$/i.test(p) || /^\/(pandora|jade)\/mcp\.json$/i.test(p) || /^\/(pandora|jade)\/skills\//i.test(p) || /^\/agents\.md$/i.test(p);
function walk(root) {
  const files = [], dirs = [];
  const go = (dir) => {
    let list; try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of list) {
      if (e.name.endsWith(TMP) || e.isSymbolicLink()) continue;
      const full = path.join(dir, e.name); const vp = '/' + path.relative(root, full).split(path.sep).join('/');
      if (e.isDirectory()) { dirs.push(vp); go(full); } else if (e.isFile()) files.push([vp, full]);
    }
  };
  go(root);
  return { files, dirs: dirs.sort() };
}
/** The host's things as the Atelier's backup file: the HTML and APK versions import it with their own Import button. */
function build({ root, store, kind = 'full' }) {
  const w = walk(root); const files = {};
  for (const [vp, full] of w.files) {
    if (kind === 'config' && !isConfigPath(vp)) continue;
    const b = fs.readFileSync(full);
    files[vp] = isText(b) ? b.toString('utf8') : { base64: b.toString('base64') };
  }
  const out = { app: APP, format: 1, kind, exportedAt: new Date().toISOString(), includesKeys: false, from: 'pandora-dee-host', settings: store.settings(), storage: store.storage(), vault: { files, dirs: kind === 'full' ? w.dirs : [] } };
  if (kind === 'full') out.db = store.db();
  return out;
}

const toBytes = (v) => (typeof v === 'string' ? Buffer.from(v, 'utf8') : v && v.base64 ? Buffer.from(v.base64, 'base64') : Buffer.from(JSON.stringify(v), 'utf8'));
// a move that never deletes: rename, or copy then remove when the two places are on different drives
function moveAside(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  try { fs.renameSync(from, to); } catch (e) { if (e.code !== 'EXDEV') throw e; fs.cpSync(from, to, { recursive: true }); fs.rmSync(from, { recursive: true, force: true }); }
}
const moveChildren = (fromDir, toDir) => { fs.mkdirSync(toDir, { recursive: true }); let n = 0; for (const name of (fs.existsSync(fromDir) ? fs.readdirSync(fromDir) : [])) { moveAside(path.join(fromDir, name), path.join(toDir, name)); n++; } return n; };

/**
 * Imports on the host, each kept in <state>/imports/<id>/ with what was there before, so it can be undone.
 *   file(vp)  the home folder's own rules for a vault path → a real path inside it (desktop/disk_host.cjs)
 */
function createImports({ root, stateDir, store, file, log = () => {} }) {
  const dir = path.join(stateDir, 'imports');
  const staged = new Map(); // id → { prepared, name, at }
  const recFile = (id) => path.join(dir, id, 'record.json');
  const records = () => { let ids = []; try { ids = fs.readdirSync(dir); } catch { return []; } return ids.map((id) => { try { return JSON.parse(fs.readFileSync(recFile(id), 'utf8')); } catch { return null; } }).filter(Boolean).sort((a, b) => String(b.at).localeCompare(String(a.at))); };
  const saveRec = (r) => { fs.mkdirSync(path.join(dir, r.id), { recursive: true }); fs.writeFileSync(recFile(r.id), JSON.stringify(r, null, 1)); };
  const stamp = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z').replace(/:/g, '-');

  /** Step one: read the file and say what it holds. Nothing is written. */
  function preview(bytes, { name = 'backup', pass = '' } = {}) {
    for (const [k, v] of staged) if (Date.now() - v.at > 30 * 60e3) staged.delete(k);
    const prepared = prepare(decode(bytes, pass));
    const id = stamp() + '-' + crypto.randomBytes(3).toString('hex');
    staged.set(id, { prepared, name: String(name).replace(/[\x00-\x1f]/g, '').slice(0, 120), at: Date.now() });
    return { id, name, ...prepared.summary };
  }

  /** Step two, after the person said yes: full replaces everything, config merges. What was there is kept. */
  function apply(id, by) {
    const st = staged.get(id);
    if (!st) throw Object.assign(new Error('That import is no longer waiting: choose the file again.'), { status: 404 });
    staged.delete(id);
    const { data, moved, summary } = st.prepared;
    const box = path.join(dir, id), before = path.join(box, 'before');
    const rec = { id, at: new Date().toISOString(), by, name: st.name, ...summary, written: 0, skipped: [], added: [], replaced: [], undone: null };
    const atelierBefore = path.join(before, 'atelier');
    if (fs.existsSync(store.dir)) fs.cpSync(store.dir, atelierBefore, { recursive: true });
    const migLine = (lines) => { const at = new Date().toISOString().slice(0, 19).replace('T', ' '); return lines.map((l) => `${at} ${l}\n`).join(''); };
    const { MIGRATION_LOG } = migrateRules();
    if (summary.kind === 'full') {
      rec.keptAside = moveChildren(root, path.join(before, 'home'));
      for (const d of data.vault.dirs || []) { try { fs.mkdirSync(file(d), { recursive: true }); } catch (e) { log('import.skipped', { path: d, why: e.message }); } }
      if (moved.length) { const prev = data.vault.files[MIGRATION_LOG]; data.vault.files[MIGRATION_LOG] = (typeof prev === 'string' ? prev : '') + migLine(moved); }
      for (const [vp, v] of Object.entries(data.vault.files)) {
        try { const f = file(vp); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, toBytes(v)); rec.written++; } catch (e) { rec.skipped.push(vp); log('import.skipped', { path: vp, why: e.message }); }
      }
      fs.rmSync(store.dir, { recursive: true, force: true });
      store.setSettings(data.settings); store.setStorage(data.storage); store.setDb(data.db || {});
    } else {
      const write = (vp, bytes) => {
        const f = file(vp);
        if (fs.existsSync(f)) { const keep = path.join(before, 'home', ...vp.split('/').filter(Boolean)); fs.mkdirSync(path.dirname(keep), { recursive: true }); fs.copyFileSync(f, keep); rec.replaced.push(vp); } else rec.added.push(vp);
        fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, bytes);
      };
      for (const [vp, v] of Object.entries(data.vault.files)) { try { write(vp, toBytes(v)); rec.written++; } catch (e) { rec.skipped.push(vp); log('import.skipped', { path: vp, why: e.message }); } }
      if (moved.length) { try { const f = file(MIGRATION_LOG); const prev = fs.existsSync(f) ? fs.readFileSync(f) : Buffer.alloc(0); write(MIGRATION_LOG, Buffer.concat([prev, Buffer.from(migLine(moved))])); } catch {} }
      store.setSettings({ ...store.settings(), ...data.settings });
      store.setStorage({ ...store.storage(), ...data.storage });
    }
    saveRec(rec);
    log('import.applied', { id, kind: summary.kind, files: rec.written, skipped: rec.skipped.length, by, keysLeftOut: summary.keysLeftOut.length });
    return rec;
  }

  /** Back to how it was before the latest import. What the import brought is kept too (in <id>/undone), not deleted. */
  function undo(id, by) {
    const all = records(); const rec = all.find((r) => r.id === id);
    if (!rec) throw Object.assign(new Error('No import with that id.'), { status: 404 });
    if (rec.undone) throw Object.assign(new Error('That import was already undone.'), { status: 409 });
    const later = all.find((r) => !r.undone && String(r.at) > String(rec.at));
    if (later) throw Object.assign(new Error('A later import came after this one: undo that one first.'), { status: 409 });
    const box = path.join(dir, id), before = path.join(box, 'before'), undone = path.join(box, 'undone');
    if (rec.kind === 'full') {
      moveChildren(root, path.join(undone, 'home'));
      moveChildren(path.join(before, 'home'), root);
    } else {
      for (const vp of rec.added) { try { const f = file(vp); if (fs.existsSync(f)) moveAside(f, path.join(undone, 'home', ...vp.split('/').filter(Boolean))); } catch {} }
      for (const vp of rec.replaced) {
        try { const f = file(vp), keep = path.join(before, 'home', ...vp.split('/').filter(Boolean)); if (fs.existsSync(f)) { const u = path.join(undone, 'home', ...vp.split('/').filter(Boolean)); fs.mkdirSync(path.dirname(u), { recursive: true }); fs.copyFileSync(f, u); } fs.copyFileSync(keep, f); } catch (e) { log('import.undo.skipped', { path: vp, why: e.message }); }
      }
    }
    if (fs.existsSync(store.dir)) moveAside(store.dir, path.join(undone, 'atelier'));
    if (fs.existsSync(path.join(before, 'atelier'))) fs.cpSync(path.join(before, 'atelier'), store.dir, { recursive: true });
    rec.undone = { at: new Date().toISOString(), by };
    saveRec(rec);
    log('import.undone', { id, kind: rec.kind, by });
    return rec;
  }

  return { preview, apply, undo, records, staged: () => [...staged.keys()] };
}

module.exports = { decode, encrypted, prepare, build, atelierStore, createImports, migrateRules, isKey, isConfigPath };
