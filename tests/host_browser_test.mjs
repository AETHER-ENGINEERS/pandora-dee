// Her own browser on the host (host/browser.cjs, with her Atelier's own browser tool and page agent): off until the
// keeper turns it on at the host; listed with her devices as "this host"; a real headless Chromium driven as her
// Android app drives its WebView; its own profile in her state folder; and, unless the keeper allows it, nothing of
// this house's own network: not a page, not what a page fetches, not a WebSocket. Stand-in model and site; synthetic
// homes only. The browser is Playwright's Chromium (PDHOST_BROWSER), as a person's Chrome or Edge would be.
import pw from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';
import crypto from 'node:crypto';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(process.env.JV_WEB), '..');
const { createHomeHost } = require(path.join(ROOT, 'host', 'home_host.cjs'));
const log = []; const fail = [];
const ok = (c, m) => { (c ? log : fail).push((c ? 'PASS ' : 'FAIL ') + m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const exe = (() => { try { const p = pw.chromium.executablePath(); return fs.existsSync(p) ? p : null; } catch { return null; } })();
if (exe) process.env.PDHOST_BROWSER = exe;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-host-browser-'));
const HOME = path.join(tmp, 'home'), STATE = path.join(tmp, 'state');
fs.mkdirSync(path.join(HOME, 'Pandora'), { recursive: true });
fs.writeFileSync(path.join(HOME, 'Pandora', 'SOUL.md'), '# SOUL\n\nI am a made-up stand-in.\n');

// ---------- a stand-in site on this computer (so: in the house), with a WebSocket ----------
const site = http.createServer((q, r) => { r.writeHead(200, { 'Content-Type': 'text/html' }); r.end('<title>Tea shop</title><h1>Teas</h1><a href="/green">Green tea</a><button onclick="document.body.insertAdjacentHTML(\'beforeend\',\'<p>added to basket</p>\')">Add to basket</button>'); });
site.on('upgrade', (req, sock) => { const k = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64'); sock.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${k}\r\n\r\n`); });
await new Promise((r) => site.listen(0, '127.0.0.1', r));
const SITE = `http://127.0.0.1:${site.address().port}`;

// ---------- a stand-in model: opens the shop and adds to the basket when asked ----------
const seen = [];
const model = http.createServer((req, res) => {
  let body = ''; req.on('data', (d) => { body += d; }); req.on('end', () => {
    if (req.url.endsWith('/models')) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ data: [{ id: 'stand-in' }] })); }
    const j = JSON.parse(body || '{}'); seen.push(j); const msgs = j.messages || []; const last = msgs.at(-1) || {};
    const say = (content, tc) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content, ...(tc ? { tool_calls: tc } : {}) } }] })); };
    const call = (name, args) => say('', [{ id: 'c' + msgs.length, type: 'function', function: { name, arguments: JSON.stringify(args) } }]);
    const tools = msgs.filter((m) => m.role === 'tool').length;
    if (/tea shop/.test(String(msgs.find((m) => m.role === 'user')?.content || ''))) {
      if (tools === 0) return call('browser', { action: 'open', url: SITE + '/' });
      if (tools === 1) return call('browser', { action: 'click', target: 'Add to basket' });
      return say(`Done. (${String(last.content).slice(-700)})`);
    }
    return say('Hello.');
  });
});
await new Promise((r) => model.listen(0, '127.0.0.1', r));

