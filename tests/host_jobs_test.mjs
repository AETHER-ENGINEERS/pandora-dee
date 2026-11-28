// Her playbooks and rituals on the host (host/engines.cjs: the very engines her Atelier runs, in a Node sandbox), and
// her job schedules there: shell, ritual and playbook, run on the host while her loop is there, with an open page
// running exactly the ones the host leaves (a browser-driving playbook; a shell job without her hands on the computer).
// Stand-in model; synthetic homes only.
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-host-jobs-'));
const HOME = path.join(tmp, 'home');
const w = (vp, t) => { const f = path.join(HOME, ...vp.split('/').filter(Boolean)); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, typeof t === 'string' ? t : JSON.stringify(t, null, 1)); };
const read = (vp) => { try { return fs.readFileSync(path.join(HOME, ...vp.split('/').filter(Boolean)), 'utf8'); } catch { return null; } };
w('/Pandora/SOUL.md', '# SOUL\n\nI am a made-up stand-in.\n');
w('/Pandora/Playbooks/hello.json', { name: 'hello', vars: { who: 'there' }, tasks: [{ do: 'set', vars: { greeting: 'hi {{ who }}' } }, { do: 'write', path: '/Hello.md', content: '{{ greeting }} {{ TOKEN }}' }] });
w('/Pandora/Playbooks/shop.json', { name: 'shop', allow_hosts: ['shop.example'], tasks: [{ do: 'browser.goto', url: 'https://shop.example/' }] });
w('/Pandora/Rituals/tidy.ritual.json', { name: 'tidy', enabled: true, trigger: { type: 'manual' }, steps: [{ id: 'a', type: 'set', fields: { n: '{{ 1 + 2 }}' } }, { id: 'b', type: 'note', action: 'write', path: '/Ritual.md', content: 'n is {{ $json.n }}' }] });
w('/Pandora/Rituals/forever.ritual.json', { name: 'forever', enabled: true, trigger: { type: 'manual' }, steps: [{ id: 'a', type: 'set', fields: { x: '{{ (() => { while (true) {} })() }}' } }] });
w('/Pandora/Rituals/shelly.ritual.json', { name: 'shelly', enabled: true, trigger: { type: 'manual' }, steps: [{ id: 'a', type: 'shell', command: 'echo from-the-shell' }] });

// a stand-in model: runs a playbook or a ritual when asked, then answers
const model = http.createServer((req, res) => {
  let body = ''; req.on('data', (d) => { body += d; }); req.on('end', () => {
    if (req.url.endsWith('/models')) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ data: [{ id: 'stand-in' }] })); }
    const j = JSON.parse(body || '{}'); const msgs = j.messages || []; const last = msgs.at(-1) || {};
    const user = [...msgs].reverse().find((m) => m.role === 'user') || {};
    const say = (content, tc) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content, ...(tc ? { tool_calls: tc } : {}) } }] })); };
    const call = (name, args) => say('', [{ id: 'c1', type: 'function', function: { name, arguments: JSON.stringify(args) } }]);
    if (last.role === 'tool') return say(`Done. (${String(last.content).slice(0, 600)})`);
    if (/run the hello playbook/i.test(user.content)) return call('playbook', { action: 'run', name: 'hello' });
    if (/run the tidy ritual/i.test(user.content)) return call('ritual', { action: 'run', name: 'tidy' });
    return say('Hello.');
  });
});
await new Promise((r) => model.listen(0, '127.0.0.1', r));

