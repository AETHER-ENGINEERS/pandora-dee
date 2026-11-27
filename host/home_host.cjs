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

const VERSION = '0.1.0';
const PIN_MS = 10 * 60 * 1000;       // a PIN lasts ten minutes, and works once
const LOCK_AFTER = 5;                // wrong PINs in a row before pairing rests
const LOCK_MS = 5 * 60 * 1000;
const WRITER_MS = 30 * 1000;         // a writer page silent this long gives up the vault to the next
const DISK_BODY_MAX = 16 * 1048576;  // a disk call's body: a 3 MB piece, base64, with room to spare
const SHELL_OUT_MAX = 1048576;
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

/**
 * opts: { root, state?, page?, shell?, log? }
 *   root   the home folder: the vault's "/"
 *   state  where the host keeps its own records (devices, log); default "<root> (host)", beside the home, not in it
 *   page   the built Atelier page to serve at "/" (dist/pandora-dee.html)
 *   shell  the program host_shell runs
 */
function createHomeHost(opts) {
  const disk = createDiskHost(opts.root);
  const root = disk.root;
  const stateDir = path.resolve(opts.state || path.join(path.dirname(root), path.basename(root) + ' (host)'));
  fs.mkdirSync(stateDir, { recursive: true });
  const devFile = path.join(stateDir, 'devices.json');
  const logFile = path.join(stateDir, 'events.jsonl');
  const shell = findShell(opts.shell);
  const say = opts.log || (() => {});
  const writerMs = Number(opts.writerMs) > 0 ? Number(opts.writerMs) : WRITER_MS;

  // ---------- devices and pairing ----------
  let devices = [];
  try { devices = JSON.parse(fs.readFileSync(devFile, 'utf8')); } catch { devices = []; }
  const saveDevices = () => { const t = devFile + '.tmp'; fs.writeFileSync(t, JSON.stringify(devices, null, 1)); fs.renameSync(t, devFile); };
  function event(kind, fields = {}) {
    try { fs.appendFileSync(logFile, JSON.stringify({ at: new Date().toISOString(), kind, ...fields }) + '\n'); } catch { /* the log never stops the work */ }
  }
  let pin = null; // { code, until }
  let wrong = 0, lockedUntil = 0;
  function newPin() {
    pin = { code: String(crypto.randomInt(0, 1000000)).padStart(6, '0'), until: now() + PIN_MS };
    event('pin.new');
    return pin.code;
  }
  function pair(code, name) {
    if (now() < lockedUntil) return { status: 429, body: { error: 'Pairing is resting after too many wrong PINs. Try again in a few minutes.' } };
    const good = pin && now() < pin.until && typeof code === 'string' && code.length === pin.code.length && crypto.timingSafeEqual(Buffer.from(code), Buffer.from(pin.code));
    if (!good) {
      wrong++;
      if (wrong >= LOCK_AFTER) { lockedUntil = now() + LOCK_MS; wrong = 0; pin = null; event('pair.locked'); }
      event('pair.refused');
      return { status: 401, body: { error: 'That PIN is not the one the host is showing, or it has expired.' } };
    }
    wrong = 0; pin = null; // a PIN works once
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
      description: 'What the home host is: its version, which shell host_shell runs, and the home folder.',
      inputSchema: { type: 'object', properties: {} },
    },
  ];
  async function callTool(name, args, dev) {
    if (name === 'host_shell') {
      const r = await runShell(args || {});
      event('tool', { device: dev.id, tool: name, command: String(args?.command || '').slice(0, 500), cwd: args?.cwd || '/', code: r.code, ms: r.ms });
      return { content: [{ type: 'text', text: `exit ${r.code}\n--- stdout\n${r.stdout}${r.stderr ? `\n--- stderr\n${r.stderr}` : ''}` }], isError: r.code !== 0 };
    }
    if (name === 'host_info') {
      event('tool', { device: dev.id, tool: name });
      return { content: [{ type: 'text', text: JSON.stringify({ app: 'pandora-dee-host', version: VERSION, shell, home: root, platform: process.platform }) }] };
    }
    event('tool.unknown', { device: dev.id, tool: name });
    return { content: [{ type: 'text', text: `No tool named ${name} on this host.` }], isError: true };
  }
  async function mcp(msg, dev) {
    const { id, method, params } = msg || {};
    const reply = (result) => ({ jsonrpc: '2.0', id, result });
    if (method === 'initialize') return reply({ protocolVersion: params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'pandora-dee-host', version: VERSION } });
    if (method === 'ping') return reply({});
    if (method === 'tools/list') return reply({ tools: TOOLS });
    if (method === 'tools/call') return reply(await callTool(params?.name, params?.arguments, dev));
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
  /** Another website asking through a visitor's browser: never. (Programs and the host's own pages are fine.) */
  const fromElsewhere = (req) => { const s = String(req.headers['sec-fetch-site'] || ''); return s && s !== 'same-origin' && s !== 'none'; };

  const pageFile = opts.page ? path.resolve(opts.page) : null;
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
      if (p === '/host/hello' && req.method === 'GET') { const d = deviceOf(req); return send(res, 200, { ok: true, app: 'pandora-dee-host', version: VERSION, paired: !!d, device: d ? { id: d.id, name: d.name } : null }); }
      if (p === '/host/pair' && req.method === 'POST') {
        let b = {}; try { b = JSON.parse(await readBody(req, 4096) || '{}'); } catch { b = {}; }
        const r = pair(b.pin, b.name); return send(res, r.status, r.body);
      }

      // everything else: paired devices only
      const dev = deviceOf(req);
      if (!dev) { event('refused.unpaired', { path: p }); return send(res, 401, { error: 'This device is not paired with the host. Open /pair on it and enter the PIN the host shows.' }); }

      if (p === '/host/disk' && req.method === 'POST') {
        let call; try { call = JSON.parse(await readBody(req, DISK_BODY_MAX)); } catch (e) { return send(res, e.status || 400, 'ERR:' + (e.status ? 'that piece is too big' : 'not a disk call')); }
        const name = String(call?.name || ''); const page = String(req.headers['x-page'] || '');
        if (WRITES.has(name)) {
          if (!mayWrite(page, dev)) return send(res, 200, 'ERR:Another window is writing this vault right now, so this one only reads. Close the other one (or wait half a minute) to write here.');
        } else touchWriter(page);
        if (name === 'clear') event('disk.clear', { device: dev.id });
        if (name === 'info') { const i = JSON.parse(disk.call('info')); i.host = { version: VERSION, device: dev.name, writer: !writer || writer.page === page || now() - writer.at > writerMs }; return send(res, 200, JSON.stringify(i)); }
        return send(res, 200, String(disk.call(name, Array.isArray(call.args) ? call.args : [])));
      }
      if (p === '/host/client/settings') {
        if (req.method === 'GET') return send(res, 200, dev.settings || {});
        if (req.method === 'PUT') {
          let b; try { b = JSON.parse(await readBody(req, 65536)); } catch (e) { return send(res, e.status || 400, { error: 'Settings are a JSON object of up to 64 KB.' }); }
          if (!b || typeof b !== 'object' || Array.isArray(b)) return send(res, 400, { error: 'Settings are a JSON object.' });
          dev.settings = b; saveDevices(); return send(res, 200, { ok: true });
        }
      }
      if (p === '/mcp') {
        if (req.method === 'DELETE') return send(res, 200, {});
        if (req.method !== 'POST') return send(res, 405, { error: 'POST JSON-RPC here (streamable HTTP).' });
        let msg; try { msg = JSON.parse(await readBody(req, 1048576)); } catch { return send(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'not JSON' } }); }
        if (Array.isArray(msg)) { const out = (await Promise.all(msg.map((m) => mcp(m, dev)))).filter(Boolean); return out.length ? send(res, 200, out) : (res.writeHead(202), res.end()); }
        const r = await mcp(msg, dev);
        if (!r) { res.writeHead(202); return res.end(); }
        return send(res, 200, r);
      }
      return send(res, 404, { error: 'Not here.' });
    } catch (e) {
      return send(res, 500, { error: e && e.message ? e.message : String(e) });
    }
  }

  const server = http.createServer((req, res) => { handle(req, res); });
  return {
    root, stateDir, shell, server, newPin, revoke, VERSION,
    devices: () => devices.map(({ id, name, created, seenAt }) => ({ id, name, created, seen: seenAt ? new Date(seenAt).toISOString() : null })),
    close: () => new Promise((r) => server.close(() => r())),
  };
}

module.exports = { createHomeHost, findShell, VERSION };
