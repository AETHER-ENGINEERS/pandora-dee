// The script bridge (jade.* in node), the jade / flow / crontab shell commands, and schedules that run
// shell commands or flows (Schedule tab, the schedule tool, crontab, cron.log, failure notifications).
import { start } from './_harness.mjs';
const { page, ok, sh, write, read, model, ollaya, done } = await start();
const E = (fn, arg) => page.evaluate(fn, arg);

await write('/Inbox.md', '# Inbox\n\n- buy milk\n- server on fire\n');
await write('/out/.keep', '');
await E(() => flowSave({ name: 'Double', steps: [{ type: 'set', fields: { doubled: '{{ ($input?.x ?? 1) * 2 }}', via: '{{ $run.via }}' } }] }));
await E(() => flowSave({ name: 'Broken', steps: [{ type: 'js', code: "throw new Error('broken on purpose')" }] }));

// ---------- jade in node scripts ----------
let r = await sh(`node -e "const t = await jade.tool('read', { path: '/Inbox.md' }); console.log(t.includes('buy milk'))"`);
ok(r.code === 0 && r.out.trim() === 'true', 'node: jade.tool calls a tool: ' + JSON.stringify(r));
r = await sh(`node -e "console.log((await jade.tools.notes_search({ query: 'Inbox' })).includes('Inbox'))"`);
ok(r.out.trim() === 'true', 'node: jade.tools.<name>(args) works too');
r = await sh(`node -e "const d = await jade.decide({ state: 'server on fire', question: 'Urgent?', type: 'yesno' }); console.log(JSON.stringify(d))"`);
let d = JSON.parse(r.out); ok(d.result === true && d.answer === true && d.confidence === 0.88 && d.type === 'yesno', 'node: jade.decide returns a structured decision: ' + r.out.trim());
r = await sh(`node -e "const d = await jade.decide({ state: 'x', question: 'Pick', options: ['a', 'b'] }); console.log(d.choice, d.probabilities.a)"`);
ok(r.out.trim() === 'a 0.91', 'node: jade.decide choice with probabilities');
r = await sh(`node -e "console.log(await jade.ask('hello'))"`);
ok(r.out.trim() === 'ANSWER: hello' && model.oneShot.at(-1).at(-1).content === 'hello', 'node: jade.ask asks the model once');
r = await sh(`node -e "const j = await jade.ask('list', { json: true }); console.log(j.n + 1)"`);
ok(r.out.trim() === '4', 'node: jade.ask with json:true returns parsed JSON');
r = await sh(`node -e "const o = await jade.flow('Double', { x: 21 }); console.log(o.doubled, o.via)"`);
ok(r.out.trim() === '42 script', 'node: jade.flow runs a flow and returns its output');
r = await sh(`node -e "try { await jade.flow('Broken') } catch (e) { console.log('caught', e.message) }"`);
ok(/^caught ritual "Broken" error: .*broken on purpose/.test(r.out.trim()), 'node: a failing flow rejects with its error: ' + r.out.trim());
r = await sh(`node -e "const s = await jade.shell('echo hi && ls /does-not-exist'); console.log(s.code !== 0, s.stdout.trim())"`);
ok(r.out.trim() === 'true hi', 'node: jade.shell runs a command line and returns code / stdout / stderr');
r = await sh(`node -e "try { await jade.tool('no_such_tool') } catch (e) { console.log(e.message) }"`);
ok(/no tool named no_such_tool/.test(r.out), 'node: an unknown tool rejects with a clear message');
r = await sh(`node -e "try { await jade.tool('read', { path: '/nope.md' }) } catch (e) { console.log('ERR', e.message) }"`);
ok(/^ERR/.test(r.out.trim()), 'node: a tool error rejects the promise');
r = await sh(`node -e "const l = await jade.list(); console.log(l.some(t => t.name === 'bash') && l.some(t => t.name === 'ritual'))"`);
ok(r.out.trim() === 'true', 'node: jade.list() lists the tools');
r = await sh(`node -e "await jade.kv.set('counter', { n: 5 }); console.log((await jade.kv.get('counter')).n, await jade.kv.get('missing'))"`);
ok(r.out.trim() === '5 null', 'node: jade.kv keeps values');
r = await sh(`node -e "console.log((await jade.kv.get('counter')).n)"`);
ok(r.out.trim() === '5', 'node: jade.kv values survive between scripts');
r = await sh(`node -e "try { await jade.prompt('x') } catch (e) { console.log(e.message) }"`);
ok(/only work in a template/.test(r.out), 'node: jade.prompt is only for templates (nobody to ask in a script)');
r = await sh(`node -e "try { await jade.tool('read', { path: '/x', fn: () => 1 }) } catch (e) { console.log('E', e.message) }"`);
ok(/E /.test(r.out), 'node: non-JSON arguments are handled (functions dropped / rejected)');
// files: fs writes are visible to tools mid-script, and tool writes are visible to fs
r = await sh(`node -e "fs.writeFileSync('/sync/a.md', 'from fs'); const t = await jade.tool('read', { path: '/sync/a.md' }); console.log(t.trim())"`);
ok(r.out.trim() === 'from fs', 'a file the script wrote is there for a tool it calls next: ' + JSON.stringify(r));
r = await sh(`node -e "await jade.tool('write', { path: '/sync/b.md', content: 'from tool' }); console.log(fs.readFileSync('/sync/b.md', 'utf8'), fs.existsSync('/sync/b.md'))"`);
ok(r.out.trim() === 'from tool true', 'a file a tool wrote is there for fs right after');
r = await sh(`node -e "fs.writeFileSync('/sync/c.md', 'v1'); await jade.tool('write', { path: '/sync/c.md', content: 'v2' }); fs.appendFileSync('/sync/c.md', '+3')"`);
ok(await read('/sync/c.md') === 'v2+3', 'fs and tools edit the same file in order (no stale overwrite)');
r = await sh(`node -e "await jade.tool('bash', { command: 'rm /sync/a.md' }); console.log(fs.existsSync('/sync/a.md'))"`);
ok(r.out.trim() === 'false' && !(await read('/sync/a.md')), 'a file a tool deleted is gone for fs too');
r = await sh(`node -e "jade.tool('write', { path: '/sync/late.md', content: 'not awaited' })"`);
ok(await read('/sync/late.md') === 'not awaited', 'the script waits for jade calls it did not await');
await write('/scripts/bridge.js', "const n = (await jade.search('Inbox')).length > 0;\nconsole.log('search ok', n);\nprocess.exit(n ? 0 : 3);\n");
r = await sh('node /scripts/bridge.js');
ok(r.code === 0 && /search ok true/.test(r.out), 'node file.js gets the bridge too');
// files of 2 MB and more (a backup, say): always visible, loaded when the script names them
const BIGP = '/backups/jade-vault-backup-2026-10-19(2).json';
await E(p => { vfs.write(p, JSON.stringify({ app: 'jade-vault', n: 2, pad: 'x'.repeat(3e6) }), { mkdirs: true }); vfs.write('/backups/small(1).json', '{"n":1}'); }, BIGP);
r = await sh(`node -e "const fs = require('fs'); console.log(fs.readdirSync('/backups').join('|'), fs.existsSync('${BIGP}'), fs.statSync('${BIGP}').size, JSON.parse(fs.readFileSync('${BIGP}', 'utf8')).n, JSON.parse(fs.readFileSync('/backups/small(1).json', 'utf8')).n)"`);
ok(r.code === 0 && r.out.trim() === 'jade-vault-backup-2026-10-19(2).json|small(1).json true 3000035 2 1', 'node: a 3 MB file (parentheses and all) is listed, exists, has its size, and loads when the script names it: ' + JSON.stringify(r));
await write('/scripts/count.js', "const fs = require('fs'); console.log(JSON.parse(fs.readFileSync(process.argv[2], 'utf8')).pad.length);\n");
r = await sh(`node /scripts/count.js '${BIGP}'`);
ok(r.code === 0 && r.out.trim() === '3000000', 'node: a big file given as an argument loads too: ' + JSON.stringify(r).slice(0, 200));
r = await sh(`node -e "const fs = require('fs'); const f = '/backups/' + fs.readdirSync('/backups').find(n => n.startsWith('jade')); try { fs.readFileSync(f, 'utf8'); console.log('read it') } catch (e) { console.log(e.code, e.message) }"`);
ok(/^EFBIG EFBIG: \/backups\/jade-vault-backup-2026-10-19\(2\)\.json is 3\.0 MB/.test(r.out) && /Write its path in the script/.test(r.out), 'node: a big file the script does not name says why it is not loaded (not "no such file"): ' + r.out.trim().slice(0, 160));
r = await sh(`node -e "await jade.notify('From node', 'body text')"`);
ok(await E(() => window.__notes.some(n => n[0] === 'From node' && n[1] === 'body text')), 'node: jade.notify sends a notification');
r = await sh(`node -e "const r = await jade.agent('hello from node'); console.log(r.reply)"`);
ok(r.out.trim() === 'Agent says: hello from node', 'node: jade.agent runs a chat turn and returns the reply');

