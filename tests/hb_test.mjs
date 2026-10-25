import { autoTabs } from './_tabs.mjs';
import pw from 'playwright';
import fs from 'node:fs';
const { chromium } = pw;
const URL_ = process.argv[2] || 'file://' + process.env.JV_WEB;
const OUT = process.cwd() + '/hshots'; fs.mkdirSync(OUT, { recursive: true });
const css = fs.readFileSync('tw.css', 'utf8');
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' };
const log = [], fail = []; const ok = (c, m) => (c ? log : fail).push((c ? 'PASS ' : 'FAIL ') + m);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
await ctx.addInitScript(() => {
  window.NetrunnerAndroid = { keepAlive() {}, batteryOptimized() { return false; }, openBatterySettings() {}, requestNotifications() {}, notify(t, b) { (window.__notes ||= []).push([t, b]); } };
  if (!localStorage.getItem('jvault:settings')) localStorage.setItem('jvault:settings', JSON.stringify({ model: 'qwen3:8b', groqKey: 'gsk_test', journalOn: false }));
});
const page = autoTabs(await ctx.newPage());
page.on('pageerror', e => fail.push('[pageerror] ' + e.message));
let hbMode = 'ok', noVision = false, slow = 0; const chats = [], groqBodies = [], lcppBodies = [];
const nd = (lines) => lines.map(l => JSON.stringify(l)).join('\n') + '\n';
const sse = (objs) => objs.map(o => 'data: ' + JSON.stringify(o) + '\n\n').join('') + 'data: [DONE]\n\n';
const PDFJS = process.env.JV_NM + 'pdfjs-dist/build/';
await page.route('**/*', async route => {
  const req = route.request(); const url = req.url();
  if (url.startsWith('file://') || url.startsWith('data:') || url.startsWith('blob:')) return route.continue();
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
  if (url.startsWith('https://cdn.tailwindcss.com/')) return route.fulfill({ contentType: 'text/javascript', body: `window.tailwind={};(function(){var s=document.createElement('style');s.textContent=${JSON.stringify(css)};document.head.prepend(s);})();` });
  if (url.includes('marked.min.js')) return route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(process.env.JV_NM + 'marked/lib/marked.umd.js', 'utf8') });
  if (url.includes('katex.min.js')) return route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(process.env.JV_NM + 'katex/dist/katex.min.js', 'utf8') });
  if (url.includes('purify.min.js')) return route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(process.env.JV_NM + 'dompurify/dist/purify.min.js', 'utf8') });
  if (url.includes('pdfjs-dist') && url.endsWith('pdf.min.mjs')) return route.fulfill({ headers: CORS, contentType: 'text/javascript', body: fs.readFileSync(PDFJS + 'pdf.min.mjs', 'utf8') });
  if (url.includes('pdfjs-dist') && url.endsWith('pdf.worker.min.mjs')) return route.fulfill({ headers: CORS, contentType: 'text/javascript', body: fs.readFileSync(PDFJS + 'pdf.worker.min.mjs', 'utf8') });
  if (url === 'http://localhost:11434/api/tags') return route.fulfill({ headers: CORS, contentType: 'application/json', body: JSON.stringify({ models: [{ name: 'qwen3:8b' }] }) });
  if (url === 'http://localhost:11434/api/chat') {
    const b = JSON.parse(req.postData()); chats.push(b);
    if (slow) await new Promise(r => setTimeout(r, slow));   // a model slower than the 250 ms a chat save waits
    const lastUser = [...b.messages].reverse().find(m => m.role === 'user'); const nTool = b.messages.filter(m => m.role === 'tool').length;
    if (noVision && b.messages.some(m => m.images)) return route.fulfill({ status: 500, headers: CORS, contentType: 'application/json', body: JSON.stringify({ error: 'this model is missing data required for image input (no vision support)' }) });
    let lines;
    if (/\[Heartbeat/.test(lastUser.content)) {
      const after = b.messages.slice(b.messages.lastIndexOf(lastUser)); const tools = after.filter(m => m.role === 'tool').length;
      lines = tools === 0 ? [{ message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 'read', arguments: { path: 'Inbox' } } }] }, done: false }]
        : [{ message: { role: 'assistant', content: hbMode === 'ok' ? 'HEARTBEAT_OK' : 'Your [[Inbox]] has 3 items waiting. Time to sort it!' }, done: false }];
    } else lines = [{ message: { role: 'assistant', content: `Got ${lastUser.images?.length || 0} image(s). ` + (/Hello PDF world/.test(JSON.stringify(b.messages)) ? 'PDF text seen.' : 'Read the PDF note.') }, done: false }];
    lines.push({ message: { role: 'assistant', content: '' }, done: true });
    return route.fulfill({ headers: CORS, contentType: 'application/x-ndjson', body: nd(lines) });
  }
  if (url === 'https://api.groq.com/openai/v1/models') return route.fulfill({ headers: CORS, contentType: 'application/json', body: JSON.stringify({ data: [{ id: 'llama-3.1-8b-instant' }, { id: 'openai/gpt-oss-120b' }] }) });
  if (url === 'https://api.groq.com/openai/v1/chat/completions') {
    const b = JSON.parse(req.postData()); groqBodies.push(b); const tools = b.messages.slice(b.messages.map(m => m.role).lastIndexOf('user')).filter(m => m.role === 'tool').length;
    const chunks = tools === 0 ? [{ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', type: 'function', function: { name: 'read', arguments: '{"path":"Inbox"}' } }] } }] }] : [{ choices: [{ delta: { content: 'HEARTBEAT_OK' } }] }];
    return route.fulfill({ headers: CORS, contentType: 'text/event-stream', body: sse(chunks) });
  }
  if (url === 'http://localhost:8080/v1/models') return route.fulfill({ headers: CORS, contentType: 'application/json', body: JSON.stringify({ object: 'list', data: [{ id: 'Qwen3-8B-Q4_K_M.gguf', object: 'model' }] }) });
  if (url === 'http://localhost:8080/v1/chat/completions') { const b = JSON.parse(req.postData()); lcppBodies.push(b); return route.fulfill({ headers: CORS, contentType: 'text/event-stream', body: sse([{ choices: [{ delta: { reasoning_content: 'hmm' } }] }, { choices: [{ delta: { content: 'llama.cpp says hi' } }] }, { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 50, completion_tokens: 4 }, timings: {} }]) }); }
  return route.abort();
});
await page.goto(URL_);
await page.waitForFunction(() => /BUSYBOX|JS APPLETS/.test(document.querySelector('#txtShell')?.textContent || '') && typeof runHeartbeat === 'function', null, { timeout: 90000 });
await page.waitForTimeout(1200);
// ---------- heartbeat ----------
ok(await page.evaluate(() => vfs.isFile('/Pandora/HEARTBEAT.md') && heartbeatBody() === ''), 'HEARTBEAT.md seeded and counts as empty');
const acks = await page.evaluate(() => [hbIsAck('HEARTBEAT_OK'), hbIsAck('**HEARTBEAT_OK**'), hbIsAck('All quiet. HEARTBEAT_OK'), hbIsAck('NO_REPLY'), hbIsAck('Inbox has 9 items, please sort.'), hbIsAck('x'.repeat(400) + ' HEARTBEAT_OK')]);
ok(JSON.stringify(acks) === '[true,true,true,true,false,false]', 'HEARTBEAT_OK detection ' + JSON.stringify(acks));
let n0 = chats.length;
await page.evaluate(() => runHeartbeat({ manual: true })); await page.waitForTimeout(300);
ok(chats.length === n0 && /skipped/.test(await page.evaluate(() => HB.status)), 'empty checklist skips without a model call');
await page.evaluate(() => vfs.write('/Pandora/HEARTBEAT.md', '# HEARTBEAT\n<!-- hi -->\n## Check\n- [ ] If /Inbox.md has more than 2 items, remind me to sort it.\n'));
ok(await page.evaluate(() => /Inbox\.md has more/.test(heartbeatBody())), 'checklist with content is used');
// silent OK run: pruned, back to the chat we were in
await page.fill('#input', 'hello there'); await page.tap('#btnSend');
await page.waitForFunction(() => !running && document.querySelectorAll('#chat .msg-ai').length, null, { timeout: 20000 });
const mainId = await page.evaluate(() => cur.id);
n0 = chats.length; hbMode = 'ok'; slow = 300;
await page.evaluate(() => runHeartbeat()); slow = 0; await page.waitForTimeout(500);
const hb1 = await page.evaluate(() => ({ status: HB.status, cur: cur.id, hbId: ls.get('hbSession'), notes: (window.__notes || []).length }));
ok(chats.length - n0 === 2 && /\[Heartbeat/.test(chats[n0].messages.at(-1).content) && /If \/Inbox\.md has more/.test(chats[n0].messages.at(-1).content), 'heartbeat prompt includes HEARTBEAT.md');
ok(/^OK \(1 check\)/.test(hb1.status) && hb1.cur === mainId && hb1.notes === 0, 'HEARTBEAT_OK is silent and returns to your chat: ' + hb1.status);
const hbLeft = await page.evaluate(async () => { const x = await idb.get('session:' + ls.get('hbSession')); return x ? x.messages.map(m => m.role) : []; });
ok(!hbLeft.length, 'the silent run leaves nothing in the saved ♥ Heartbeat chat, even with a model slower than a save (it used to keep its prompt and tool calls): ' + JSON.stringify(hbLeft));
// alert run: kept + notification
hbMode = 'alert';
await page.evaluate(() => runHeartbeat()); await page.waitForTimeout(500);
const hb2 = await page.evaluate(() => ({ status: HB.status, title: cur.title, msgs: cur.messages.length, notes: window.__notes || [], txt: document.querySelector('#chat').textContent }));
ok(/^alert: Your Inbox has 3 items/.test(hb2.status) && hb2.title === '♥ Heartbeat' && hb2.msgs >= 4, 'alert stays in the ♥ Heartbeat chat: ' + hb2.status + ' ' + JSON.stringify({ title: hb2.title, msgs: hb2.msgs }));
ok(hb2.notes.length === 1 && /Inbox has 3 items/.test(hb2.notes[0][1]), 'alert sends a notification');
ok(/♥ Heartbeat check/.test(hb2.txt) && !/HEARTBEAT\.md:/.test(hb2.txt), 'chat shows a short heartbeat label, not the raw prompt');
await page.screenshot({ path: OUT + '/1_alert.png' });
// heartbeat on another provider/model, chat model restored afterwards
await page.evaluate(() => { S.hbProv = 'groq'; S.hbModel = 'llama-3.1-8b-instant'; });
hbMode = 'ok'; const g0 = groqBodies.length;
await page.evaluate(() => runHeartbeat()); await page.waitForTimeout(600);
const after = await page.evaluate(() => ({ prov: getProv().activeProv, model: S.model, saved: JSON.parse(localStorage.getItem('jvault:settings')).model, status: HB.status }));
ok(groqBodies.length - g0 === 2 && groqBodies[g0].model === 'llama-3.1-8b-instant', 'heartbeat used its own model on Groq');
ok(after.prov === 'local' && after.model === 'qwen3:8b' && after.saved === 'qwen3:8b' && /^OK/.test(after.status), 'chat model restored and not overwritten: ' + JSON.stringify(after));
// scheduling: due + active hours + idle checks
const due2 = await page.evaluate(() => { S.hbStart = '22:00'; S.hbEnd = '06:00'; return [inActiveHours(new Date(2026, 0, 1, 3, 0)), inActiveHours(new Date(2026, 0, 1, 12, 0))]; });
ok(JSON.stringify(due2) === '[true,false]', 'active hours across midnight');
n0 = chats.length;
await page.evaluate(() => { S.hbProv = ''; S.hbOn = true; S.hbStart = ''; S.hbEnd = ''; HB.last = Date.now() - 31 * 60000; HB.lastActive = Date.now(); hbTick(); }); await page.waitForTimeout(300);
ok(chats.length === n0, 'no heartbeat while you are actively using the app');
await page.evaluate(() => { document.activeElement?.blur(); HB.lastActive = Date.now() - 5 * 60000; hbTick(); });
for (let i = 0; i < 50 && chats.length === n0; i++) await page.waitForTimeout(100);   // its model request, however slow the machine
ok(chats.length > n0, 'heartbeat fires when due and idle: ' + JSON.stringify(await page.evaluate(() => ({ status: HB.status, hbRunning: HB.running, running, settings: !$('#settings').hidden, typing: !!input.value.trim(), idleFor: Date.now() - HB.lastActive, sinceLast: Date.now() - HB.last }))));
// settings UI
await page.tap('#btnSettings'); await page.waitForTimeout(300);
ok(await page.isChecked('#sHbOn') && /Last .*OK/.test(await page.textContent('#hbStatus')), 'heartbeat settings show status: ' + await page.textContent('#hbStatus'));
await page.selectOption('#sHbProv', 'groq'); await page.waitForTimeout(800);
console.log('[state dbg]', await page.evaluate(() => JSON.stringify({ gk: S.groqKey, field: $('#sGroqKey').value, prov: S.provider, sprov: $('#sProvider').value }))); void ( await page.$$eval('#sHbModel option', o => o.map(x => x.value + '|' + x.textContent)), await page.isHidden('#sHbModelWrap'));
ok((await page.$$eval('#sHbModel option', o => o.map(x => x.value))).includes('llama-3.1-8b-instant'), 'heartbeat model picker scans the provider');
await page.locator('#sHbOn').scrollIntoViewIfNeeded(); await page.screenshot({ path: OUT + '/2_settings.png' });
await page.tap('#btnCloseSettings');
await page.evaluate(() => { S.hbOn = false; });
// ---------- attachments ----------
await page.fill('#input', '/new'); await page.tap('#btnSend'); await page.waitForTimeout(300);
await page.setInputFiles('#attachInput', ['hbfiles/notes.txt', 'hbfiles/photo.png', 'hbfiles/paper.pdf']);
await page.waitForFunction(() => ATT.pending.length === 3 && ATT.pending.every(a => a.kind !== 'pdf' || a.note || a.pdfError || a.noText), null, { timeout: 30000 }).catch(() => {});
const pend = await page.evaluate(() => ATT.pending.map(a => ({ k: a.kind, p: a.path, note: a.note, err: a.pdfError, img: !!a.image, thumb: !!a.thumb })));
ok(pend.length === 3 && pend[0].k === 'text' && pend[1].k === 'image' && pend[1].img && pend[1].thumb && pend[2].k === 'pdf' && pend[2].note, 'attachments prepared: ' + JSON.stringify(pend));
const pdfNote = await page.evaluate(p => vfs.isFile(p) ? vfs.read(p) : '', pend[2].note || '');
ok(/Hello PDF world/.test(pdfNote) && /spaced repetition/.test(pdfNote) && /pages: 2/.test(pdfNote), 'PDF text extracted to a note');
await page.screenshot({ path: OUT + '/3_pending.png' });
n0 = chats.length;
await page.fill('#input', 'What is in these?'); await page.tap('#btnSend');
await page.waitForFunction(() => !running && document.querySelectorAll('#chat .msg-ai').length, null, { timeout: 20000 });
const sent = chats[n0].messages.at(-1);
ok(/What is in these\?/.test(sent.content) && /Alice: ship the vault on Friday/.test(sent.content) && /\.pdf\.md \(read it\)/.test(sent.content) && /attached as an image/.test(sent.content), 'model gets text inline, PDF note path and image notice');
ok(sent.images?.length === 1 && sent.images[0].length > 100, 'image sent to the model (base64)');
const big = await page.evaluate(() => { const b = atob(cur.messages[0].images[0]); return b.length; });
ok(big < 600000, 'image downscaled before sending (' + big + ' bytes)');
const bubble = await page.evaluate(() => ({ txt: document.querySelector('#chat .msg-user .bubble').textContent, chips: document.querySelectorAll('#chat .msg-user .att-chip').length, img: document.querySelectorAll('#chat .msg-user .att-chip img').length }));
ok(bubble.txt === 'What is in these?' && bubble.chips === 3 && bubble.img === 1, 'bubble shows your text plus 3 attachment chips: ' + JSON.stringify(bubble));
ok(await page.evaluate(() => [...vfs.nodes.keys()].filter(k => k.startsWith('/attachments/')).length) >= 4, 'files saved in the vault');
await page.screenshot({ path: OUT + '/4_sent.png' });
await page.locator('#chat .att-chip', { hasText: 'paper.pdf' }).tap(); await page.waitForTimeout(300);
ok(/paper\.pdf/.test(await page.textContent('#filePath')), 'tapping the PDF chip opens its text note');
await page.tap('.tab[data-tab="chat"]');
// attachments only, no text
await page.setInputFiles('#attachInput', ['hbfiles/notes.txt']); await page.waitForTimeout(400);
n0 = chats.length; await page.tap('#btnSend');
await page.waitForFunction(() => !running && document.querySelectorAll('#chat .msg-ai').length >= 2, null, { timeout: 20000 });
ok(/Please look at the attached file/.test(chats[n0].messages.at(-1).content) && /📎 notes-2\.txt/.test(await page.textContent('#chat')), 'send with only an attachment');
// non-vision model: retried without images
await page.fill('#input', '/new'); await page.tap('#btnSend'); await page.waitForTimeout(300);
noVision = true; await page.setInputFiles('#attachInput', ['hbfiles/photo.png']); await page.waitForTimeout(600);
n0 = chats.length; await page.fill('#input', 'see this?'); await page.tap('#btnSend');
await page.waitForFunction(() => !running && document.querySelectorAll('#chat .msg-ai').length, null, { timeout: 20000 });
ok(chats.length - n0 === 2 && !chats.at(-1).messages.some(m => m.images) && /Got 0 image/.test(await page.textContent('#chat')), 'non-vision model: retried without the image');
noVision = false;
// edit keeps attachments
await page.locator('#chat .msg-user [data-uact="edit"]').first().tap(); await page.fill('#chat .msg-edit textarea', 'describe this picture'); await page.locator('#chat .msg-edit [data-x="send"]').tap();
await page.waitForFunction(() => !running && document.querySelectorAll('#chat .msg-ai').length, null, { timeout: 20000 }); await page.waitForTimeout(300);
void ( JSON.stringify(chats.at(-1).messages.at(-1).content).slice(0, 300), await page.locator('#chat .msg-user .att-chip').count());
ok(/describe this picture/.test(chats.at(-1).messages.at(-1).content) && /photo(-\d)?\.png/.test(chats.at(-1).messages.at(-1).content) && await page.locator('#chat .msg-user .att-chip').count() === 1, 'edited message keeps its attachment');
// OpenAI-format images
const oa = await page.evaluate(() => toOpenAIMessages([{ role: 'user', content: 'x', images: ['QUJD'] }])[0]);
ok(Array.isArray(oa.content) && oa.content[1].image_url.url === 'data:image/jpeg;base64,QUJD', 'images converted for OpenAI-style APIs');
// ---------- llama.cpp ----------
await page.tap('#btnDrawer'); await page.waitForTimeout(300);
await page.selectOption('#provSel', 'llamacpp'); await page.waitForTimeout(1200);
await page.evaluate(() => document.body.classList.remove('drawer-open'));
const lc = await page.evaluate(() => ({ chip: $('#txtOllama').textContent, p: getProv(), hdr: $('#hdrModel').textContent }));
ok(lc.p.activeProv === 'llamacpp' && /LLAMA\.CPP LINKED/.test(lc.chip) && /Qwen3-8B-Q4_K_M\.gguf/.test(lc.hdr), 'llama.cpp linked: ' + lc.chip + ' / ' + lc.hdr);
await page.fill('#input', 'hi llama'); await page.tap('#btnSend');
await page.waitForFunction(() => !running && /llama\.cpp says hi/.test(document.querySelector('#chat').textContent), null, { timeout: 20000 });
ok(lcppBodies.length === 1 && lcppBodies[0].tools?.length > 5 && lcppBodies[0].stream_options?.include_usage, 'llama.cpp gets OpenAI-style tools request');
await page.tap('#btnSettings'); await page.waitForTimeout(300);
void ( await page.isHidden('#settings'), await page.isHidden('#sLcppHost'), await page.inputValue('#sLcppHost').catch(e => 'x'), await page.inputValue('#sProvider'), await page.textContent('#provHint'));
ok(!(await page.isHidden('#sLcppHost')) && await page.inputValue('#sLcppHost') === 'http://localhost:8080' && /--jinja/.test(await page.textContent('#provHint')), 'llama.cpp settings + hint');
await page.screenshot({ path: OUT + '/5_lcpp.png' });
// a setting changed while a helper model runs (journal, compaction, heartbeat) is saved, with the real chat model
const kept = await page.evaluate(async () => {
  const before = { prov: S.provider || 'local', model: S.model };
  const inside = await withModel(before.prov, 'helper-model:1b', async () => withModel(before.prov, 'inner-helper:1b', async () => { S.jadeTheme = 'ruby'; saveSettings(); return { model: S.model, override: !!window.__modelOverride }; }));
  const stored = JSON.parse(localStorage.getItem('jvault:settings'));
  return { before, inside, stored: { theme: stored.jadeTheme, model: stored.model, by: stored.modelBy?.[before.prov] }, after: { model: S.model, override: window.__modelOverride } };
});
ok(kept.inside.model === 'inner-helper:1b' && kept.inside.override && kept.stored.theme === 'ruby' && kept.stored.model === kept.before.model && kept.stored.by === kept.before.model && kept.after.model === kept.before.model && kept.after.override === false,
  'a setting changed while a helper model runs is saved, with the real chat model (nested runs too): ' + JSON.stringify(kept));
// the browser loses localStorage across a reload (a file:// WebView can; IndexedDB survives): settings come back from their IndexedDB copy
await page.evaluate(async () => { S.jadeTheme = 'emerald'; S.jadeHairMode = 'spectrum'; saveSettings(); await new Promise(r => setTimeout(r, 300)); for (const k of Object.keys(localStorage)) if (k.startsWith('jvault:')) localStorage.removeItem(k); });
await page.reload();
await page.waitForFunction(() => typeof runHeartbeat === 'function' && typeof S !== 'undefined', null, { timeout: 90000 }); await page.waitForTimeout(1500);
const back = await page.evaluate(async () => ({ theme: S.jadeTheme, hair: S.jadeHairMode, groq: S.groqKey, stored: JSON.parse(localStorage.getItem('jvault:settings') || '{}').jadeTheme, accent: getComputedStyle(document.documentElement).getPropertyValue('--yl').trim(), label: document.querySelector('#btnTheme')?.textContent, inBackup: 'settingsCopy' in ((await buildBackup('full', false)).db || {}) }));
ok(back.theme === 'emerald' && back.hair === 'spectrum' && back.groq === 'gsk_test' && back.stored === 'emerald' && back.accent === '#24d18b' && back.label === 'Emerald' && !back.inBackup, 'settings survive the browser losing localStorage across a reload (restored from their IndexedDB copy): ' + JSON.stringify(back));
console.log(log.join('\n')); console.log('\n' + (fail.length ? fail.join('\n') : 'ALL PASS'));
await browser.close();
