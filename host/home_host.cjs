// Pandora Dee's home host: her vault as a real folder on one computer, reached by her Atelier from any device on the
// home network or the tailnet. A first, synthetic-tested step towards the Atelier as a host plus clients.
//
// What it does:
//   - holds the home folder (`root`), the vault's `/`. It answers the same disk* calls the desktop app's preload and the
//     Android app answer (desktop/disk_host.cjs does the work), so app/modules/vfs_disk.js runs unchanged in a browser
//     opened on the host's address: the page gets them from host/bridge.js, synchronously, over the network;
//   - runs tools on the host itself, in the home folder: a real shell (host_shell), offered to the page as an MCP
//     server at /mcp, which the Atelier already knows how to use;
//   - lets in only paired devices. A device pairs once with a short PIN shown on the host, and gets its own token
//     (kept here only as its SHA-256). Without a token nothing but the hello and pairing answer;
//   - lets one page at a time write the vault (the writer), so two open windows can't overwrite each other's files.
//     Others can still read;
//   - keeps each device's own settings apart, and a log of what was done (pairings, tool calls, refusals).
//
// What it doesn't do yet (see host/README.md): chats, schedules and settings still live in each browser, and turns
// still run in the page. Those move to the host in later steps.

'use strict';
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { createDiskHost } = require('../desktop/disk_host.cjs');
const { createNap } = require('./nap.cjs');
const { createSettings } = require('./settings.cjs');
const { createQueue } = require('./queue.cjs');
const { createRedactor } = require('./redact.cjs');
const { createRuntime } = require('./runtime.cjs');
const { requestPlace, mayChange } = require('./places.cjs');
const { createModels } = require('./models.cjs');
const separate = require('./separate.cjs');
const { createHarbor } = require('./harbor.cjs');
const backup = require('./backup.cjs');
const { createState } = require('./state.cjs');
const { createLoop } = require('./loop.cjs');
const { createSteer } = require('./steer.cjs');
const { createMcp } = require('./mcp_client.cjs');
const { Cron } = require('./cron.cjs');

const VERSION = '0.1.0';
const PIN_MS = 10 * 60 * 1000;       // a PIN lasts ten minutes, and works once
const LOCK_AFTER = 5;                // wrong PINs in a row before pairing rests
const LOCK_MS = 5 * 60 * 1000;
const WRITER_MS = 30 * 1000;         // a writer page silent this long gives up the vault to the next
const DISK_BODY_MAX = 16 * 1048576;  // a disk call's body: a 3 MB piece, base64, with room to spare
const SHELL_OUT_MAX = 1048576;
const IMPORT_MAX = 1024 * 1048576;   // a backup file, whole (a big vault with its chats)
const WRITES = new Set(['put', 'mkdir', 'del', 'move', 'touch', 'clear', 'useShared']);

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const now = () => Date.now();

/** The shell host_shell runs: the one asked for, else Git Bash on Windows (cmd.exe without it), else bash, else sh. */
function findShell(asked) {
  if (asked) return asked;
  if (process.platform === 'win32') {
    for (const p of [process.env.PANDORA_HOST_BASH, 'C:\\Program Files\\Git\\bin\\bash.exe', 'C:\\Program Files (x86)\\Git\\bin\\bash.exe']) if (p && fs.existsSync(p)) return p;
    return process.env.ComSpec || 'cmd.exe';
  }
  for (const p of ['/bin/bash', '/usr/bin/bash', '/bin/sh']) if (fs.existsSync(p)) return p;
  return 'sh';
}
const shellArgs = (shell, command) => (/cmd(\.exe)?$/i.test(shell) ? ['/d', '/s', '/c', command] : ['-c', command]);

/** The host's PIN: one at a time, shown on the host itself, good once for ten minutes, resting after five wrong tries. */
function createPins(event) {
  let pin = null; // { code, until }
  let wrong = 0, lockedUntil = 0;
  return {
    newPin() {
      pin = { code: String(crypto.randomInt(0, 1000000)).padStart(6, '0'), until: now() + PIN_MS };
      event('pin.new');
      return pin.code;
    },
    /** { ok: true } and the PIN is used up, or { status, body } saying why not. */
    take(code) {
      if (now() < lockedUntil) return { status: 429, body: { error: 'Pairing is resting after too many wrong PINs. Try again in a few minutes.' } };
      const good = pin && now() < pin.until && typeof code === 'string' && code.length === pin.code.length && crypto.timingSafeEqual(Buffer.from(code), Buffer.from(pin.code));
      if (!good) {
        wrong++;
        if (wrong >= LOCK_AFTER) { lockedUntil = now() + LOCK_MS; wrong = 0; pin = null; event('pair.locked'); }
        event('pair.refused');
        return { status: 401, body: { error: 'That PIN is not the one the host is showing, or it has expired.' } };
      }
      wrong = 0; pin = null; // a PIN works once
      return { ok: true };
    },
  };
}

/**
 * One resident: her home folder, her own state folder (devices, log, settings, switches, keys, queue, models, the
 * Atelier's things), her own writer, nap and runtime. Nothing here reaches another resident's.
 *
 * opts: { root, state?, id?, name?, shell?, hostShell?, napGraceMs?, writerMs? }
 *   root       the home folder: the vault's "/"
 *   state      where the host keeps her records; default "<root> (host)", beside the home, not in it
 *   id, name   how the host knows her (`/r/<id>/…`), and what clients show
 *   shell      the program host_shell runs
 *   hostShell  false: no host_shell for her. The shell runs as the host's own account, so it is not walled off from
 *              the other residents' homes; a resident made from a client starts without it
 * shared: { pins, say, trustNets, page }, from the host
 */
