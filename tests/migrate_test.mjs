// Moving day: a Jade Vault install or backup becomes Pandora Dee's. /Jade → /Pandora, flows → rituals,
// the migration log, settings and run history that follow the files, and old /Jade paths that still resolve.
import fs from 'node:fs';
import { start } from './_harness.mjs';
const { page, ok, sh, read, done } = await start();
const E = (fn, arg) => page.evaluate(fn, arg);
const reloaded = async () => {
  await page.waitForEvent('load', { timeout: 15000 }).catch(() => {});
  await page.waitForFunction(() => typeof flowRun === 'function' && typeof userShell !== 'undefined' && S.model && typeof Sched !== 'undefined', null, { timeout: 90000 });
  await page.waitForTimeout(1500);
};
const FLOW = { name: 'Digest', enabled: true, trigger: { type: 'manual' }, steps: [{ id: 's1', type: 'set', fields: { ok: 'yes' } }] };

// ---------- a fresh install: Pandora's home is ready ----------
let st = await E(() => ({ home: vfs.isDir('/Pandora'), rituals: vfs.isDir('/Pandora/Rituals'), logs: vfs.isDir('/Pandora/Logs'), soul: vfs.isFile('/Pandora/SOUL.md'), mem: vfs.isFile('/Pandora/Memory.md'), jade: [...vfs.nodes.keys()].some(p => p === '/Jade' || p.startsWith('/Jade/')) }));
ok(st.home && st.rituals && st.logs && st.soul && st.mem && !st.jade, 'fresh install: /Pandora with Rituals and Logs, her files there, no /Jade: ' + JSON.stringify(st));

// ---------- an old Jade Vault install, moved on boot ----------
await E(async (flow) => {
  for (const k of [...vfs.nodes.keys()]) if (k === '/Pandora' || k.startsWith('/Pandora/')) vfs.nodes.delete(k);
  const put = (p, t) => vfs.write(p, t, { mkdirs: true });
  put('/Jade/SOUL.md', '# SOUL\n\nYou are Pandora, a kitty-hearted mad scientist.\n');
  put('/Jade/Memory.md', '# Memory\n\n## Facts\n- The Partner is Mrrowr-murrr\n');
  put('/Jade/Journal/2026-10-01.md', '# 2026-10-01\n\nWe moved house.\n');
  put('/Jade/Journal.md', '# Journal\n');
  put('/Jade/skills/purr/SKILL.md', '---\nname: purr\ndescription: Purr on request\n---\nPurr.\n');
  put('/Jade/mcp.json', '{ "mcpServers": {} }\n');
  put('/Jade/Logs/cron.log', 'old line\n');
  put('/Jade/Flows/Digest.flow.json', JSON.stringify(flow, null, 2));
  put('/Jade/Templates/Day.md', '# {{date}}\n');
  put('/Pandora/HEARTBEAT.md', '# Heartbeat\n\nnew one\n');
  put('/Jade/HEARTBEAT.md', '# Heartbeat\n\nold one\n');
  await idb.set('pendingSettings', { ...S, tplDir: '/Jade/Templates' });   // applied at boot like a restore, so no autosave can undo it first
  await idb.set('flowRuns', [{ id: 'r1', flow: 'Digest', path: '/Jade/Flows/Digest.flow.json', status: 'ok', via: 'manual', started: Date.now() - 5000, ended: Date.now() - 4000, steps: [] }]);
  vfs.persist(); await new Promise(r => setTimeout(r, 400));
}, FLOW);
await page.reload(); await reloaded();
st = await E(() => ({
  jade: [...vfs.nodes.keys()].filter(p => p === '/Jade' || p.startsWith('/Jade/')),
  soul: vfs.isFile('/Pandora/SOUL.md') && vfs.read('/Pandora/SOUL.md'), mem: vfs.isFile('/Pandora/Memory.md') && vfs.read('/Pandora/Memory.md'),
  journal: vfs.isFile('/Pandora/Journal/2026-10-01.md'), skill: vfs.isFile('/Pandora/skills/purr/SKILL.md'), mcp: vfs.isFile('/Pandora/mcp.json'),
  cron: vfs.isFile('/Pandora/Logs/cron.log') && vfs.read('/Pandora/Logs/cron.log'), ritual: vfs.isFile('/Pandora/Rituals/Digest.ritual.json'),
  hb: vfs.read('/Pandora/HEARTBEAT.md'), aside: vfs.isFile('/Pandora/HEARTBEAT (from Jade Vault).md') && vfs.read('/Pandora/HEARTBEAT (from Jade Vault).md'),
  tpl: S.tplDir, log: vfs.isFile(MIGRATION_LOG) ? vfs.read(MIGRATION_LOG) : '',
}));
ok(!st.jade.length && /kitty-hearted/.test(st.soul) && /Mrrowr-murrr/.test(st.mem) && st.journal && st.skill && st.mcp && st.cron === 'old line\n', 'boot: her SOUL, memory, journal, skills, MCP config and logs move from /Jade to /Pandora: ' + JSON.stringify({ ...st, log: undefined }).slice(0, 300));
ok(st.ritual, 'boot: /Jade/Flows/Digest.flow.json becomes /Pandora/Rituals/Digest.ritual.json');
ok(/new one/.test(st.hb) && /old one/.test(st.aside || ''), 'boot: when /Pandora already has a different file, both are kept (the old one "from Jade Vault")');
ok(st.tpl === '/Pandora/Templates', 'boot: a setting that pointed into /Jade follows the files: ' + st.tpl);
ok(/boot: moved \/Jade\/SOUL\.md → \/Pandora\/SOUL\.md/.test(st.log) && /Digest\.flow\.json → \/Pandora\/Rituals\/Digest\.ritual\.json/.test(st.log) && /kept as \/Pandora\/HEARTBEAT \(from Jade Vault\)\.md/.test(st.log) && /setting tplDir/.test(st.log) && /moving day done, 10 file/.test(st.log), 'boot: every move is written to /Pandora/Logs/migration.log:\n' + st.log.split('\n').slice(-4).join('\n'));
st = await E(async () => { await flowRecordsLoad(); const f = flowFind('Digest'); return { f: f?._path, runs: FlowRuns.recent.filter(r => r.path === f?._path).length, sys: systemPrompt() }; });
ok(st.f === '/Pandora/Rituals/Digest.ritual.json' && st.runs === 1, 'boot: the ritual loads and keeps its run history: ' + JSON.stringify({ f: st.f, runs: st.runs }));
ok(/kitty-hearted/.test(st.sys) && /Mrrowr-murrr/.test(st.sys) && /Purr on request/.test(st.sys), 'boot: her prompt reads SOUL, memory and skills from /Pandora');
const logBefore = await read('/Pandora/Logs/migration.log');
await page.reload(); await reloaded();
ok(await read('/Pandora/Logs/migration.log') === logBefore, 'boot: nothing to do (and nothing logged) once /Jade is gone');

