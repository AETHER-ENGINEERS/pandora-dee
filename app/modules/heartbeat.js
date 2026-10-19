/* =====================================================================
   HEARTBEAT (Moltbot-style)
   Every N minutes inside active hours, Jade wakes up, reads /Pandora/HEARTBEAT.md and acts on it.
   If nothing needs attention she answers HEARTBEAT_OK: that run is silent and pruned from the chat.
   Anything else is an alert: kept in the Heartbeat chat and sent as a notification.
   An effectively empty HEARTBEAT.md (only comments, headings, blank lines or empty checkboxes)
   skips the run without calling the model. It can use its own provider/model.
   ===================================================================== */
const HB_PATH = '/Pandora/HEARTBEAT.md';
const HB_DEFAULT_PROMPT = 'Read HEARTBEAT.md (below). Follow it strictly. Do not infer or repeat old tasks from prior chats. Use your tools to check what it asks. If nothing needs attention, reply HEARTBEAT_OK.';
const HB_SEED = `# HEARTBEAT

<!-- Jade reads this on every heartbeat (Config → Heartbeat; every 30 minutes by default, only while
     the app is open and inside your active hours). Keep it short: a checklist of things to look at.
     If nothing needs attention she replies HEARTBEAT_OK and you never see it; otherwise you get a
     notification and the details land in the "♥ Heartbeat" chat.
     While this file has only comments, headings and empty boxes, heartbeats are skipped for free.

     Examples (copy them below the heading and adapt):
     - If /Inbox.md has more than 5 items, remind me to sort it.
     - After 17:00, list unchecked tasks in today's daily note.
     - Notes tagged #waiting: tell me about any older than a week.
     - If my Memory mentions a deadline in the next 2 days, remind me. -->

## Check
- [ ]
`;
function ensureHeartbeatFile() { if (!vfs.exists(HB_PATH) && !ls.get('hbSeeded', false)) { vfs.write(HB_PATH, HB_SEED, { mkdirs: true }); } ls.set('hbSeeded', true); }
function heartbeatBody() {
  if (!vfs.isFile(HB_PATH)) return '';
  return stripComments(vfs.read(HB_PATH)).split('\n').filter(l => {
    const t = l.trim();
    return t && !/^#{1,6}(\s|$)/.test(t) && !/^(```|~~~)/.test(t) && !/^[-*+]\s*(\[[ xX]?\])?\s*$/.test(t) && !/^---+$/.test(t);
  }).length ? stripComments(vfs.read(HB_PATH)) : '';
}
const HB = { last: ls.get('hbLast', 0), status: ls.get('hbStatus', ''), running: false, lastActive: Date.now() };
for (const ev of ['pointerdown', 'keydown']) addEventListener(ev, () => { HB.lastActive = Date.now(); }, { passive: true, capture: true });
const hmToMin = s => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '').trim()); return m ? +m[1] * 60 + +m[2] : null; };
function inActiveHours(d = new Date()) {
  const a = hmToMin(S.hbStart), b = hmToMin(S.hbEnd); if (a == null || b == null) return true;
  if (a === b) return false; const n = d.getHours() * 60 + d.getMinutes();
  return a < b ? n >= a && n < b : n >= a || n < b;           // windows may cross midnight
}
const hbEveryMs = () => Math.max(1, +S.hbEvery || 30) * 60000;
function hbSetStatus(s) { HB.status = s; ls.set('hbStatus', s); renderHbStatus(); }
function renderHbStatus() {
  const el = $('#hbStatus'); if (!el) return;
  const next = HB.last ? HB.last + hbEveryMs() : Date.now();
  el.textContent = !S.hbOn ? 'Off' : `${HB.last ? `Last ${clock(HB.last)}: ${HB.status || '—'}` : 'Not run yet'} · next ${inActiveHours(new Date(next)) ? clock(Math.max(next, Date.now())) : 'when active hours start'}${heartbeatBody() ? '' : ' · HEARTBEAT.md is empty, so it will skip'}`;
}
// run fn with another provider/model, restoring the chat model afterwards
async function withModel(prov, model, fn) {
  if (!prov || !model || providerMissing(prov)) return fn();
  const saved = { client, activeProv, model: S.model, models };
  try { if (prov !== activeProv) { client = makeClientFor(prov); activeProv = prov; } S.model = model; window.__modelOverride = true; return await fn(); }
  finally { client = saved.client; activeProv = saved.activeProv; S.model = saved.model; models = saved.models; window.__modelOverride = false; fillModelSelects(); }
}
const hbIsAck = (text) => {
  const t = String(text || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  const m = /^\**(HEARTBEAT_OK|NO_REPLY)\**[\s.!:]*|[\s.!:]*\**(HEARTBEAT_OK|NO_REPLY)\**[.!]?$/i.exec(t);
  if (!t) return true; if (!m) return false;
  return t.replace(m[0], '').trim().length <= 300;
};
async function runHeartbeat({ manual = false } = {}) {
  if (HB.running) return;
  const body = heartbeatBody();
  if (!body) { HB.last = Date.now(); ls.set('hbLast', HB.last); hbSetStatus('skipped (HEARTBEAT.md is empty)'); if (manual) toast('HEARTBEAT.md has nothing to check yet. Add a line under “Check”.'); return; }
  if (!S.model && !(S.hbProv && S.hbModel)) { hbSetStatus('skipped: no model connected'); return; }
  HB.running = true; HB.last = Date.now(); ls.set('hbLast', HB.last); hbSetStatus('running…');
  const prevCur = cur; const reuse = S.hbChat === 'current' && cur;
  try {
    if (!reuse) {
      const hbId = ls.get('hbSession', null);
      if (hbId && sessions.some(x => x.id === hbId)) { if (cur?.id !== hbId) await openSession(hbId); }
      else { newSession(); cur.title = '♥ Heartbeat'; cur._named = true; cur._hb = true; ls.set('hbSession', cur.id); }
      cur._hb = true;
    }
    const before = cur.messages.length;
    const prompt = `[Heartbeat · ${new Date().toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}]\n${S.hbPrompt?.trim() || HB_DEFAULT_PROMPT}\n\nHEARTBEAT.md:\n${body}`;
    if (!cur.messages.length) chatEl.innerHTML = '';
    cur.messages.push({ role: 'user', content: prompt, display: '♥ Heartbeat check', _hb: true });
    chatEl.appendChild(userBlock('♥ Heartbeat check', cur.messages.length - 1)); saveSession();
    await withModel(S.hbProv, S.hbModel || S.modelBy?.[S.hbProv], () => agentLoop());
    const fresh = cur.messages.slice(before);
    const err = fresh.find(m => m._error); const tools = fresh.filter(m => m.role === 'tool').length;
    const reply = [...fresh].reverse().find(m => m.role === 'assistant' && m.content?.trim())?.content || '';
    if (err) { hbSetStatus('error: ' + String(err._error).slice(0, 90)); }
    else if (hbIsAck(reply)) {
      cur.messages.length = before; saveSession();                 // silent: prune the OK run
      hbSetStatus(`OK${tools ? ` (${tools} check${tools > 1 ? 's' : ''})` : ''}`);
      if (!reuse && prevCur && prevCur !== cur) {               // back to the chat you were in (it may not be saved yet)
        cur = prevCur; tasks.items = cur.tasks || []; tasks.seq = cur.taskSeq || 0; ls.set('lastSession', cur.id);
        renderTasks(); renderChat(); renderSessions();
      } else renderChat();
      if (manual) toast('Heartbeat: nothing needs attention (HEARTBEAT_OK)', 'ok');
    } else {
      const clean = reply.replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g, (m, a, b) => b || a).replace(/[`*#_>$]/g, '').replace(/\s+/g, ' ').trim();
      hbSetStatus('alert: ' + clean.slice(0, 80));
      schedNotify('♥ Pandora', clean.slice(0, 200)); toast('♥ Heartbeat: ' + esc(clean.slice(0, 140)), 'ok');
      if (Jade.ready) jadeBubble(clean.slice(0, 160), 'Pandora', 8000);
    }
  } catch (e) { hbSetStatus('error: ' + (e.message || e)); }
  finally { HB.running = false; renderSessions(); renderHbStatus(); }
}
function hbTick() {
  renderHbStatus();
  if (!S.hbOn || HB.running || running || Sched.draining || (typeof compacting !== 'undefined' && compacting)) return;
  if (Date.now() - HB.last < hbEveryMs() || !inActiveHours()) return;
  // don't yank the screen away from someone who is typing or tapping right now
  if (!document.hidden && (Date.now() - HB.lastActive < 90000 || input.value.trim() || document.activeElement === input || !$('#settings').hidden)) return;
  runHeartbeat();
}
setInterval(hbTick, 30000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) setTimeout(hbTick, 2000); });

/* ---------- shared provider+model picker (compaction model and heartbeat model) ---------- */
async function fillModelPicker(provEl, modelEl, wrapEl, scan) {
  const p = provEl.value; wrapEl.hidden = !p; if (!p) return;
  let list = p === activeProv ? models : [];
  if (scan || !list.length) {
    modelEl.innerHTML = '<option value="">scanning…</option>';
    try { list = (await tryProvider(p, formCfg())).models; } catch (e) { modelEl.innerHTML = `<option value="">${esc(String(e.message || e).slice(0, 60))}</option>`; return; }
  }
  const want = modelEl.dataset.want || S.modelBy?.[p] || '';
  modelEl.innerHTML = list.map(m => `<option ${m === want ? 'selected' : ''}>${esc(m)}</option>`).join('') || '<option value="">no models</option>';
  if (!list.includes(want)) { const small = list.find(m => /8b|7b|mini|small|instant|flash|3b|4b|e2b|e4b/i.test(m)); if (small) modelEl.value = small; }
}
$('#sHbProv').onchange = () => { $('#sHbModel').dataset.want = ''; fillModelPicker($('#sHbProv'), $('#sHbModel'), $('#sHbModelWrap'), true); };
$('#btnHbScan').onclick = () => fillModelPicker($('#sHbProv'), $('#sHbModel'), $('#sHbModelWrap'), true);
$('#btnHbEdit').onclick = () => { closeSettings(); ensureHeartbeatFile(); if (!vfs.isFile(HB_PATH)) vfs.write(HB_PATH, HB_SEED, { mkdirs: true }); openFile(HB_PATH, { mode: 'edit' }); };
$('#btnHbRun').onclick = () => { closeSettings(); setTab('chat'); runHeartbeat({ manual: true }); };
function renderHbSettings() {
  $('#sHbOn').checked = !!S.hbOn; $('#sHbEvery').value = S.hbEvery || 30; $('#sHbStart').value = S.hbStart || ''; $('#sHbEnd').value = S.hbEnd || '';
  $('#sHbChat').value = S.hbChat || 'own'; $('#sHbPrompt').value = S.hbPrompt || ''; $('#sHbPrompt').placeholder = HB_DEFAULT_PROMPT;
  $('#sHbProv').value = S.hbProv || ''; $('#sHbModel').dataset.want = S.hbModel || ''; fillModelPicker($('#sHbProv'), $('#sHbModel'), $('#sHbModelWrap'), false);
  renderHbStatus();
}
function readHbSettings() {
  const wasOn = S.hbOn;
  Object.assign(S, { hbOn: $('#sHbOn').checked, hbEvery: Math.max(1, Math.round(+$('#sHbEvery').value || 30)), hbStart: $('#sHbStart').value, hbEnd: $('#sHbEnd').value,
    hbChat: $('#sHbChat').value, hbPrompt: $('#sHbPrompt').value.trim(), hbProv: $('#sHbProv').value, hbModel: $('#sHbProv').value ? $('#sHbModel').value : '' });
  if (S.hbOn && !wasOn) { HB.last = Date.now(); ls.set('hbLast', HB.last); hbSetStatus('armed'); ensureHeartbeatFile(); }
}
