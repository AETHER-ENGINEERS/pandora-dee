// Her things on the host, one copy for every device (parity step 1: host/state.cjs, host/bridge.js,
// app/modules/hoststate.js). Two browsers are paired with the same resident as two devices: a chat made on one is on
// the other, as it happens; her settings are shared while each device keeps its own API keys and model addresses;
// two devices writing at once lose neither's new chat; her run history and backups come from the host; and nothing of
// hers is left in either browser's own storage. Synthetic homes only, in a temp folder.
import pw from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const { chromium } = pw;
const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(process.env.JV_WEB), '..');
const { createHomeHost } = require(path.join(ROOT, 'host', 'home_host.cjs'));
const css = fs.readFileSync('tw.css', 'utf8');
const log = []; const fail = [];
const ok = (c, m) => { (c ? log : fail).push((c ? 'PASS ' : 'FAIL ') + m); };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-host-state-'));
const HOME = path.join(tmp, 'home');
fs.mkdirSync(path.join(HOME, 'Pandora'), { recursive: true });
fs.writeFileSync(path.join(HOME, 'Pandora', 'SOUL.md'), '# SOUL\n\nmade-up stand-in\n');
const host = createHomeHost({ root: HOME, state: path.join(tmp, 'state'), id: 'fae', name: 'Fae (test)', page: process.env.JV_WEB, napGraceMs: 60000 });
await new Promise((r) => host.server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${host.server.address().port}`;
const store = host.resident('fae').store;
const dbFile = (k) => { try { return JSON.parse(fs.readFileSync(path.join(store.dir, 'db', encodeURIComponent(k) + '.json'), 'utf8')); } catch { return undefined; } };

const browser = await chromium.launch();
const route = async (r) => {
  const url = r.request().url();
  if (url.startsWith(BASE) || url.startsWith('data:') || url.startsWith('blob:')) return r.continue();
  if (url.startsWith('https://cdn.tailwindcss.com/')) return r.fulfill({ contentType: 'text/javascript', body: `window.tailwind={};(function(){var s=document.createElement('style');s.textContent=${JSON.stringify(css)};document.head.prepend(s);})();` });
  if (url.includes('marked.min.js')) return r.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(process.env.JV_NM + 'marked/lib/marked.umd.js', 'utf8') });
  if (url.includes('katex.min.js')) return r.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(process.env.JV_NM + 'katex/dist/katex.min.js', 'utf8') });
  if (url.includes('katex.min.css')) return r.fulfill({ contentType: 'text/css', body: fs.readFileSync(process.env.JV_NM + 'katex/dist/katex.min.css', 'utf8') });
  if (url.includes('purify.min.js')) return r.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(process.env.JV_NM + 'dompurify/dist/purify.min.js', 'utf8') });
  if (url === 'http://localhost:11434/api/tags') return r.fulfill({ headers: { 'Access-Control-Allow-Origin': '*' }, contentType: 'application/json', body: JSON.stringify({ models: [{ name: 'qwen3:8b' }] }) });
  return r.abort();
};
const ready = (page) => page.waitForFunction(() => typeof vfs !== 'undefined' && vfs.nodes.size > 2 && typeof sessions !== 'undefined', null, { timeout: 90000 }).then(() => page.waitForTimeout(800));
async function device(name) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { if (!/not paired with the home host/.test(e.message)) fail.push(`[pageerror ${name}] ${e.message}`); });
  page.on('dialog', (d) => d.accept());
  await page.route('**/*', route);
  await page.goto(BASE);
  await page.waitForURL(/\/pair$/, { timeout: 15000 });
  await page.fill('#pin', host.newPin()); await page.fill('#name', name); await page.click('#go');
  await page.waitForURL((u) => !/\/pair$/.test(String(u)), { timeout: 15000 });
  await ready(page);
  return { ctx, page };
}
const chat = (page, title, text) => page.evaluate(async ([t, x]) => { newSession(); cur.title = t; cur.messages.push({ role: 'user', content: x }); saveSession(); saveSession.flush?.(); await new Promise((r) => setTimeout(r, 700)); return cur.id; }, [title, text]);
const titles = (page) => page.evaluate(() => sessions.map((s) => s.title));
const until = async (f, ms = 8000) => { const end = Date.now() + ms; for (;;) { const v = await f(); if (v) return v; if (Date.now() > end) return null; await new Promise((r) => setTimeout(r, 200)); } };
const browserOwn = (page) => page.evaluate(async () => {
  const kv = await new Promise((res) => { try { const r = indexedDB.open('jade-vault', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => { const out = []; const q = r.result.transaction('kv').objectStore('kv').openCursor(); q.onsuccess = () => { const c = q.result; if (!c) return res(out); out.push(c.key); c.continue(); }; q.onerror = () => res(out); }; r.onerror = () => res([]); } catch { res([]); } });
  const lsKeys = []; for (let i = 0; i < localStorage.length; i++) lsKeys.push(localStorage.key(i));
  return { kv, ls: lsKeys, settings: JSON.parse(localStorage.getItem('jvault:settings') || '{}') };
});

let A, B;
try {
  A = await device('Laptop (test)');
  B = await device('Phone (test)');
  ok(await A.page.evaluate(() => !!(window.PandoraDesk && PandoraDesk.state)), 'served by the host, the page keeps her things there');

  // ---------- a chat made on one device is on the other, as it happens ----------
  const idA = await chat(A.page, 'From the laptop', 'hello from A');
  ok((dbFile('sessions') || []).some((s) => s.id === idA) && (dbFile('session:' + idA) || {}).messages?.[0]?.content === 'hello from A', 'a chat made on the laptop is kept on the host');
  ok(await until(async () => (await titles(B.page)).includes('From the laptop')), 'and appears on the phone, without a reload');
  const opened = await B.page.evaluate(async (id) => { const s = await idb.get('session:' + id); return s && s.messages[0].content; }, idA);
  ok(opened === 'hello from A', 'the phone opens it, with what was said');

  // ---------- two devices at once: neither loses the other's new chat ----------
  await Promise.all([chat(A.page, 'Same moment A', 'a'), chat(B.page, 'Same moment B', 'b')]);
  const both = await until(() => { const l = (dbFile('sessions') || []).map((s) => s.title); return l.includes('Same moment A') && l.includes('Same moment B') && l; });
  ok(!!both && both.includes('From the laptop'), 'two chats made at the same moment on two devices are both kept, and nothing earlier is lost');
  ok(await until(async () => { const a = await titles(A.page), b = await titles(B.page); return ['Same moment A', 'Same moment B'].every((t) => a.includes(t) && b.includes(t)); }), 'and both devices show both');
  // a chat removed on one device stays removed
  // deleted the way a person does: the chat list's ✕, then "DELETE?"
  await A.page.evaluate((id) => { const x = document.querySelector(`.sess-x[data-del="${id}"]`); x.click(); x.click(); }, idA);
  ok(await until(() => !(dbFile('sessions') || []).some((s) => s.id === idA)) && !!(await until(async () => !(await titles(B.page)).includes('From the laptop'))), 'a chat removed on one device is gone from both');

  // ---------- her settings: shared; her keys and each device's model address: not ----------
  await A.page.evaluate(() => { S.temperature = 0.37; S.groqKey = 'made-up-key-on-laptop'; S.secrets = { TOKEN: 'made-up-secret-on-laptop' }; S.abToken = 'made-up-backup-token'; S.host ='http://localhost:11434'; saveSettings(); });
  await new Promise((r) => setTimeout(r, 600));
  const hs = store.settings();
  ok(hs.temperature === 0.37 && !('groqKey' in hs) && !('secrets' in hs) && !('abToken' in hs) && !('host' in hs), 'her settings go to the host; her API keys, her secrets and this device\'s model address do not');
  ok((await browserOwn(A.page)).settings.groqKey === 'made-up-key-on-laptop', 'the laptop keeps its own key, as before');
  await B.page.reload(); await ready(B.page);
  const bS = await B.page.evaluate(() => ({ t: S.temperature, k: S.groqKey }));
  ok(bS.t === 0.37 && !bS.k, 'the phone has her settings, and no key of the laptop\'s');

  // ---------- what belongs to one device stays there ----------
  await A.page.evaluate(() => { ls.set('draft', 'half a thought'); ls.set('pbApproved', { 'a-playbook': true }); });
  await new Promise((r) => setTimeout(r, 400));
  const st = store.storage();
  ok(!('draft' in st) && st.pbApproved && st.pbApproved['a-playbook'] === true, 'a draft stays on its device; a playbook approval is hers everywhere');

  // ---------- nothing of hers is left in the browser's own storage ----------
  const own = await browserOwn(A.page);
  ok(!own.kv.some((k) => k === 'sessions' || /^session:/.test(k) || k === 'schedules') && !own.ls.includes('jvault:pbApproved'), 'her chats, schedules and approvals are not in the browser\'s own storage');

  // ---------- schedules ----------
  await A.page.evaluate(async () => { Sched.list.push({ id: 'sch-test', name: 'Morning tea (test)', enabled: true }); await idb.set('schedules', Sched.list); });
  ok(await until(async () => (await B.page.evaluate(() => Sched.list.map((s) => s.name))).includes('Morning tea (test)')), 'a schedule made on one device is on the other');

  // ---------- her run history ----------
  await A.page.evaluate(async () => { await TrajDB.put({ id: 'run-test-1', started: Date.now(), messages: [] }); });
  ok(await until(async () => (await B.page.evaluate(async () => (await TrajDB.all()).map((r) => r.id))).includes('run-test-1')), 'her run history is one log for every device');

  // ---------- a backup made on a host-served page carries the host's things ----------
  const bk = await A.page.evaluate(async () => { const b = await buildBackup('full', false); return { titles: (b.db.sessions || []).map((s) => s.title), approved: b.storage.pbApproved }; });
  ok(bk.titles.includes('Same moment B') && bk.approved && bk.approved['a-playbook'], 'a backup made in her Atelier holds what\'s on the host, from every device');

  // ---------- the keeper sees facts about her house, never what was said ----------
  const facts = host.resident('fae').tend.view().house;
  ok(facts.chats >= 2 && facts.schedules.some((x) => x.name === 'Morning tea (test)') && facts.runs >= 1 && !JSON.stringify(facts).includes('hello'), 'the keeper\'s view of her house: how many chats and runs, her schedules\' names, never what was said');

  // ---------- from outside the house, her settings don't change ----------
  const tok = await A.page.evaluate(() => localStorage.getItem('pdhost:token'));
  const r = await fetch(BASE + '/host/state/ls/settings', { method: 'PUT', headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.7' }, body: JSON.stringify({ value: { temperature: 1 } }) });
  ok(r.status === 403 && store.settings().temperature === 0.37, 'her settings can\'t be changed from outside the house');
  const r2 = await fetch(BASE + '/host/state/db/sessions', { headers: { 'Content-Type': 'application/json' } });
  ok(r2.status === 401, 'and nothing is read without a paired device');
} catch (e) {
  fail.push('FAIL threw: ' + (e && e.stack || e));
} finally {
  await browser.close();
  await host.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}
for (const l of [...log, ...fail]) console.log(l);
console.log(fail.length ? `${fail.length} FAILED of ${log.length + fail.length}` : `ALL PASS (${log.length})`);
process.exit(fail.length ? 1 : 0);
