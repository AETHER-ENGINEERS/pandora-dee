// Her own browser on the host (parity step 4, an addition: the browser in her Android app stays hers too). Her Atelier's
// own browser tool (app/modules/browser_tool.js, with its page agent, browser_agent.js) runs unchanged in a sandbox,
// and where the Android app would give it a second WebView (BrowserHost.java), the host gives it a headless Chrome or
// Edge of this computer's, driven over the DevTools protocol (no added packages), answering every command the same way.
//
// It is hers: its own profile (cookies, logins) in her state folder, never another resident's. It is off until the
// keeper turns it on at the host (her own tools can't), and it can't reach this house's own network (this computer,
// the router, the other machines at home) unless the keeper allows that too: everything the browser sends, pages, what
// they load, their WebSockets, goes through a small proxy of the host's own, which looks up where each connection would
// go and connects only to an address outside the house (so a name that points home is caught too). It closes itself
// when she hasn't used it for ten minutes.
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const dns = require('node:dns');
const net = require('node:net');
const http = require('node:http');
const { spawn } = require('node:child_process');

const MODULES = path.join(__dirname, '..', 'app', 'modules');
const IDLE_MS = 10 * 60000;
const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const MOBILE_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';

/** A Chrome-family browser on this computer: the one the person named (PDHOST_BROWSER), or a usual place. */
function findBrowser(named) {
  const c = [named, process.env.PDHOST_BROWSER].filter(Boolean);
  if (process.platform === 'win32') {
    for (const base of [process.env['ProgramFiles(x86)'], process.env.ProgramFiles, process.env.LOCALAPPDATA].filter(Boolean)) {
      c.push(path.join(base, 'Microsoft', 'Edge', 'Application', 'msedge.exe'), path.join(base, 'Google', 'Chrome', 'Application', 'chrome.exe'), path.join(base, 'Chromium', 'Application', 'chrome.exe'));
    }
  } else if (process.platform === 'darwin') {
    c.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/Applications/Chromium.app/Contents/MacOS/Chromium');
  } else {
    for (const d of (process.env.PATH || '/usr/bin:/usr/local/bin').split(':')) for (const n of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge']) c.push(path.join(d, n));
  }
  return c.find((p) => { try { return fs.statSync(p).isFile(); } catch { return false; } }) || null;
}

/** Is this address one of this house's own (this computer, the home network, link-local, private ranges)? */
function homeAddress(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const x = ip.toLowerCase();
  if (x.startsWith('::ffff:')) return homeAddress(x.slice(7));
  return x === '::1' || x === '::' || x.startsWith('fe8') || x.startsWith('fe9') || x.startsWith('fea') || x.startsWith('feb') || x.startsWith('fc') || x.startsWith('fd') || x.startsWith('ff');
}

/** Where a connection would go, if it may: { ip } outside the house (or anywhere, with lan), or null. */
async function vet(host, lan) {
  const h = String(host || '').replace(/^\[|\]$/g, '');
  if (!h) return null;
  let ips;
  if (net.isIP(h)) ips = [h];
  else { try { ips = (await dns.promises.lookup(h, { all: true })).map((x) => x.address); } catch { return null; } }
  if (!ips.length) return null;
  if (!lan && ips.some(homeAddress)) return null;
  return { ip: ips[0] };
}
/** Her browser's way out: a proxy on this computer's loopback that connects only where vet() says. */
function createGate({ lan, refused }) {
  const NO = 'Her browser on the host does not visit this house\'s own network.\n';
  const no = (sock, why) => { try { sock.end('HTTP/1.1 403 Forbidden\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\n' + NO); } catch { /* gone */ } refused(why); };
  const server = http.createServer(async (req, res) => {
    let u; try { u = new URL(req.url); } catch { res.writeHead(400); return res.end(); }
    if (u.protocol !== 'http:') { res.writeHead(400); return res.end(); }
    const v = await vet(u.hostname, lan()); if (!v) { refused(u.hostname); res.writeHead(403, { 'Content-Type': 'text/plain' }); return res.end(NO); }
    const headers = { ...req.headers }; delete headers['proxy-connection']; delete headers['proxy-authorization'];
    const up = http.request({ host: v.ip, port: u.port || 80, method: req.method, path: u.pathname + u.search, headers, setHost: false }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
    up.on('error', () => { try { res.writeHead(502); res.end(); } catch { /* gone */ } });
    req.pipe(up);
  });
  server.on('connect', async (req, sock, head) => { // https and wss: a tunnel, to a vetted address only
    const m = /^\[?([^\]]+?)\]?:(\d+)$/.exec(req.url || ''); if (!m) return no(sock, 'bad');
    const v = await vet(m[1], lan()); if (!v) return no(sock, m[1]);
    const up = net.connect(Number(m[2]), v.ip, () => { sock.write('HTTP/1.1 200 Connection Established\r\n\r\n'); if (head && head.length) up.write(head); up.pipe(sock); sock.pipe(up); });
    up.on('error', () => sock.destroy()); sock.on('error', () => up.destroy());
  });
  server.on('upgrade', async (req, sock, head) => { // a plain ws:// WebSocket
    let u; try { u = new URL(req.url); } catch { return sock.destroy(); }
    const v = await vet(u.hostname, lan()); if (!v) return no(sock, u.hostname);
    const up = net.connect(Number(u.port || 80), v.ip, () => {
      const lines = [`${req.method} ${u.pathname + u.search} HTTP/1.1`];
      for (let i = 0; i < req.rawHeaders.length; i += 2) if (!/^proxy-/i.test(req.rawHeaders[i])) lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
      up.write(lines.join('\r\n') + '\r\n\r\n'); if (head && head.length) up.write(head); up.pipe(sock); sock.pipe(up);
    });
    up.on('error', () => sock.destroy()); sock.on('error', () => up.destroy());
  });
  return new Promise((res) => server.listen(0, '127.0.0.1', () => res({ port: server.address().port, close: () => server.close() })));
}

/** A minimal DevTools protocol client over the browser's own WebSocket. */
function cdpClient(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let seq = 0; const pending = new Map(); const handlers = new Map();
    const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
      const id = ++seq; pending.set(id, { res, rej });
      ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
    ws.onopen = () => resolve({
      send,
      on: (method, f) => { if (!handlers.has(method)) handlers.set(method, new Set()); handlers.get(method).add(f); return () => handlers.get(method).delete(f); },
      close: () => { try { ws.close(); } catch { /* gone */ } },
    });
    ws.onerror = () => reject(new Error('could not reach the browser'));
    ws.onclose = () => { for (const p of pending.values()) p.rej(new Error('the browser closed')); pending.clear(); };
    ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(String(ev.data)); } catch { return; }
      if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); if (m.error) p.rej(new Error(m.error.message || 'the browser said no')); else p.res(m.result || {}); return; }
      if (m.method && handlers.has(m.method)) for (const f of handlers.get(m.method)) { try { f(m.params || {}, m.sessionId); } catch { /* one listener */ } }
    };
  });
}

