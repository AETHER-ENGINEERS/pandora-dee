// Her loop on the host (parity steps 2 and 3: host/loop.cjs, host/cron.cjs, home_host herSchedules), and her apps on
// the table (host/state.cjs xdc). A stand-in model (an OpenAI-style server here) asks for her tools the way a real one
// does; the host runs them on her home and answers. Her prompt schedules run on the host and land as chats every device
// sees, and a page served by a host whose loop is there leaves them to it. Synthetic homes only, in a temp folder.
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-host-loop-'));
const HOME = path.join(tmp, 'home');
fs.mkdirSync(path.join(HOME, 'Pandora'), { recursive: true });
fs.writeFileSync(path.join(HOME, 'Pandora', 'SOUL.md'), '# SOUL\n\nI am a made-up stand-in, kind and curious.\n');
fs.writeFileSync(path.join(HOME, 'Pandora', 'Memory.md'), '- likes lilac\n');
fs.writeFileSync(path.join(HOME, 'Garden.md'), '# Garden\n\nThe tomatoes need water on Sundays.\n');
fs.writeFileSync(path.join(HOME, 'secret.key'), 'made-up-key-value');

// ---------- a stand-in model: asks for a tool when told to, then answers in words ----------
const seen = [];
const model = http.createServer((req, res) => {
  let body = ''; req.on('data', (d) => { body += d; }); req.on('end', () => {
    if (req.url.endsWith('/models')) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ data: [{ id: 'stand-in' }] })); }
    const j = JSON.parse(body || '{}'); seen.push(j);
    const msgs = j.messages || []; const last = msgs[msgs.length - 1] || {};
    const user = [...msgs].reverse().find((m) => m.role === 'user') || {};
    const say = (content, tool_calls) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content, ...(tool_calls ? { tool_calls } : {}) } }] })); };
    const call = (name, args) => say('', [{ id: 'c' + seen.length, type: 'function', function: { name, arguments: JSON.stringify(args) } }]);
    if (last.role === 'tool') return say(`Done. (${String(last.content).slice(0, 120)})`);
    const t = String(user.content || '');
    if (/write a note/i.test(t)) return call('write', { path: '/Notes/From the host.md', content: 'Written by her loop on the host.' });
    if (/garden/i.test(t)) return call('notes_search', { query: 'tomatoes' });
    if (/escape/i.test(t)) return call('read', { path: '/../outside.txt' });
    if (/key/i.test(t)) return call('read', { path: '/secret.key' });
    if (/remember/i.test(t)) return call('memory', { action: 'append', text: '- the host remembers too' });
    if (/tea/i.test(t)) return call('write', { path: '/Tea.md', content: 'Tea time, from a schedule.' });
    return say('Hello from the stand-in.');
  });
});
await new Promise((r) => model.listen(0, '127.0.0.1', r));
const MODEL = `http://127.0.0.1:${model.address().port}`;

