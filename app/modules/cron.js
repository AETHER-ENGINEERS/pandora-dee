/* =====================================================================
   SCHEDULES THAT RUN SHELL COMMANDS OR FLOWS (+ crontab)
   A schedule runs one of: a prompt (Jade does it in a chat, as before), a shell command, or a flow.
   Command and flow schedules run on their own, without the model and without waiting for the chat.
   Their output goes to /Pandora/Logs/cron.log; a failure sends a notification.
   ===================================================================== */
const CRON_LOG = '/Pandora/Logs/cron.log';
const SchedBusy = new Set();
const schedIsJob = s => s && (s.kind === 'shell' || s.kind === 'flow');
const CRON_MACROS = { '@yearly': '0 0 1 1 *', '@annually': '0 0 1 1 *', '@monthly': '0 0 1 * *', '@weekly': '0 0 * * 0', '@daily': '0 0 * * *', '@midnight': '0 0 * * *', '@hourly': '0 * * * *' };
const cronMacro = w => CRON_MACROS[String(w || '').trim().toLowerCase()] || w;
function schedLabel(o) { return o.kind === 'shell' ? `$ ${o.command}` : `flow ${o.flow}${o.input != null && o.input !== '' ? ' ' + (typeof o.input === 'string' ? o.input : JSON.stringify(o.input)) : ''}`; }

