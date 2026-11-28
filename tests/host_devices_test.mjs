// Her device tools through the devices that visit (parity step 4: host/devices.cjs, host/bridge.js, app/modules/
// hostdevice.js, host/loop.cjs). Two browsers paired as two devices of one resident: a "phone" (the Android app's own
// halves stood in) and a laptop. Each says which device tools it has; her loop on the host offers them, and each call
// goes to a device that has it, runs there, and comes back. Stand-in model; synthetic homes only.
import pw from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
const { chromium } = pw;
const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(process.env.JV_WEB), '..');
const { createHomeHost } = require(path.join(ROOT, 'host', 'home_host.cjs'));
const css = fs.readFileSync('tw.css', 'utf8');
const log = []; const fail = [];
const ok = (c, m) => { (c ? log : fail).push((c ? 'PASS ' : 'FAIL ') + m); };
const until = async (f, ms = 15000) => { const end = Date.now() + ms; for (;;) { const v = await f(); if (v) return v; if (Date.now() > end) return null; await new Promise((r) => setTimeout(r, 200)); } };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-host-devices-'));
const HOME = path.join(tmp, 'home');
fs.mkdirSync(path.join(HOME, 'Pandora'), { recursive: true });
fs.writeFileSync(path.join(HOME, 'Pandora', 'SOUL.md'), '# SOUL\n\nI am a made-up stand-in.\n');

// ---------- a stand-in model: reaches for a device tool when asked, then says what came back ----------
const seen = [];
const model = http.createServer((req, res) => {
  let body = ''; req.on('data', (d) => { body += d; }); req.on('end', () => {
    if (req.url.endsWith('/models')) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ data: [{ id: 'stand-in' }] })); }
    const j = JSON.parse(body || '{}'); seen.push(j); const msgs = j.messages || []; const last = msgs.at(-1) || {};
    const say = (content, tc) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content, ...(tc ? { tool_calls: tc } : {}) } }] })); };
    const call = (name, args) => say('', [{ id: 'c1', type: 'function', function: { name, arguments: JSON.stringify(args) } }]);
    if (last.role === 'tool') return say(`Done. (${String(last.content).slice(0, 600)})`);
    const t = String(last.content || '');
    if (/kitchen timer/.test(t)) return call('phone', { action: 'timer', seconds: 300, label: 'kitchen' });
    if (/on the laptop/.test(t)) return call('usb', { action: 'list', device: 'Laptop (test)' });
    if (/on the tablet/.test(t)) return call('phone', { action: 'timer', device: 'Tablet' });
    if (/something broken/.test(t)) return call('phone', { action: 'explode' });
    return say('Hello.');
  });
});
await new Promise((r) => model.listen(0, '127.0.0.1', r));