// ---------- old paths still work ----------
let r = await sh('cat /Jade/SOUL.md; echo hi >> /Jade/Logs/mine.log; ls /Jade/Flows; cd /Jade && pwd');
ok(/kitty-hearted/.test(r.out) && /Digest\.ritual\.json/.test(r.out) && /\/Pandora\n?$/.test(r.out) && (await read('/Pandora/Logs/mine.log')) === 'hi\n', 'shell: /Jade/... reads and writes /Pandora/...: ' + JSON.stringify(r.out.slice(-120)));
r = await sh(`node -e "const fs = require('fs'); console.log(fs.readFileSync('/Jade/Memory.md', 'utf8').includes('Mrrowr')); fs.writeFileSync('/Jade/Logs/node.log', 'from node');"`);
ok(/true/.test(r.out) && (await read('/Pandora/Logs/node.log')) === 'from node' && !(await E(() => vfs.exists('/Jade'))), 'node scripts: /Jade/... reads and writes /Pandora/...: ' + r.out + r.err);
r = await sh('flow run Digest');
ok(/ok|yes/.test(r.out), 'the migrated ritual runs from the shell: ' + r.out.slice(0, 120));

// ---------- .flow.json still loads; saving makes it .ritual.json ----------
st = await E((flow) => {
  vfs.write('/Pandora/Rituals/Older.flow.json', JSON.stringify({ ...flow, name: 'Older' }));
  vfs.write('/Pandora/Rituals/Twin.flow.json', JSON.stringify({ ...flow, name: 'Twin', description: 'old' }));
  vfs.write('/Pandora/Rituals/Twin.ritual.json', JSON.stringify({ ...flow, name: 'Twin', description: 'new' }));
  const f = flowFind('Older'); const before = f?._path; const saved = flowSave(f, f._path);
  return { before, after: saved._path, gone: !vfs.exists(before), twins: flowList().filter(x => x.name === 'Twin').map(x => x.description) };
}, FLOW);
ok(st.before === '/Pandora/Rituals/Older.flow.json' && st.after === '/Pandora/Rituals/Older.ritual.json' && st.gone, '.flow.json still loads, and is saved back as .ritual.json: ' + JSON.stringify(st));
ok(st.twins.length === 1 && st.twins[0] === 'new', 'a .ritual.json wins over a .flow.json of the same name');
st = await E(() => flowSave({ name: 'Brand New', steps: [] })._path);
ok(st === '/Pandora/Rituals/Brand New.ritual.json', 'new rituals save as /Pandora/Rituals/<name>.ritual.json');