// create a command or flow schedule (used by the Schedule tab, the schedule tool and crontab)
function addScheduleKind({ name, when, kind, command, flow, input = null, catchUp = false, enabled = true, src = '' }) {
  kind = kind || (command ? 'shell' : 'flow');
  if (kind === 'shell' && !String(command || '').trim()) throw new Error('the command is empty');
  if (kind === 'flow') { const f = flowFind(flow); if (!f) throw new Error(`no ritual named "${flow}". ritual list shows them`); flow = f.name; }
  const o = { kind, command: kind === 'shell' ? String(command).trim() : undefined, flow: kind === 'flow' ? flow : undefined, input };
  const s = addSchedule({ name: String(name || '').trim() || schedLabel(o).slice(0, 60), when: cronMacro(when), prompt: schedLabel(o), chat: 'new', catchUp, enabled });
  Object.assign(s, o, { src }); if (kind !== 'shell') delete s.command; if (kind !== 'flow') { delete s.flow; delete s.input; }
  saveSchedules(); renderSchedules(); return s;
}
function cronLog(s, why, text) {
  const t = new Date(); const pad = n => String(n).padStart(2, '0');
  const head = `[${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())} ${pad(t.getHours())}:${pad(t.getMinutes())}:${pad(t.getSeconds())}] #${s.id} ${s.name} (${why})`;
  let prev = ''; try { if (vfs.isFile(CRON_LOG)) prev = vfs.read(CRON_LOG); } catch {}
  let next = prev + head + '\n' + String(text || '').replace(/\s+$/, '').slice(0, 8000) + '\n\n';
  if (next.length > 200000) next = next.slice(next.length - 150000).replace(/^[^\n]*\n/, '');
  try { vfs.write(CRON_LOG, next, { mkdirs: true }); } catch {}
}
async function runScheduleKind(s, why = 'scheduled') {
  if (!Sched.list.includes(s) || SchedBusy.has(s.id)) return;
  SchedBusy.add(s.id); s.lastRun = Date.now(); s.lastStatus = 'running'; saveSchedules(); renderSchedules();
  try {
    if (s.kind === 'shell') {
      const r = await runShellLine(s.command, { timeoutMs: 300000, echo: 'cron' });
      s.lastStatus = r.code === 0 ? 'ok' : `error: exit ${r.code}`;
      cronLog(s, why, `$ ${s.command}\n${r.out}${r.err ? (r.out ? '\n' : '') + r.err : ''}\nexit ${r.code}`);
      if (r.code !== 0) schedNotify(`${s.name}: failed (exit ${r.code})`, redactSecrets((r.err || r.out).trim()).slice(-180));
    } else {
      let input = s.input; if (typeof input === 'string' && /^\s*[\[{]/.test(input)) { try { input = JSON.parse(input); } catch {} }
      const run = await flowRunByName(s.flow, input ?? { trigger: 'schedule', schedule: s.name }, { via: 'schedule' });
      s.lastStatus = run.status === 'ok' ? 'ok' : `error: ${run.error || run.status}`.slice(0, 160);
      cronLog(s, why, `flow ${s.flow}: ${run.status}${run.error ? ' · ' + run.error : ''}\n${typeof run.output === 'string' ? run.output : JSON.stringify(run.output ?? null)}`.slice(0, 4000));
      if (run.status !== 'ok') schedNotify(`${s.name}: flow failed`, String(run.error || '').slice(0, 180));
    }
  } catch (e) { s.lastStatus = 'error: ' + String(e.message || e).slice(0, 150); cronLog(s, why, 'error: ' + (e.message || e)); schedNotify(`${s.name}: failed`, String(e.message || e).slice(0, 180)); }
  finally { SchedBusy.delete(s.id); saveSchedules(); renderSchedules(); }
}

/* ---------- Schedule tab: "Run: a prompt / a shell command / a flow" ---------- */
function schedKindSync() {
  const k = $('#schedKind').value;
  $('#schedPromptWrap').hidden = k !== 'prompt'; $('#schedCmdWrap').hidden = k !== 'shell'; $('#schedFlowWrap').hidden = k !== 'flow'; $('#schedInputWrap').hidden = k !== 'flow';
  const chat = $('#schedChat')?.closest('div'); if (chat) chat.hidden = k !== 'prompt';
}
function schedKindFill(s) {
  const fl = flowList().filter(f => !f._bad);
  $('#schedFlow').innerHTML = fl.length ? fl.map(f => `<option value="${esc(f.name)}">${esc(f.name)}</option>`).join('') : '<option value="">(no flows yet: make one in the Flows tab)</option>';
  $('#schedKind').value = s?.kind || 'prompt';
  $('#schedCmd').value = s?.command || '';
  if (s?.flow) $('#schedFlow').value = s.flow;
  $('#schedInput').value = s?.input == null ? '' : typeof s.input === 'string' ? s.input : JSON.stringify(s.input);
  schedKindSync();
}
// returns true when it handled the form (a command or flow schedule)
function schedKindSubmit(vals) {
  const kind = $('#schedKind').value; const ed = Sched.editing;
  if (kind === 'prompt') { if (ed && schedIsJob(ed)) { delete ed.kind; delete ed.command; delete ed.flow; delete ed.input; } return false; }
  const o = { kind, command: $('#schedCmd').value.trim(), flow: $('#schedFlow').value, input: $('#schedInput').value.trim() || null };
  if (kind === 'shell' && !o.command) throw new Error('the command is empty');
  if (kind === 'flow' && !flowFind(o.flow)) throw new Error('pick a ritual');
  if (o.input) { try { JSON.parse(o.input); } catch { throw new Error('the flow input must be JSON (or leave it empty)'); } }
  if (ed) {
    Object.assign(ed, specFields(cronMacro(vals.when)), { name: (vals.name || schedLabel(o)).trim().slice(0, 60), prompt: schedLabel(o), catchUp: vals.catchUp, enabled: true }, o);
    if (kind !== 'shell') delete ed.command; if (kind !== 'flow') { delete ed.flow; delete ed.input; }
    delete ed.sessionId; scheduleNext(ed); saveSchedules(); renderSchedules(); toast('Schedule saved', 'ok');
  } else { addScheduleKind({ ...o, name: vals.name, when: vals.when, catchUp: vals.catchUp }); toast('Schedule created', 'ok'); }
  return true;
}
$('#schedKind').onchange = schedKindSync;

/* ---------- crontab ---------- */
const CRONTAB_HELP = `crontab — run shell commands (or rituals) on a schedule, while the app is open
  crontab -l                           list schedules (id, when, what)
  crontab add '<when>' '<command>'     e.g. crontab add '*/15 * * * *' 'node /scripts/sync.js'
                                       or   crontab add 'every weekday at 9am' 'ritual run Digest'
  crontab -r <id> | -r all             remove one, or every command schedule made by crontab
  crontab <file>                       install a crontab file (replaces the ones it installed before)
  crontab -e                           how to edit the file
Quote the time and the command, or the shell expands * and > before crontab sees them.
File lines: "m h dom mon dow command", "@daily command" (@hourly @weekly @monthly @yearly), # comments.
Output: ${CRON_LOG}. A failing command sends a notification. Times are local (${typeof TZ !== 'undefined' ? TZ : 'local time'}).
`;
const shq = a => /^[\w@%+=:,./-]+$/.test(a) ? a : !a.includes("'") ? `'${a}'` : `"${a.replace(/(["\\$`])/g, '\\$1')}"`;
function crontabLine(s) { const when = s.once ? 'once ' + clock(s.runAt) : s.cron; const what = s.kind === 'shell' ? s.command : s.kind === 'flow' ? `ritual run ${shq(s.flow)}${s.input ? ' ' + shq(typeof s.input === 'string' ? s.input : JSON.stringify(s.input)) : ''}` : `[prompt] ${s.prompt.replace(/\s+/g, ' ').slice(0, 80)}`; return `${s.id}  ${when.padEnd(16)} ${what}${s.enabled ? '' : '   # paused'}`; }
function parseCrontab(text) {
  const out = [], bad = [];
  String(text).split(/\r?\n/).forEach((line, i) => {
    const l = line.trim(); if (!l || l.startsWith('#')) return;
    let m = /^(@\w+)\s+(.+)$/.exec(l);
    if (m) { if (!CRON_MACROS[m[1].toLowerCase()]) { bad.push(`line ${i + 1}: unknown ${m[1]}`); return; } out.push({ when: CRON_MACROS[m[1].toLowerCase()], command: m[2] }); return; }
    m = /^(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(.+)$/.exec(l);
    if (m && m.slice(1, 6).every(f => /^[\d*\/,\-A-Za-z]+$/.test(f))) { out.push({ when: m.slice(1, 6).join(' '), command: m[6] }); return; }
    bad.push(`line ${i + 1}: expected "m h dom mon dow command" or "@daily command"`);
  });
  return { out, bad };
}
function crontabAdd(when, command, src = 'crontab') {
  const fm = /^(?:ritual|flow)\s+run\s+(?:'([^']+)'|"([^"]+)"|(\S+))(?:\s+([\s\S]+))?$/.exec(command.trim());
  if (fm && flowFind(fm[1] || fm[2] || fm[3])) { let input = fm[4] ? fm[4].trim().replace(/^'([\s\S]*)'$/, '$1') : null; return addScheduleKind({ kind: 'flow', flow: fm[1] || fm[2] || fm[3], input, when, src }); }
  return addScheduleKind({ kind: 'shell', command, when, src });
}
async function crontabShell(c) {
  const a = c.argv;
  try {
    if (!a.length || a[0] === '-h' || a[0] === '--help' || a[0] === 'help') { c.o(CRONTAB_HELP); return 0; }
    if (a[0] === '-l' || a[0] === 'list') { if (!Sched.list.length) { c.o('no schedules\n'); return 0; } for (const s of Sched.list) c.o(crontabLine(s) + '\n'); return 0; }
    if (a[0] === '-e') { c.o(`Edit a file (for example /Pandora/crontab) with lines like\n  */15 * * * * node /scripts/sync.js >> /Pandora/Logs/sync.log\n  @daily ritual run Digest\nthen install it: crontab /Pandora/crontab\n`); return 0; }
    if (a[0] === '-r' || a[0] === 'rm' || a[0] === 'remove') {
      const id = String(a[1] || '').replace(/^#/, ''); if (!id) throw new Error('usage: crontab -r <id> | -r all');
      const gone = id === 'all' ? Sched.list.filter(s => s.src === 'crontab') : Sched.list.filter(s => s.id === id);
      if (!gone.length) throw new Error(id === 'all' ? 'no schedules were made by crontab' : `no schedule with id ${id} (crontab -l)`);
      Sched.list = Sched.list.filter(s => !gone.includes(s)); Sched.queue = Sched.queue.filter(j => !gone.includes(j.s)); saveSchedules(); renderSchedules();
      c.o(`removed ${gone.length}\n`); return 0;
    }
    if (a[0] === 'add') {
      if (a.length < 3) throw new Error(`usage: crontab add '<when>' '<command>'`);
      const command = a.length === 3 ? a[2] : a.slice(2).map(shq).join(' ');
      const s = crontabAdd(a[1], command);
      c.o(`added ${s.id}: ${schedWhen(s)} · next ${s.nextRun ? clock(s.nextRun) : 'never'} → ${s.prompt}\n`); return 0;
    }
    if (a.length === 1) {
      const p = c.P(a[0]); if (!vfs.isFile(p)) throw new Error(`${a[0]}: no such file. crontab -h for help`);
      const { out, bad } = parseCrontab(vfs.read(p)); if (bad.length) throw new Error('nothing installed:\n  ' + bad.join('\n  '));
      const keep = Sched.list.filter(s => s.src !== 'crontab'); const old = Sched.list.length - keep.length;
      const prev = Sched.list; Sched.list = keep;
      try { for (const l of out) crontabAdd(l.when, l.command); }
      catch (e) { Sched.list = prev; saveSchedules(); renderSchedules(); throw e; }
      c.o(`installed ${out.length} line${out.length === 1 ? '' : 's'} from ${p}${old ? ` (replaced ${old})` : ''}\n`); return 0;
    }
    throw new Error('unknown option. crontab -h for help');
  } catch (e) { c.e(`crontab: ${e.message}\n`); return 1; }
}
