// Her things on the host, one copy for every device (parity step 1): the Atelier's chats and branches, schedules,
// ritual runs, settings, heartbeat and spark markers and the rest it used to keep in each browser, and her run history.
//
// The page served by the host keeps them here instead of in the browser (host/bridge.js, app/modules/hoststate.js):
//   - "ls" keys: what the page kept in localStorage (her settings are one of them). A few stay on each device (which
//     chat is open, a draft, her own API keys, each device's own model addresses); bridge.js keeps those back.
//   - "db" keys: what the page kept in IndexedDB (sessions, session:<id>, schedules, flowRuns, jadekv).
//   - runs: her run history (the trajectory log).
// They live in the same files the Atelier's backup import writes (host/backup.cjs atelierStore), so bringing her
// things in and using them are one and the same.
//
// Two devices at once: every key has a revision. A write says which revision it started from. Her chat and schedule
// lists are merged when someone else wrote in between (what they added stays, what this device removed goes), so no
// device loses another's new chat; other keys are last-write-wins. Every change is told to every open page.
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const MERGED = new Set(['sessions', 'schedules']);   // lists of { id, … }
const DB_KEY = /^[A-Za-z0-9_:.\-]{1,120}$/;
const LS_KEY = /^[A-Za-z0-9_:.\-]{1,80}$/;
const RUN_ID = /^[A-Za-z0-9_.\-]{1,80}$/;
const HISTORY = 30;

