// The Harbor: the host's own page for everything its window can do (host/harbor.html), and the routes behind it.
//
// Words from Pandora's ISLANDS lexicon: the host is the harbor; each resident is an island; devices are ferries; a
// fresh client asking for a home waits at the reef; the person who looks after the host is its keeper.
//
// Who may do what:
//   - The keeper's ferries: paired once, at the host itself, with the PIN the host shows (`POST /host/harbor/keeper`).
//     Kept apart from every resident's devices (keepers.json, only SHA-256s), so looking after the harbor is never a
//     key to any one resident, and no resident's device is a key to the harbor.
//   - Seeing the harbor: a keeper's ferry, from this machine, the home network or the tailnet.
//   - Changing anything (a new island, moving one, a PIN, the reef, her service): a keeper's ferry, at the host itself
//     only, straight from this machine with no proxy between, as the host's own window is.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const separate = require('./separate.cjs');
const { requestPlace, mayChange } = require('./places.cjs');

// each island's land: how she looks on the open sea (the regions, and so her abilities, are the same on every land)
const LANDS = ['tropics', 'highlands', 'oasis', 'fjord', 'maple', 'atoll'];
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const bearer = (req) => { const m = /^Bearer\s+(\S+)$/i.exec(String(req.headers.authorization || '')); return m ? m[1] : ''; };

/**
 * ctx (from createHomeHost): { first, stateDir, pins, residents(), resident(id), entryOf(id), addResident, setRun,
 *   setHostShell, setAccess, waiting(), answer(id, yes), servicePlan(id), send, readJson, fromElsewhere, trustNets,
 *   elevate?(file) }
 */