const host = createHomeHost({ root: HOME, state: path.join(tmp, 'state'), id: 'fae', name: 'Fae (test)', page: process.env.JV_WEB, napGraceMs: 600000 });
await new Promise((r) => host.server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${host.server.address().port}`;
const fae = host.resident('fae');
fs.writeFileSync(path.join(tmp, 'state', 'atelier-secrets.json'), JSON.stringify({ secrets: { TOKEN: 'made-up-secret-value' } }));
fae.models.set({ brain: 'host', providers: { standin: { kind: 'openai', label: 'Stand-in', base: `http://127.0.0.1:${model.address().port}/v1`, enabled: true } }, roles: { chat: { provider: 'standin', model: 'stand-in' }, schedules: { provider: 'standin', model: 'stand-in' } } }, 'test');
const release = fae.nap.connect({ device: 'test', page: 'test' });
const rt = fae.startRuntime({ brain: 'host', schedulesMs: 3600000 });
const eng = fae.engines();
const browser = await chromium.launch();
try {
  // ---------- her playbooks, with the engine her Atelier runs ----------
  ok(fae.loop().allToolDefs().some((t) => t.function.name === 'playbook') && fae.loop().allToolDefs().some((t) => t.function.name === 'ritual'), 'her loop on the host offers her playbook and ritual tools');
  let r = await rt.turn({ text: 'Please run the hello playbook.' });
  ok(/not approved/.test(r) && /approves a playbook in her Atelier/.test(r) && read('/Hello.md') === null, 'a playbook nobody has approved doesn\'t run, and says where the person approves it');
  fae.state.lsSet('pbApproved', { hello: eng.approvalOf('hello') }, 'test', 'test'); // the person's yes, as her Atelier writes it
  r = await rt.turn({ text: 'Please run the hello playbook.' });
  ok(read('/Hello.md') === 'hi there made-up-secret-value', 'approved, it runs on the host: its variables, her tools, and her secret from the host\'s key file');
  const logs = fs.readFileSync(path.join(tmp, 'state', 'trace.jsonl'), 'utf8') + fs.readFileSync(path.join(tmp, 'state', 'events.jsonl'), 'utf8');
  ok(!r.includes('made-up-secret-value') && !logs.includes('made-up-secret-value'), 'her secret never shows in what comes back, the trace or the log');

  // ---------- her rituals ----------
  r = await rt.turn({ text: 'Please run the tidy ritual.' });
  ok(read('/Ritual.md') === 'n is 3', 'a ritual runs on the host: its expressions, and a note written in her vault');
  const t0 = Date.now(); const fr = await eng.runRitual('forever', null, { via: 'test' });
  ok(fr.status !== 'ok' && /longer than|timed out|expression/i.test(fr.error || '') && Date.now() - t0 < 15000, 'an expression that never ends is stopped, as in her Atelier');
  const sh = await eng.runRitual('shelly', null, { via: 'test' });
  ok(sh.status === 'ok' && /from-the-shell/.test(JSON.stringify(sh.output)), 'a shell step runs, with her hands on this computer');

  // ---------- her job schedules, on the host ----------
  const now = Date.now() - 1000;
  fae.state.dbSet('schedules', [
    { id: 'j1', name: 'Echo (test)', kind: 'shell', command: 'echo job', cron: '* * * * *', enabled: true, nextRun: now },
    { id: 'j2', name: 'Tidy (test)', kind: 'flow', flow: 'tidy', cron: '* * * * *', enabled: true, nextRun: now },
    { id: 'j3', name: 'Hello (test)', kind: 'playbook', playbook: 'hello', cron: '* * * * *', enabled: true, nextRun: now },
    { id: 'j4', name: 'Shop (test)', kind: 'playbook', playbook: 'shop', cron: '* * * * *', enabled: true, nextRun: now },
  ], undefined, 'test', 'test');
  fs.rmSync(path.join(HOME, 'Ritual.md')); fs.rmSync(path.join(HOME, 'Hello.md'));
  await fae.herSchedules();
  const st = Object.fromEntries(fae.state.dbGet('schedules').value.map((x) => [x.id, x]));
  ok(/^ok \(on the host\)/.test(st.j1.lastStatus), 'a shell job runs on the host, with her hands on this computer');
  ok(/^ok/.test(st.j2.lastStatus) && read('/Ritual.md') === 'n is 3', 'a ritual job runs on the host');
  ok(/^ok/.test(st.j3.lastStatus) && read('/Hello.md') === 'hi there made-up-secret-value', 'an approved playbook job runs on the host');
  ok(!st.j4.lastStatus && st.j4.nextRun === now, 'a playbook that drives the browser is left to an open Atelier, untouched');

  // ---------- an open page runs exactly the ones the host leaves ----------
  const ctx = await browser.newContext(); const page = await ctx.newPage();
  page.on('pageerror', (e) => { if (!/not paired/.test(e.message)) fail.push('[pageerror] ' + e.message); });
  await page.route('**/*', async (rr) => {
    const url = rr.request().url();
    if (url.startsWith(BASE) || url.startsWith('data:') || url.startsWith('blob:')) return rr.continue();
    if (url.startsWith('https://cdn.tailwindcss.com/')) return rr.fulfill({ contentType: 'text/javascript', body: `window.tailwind={};(function(){var s=document.createElement('style');s.textContent=${JSON.stringify(css)};document.head.prepend(s);})();` });
    for (const [k, f] of [['marked.min.js', 'marked/lib/marked.umd.js'], ['katex.min.js', 'katex/dist/katex.min.js'], ['purify.min.js', 'dompurify/dist/purify.min.js']]) if (url.includes(k)) return rr.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(process.env.JV_NM + f, 'utf8') });
    if (url.includes('katex.min.css')) return rr.fulfill({ contentType: 'text/css', body: '' });
    return rr.abort();
  });
  await page.goto(BASE); await page.waitForURL(/\/pair$/, { timeout: 15000 });
  await page.fill('#pin', host.newPin()); await page.fill('#name', 'Laptop (test)'); await page.click('#go');
  await page.waitForURL((u) => !/\/pair$/.test(String(u)), { timeout: 15000 });
  await page.waitForFunction(() => typeof vfs !== 'undefined' && vfs.nodes.size > 2 && typeof Sched !== 'undefined', null, { timeout: 90000 });
  await page.waitForTimeout(1500);
  const takes = await page.evaluate(() => ({ hands: window.PandoraDesk.host.hostShell, prompt: hostTakesSchedule({ name: 'p' }), shell: hostTakesSchedule({ kind: 'shell', command: 'x' }), flow: hostTakesSchedule({ kind: 'flow', flow: 'tidy' }), pb: hostTakesSchedule({ kind: 'playbook', playbook: 'hello' }), browser: hostTakesSchedule({ kind: 'playbook', playbook: 'shop' }) }));
  ok(takes.hands === true && takes.prompt && takes.shell && takes.flow && takes.pb && !takes.browser, 'the page and the host agree: the host takes prompts, shell (with her hands), rituals and playbooks; the page keeps the browser-driving playbook');
  await ctx.close();
} catch (e) {
  fail.push('FAIL threw: ' + (e && e.stack || e));
} finally {
  release();
  await browser.close();
  await host.close();
  model.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}
for (const l of [...log, ...fail]) console.log(l);
console.log(fail.length ? `${fail.length} FAILED of ${log.length + fail.length}` : `ALL PASS (${log.length})`);
process.exit(fail.length ? 1 : 0);