// ---------- a full Jade Vault backup imports cleanly ----------
const OUT = process.cwd();
const backup = { app: 'jade-vault', format: 1, kind: 'full', exportedAt: '2026-09-30T12:00:00.000Z', includesKeys: false,
  settings: { model: 'qwen3:8b', journalOn: false, tplDir: '/Jade/Templates', temperature: 0.4 }, storage: {},
  vault: { dirs: ['/Jade', '/Jade/Flows', '/Jade/Journal', '/projects'], files: {
    '/Welcome.md': '# Welcome\n', '/projects/Alpha.md': '# Alpha\n',
    '/Jade/SOUL.md': '# SOUL\n\nYou are Pandora, from the backup.\n', '/Jade/Memory.md': '# Memory\n\n- from the backup\n',
    '/Jade/Journal/2026-09-29.md': '# 2026-09-29\n', '/Jade/Flows/Weekly.flow.json': JSON.stringify({ ...FLOW, name: 'Weekly' }),
    '/Jade/Logs/migration.log': '', '/Jade/Discord Inbox.md': '# Discord Inbox\n' } },
  db: { sessions: [], schedules: [], flowRuns: [{ id: 'b1', flow: 'Weekly', path: '/Jade/Flows/Weekly.flow.json', status: 'ok', via: 'schedule', started: 1, ended: 2, steps: [] }] } };
fs.writeFileSync(OUT + '/jade-backup.json', JSON.stringify(backup));
page.once('dialog', d => d.accept());
await page.setInputFiles('#importBackup', OUT + '/jade-backup.json');
await reloaded();
st = await E(async () => { await flowRecordsLoad(); return {
  jade: [...vfs.nodes.keys()].filter(p => p === '/Jade' || p.startsWith('/Jade/')),
  soul: vfs.isFile('/Pandora/SOUL.md') && vfs.read('/Pandora/SOUL.md'), journal: vfs.isFile('/Pandora/Journal/2026-09-29.md'), inbox: vfs.isFile('/Pandora/Discord Inbox.md'),
  ritual: flowFind('Weekly')?._path, runs: FlowRuns.recent.filter(r => r.path === '/Pandora/Rituals/Weekly.ritual.json').length,
  alpha: vfs.isFile('/projects/Alpha.md'), tpl: S.tplDir, temp: S.temperature, log: vfs.isFile(MIGRATION_LOG) ? vfs.read(MIGRATION_LOG) : '' }; });
ok(!st.jade.length && /from the backup/.test(st.soul) && st.journal && st.inbox && st.alpha, 'import: a Jade Vault backup lands in /Pandora, notes stay put: ' + JSON.stringify({ ...st, log: undefined }).slice(0, 260));
ok(st.ritual === '/Pandora/Rituals/Weekly.ritual.json' && st.runs === 1, 'import: its flows become rituals and keep their run history');
ok(st.tpl === '/Pandora/Templates' && st.temp === 0.4, 'import: settings come along, paths moved to /Pandora');
ok(/import: \/Jade\/SOUL\.md → \/Pandora\/SOUL\.md/.test(st.log) && /import: \/Jade\/Flows\/Weekly\.flow\.json → \/Pandora\/Rituals\/Weekly\.ritual\.json/.test(st.log) && /path\(s\) from a Jade Vault backup now live in \/Pandora/.test(st.log), 'import: the moves are in the migration log:\n' + st.log.split('\n').slice(-3).join('\n'));

// ---------- a Jade Vault config backup merges into /Pandora ----------
const cfg = { app: 'jade-vault', format: 1, kind: 'config', exportedAt: '2026-10-02T12:00:00.000Z', settings: {}, storage: {},
  vault: { files: { '/Jade/SOUL.md': '# SOUL\n\nYou are Pandora, from the config.\n', '/Jade/skills/sing/SKILL.md': '---\nname: sing\ndescription: Sing\n---\n' } } };
fs.writeFileSync(OUT + '/jade-config.json', JSON.stringify(cfg));
page.once('dialog', d => d.accept());
await page.setInputFiles('#importBackup', OUT + '/jade-config.json');
await reloaded();
st = await E(() => ({ soul: vfs.read('/Pandora/SOUL.md'), skill: vfs.isFile('/Pandora/skills/sing/SKILL.md'), alpha: vfs.isFile('/projects/Alpha.md'), jade: [...vfs.nodes.keys()].some(p => p.startsWith('/Jade')), log: vfs.read(MIGRATION_LOG) }));
ok(/from the config/.test(st.soul) && st.skill && st.alpha && !st.jade && /import: \/Jade\/skills\/sing\/SKILL\.md → \/Pandora\/skills\/sing\/SKILL\.md/.test(st.log), 'config import: /Jade files replace their /Pandora twins, the rest stays: ' + JSON.stringify({ ...st, log: undefined }).slice(0, 200));

// ---------- her own backups keep the format Jade Vault reads ----------
st = await E(async () => { const b = await buildBackup('config', false); return { app: b.app, soul: !!b.vault.files['/Pandora/SOUL.md'], skill: !!b.vault.files['/Pandora/skills/sing/SKILL.md'] }; });
ok(st.app === 'jade-vault' && st.soul && st.skill, 'config export: /Pandora files count as config; the backup format is unchanged: ' + JSON.stringify(st));
await done();
