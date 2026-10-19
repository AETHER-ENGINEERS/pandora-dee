/* =====================================================================
   APPS → JADE: an update whose notify field names jade@jade.vault (webxdc's own way of saying
   "this is for you") starts a turn for Jade in that app's own chat. She answers with the apps
   tool. While she works the app gets live status ({"jade":"thinking"|"idle"|"error"}) on its
   realtime channel. Turn it off per app in the Apps tab (⋯ menu).
   ===================================================================== */
// go back to the chat the user was in (an unsaved new chat is not in the list, so put the object back)
async function restoreChat(prev) {
  if (!prev || prev === cur) return;
  saveSession.flush?.();
  if (sessions.some(x => x.id === prev.id)) { await openSession(prev.id); return; }
  if (cur?.messages?.length) journalSession(cur);
  cur = prev; tasks.items = prev.tasks || []; tasks.seq = prev.taskSeq || 0; renderTasks(); renderChat(); renderSessions(); ls.set('lastSession', prev.id);
}
const XWAKE = { q: [], busy: false, cur: null };
function xdcRealtime(appId, obj) { const s = XDC.session; if (s && s.app.id === appId && s.rt) s.post({ t: 'realtime', data: Array.from(new TextEncoder().encode(JSON.stringify(obj))) }); }
XDC.listeners.add(async (app, u) => {
  if (u.sender === XDC_JADE.addr) return;
  const n = u.notify; const txt = n && typeof n === 'object' ? (n[XDC_JADE.addr] ?? null) : null; if (txt == null) return;
  const full = await XdcDB.app(app.id); if (!full || full.jadeWake === false) return;
  XWAKE.q.push({ appId: app.id, serial: u.serial }); xdcPump();
});
async function xdcPump() {
  if (XWAKE.busy || !XWAKE.q.length) return;
  if (running || compacting) { setTimeout(xdcPump, 1500); return; }
  XWAKE.busy = true; const appId = XWAKE.q[0].appId; XWAKE.cur = appId;
  const batch = XWAKE.q.filter(x => x.appId === appId); XWAKE.q = XWAKE.q.filter(x => x.appId !== appId);
  try { await xdcWakeJade(appId, batch); }
  catch (e) { console.warn(e); xdcRealtime(appId, { jade: 'error', text: String(e.message || e).slice(0, 80) }); }
  finally { XWAKE.busy = false; XWAKE.cur = null; if (XWAKE.q.length) setTimeout(xdcPump, 300); }
}
async function xdcWakeJade(appId, batch) {
  const app = await XdcDB.app(appId); if (!app) return;
  const min = Math.min(...batch.map(b => b.serial));
  const ups = (await XdcDB.updates(appId, min - 1)).filter(u => batch.some(b => b.serial === u.serial)); if (!ups.length) return;
  if (!S.model) { xdcRealtime(appId, { jade: 'error', text: 'no model picked in Jade Vault' }); toast(`${esc(app.name)} wants Pandora, but no model is picked (Config).`, 'err'); return; }
  xdcRealtime(appId, { jade: 'thinking' });
  const prevCur = cur, prevId = cur?.id; const screen = document.body.dataset.screen || 'chat';
  if (app.jadeSession && sessions.some(x => x.id === app.jadeSession)) { if (cur?.id !== app.jadeSession) await openSession(app.jadeSession); }
  else { newSession(); cur.title = `📱 ${app.name}`; cur._named = true; app.jadeSession = cur.id; await XdcDB.putApp(app); renderSessions?.(); }
  const first = !cur.messages.length;
  const readme = first && app.files['README.md'] ? dec.decode(app.files['README.md']).slice(0, 4000) : '';
  const who = a => a === XDC_USER().addr ? 'the user' : a;
  const prompt = `[webxdc app "${app.name}" · ${ups.length > 1 ? ups.length + ' new updates' : 'update #' + ups[0].serial} for you]\n` +
    ups.map(u => `#${u.serial} from ${who(u.sender)}${u.notify?.[XDC_JADE.addr] ? ` (to you: "${String(u.notify[XDC_JADE.addr]).slice(0, 300)}")` : ''}\npayload: ${JSON.stringify(u.payload)}`).join('\n') +
    `\n\nThe user is in the app, so answer there: call apps with action="send", app="${app.name}" and a payload in the app's format. ${readme ? `The app's README (its protocol):\n${readme}` : 'Its protocol: apps action="source" file="README.md", or read its recent updates.'}\nAfter sending, reply here with one short line.`;
  const before = cur.messages.length; const stash = ATT.pending.splice(0);
  try { await send(prompt); } finally { ATT.pending.push(...stash); }
  const fresh = cur.messages.slice(before);
  const err = fresh.find(m => m._error);
  const sent = fresh.some(m => m.role === 'tool' && m.tool_name === 'apps' && /^Sent update/.test(String(m.content)));
  if (!sent && !err && app.manifest?.jade_reply === 'msg') {
    // the model answered in chat instead of the app: deliver that answer as a message so the user is not left waiting
    const last = [...fresh].reverse().find(m => m.role === 'assistant' && String(m.content || '').trim());
    if (last) await xdcSendUpdate(app, { payload: { type: 'msg', text: String(last.content).replace(/<think>[\s\S]*?<\/think>/g, '').trim() } }, XDC_JADE);
  }
  xdcRealtime(appId, err ? { jade: 'error', text: String(err._error).slice(0, 80) } : { jade: 'idle' });
  await restoreChat(prevCur);
  if (document.body.dataset.screen !== screen) setTab(screen);   // opening a chat jumps to Chat: put the user back where they were
  if (XDC.session?.app.id !== appId && !err) toast(`Pandora answered in ${esc(app.name)}`, 'ok');
}
// built-in app: Jade Link (messenger + shared board), installed on first run and kept up to date
const JADELINK_VER = 1;
async function seedJadeLink() {
  const el = document.getElementById('xdc-jadelink'); if (!el) return;
  if ((+ls.get('jadeLinkVer', 0)) >= JADELINK_VER && (await XdcDB.apps()).some(a => a.origin === 'builtin')) return;
  try {
    const bytes = Uint8Array.from(atob(el.textContent.replace(/\s+/g, '')), c => c.charCodeAt(0));
    await xdcInstallBytes(bytes, { origin: 'builtin', name: 'Jade Link' }); ls.set('jadeLinkVer', JADELINK_VER);
  } catch (e) { console.warn('Jade Link not installed', e); }
}
setTimeout(() => seedJadeLink(), 1500);