/**
 * opts: { stateDir, settings() → { on, lan }, exe?, log(kind, fields), trace(kind, fields), saveShot(jpegBuffer) → vault path,
 *         now? } → { tool(args) → text, def(), state(), close() }
 */
function createHostBrowser(opts) {
  const log = opts.log || (() => {}), trace = opts.trace || (() => {});
  const profile = path.join(opts.stateDir, 'browser-profile');
  let proc = null, cdp = null, sid = null, starting = null, idle = null, lastDialog = '', openWait = null, ua = 'desktop', gate = null;
  let exiting = Promise.resolve(); // a browser that was closed lets go of her profile before another starts on it

  // ---- her Atelier's own browser tool, in a sandbox, with the host as its "Android half" ----
  const viewQ = [];
  const win = { __viewQ: viewQ };
  const ctx = {
    window: win, S: { browserOn: true }, WORLD_TOOL_DEFS: [], console: { log() {}, warn() {}, error() {}, info() {} },
    setTimeout, clearTimeout, JSON, Math, Date, String, Number, Array, Object, Boolean, RegExp, Promise, Error, Map, Set, WeakMap, parseInt, parseFloat, isNaN, encodeURIComponent, decodeURIComponent,
  };
  ctx.globalThis = ctx;
  win.NetrunnerAndroid = { browser: (id, op, arg) => { run(op, arg).then((v) => reply(id, v), (e) => reply(id, { error: String((e && e.message) || e) })); } };
  const reply = (id, v) => { try { win.__jbr(id, v); } catch { /* the tool stopped waiting */ } };
  vm.createContext(ctx);
  const src = ['browser_agent.js', 'browser_tool.js'].map((f) => fs.readFileSync(path.join(MODULES, f), 'utf8')).join('\n;\n');
  vm.runInContext(`const NA = () => window.NetrunnerAndroid; const naHas = f => typeof NA()?.[f] === 'function'; const wSleep = ms => new Promise(r => setTimeout(r, ms));\n${src}\n;globalThis.__browserTool = browserTool; globalThis.__def = WORLD_TOOL_DEFS.find((t) => t.name === 'browser');`, ctx, { filename: 'her-browser.js' });

  // ---- the browser itself ----
  /** May her browser go to this address? (Asked before opening a page, to say so plainly; the gate holds the rest.) */
  async function allowed(url) {
    let u; try { u = new URL(url); } catch { return false; }
    if (!/^https?:$/.test(u.protocol)) return false;
    return !!(await vet(u.hostname, !!(opts.settings() || {}).lan));
  }
  async function start() {
    if (cdp) return;
    if (starting) return starting;
    starting = (async () => {
      await exiting;
      const exe = findBrowser(opts.exe);
      if (!exe) throw new Error('there is no Chrome, Edge or Chromium on this computer for her browser (the person can name one with PDHOST_BROWSER)');
      fs.mkdirSync(profile, { recursive: true });
      gate = await createGate({ lan: () => !!(opts.settings() || {}).lan, refused: (h) => trace('her.browser.refused', { host: String(h).slice(0, 120) }) });
      proc = spawn(exe, ['--headless=new', '--remote-debugging-port=0', `--proxy-server=http://127.0.0.1:${gate.port}`, '--proxy-bypass-list=<-loopback>', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp', '--disable-features=DnsOverHttps', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-sync', '--mute-audio', '--window-size=1280,900', ...(process.getuid && process.getuid() === 0 ? ['--no-sandbox'] : []), 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
      const wsUrl = await new Promise((res, rej) => {
        let buf = ''; const t = setTimeout(() => rej(new Error('her browser didn\'t start')), 20000);
        proc.stderr.on('data', (d) => { buf += d; const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf); if (m) { clearTimeout(t); res(m[1]); } });
        proc.on('exit', () => { clearTimeout(t); rej(new Error('her browser didn\'t start')); });
      });
      proc.on('exit', () => { cdp = null; sid = null; proc = null; });
      cdp = await cdpClient(wsUrl);
      const { targetInfos } = await cdp.send('Target.getTargets');
      const page = (targetInfos || []).find((t) => t.type === 'page');
      const targetId = page ? page.targetId : (await cdp.send('Target.createTarget', { url: 'about:blank' })).targetId;
      sid = (await cdp.send('Target.attachToTarget', { targetId, flatten: true })).sessionId;
      const s = (m, p) => cdp.send(m, p, sid);
      await s('Page.enable'); await s('Runtime.enable'); await s('Network.enable');
      cdp.on('Page.javascriptDialogOpening', (p, from) => { if (from !== sid) return; lastDialog = `${p.type}: ${String(p.message || '').slice(0, 300)}`; s('Page.handleJavaScriptDialog', { accept: p.type === 'alert' }).catch(() => {}); });
      cdp.on('Page.loadEventFired', (p, from) => { if (from === sid && openWait) { const w = openWait; openWait = null; w(null); } });
      await setUa(ua);
      log('host_browser.started', {});
    })();
    try { await starting; } finally { starting = null; }
  }
  async function setUa(kind) {
    ua = kind === 'mobile' ? 'mobile' : 'desktop';
    const s = (m, p) => cdp.send(m, p, sid);
    await s('Emulation.setUserAgentOverride', { userAgent: ua === 'mobile' ? MOBILE_UA : DESKTOP_UA });
    await s('Emulation.setDeviceMetricsOverride', ua === 'mobile' ? { width: 412, height: 860, deviceScaleFactor: 1, mobile: true } : { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  }
  const evalIn = async (expr) => {
    const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: false, timeout: 20000 }, sid);
    if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text || 'the page said no');
    return r.result ? r.result.value : null;
  };
  const where = async () => { try { return await evalIn('({ url: location.href, title: document.title, ready: document.readyState })'); } catch { return { url: '', title: '', ready: 'loading' }; } };
  /** Each command as the Android app's BrowserHost answers it. */
  async function run(op, arg) {
    if (!(opts.settings() || {}).on) throw new Error('her own browser on this computer is off: the keeper turns it on at the host, in her house\'s window');
    clearTimeout(idle); idle = setTimeout(() => close('idle'), IDLE_MS);
    await start();
    const s = (m, p) => cdp.send(m, p, sid);
    switch (op) {
      case 'open': {
        if (!/^https?:\/\//.test(String(arg || ''))) return { error: 'only http and https addresses can be opened' };
        if (!(await allowed(arg))) return { error: 'her browser on the host can\'t go there: the address isn\'t found, or it is in this house\'s own network, which it doesn\'t visit' };
        lastDialog = '';
        const loaded = new Promise((res) => { openWait = res; setTimeout(() => { if (openWait === res) { openWait = null; res('slow'); } }, 40000); });
        const nav = await s('Page.navigate', { url: String(arg) });
        if (nav.errorText) { openWait = null; return { error: `could not load the page: ${nav.errorText}` }; }
        await loaded;
        const w = await where();
        return { ok: true, url: w.url, title: w.title };
      }
      case 'eval': return await evalIn(String(arg));
      case 'shot': {
        const max = Math.max(200, Math.min(2000, Number(arg) || 1024));
        const m = await s('Page.getLayoutMetrics');
        const vw = Math.round((m.cssVisualViewport || m.visualViewport).clientWidth), vh = Math.round((m.cssVisualViewport || m.visualViewport).clientHeight);
        const scale = vw > max ? max / vw : 1;
        const r = await s('Page.captureScreenshot', { format: 'jpeg', quality: 72, clip: { x: 0, y: 0, width: vw, height: vh, scale } });
        return { b64: r.data, w: Math.round(vw * scale), h: Math.round(vh * scale) };
      }
      case 'show': case 'hide': return { ok: true, shown: false, note: 'her browser on the host has no screen: use screenshot to see it' };
      case 'back': case 'forward': {
        const h = await s('Page.getNavigationHistory'); const i = h.currentIndex + (op === 'back' ? -1 : 1);
        if (i < 0 || i >= h.entries.length) return { ok: false };
        await s('Page.navigateToHistoryEntry', { entryId: h.entries[i].id }); return { ok: true };
      }
      case 'reload': await s('Page.reload'); return { ok: true };
      case 'stop': { await s('Page.stopLoading'); if (openWait) { const w = openWait; openWait = null; w('stopped'); } return { ok: true }; }
      case 'ua': await setUa(arg === 'desktop' ? 'desktop' : 'mobile'); return { ok: true, ua };
      case 'clear': {
        await s('Page.stopLoading'); await s('Network.clearBrowserCookies'); await s('Network.clearBrowserCache');
        try { await s('Storage.clearDataForOrigin', { origin: '*', storageTypes: 'all' }); } catch { /* older browsers */ }
        await s('Page.navigate', { url: 'about:blank' }); await s('Page.resetNavigationHistory');
        return { ok: true };
      }
      case 'state': {
        const w = await where(); const h = await s('Page.getNavigationHistory');
        return { url: w.url, title: w.title, progress: w.ready === 'complete' ? 100 : 50, canGoBack: h.currentIndex > 0, shown: false, lastDialog };
      }
      default: return { error: `unknown browser command ${String(op).replace(/"/g, '')}` };
    }
  }
  function close(why) {
    clearTimeout(idle);
    if (cdp) cdp.close();
    if (proc) {
      const p = proc;
      exiting = new Promise((res) => { const t = setTimeout(res, 8000); p.once('exit', () => { clearTimeout(t); setTimeout(res, 300); }); });
      try { p.kill(); } catch { /* gone */ }
      log('host_browser.closed', { why: why || 'closed' });
    }
    if (gate) gate.close();
    cdp = null; sid = null; proc = null; gate = null;
  }

  /** Her browser tool, as her Atelier answers it; a screenshot is kept in her vault, and she's told where. */
  async function tool(a) {
    viewQ.length = 0;
    let out = await ctx.__browserTool(JSON.parse(JSON.stringify(a || {})));
    for (const v of viewQ.splice(0)) {
      let p = null; try { p = await opts.saveShot(Buffer.from(String(v.b64 || ''), 'base64')); } catch { p = null; }
      out = String(out).replace('the picture arrives in the next message', p ? `the picture is saved in her vault at ${p}` : 'the picture could not be saved');
    }
    return String(out);
  }
  return {
    tool,
    def: () => JSON.parse(JSON.stringify(ctx.__def)),
    state: () => ({ ...(opts.settings() || {}), running: !!cdp, found: !!findBrowser(opts.exe) }),
    close,
    /** Closed, and its profile let go of (for a clean stop). */
    closed: () => exiting,
  };
}

module.exports = { createHostBrowser, findBrowser, homeAddress };