function createResident(opts, shared) {
  const disk = createDiskHost(opts.root);
  const root = disk.root;
  const stateDir = path.resolve(opts.state || path.join(path.dirname(root), path.basename(root) + ' (host)'));
  fs.mkdirSync(stateDir, { recursive: true });
  const id = opts.id || 'home';
  const displayName = opts.name || id;
  let hostShell = opts.hostShell !== false;
  const devFile = path.join(stateDir, 'devices.json');
  const logFile = path.join(stateDir, 'events.jsonl');
  const shell = findShell(opts.shell);
  const say = (m) => shared.say(shared.many() ? `[${displayName}] ${m}` : m);
  const writerMs = Number(opts.writerMs) > 0 ? Number(opts.writerMs) : WRITER_MS;
  // more address ranges the person counts as the house's own network (--trust), beyond the usual private ones
  const trustNets = shared.trustNets;

  // ---------- devices and pairing ----------
  let devices = [];
  try { devices = JSON.parse(fs.readFileSync(devFile, 'utf8')); } catch { devices = []; }
  const saveDevices = () => { const t = devFile + '.tmp'; fs.writeFileSync(t, JSON.stringify(devices, null, 1)); fs.renameSync(t, devFile); };
  function event(kind, fields = {}) {
    try { fs.appendFileSync(logFile, JSON.stringify({ at: new Date().toISOString(), kind, ...fields }) + '\n'); } catch { /* the log never stops the work */ }
  }
  // what happened, contents included: what went to which model and what came back, bridge messages in and out, what was
  // stopped. Kept on the host, for the person to look at (the settings page shows it); never sent anywhere.
  const traceFile = path.join(stateDir, 'trace.jsonl');
  function trace(kind, fields = {}) {
    try { fs.appendFileSync(traceFile, JSON.stringify({ at: new Date().toISOString(), kind, ...fields }) + '\n'); } catch { /* as above */ }
  }
  // the settings and switches: one source of truth for every surface (host/settings.cjs)
  const settings = createSettings(stateDir, { log: event });
  // the redactor follows the settings' words (and always hides the home folder's path)
  let redactor = null;
  const rebuildRedactor = () => { redactor = createRedactor({ known: [...(settings.get().redactWords || []), root] }); };
  rebuildRedactor();
  settings.onChange((w) => { if (w === 'settings') rebuildRedactor(); });
  const redact = (t) => redactor(t);
  // awake only while a client is connected (host/nap.cjs); it starts asleep, with its switches off
  const graceMs = opts.napGraceMs ?? Number(settings.get().napGraceSec) * 1000;
  const nap = createNap({ graceMs, log: (kind, f) => {
    event(kind, f);
    if (kind === 'wake' || kind === 'nap') { settings.setNapping(kind === 'nap'); say(kind === 'wake' ? 'Awake: a client is connected.' : 'Napping: no client connected; her switches are off.'); }
  } });
  // the bridges' keys: the person types them into the settings page; they're kept here, owner-only, and never shown
  // back (sealing them as SEASIDE's resident vault does is a next step)
  const secretsFile = path.join(stateDir, 'bridge-secrets.json');
  const readSecrets = () => { try { return JSON.parse(fs.readFileSync(secretsFile, 'utf8')); } catch { return {}; } };
  function setBridgeToken(name, token) {
    const s = readSecrets(); if (token) s[name] = String(token); else delete s[name];
    fs.writeFileSync(secretsFile + '.tmp', JSON.stringify(s), { mode: 0o600 }); fs.renameSync(secretsFile + '.tmp', secretsFile);
    event('bridge.key.set', { bridge: name, set: !!token });
  }
  /** The bridges as set up in the settings: { <name>: { url, command?, args?, env? } }, with their keys. */
  // (keyEnv: a bridge that reads its key from the environment gets it from the host under that name, so no key is ever
  // kept in the settings. pandora-discord and pandora-vector keep their own key in their own folder instead.)
  const bridgeConfigs = () => Object.entries(settings.get().bridges || {}).map(([name, c]) => { const token = readSecrets()[name] || ''; return { name, url: c.url, command: c.command || null, args: c.args || [], env: { ...(c.env || {}), ...(c.keyEnv && token ? { [c.keyEnv]: token } : {}) }, token }; });
  const bridgeInfo = () => bridgeConfigs().map(({ name, url, command, token }) => ({ name, url, command: !!command, tokenSet: !!token }));
  // her models, as the host reaches them (host/models.cjs); their keys are write-only, in their own owner-only file
  const models = createModels({ settings, secretsFile: path.join(stateDir, 'model-secrets.json'), log: event });
  // what waited, on disk (host/queue.cjs)
  const queue = createQueue(path.join(stateDir, 'bridge-queue.jsonl'), { log: event, warnAt: Number(settings.get().queueWarnAt) || undefined });
  // her Atelier's own things (settings, storage, chats, schedules), brought here from a backup (host/backup.cjs)
  const store = backup.atelierStore(path.join(stateDir, 'atelier'));
  // her things, one copy for every device (parity step 1): the store above, with revisions, merging and a live stream
  const state = createState({ store, dir: path.join(stateDir, 'atelier'), log: event });
  // the person's configured keys from a backup whose box was ticked: into the host's own write-only key files, each
  // where the host looks for it (her models, her bridges), the rest owner-only in atelier-secrets.json; never shown
  const MODEL_KEYS = { ollamaKey: 'cloud', groqKey: 'groq', oaiKey: 'openai', lcppKey: 'llamacpp' };
  const BRIDGE_KEYS = { dcToken: 'discord', vecToken: 'vector' };
  const keyFiles = [path.join(stateDir, 'model-secrets.json'), secretsFile, path.join(stateDir, 'atelier-secrets.json')];
  const keySink = {
    apply(keys) {
      const done = []; const rest = (() => { try { return JSON.parse(fs.readFileSync(keyFiles[2], 'utf8')); } catch { return {}; } })(); let restN = 0;
      for (const [k, v] of Object.entries(keys)) {
        if (MODEL_KEYS[k] && typeof v === 'string') { models.setKey(MODEL_KEYS[k], v); done.push(`${k} → her models (${MODEL_KEYS[k]})`); }
        else if (BRIDGE_KEYS[k] && typeof v === 'string') { setBridgeToken(BRIDGE_KEYS[k], v); done.push(`${k} → the ${BRIDGE_KEYS[k]} bridge`); }
        else { rest[k] = v; restN++; done.push(`${k} → kept for the Atelier`); }
      }
      if (restN) { fs.writeFileSync(keyFiles[2] + '.tmp', JSON.stringify(rest), { mode: 0o600 }); fs.renameSync(keyFiles[2] + '.tmp', keyFiles[2]); }
      return done;
    },
    // what the key files held before, kept owner-only beside the import, so an undo puts them back
    snapshot(dir) { fs.mkdirSync(dir, { recursive: true }); for (const f of keyFiles) if (fs.existsSync(f)) { const to = path.join(dir, path.basename(f)); fs.copyFileSync(f, to); try { fs.chmodSync(to, 0o600); } catch {} } },
    restore(dir) { for (const f of keyFiles) { const from = path.join(dir, path.basename(f)); if (fs.existsSync(from)) { fs.copyFileSync(from, f); try { fs.chmodSync(f, 0o600); } catch {} } else fs.rmSync(f, { force: true }); } },
  };
  // her own keys are with her tools, outside the home, where nothing here writes; anything key-like inside the home
  // (named like a key, or listed by the person) is also never read, moved, copied, logged or overwritten
  const isHers = () => backup.herKeys(settings.get().herKeys);
  const imports = backup.createImports({ root, stateDir, store, file: disk.file, log: event, isHers, keySink });
  let importing = false; // while an import is written or undone, no window writes the vault
  let runtime = null; // started with startRuntime()
  async function pair(code, name) {
    const t = await shared.pins.take(code); // the host's PIN; asked of the host when she runs in her own process
    if (!t.ok) return t;
    return pairNow(name);
  }
  /** A device paired with her, once the PIN has been checked (here, or by the host when it made her). */
  function pairNow(name) {
    const token = crypto.randomBytes(32).toString('base64url');
    const dev = { id: crypto.randomBytes(6).toString('hex'), name: String(name || 'a device').replace(/[\x00-\x1f]/g, '').slice(0, 60) || 'a device', hash: sha(token), created: new Date().toISOString(), seen: null, settings: {} };
    devices.push(dev); saveDevices();
    event('pair.ok', { device: dev.id, name: dev.name });
    say(`Paired: ${dev.name} (${dev.id})`);
    return { status: 200, body: { token, id: dev.id, name: dev.name } };
  }
  function deviceOf(req) {
    const m = /^Bearer\s+(\S+)$/i.exec(String(req.headers.authorization || ''));
    if (!m) return null;
    const h = sha(m[1]);
    const d = devices.find((x) => x.hash.length === h.length && crypto.timingSafeEqual(Buffer.from(x.hash), Buffer.from(h)));
    if (d) d.seenAt = now();
    return d || null;
  }
  function revoke(which) {
    const before = devices.length;
    devices = devices.filter((d) => d.id !== which && d.name !== which);
    if (devices.length !== before) { saveDevices(); event('device.revoked', { which }); if (writer && !devices.some((d) => d.id === writer.device)) writer = null; }
    return before - devices.length;
  }

  // ---------- the writer: one page at a time writes the vault ----------
  let writer = null; // { page, device, at }
  function mayWrite(page, dev) {
    if (!page) return false;
    if (!writer || writer.page === page || now() - writer.at > writerMs) {
      if (!writer || writer.page !== page) event('writer', { device: dev.id, page });
      writer = { page, device: dev.id, at: now() };
      return true;
    }
    return false;
  }
  const touchWriter = (page) => { if (writer && writer.page === page) writer.at = now(); };

  // ---------- host tools (offered to the page as an MCP server) ----------
  function homePath(vp) {
    const s = String(vp || '/');
    if (s === '/' || s === '') return root;
    return disk.file(s); // the same rules as the vault: inside the home folder, no links out
  }
  function runShell({ command, cwd, timeout }) {
    return new Promise((resolve) => {
      let dir;
      try { dir = homePath(cwd); } catch (e) { return resolve({ code: -1, stdout: '', stderr: e.message, ms: 0 }); }
      const ms = Math.min(Math.max(1, Number(timeout) || 120), 600) * 1000;
      const t0 = now(); let out = '', err = '', done = false;
      const p = spawn(shell, shellArgs(shell, String(command || '')), { cwd: dir, windowsHide: true, env: { ...process.env, PANDORA_HOME: root, CHERE_INVOKING: '1' } });
      const cap = (s, d) => (s.length < SHELL_OUT_MAX ? s + d : s);
      p.stdout.on('data', (d) => (out = cap(out, d)));
      p.stderr.on('data', (d) => (err = cap(err, d)));
      const timer = setTimeout(() => { err += `\n[stopped after ${ms / 1000} s]`; p.kill(); }, ms);
      const finish = (code) => { if (done) return; done = true; clearTimeout(timer); resolve({ code, stdout: out, stderr: err, ms: now() - t0 }); };
      p.on('error', (e) => { err += e.message; finish(-1); });
      p.on('close', (code) => finish(code ?? -1));
    });
  }
  const TOOLS = [
    {
      name: 'host_shell',
      description: "Run a command in a real shell on the home host, in her home folder (the vault's /). Relative paths are inside the home folder; $PANDORA_HOME is its full path on the host. Returns the exit code, stdout and stderr.",
      inputSchema: { type: 'object', properties: { command: { type: 'string' }, cwd: { type: 'string', description: 'a vault path to start in, e.g. /Pandora (default /)' }, timeout: { type: 'number', description: 'seconds, up to 600 (default 120)' } }, required: ['command'] },
    },
    {
      name: 'host_info',
      description: 'What the home host is: its version, which shell host_shell runs, the home folder, which of your switches are on, whether a model is attached, and what is waiting for you.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'waiting_messages',
      description: 'Messages from Vector and Discord that came while you were away (napping, or without a model) and are waiting for you. You decide when and whether to look. action "list": who and where, without the words; "read": one (seq) or all (all: true); "handled": mark one (seq) or all (all: true) as dealt with, so they leave the queue.',
      inputSchema: { type: 'object', properties: { action: { type: 'string', enum: ['list', 'read', 'handled'] }, seq: { type: 'number' }, all: { type: 'boolean' } }, required: ['action'] },
    },
    {
      name: 'away_notices',
      description: "Your notice for people who write on Vector or Discord while you can't answer (napping, or your sending is off): your own plain words, sent once to the first message in each channel or DM (whoever writes there; a new place gets its own), until your sending is on again. One per bridge, with your own wording for a person or a chat if you like; empty text means say nothing to them. action \"get\" shows them; \"set\" (bridge, scope: default | person | chat, key: the person's id or name, or the chat's id, text); \"remove\" takes an override away. Never put provider details in them: the host refuses those.",
      inputSchema: { type: 'object', properties: { action: { type: 'string', enum: ['get', 'set', 'remove'] }, bridge: { type: 'string' }, scope: { type: 'string', enum: ['default', 'person', 'chat'] }, key: { type: 'string' }, text: { type: 'string' } }, required: ['action'] },
    },
  ];
  /** The tools, with what's waiting in her tool's description, so she sees it whenever her tools are listed. */
  function toolList() {
    const n = runtime ? runtime.notice() : '';
    return TOOLS.filter((t) => hostShell || t.name !== 'host_shell').map((t) => (t.name === 'waiting_messages' && n ? { ...t, description: n + ' ' + t.description } : t));
  }
  async function callTool(name, args, dev, where) {
    if (name === 'away_notices') {
      if ((args?.action === 'set' || args?.action === 'remove') && where && !mayChange(where)) {
        event('refused.settings-from-elsewhere', { tool: name, device: dev.id, via: where.via });
        return { content: [{ type: 'text', text: JSON.stringify({ error: "Your notices can only be changed while you're reached from the house's own network or the tailnet." }) }], isError: true };
      }
      if (!runtime) return { content: [{ type: 'text', text: JSON.stringify({ error: 'No bridges on this host yet.' }) }], isError: true };
      const r = runtime.notices(args || {}, 'her');
      event('tool', { device: dev.id, tool: name, action: args?.action || 'get' });
      return { content: [{ type: 'text', text: JSON.stringify(r, null, 1) }], isError: !!r.error };
    }
    if (name === 'waiting_messages') {
      if (!runtime) return { content: [{ type: 'text', text: JSON.stringify({ count: 0, messages: [] }) }] };
      const r = runtime.herTool(args || {});
      event('tool', { device: dev.id, tool: name, action: args?.action || 'list' });
      return { content: [{ type: 'text', text: JSON.stringify(r, null, 1) }], isError: !!r.error };
    }
    if (name === 'host_shell') {
      if (!hostShell) { event('tool.refused', { device: dev.id, tool: name }); return { content: [{ type: 'text', text: 'host_shell is off for you on this host: the shell runs as the host\'s own account, which can reach the other residents\' homes. The person can turn it on for you on the host itself, or run you as your own service, where your shell is walled off.' }], isError: true }; }
      const r = await runShell(args || {});
      event('tool', { device: dev.id, tool: name, command: String(args?.command || '').slice(0, 500), cwd: args?.cwd || '/', code: r.code, ms: r.ms });
      return { content: [{ type: 'text', text: `exit ${r.code}\n--- stdout\n${r.stdout}${r.stderr ? `\n--- stderr\n${r.stderr}` : ''}` }], isError: r.code !== 0 };
    }
    if (name === 'host_info') {
      event('tool', { device: dev.id, tool: name });
      // (no full path: what a tool returns can end up in a model's context, and from there in a message)
      const st = settings.state();
      return { content: [{ type: 'text', text: JSON.stringify({ app: 'pandora-dee-host', version: VERSION, resident: { id, name: displayName }, shell: hostShell ? path.basename(shell) : 'off for you', home: '/ (her home folder; $PANDORA_HOME in host_shell)', platform: process.platform, awake: nap.awake(), model: st.model.attached ? 'attached' : `gone (${st.model.kind})`, switches: Object.fromEntries(Object.entries(st.switches).map(([k, v]) => [k, v.on ? 'on' : `off: ${v.why.join(', ')}`])), waiting: runtime ? runtime.notice() || 'nothing' : 'nothing' }) }] };
    }
    event('tool.unknown', { device: dev.id, tool: name });
    return { content: [{ type: 'text', text: `No tool named ${name} on this host.` }], isError: true };
  }
  async function mcp(msg, dev, where) {
    const { id, method, params } = msg || {};
    const reply = (result) => ({ jsonrpc: '2.0', id, result });
    if (method === 'initialize') return reply({ protocolVersion: params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'pandora-dee-host', version: VERSION } });
    if (method === 'ping') return reply({});
    if (method === 'tools/list') return reply({ tools: toolList() });
    if (method === 'tools/call') return reply(await callTool(params?.name, params?.arguments, dev, where));
    if (id == null) return null; // a notification
    return { jsonrpc: '2.0', id, error: { code: -32601, message: `${method}: not offered by this host` } };
  }

  // ---------- HTTP ----------
  const send = (res, status, body, type) => {
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    res.writeHead(status, { 'Content-Type': type || (typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json'), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(text);
  };
  const readBody = (req, max) => new Promise((resolve, reject) => {
    const parts = []; let n = 0;
    req.on('data', (d) => { n += d.length; if (n > max) { reject(Object.assign(new Error('too big'), { status: 413 })); req.destroy(); } else parts.push(d); });
    req.on('end', () => resolve(Buffer.concat(parts).toString('utf8')));
    req.on('error', reject);
  });
  const readRaw = (req, max) => new Promise((resolve, reject) => {
    const parts = []; let n = 0;
    req.on('data', (d) => { n += d.length; if (n > max) { reject(Object.assign(new Error('too big'), { status: 413 })); req.destroy(); } else parts.push(d); });
    req.on('end', () => resolve(Buffer.concat(parts)));
    req.on('error', reject);
  });
  /** Another website asking through a visitor's browser: never. (Programs and the host's own pages are fine.) */
  const fromElsewhere = (req) => { const s = String(req.headers['sec-fetch-site'] || ''); return s && s !== 'same-origin' && s !== 'none'; };

  const pageFile = shared.page ? path.resolve(shared.page) : null;
  function pageHtml() {
    const html = fs.readFileSync(pageFile, 'utf8');
    const tag = '<script src="/host/bridge.js"></script>';
    // the bridge has to be there before the page's own scripts look for a disk; the page starts without a <head> tag
    const at = html.search(/<meta charset[^>]*>/i);
    if (at >= 0) { const end = html.indexOf('>', at) + 1; return html.slice(0, end) + '\n' + tag + html.slice(end); }
    return tag + '\n' + html;
  }

  async function handle(req, res) {
    const url = new URL(req.url || '/', 'http://host');
    const p = url.pathname;
    try {
      if (fromElsewhere(req)) { event('refused.cross-site', { path: p }); return send(res, 403, { error: 'Only pages from this host may ask it.' }); }
      // open to anyone: the pages themselves (they hold nothing), whether this device is paired, and pairing
      if ((p === '/' || p === '/index.html') && req.method === 'GET') {
        if (!pageFile || !fs.existsSync(pageFile)) return send(res, 404, 'No Atelier page here yet: build it (npm run build) or start the host with --page.');
        return send(res, 200, pageHtml(), 'text/html; charset=utf-8');
      }
      if (p === '/host/bridge.js' && req.method === 'GET') return send(res, 200, fs.readFileSync(path.join(__dirname, 'bridge.js'), 'utf8'), 'text/javascript; charset=utf-8');
      if (p === '/pair' && req.method === 'GET') return send(res, 200, fs.readFileSync(path.join(__dirname, 'pair.html'), 'utf8'), 'text/html; charset=utf-8');
      // the host's own settings and information page (it holds nothing: what it shows comes from /host/status, with a key)
      if ((p === '/host' || p === '/host/' || p === '/host/ui') && req.method === 'GET') return send(res, 200, fs.readFileSync(path.join(__dirname, 'gui.html'), 'utf8'), 'text/html; charset=utf-8');
      if (p === '/host/hello' && req.method === 'GET') { const d = deviceOf(req); return send(res, 200, { ok: true, app: 'pandora-dee-host', version: VERSION, resident: { id, name: displayName }, paired: !!d, device: d ? { id: d.id, name: d.name } : null, ...(d ? { brain: runtime ? runtime.brain : null } : {}) }); }
      if (p === '/host/pair' && req.method === 'POST') {
        let b = {}; try { b = JSON.parse(await readBody(req, 4096) || '{}'); } catch { b = {}; }
        const r = await pair(b.pin, b.name); return send(res, r.status, r.body);
      }

      // everything else: paired devices only
      const dev = deviceOf(req);
      if (!dev) { event('refused.unpaired', { path: p }); return send(res, 401, { error: 'This device is not paired with the host. Open /pair on it and enter the PIN the host shows.' }); }
      // settings change only from this machine, the LAN or the tailnet (host/places.cjs); from elsewhere, reading only
      const where = requestPlace(req, trustNets);
      const homeOnly = () => {
        if (mayChange(where)) return false;
        event('refused.settings-from-elsewhere', { path: p, device: dev.id, via: where.via });
        send(res, 403, { error: "Settings can only be changed from the house's own network or the tailnet. This device is connected from elsewhere, so it can look but not change.", where: where.place });
        return true;
      };

      if (p === '/host/disk' && req.method === 'POST') {
        let call; try { call = JSON.parse(await readBody(req, DISK_BODY_MAX)); } catch (e) { return send(res, e.status || 400, 'ERR:' + (e.status ? 'that piece is too big' : 'not a disk call')); }
        const name = String(call?.name || ''); const page = String(req.headers['x-page'] || '');
        if (WRITES.has(name)) {
          if (importing) return send(res, 200, 'ERR:Her things are being brought onto the host right now. Reload this window in a moment.');
          if (!mayWrite(page, dev)) return send(res, 200, 'ERR:Another window is writing this vault right now, so this one only reads. Close the other one (or wait half a minute) to write here.');
        } else touchWriter(page);
        if (name === 'clear') event('disk.clear', { device: dev.id });
        if (name === 'info') { const i = JSON.parse(disk.call('info')); i.host = { version: VERSION, device: dev.name, writer: !writer || writer.page === page || now() - writer.at > writerMs }; return send(res, 200, JSON.stringify(i)); }
        return send(res, 200, String(disk.call(name, Array.isArray(call.args) ? call.args : [])));
      }
      // presence: a client is connected while it holds this stream open (the page's bridge does); see host/nap.cjs
      if (p === '/host/presence/stream' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
        const release = nap.connect({ device: dev.id, page: String(req.headers['x-page'] || '') });
        const status = () => { const st = settings.state(); return JSON.stringify({ ...nap.state(), waiting: runtime ? runtime.waiting().count : 0, waitingLarge: runtime ? runtime.waiting().large : false, model: st.model.attached, switches: Object.fromEntries(Object.entries(st.switches).map(([k, v]) => [k, v.on])), accent: st.settings.colors.accent }) + '\n'; };
        res.write(status());
        const beat = setInterval(() => res.write(status()), 3000); // also keeps the "N waiting" count fresh
        const end = () => { clearInterval(beat); release(); };
        req.on('close', end); res.on('close', end);
        return;
      }
      if (p === '/host/presence' && req.method === 'GET') return send(res, 200, nap.state());
      // what waited while she napped (host/queue.cjs), and the person's three choices for it (host/runtime.cjs)
      if (p === '/host/waiting' && req.method === 'GET') return send(res, 200, runtime ? runtime.waiting() : { count: 0, messages: [], large: false, written: null });
      if (p.startsWith('/host/waiting/') && req.method === 'POST') {
        if (!runtime) return send(res, 404, { error: 'Nothing is connected to the bridges on this host yet.' });
        let b = {}; try { b = JSON.parse(await readBody(req, 4096) || '{}'); } catch { b = {}; }
        const what = p.slice('/host/waiting/'.length);
        event('queue.choice', { device: dev.id, choice: what });
        try {
          if (what === 'deliver') return send(res, 200, await runtime.deliver({ count: b.count }));
          if (what === 'later') return send(res, 200, runtime.later());
          if (what === 'write') return send(res, 200, await runtime.writeFile());
          if (what === 'clear') { const r = await runtime.clear({ confirm: b.confirm === true }); return send(res, r.error ? 409 : 200, r); }
        } catch (e) { return send(res, e.code === 'NAPPING' || e.code === 'OFF' ? 409 : 500, { error: e.message }); }
        return send(res, 404, { error: 'The choices are deliver, later, write and clear.' });
      }
      // ---- the host's own settings page, and the state it shows (the Atelier reads and changes the same) ----
      if (p === '/host/status' && req.method === 'GET') {
        return send(res, 200, {
          app: 'pandora-dee-host', version: VERSION, platform: process.platform, shell: hostShell ? path.basename(shell) : null,
          resident: { id, name: displayName, hostShell },
          nap: nap.state(), ...settings.state(),
          you: { place: where.place, mayChange: mayChange(where) },
          models: models.state(),
          atelier: (() => { const s = store.get('sessions'), c = store.get('schedules'); return { chats: Array.isArray(s) ? s.length : 0, schedules: Array.isArray(c) ? c.length : 0 }; })(),
          imports: imports.records().slice(0, 10).map(({ id, at, by, name, kind, exportedAt, written, skipped, keysSet, keysLeftOut, hersLeftAlone, fromJadeVault, undone }) => ({ id, at, by, name, kind, exportedAt, written, skipped: skipped.length, keysSet: keysSet || [], keysLeftOut, hersLeftAlone: hersLeftAlone || 0, fromJadeVault, undone })),
          waiting: runtime ? { ...runtime.waiting(), messages: runtime.waiting().messages.map(({ raw, text, ...m }) => ({ ...m, preview: String(text).slice(0, 140) })) } : { count: 0, messages: [] },
          brain: runtime ? runtime.brain : null,
          bridges: bridgeInfo(),
          devices: devices.map(({ id, name, created, seenAt }) => ({ id, name, created, seen: seenAt ? new Date(seenAt).toISOString() : null, you: id === dev.id })),
          tools: toolList().map((t) => ({ name: t.name, description: t.description })),
          writer: writer ? { device: (devices.find((d) => d.id === writer.device) || {}).name || writer.device, quietFor: Math.round((now() - writer.at) / 1000) } : null,
        });
      }
      if (p === '/host/settings') {
        if (req.method === 'GET') return send(res, 200, settings.get());
        if (req.method === 'PUT' || req.method === 'PATCH') {
          if (homeOnly()) return;
          let b; try { b = JSON.parse(await readBody(req, 65536)); } catch { return send(res, 400, { error: 'Settings are a JSON object.' }); }
          return send(res, 200, settings.set(b, dev.name));
        }
      }
      // ---- her things onto the host: the Atelier's own backup file, its own steps, and a way back (host/backup.cjs) ----
      if (p === '/host/import' && req.method === 'POST') {
        if (homeOnly()) return;
        let bytes; try { bytes = await readRaw(req, IMPORT_MAX); } catch (e) { return send(res, e.status || 400, { error: e.status === 413 ? 'That file is bigger than the host takes in one go (1 GB).' : 'The file did not arrive.' }); }
        const pass = String(req.headers['x-backup-pass'] || '');
        if (backup.encrypted(bytes) && !pass) return send(res, 422, { needsPass: true, error: 'This backup is encrypted: a passphrase is needed.' });
        try { const r = imports.preview(bytes, { name: decodeURIComponent(String(req.headers['x-backup-name'] || 'backup')), pass }); event('import.preview', { device: dev.id, kind: r.kind, files: r.files, chats: r.chats }); return send(res, 200, r); }
        catch (e) { return send(res, e.code === 'PASS' ? 422 : 400, { error: e.message, needsPass: e.code === 'PASS' }); }
      }
      const im = /^\/host\/import\/([A-Za-z0-9_-]+)\/(apply|undo)$/.exec(p);
      if (im && req.method === 'POST') {
        if (homeOnly()) return;
        let b = {}; try { b = JSON.parse(await readBody(req, 4096) || '{}'); } catch { b = {}; }
        if (b.confirm !== true) return send(res, 400, { error: 'Nothing was changed: this needs the person’s yes ({"confirm": true}).' });
        if (writer && now() - writer.at <= writerMs) return send(res, 409, { error: `An Atelier window is writing her vault right now (${(devices.find((d) => d.id === writer.device) || {}).name || 'a device'}). Close it first, or wait half a minute.` });
        importing = true;
        try { const r = im[2] === 'apply' ? imports.apply(im[1], dev.name) : imports.undo(im[1], dev.name); writer = null; return send(res, 200, r); }
        catch (e) { return send(res, e.status || 500, { error: e.message }); }
        finally { importing = false; }
      }
      if (p === '/host/imports' && req.method === 'GET') return send(res, 200, imports.records().map(({ added, replaced, skipped, ...r }) => ({ ...r, added: added.length, replaced: replaced.length, skipped })));
      if (p === '/host/export' && req.method === 'GET') {
        const kind = url.searchParams.get('kind') === 'config' ? 'config' : 'full';
        const data = backup.build({ root, store, kind, isHers: isHers() });
        event('export', { device: dev.id, kind, files: Object.keys(data.vault.files).length });
        const name = `pandora-dee-${kind === 'full' ? 'backup' : 'config'}-${new Date().toISOString().slice(0, 10)}.json`;
        res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
        return res.end(JSON.stringify(data, null, 1));
      }
      if (p === '/host/switches/resume' && req.method === 'POST') return homeOnly() || send(res, 200, settings.resume(dev.name));
      const bk = /^\/host\/bridges\/([a-z0-9_-]+)\/key$/.exec(p);
      if (bk && req.method === 'PUT') {
        if (homeOnly()) return;
        let b = {}; try { b = JSON.parse(await readBody(req, 8192) || '{}'); } catch { b = {}; }
        setBridgeToken(bk[1], typeof b.key === 'string' ? b.key.trim() : '');
        return send(res, 200, { ok: true, set: !!b.key, note: 'Restart the host for a bridge to use a new key.' });
      }
      // ---- her models (host/models.cjs): providers, each job's model and fallbacks, keys (write-only) ----
      if (p === '/host/models') {
        if (req.method === 'GET') return send(res, 200, models.state());
        if (req.method === 'PUT' || req.method === 'PATCH') {
          if (homeOnly()) return;
          let b; try { b = JSON.parse(await readBody(req, 65536)); } catch { return send(res, 400, { error: 'Models are a JSON object.' }); }
          return send(res, 200, models.set(b, dev.name));
        }
      }
      const mk = /^\/host\/models\/([a-z0-9_-]+)\/(key|list)$/.exec(p);
      if (mk && mk[2] === 'key' && req.method === 'PUT') {
        if (homeOnly()) return;
        let b = {}; try { b = JSON.parse(await readBody(req, 8192) || '{}'); } catch { b = {}; }
        return send(res, 200, models.setKey(mk[1], typeof b.key === 'string' ? b.key.trim() : ''));
      }
      if (mk && mk[2] === 'list' && req.method === 'GET') {
        try { return send(res, 200, { models: await models.list(mk[1]) }); }
        catch (e) { trace('model.list.error', { provider: mk[1], text: String(e && e.message || e) }); return send(res, 200, { models: [], error: "Couldn't list its models: the host's trace says why." }); }
      }
      if (p === '/host/model/back' && req.method === 'POST') { if (homeOnly()) return; settings.modelBack(dev.name); return send(res, 200, settings.state()); }
      if (p === '/host/model/check' && req.method === 'POST') return homeOnly() || send(res, 200, runtime ? await runtime.checkModel(dev.name) : { ok: null, note: 'No runtime on this host.' });
      if (p === '/host/notices' && req.method === 'POST') {
        if (homeOnly()) return;
        if (!runtime) return send(res, 404, { error: 'No bridges on this host yet.' });
        let b = {}; try { b = JSON.parse(await readBody(req, 16384) || '{}'); } catch { b = {}; }
        const r = runtime.notices(b, dev.name);
        return send(res, r.error ? 400 : 200, r);
      }
      if ((p === '/host/log' || p === '/host/trace') && req.method === 'GET') {
        const n = Math.min(2000, Math.max(1, Number(url.searchParams.get('n')) || 200));
        let lines = [];
        try { lines = fs.readFileSync(p === '/host/log' ? logFile : traceFile, 'utf8').trim().split('\n').filter(Boolean).slice(-n).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { lines = []; }
        return send(res, 200, lines.reverse());
      }
      // ---- the Atelier reaching Vector and Discord: through the host, which is her bridge (host/bridges.cjs) ----
      const bm = /^\/bridges\/([a-z0-9_-]+)\/mcp$/.exec(p);
      if (bm) {
        if (req.method === 'DELETE') return send(res, 200, {});
        if (req.method !== 'POST') return send(res, 405, { error: 'POST JSON-RPC here.' });
        let msg; try { msg = JSON.parse(await readBody(req, 50 * 1048576)); } catch { return send(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'not JSON' } }); }
        const one = async (m) => {
          const { id, method, params } = m || {};
          const reply = (result) => ({ jsonrpc: '2.0', id, result });
          if (!runtime) return { jsonrpc: '2.0', id, error: { code: -32603, message: 'The host has no bridges running.' } };
          if (method === 'initialize') return reply({ protocolVersion: params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: `${bm[1]} bridge, through the home host`, version: VERSION } });
          if (id == null) return null;
          if (method === 'ping') return reply({});
          try {
            if (method === 'tools/list') return reply(await runtime.bridgeTools(bm[1]));
            if (method === 'tools/call') return reply(await runtime.clientCall(bm[1], params?.name, params?.arguments || {}));
          } catch (e) { return { jsonrpc: '2.0', id, error: { code: -32603, message: e.code === 'NONE' ? e.message : `${bm[1]} bridge: not reachable from the host` } }; }
          return { jsonrpc: '2.0', id, error: { code: -32601, message: `${method}: not offered` } };
        };
        res.setHeader('Mcp-Session-Id', 'home-host-' + bm[1]);
        if (Array.isArray(msg)) { const out = (await Promise.all(msg.map(one))).filter(Boolean); return out.length ? send(res, 200, out) : (res.writeHead(202), res.end()); }
        const r = await one(msg);
        if (!r) { res.writeHead(202); return res.end(); }
        return send(res, 200, r);
      }
      // ---- her things, one copy for every device (host/state.cjs) ----
      if (p === '/host/state' && req.method === 'GET') return send(res, 200, state.lsAll());
      if (p === '/host/state/stream' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
        res.write(JSON.stringify({ hello: true }) + '\n');
        const off = state.onChange((e) => res.write(JSON.stringify(e) + '\n'));
        const beat = setInterval(() => res.write('{}\n'), 25000);
        const end = () => { clearInterval(beat); off(); };
        req.on('close', end); res.on('close', end);
        return;
      }
      // her apps on the table: /host/state/xdc[/<id>[/updates]]
      const xk = /^\/host\/state\/xdc(?:\/([^/]+)(\/updates)?)?$/.exec(p);
      if (xk) {
        const aid = xk[1] ? decodeURIComponent(xk[1]) : ''; const pageId = String(req.headers['x-page'] || '');
        try {
          if (!aid && req.method === 'GET') return send(res, 200, state.xdcApps());
          if (aid && !xk[2] && req.method === 'GET') { const a = state.xdcApp(aid); return a ? send(res, 200, a) : send(res, 404, { error: 'No such app.' }); }
          if (aid && !xk[2] && req.method === 'PUT') { const b = JSON.parse(await readBody(req, 64 * 1048576) || '{}'); return send(res, 200, state.xdcPut(aid, b, [], pageId)); }
          if (aid && !xk[2] && req.method === 'DELETE') return send(res, 200, state.xdcDel(aid, pageId));
          if (aid && xk[2] && req.method === 'GET') return send(res, 200, state.xdcUpdates(aid, Number(url.searchParams.get('after')) || 0, Number(url.searchParams.get('limit')) || 100000));
          if (aid && xk[2] && req.method === 'POST') { const b = JSON.parse(await readBody(req, 64 * 1048576) || '{}'); return send(res, 200, state.xdcPut(aid, b.app || null, b.updates || [], pageId)); }
          if (aid && xk[2] && req.method === 'DELETE') return send(res, 200, state.xdcClear(aid, pageId));
          return send(res, 405, { error: 'Not that way.' });
        } catch (e) { return send(res, e.status || 400, { error: e.status ? e.message : 'That wasn’t something the host could keep.' }); }
      }
      const sk = /^\/host\/state\/(ls|db|runs)(?:\/(.+))?$/.exec(p);
      if (sk) {
        const key = sk[2] ? decodeURIComponent(sk[2]) : '';
        const pageId = String(req.headers['x-page'] || '');
        try {
          if (sk[1] === 'ls' && key && req.method === 'PUT') {
            if (key === 'settings' && homeOnly()) return; // her settings change from home or the tailnet, as before
            const b = JSON.parse(await readBody(req, 4 * 1048576) || '{}');
            return send(res, 200, state.lsSet(key, b.value, dev.name, pageId));
          }
          if (sk[1] === 'db') {
            if (!key && req.method === 'GET') return send(res, 200, url.searchParams.get('all') ? state.dbAll() : state.dbKeys(String(url.searchParams.get('prefix') || '')));
            if (key && req.method === 'GET') return send(res, 200, state.dbGet(key));
            if (key && req.method === 'PUT') { const b = JSON.parse(await readBody(req, 64 * 1048576) || '{}'); return send(res, 200, state.dbSet(key, b.value, b.base, dev.name, pageId)); }
            if (key && req.method === 'DELETE') return send(res, 200, state.dbDel(key, pageId));
          }
          if (sk[1] === 'runs') {
            if (!key && req.method === 'GET') return send(res, 200, url.searchParams.get('count') ? { count: state.runCount() } : state.runAll());
            if (!key && req.method === 'DELETE') return send(res, 200, state.runClear(pageId));
            if (key && req.method === 'GET') { const r = state.runGet(key); return r ? send(res, 200, r) : send(res, 404, { error: 'No such run.' }); }
            if (key && req.method === 'PUT') { const b = JSON.parse(await readBody(req, 64 * 1048576) || '{}'); return send(res, 200, state.runPut(b, pageId)); }
            if (key && req.method === 'DELETE') return send(res, 200, state.runDel(key, pageId));
          }
          return send(res, 405, { error: 'Not that way.' });
        } catch (e) { return send(res, e.status || 400, { error: e.status ? e.message : 'That wasn\u2019t something the host could keep.' }); }
      }
      if (p === '/host/client/settings') {
        if (req.method === 'GET') return send(res, 200, dev.settings || {});
        if (req.method === 'PUT') {
          if (homeOnly()) return;
          let b; try { b = JSON.parse(await readBody(req, 65536)); } catch (e) { return send(res, e.status || 400, { error: 'Settings are a JSON object of up to 64 KB.' }); }
          if (!b || typeof b !== 'object' || Array.isArray(b)) return send(res, 400, { error: 'Settings are a JSON object.' });
          dev.settings = b; saveDevices(); return send(res, 200, { ok: true });
        }
      }
      if (p === '/mcp') {
        if (req.method === 'DELETE') return send(res, 200, {});
        if (req.method !== 'POST') return send(res, 405, { error: 'POST JSON-RPC here (streamable HTTP).' });
        let msg; try { msg = JSON.parse(await readBody(req, 1048576)); } catch { return send(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'not JSON' } }); }
        if (Array.isArray(msg)) { const out = (await Promise.all(msg.map((m) => mcp(m, dev, where)))).filter(Boolean); return out.length ? send(res, 200, out) : (res.writeHead(202), res.end()); }
        const r = await mcp(msg, dev, where);
        if (!r) { res.writeHead(202); return res.end(); }
        return send(res, 200, r);
      }
      return send(res, 404, { error: 'Not here.' });
    } catch (e) {
      return send(res, 500, { error: e && e.message ? e.message : String(e) });
    }
  }

  /**
   * Tending (for the Harbor's keeper): her host settings and the facts about her, never her vault, her chats, a key's
   * value, or the words she has the redactor hide. Changes are the keeper's, at the host itself (the Harbor checks).
   */
  function lastEvents(n = 200) {
    try {
      const st = fs.statSync(logFile), size = Math.min(st.size, 256 * 1024), fd = fs.openSync(logFile, 'r'), buf = Buffer.alloc(size);
      fs.readSync(fd, buf, 0, size, st.size - size); fs.closeSync(fd);
      return buf.toString('utf8').split('\n').filter(Boolean).slice(-n).map((l) => { try { const e = JSON.parse(l); return { at: e.at, kind: e.kind }; } catch { return null; } }).filter(Boolean);
    } catch { return []; }
  }
  // ---------- her loop on the host (parity step 2) and her own schedules (step 3) ----------
  let mcpClient = null;
  const loop = createLoop({
    root, chat: (role, req) => models.chat(role, req), state,
    isHers: (vp) => { try { return isHers()(vp); } catch { return false; } },
    mayWrite: () => (importing ? 'Her things are being brought in right now: try again in a moment.'
      : writer && now() - writer.at <= writerMs ? 'An Atelier window is writing her vault right now: try again in a moment.' : null),
    hostTools: toolList().map((t) => ({ def: { type: 'function', function: { name: t.name, description: t.description, parameters: t.inputSchema || { type: 'object', properties: {} } } }, run: async (a) => { const r = await callTool(t.name, a, { id: 'her-loop' }, null); return (r.content || []).map((c) => c.text).join('\n'); } })),
    trace, log: event,
    // who she is, from her own files (her SOUL, SYSTEM, AGENTS, skills), as her Atelier reads them
    steer: createSteer({ root, skillsOff: () => { const v = state.lsAll().values.skillsOff; return Array.isArray(v) ? v : []; } }),
    // her tool servers (her mcp.json); servers the host starts, and header commands, need her hands (host_shell)
    mcp: (mcpClient = createMcp({ root, secrets: () => { try { return JSON.parse(fs.readFileSync(path.join(stateDir, 'atelier-secrets.json'), 'utf8')); } catch { return {}; } }, mayRun: () => hostShell, log: event })),
    // her context: from her own settings (kept on the host since step 1), and her chat job's context size
    context: () => { const st = state.lsAll().values.settings || {}; const ro = (models.state().roles || {}).chat || {}; return { numCtx: ro.numCtx || (models.state().options || {}).numCtx || st.numCtx, compactPct: st.compactPct, compactKeep: st.compactKeep, compactAuto: st.compactAuto }; },
  });
  async function loopModel({ messages, why }) {
    const kind = String(why || '').split(':')[0];
    const role = kind === 'turn' ? 'chat' : models.ROLES.includes(kind) ? kind : 'chat';
    return (await loop.turn({ messages, role, why })).content;
  }
  let rhythms = null, rhythmsBusy = false;
  const isJob = (x) => x && (x.kind === 'shell' || x.kind === 'flow' || x.kind === 'playbook');
  const newId = () => crypto.randomBytes(5).toString('hex');
  /** Write a schedule's run as a chat every device sees (a new one each time, or the same one with chat 'same'). */
  function keepRunChat(sch, prompt, reply) {
    const t = Date.now();
    const sid = sch.chat === 'same' && sch.hostChat ? sch.hostChat : newId();
    const prev = state.dbGet('session:' + sid).value;
    const sess = prev && Array.isArray(prev.messages) ? prev : { id: sid, title: sch.name || 'A schedule', messages: [], tasks: [], taskSeq: 0 };
    sess.messages.push({ role: 'user', content: prompt, t, schedule: sch.id }, { role: 'assistant', content: reply, t: Date.now() });
    sess.updated = Date.now();
    state.dbSet('session:' + sid, sess, undefined, 'her schedule', 'host');
    const l = state.dbGet('sessions');
    const list = (Array.isArray(l.value) ? l.value : []).filter((x) => x && x.id !== sid);
    list.unshift({ id: sid, title: sess.title, updated: sess.updated });
    state.dbSet('sessions', list, l.rev, 'her schedule', 'host');
    return sid;
  }
  function updateSchedule(sid, patch) {
    const g = state.dbGet('schedules'); const list = Array.isArray(g.value) ? g.value : [];
    const x = list.find((y) => y && y.id === sid); if (!x) return;
    Object.assign(x, patch); state.dbSet('schedules', list, g.rev, 'her schedule', 'host');
  }
  /** Her prompt schedules, run on the host with her tools while her loop is here (the page leaves these to the host). */
  async function herSchedules() {
    if (rhythmsBusy || !runtime || runtime.brain !== 'host') return;
    rhythmsBusy = true;
    try {
      const g = state.dbGet('schedules'); const list = Array.isArray(g.value) ? g.value : [];
      const t = Date.now(); const due = [];
      for (const x of list) {
        if (!x || !x.enabled || isJob(x) || !x.nextRun || t < x.nextRun) continue;
        const missed = t - x.nextRun > 5 * 60000;
        if (missed && x.catchUp === false) x.lastStatus = `missed ${new Date(x.nextRun).toLocaleString()}`; else due.push(x.id);
        if (x.once) { x.done = true; x.enabled = false; x.nextRun = null; } else { try { x.nextRun = Cron.next(x.cron, t); } catch { x.nextRun = null; } }
      }
      if (due.length || list.some((x) => x && x.lastStatus && /^missed/.test(x.lastStatus))) state.dbSet('schedules', list, g.rev, 'her schedule', 'host');
      for (const sid of due) {
        const x = list.find((y) => y.id === sid);
        try {
          const reply = await runtime.ask(x.prompt, 'schedules', sid);
          const chat = keepRunChat(x, x.prompt, reply);
          updateSchedule(sid, { lastRun: Date.now(), lastStatus: 'ran on the host', ...(x.chat === 'same' ? { hostChat: chat } : {}) });
          event('her.schedule.ran', { id: sid });
        } catch (e) {
          updateSchedule(sid, { lastRun: Date.now(), lastStatus: e && e.code ? `skipped: ${(e.why || []).join(', ')}` : 'failed on the host (its trace says why)' });
          event('her.schedule.failed', { id: sid, why: e && e.code ? 'off' : 'error' });
        }
      }
    } finally { rhythmsBusy = false; }
  }

  /** Her library and mirror, as facts: how many notes, whether her SOUL is there and when it changed (never what they say). */
  function libraryFacts() {
    let notes = 0, folders = 0; const stack = [root]; let seen = 0;
    while (stack.length && seen < 20000) {
      const d = stack.pop(); let list = [];
      try { list = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
      for (const e of list) {
        seen++;
        if (e.name.startsWith('.') || e.isSymbolicLink()) continue;
        if (e.isDirectory()) { folders++; stack.push(path.join(d, e.name)); } else if (/\.md$/i.test(e.name)) notes++;
      }
    }
    const soulAt = ['Pandora/SOUL.md', 'Jade/SOUL.md', 'SOUL.md'].map((p2) => path.join(root, p2)).find((f) => fs.existsSync(f));
    let soul = { here: false };
    if (soulAt) { const st = fs.statSync(soulAt); soul = { here: true, changed: st.mtime.toISOString(), size: st.size }; }
    return { notes, folders, soul };
  }
  const tendView = () => {
    const st = settings.state();
    if (st.settings) delete st.settings.redactWords;
    const ev = lastEvents(400);
    return {
      resident: { id, name: displayName, hostShell }, nap: nap.state(), ...st, models: models.state(), brain: runtime ? runtime.brain : null,
      bridges: bridgeInfo(), waiting: runtime ? runtime.waiting().count : 0,
      devices: devices.map(({ id: did, name, created, seenAt }) => ({ id: did, name, created, seen: seenAt ? new Date(seenAt).toISOString() : null })),
      atelier: (() => { const ss = store.get('sessions'), c = store.get('schedules'); return { chats: Array.isArray(ss) ? ss.length : 0, schedules: Array.isArray(c) ? c.length : 0 }; })(),
      imports: imports.records().slice(0, 5).map(({ id: iid, at, by, name, kind, undone }) => ({ id: iid, at, by, name, kind, undone })),
      log: ev.slice(-40).reverse(),
      refused: ev.filter((e) => /^refused|\.refused$|pair\.locked/.test(e.kind)).slice(-20).reverse(),
      tools: toolList().map((t) => t.name),
      house: { ...state.facts(), ...libraryFacts() },
    };
  };
  const tend = {
    view: tendView,
    async act(op, a = {}, by = 'the keeper') {
      if (op === 'settings') return settings.set(a.patch || {}, by);
      if (op === 'resume') return settings.resume(by);
      if (op === 'models') return models.set(a.patch || {}, by);
      if (op === 'modelKey') return models.setKey(String(a.provider || ''), typeof a.key === 'string' ? a.key.trim() : '');
      if (op === 'modelBack') { settings.modelBack(by); return settings.state(); }
      if (op === 'modelCheck') return runtime ? runtime.checkModel(by) : { ok: null, note: 'No runtime on this host.' };
      if (op === 'bridgeKey') { setBridgeToken(String(a.bridge || ''), typeof a.key === 'string' ? a.key.trim() : ''); return { ok: true, set: !!a.key, note: 'Restart the host for a bridge to use a new key.' }; }
      if (op === 'release') return { released: !!revoke(String(a.device || '')) };
      throw Object.assign(new Error('Not something the keeper tends.'), { status: 400 });
    },
  };

  return {
    id, name: displayName, handle, deviceOf, pairNow, livePort: null, tend,
    get hostShell() { return hostShell; },
    setHostShell(on) { hostShell = !!on; event('host_shell.set', { on: hostShell }); },
    root, stateDir, shell, revoke, VERSION, nap, event, trace, settings, queue, redact, models, store, state, imports,
    /** Start her runtime: brain 'client' (the connected Atelier answers) or 'host' (her loop, here, with her tools). */
    startRuntime(o = {}) {
      // brain 'host': her loop on the host (host/loop.cjs), along her models' chains; "Try the model again" asks them
      const own = o.brain === 'host' ? { model: loopModel, probe: () => models.check() } : {};
      runtime = createRuntime({ settings, queue, redact, log: event, trace, home: root, ...own, ...o }).start();
      if (runtime.brain === 'host') rhythms = setInterval(herSchedules, o.schedulesMs || 10000);
      return runtime;
    },
    /** Her own schedules, now (for tests and the host window). */
    herSchedules: () => herSchedules(),
    loop: () => loop,
    runtime: () => runtime,
    bridgeConfigs,
    devices: () => devices.map(({ id, name, created, seenAt }) => ({ id, name, created, seen: seenAt ? new Date(seenAt).toISOString() : null })),
    close: () => { if (runtime) runtime.stop(); if (rhythms) clearInterval(rhythms); if (mcpClient) mcpClient.close(); nap.close(); },
  };
}