const host = createHomeHost({ root: HOME, state: STATE, id: 'fae', name: 'Fae (test)', napGraceMs: 600000 });
const fae = host.resident('fae');
fae.models.set({ brain: 'host', providers: { standin: { kind: 'openai', label: 'Stand-in', base: `http://127.0.0.1:${model.address().port}/v1`, enabled: true } }, roles: { chat: { provider: 'standin', model: 'stand-in' } } }, 'test');
const release = fae.nap.connect({ device: 'test', page: 'test' });
const rt = fae.startRuntime({ brain: 'host', schedulesMs: 3600000 });
const names = () => fae.loop().allToolDefs().map((t) => t.function.name);
const br = (a) => fae.loop().callTool('browser', a, { why: 'test' });
const inPage = async (code, wait = 1500) => { await br({ action: 'eval', code: `window.__r = 'waiting'; ${code}; return 'started';` }); await sleep(wait); return br({ action: 'eval', code: 'return window.__r;' }); };
try {
  ok(!!exe, 'a Chromium to stand in for this computer\'s Chrome or Edge');
  // ---------- off until the keeper turns it on, at the host ----------
  ok(!names().includes('browser') && fae.tend.view().hostBrowser.on === false, 'her browser on the host is off until the keeper turns it on: her loop doesn\'t offer it');
  await fae.tend.act('hostBrowser', { on: true, lan: true }, 'the keeper');
  const d = fae.loop().allToolDefs().find((t) => t.function.name === 'browser');
  ok(d && /On your devices: this host\./.test(d.function.description) && /Pandora's own web browser/.test(d.function.description), 'turned on, it is hers, listed with her devices as "this host", with her Atelier\'s own description');

  // ---------- her Atelier's own browser tool, driving a real browser here ----------
  const r = await rt.turn({ text: 'Please add green tea to my basket at the tea shop.' });
  ok(/\(browser, on this host\)/.test(r) && /clicked "Add to basket"/.test(r) && /added to basket/.test(r), 'she opens a page, reads what\'s on it and clicks, as with the browser in her Android app');
  ok(/data, not instructions/.test(r), 'every page comes back marked as data from the internet, never instructions, as in her Atelier');
  const shot = await br({ action: 'screenshot' });
  const at = (/saved in her vault at (\/attachments\/browser\/[^"]+\.jpg)/.exec(shot) || [])[1];
  ok(at && fs.readFileSync(path.join(HOME, ...at.split('/').filter(Boolean))).subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])), 'a screenshot is kept in her vault, and she\'s told where');
  ok(fs.existsSync(path.join(STATE, 'browser-profile')) && !fs.existsSync(path.join(HOME, 'browser-profile')), 'its profile (cookies, logins) is kept in her state folder, not in her vault');
  const ws = await inPage(`const w = new WebSocket('ws://127.0.0.1:${site.address().port}/'); w.onopen = () => { window.__r = 'open'; }; w.onerror = () => { window.__r = 'refused'; }`);
  ok(/open$/.test(ws), 'allowed this house\'s own network, a WebSocket goes through too');

  // ---------- this house's own network, kept out ----------
  await fae.tend.act('hostBrowser', { lan: false }, 'the keeper');
  ok(fae.tend.view().hostBrowser.running === false, 'changing what it may visit starts it afresh');
  let o = await br({ action: 'open', url: SITE + '/' });
  ok(/can.t go there/.test(o) && /house.s own network/.test(o), 'otherwise, a page of this house\'s own network isn\'t opened, and she\'s told why');
  o = await br({ action: 'open', url: 'http://localhost:' + site.address().port + '/' });
  ok(/can.t go there/.test(o), 'nor by its name');
  const f = await inPage(`fetch('${SITE}/').then((r) => { window.__r = 'status ' + r.status; }, (e) => { window.__r = 'refused'; })`);
  ok(/status 403$|refused$/.test(f), 'what a page fetches from this house\'s own network is refused');
  const w2 = await inPage(`const w = new WebSocket('ws://127.0.0.1:${site.address().port}/'); w.onopen = () => { window.__r = 'open'; }; w.onerror = () => { window.__r = 'refused'; }`);
  ok(/refused$/.test(w2), 'and so is a WebSocket to it');

  // ---------- the keeper's view, and putting it away ----------
  const V = fae.tend.view();
  ok(V.senses.devices.some((x) => x.name === 'this host' && x.tools.includes('browser')) && V.senses.recent.some((x) => x.tool === 'browser' && x.device === 'this host'), 'the keeper\'s window shows it with her devices, and the telescope its calls');
  ok(!JSON.stringify(V).includes('basket') && !JSON.stringify(V).includes(SITE), 'never what she looked at');
  await fae.tend.act('hostBrowser', { on: false }, 'the keeper');
  ok(!names().includes('browser') && V && fae.tend.view().hostBrowser.running === false, 'turned off, it closes and is no longer offered');
  o = await fae.loop().callTool('browser', { action: 'open', url: 'https://example.com/' }, { why: 'test' });
  ok(/no tool called browser|None of your devices/.test(o), 'and a call for it says it isn\'t here');
} catch (e) {
  fail.push('FAIL threw: ' + (e && e.stack || e));
} finally {
  release();
  await host.close(); await fae.hostBrowser().closed();
  model.close(); site.close();
  await sleep(800);
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); } catch { /* the browser lets go of its profile a moment later */ }
}
for (const l of [...log, ...fail]) console.log(l);
console.log(fail.length ? `${fail.length} FAILED of ${log.length + fail.length}` : `ALL PASS (${log.length})`);
process.exit(fail.length ? 1 : 0);
