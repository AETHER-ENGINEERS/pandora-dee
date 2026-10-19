/* =====================================================================
   REPLY BAR — under each of Jade's replies: Copy · 👍 · 👎 · Retry
   Copy takes everything she said in that turn (Markdown, without thinking or tool output).
   👍 / 👎 rate the reply (kept with the chat; also used by the trajectory log when it is on).
   Retry is on the latest reply only: it runs your last message again and replaces her answer.
   ===================================================================== */
// is message i the last assistant message of its turn?
function replyTurnEnd(msgs, i) { for (let j = i + 1; j < msgs.length; j++) { if (msgs[j].role === 'tool') continue; return msgs[j].role !== 'assistant'; } return true; }
// the turn around assistant message m: [index of the user message that started it, index of its last message]
function replyTurn(m) {
  const msgs = cur?.messages || []; const k = msgs.indexOf(m); if (k < 0) return null;
  let u = k; while (u >= 0 && msgs[u].role !== 'user') u--;
  let e = k; while (e + 1 < msgs.length && msgs[e + 1].role !== 'user' && msgs[e + 1].role !== 'compaction') e++;
  return { user: u, end: e };
}
function replyText(m) {
  const t = replyTurn(m); if (!t) return String(m?.content || '');
  return cur.messages.slice(t.user + 1, t.end + 1).filter(x => x.role === 'assistant' && String(x.content || '').trim())
    .map(x => String(x.content).replace(/<think>[\s\S]*?<\/think>/g, '').trim()).filter(Boolean).join('\n\n');
}
function replyBar(m) {
  const d = document.createElement('div'); d.className = 'rate-bar reply-bar';
  d.innerHTML = `<button type="button" data-ract="copy" title="Copy what Pandora said (Markdown)">Copy</button><button type="button" data-rate="1" title="Good reply">👍</button><button type="button" data-rate="-1" title="Bad reply">👎</button><button type="button" data-ract="retry" title="Run your last message again">Retry</button>`;
  d._msg = m;
  const paint = () => d.querySelectorAll('[data-rate]').forEach(b => b.classList.toggle('on', +b.dataset.rate === m?.rating));
  if (!m) d.querySelectorAll('[data-rate],[data-ract="copy"]').forEach(b => { b.hidden = true; });
  else if (!replyText(m)) d.querySelectorAll('[data-rate],[data-ract="copy"]').forEach(b => { b.hidden = true; });   // an error with no text: only Retry
  d.onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.rate && m) { const v = +b.dataset.rate; m.rating = m.rating === v ? null : v; paint(); saveSession(); trajRate(m.trajId, m.rating); return; }
    if (b.dataset.ract === 'copy' && m) return copyText(replyText(m), b);
    if (b.dataset.ract === 'retry') return replyRetry(m);
  };
  paint(); queueMicrotask(replyRetrySync); return d;
}
// only the newest reply in the chat offers Retry
function replyRetrySync() { const all = [...chatEl.querySelectorAll('.reply-bar [data-ract="retry"]')]; all.forEach((b, i) => { b.hidden = i !== all.length - 1; }); }
async function replyRetry(m) {
  if (running) return toast('Pandora is still working. Abort her first.', 'err');
  const msgs = cur?.messages || [];
  let u = m ? replyTurn(m)?.user ?? -1 : -1;
  if (u < 0) for (let j = msgs.length - 1; j >= 0; j--) if (msgs[j].role === 'user') { u = j; break; }
  const um = msgs[u]; if (!um) return toast('There is no message of yours to run again.', 'err');
  if (msgs.slice(u + 1).some(x => x.role === 'user')) return toast('Only the latest reply can be retried. Use Edit on an earlier message instead.', 'err');
  await resendFrom(u, um.display || um.content);
}