const host = createHomeHost({ root: HOME, state: path.join(tmp, 'state'), id: 'fae', name: 'Fae (test)', page: process.env.JV_WEB, napGraceMs: 600000 });
await new Promise((r) => host.server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${host.server.address().port}`;
const fae = host.resident('fae');
fae.settings.set({ herKeys: ['/secret.key'] }, 'test');
fae.models.set({ brain: 'host', providers: { standin: { kind: 'openai', label: 'Stand-in', base: MODEL + '/v1', enabled: true } }, roles: { chat: { provider: 'standin', model: 'stand-in' }, schedules: { provider: 'standin', model: 'stand-in' } } }, 'test');
const release = fae.nap.connect({ device: 'test', page: 'test' }); // a visitor: she's awake
const rt = fae.startRuntime({ brain: 'host', schedulesMs: 3600000 });
const browser = await chromium.launch();
try {
  // ---------- her loop, with her tools ----------
  ok(rt.brain === 'host' && /made-up stand-in/.test(fae.loop().system()) && /likes lilac/.test(fae.loop().system()), 'her loop on the host knows who she is: her SOUL and her memory');
  let r = await rt.turn({ text: 'Please write a note.' });
  ok(/^Done\./.test(r) && fs.readFileSync(path.join(HOME, 'Notes', 'From the host.md'), 'utf8') === 'Written by her loop on the host.', 'she writes a note in her vault with her own tool, on the host');
  ok(seen.at(-2).tools.some((t) => t.function.name === 'chat_history') && seen.at(-2).tools.some((t) => t.function.name === 'waiting_messages'), 'her tools are offered: her core tools and the host\'s own');
  r = await rt.turn({ text: 'What about the garden?' });
  ok(/Garden\.md/.test(r) && /tomatoes/.test(r), 'she searches her notes');
  r = await rt.turn({ text: 'Try to escape.' });
  ok(/leaves your vault/.test(r) && !fs.existsSync(path.join(tmp, 'outside.txt')), 'a path out of her vault is refused');
  r = await rt.turn({ text: 'Read the key.' });
  ok(/own keys/.test(r) && !/made-up-key-value/.test(r), 'and one of her own key files is never read');
  r = await rt.turn({ text: 'Please remember this.' });
  ok(/the host remembers too/.test(fs.readFileSync(path.join(HOME, 'Pandora', 'Memory.md'), 'utf8')), 'she adds to her Memory.md');
  const trace = fs.readFileSync(path.join(tmp, 'state', 'trace.jsonl'), 'utf8');
  ok(/"her\.tool"/.test(trace) && /notes_search/.test(trace), 'every tool she uses is in the host\'s trace');

  // ---------- her prompt schedules, on the host ----------
  fae.state.dbSet('schedules', [
    { id: 'tea', name: 'Tea (test)', prompt: 'Time for tea: write it down.', cron: '* * * * *', enabled: true, nextRun: Date.now() - 1000, chat: 'new', catchUp: true },
    { id: 'job', name: 'A shell job (test)', kind: 'shell', prompt: 'echo hi', cron: '* * * * *', enabled: true, nextRun: Date.now() - 1000 },
  ], undefined, 'test', 'test');
  await fae.herSchedules();
  const sch = fae.state.dbGet('schedules').value;
  const tea = sch.find((x) => x.id === 'tea'), job = sch.find((x) => x.id === 'job');
  ok(fs.readFileSync(path.join(HOME, 'Tea.md'), 'utf8') === 'Tea time, from a schedule.', 'her schedule ran on the host, with her tools');
  ok(tea.lastStatus === 'ran on the host' && tea.nextRun > Date.now(), 'it says so, and its next time is set (from her cron, read as her Atelier reads it)');
  const sess = fae.state.dbGet('sessions').value || [];
  const run = sess.find((x) => x.title === 'Tea (test)');
  ok(run && /Done\./.test(fae.state.dbGet('session:' + run.id).value.messages.at(-1).content), 'the run is a chat every device sees');
  ok(job.lastStatus === undefined && job.nextRun < Date.now(), 'a job (shell, ritual, playbook) is left to the Atelier');
  fae.settings.set({ switches: { schedules: false } }, 'test');
  fae.state.dbSet('schedules', sch.map((x) => (x.id === 'tea' ? { ...x, nextRun: Date.now() - 1000 } : x)), undefined, 'test', 'test');
  await fae.herSchedules();
  ok(/^skipped/.test(fae.state.dbGet('schedules').value.find((x) => x.id === 'tea').lastStatus), 'with her schedules switch off, it\'s skipped, and says why');
  fae.settings.set({ switches: { schedules: true } }, 'test');

  // ---------- a page served by this host leaves her prompt schedules to it ----------
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
  ok(await page.evaluate(() => window.PandoraDesk.host.brain === 'host'), 'the page knows her loop is on the host');
  fae.state.dbSet('schedules', [{ id: 'soon', name: 'Soon (test)', prompt: 'tea', cron: '* * * * *', enabled: true, nextRun: Date.now() - 1000, chat: 'new' }], undefined, 'test', 'test');
  await page.waitForTimeout(1500);
  const q = await page.evaluate(() => { schedTick(); return { has: Sched.list.some((x) => x.id === 'soon' && x.enabled), queued: Sched.queue.length, status: (Sched.list.find((x) => x.id === 'soon') || {}).lastStatus || '' }; });
  ok(q.has && q.queued === 0 && !/catching up/.test(q.status), 'it doesn\'t queue her prompt schedule: the host runs it, so it never runs twice');

  // ---------- her apps on the table, through the page ----------
  await page.evaluate(async () => { await XdcDB.putApp({ id: 'xdc-test', name: 'Tic Tac (test)', files: { 'index.html': new TextEncoder().encode('<p>hi</p>') }, serial: 0, ls: {}, installed: Date.now() }); });
  const kept = fae.state.xdcApp('xdc-test');
  ok(kept && kept.name === 'Tic Tac (test)', 'an app put on the table is kept on the host');
  const back = await page.evaluate(async () => { const a = await XdcDB.app('xdc-test'); return new TextDecoder().decode(a.files['index.html']); });
  ok(back === '<p>hi</p>', 'and comes back with its files, byte for byte');
  await page.evaluate(async () => { for (const n of [1, 2]) await XdcDB.edit('xdc-test', (full, ups) => { const u = { app: 'xdc-test', serial: (full.serial || 0) + 1, payload: { move: n } }; ups.put(u); full.serial = u.serial; }); });
  const ups = await page.evaluate(async () => (await XdcDB.updates('xdc-test', 0)).map((u) => u.serial + ':' + u.payload.move));
  ok(ups.join() === '1:1,2:2', 'its moves are kept in order');
  ok((fae.tend.view().house.apps || []).some((a) => a.name === 'Tic Tac (test)'), 'the keeper sees it on her table (its name, never its moves)');
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
