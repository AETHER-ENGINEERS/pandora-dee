# ---------- reading another chat while a turn runs (filed by Pandora Dee Fae against 2.10.4) ----------
# Exec'd by build.py after bridge_rooms.py, on the finished page. Every turn (yours, and Vector, Discord, the heartbeat
# and curiosity, which borrow the current chat) writes to `cur` and draws into #chat, so the chat list ignored clicks
# while one ran, and with the bridges on that's often. Now a click opens the chat to read in its own pane, #chatPeek,
# while the running turn keeps drawing into #chat, hidden. What you send there waits, and once the turn ends that
# chat opens for real and gets it. "Back" returns to the running chat and puts anything unsent back in the box.
# The turn itself is untouched: running more than one chat at once is a separate piece of work.

rep('      <div id="chat" class="flex-1 overflow-y-auto min-h-0 flex flex-col"></div>',
    '      <div id="chat" class="flex-1 overflow-y-auto min-h-0 flex flex-col"></div>\n'
    '      <div id="chatPeek" class="flex-1 overflow-y-auto min-h-0 flex flex-col" hidden></div>')

rep(".sess:hover{background:rgba(31,229,165,.05)}",
    ".sess:hover{background:rgba(31,229,165,.05)} .sess.busy::after{content:' ●';color:var(--rd)}"
    " .peek-bar{position:sticky;top:0;z-index:2;display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:8px 12px;margin-bottom:8px;"
    "background:rgba(10,20,18,.92);border-bottom:1px solid rgba(31,229,165,.25);font-size:13px;color:#c2d6ce}"
    " .peek-wait{opacity:.6} #chatPeek button:not([data-peek-back]){display:none}")

PEEK_JS = r"""
/* ---- reading another chat while a turn runs (chat_peek.py) ---- */
// var, not const: the chat list and openSession look at it, and either may run before this line does at startup
var PEEK = { id: null, title: '', queue: [] };
function peekBar() {
  const n = PEEK.queue.length, busy = cur ? esc(cur.title || 'a chat') : 'a chat';
  return `<div class="peek-bar"><span style="flex:1;min-width:12em">A turn is running in “${busy}”. This chat opens when it's done${n ? `, and ${n === 1 ? 'your message' : n + ' messages'} go${n === 1 ? 'es' : ''} in then` : '; anything you send here waits until then'}.</span><button type="button" class="btn btn-ghost" data-peek-back>Back to “${busy}”</button></div>`;
}
async function peekSession(id) {
  if (!id || id === cur?.id) return endPeek();
  const s = await idb.get('session:' + id); if (!s) { toast('That chat has nothing saved yet.', 'err'); return; }
  if (!running) { endPeek(); return openSession(id); }
  if (PEEK.id !== id) { peekUnsend(); PEEK.queue = []; }
  PEEK.id = id; PEEK.title = s.title || 'chat';
  // renderChat draws `cur` into #chat. It runs without pausing, so for that moment it can draw this chat instead:
  // the running turn's nodes are set aside and put back untouched, and the turn never sees the swap.
  const live = document.createDocumentFragment(); while (chatEl.firstChild) live.appendChild(chatEl.firstChild);
  const top = chatEl.scrollTop, keep = cur, el = $('#chatPeek');
  try { cur = s; renderChat(); } finally { cur = keep; }
  el.innerHTML = peekBar(); while (chatEl.firstChild) el.appendChild(chatEl.firstChild);
  for (const t of PEEK.queue) { const u = userBlock(t, -1); u.classList.add('peek-wait'); el.appendChild(u); }
  chatEl.appendChild(live); chatEl.scrollTop = top;
  chatEl.hidden = true; el.hidden = false; el.scrollTop = el.scrollHeight;
  renderSessions(); setView('chat');
}
// "Back", or the chat it was reading went away: anything not sent yet goes back in the box, so nothing is lost
function peekUnsend() {
  if (!PEEK.queue.length) return; const t = PEEK.queue.splice(0).join('\n\n');
  input.value = input.value.trim() ? t + '\n\n' + input.value : t; autosize?.();
}
function endPeek(keepQueue) {
  if (!PEEK.id) return; if (!keepQueue) peekUnsend();
  PEEK.id = null; const el = $('#chatPeek'); el.hidden = true; el.innerHTML = ''; chatEl.hidden = false; scrollDown(true); renderSessions();
}
function peekQueue(text) {
  PEEK.queue.push(text); const el = $('#chatPeek');
  const u = userBlock(text, -1); u.classList.add('peek-wait'); el.appendChild(u); el.querySelector('.peek-bar').outerHTML = peekBar(); el.scrollTop = el.scrollHeight;
}
// once nothing runs (and a bridge has put its chat back), the chat being read opens and gets what was sent to it
function peekSettle() {
  if (!PEEK.id) return;
  setTimeout(async () => {
    if (running || !PEEK.id) return;
    const id = PEEK.id, q = PEEK.queue.splice(0); endPeek(true);
    await openSession(id);
    if (q.length && !running) send(q.join('\n\n')); else if (q.length) { queue.push(...q); updateQueueNote(); }
  }, 60);
}
$('#chatPeek').addEventListener('click', e => { if (e.target.closest('[data-peek-back]')) endPeek(); });
Object.assign(window, { PEEK, peekSession, endPeek });
"""
rep("/* =====================================================================\n   BOOT", PEEK_JS + "/* =====================================================================\n   BOOT")

# a click while a turn runs reads the chat instead of doing nothing
rep("  const b = e.target.closest('.sess'); if (b && !running) openSession(b.dataset.id);",
    "  const b = e.target.closest('.sess'); if (!b) return; if (running) peekSession(b.dataset.id); else { endPeek(); openSession(b.dataset.id); }")

# what's typed while reading another chat is for that chat
rep("  if (running) { queue.push(text); updateQueueNote(); return; }\n  // (starting now",
    "  if (running && PEEK.id) { peekQueue(text); return; }\n"
    "  if (running) { queue.push(text); updateQueueNote(); return; }\n  // (starting now")

# the turn ended: open the chat being read
rep("  if (!v) { setState('IDLE'); scheduleJournal(); bgFinished(); }",
    "  if (!v) { setState('IDLE'); scheduleJournal(); bgFinished(); peekSettle(); }")

# the list marks the chat being read, and the one the turn is running in
rep("  renderChatBar();\n}\n$('#sessList').addEventListener('click', e => {",
    "  if (PEEK?.id) $$('#sessList .sess').forEach(x => { const on = x.dataset.id === PEEK.id; x.classList.toggle('on', on); x.classList.toggle('busy', !!cur && x.dataset.id === cur.id); });\n"
    "  renderChatBar();\n}\n$('#sessList').addEventListener('click', e => {")

# opening a chat any other way, or deleting the one being read, ends the reading
rep("async function openSession(id) { if (cur?.id !== id) saveSession.flush?.();",
    "async function openSession(id) { if (PEEK?.id && PEEK.id !== id) endPeek(); if (cur?.id !== id) saveSession.flush?.();")
rep("  saveSession.drop(id); await idb.del('session:' + id);",
    "  if (PEEK?.id === id) endPeek(); saveSession.drop(id); await idb.del('session:' + id);")
