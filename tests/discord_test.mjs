// Discord bridge (real discord.py) running at the same time as the Vector bridge: a fake Discord server (REST + Gateway),
// the real Jade Discord bridge, the fake Vector agent behind the real Vector bridge, and a scripted model.
// Roles, scopes, trigger rules, chunking, resume, intent fallback, one shared queue.
import { autoTabs } from './_tabs.mjs';
import pw from 'playwright';
import fs from 'node:fs'; import { spawn } from 'node:child_process';
const { chromium } = pw;
const URL_ = process.argv[2] || 'file://' + process.env.JV_WEB;
const css = fs.readFileSync('tw.css', 'utf8');
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS' };
const log = [], fail = []; const ok = (c, m) => (c ? log : fail).push((c ? 'PASS ' : 'FAIL ') + m);
const cwd = process.cwd();
const VHOME = cwd + '/jvhome-dc', DHOME = cwd + '/jdhome-dc'; for (const h of [VHOME, DHOME]) fs.rmSync(h, { recursive: true, force: true });
const VBP = 8789, VCP = 8799, DBP = 8794, FDP = 8793;
const PYENV = fs.existsSync('/home/claude/pyenv.sh') ? '. /home/claude/pyenv.sh; ' : '';   // sandbox without pip: discord.py from a clone
const py = (args, env) => spawn('bash', ['-c', `${PYENV}exec python3 ${args}`], { env: { ...process.env, ...env }, stdio: ['ignore', 'ignore', 'pipe'] });
const procs = [];
const spawnPy = (args, env) => { const p = py(args, env); p.err = ''; p.stderr.on('data', d => p.err += d); procs.push(p); return p; };
process.on('exit', () => { for (const p of procs) try { p.kill(); } catch {} });
const vbridge = spawnPy(`pandora-vector/jade_vector_bridge.py --agent "python3 ${cwd}/pandora-vector/test/fake_vector_agent.py" --port ${VBP} --host 127.0.0.1`, { JADE_VECTOR_HOME: VHOME, FAKE_CONTROL_PORT: String(VCP) });
const fake = spawnPy(`pandora-discord/test/fake_discord.py --port ${FDP} --reject-content-once`, {});
await new Promise(r => setTimeout(r, 1200));
const dbridge = spawnPy(`pandora-discord/jade_discord_bridge.py --port ${DBP} --host 127.0.0.1 --bot-token-file ${cwd}/jdbot-dc.txt --archive`, { JADE_DISCORD_HOME: DHOME, JADE_DISCORD_TEST_API: `http://127.0.0.1:${FDP}/api/v10` });
fs.writeFileSync(cwd + '/jdbot-dc.txt', 'FAKE.bot.token\n');
await new Promise(r => setTimeout(r, 4500));
const VTOKEN = fs.readFileSync(VHOME + '/token', 'utf8').trim(), DTOKEN = fs.readFileSync(DHOME + '/token', 'utf8').trim();
const ctl = async (path, body) => (await fetch(`http://127.0.0.1:${VCP}${path}`, body ? { method: 'POST', body: JSON.stringify(body) } : {})).json();
const fd = async (path, body) => (await fetch(`http://127.0.0.1:${FDP}${path}`, body ? { method: 'POST', body: JSON.stringify(body) } : {})).json();
const VOWNER = 'npub1owner000000000000000000000000000000000000000000000000000', VALICE = 'npub1alice000000000000000000000000000000000000000000000000000';
const BOT = '90000000000000900', OWNER = '10000000000000100', ALICE = '10000000000000111', ADMIN = '10000000000000120', BOB = '10000000000000222', G1 = '70000000000000700', C_GEN = '80000000000000800', C_OFF = '80000000000000801', DM = id => '88' + id;
const CAT = fs.readFileSync('xdcfix/cat.png');
await fd('/_file', { name: 'cat.png', base64: CAT.toString('base64') });
// the bridge itself: auth, CORS, tools
{
  const H = { 'content-type': 'application/json' };
  const mcp = (tok, body) => fetch(`http://127.0.0.1:${DBP}/mcp`, { method: 'POST', headers: { ...H, ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: JSON.stringify(body) });
  ok((await mcp('', { jsonrpc: '2.0', id: 1, method: 'tools/list' })).status === 401, 'bridge: no token → 401');
  ok((await mcp('nope', { jsonrpc: '2.0', id: 1, method: 'tools/list' })).status === 401, 'bridge: wrong token → 401');
  const tl = await (await mcp(DTOKEN, { jsonrpc: '2.0', id: 1, method: 'tools/list' })).json();
  ok(tl.result.tools.length >= 15 && tl.result.tools.some(t => t.name === 'get_new_messages') && tl.result.tools.some(t => t.name === 'send_message'), 'bridge: tools/list with the token');
  const pre = await fetch(`http://127.0.0.1:${DBP}/mcp`, { method: 'OPTIONS' });
  ok(pre.status === 204 && pre.headers.get('access-control-allow-origin') === '*' && /authorization/i.test(pre.headers.get('access-control-allow-headers')), 'bridge: CORS preflight for the browser');
  const bad = await (await mcp(DTOKEN, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'nope', arguments: {} } })).json();
  ok(bad.result?.isError && /unknown tool/.test(bad.result.content[0].text), 'bridge: unknown tool is a tool error, not a crash');
}
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, timezoneId: 'America/New_York' });
await ctx.addInitScript(() => { try { if (window !== window.top) return; } catch {} if (!localStorage.getItem('jvault:settings')) localStorage.setItem('jvault:settings', JSON.stringify({ model: 'qwen3:8b', journalOn: false })); });
const page = autoTabs(await ctx.newPage()); page.on('pageerror', e => fail.push('[pageerror] ' + e.message));
const calls = [];
await ctx.route('**/*', async route => {
  const req = route.request(); const url = req.url();
  if (url.startsWith('file://') || url.startsWith('data:') || url.startsWith('blob:') || url.startsWith(`http://127.0.0.1:${VBP}`) || url.startsWith(`http://127.0.0.1:${DBP}`)) return route.continue();
  if (url.startsWith('https://cdn.tailwindcss.com/')) return route.fulfill({ contentType: 'text/javascript', body: `window.tailwind={};(function(){var s=document.createElement('style');s.textContent=${JSON.stringify(css)};document.head.prepend(s);})();` });
  if (url.includes('marked.min.js')) return route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(process.env.JV_NM + 'marked/lib/marked.umd.js', 'utf8') });
  if (url.includes('purify.min.js')) return route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(process.env.JV_NM + 'dompurify/dist/purify.min.js', 'utf8') });
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
  if (url === 'http://localhost:11434/api/tags') return route.fulfill({ headers: CORS, contentType: 'application/json', body: JSON.stringify({ models: [{ name: 'qwen3:8b' }] }) });
  if (url === 'http://localhost:11434/api/chat') {
    const b = JSON.parse(req.postData()); if (!b.stream) return route.fulfill({ headers: CORS, contentType: 'application/json', body: JSON.stringify({ message: { role: 'assistant', content: 'SUMMARY:\n- x\nREMEMBER:\n- none' }, done: true }) });
    const li = b.messages.findLastIndex(m => m.role === 'user'); const u = b.messages[li].content; const k = b.messages.slice(li).filter(m => m.role === 'tool').length;
    calls.push({ u: u.slice(0, 600), sys: b.messages[0].content, tools: b.tools.map(t => t.function.name), images: (b.messages[li].images || []).length, k, t: Date.now() });
    const T = (name, args) => ({ tool_calls: [{ function: { name, arguments: args } }] });
    const mid = (u.match(/message (\d{10,})/) || [])[1];
    let step = { content: 'ok' };
    if (/tell your boss/.test(u)) step = k === 0 ? T('notify_owner', { message: 'Alice: the shipment arrives at 5pm today.', urgent: true }) : { content: 'Done, I passed it on!' };
    else if (/show me his notes/.test(u)) step = k === 0 ? T('read', { path: '/Inbox.md' }) : { content: 'Sorry, I cannot share that.' };
    else if (/vector hello/.test(u)) step = { content: 'Hello on Vector.' };
    else if (/what time/.test(u)) step = { content: 'It is late, go to sleep.' };
    else if (/long essay/.test(u)) step = { content: ('Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(20) + '\n').repeat(4) };
    else if (/what is in this picture/.test(u)) step = { content: 'A small orange square.' };
    else if (/send the inbox note/.test(u)) step = k === 0 ? T('discord', { action: 'send_file', to: C_GEN, path: '/Inbox.md' }) : k === 1 ? T('discord', { action: 'react', to: 'here', message_id: mid, emoji: '👍' }) : { content: 'Sent it.' };
    else if (/ping everyone/.test(u)) step = k === 0 ? T('discord', { action: 'send', to: 'here', text: '@everyone hello' }) : { content: 'ok' };
    else if (/message the owner/.test(u)) step = k === 0 ? T('discord', { action: 'send', to: 'owner', text: 'spam' }) : { content: 'tried' };
    else if (/dm alice on discord/.test(u)) step = k === 0 ? T('discord', { action: 'send', to: 'user:' + ALICE, text: 'Hello from Jade' }) : { content: 'Messaged Alice.' };
    else if (/kick alice/.test(u)) step = k === 0 ? T('discord', { action: 'kick', guild_id: G1, user_id: ALICE }) : { content: 'done' };
    else if (/read the channel/.test(u)) step = k === 0 ? T('discord', { action: 'read', to: 'here', limit: 5 }) : { content: 'Read it.' };
    return route.fulfill({ headers: CORS, contentType: 'application/x-ndjson', body: JSON.stringify({ message: { role: 'assistant', content: step.content || '', ...(step.tool_calls ? { tool_calls: step.tool_calls } : {}) }, done: false }) + '\n' + JSON.stringify({ message: { role: 'assistant', content: '' }, done: true, prompt_eval_count: 10, eval_count: 5 }) + '\n' });
  }
  return route.abort();
});
await page.goto(URL_);
await page.waitForFunction(() => typeof dcConnect === 'function' && typeof vecConnect === 'function' && typeof userShell !== 'undefined', null, { timeout: 90000 });
await page.waitForTimeout(800);
const mainId = await page.evaluate(() => cur.id);
// ---- settings: wrong token, then the right one ----
await page.evaluate(() => openSettings()); await page.waitForTimeout(300);
const set = async (id, v) => { await page.fill(id, v); await page.dispatchEvent(id, 'change'); };
await set('#sDcUrl', `http://127.0.0.1:${DBP}/mcp`); await set('#sDcToken', 'bad-token'); await set('#sDcOwner', OWNER); await set('#sDcOwnerName', 'Sam'); await set('#sDcAdmins', ADMIN); await set('#sDcChannels', '#general'); await set('#sDcPoll', '1');
await page.selectOption('#sDcNotify', 'urgent');
await page.check('#sDcOn'); await page.waitForTimeout(1500);
ok(/Not connected/.test(await page.textContent('#dcStatus')) && /token/i.test(await page.textContent('#dcStatus')), 'wrong bridge token is refused: ' + (await page.textContent('#dcStatus')).slice(0, 90));
await set('#sDcToken', DTOKEN); await page.waitForFunction(() => DC.connected, null, { timeout: 25000 }).catch(async e => {
  // Say why before failing: the app's status line and the bridge's own log (CI shows only the last lines of a failed suite).
  console.log('dcStatus: ' + (await page.textContent('#dcStatus').catch(() => '?')).slice(0, 200));
  console.log('bridge stderr: ' + dbridge.err.slice(-1200).replace(/\n/g, ' | '));
  console.log('fake discord stderr: ' + fake.err.slice(-600).replace(/\n/g, ' | '));
  throw e;
});
ok(/Online/.test(await page.textContent('#dcStatus')) && /JadeBot/.test(await page.textContent('#dcStatus')), 'connects with the token, shows her name');
const ids = (await fd('/_state')).identifies;
ok(ids.length === 2 && (ids[0] & 32768) && !(ids[1] & 32768), 'Message Content Intent off in the portal (close 4014): the bridge reconnects without it: ' + JSON.stringify(ids));
ok(/Message Content Intent/.test(await page.textContent('#dcStatus')), 'and the app tells you how to fix it');
ok(await page.evaluate(() => dcInviteUrl()) === 'https://discord.com/oauth2/authorize?client_id=90000000000000900&scope=bot&permissions=101440', 'invite link has the bot id and permissions');
await page.waitForFunction(() => Object.values(DC.chans).some(c => c.name === 'general'), null, { timeout: 8000 }).catch(() => {});
ok(await page.evaluate(() => Object.values(DC.chans).some(c => c.name === 'general' && c.guild === 'Book Club')), 'servers and channels are listed from the bridge: ' + await page.evaluate(() => JSON.stringify([DC.guilds, DC.chans])));
await page.evaluate(() => document.querySelector('#dcSection').scrollIntoView()); await page.screenshot({ path: 'dc_settings.png' });
// Vector on as well
await set('#sVecUrl', `http://127.0.0.1:${VBP}/mcp`); await set('#sVecToken', VTOKEN); await set('#sVecOwner', VOWNER);
await page.evaluate(() => { const t = document.querySelector('#sVecPoll'); t.value = '2'; t.dispatchEvent(new Event('change')); });
await page.check('#sVecOn'); await page.waitForFunction(() => VEC.connected, null, { timeout: 20000 });
ok(await page.evaluate(() => VEC.connected && DC.connected), 'Vector and Discord are online together');
await page.evaluate(() => window.__androidBack());
await page.waitForTimeout(300);
const idle = () => page.waitForFunction(() => !DC.busy && !DC.q.length && !VEC.busy && !VEC.q.length && !running, null, { timeout: 40000 });
const settle = async () => { await page.waitForTimeout(2200); await idle(); await page.waitForTimeout(400); };
const inject = o => fd('/_inject', o);
const sent = async () => (await fd('/_state')).sent; const calls_ = async () => (await fd('/_state')).calls;
const ownerUser = '100', aliceU = '111';
// ---- 1. stranger in the whitelisted channel, @mentions her: secretary ----
await fd('/_reset', {});
const m1 = await inject({ channel_id: C_GEN, author: ALICE, content: `<@${BOT}> can you tell your boss the shipment arrives at 5pm?`, mention_bot: true });
await settle();
const c1 = calls.find(c => /tell your boss/.test(c.u));
ok(c1 && JSON.stringify([...c1.tools].sort()) === '["discord","discord_history","notify_owner","web_search"]', 'stranger gets only chat tools: ' + JSON.stringify(c1?.tools));
ok(c1 && !/Vault conventions|Long-term memory/.test(c1.sys) && /not your owner|private/i.test(c1.sys) && /@Jade/.test(c1.u), 'scoped prompt without vault or memory; <@id> shown as @Jade: ' + c1?.u.slice(0, 120));
ok(c1 && /channel topic: "Books we are reading this month"/.test(c1.u) && /Channels in Book Club/.test(c1.u) && /#offtopic/.test(c1.u), 'she sees the channel topic, and the server\'s channels at the start of a conversation: ' + c1?.u.slice(0, 400));
ok(c1 && /keyholder/.test(c1.sys) && !/owned by/.test(c1.sys) && /Size it to the moment/.test(c1.sys) && /no LaTeX/.test(c1.sys), 'Discord rules: keyholder wording, reply length follows the persona');
let S1 = await sent();
const reply1 = S1.find(r => r.chat_id === C_GEN && /passed it on/.test(r.content || ''));
ok(reply1 && reply1.reply_to == m1.id && JSON.stringify(reply1.allowed_mentions) === '{"parse":[],"replied_user":false}', 'answer is a threaded reply and never pings anyone: ' + JSON.stringify(reply1));
ok((await fd('/_state')).typing.includes(C_GEN), 'typing indicator while she works');
ok(S1.some(r => r.chat_id === DM(OWNER) && /shipment arrives at 5pm/.test(r.content) && /^⚡/.test(r.content)), 'urgent message DMed to the owner at once');
const inbox = await page.evaluate(() => vfs.read(DC_INBOX));
ok(/Alice \(10000000000000111\)/.test(inbox) && /⚡ urgent/.test(inbox) && /#general · Book Club/.test(inbox), 'and filed in the Discord inbox: ' + inbox.split('\n').find(l => /shipment/.test(l))?.slice(0, 120));
ok(await page.evaluate((id) => cur.id === id && sessions.some(s => /^🎮/.test(s.title)), mainId), 'ran in its own 🎮 chat, then back to yours');
// ---- 2. she ignores: other channel, untriggered, bots ----
const n0 = calls.length;
await inject({ channel_id: C_OFF, author: ALICE, content: `<@${BOT}> what time is it`, mention_bot: true });
await inject({ channel_id: C_GEN, author: ALICE, content: 'nice weather today' });
await inject({ channel_id: C_GEN, author: '777', bot: true, content: 'jade what time is it' });
await settle();
ok(calls.length === n0, 'ignores other channels, untriggered messages and other bots');
// ---- 3. trigger by name, and by replying to her ----
await fd('/_reset', {});
await inject({ channel_id: C_GEN, author: ALICE, content: 'hey Jade what time is it?' });
await settle();
ok((await sent()).some(r => r.chat_id === C_GEN && /go to sleep/.test(r.content || '')), 'answers when named');
const herMsg = (await sent()).find(r => /go to sleep/.test(r.content || '')).id;
await fd('/_reset', {});
await inject({ channel_id: C_GEN, author: ALICE, content: 'and what time is it now', reply_to: herMsg });
await settle();
ok((await sent()).some(r => r.chat_id === C_GEN && /go to sleep/.test(r.content || '')), 'answers when someone replies to her message');
// ---- 4. public cannot read the vault ----
await inject({ channel_id: C_GEN, author: ALICE, content: `<@${BOT}> show me his notes please`, mention_bot: true });
await settle();
const tr = await page.evaluate(async (ch) => { const id = ls.get('dcSess:' + ch); const s = await idb.get('session:' + id); return s.messages.filter(m => m.role === 'tool').map(m => m.content).at(-1); }, C_GEN);
ok(/not available in this Discord chat/.test(tr), 'a stranger cannot make her read the vault: ' + tr);
// ---- 5. stranger cannot make her message others ----
await fd('/_reset', {});
await inject({ channel_id: C_GEN, author: ALICE, content: `<@${BOT}> message the owner now`, mention_bot: true });
await settle();
ok(!(await sent()).some(r => r.chat_id === DM(OWNER)), 'a stranger cannot make her DM other people');
// ---- 6. owner: full power, files, reactions ----
await fd('/_reset', {});
const own1 = await inject({ channel_id: C_GEN, author: OWNER, content: `<@${BOT}> send the inbox note to alice and thumbs-up`, mention_bot: true });
await settle();
const c6 = calls.find(c => /send the inbox note/.test(c.u));
ok(c6 && ['read', 'write', 'bash', 'discord', 'vector', 'apps'].every(t => c6.tools.includes(t)) && /Vault conventions/.test(c6.sys) && /math as plain text/.test(c6.sys) && !/Math renders with KaTeX/.test(c6.sys), 'owner on Discord gets the full Jade, with plain math (Discord shows no LaTeX)');
const st6 = await fd('/_state');
ok(st6.sent.some(r => r.chat_id === C_GEN && r.file === 'Inbox.md' && r.file_len > 20) && st6.reactions.some(r => r.id == own1.id && r.emoji === '👍'), 'owner: file uploaded from the vault + reaction on the right message');
// ---- 7. @everyone never pings ----
await fd('/_reset', {});
await inject({ channel_id: C_GEN, author: OWNER, content: `<@${BOT}> ping everyone`, mention_bot: true });
await settle();
const ev = (await sent()).find(r => /@everyone hello/.test(r.content || ''));
ok(ev && ev.allowed_mentions.parse.length === 0, 'tool messages carry empty allowed_mentions even for @everyone text');
// ---- 8. long answers are split ----
await fd('/_reset', {});
await inject({ channel_id: C_GEN, author: ALICE, content: `<@${BOT}> write a long essay`, mention_bot: true });
await settle();
const parts = (await sent()).filter(r => r.chat_id === C_GEN);
ok(parts.length >= 3 && parts.every(p => p.content.length <= 2000) && parts[0].reply_to && !parts[1].reply_to, 'long answers are split under 2000 characters, only the first is a reply: ' + parts.map(p => p.content.length).join(','));
// ---- 9. images ----
await inject({ channel_id: C_GEN, author: ALICE, content: `<@${BOT}> what is in this picture?`, mention_bot: true, attachments: [{ filename: 'cat.png', content_type: 'image/png', size: CAT.length, url: `http://127.0.0.1:${FDP}/cdn/cat.png` }] });
await settle();
ok(calls.find(c => /what is in this picture/.test(c.u))?.images === 1 && /attachment 0: cat\.png/.test(calls.find(c => /what is in this picture/.test(c.u)).u), 'she sees images people send (downloaded through the bridge)');
// ---- 10. DMs: policy ----
await fd('/_reset', {});
await inject({ channel_id: DM(ALICE), author: ALICE, content: 'what time is it?' });
await settle();
ok((await sent()).some(r => r.chat_id === DM(ALICE) && /go to sleep/.test(r.content || '')), 'answers a DM from anyone (no trigger needed)');
await page.evaluate(() => { S.dcDm = 'owner'; saveSettings(); }); const n10 = calls.length;
await inject({ channel_id: DM(BOB), author: BOB, content: 'hello?' });
await settle();
ok(calls.length === n10 && /not answered: DM policy/.test(await page.evaluate(() => vfs.read(DC_INBOX))), 'DM policy "only me": strangers go to the inbox unanswered');
await page.evaluate(() => { S.dcDm = 'anyone'; saveSettings(); });
// ---- 11. both bridges at once: one queue, both answered, each in its own chat ----
await fd('/_reset', {}); await ctl('/reset_log', {});
await inject({ channel_id: C_GEN, author: ALICE, content: `<@${BOT}> what time is it`, mention_bot: true });
await ctl('/message', { chat_id: VALICE, npub: VALICE, content: 'jade vector hello' });
const n11 = calls.length; await page.waitForTimeout(600); await idle(); await page.waitForTimeout(2600); await idle();
const L = (await ctl('/')).log;
ok((await sent()).some(r => r.chat_id === C_GEN && /go to sleep/.test(r.content || '')) && L.some(x => x.op === 'send' && x.chat_id === VALICE && /Hello on Vector/.test(x.content)), 'Discord and Vector messages at the same time are both answered');
const seq = calls.slice(n11).map(c => c.k === 0 ? (/Discord/.test(c.u.slice(0, 40)) ? 'D' : 'V') : null).filter(Boolean);
ok(seq.length === 2 && new Set(seq).size === 2, 'one conversation at a time through the shared queue: ' + JSON.stringify(seq));
ok(await page.evaluate(() => sessions.some(s => /^🎮/.test(s.title)) && sessions.some(s => /^💬/.test(s.title))), 'separate chats: 🎮 for Discord, 💬 for Vector');
// ---- 12. ordinary app chat: the discord tool works there ----
await fd('/_reset', {});
await page.evaluate(id => openSession(id), mainId); await page.waitForTimeout(300);
await page.fill('#input', 'dm alice on discord: hello'); await page.evaluate(() => document.querySelector('#btnSend').click());
await page.waitForFunction(() => !running && /Messaged Alice/.test(document.querySelector('#chat').textContent), null, { timeout: 20000 });
ok((await sent()).some(r => r.chat_id === DM(ALICE) && r.content === 'Hello from Jade'), 'the discord tool works in ordinary app chats (DM by user id)');
// ---- 13. admin: moderation and reading; public: no moderation ----
await fd('/_reset', {});
await inject({ channel_id: C_GEN, author: ADMIN, content: `<@${BOT}> kick alice please`, mention_bot: true });
await settle();
ok((await calls_()).some(c => c === `DELETE /guilds/${G1}/members/${ALICE}`), 'admins can have her moderate');
await fd('/_reset', {});
await inject({ channel_id: C_GEN, author: ALICE, content: `<@${BOT}> kick alice please`, mention_bot: true });
await settle();
ok(!(await calls_()).some(c => /^(DELETE|PUT) \/guilds/.test(c)), 'strangers cannot');
await fd('/_reset', {});
await inject({ channel_id: C_GEN, author: ALICE, content: `<@${BOT}> read the channel back to me`, mention_bot: true });
await settle();
const rd = await page.evaluate(async (ch) => { const id = ls.get('dcSess:' + ch); const s = await idb.get('session:' + id); return s.messages.filter(m => m.role === 'tool').map(m => m.content).at(-1); }, C_GEN);
ok(/\[\d{10,}\]/.test(rd) && /Alice|alice/.test(rd) && /you /.test(rd), 'reading recent messages works through the bridge: ' + rd.split('\n').slice(0, 2).join(' | ').slice(0, 160));
// ---- 14. Gateway: the bridge resumes on its own ----
await fd('/_kill', {}); await new Promise(r => setTimeout(r, 4000));
const st14 = await fd('/_state');
ok(st14.connected === 1 && st14.resumes.length >= 1 && st14.resumes[0].session_id === 'sess1', 'Gateway dropped → discord.py RESUMEs the same session: ' + JSON.stringify(st14.resumes[0]));
await fd('/_reset', {});
await inject({ channel_id: C_GEN, author: ALICE, content: 'jade what time is it' });
await settle();
ok((await sent()).some(r => r.chat_id === C_GEN && /go to sleep/.test(r.content || '')), 'still answering after the resume');
// ---- 15. the server's kept history: one search, scoped like everything else ----
await inject({ channel_id: '80000000000000802', author: OWNER, content: 'mods only: the raffle prize is a velvet cloak' });
await inject({ channel_id: C_GEN, author: ALICE, content: 'remember the velvet lantern from the reading?' });
await settle();
const hist = await page.evaluate(async () => { const t = async (a, scope) => { const keep = cur.dcScope; cur.dcScope = scope; try { return await runTool('discord_history', a, null); } catch (e) { return 'ERR ' + e.message; } finally { cur.dcScope = keep; } };
  return { own: await t({ action: 'search', query: 'velvet' }, 'owner'), pub: await t({ action: 'search', query: 'velvet' }, 'public'), chans: await t({ action: 'channels' }, 'public') }; });
ok(/cloak/.test(hist.own) && /lantern/.test(hist.own), 'keyholder: discord_history searches every kept channel: ' + hist.own.slice(0, 160));
ok(/lantern/.test(hist.pub) && !/cloak/.test(hist.pub) && !/staff/.test(hist.chans), 'public chat: discord_history only sees channels everyone can see: ' + hist.pub.slice(0, 160));
ok(c1 && c1.tools.includes('discord_history') && /discord_history/.test(c1.sys) && c6.tools.includes('discord_history'), 'discord_history is offered in public chats and to the keyholder, with a hint to use it');
// ---- bridge goes away and comes back ----
dbridge.kill(); await page.waitForTimeout(3500);
ok(await page.evaluate(() => !!DC.error) && /Not connected|Online/.test(await page.textContent('#dcStatus').catch(() => '') || 'Online'), 'bridge stopped: the app notices (' + (await page.evaluate(() => DC.error)).slice(0, 70) + ')');
// ---- backups and UI ----
await page.evaluate(() => { window.NetrunnerAndroid = { saveFile(n, m, t) { window.__saved = [n, m, t]; setTimeout(() => window.__jadeSaved && window.__jadeSaved(true, n), 10); }, keepAlive() {}, batteryOptimized() { return true; } }; });
await page.evaluate(() => openSettings()); await page.waitForTimeout(300);
await page.tap('#btnExportAll'); await page.waitForFunction(() => window.__saved, null, { timeout: 15000 });
const bk = JSON.parse(await page.evaluate(() => window.__saved[2]));
ok(!('dcToken' in bk.settings) && !JSON.stringify(bk).includes(DTOKEN), 'the bridge token is left out of backups');
await page.evaluate(() => { document.querySelector('#settings').hidden = true; }); await page.waitForTimeout(200);
await page.fill('#input', '/discord'); await page.evaluate(() => document.querySelector('#btnSend').click()); await page.waitForTimeout(600);
ok(await page.evaluate(() => !document.querySelector('#settings').hidden), '/discord opens the settings');
await page.screenshot({ path: 'dc_settings2.png' });
console.log(log.join('\n')); console.log('\n' + (fail.length ? fail.join('\n') : 'ALL PASS'));
await browser.close(); for (const p of procs) try { p.kill(); } catch {}
fs.rmSync(cwd + '/jdbot-dc.txt', { force: true });
process.exit(fail.length ? 1 : 0);
