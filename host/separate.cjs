// A resident in her own process: what the host (the front) and her process share, and how they reach each other.
//
// The front keeps the host's one PIN, the list of residents, and the routes every client uses (`/r/<id>/…`). A
// resident that runs on her own (run: 'process', a child of the host under the host's account; or run: 'service',
// installed as her own service under her own identity, see services.cjs) is reached by the front over this machine
// only, at her own port. The two prove themselves to each other with a key made for her when she was made, kept in
// her state folder (front.key) and in the front's (residents/<id>.key). It never leaves this machine and is never
// logged or shown.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { placeOf } = require('./places.cjs');

const KEY_HEADER = 'x-pdee-front';
const FORWARDED = ['x-forwarded-for', 'forwarded', 'x-real-ip', 'cf-connecting-ip', 'true-client-ip', 'tailscale-user-login', 'tailscale-ingress-target'];
const RUNS = ['inside', 'process', 'service'];

const newKey = () => crypto.randomBytes(32).toString('base64url');
function writeKey(file, key) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file + '.tmp', key, { mode: 0o600 }); fs.renameSync(file + '.tmp', file);
  try { fs.chmodSync(file, 0o600); } catch { /* Windows */ }
}
const readKey = (file) => { try { return fs.readFileSync(file, 'utf8').trim(); } catch { return ''; } };

/** Straight from this machine, with no proxy in between: the only way the front and a resident talk. */
const fromThisMachine = (req) => placeOf(req.socket && req.socket.remoteAddress) === 'this machine' && !FORWARDED.some((k) => k in (req.headers || {}));
function keyOk(req, key) {
  const got = String((req.headers || {})[KEY_HEADER] || '');
  return !!key && got.length === key.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(key)) && fromThisMachine(req);
}

/** A small JSON call over this machine, with the shared key. Resolves { status, body }; never throws. */
function call(port, p, body, key, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const data = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const req = http.request({ host: '127.0.0.1', port, path: p, method: data ? 'POST' : 'GET', timeout: timeoutMs,
      headers: { ...(data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {}), ...(key ? { [KEY_HEADER]: key } : {}) } }, (res) => {
      const parts = []; res.on('data', (d) => parts.push(d));
      res.on('end', () => { let b = null; try { b = JSON.parse(Buffer.concat(parts).toString('utf8')); } catch { b = null; } resolve({ status: res.statusCode, body: b }); });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', () => resolve({ status: 0, body: null }));
    req.end(data || undefined);
  });
}

/** In her own process: the PIN is the front's, so she asks it (with her key) whether a PIN is right. */
function remotePins({ frontPort, id, key }) {
  return {
    newPin() { throw new Error('The PIN is shown by the host itself, not by a resident in her own process.'); },
    async take(code) {
      const r = await call(frontPort, '/host/front/pin', { id, code: typeof code === 'string' ? code : '' }, key);
      if (r.status === 200 && r.body && r.body.ok) return { ok: true };
      if (r.status === 401 || r.status === 429) return { status: r.status, body: { error: (r.body && r.body.error) || 'That PIN is not the one the host is showing.' } };
      return { status: 503, body: { error: 'The host that shows the PIN isn\'t answering right now. Try again in a moment.' } };
    },
  };
}

/**
 * Pass a client's request on to her process, at her port on this machine. The front says where the request came
 * from (x-forwarded-for), so her own checks (settings only from home, the tailnet) still see the real place; a client
 * can't claim a place by sending those headers itself.
 */
function proxy(req, res, port, rest) {
  const headers = { ...req.headers };
  const viaLocalProxy = placeOf(req.socket && req.socket.remoteAddress) === 'this machine' && FORWARDED.some((k) => k in req.headers);
  if (!viaLocalProxy) { for (const k of FORWARDED) delete headers[k]; headers['x-forwarded-for'] = String(req.socket.remoteAddress || ''); }
  delete headers[KEY_HEADER];
  const out = http.request({ host: '127.0.0.1', port, path: rest, method: req.method, headers }, (her) => {
    res.writeHead(her.statusCode || 502, her.headers);
    her.pipe(res);
  });
  out.on('error', () => {
    if (res.headersSent) return res.destroy();
    res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end('She isn\'t running right now. The host will reach her again when she is.');
  });
  req.pipe(out);
}

/** What her own process needs, written in her state folder (resident.json, and her key beside it). */
function writeResidentConfig(entry, extra) {
  const cfg = {
    id: entry.id, name: entry.name, root: entry.root, state: entry.state, port: entry.port, run: entry.run,
    hostShell: entry.hostShell !== false, ...extra,
  };
  fs.mkdirSync(entry.state, { recursive: true });
  const file = path.join(entry.state, 'resident.json');
  fs.writeFileSync(file + '.tmp', JSON.stringify(cfg, null, 1)); fs.renameSync(file + '.tmp', file);
  return file;
}

/**
 * run: 'process': her own process, started and watched by the host (same account as the host, so her host_shell is
 * not walled off: it stays as the host set it). Started again after a stop it didn't ask for, waiting longer each time.
 */
function spawnResident(configFile, { log = () => {}, node = process.execPath, main = path.join(__dirname, 'resident_main.cjs') } = {}) {
  let child = null, stopping = false, wait = 1000, timer = null;
  const start = () => {
    timer = null;
    const began = Date.now();
    child = spawn(node, [main, '--config', configFile, '--stdin-stop'], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    child.stdout.on('data', (d) => String(d).split(/\r?\n/).filter(Boolean).forEach((l) => log(l)));
    child.stderr.on('data', () => { /* her process's own troubles stay in her log, never in the host window */ });
    child.on('exit', () => {
      child = null;
      if (stopping) return;
      wait = Date.now() - began > 60000 ? 1000 : Math.min(wait * 2, 60000);
      timer = setTimeout(start, wait);
    });
  };
  start();
  return {
    get pid() { return child ? child.pid : null; },
    stop: () => new Promise((ok) => {
      stopping = true; if (timer) clearTimeout(timer);
      if (!child) return ok();
      const c = child; const t = setTimeout(() => { try { c.kill(); } catch {} }, 8000);
      c.once('exit', () => { clearTimeout(t); ok(); });
      try { c.stdin.end(); } catch { c.kill(); }
    }),
  };
}

module.exports = { KEY_HEADER, RUNS, newKey, writeKey, readKey, keyOk, fromThisMachine, call, remotePins, proxy, writeResidentConfig, spawnResident };
