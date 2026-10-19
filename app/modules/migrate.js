/* =====================================================================
   MOVING DAY — Jade Vault's files become Pandora Dee's.
   Her own files move from /Jade to /Pandora, and flows become rituals:
     /Jade/SOUL.md → /Pandora/SOUL.md, /Jade/Flows/<name>.flow.json → /Pandora/Rituals/<name>.ritual.json
   It runs at every boot (nothing to do once /Jade is gone) and on importing a backup, so an old Jade Vault
   backup comes in cleanly. Old paths keep working: vfs.norm reads /Jade/... as /Pandora/..., so scripts,
   schedules and crontab lines that name /Jade still find their files. Browser storage keys stay as they are.
   Every move is written to /Pandora/Logs/migration.log.
   ===================================================================== */
const PD_HOME = '/Pandora', PD_LOGS = '/Pandora/Logs', PD_RITUALS = '/Pandora/Rituals', MIGRATION_LOG = '/Pandora/Logs/migration.log';
// literals only: vfs.norm calls this before the constants above exist
function pandoraPath(p) {
  p = String(p);
  if (p !== '/Jade' && !p.startsWith('/Jade/')) return p;
  let rest = p.slice(5);
  if (rest === '/Flows' || rest.startsWith('/Flows/')) {
    rest = '/Rituals' + rest.slice(6);
    if (rest.endsWith('.flow.json')) rest = rest.slice(0, -'.flow.json'.length) + '.ritual.json';
  }
  return '/Pandora' + rest;
}
function migrationLog(lines) {
  if (!lines.length) return;
  const at = new Date().toISOString().slice(0, 19).replace('T', ' ');
  vfs.mkdirp(PD_LOGS); vfs.append(MIGRATION_LOG, lines.map(l => `${at} ${l}\n`).join(''));
}
const sameBytes = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
// where a /Jade file goes when /Pandora already has a different one: next to it, both kept
function migrationAside(p) {
  const m = /^(.*?)((?:\.ritual|\.flow)?\.[^./]+)?$/.exec(p);
  for (let i = 1; ; i++) { const q = `${m[1]} (from Jade Vault${i > 1 ? ' ' + i : ''})${m[2] || ''}`; if (!vfs.exists(q)) return q; }
}
// settings that hold a path (the templates folder, for example) follow the files
function migrateSettingPaths(settings, why, log) {
  let n = 0;
  for (const [k, v] of Object.entries(settings || {})) if (typeof v === 'string' && pandoraPath(v) !== v) { settings[k] = pandoraPath(v); log.push(`${why}: setting ${k} ${v} → ${settings[k]}`); n++; }
  return n;
}
const migrateRuns = runs => Array.isArray(runs) ? runs.map(r => r && typeof r.path === 'string' && pandoraPath(r.path) !== r.path ? { ...r, path: pandoraPath(r.path) } : r) : runs;

// at boot, before anything reads her files
async function movingDay() {
  const log = [];
  const old = [...vfs.nodes.keys()].filter(p => p === '/Jade' || p.startsWith('/Jade/')).sort();
  let moved = 0;
  for (const p of old) {
    const n = vfs.nodes.get(p); const to = pandoraPath(p);
    if (n.dir) { if (!vfs.isFile(to)) vfs.mkdirp(to); continue; }
    vfs.mkdirp(vfs.parent(to)); moved++;
    if (!vfs.exists(to)) { vfs.nodes.set(to, n); log.push(`boot: moved ${p} → ${to}`); }
    else if (vfs.isFile(to) && sameBytes(vfs.readBytes(to), n.data)) log.push(`boot: ${p} was already at ${to}`);
    else { const aside = migrationAside(to); vfs.nodes.set(aside, n); log.push(`boot: ${to} already exists, so ${p} was kept as ${aside}`); }
  }
  if (old.length) { for (const p of old) vfs.nodes.delete(p); vfs.changed(); }
  for (const d of [PD_HOME, PD_RITUALS, PD_LOGS]) if (!vfs.isDir(d) && !vfs.isFile(d)) vfs.mkdirp(d);
  if (migrateSettingPaths(S, 'boot', log)) ls.set('settings', S);
  const runs = await idb.get('flowRuns');
  if (Array.isArray(runs) && runs.some(r => r?.path && pandoraPath(r.path) !== r.path)) { await idb.set('flowRuns', migrateRuns(runs)); log.push('boot: ritual run history now points at /Pandora/Rituals'); }
  if (old.length) log.push(`boot: moving day done, ${moved} file(s) from /Jade now live in /Pandora`);
  migrationLog(log);
  return log;
}

// on import: a Jade Vault backup's paths become Pandora Dee's before anything is written
function migrateBackup(data) {
  const log = []; const v = data.vault || {};
  const files = {};
  for (const [p, x] of Object.entries(v.files || {})) {
    const to = pandoraPath(p);
    if (to !== p) log.push(`import: ${p} → ${to}`);
    if (to in files && to !== p) continue;   // a /Pandora file in the same backup wins
    files[to] = x;
  }
  v.files = files;
  v.dirs = [...new Set((v.dirs || []).map(pandoraPath))].sort();
  migrateSettingPaths(data.settings, 'import', log);
  if (data.db?.flowRuns) data.db.flowRuns = migrateRuns(data.db.flowRuns);
  if (log.length) log.push(`import: ${log.filter(l => / → \/Pandora\//.test(l) && !/setting/.test(l)).length} path(s) from a Jade Vault backup now live in /Pandora`);
  return log;
}