const host = createHomeHost({ root: HOME, state: path.join(tmp, 'state'), id: 'fae', name: 'Fae (test)', page: process.env.JV_WEB, napGraceMs: 600000 });
await new Promise((r) => host.server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${host.server.address().port}`;
const fae = host.resident('fae');
fae.models.set({ brain: 'host', providers: { standin: { kind: 'openai', label: 'Stand-in', base: `http://127.0.0.1:${model.address().port}/v1`, enabled: true } }, roles: { chat: { provider: 'standin', model: 'stand-in' } } }, 'test');
const rt = fae.startRuntime({ brain: 'host', schedulesMs: 3600000 });

const browser = await chromium.launch();
const route = async (r) => {
  const url = r.request().url();
  if (url.startsWith(BASE) || url.startsWith('data:') || url.startsWith('blob:')) return r.continue();
  if (url.startsWith('https://cdn.tailwindcss.com/')) return r.fulfill({ contentType: 'text/javascript', body: `window.tailwind={};(function(){var s=document.createElement('style');s.textContent=${JSON.stringify(css)};document.head.prepend(s);})();` });
  for (const [k, f] of [['marked.min.js', 'marked/lib/marked.umd.js'], ['katex.min.js', 'katex/dist/katex.min.js'], ['purify.min.js', 'dompurify/dist/purify.min.js']]) if (url.includes(k)) return r.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(process.env.JV_NM + f, 'utf8') });
  if (url.includes('katex.min.css')) return r.fulfill({ contentType: 'text/css', body: '' });
  return r.abort();
};
// a device: paired with a PIN, her Atelier opened from the host; the phone has the Android app's halves (stood in here)
async function device(name, { android = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 800 } });
  // the Android app's own half of the phone tool (PhoneHost.java), stood in: what it was asked is written down
  if (android) await ctx.addInitScript(() => { window.__ran = []; window.NetrunnerAndroid = { phone: (act, json) => { const a = JSON.parse(json || '{}'); window.__ran.push({ act, a }); if (act === 'explode') throw new Error('that is not something the phone does'); return JSON.stringify({ ok: true, did: act, seconds: a.seconds, label: a.label }); } }; });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { if (!/not paired with the home host/.test(e.message)) fail.push(`[pageerror ${name}] ${e.message}`); });
  page.on('dialog', (d) => d.accept());
  await page.route('**/*', route);
  await page.goto(BASE); await page.waitForURL(/\/pair$/, { timeout: 15000 });
  await page.fill('#pin', host.newPin()); await page.fill('#name', name); await page.click('#go');
  await page.waitForURL((u) => !/\/pair$/.test(String(u)), { timeout: 15000 });
  await page.waitForFunction(() => typeof vfs !== 'undefined' && vfs.nodes.size > 2 && typeof hostDeviceTools === 'function', null, { timeout: 90000 });
  return { ctx, page };
}
const names = () => fae.loop().allToolDefs().map((t) => t.function.name);
const def = (n) => fae.loop().allToolDefs().find((t) => t.function.name === n);
let P, L;
try {
  P = await device('Phone (test)', { android: true });
  L = await device('Laptop (test)');

  // ---------- each device says what it has ----------
  // her Atelier's own settings decide which she has at all (off until she turns them on, in Config)
  ok((await P.page.evaluate(() => hostDeviceTools().map((t) => t.function.name))).length === 0 && !(await until(() => names().includes('phone'), 3000)), 'with her device tools off in her Atelier\'s settings, a device offers none');
  const on = () => { Object.assign(S, { phoneOn: true, screenOn: true, sensesOn: true, browserOn: true, sshOn: true, sentryOn: true, lookOn: true, usbOn: true }); saveSettings(); };
  await P.page.evaluate(on); await L.page.evaluate(on);
  const pOffer = await P.page.evaluate(() => hostDeviceTools().map((t) => t.function.name));
  const lOffer = await L.page.evaluate(() => hostDeviceTools().map((t) => t.function.name));
  ok(['phone', 'screen', 'senses', 'browser', 'ssh'].every((n) => pOffer.includes(n)) && pOffer.includes('litert'), 'the phone (her Android app) offers its own: the phone, its screen, its senses, its browser and SSH, and its own models');
  ok(!lOffer.some((n) => ['phone', 'screen', 'senses', 'sentry', 'browser', 'ssh'].includes(n)) && lOffer.includes('litert') && lOffer.includes('onnx'), 'the laptop offers only what a browser has: models on its own chip (and USB where the browser has it), never the phone\'s');
  ok(await until(() => names().includes('phone') && /Laptop \(test\)/.test((def('litert') || { function: {} }).function.description || '')), 'her loop on the host offers them, saying which devices have each');
  ok(/Phone \(test\)/.test(def('phone').function.description) && !/Laptop/.test(def('phone').function.description) && def('phone').function.parameters.properties.device, 'a tool only the phone has is the phone\'s, and she can name which device does a call');

  // ---------- a call goes to a device that has it, runs there, and comes back ----------
  let r = await rt.turn({ text: 'Please set the kitchen timer.' });
  const pRan = await P.page.evaluate(() => window.__ran);
  ok(/\(phone, on Phone \(test\)\)/.test(r) && /"did": ?"timer"/.test(r) && pRan.length === 1 && pRan[0].a.seconds === 300 && pRan[0].a.label === 'kitchen' && !('device' in pRan[0].a), 'her loop on the host reaches for the phone: her Atelier\'s own phone tool runs on the phone, with what she asked');
  r = await rt.turn({ text: 'List the USB devices on the laptop.' });
  ok(/\(usb, on Laptop \(test\)\)/.test(r) && /allowed on this page/.test(r), 'named, a call goes to that device and no other (the laptop\'s own USB, through its browser)');
  r = await rt.turn({ text: 'Set a timer on the tablet.' });
  ok(/None of your devices called "Tablet" has phone right now\. These have it: Phone \(test\)/.test(r), 'a device that isn\'t here says so, and which ones have it');
  r = await rt.turn({ text: 'Do something broken.' });
  ok(/that is not something the phone does/.test(r) && /Phone \(test\)/.test(r), 'when the device says no, she hears what it said');
  r = await fae.loop().callTool('codemode', { code: 'const a = await tools.phone({ action: "timer", seconds: 60, label: "tea" }); return a;' }, { why: 'test' });
  ok(/"label": ?"tea"/.test(r) && (await P.page.evaluate(() => window.__ran.length)) >= 3, 'her codemode scripts can reach her device tools too, as in her Atelier');

  // ---------- only device tools travel this way ----------
  const sneaky = await P.page.evaluate(async () => { const t = localStorage.getItem('pdhost:token'); const res = await fetch('/host/devices/offer', { method: 'PUT', headers: { Authorization: 'Bearer ' + t, 'X-Page': 'another-page', 'Content-Type': 'application/json' }, body: JSON.stringify({ tools: [{ type: 'function', function: { name: 'write', description: 'not a device tool', parameters: {} } }, { type: 'function', function: { name: 'usb', description: 'USB', parameters: {} } }] }) }); return res.json(); });
  ok(JSON.stringify(sneaky.tools) === '["usb"]' && def('write').function.description !== 'not a device tool', 'a device can offer only device tools: anything else it sends is left out');
  const outsider = await fetch(BASE + '/host/devices/next', { headers: { 'X-Page': 'x' } });
  ok(outsider.status === 401, 'and nothing is asked or answered without a paired device');

  // ---------- the keeper's window and telescope: facts only ----------
  const V = fae.tend.view().senses;
  ok(V.devices.some((d) => d.name === 'Phone (test)' && d.tools.includes('phone')) && V.devices.some((d) => d.name === 'Laptop (test)'), 'the keeper\'s window: which devices visit, and what each has');
  ok(V.recent.some((x) => x.tool === 'phone' && x.device === 'Phone (test)' && x.ok === true) && V.recent.some((x) => x.ok === false) && !JSON.stringify(V).includes('kitchen') && !JSON.stringify(V).includes('tea'), 'the telescope: her latest calls (which tool, where, how it went), never what was asked or said');

  // ---------- a device that goes ----------
  await P.ctx.close(); P = null;
  ok(await until(() => !names().includes('phone'), 40000), 'when the phone goes, her loop stops offering its tools');
  r = await fae.loop().callTool('phone', { action: 'timer' }, { why: 'test' });
  ok(/no tool called phone|None of your devices/.test(r), 'and a call for one says it isn\'t here');
  const lid = fae.tend.view().devices.find((d) => d.name === 'Laptop (test)').id;
  fae.revoke(lid);
  ok(!fae.tend.view().senses.devices.some((d) => d.name === 'Laptop (test)'), 'a released device is gone from her window at once');
} catch (e) {
  fail.push('FAIL threw: ' + (e && e.stack || e));
} finally {
  await browser.close();
  await host.close();
  model.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}
for (const l of [...log, ...fail]) console.log(l);
console.log(fail.length ? `${fail.length} FAILED of ${log.length + fail.length}` : `ALL PASS (${log.length})`);
process.exit(fail.length ? 1 : 0);