function createHarbor(ctx) {
  const file = path.join(ctx.stateDir, 'keepers.json');
  let keepers = [];
  try { keepers = JSON.parse(fs.readFileSync(file, 'utf8')); if (!Array.isArray(keepers)) keepers = []; } catch { keepers = []; }
  const save = () => { fs.writeFileSync(file + '.tmp', JSON.stringify(keepers, null, 1)); fs.renameSync(file + '.tmp', file); };
  const keeperOf = (req) => {
    const t = bearer(req); if (!t) return null;
    const h = sha(t);
    return keepers.find((k) => k.hash.length === h.length && crypto.timingSafeEqual(Buffer.from(k.hash), Buffer.from(h))) || null;
  };
  const event = (k, d) => ctx.first.event(k, d);
  const worldFile = path.join(ctx.stateDir, 'harbor-world.json');
  let world = { lands: {} };
  try { world = JSON.parse(fs.readFileSync(worldFile, 'utf8')); if (!world || typeof world.lands !== 'object') world = { lands: {} }; } catch { world = { lands: {} }; }
  const saveWorld = () => { fs.writeFileSync(worldFile + '.tmp', JSON.stringify(world, null, 1)); fs.renameSync(worldFile + '.tmp', worldFile); };
  const landOf = (id, first) => (LANDS.includes(world.lands[id]) ? world.lands[id] : first ? 'tropics' : LANDS[parseInt(sha(id).slice(0, 6), 16) % LANDS.length]);
  const setLand = (id, land) => { if (!LANDS.includes(land)) throw fail(400, `A land is one of: ${LANDS.join(', ')}.`); world.lands[id] = land; saveWorld(); };
  const clean = (s) => String(s || '').replace(/[\x00-\x1f<>]/g, '').trim().slice(0, 60);
  const fail = (status, error) => Object.assign(new Error(error), { status });

  /** Asking the computer for the keeper's hand (admin): on Windows its own prompt, on the host's screen. */
  const elevate = ctx.elevate || ((f) => {
    if (process.platform !== 'win32') return { run: `sudo sh "${f}"`, asked: false };
    const ps = `Start-Process -FilePath cmd.exe -ArgumentList '/c','""${f.replace(/'/g, "''")}"" & pause' -Verb RunAs`;
    const c = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { stdio: 'ignore', windowsHide: true, detached: true });
    c.unref();
    return { asked: true };
  });

  async function view(atHost) {
    const list = ctx.residents();
    const islands = await Promise.all(list.map(async (r) => {
      const res = ctx.resident(r.id);
      const e = ctx.entryOf(r.id);
      const up = res.remote ? await res.up() : true;
      return {
        id: r.id, name: r.name, port: r.port, run: r.run, first: r.first, hostShell: r.hostShell, land: landOf(r.id, r.first),
        ...(r.run === 'service' ? { access: e.access || 'person' } : {}),
        up, home: atHost ? res.root : undefined,
        ferries: res.remote ? null : res.devices().length,
        created: e.created || null,
      };
    }));
    return { harbor: { name: ctx.first.name, version: ctx.version, platform: process.platform }, atHost, islands, reef: ctx.waiting(), keepers: keepers.length, lands: LANDS };
  }

  /** Handles /host/harbor and below. Resolves true if it was one of these. */
  return async function route(req, res, url) {
    const p = url.pathname;
    if (p !== '/host/harbor' && !p.startsWith('/host/harbor/')) return false;
    const { send } = ctx;
    if (ctx.fromElsewhere(req)) { event('refused.cross-site', { path: p }); send(res, 403, { error: 'Only pages from this host may ask it.' }); return true; }
    const atHost = separate.fromThisMachine(req);
    if ((p === '/host/harbor' || p === '/host/harbor/') && req.method === 'GET') {
      send(res, 200, fs.readFileSync(path.join(__dirname, 'harbor.html'), 'utf8'), { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; img-src 'self' data:" });
      return true;
    }
    // the page's paintings (host/harbor-art): open to anyone, like the page itself; they hold nothing
    const art = /^\/host\/harbor\/art\/([a-z0-9-]+)\.(png|jpg)$/.exec(p);
    if (art && req.method === 'GET') {
      const f = path.join(__dirname, 'harbor-art', art[1] + '.' + art[2]);
      if (!fs.existsSync(f)) { send(res, 404, { error: 'No such painting.' }); return true; }
      res.writeHead(200, { 'Content-Type': art[2] === 'jpg' ? 'image/jpeg' : 'image/png', 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff' });
      res.end(fs.readFileSync(f));
      return true;
    }
    // lighting the lantern: a keeper's ferry, paired at the host itself with the PIN it shows
    if (p === '/host/harbor/keeper' && req.method === 'POST') {
      if (!atHost) { event('refused.keeper-elsewhere'); send(res, 403, { error: 'The harbor\'s keeper pairs at the host itself.' }); return true; }
      const b = await ctx.readJson(req);
      const t = await ctx.pins.take(b.pin);
      if (!t.ok) { send(res, t.status, t.body); return true; }
      const token = crypto.randomBytes(32).toString('base64url');
      const k = { id: crypto.randomBytes(6).toString('hex'), name: clean(b.name) || 'the keeper', hash: sha(token), created: new Date().toISOString() };
      keepers.push(k); save();
      event('keeper.new', { keeper: k.id });
      send(res, 200, { token, name: k.name });
      return true;
    }
    if (p === '/host/harbor/hello' && req.method === 'GET') { const k = keeperOf(req); send(res, 200, { keeper: !!k, name: k ? k.name : null, atHost, harbor: ctx.first.name }); return true; }

    const k = keeperOf(req);
    if (!k) { send(res, 401, { error: 'This ferry isn\'t the harbor keeper\'s yet. Light the lantern: the PIN the host shows, at the host itself.' }); return true; }
    if (!mayChange(requestPlace(req, ctx.trustNets))) { send(res, 403, { error: 'The harbor can be seen from home or the tailnet only.' }); return true; }
    if (req.method === 'GET' && p === '/host/harbor/view') { send(res, 200, await view(atHost)); return true; }
    // tending her: her host settings and facts (never her vault, chats or a key's value)
    const tm = /^\/host\/harbor\/islands\/([a-z0-9-]+)\/tend$/.exec(p);
    if (tm && req.method === 'GET') {
      try { const v = await ctx.tendOf(tm[1], 'view', {}, k.name); send(res, 200, atHost ? v : { ...v, devices: v.devices.map(({ id, name, seen }) => ({ id, name, seen })) }); }
      catch (e) { send(res, e.status || 500, { error: e.message }); }
      return true;
    }
    const sm = /^\/host\/harbor\/islands\/([a-z0-9-]+)\/service$/.exec(p);
    if (req.method === 'GET' && sm) {
      if (!atHost) { send(res, 403, { error: 'Her service\'s steps are read at the host itself.' }); return true; }
      try {
        const plan = ctx.servicePlan(sm[1]);
        const files = {}; for (const n of [plan.install, plan.remove]) { try { files[n] = fs.readFileSync(path.join(plan.dir, n), 'utf8'); } catch { files[n] = plan.files[n]; } }
        send(res, 200, { identity: plan.identity, name: plan.name, how: plan.how, dir: plan.dir, install: plan.install, remove: plan.remove, files, written: plan.written !== false, why: plan.why || null });
      } catch (e) { send(res, e.status || 500, { error: e.message }); }
      return true;
    }
    if (req.method !== 'POST') { send(res, 405, { error: 'Not that way.' }); return true; }
    // ---- everything below changes the harbor: at the host itself only ----
    if (!atHost) { event('refused.harbor-elsewhere', { path: p, keeper: k.id }); send(res, 403, { error: 'This changes the harbor, so it is done at the host itself.' }); return true; }
    const b = await ctx.readJson(req);
    try {
      if (p === '/host/harbor/pin') { send(res, 200, { pin: ctx.pins.newPin(), minutes: 10 }); return true; }
      if (p === '/host/harbor/islands') {
        if (b.land !== undefined && !LANDS.includes(b.land)) throw fail(400, `A land is one of: ${LANDS.join(', ')}.`);
        const r = ctx.addResident({ id: b.id, name: b.name, root: b.root || undefined, local: true, run: b.run, access: b.access, hostShell: b.hostShell }, `the harbor (${k.name})`);
        if (b.land !== undefined) setLand(r.id, b.land);
        send(res, 200, { id: r.id }); return true;
      }
      const ta = /^\/host\/harbor\/islands\/([a-z0-9-]+)\/tend\/([a-zA-Z]+)$/.exec(p);
      if (ta) {
        const TENDS = ['settings', 'resume', 'models', 'modelKey', 'modelBack', 'modelCheck', 'bridgeKey', 'release', 'backupKey', 'backupNow', 'hostBrowser'];
        if (!TENDS.includes(ta[2])) throw fail(400, 'Not something the keeper tends.');
        event('keeper.tend', { id: ta[1], op: ta[2], keeper: k.id });
        send(res, 200, await ctx.tendOf(ta[1], ta[2], b, `the keeper (${k.name})`)); return true;
      }
      const im = /^\/host\/harbor\/islands\/([a-z0-9-]+)(?:\/(service\/install|service\/remove|ferries\/([A-Za-z0-9]+)\/release))?$/.exec(p);
      if (im) {
        const id = im[1];
        if (im[2] === 'service/install' || im[2] === 'service/remove') {
          const plan = ctx.servicePlan(id);
          if (!plan.written && im[2] === 'service/install') throw fail(409, plan.why);
          const f = path.join(plan.dir, im[2].endsWith('install') ? plan.install : plan.remove);
          event(im[2].endsWith('install') ? 'service.install.asked' : 'service.remove.asked', { id });
          send(res, 200, elevate(f)); return true;
        }
        if (im[3]) {
          const r = ctx.resident(id); if (!r) throw fail(404, `No island "${id}".`);
          if (r.remote) throw fail(409, 'Her ferries are released at her own address, while she runs on her own.');
          send(res, 200, { released: !!r.revoke(im[3]) }); return true;
        }
        if (b.land !== undefined) { if (!ctx.resident(id)) throw fail(404, `No island "${id}".`); setLand(id, b.land); }
        if (b.run !== undefined) await ctx.setRun(id, b.run);
        if (b.access !== undefined) await ctx.setAccess(id, b.access);
        if (b.hostShell !== undefined) await ctx.setHostShell(id, !!b.hostShell);
        send(res, 200, { ok: true }); return true;
      }
      const rm = /^\/host\/harbor\/reef\/([a-z0-9-]+)$/.exec(p);
      if (rm) { if (b.welcome) ctx.answer(rm[1], true); else ctx.answer(rm[1], false); send(res, 200, { ok: true }); return true; }
      send(res, 404, { error: 'Not here.' }); return true;
    } catch (e) { send(res, e.status || 500, { error: e.message }); return true; }
  };
}

module.exports = { createHarbor };