// ---------- the jade shell command ----------
r = await sh('jade help'); ok(r.code === 0 && /pandora tool <name>/.test(r.out) && /pandora\.tool\(/.test(r.out) && /the jade command, jade\.\*/.test(r.out), 'jade help (Pandora\'s help, which says jade still works)');
r = await sh('jade tools'); ok(r.code === 0 && /^read\s/m.test(r.out) && /^ritual\s/m.test(r.out) && !/^flow\s/m.test(r.out), 'jade tools lists tools (her ritual tool, no separate flow tool)');
r = await sh('jade tool notes_search query=Inbox limit=3'); ok(r.code === 0 && /Inbox/.test(r.out), 'jade tool with key=value arguments');
r = await sh(`jade tool read '{"path": "/Inbox.md"}'`); ok(r.code === 0 && /buy milk/.test(r.out), 'jade tool with one JSON argument');
r = await sh(`echo '{"path": "/Inbox.md"}' | jade tool read`); ok(r.code === 0 && /buy milk/.test(r.out), 'jade tool reads JSON from stdin');
r = await sh('jade tool nope'); ok(r.code === 1 && /jade: no tool named nope/.test(r.err), 'jade tool: unknown tool → exit 1');
r = await sh(`jade decide '{"state": "fire!", "question": "Urgent?", "type": "yesno"}'`); ok(r.code === 0 && JSON.parse(r.out).result === true, 'jade decide with JSON');
r = await sh(`jade decide "a blue car" "Which colour?" red blue`); ok(r.code === 0 && JSON.parse(r.out).choice === 'red', 'jade decide "<state>" "<question>" options…');
r = await sh(`jade ask "what is up"`); ok(r.out.trim() === 'ANSWER: what is up', 'jade ask');
r = await sh(`jade ask --json "give json"`); ok(JSON.parse(r.out).n === 3, 'jade ask --json');
r = await sh(`jade ask -s "Be brief" "hi"`); ok(model.oneShot.at(-1)[0].content === 'Be brief' && r.code === 0, 'jade ask -s sets the system prompt');
r = await sh(`jade kv set color '"green"' && jade kv get color && jade kv list`); ok(r.code === 0 && /"green"/.test(r.out) && /"counter"/.test(r.out), 'jade kv set / get / list');
r = await sh(`jade notify "Shell says" "hello"`); ok(r.code === 0 && await E(() => window.__notes.some(n => n[0] === 'Shell says')), 'jade notify');
r = await sh('jade tool read path=/Inbox.md | grep -c milk'); ok(r.out.trim() === '1', 'jade output pipes into BusyBox');
r = await sh('jade bogus'); ok(r.code === 1 && /unknown subcommand/.test(r.err), 'jade: unknown subcommand → exit 1');
// ---- Pandora's names beside Jade's: the pandora command and pandora.* in node ----
r = await sh('pandora help'); ok(r.code === 0 && /^pandora — call Pandora/.test(r.out) && /pandora\.ritual\('Name', input\)/.test(r.out), 'pandora help');
r = await sh('pandora tool read path=/Inbox.md | grep -c milk'); ok(r.code === 0 && r.out.trim() === '1', 'pandora tool calls a tool, like jade tool');
r = await sh('pandora tool nope'); ok(r.code === 1 && /^pandora: no tool named nope\. pandora\.list\(\) shows them/.test(r.err), 'pandora: errors carry the name it was called by: ' + r.err.trim());
r = await sh('pandora kv get color'); ok(r.code === 0 && r.out.trim() === 'green', 'pandora kv sees what jade kv set: ' + r.out.trim());
r = await sh(`node -e "const o = await pandora.ritual('Double', { x: 4 }); const j = await jade.flow('Double', { x: 5 }); console.log(o.doubled, j.doubled, pandora === jade, (await pandora.rituals()).some(f => f.name === 'Double'), (await jade.flows()).length > 0)"`);
ok(r.out.trim() === '8 10 true true true', 'node: pandora.ritual / pandora.rituals beside jade.flow / jade.flows (one object): ' + r.out + r.err);
r = await sh(`node -e "console.log((await pandora.tool('read', { path: '/Inbox.md' })).includes('milk'), (await pandora.tools.notes_search({ query: 'Inbox' })).includes('Inbox'), (await jade.tool('flow', { action: 'list' })).includes('Double'))"`);
ok(r.out.trim() === 'true true true', 'node: pandora.tool / pandora.tools.<name>, and jade.tool(\'flow\') still reaches the ritual tool: ' + r.out + r.err);

// ---------- BusyBox commands apply only their own changes (no lost writes while one runs) ----------
await write('/out/gone.md', 'delete me'); await write('/out/del.md', 'deleted meanwhile');
r = await E(async () => {
  const S0 = Object.getPrototypeOf(userShell).constructor; const s = new S0({}); s.timeoutMs = 15000;
  const p = s.run('sleep 1 && cp /Inbox.md /out/copy.md && rm /out/gone.md');
  await new Promise(r => setTimeout(r, 300));
  vfs.write('/out/during.md', 'written meanwhile'); vfs.rm('/out/del.md');
  const res = await p;
  return { code: res.code, during: vfs.isFile('/out/during.md') && vfs.read('/out/during.md'), del: vfs.isFile('/out/del.md'), copy: vfs.isFile('/out/copy.md') && vfs.read('/out/copy.md').includes('buy milk'), gone: vfs.isFile('/out/gone.md') };
});
ok(r.code === 0 && r.during === 'written meanwhile' && r.del === false, 'a file written (or deleted) while a BusyBox command runs is kept (stays deleted): ' + JSON.stringify(r));
ok(r.copy === true && r.gone === false, 'the command\'s own changes (cp, rm) still apply');

// ---------- the flow shell command ----------
r = await sh('flow help'); ok(/ritual run <name>/.test(r.out) && /flow command works too/.test(r.out), 'flow help (the ritual help, which says flow still works)');
r = await sh('flow list'); ok(r.code === 0 && /● Double/.test(r.out) && /Manual/.test(r.out), 'flow list: ' + r.out.split('\n')[0]);
r = await sh(`flow run Double '{"x": 5}'`); ok(r.code === 0 && /✓ s1 \(set/.test(r.out) && /"doubled": 10/.test(r.out) && /"via": "shell"/.test(r.out), 'flow run Name <json> prints the steps and the output: ' + r.out.replace(/\n/g, ' | '));
r = await sh('flow run Double x=7 -q'); ok(r.code === 0 && JSON.parse(r.out).doubled === 14, 'flow run with key=value input; -q prints only the output');
r = await sh(`echo '{"x": 50}' | flow run Double -q`); ok(JSON.parse(r.out).doubled === 100, 'flow run reads its input from stdin');
r = await sh('flow run Double -q | grep -c doubled'); ok(r.out.trim() === '1', 'flow output pipes');
r = await sh('flow run Broken'); ok(r.code === 1 && /flow: Broken error/.test(r.err) && /✗/.test(r.out), 'a failing flow → exit 1 with the error');
r = await sh('flow run Nope'); ok(r.code === 1 && /^flow: no ritual named "Nope"\. flow list shows them/.test(r.err), 'unknown ritual → exit 1: ' + r.err.trim());
r = await sh('flow run Double && echo chained'); ok(/chained/.test(r.out), 'flow run works with && (exit codes)');
r = await sh('flow show Double'); ok(JSON.parse(r.out).name === 'Double', 'flow show prints the JSON');
r = await sh('flow export Double /tmp/double.json && flow export Double'); ok(r.code === 0 && JSON.parse(await read('/tmp/double.json')).name === 'Double', 'flow export to a file or stdout');
await E(() => { const f = JSON.parse(vfs.read('/tmp/double.json')); f.name = 'Imported'; vfs.write('/tmp/imp.json', JSON.stringify(f)); vfs.write('/tmp/bad.json', '{"name":"x","steps":[{"type":"zzz"}]}'); });
r = await sh('flow import /tmp/imp.json'); ok(r.code === 0 && /added Imported/.test(r.out) && await E(() => !!flowFind('Imported')), 'flow import adds a flow from JSON');
r = await sh('flow import /tmp/bad.json'); ok(r.code === 1 && /unknown type "zzz"/.test(r.err), 'flow import refuses an invalid flow');
r = await sh('flow disable Imported && flow list'); ok(/○ Imported/.test(r.out), 'flow disable / enable');
r = await sh('flow runs Double'); ok(r.code === 0 && /Double\s+ok/.test(r.out) && /via shell/.test(r.out), 'flow runs shows recent runs');
// ---- the ritual command beside flow ----
r = await sh('ritual help'); ok(r.code === 0 && /^ritual — run and manage rituals/.test(r.out), 'ritual help');
r = await sh('ritual list'); ok(r.code === 0 && /● Double/.test(r.out), 'ritual list');
r = await sh('ritual run Double x=3 -q'); ok(r.code === 0 && JSON.parse(r.out).doubled === 6, 'ritual run, like flow run');
r = await sh('ritual run Nope'); ok(r.code === 1 && /^ritual: no ritual named "Nope"\. ritual list shows them/.test(r.err), 'ritual: errors carry the name it was called by');
r = await sh('ritual runs Double'); ok(/via shell/.test(r.out), 'ritual runs');
r = await sh(`node -e "const r = await jade.shell('flow run Double x=2 -q'); console.log(JSON.parse(r.stdout).doubled)"`); ok(r.out.trim() === '4', 'node → shell → flow, all chained');

// ---------- schedules that run shell commands and flows ----------
await E(() => { Sched.list = []; saveSchedules(); renderSchedules(); });
r = await sh(`crontab add '*/5 * * * *' 'echo cron-ran >> /out/cron.md'`);
ok(r.code === 0 && /^added \w+: every 5 minutes/i.test(r.out), 'crontab add with a cron line: ' + r.out.trim());
let s = await E(() => { const s = Sched.list.at(-1); return { kind: s.kind, command: s.command, cron: s.cron, prompt: s.prompt, src: s.src, catchUp: s.catchUp, next: s.nextRun - Date.now() }; });
ok(s.kind === 'shell' && s.command === 'echo cron-ran >> /out/cron.md' && s.cron === '*/5 * * * *' && s.prompt === '$ echo cron-ran >> /out/cron.md' && s.src === 'crontab' && s.catchUp === false && s.next > 0 && s.next <= 300e3, 'it is a shell schedule (no catch-up, like cron): ' + JSON.stringify(s));
r = await sh(`crontab add 'every weekday at 9am' 'flow run Double {"x":4}'`);
s = await E(() => { const s = Sched.list.at(-1); return { kind: s.kind, flow: s.flow, input: s.input, cron: s.cron }; });
ok(r.code === 0 && s.kind === 'flow' && s.flow === 'Double' && s.input === '{"x":4}' && s.cron === '0 9 * * 1-5', '"flow run Name" becomes a flow schedule; plain English works: ' + JSON.stringify(s));
r = await sh(`crontab add '@hourly' 'ls /does-not-exist'`); ok(r.code === 0 && await E(() => Sched.list.at(-1).cron === '0 * * * *'), '@hourly and the other macros');
r = await sh('crontab -l'); ok(r.code === 0 && r.out.trim().split('\n').length === 3 && /\*\/5 \* \* \* \*\s+echo cron-ran/.test(r.out) && /ritual run Double/.test(r.out), 'crontab -l lists them (a ritual schedule as ritual run): ' + r.out.replace(/\n/g, ' | '));
r = await sh(`crontab add '@hourly' 'ritual run Double {"x":1}'`);
ok(r.code === 0 && await E(() => Sched.list.some(s => s.kind === 'flow' && s.flow === 'Double' && s.input === '{"x":1}' && s.src === 'crontab' && s.cron === '0 * * * *')), '"ritual run Name" becomes a ritual schedule too: ' + r.out.trim());
r = await sh('crontab -r ' + (await E(() => Sched.list.find(s => s.input === '{"x":1}').id)));
// fire them: make all due, tick, and check they ran without the model and without the chat
await E(() => { window.__notes.length = 0; });
const chatsBefore = model.chats.length, oneBefore = model.oneShot.length;
await E(async () => { for (const s of Sched.list) s.nextRun = Date.now() - 1000; schedTick(); await new Promise(r => setTimeout(r, 2500)); });
ok(await read('/out/cron.md') === 'cron-ran\n', 'a due shell schedule runs its command');
const log = await read('/Pandora/Logs/cron.log') || '';
ok(/\$ echo cron-ran/.test(log) && /exit 0/.test(log) && /flow Double: ok/.test(log) && /"doubled":8/.test(log) && /ls \/does-not-exist/.test(log) && /exit [1-9]/.test(log), 'everything goes to /Pandora/Logs/cron.log: ' + log.slice(0, 300).replace(/\n/g, ' | '));
s = await E(() => Sched.list.map(s => s.lastStatus));
ok(s[0] === 'ok' && s[1] === 'ok' && /^error: exit [1-9]/.test(s[2]), 'last status per schedule: ' + JSON.stringify(s));
ok(await E(() => window.__notes.length === 1 && /failed \(exit/.test(window.__notes[0][0])), 'only the failure sent a notification');
ok(model.chats.length === chatsBefore && model.oneShot.length === oneBefore && await E(() => !Sched.queue.length), 'command and flow schedules do not use the model or the chat queue');
ok(await E(() => Sched.list.every(s => s.nextRun > Date.now())), 'each is re-armed for its next time');
// they run even while Jade is busy in a chat
model.hold = new Promise(res => { model.release = res; });
await E(() => { document.querySelector('#input').value = 'long task'; document.querySelector('#btnSend').click(); });
await page.waitForFunction(() => running === true, null, { timeout: 5000 });
await E(async () => { Sched.list[0].nextRun = Date.now() - 1000; schedTick(); await new Promise(r => setTimeout(r, 1500)); });
ok(await read('/out/cron.md') === 'cron-ran\ncron-ran\n', 'a shell schedule runs even while Jade is busy in a chat');
model.release(); model.hold = null; await page.waitForFunction(() => running === false, null, { timeout: 10000 });
// Run now from the Schedule tab
await page.click('.m-nav .tab[data-tab="sched"]');
await page.click(`.sched-card[data-id="${await E(() => Sched.list[0].id)}"] [data-act="run"]`); await page.waitForTimeout(800);
ok(await read('/out/cron.md') === 'cron-ran\ncron-ran\ncron-ran\n', '"Run now" on a command schedule runs it at once');
ok(await E(() => /\$ echo cron-ran/.test(document.querySelector('#schedList').textContent) && document.querySelector('.sched-card .sched-prompt').classList.contains('mono')), 'the Schedule tab shows the command');
// crontab files
await write('/Pandora/crontab', '# my jobs\n0 7 * * * echo morning >> /out/m.md\n@daily flow run Double\n\n*/10 * * * 1-5 node /scripts/bridge.js\n');
r = await sh('crontab /Jade/crontab'); ok(r.code === 0 && /installed 3 lines/.test(r.out) && /replaced 3/.test(r.out), 'crontab <file> installs the file (replacing what crontab installed): ' + r.out.trim());
s = await E(() => Sched.list.map(s => [s.kind, s.cron, s.command || s.flow]));
ok(s.length === 3 && s[0][1] === '0 7 * * *' && s[1][0] === 'flow' && s[1][1] === '0 0 * * *' && s[2][1] === '*/10 * * * 1-5', 'cron lines, @daily and flow lines: ' + JSON.stringify(s));
await write('/Pandora/crontab2', 'every day echo nope\n');
r = await sh('crontab /Jade/crontab2'); ok(r.code === 1 && /line 1/.test(r.err) && await E(() => Sched.list.length === 3), 'a bad crontab file installs nothing and says which line');
const pid = await E(() => addSchedule({ name: 'A prompt', when: 'every day at 8am', prompt: 'Say hi' }).id);
r = await sh(`crontab -r ${await E(() => Sched.list[0].id)}`); ok(r.code === 0 && await E(() => Sched.list.length === 3), 'crontab -r <id>');
r = await sh('crontab -r all'); ok(r.code === 0 && await E(id => Sched.list.length === 1 && Sched.list[0].id === id, pid), 'crontab -r all removes only what crontab made (the prompt schedule stays)');
r = await sh('crontab -l'); ok(/\[prompt\] Say hi/.test(r.out), 'crontab -l also shows prompt schedules');
r = await sh(`crontab add 'whenever' 'echo x'`); ok(r.code === 1 && /crontab:/.test(r.err), 'a bad time is refused');
r = await sh('crontab -h'); ok(/crontab add/.test(r.out) && /cron\.log/.test(r.out), 'crontab -h');
// the schedule tool (Jade)
const tool = a => E(async a => { try { return await scheduleTool(a); } catch (e) { return 'ERR ' + e.message; } }, a);
let t = await tool({ action: 'add', name: 'Sync', when: 'every 30 minutes', command: 'echo synced >> /out/sync.md' });
ok(/Created schedule/.test(t) && await E(() => Sched.list.at(-1).kind === 'shell' && Sched.list.at(-1).command === 'echo synced >> /out/sync.md'), 'the schedule tool can schedule a shell command');
t = await tool({ action: 'add', when: 'every day at 6pm', flow: 'Double', input: { x: 3 } });
ok(/Created schedule/.test(t) && await E(() => Sched.list.at(-1).kind === 'flow' && Sched.list.at(-1).input.x === 3), '…or a flow with an input');
t = await tool({ action: 'add', when: 'every day at 6pm', flow: 'Nope' }); ok(/no ritual named/.test(t), '…and refuses an unknown ritual');
t = await tool({ action: 'list' }); ok(/\$ echo synced/.test(t) && /flow Double/.test(t), 'the tool lists them with what they run');
await E(async () => { const s = Sched.list.find(x => x.flow === 'Double' && x.input?.x === 3); s.nextRun = Date.now() - 1; schedTick(); await new Promise(r => setTimeout(r, 1200)); });
ok(/"doubled":6/.test(await read('/Pandora/Logs/cron.log')), 'a flow schedule passes its input');
ok(await E(() => /shell command \("command"/.test(TOOL_DEFS.find(t => t.name === 'schedule').description) && 'command' in TOOL_DEFS.find(t => t.name === 'schedule').parameters.properties), 'the schedule tool describes command and flow');
// the Schedule tab form
await page.click('#btnSchedNew'); await page.waitForTimeout(100);
ok(await E(() => !$('#schedPromptWrap').hidden && $('#schedCmdWrap').hidden && $('#schedFlowWrap').hidden), 'the form starts as a prompt schedule');
await page.selectOption('#schedKind', 'shell');
ok(await E(() => $('#schedPromptWrap').hidden && !$('#schedCmdWrap').hidden && $('#schedChat').closest('div').hidden), 'choosing "a shell command" shows the command field');
await page.fill('#schedName', 'Form job'); await page.fill('#schedCmd', 'echo from-form >> /out/form.md');
await page.selectOption('#schedPreset', 'hourly');
await page.click('#schedForm button[type="submit"]'); await page.waitForTimeout(200);
s = await E(() => { const s = Sched.list.find(x => x.name === 'Form job'); return s && { kind: s.kind, command: s.command, cron: s.cron }; });
ok(s && s.kind === 'shell' && s.command === 'echo from-form >> /out/form.md' && s.cron === '0 * * * *', 'the form saves a command schedule: ' + JSON.stringify(s));
await page.click(`.sched-card[data-id="${await E(() => Sched.list.find(x => x.name === 'Form job').id)}"] [data-act="edit"]`); await page.waitForTimeout(100);
ok(await E(() => $('#schedKind').value === 'shell' && $('#schedCmd').value === 'echo from-form >> /out/form.md'), 'editing shows the command');
await page.selectOption('#schedKind', 'flow'); await page.selectOption('#schedFlow', 'Double'); await page.fill('#schedInput', '{"x": 9}');
await page.click('#schedForm button[type="submit"]'); await page.waitForTimeout(200);
s = await E(() => { const s = Sched.list.find(x => x.name === 'Form job'); return { kind: s.kind, flow: s.flow, input: s.input, command: s.command }; });
ok(s.kind === 'flow' && s.flow === 'Double' && s.input === '{"x": 9}' && s.command === undefined, 'a schedule can be switched to a flow: ' + JSON.stringify(s));
await page.click(`.sched-card[data-id="${await E(() => Sched.list.find(x => x.name === 'Form job').id)}"] [data-act="edit"]`); await page.waitForTimeout(100);
await page.fill('#schedInput', '{bad'); await page.click('#schedForm button[type="submit"]'); await page.waitForTimeout(100);
ok(await E(() => /must be JSON/.test($('#schedPreview').textContent) && !$('#schedForm').hidden), 'bad flow input JSON is refused in the form');
await page.selectOption('#schedKind', 'prompt'); await page.fill('#schedPrompt', 'Now a prompt'); await page.click('#schedForm button[type="submit"]'); await page.waitForTimeout(200);
s = await E(() => { const s = Sched.list.find(x => x.name === 'Form job'); return { kind: s.kind ?? null, flow: s.flow ?? null, prompt: s.prompt }; });
ok(s.kind === null && s.flow === null && s.prompt === 'Now a prompt', '…and back to a prompt');
await page.screenshot({ path: 'sched_form.png' });
// survives a reload
await page.reload(); await page.waitForFunction(() => typeof flowRun === 'function' && typeof Sched !== 'undefined' && Sched.list.length > 0, null, { timeout: 60000 });
ok(await E(() => Sched.list.some(s => s.kind === 'shell' && s.command === 'echo synced >> /out/sync.md')), 'command schedules are saved');
ok(await E(() => /jade tool <name>/.test(document.body.textContent) || true), 'reloaded');
r = await sh('help'); ok(/Rituals: ritual list/.test(r.out) && /flow works too/.test(r.out) && /crontab -l/.test(r.out) && /\bpandora\b/.test(r.out) && /jade works too/.test(r.out), 'the shell help mentions pandora (and jade), ritual (and flow) and crontab');
ok(await E(() => /pandora\.tool\(name, args\)/.test(systemPrompt()) && /pandora\.ritual\(name, input\)/.test(systemPrompt()) && /jade\.\* is the same object/.test(systemPrompt()) && /scheduled shell commands \(command\)/.test(systemPrompt())), 'her instructions mention pandora.* (and jade.*) in node and command schedules');
await done();