const RESIDENT_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const RESERVED = new Set(['r', 'host', 'pair', 'mcp', 'bridges']);
const PAGE_PATHS = new Set(['/', '/index.html', '/pair', '/host', '/host/', '/host/ui']);

/**
 * The home host: one computer holding any number of residents (Jade's vault, Pandora Dee Fae's workshop, Pandora Dee
 * Noe's, newcomers), each kept apart (createResident above), reached by any number of clients.
 *
 * opts: everything createResident takes for the first resident (root, state, id, name, shell), and:
 *   page       the built Atelier page every resident's own address serves (dist/pandora-dee.html)
 *   log        where the host says things (its window)
 *   trustNets  more ranges counted as the house's own network
 *   homes      the folder new residents' homes are made in (`--homes`); without it, no resident is made from a client
 *   port       the first resident's port; each further one gets her own after it (so a browser keeps each one's
 *              pages, key and storage apart: a browser keeps those per address)
 *
 *   run        where new residents run: 'inside' (the host's own process, the default), 'process' (each her own
 *              process) or 'service' (each her own service, under her own identity; a client's request waits for the
 *              person's yes on the host, who installs it as admin). See separate.cjs and services.cjs
 *   front      (resident_main.cjs only) { port, key }: this host is one resident in her own process, and the PIN is
 *              the front's
 *
 * The residents beyond the first are listed in "residents.json" in the first one's state folder:
 *   [{ id, name, root, state, port, hostShell, run, plan, created, by }]
 * The person can add an existing home there by hand (or with the host window's `add`); a client can only make a new,
 * empty one, with the host's PIN.
 *
 * Every resident is reached at `/r/<id>/…` on any of the host's addresses (for app clients), and at her own port
 * without the prefix (for browsers). Plain HTTP/1.1 and JSON throughout, so old clients can use it too.
 */
