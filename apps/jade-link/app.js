// Jade Link: a messenger + shared board between the user and Jade, built on webxdc updates.
(() => {
  const X = window.webxdc;
  const JADE = 'jade@jade.vault';
  const $ = (s) => document.querySelector(s);
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (s) => esc(s).replace(/`([^`\n]+)`/g, '<code>$1</code>').replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>');
  const when = (ts) => { const d = new Date(ts); const t = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); return d.toDateString() === new Date().toDateString() ? t : d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + t; };

  // ---- state, rebuilt from updates ----
  const S = { msgs: [], cards: new Map(), order: [], lastJadeTs: 0, waiting: false };
  const COLS = ['todo', 'doing', 'done'];
  function applyCard(op, sender, ts) {
    if (!op || typeof op !== 'object') return null;
    const kind = op.op || 'add';
    if (kind === 'add') {
      const title = String(op.title || '').trim(); if (!title) return null;
      const id = String(op.id || uid()); if (S.cards.has(id)) return null;
      S.cards.set(id, { id, title: title.slice(0, 200), col: COLS.includes(op.col) ? op.col : 'todo', by: sender, ts }); S.order.push(id);
      return `added “${title.slice(0, 60)}”`;
    }
    const c = S.cards.get(String(op.id)) || [...S.cards.values()].find((x) => op.title && x.title.toLowerCase() === String(op.title).toLowerCase());
    if (!c) return null;
    if (kind === 'move' && COLS.includes(op.col)) { c.col = op.col; return `moved “${c.title.slice(0, 40)}” to ${op.col}`; }
    if (kind === 'done') { c.col = 'done'; return `finished “${c.title.slice(0, 40)}”`; }
    if (kind === 'edit' && op.title) { c.title = String(op.title).slice(0, 200); return `renamed a task to “${c.title.slice(0, 40)}”`; }
    if (kind === 'del') { S.cards.delete(c.id); S.order = S.order.filter((i) => i !== c.id); return `removed “${c.title.slice(0, 40)}”`; }
    return null;
  }
  function apply(update) {
    const p = update.payload || {};
    // Jade Vault's host adds sender + timestamp to each update; payloads also carry their author for other hosts
    const from = update.sender || p.author || p.from || 'unknown'; const ts = p.ts || update.timestamp || Date.now();
    if (p.type === 'msg') {
      const notes = []; for (const op of Array.isArray(p.cards) ? p.cards : []) { const n = applyCard(op, from, ts); if (n) notes.push(n); }
      S.msgs.push({ id: p.id || update.serial, from, text: String(p.text || ''), ts, notes });
      if (from === JADE) { S.lastJadeTs = ts; S.waiting = false; }
    } else if (p.type === 'card') {
      const n = applyCard(p, from, ts); if (n && from === JADE) S.msgs.push({ id: 'op' + update.serial, from, text: '', ts, notes: [n] });
    }
  }

  // ---- rendering ----
  let renderQueued = false;
  const queueRender = () => { if (!renderQueued) { renderQueued = true; requestAnimationFrame(() => { renderQueued = false; render(); }); } };
  function render() {
    const log = $('#log'); const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
    $('#empty').hidden = S.msgs.length > 0;
    log.querySelectorAll('.msg,.opnote').forEach((n) => n.remove());
    for (const m of S.msgs) {
      const mine = m.from !== JADE;
      if (m.text) {
        const d = document.createElement('div'); d.className = 'msg ' + (mine ? 'me' : 'jade');
        d.innerHTML = `<div class="meta">${mine ? esc(X.selfName || 'You') : '◆ Jade'} · ${when(m.ts)}</div><div class="bub">${fmt(m.text)}</div>`;
        log.appendChild(d);
      }
      for (const n of m.notes || []) { const o = document.createElement('div'); o.className = 'opnote'; o.textContent = `${mine ? 'you' : 'Jade'} ${n}`; log.appendChild(o); }
    }
    if (atBottom || S.forceScroll) { log.scrollTop = log.scrollHeight; S.forceScroll = false; }
    // board
    for (const col of COLS) {
      const ul = document.querySelector(`.col[data-col=${col}] ul`); const list = S.order.map((i) => S.cards.get(i)).filter((c) => c && c.col === col);
      document.querySelector(`.col[data-col=${col}] h2 span`).textContent = list.length ? `(${list.length})` : '';
      ul.innerHTML = list.length ? list.map((c) => `<li class="card${c.by === JADE ? ' by-jade' : ''}" data-id="${esc(c.id)}"><div class="t">${esc(c.title)}<div class="by">${c.by === JADE ? 'Jade' : 'you'}</div></div>${col !== 'todo' ? '<button data-act="back" aria-label="Move back">◀</button>' : ''}${col !== 'done' ? '<button class="adv" data-act="adv" aria-label="Move forward">▶</button>' : ''}<button data-act="del" aria-label="Delete">✕</button></li>`).join('') : '<li class="none">—</li>';
    }
    const open = [...S.cards.values()].filter((c) => c.col !== 'done').length;
    $('#boardCount').textContent = open ? `(${open})` : '';
    setStatus(S.status || (S.waiting ? 'thinking' : 'idle'));
  }
  function setStatus(s, text) {
    S.status = s === 'idle' ? null : s;
    const el = $('#status'); el.className = 'status ' + (s === 'thinking' ? 'thinking' : s === 'error' ? 'error' : S.lastJadeTs ? 'online' : '');
    $('#statusText').textContent = text || (s === 'thinking' ? 'thinking…' : s === 'error' ? 'could not reach her' : S.lastJadeTs ? `last reply ${when(S.lastJadeTs)}` : 'link idle');
    $('#typing').hidden = s !== 'thinking';
  }

  // ---- sending ----
  const me = () => X.selfAddr;
  function sendMsg(text) {
    text = String(text || '').trim(); if (!text) return;
    S.waiting = true; S.forceScroll = true;
    X.sendUpdate({ payload: { type: 'msg', id: uid(), text, author: me(), ts: Date.now() }, notify: { [JADE]: text.slice(0, 200) }, summary: `You: ${text.slice(0, 60)}` }, 'message');
    setStatus('thinking');
  }
  function sendCard(op) { X.sendUpdate({ payload: Object.assign({ type: 'card', author: me(), ts: Date.now() }, op) }, 'board'); }

  // ---- events ----
  const ta = $('#text');
  const grow = () => { ta.style.height = 'auto'; ta.style.height = Math.min(120, ta.scrollHeight) + 'px'; };
  ta.addEventListener('input', grow);
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#composer').requestSubmit(); } });
  $('#composer').addEventListener('submit', (e) => { e.preventDefault(); sendMsg(ta.value); ta.value = ''; grow(); });
  document.querySelectorAll('[data-chip]').forEach((b) => b.addEventListener('click', () => sendMsg(b.dataset.chip)));
  document.querySelectorAll('.seg button').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('.seg button').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    for (const v of ['chat', 'board']) $('#' + v).hidden = v !== b.dataset.view;
    try { localStorage.setItem('view', b.dataset.view); } catch (e) {}
  }));
  $('#addCard').addEventListener('submit', (e) => { e.preventDefault(); const t = $('#cardTitle').value.trim(); if (!t) return; sendCard({ op: 'add', id: uid(), title: t, col: 'todo' }); $('#cardTitle').value = ''; });
  $('.cols').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-act]'); if (!b) return; const id = b.closest('.card').dataset.id; const c = S.cards.get(id); if (!c) return;
    const i = COLS.indexOf(c.col);
    if (b.dataset.act === 'adv') sendCard({ op: 'move', id, col: COLS[Math.min(2, i + 1)] });
    if (b.dataset.act === 'back') sendCard({ op: 'move', id, col: COLS[Math.max(0, i - 1)] });
    if (b.dataset.act === 'del') sendCard({ op: 'del', id });
  });
  $('#askBoard').addEventListener('click', () => { document.querySelector('.seg button[data-view=chat]').click(); sendMsg('Please look at the board: tidy it up, move anything that looks finished, and suggest what I should do next.'); });
  try { const v = localStorage.getItem('view'); if (v === 'board') document.querySelector('.seg button[data-view=board]').click(); } catch (e) {}

  // live status from the host (ephemeral, never stored)
  try { const rt = X.joinRealtimeChannel(); rt.setListener((data) => { try { const m = JSON.parse(new TextDecoder().decode(data)); if (m.jade) { if (m.jade === 'idle') { S.waiting = false; setStatus('idle'); } else setStatus(m.jade, m.text); } } catch (e) {} }); } catch (e) {}

  X.setUpdateListener((u) => { apply(u); queueRender(); }, 0).then(() => { S.forceScroll = true; render(); });
})();