function createState({ store, dir, log = () => {} }) {
  const runsDir = path.join(dir, 'runs');
  const rev = new Map();      // 'ls:<k>' | 'db:<k>' | 'runs' → n
  const history = new Map();  // 'db:sessions' → Map(rev → value), for merging
  const listeners = new Set();
  const bump = (k) => { const n = (rev.get(k) || 0) + 1; rev.set(k, n); return n; };
  const tell = (e) => { for (const f of listeners) { try { f(e); } catch { /* a listener never stops a write */ } } };
  const remember = (k, n, v) => { if (!MERGED.has(k.slice(3))) return; let h = history.get(k); if (!h) history.set(k, (h = new Map())); h.set(n, JSON.parse(JSON.stringify(v))); while (h.size > HISTORY) h.delete(h.keys().next().value); };

  // ---- ls ----
  function lsAll() {
    const out = { ...store.storage() };
    const s = store.settings(); if (s && Object.keys(s).length) out.settings = s;
    return { values: out, revs: Object.fromEntries([...rev].filter(([k]) => k.startsWith('ls:')).map(([k, n]) => [k.slice(3), n])) };
  }
  function lsSet(key, value, by, page) {
    if (!LS_KEY.test(key)) throw Object.assign(new Error('Not a key the host keeps.'), { status: 400 });
    if (key === 'settings') store.setSettings(value && typeof value === 'object' ? value : {});
    else { const st = store.storage(); if (value === undefined || value === null) delete st[key]; else st[key] = value; store.setStorage(st); }
    const n = bump('ls:' + key);
    tell({ kind: 'ls', key, rev: n, page });
    if (key === 'settings') log('state.settings', { by });
    return { rev: n };
  }

  // ---- db ----
  function dbGet(key) {
    if (!DB_KEY.test(key)) throw Object.assign(new Error('Not a key the host keeps.'), { status: 400 });
    const v = store.get(key);
    const k = 'db:' + key; const n = rev.get(k) || 0;
    if (n && v !== undefined) remember(k, n, v);
    return { value: v === undefined ? null : v, rev: n, exists: v !== undefined };
  }
  /** A list merge: what others added since `base` stays (first, newest), what this write removed goes. */
  function mergeList(baseVal, current, incoming) {
    const ids = (a) => new Set((Array.isArray(a) ? a : []).filter((x) => x && x.id != null).map((x) => String(x.id)));
    const inc = Array.isArray(incoming) ? incoming : [];
    const incIds = ids(inc), baseIds = baseVal ? ids(baseVal) : null;
    const removed = baseIds ? new Set([...baseIds].filter((id) => !incIds.has(id))) : new Set();
    const theirs = (Array.isArray(current) ? current : []).filter((x) => x && x.id != null && !incIds.has(String(x.id)) && !removed.has(String(x.id)) && (!baseIds || !baseIds.has(String(x.id))));
    return [...theirs, ...inc];
  }
  function dbSet(key, value, base, by, page) {
    if (!DB_KEY.test(key)) throw Object.assign(new Error('Not a key the host keeps.'), { status: 400 });
    const k = 'db:' + key; const now = rev.get(k) || 0;
    let out = value, merged = false;
    if (MERGED.has(key) && base !== undefined && base !== null && Number(base) !== now) {
      const cur = store.get(key);
      const baseVal = (history.get(k) || new Map()).get(Number(base));
      out = mergeList(baseVal, cur, value); merged = true;
      log('state.merged', { key, base: Number(base), now });
    }
    store.set(key, out);
    const n = bump(k); remember(k, n, out);
    tell({ kind: 'db', key, rev: n, page });
    return merged ? { rev: n, merged: true, value: out } : { rev: n };
  }
  function dbDel(key, page) {
    if (!DB_KEY.test(key)) throw Object.assign(new Error('Not a key the host keeps.'), { status: 400 });
    try { fs.rmSync(path.join(store.dir, 'db', encodeURIComponent(key) + '.json'), { force: true }); } catch { /* gone already */ }
    const n = bump('db:' + key);
    tell({ kind: 'db', key, rev: n, page, deleted: true });
    return { rev: n };
  }
  function dbKeys(prefix = '') { return Object.keys(store.db()).filter((k) => k.startsWith(prefix)); }
  function dbAll() { return store.db(); }

  // ---- runs (her run history) ----
  const runFile = (id) => path.join(runsDir, encodeURIComponent(id) + '.json');
  function runPut(rec, page) {
    const id = String(rec && rec.id || '');
    if (!RUN_ID.test(id)) throw Object.assign(new Error('A run needs an id.'), { status: 400 });
    fs.mkdirSync(runsDir, { recursive: true });
    fs.writeFileSync(runFile(id) + '.tmp', JSON.stringify(rec)); fs.renameSync(runFile(id) + '.tmp', runFile(id));
    tell({ kind: 'run', key: id, rev: bump('runs'), page });
    return { ok: true };
  }
  const runGet = (id) => { if (!RUN_ID.test(id)) return null; try { return JSON.parse(fs.readFileSync(runFile(id), 'utf8')); } catch { return null; } };
  function runAll() { let names = []; try { names = fs.readdirSync(runsDir); } catch { return []; } return names.filter((n) => n.endsWith('.json')).map((n) => { try { return JSON.parse(fs.readFileSync(path.join(runsDir, n), 'utf8')); } catch { return null; } }).filter(Boolean); }
  function runCount() { try { return fs.readdirSync(runsDir).filter((n) => n.endsWith('.json')).length; } catch { return 0; } }
  function runDel(id, page) { if (RUN_ID.test(id)) fs.rmSync(runFile(id), { force: true }); tell({ kind: 'run', key: id, rev: bump('runs'), page, deleted: true }); return { ok: true }; }
  function runClear(page) { fs.rmSync(runsDir, { recursive: true, force: true }); tell({ kind: 'run', key: '*', rev: bump('runs'), page, deleted: true }); return { ok: true }; }

  // ---- her apps on the table (webxdc): each app, and its stream of updates ----
  const xdcDir = path.join(dir, 'xdc');
  const appFile = (id) => path.join(xdcDir, 'apps', encodeURIComponent(id) + '.json');
  const updFile = (id) => path.join(xdcDir, 'updates', encodeURIComponent(id) + '.jsonl');
  const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
  const writeJson = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f + '.tmp', JSON.stringify(v)); fs.renameSync(f + '.tmp', f); };
  const checkApp = (id) => { if (!RUN_ID.test(String(id || ''))) throw Object.assign(new Error('Not an app the host keeps.'), { status: 400 }); return String(id); };
  function xdcApps() { let names = []; try { names = fs.readdirSync(path.join(xdcDir, 'apps')); } catch { return []; } return names.filter((n) => n.endsWith('.json')).map((n) => readJson(path.join(xdcDir, 'apps', n))).filter(Boolean); }
  const xdcApp = (id) => readJson(appFile(checkApp(id)));
  function xdcUpdates(id, after = 0, limit = 100000) {
    let lines = []; try { lines = fs.readFileSync(updFile(checkApp(id)), 'utf8').split('\n'); } catch { return []; }
    const out = []; for (const l of lines) { if (!l) continue; try { const u = JSON.parse(l); if (u.serial > after) out.push(u); } catch { /* a torn line */ } }
    return out.sort((a, b) => a.serial - b.serial).slice(0, limit);
  }
  /** An app, and any updates it sent with it: serials stay in order on the host, even when two devices send at once. */
  function xdcPut(id, app, updates, page) {
    checkApp(id);
    const ups = Array.isArray(updates) ? updates : [];
    let max = xdcUpdates(id).reduce((m, u) => Math.max(m, u.serial), 0);
    const kept = [];
    for (const u of ups) { const v = { ...u, app: id }; if (!(v.serial > max)) v.serial = max + 1; max = v.serial; kept.push(v); }
    if (kept.length) { fs.mkdirSync(path.dirname(updFile(id)), { recursive: true }); fs.appendFileSync(updFile(id), kept.map((u) => JSON.stringify(u)).join('\n') + '\n'); }
    if (app) { const a = { ...app, id }; if (kept.length) a.serial = Math.max(a.serial || 0, max); writeJson(appFile(id), a); }
    tell({ kind: 'xdc', key: id, rev: bump('xdc:' + id), page, updates: kept.length });
    return { serials: kept.map((u) => u.serial) };
  }
  function xdcDel(id, page) { checkApp(id); fs.rmSync(appFile(id), { force: true }); fs.rmSync(updFile(id), { force: true }); tell({ kind: 'xdc', key: id, rev: bump('xdc:' + id), page, deleted: true }); return { ok: true }; }
  function xdcClear(id, page) { checkApp(id); fs.rmSync(updFile(id), { force: true }); tell({ kind: 'xdc', key: id, rev: bump('xdc:' + id), page }); return { ok: true }; }

  /** Facts for the keeper's view of her house: how much there is, never what it says. */
  function facts() {
    const sessions = store.get('sessions'), schedules = store.get('schedules');
    const st = store.storage();
    return {
      chats: Array.isArray(sessions) ? sessions.length : 0,
      lastChat: Array.isArray(sessions) && sessions.length ? (sessions.map((x) => x && (x.updated || x.created || x.t)).filter(Boolean).sort().pop() || null) : null,
      schedules: Array.isArray(schedules) ? schedules.map((x) => ({ name: String((x && (x.name || x.title)) || 'a schedule').slice(0, 60), on: !(x && x.enabled === false), job: !!(x && /^(shell|flow|playbook)$/.test(x.kind || '')), status: String((x && x.lastStatus) || '').slice(0, 80), next: (x && x.nextRun) || null })) : [],
      runs: runCount(),
      skillsOff: Array.isArray(st.skillsOff) ? st.skillsOff.length : 0,
      approvals: st.pbApproved && typeof st.pbApproved === 'object' ? Object.keys(st.pbApproved).length : 0,
      apps: xdcApps().map((a) => ({ name: String(a.name || 'an app').slice(0, 60), lastActive: a.lastActive || a.opened || a.installed || null })),
    };
  }

  return { lsAll, lsSet, dbGet, dbSet, dbDel, dbKeys, dbAll, xdcApps, xdcApp, xdcUpdates, xdcPut, xdcDel, xdcClear, runPut, runGet, runAll, runCount, runDel, runClear, facts, onChange: (f) => (listeners.add(f), () => listeners.delete(f)), mergeList };
}

module.exports = { createState, MERGED };