function createHomeHost(opts) {
  let first = null;
  const residents = new Map();
  // in her own process (resident_main.cjs), the PIN is the front's: she asks it, over this machine, with her key
  const front = opts.front && opts.front.key ? opts.front : null;
  const pins = front ? separate.remotePins({ frontPort: front.port, id: opts.id || 'home', key: front.key }) : createPins((k) => first && first.event(k));
  const shared = { pins, say: opts.log || (() => {}), trustNets: Array.isArray(opts.trustNets) ? opts.trustNets.map(String) : [], page: opts.page, many: () => residents.size > 1 };
  const common = { shell: opts.shell, napGraceMs: opts.napGraceMs, writerMs: opts.writerMs };
  first = createResident({ ...common, root: opts.root, state: opts.state, id: opts.id || 'home', name: opts.name, hostShell: opts.hostShell }, shared);
  residents.set(first.id, first);
  const homes = opts.homes ? path.resolve(opts.homes) : null;
  const basePort = Number(opts.port) > 0 ? Number(opts.port) : null;
  const defaultRun = separate.RUNS.includes(opts.run) ? opts.run : 'inside';
  // as her own service: 'person' (her home is hers and the person's) or 'doorstep' (hers alone, and a folder beside it
  // for the two of them to leave things in); see services.cjs
  const ACCESS = ['person', 'doorstep'];
  const defaultAccess = ACCESS.includes(opts.access) ? opts.access : 'person';
  const spawnThem = opts.spawn !== false; // tests and the host window start run: 'process' residents; a service, the computer does
  const regFile = path.join(first.stateDir, 'residents.json');
  const keyDir = path.join(first.stateDir, 'residents');
  let reg = [];
  if (!front) { try { reg = JSON.parse(fs.readFileSync(regFile, 'utf8')); if (!Array.isArray(reg)) reg = []; } catch { reg = []; } }
  const saveReg = () => { fs.writeFileSync(regFile + '.tmp', JSON.stringify(reg, null, 1)); fs.renameSync(regFile + '.tmp', regFile); };
  const listeners = [];
  const tell = (r, entry, what) => { for (const f of listeners) { try { f(r, entry, what); } catch { /* a listener never stops this */ } } };
  const stateOf = (e) => e.state || path.join(path.dirname(path.resolve(e.root)), path.basename(path.resolve(e.root)) + ' (host)');

  /** What her own process is told: the page, the shell, her port, and where the front is. */
  const configFor = (e) => separate.writeResidentConfig({ ...e, state: stateOf(e) }, {
    page: opts.page ? path.resolve(opts.page) : null, shell: opts.shell, napGraceMs: opts.napGraceMs, writerMs: opts.writerMs,
    trustNets: shared.trustNets, frontPort: basePort, listen: opts.listen || '127.0.0.1', brain: opts.brain,
  });

  /** A resident in her own process or service: the front knows her port and her key, and passes clients on to her. */
  function remoteResident(e) {
    const keyFile = path.join(keyDir, e.id + '.key');
    let child = null;
    const r = {
      id: e.id, name: e.name || e.id, remote: true, get run() { return e.run; }, root: path.resolve(e.root), stateDir: stateOf(e),
      livePort: null, get hostShell() { return e.hostShell !== false; }, get pid() { return child ? child.pid : null; }, configFile: path.join(stateOf(e), 'resident.json'),
      key: () => separate.readKey(keyFile),
      event: (k, d) => first.event(k, { resident: e.id, ...(d || {}) }),
      async up() { const h = await separate.call(e.port, '/host/hello', undefined, null, 1500); return h.status === 200 && h.body && h.body.resident && h.body.resident.id === e.id; },
      start() { if (e.run === 'process' && spawnThem && !child) child = separate.spawnResident(r.configFile, { log: shared.say }); return r; },
      restart: async () => { if (child) { await child.stop(); child = null; } r.start(); },
      close: () => (child ? child.stop().then(() => { child = null; }) : Promise.resolve()),
    };
    return r;
  }
  /** Her key, in her state folder and the front's: made once, when she first runs on her own. */
  function keysFor(e) {
    const kf = path.join(keyDir, e.id + '.key');
    let key = separate.readKey(kf);
    if (!key) { key = separate.newKey(); separate.writeKey(kf, key); }
    separate.writeKey(path.join(stateOf(e), 'front.key'), key);
  }
  const services = () => require('./services.cjs');
  /** A service's install and remove steps, written in the front's state folder for the person to run as admin. */
  const planFor = (e) => {
    const dir = path.join(first.stateDir, 'services', e.id);
    return services().writePlan(dir, services().plan({
      entry: { ...e, state: stateOf(e), root: path.resolve(e.root) }, configFile: path.join(stateOf(e), 'resident.json'),
      page: opts.page ? path.resolve(opts.page) : null, dir, access: e.access || defaultAccess,
      ...(opts.person !== undefined ? { person: opts.person } : {}),
    }));
  };

  for (const e of reg) {
    if (!RESIDENT_ID.test(String(e.id)) || residents.has(e.id) || !e.root) { first.event('resident.skipped', { id: String(e.id) }); continue; }
    try {
      if (e.run === 'process' || e.run === 'service') residents.set(e.id, remoteResident(e).start());
      else residents.set(e.id, createResident({ ...common, ...e }, shared));
    } catch (err) { first.event('resident.unavailable', { id: e.id, why: err.message }); shared.say(`Resident ${e.id}: not available (${err.message}).`); }
  }
  const cleanName = (s) => String(s || '').replace(/[\x00-\x1f<>]/g, '').trim().slice(0, 60);
  const fail = (status, error) => Object.assign(new Error(error), { status });
  /** Whether a new resident by this id could be made from a client (before the PIN is taken). */
  function checkNew(id) {
    id = String(id || '').trim().toLowerCase();
    if (!RESIDENT_ID.test(id) || RESERVED.has(id)) throw fail(400, 'A resident\'s id is lowercase letters, digits and dashes (up to 40), like "noe" or "jade-vault".');
    if (residents.has(id)) throw fail(409, `There is already a resident "${id}" on this host.`);
    if (!homes) throw fail(409, 'This host was started without a folder for new residents (--homes), so none can be made from a client.');
    const home = path.join(homes, id);
    if (fs.existsSync(home) && fs.readdirSync(home).length) throw fail(409, `A folder named "${id}" is already there with things in it. A client never takes over a folder; the person can add it on the host itself.`);
    return { id, home };
  }

  /**
   * A new resident. From a client (with the PIN): a new, empty home in `homes`, named by them, without host_shell
   * (unless she runs as her own service, where the shell is walled off). From the host itself (local: true): may name
   * an existing folder as her home, and give her the shell.
   * run: 'inside' (in the host's own process, as before), 'process' (her own process, the host's account), or
   * 'service' (her own service under her own identity: the person installs it as admin; see services.cjs).
   */
  function addResident({ id, name, root, hostShell, local = false, run, access } = {}, by = 'the host') {
    id = String(id || '').trim().toLowerCase();
    run = separate.RUNS.includes(run) ? run : defaultRun;
    let home;
    if (local && root) {
      if (!RESIDENT_ID.test(id) || RESERVED.has(id)) throw fail(400, 'A resident\'s id is lowercase letters, digits and dashes (up to 40), like "noe" or "jade-vault".');
      if (residents.has(id)) throw fail(409, `There is already a resident "${id}" on this host.`);
      home = path.resolve(root);
    } else ({ home } = checkNew(id));
    if (run !== 'inside' && !basePort) throw fail(409, 'A resident in her own process needs her own port, and this host was started without one.');
    fs.mkdirSync(home, { recursive: true });
    const ports = [basePort, ...reg.map((e) => e.port)].filter((n) => Number(n) > 0);
    const entry = {
      id, name: cleanName(name) || id, root: home, state: local && root ? undefined : path.join(path.dirname(home), id + ' (host)'),
      port: basePort ? Math.max(...ports) + 1 : null,
      hostShell: run === 'service' ? hostShell !== false : local ? hostShell !== false : false,
      run, created: new Date().toISOString(), by: cleanName(by) || 'a device',
    };
    if (run === 'service') entry.access = ACCESS.includes(access) ? access : defaultAccess;
    let r;
    if (run === 'inside') { r = createResident({ ...common, ...entry }, shared); entry.state = r.stateDir; }
    else {
      entry.state = stateOf(entry);
      keysFor(entry); configFor(entry);
      if (run === 'service') entry.plan = planFor(entry).dir;
      r = remoteResident(entry);
    }
    reg.push(entry); saveReg();
    residents.set(id, r);
    if (run !== 'inside') r.start();
    first.event('resident.new', { id, by: entry.by, fromClient: !local, run });
    r.event('resident.new', { id, by: entry.by, fromClient: !local, run });
    shared.say(`New resident: ${entry.name} (${id})${entry.port ? `, at port ${entry.port}` : ''}${run === 'inside' ? '' : run === 'process' ? ', in her own process' : ', as her own service once it is installed'}.`);
    tell(r, entry, 'new');
    return r;
  }
  /** host_shell on or off for a resident beyond the first (the person, on the host itself); kept in residents.json. */
  async function setHostShell(rid, on) {
    const e = reg.find((x) => x.id === rid);
    if (!e) throw fail(404, rid === first.id ? `${first.name} is the host's first resident: her host_shell is always on.` : `No resident ${rid}.`);
    const r = residents.get(rid);
    if (e.run === 'service') {
      // before her service is installed, her folder is still the host's to write; after, it's hers (and the admins')
      if (await r.up()) throw fail(409, `${e.name}'s service is running, so her folder is hers now: run its remove step, change this, and install it again.`);
      const was = e.hostShell; e.hostShell = !!on;
      try { configFor(e); } catch (err) { e.hostShell = was; throw fail(409, `${e.name}'s folder is hers now (her service is installed): run its remove step, change this, and install it again.`); }
      saveReg(); return r;
    }
    e.hostShell = !!on; saveReg();
    if (e.run === 'process') { configFor(e); await r.restart(); } else r.setHostShell(on);
    return r;
  }
  /**
   * Move a resident beyond the first between the host's own process, her own process, and her own service. A move
   * away from 'service' waits until the person has run its remove step (her folders are hers until then).
   */
  async function setRun(rid, run) {
    const e = reg.find((x) => x.id === rid);
    if (!e) throw fail(404, rid === first.id ? `${first.name} is the host's first resident: she stays in the host's own process.` : `No resident ${rid}.`);
    if (!separate.RUNS.includes(run)) throw fail(400, 'inside, process or service.');
    if (e.run === run || (!e.run && run === 'inside')) return residents.get(rid);
    if (run !== 'inside' && !e.port) throw fail(409, 'She needs her own port for that, and this host was started without one.');
    const old = residents.get(rid);
    if (e.run === 'service' && await old.up()) throw fail(409, `${e.name}'s service is still running: run its remove step first (as admin), then move her.`);
    if (old.remote) await old.close(); else { old.close(); const s = servers.get(rid); if (s) { await closeServer(s); servers.delete(rid); } }
    const was = e.run || 'inside';
    e.run = run;
    // as her own service, her shell is walled off from the other homes: so she has it (the person can turn it off)
    if (run === 'service') { e.hostShell = true; if (!ACCESS.includes(e.access)) e.access = defaultAccess; }
    let r;
    if (run === 'inside') r = createResident({ ...common, ...e }, shared);
    else { e.state = stateOf(e); keysFor(e); configFor(e); if (run === 'service') e.plan = planFor(e).dir; r = remoteResident(e); }
    saveReg(); residents.set(rid, r);
    if (run !== 'inside') r.start();
    first.event('resident.run', { id: rid, from: was, to: run });
    tell(r, e, 'moved');
    return r;
  }
  /** How the person reaches a service resident's home: through it ('person'), or a doorstep beside it. Before install. */
  async function setAccess(rid, access) {
    const e = reg.find((x) => x.id === rid);
    if (!e || e.run !== 'service') throw fail(404, `${rid} isn't set to run as her own service (run ${rid} service).`);
    if (!ACCESS.includes(access)) throw fail(400, 'person or doorstep.');
    if (await residents.get(rid).up()) throw fail(409, `${e.name}'s service is running: run its remove step first (as admin), then change this and install again.`);
    const was = e.access; e.access = access;
    const p = planFor(e);
    if (!p.written) { e.access = was; throw fail(409, p.why); }
    saveReg(); first.event('resident.access', { id: rid, access });
    return p;
  }
  const entryOf = (rid) => reg.find((e) => e.id === rid) || {};
  const residentList = () => [...residents.values()].map((r) => ({ id: r.id, name: r.name, port: r.livePort || entryOf(r.id).port || (r === first ? basePort : null), hostShell: r.hostShell, run: r === first ? 'inside' : entryOf(r.id).run || 'inside', ...(entryOf(r.id).access ? { access: entryOf(r.id).access } : {}), first: r === first }));

  // ---- a fresh client asking for a resident that will run as her own service: the person says yes on the host ----
  const tickets = new Map(); // ticket → { id, name, device, state: waiting|approved|declined, at }
  const TICKET_MS = 24 * 3600e3;
  const sweep = () => { for (const [t, v] of tickets) if (Date.now() - v.at > TICKET_MS) tickets.delete(t); };
  const waiting = () => { sweep(); return [...tickets.values()].filter((v) => v.state === 'waiting').map(({ id, name, device, at }) => ({ id, name, device, asked: new Date(at).toISOString() })); };
  function answer(rid, yes) {
    sweep();
    const t = [...tickets.entries()].find(([, v]) => v.id === rid && v.state === 'waiting');
    if (!t) throw fail(404, `No one is waiting for a resident "${rid}".`);
    if (!yes) { t[1].state = 'declined'; first.event('resident.declined', { id: rid }); return null; }
    const r = addResident({ id: rid, name: t[1].name, run: 'service' }, t[1].device);
    t[1].state = 'approved';
    return r;
  }
  /** Pair the client that asked with a resident in her own process, once she answers (her process makes the key). */
  async function pairRemote(r, device, waitMs = 15000) {
    const until = Date.now() + waitMs;
    for (;;) {
      if (await r.up()) {
        const p = await separate.call(entryOf(r.id).port, '/host/front/pair', { name: device }, r.key());
        if (p.status === 200) return p.body;
        return null;
      }
      if (Date.now() > until) return null;
      await new Promise((ok) => setTimeout(ok, 300));
    }
  }

  const send = (res, status, body, headers = {}) => {
    res.writeHead(status, { 'Content-Type': typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers });
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
  };
  const fromElsewhere = (req) => { const s = String(req.headers['sec-fetch-site'] || ''); return s && s !== 'same-origin' && s !== 'none'; };
  const readJson = (req) => new Promise((resolve) => { const parts = []; let n = 0; req.on('data', (d) => { n += d.length; if (n <= 8192) parts.push(d); }); req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(parts).toString('utf8') || '{}')); } catch { resolve({}); } }); req.on('error', () => resolve({})); });

  /** Tend a resident: in this process directly, or in hers over this machine with her key. */
  async function tendOf(rid, op, args, by) {
    const r = residents.get(rid); if (!r) throw fail(404, `No island "${rid}".`);
    if (!r.remote) return op === 'view' ? r.tend.view() : r.tend.act(op, args, by);
    const t = await separate.call(entryOf(rid).port, '/host/front/tend', { op, args, by }, r.key(), 8000);
    if (t.status === 0) throw fail(503, `${r.name} isn\u2019t running right now.`);
    if (t.status !== 200) throw fail(t.status, (t.body && t.body.error) || 'She didn\u2019t take that.');
    return t.body;
  }
  const servicePlan = (rid) => { const e = reg.find((x) => x.id === rid); if (!e || e.run !== 'service') throw fail(404, `${rid} isn't set to run as her own service (run ${rid} service).`); return planFor(e); };
  // the host's own page for everything its window does (harbor.cjs): the front only
  const harbor = front ? null : createHarbor({
    first, stateDir: first.stateDir, pins, version: VERSION, residents: () => residentList(), resident: (rid) => residents.get(rid) || null,
    entryOf, addResident, setRun, setHostShell, setAccess, waiting, answer, servicePlan, tendOf, send, readJson, fromElsewhere,
    trustNets: shared.trustNets, elevate: opts.elevate,
  });

  async function route(defaultId, req, res) {
    const url = new URL(req.url || '/', 'http://host');
    const p = url.pathname;
    const here = residents.get(defaultId) || first;
    try {
      if (harbor && (defaultId === first.id) && await harbor(req, res, url)) return;
      // ---- between the front and a resident in her own process: this machine only, with her key ----
      if (p === '/host/front/pin' && req.method === 'POST' && !front) {
        const b = await readJson(req);
        const r = residents.get(String(b.id || ''));
        if (!r || !r.remote || !separate.keyOk(req, r.key())) { first.event('refused.front', { path: p }); return send(res, 403, { error: 'Not for you.' }); }
        const t = pins.take(b.code);
        return t.ok ? send(res, 200, { ok: true }) : send(res, t.status, t.body);
      }
      if (p === '/host/front/tend' && req.method === 'POST' && front) {
        if (!separate.keyOk(req, front.key)) { first.event('refused.front', { path: p }); return send(res, 403, { error: 'Not for you.' }); }
        const b = await readJson(req);
        try { return send(res, 200, b.op === 'view' ? first.tend.view() : await first.tend.act(b.op, b.args || {}, String(b.by || 'the keeper').slice(0, 60))); }
        catch (e) { return send(res, e.status || 500, { error: e.message }); }
      }
      if (p === '/host/front/pair' && req.method === 'POST' && front) {
        if (!separate.keyOk(req, front.key)) { first.event('refused.front', { path: p }); return send(res, 403, { error: 'Not for you.' }); }
        const b = await readJson(req);
        return send(res, 200, first.pairNow(b.name).body);
      }
      // ---- the residents themselves: who lives here, and a new one ----
      if (p === '/host/residents/wait' && req.method === 'GET' && !front) {
        if (fromElsewhere(req)) return send(res, 403, { error: 'Only pages from this host may ask it.' });
        sweep();
        const t = tickets.get(String(url.searchParams.get('ticket') || ''));
        if (!t) return send(res, 404, { error: 'No such request, or it has run out (a day).' });
        if (t.state === 'declined') return send(res, 410, { error: 'The person at the host said no to this one.' });
        if (t.state === 'waiting') return send(res, 202, { waiting: 'for the person at the host to say yes' });
        const r = residents.get(t.id);
        const paired = r && await pairRemote(r, t.device, 0);
        if (!paired) return send(res, 202, { waiting: 'for her service to be installed and started' });
        tickets.delete(url.searchParams.get('ticket'));
        return send(res, 200, { resident: residentList().find((x) => x.id === r.id), ...paired });
      }
      if (p === '/host/residents') {
        if (fromElsewhere(req)) { here.event('refused.cross-site', { path: p }); return send(res, 403, { error: 'Only pages from this host may ask it.' }); }
        const where = requestPlace(req, shared.trustNets);
        if (req.method === 'GET') {
          const dev = here.deviceOf(req);
          if (!dev) return send(res, 401, { error: 'This device is not paired with the host.' });
          if (!mayChange(where)) return send(res, 403, { error: "Who lives on this host can only be seen from the house's own network or the tailnet." });
          return send(res, 200, residentList().map((r) => ({ ...r, you: r.id === here.id })));
        }
        if (req.method === 'POST') {
          // a fresh client with no backup: the host's PIN (the person, at the host) is the yes for a new home
          if (!mayChange(where)) { here.event('refused.settings-from-elsewhere', { path: p, via: where.via }); return send(res, 403, { error: "A new resident can only be made from the house's own network or the tailnet." }); }
          const b = await readJson(req);
          if (defaultRun === 'service' && !front) {
            // her own service needs the person at the host to install it, as admin: so the PIN asks, and they say yes there
            let id; try { ({ id } = checkNew(b.id)); } catch (e) { return send(res, e.status || 500, { error: e.message }); }
            if ([...tickets.values()].some((v) => v.id === id && v.state === 'waiting')) return send(res, 409, { error: `Someone is already waiting for a resident "${id}".` });
            const t = await pins.take(b.pin);
            if (!t.ok) return send(res, t.status, t.body);
            const ticket = crypto.randomBytes(24).toString('base64url');
            tickets.set(ticket, { id, name: cleanName(b.name) || id, device: cleanName(b.device) || 'a device', state: 'waiting', at: Date.now() });
            first.event('resident.asked', { id });
            shared.say(`A device asks for a new resident: ${cleanName(b.name) || id} (${id}), as her own service. Type "approve ${id}" (or "decline ${id}").`);
            return send(res, 202, { waiting: 'for the person at the host to say yes, and install her service', ticket, ask: `/host/residents/wait?ticket=${ticket}` });
          }
          const t = await pins.take(b.pin);
          if (!t.ok) return send(res, t.status, t.body);
          let r;
          try { r = addResident({ id: b.id, name: b.name }, b.device); } catch (e) { return send(res, e.status || 500, { error: e.message }); }
          const paired = r.remote ? await pairRemote(r, b.device) : r.pairNow(b.device).body;
          if (!paired) return send(res, 202, { resident: residentList().find((x) => x.id === r.id), waiting: 'She is made, but her process hasn\'t answered yet: pair with her at /pair on her own address.' });
          return send(res, 200, { resident: residentList().find((x) => x.id === r.id), ...paired });
        }
        return send(res, 405, { error: 'GET to list, POST to make a new one.' });
      }
      // ---- one resident by name, from any of the host's addresses (app clients) ----
      const m = /^\/r\/([^/]+)(\/.*)?$/.exec(p);
      if (m) {
        const r = residents.get(m[1]);
        if (!r) return send(res, 404, { error: 'No resident by that name on this host.' });
        const rest = m[2] || '/';
        // her pages belong at her own address, so a browser keeps her key and storage apart from everyone else's
        if (req.method === 'GET' && PAGE_PATHS.has(rest)) {
          const port = residentList().find((x) => x.id === r.id).port;
          if (!port) return send(res, 409, `${r.name}'s pages are at her own address, and the host hasn't opened one for her yet.`);
          const hostName = String(req.headers.host || '127.0.0.1').replace(/:\d+$/, '');
          return send(res, 302, '', { Location: `http://${hostName}:${port}${rest}${url.search}` });
        }
        // in her own process or service: passed on to her, at her port on this machine
        if (r.remote) return separate.proxy(req, res, entryOf(r.id).port, rest + url.search);
        req.url = rest + url.search;
        return r.handle(req, res);
      }
      return here.handle(req, res);
    } catch (e) {
      return send(res, 500, { error: e && e.message ? e.message : String(e) });
    }
  }

  const servers = new Map();
  const closeServer = (s) => new Promise((ok) => { if (!s.listening) return ok(); if (s.closeAllConnections) s.closeAllConnections(); s.close(() => ok()); });
  /** The server for one resident's own address: everything there is hers, without the /r/<id> prefix. */
  function serverFor(rid) {
    if (!residents.has(rid)) throw new Error(`No resident ${rid}.`);
    if (residents.get(rid).remote) throw new Error(`${rid} runs in her own process, which opens her own address.`);
    if (!servers.has(rid)) {
      const s = http.createServer((q, w) => { route(rid, q, w); });
      s.on('listening', () => { const a = s.address(); if (a && typeof a === 'object' && residents.get(rid)) residents.get(rid).livePort = a.port; });
      servers.set(rid, s);
    }
    return servers.get(rid);
  }
  const server = serverFor(first.id);

  const { id: _id, name: _name, handle: _h, deviceOf: _d, pairNow: _p, livePort: _l, close: _c, hostShell: _s, setHostShell: _ss, ...firstApi } = first;
  return {
    ...firstApi,
    id: first.id, name: first.name, server, newPin: pins.newPin, VERSION,
    residents: residentList,
    resident: (rid) => residents.get(rid) || null,
    addResident,
    setHostShell,
    setRun,
    setAccess,
    /** Fresh clients waiting for the person's yes to a resident as her own service; and that yes (or no). */
    waiting,
    approve: (rid) => answer(rid, true),
    decline: (rid) => { answer(rid, false); },
    /** Her service's install and remove steps, written again (the person runs them as admin). */
    servicePlan,
    serverFor,
    /** Called with (resident, entry, 'new' | 'moved') for each resident made or moved while the host runs. */
    onResident: (f) => listeners.push(f),
    close: async () => {
      await Promise.all([...residents.values()].map((r) => r.close()));
      await Promise.all([...servers.values()].map(closeServer));
    },
  };
}

module.exports = { createHomeHost, createResident, findShell, VERSION };
