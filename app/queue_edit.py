# ---------- a queued message can be taken back and fixed before it's delivered ----------
# Exec'd by build.py last. A message sent while she's on a tool run waits in the queue and steers the next round, and
# until now there was no way to fix a typo in it: the note only said how many were waiting. Now the note lists them,
# each with Edit and ✕. Edit takes the message out of the queue and back into the message box (in front of anything
# already typed there), so a half-fixed message is never delivered; send it again and it's queued again (or sent, if
# the turn has ended meanwhile). ✕ drops it. With the box empty, the Up arrow takes back the last queued message.
rep("function updateQueueNote() { const n = $('#queueNote'); n.hidden = !queue.length; n.textContent = `QUEUED ▸ ${queue.length} message${queue.length > 1 ? 's' : ''} will be delivered after the current tool round`; }",
    """function updateQueueNote() {
  const n = $('#queueNote'); n.hidden = !queue.length;
  if (!queue.length) { n.replaceChildren(); return; }
  const head = document.createElement('div'); head.textContent = `QUEUED ▸ ${queue.length} message${queue.length > 1 ? 's' : ''} will be delivered after the current tool round`;
  n.replaceChildren(head, ...queue.map((t, i) => {
    const row = document.createElement('div'); row.className = 'queued-msg'; row.dataset.q = i;
    const tx = document.createElement('span'); tx.className = 'queued-text'; tx.textContent = t.replace(/\\s+/g, ' '); tx.title = t;
    const ed = document.createElement('button'); ed.type = 'button'; ed.className = 'queued-btn'; ed.dataset.qact = 'edit'; ed.textContent = 'Edit'; ed.title = 'Take it back into the message box to fix it';
    const rm = document.createElement('button'); rm.type = 'button'; rm.className = 'queued-btn'; rm.dataset.qact = 'drop'; rm.textContent = '✕'; rm.title = 'Remove it from the queue'; rm.setAttribute('aria-label', 'Remove queued message');
    row.append(tx, ed, rm); return row;
  }));
}
// Take queued message i back into the message box (out of the queue, so it can't be delivered half-fixed).
function editQueued(i) {
  if (!(i >= 0 && i < queue.length)) return false;
  const [t] = queue.splice(i, 1); updateQueueNote();
  const el = $('#input'); el.value = el.value.trim() ? t + '\\n' + el.value : t;
  el.dispatchEvent(new Event('input')); el.focus(); try { el.setSelectionRange(t.length, t.length); } catch {}
  return true;
}
function dropQueued(i) { if (!(i >= 0 && i < queue.length)) return false; queue.splice(i, 1); updateQueueNote(); return true; }""")
rep("const input = $('#input');\n",
    "const input = $('#input');\n"
    "$('#queueNote').addEventListener('click', e => { const b = e.target.closest('[data-qact]'); if (!b) return; const i = +b.closest('[data-q]').dataset.q; if (b.dataset.qact === 'edit') editQueued(i); else dropQueued(i); });\n"
    "// Up arrow in an empty box takes back the last queued message\n"
    "input.addEventListener('keydown', e => { if (e.key === 'ArrowUp' && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey && !input.value && queue.length) { e.preventDefault(); editQueued(queue.length - 1); } });\n")
rep(".hint{font-family:var(--f-mono);font-size:11px;color:#5d756c}",
    ".hint{font-family:var(--f-mono);font-size:11px;color:#5d756c}\n"
    ".queued-msg{display:flex;align-items:center;gap:6px;margin-top:3px}.queued-text{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#c2d6ce}\n"
    ".queued-btn{flex:none;font:inherit;padding:1px 7px;border:1px solid #1a2d27;border-radius:3px;color:#ffb8c6;background:transparent;cursor:pointer}.queued-btn:hover,.queued-btn:focus-visible{border-color:#ffb8c6}")
rep("/* =====================================================================\n   BOOT", "Object.assign(window, { editQueued, dropQueued, updateQueueNote });   // for tests/queue_edit_test.mjs\n/* =====================================================================\n   BOOT")
