/* Jade Docs — browse, ranked (BM25) search, and a direct line to Jade. Protocol: README.md */
(function () {
  'use strict';
  const X = window.webxdc, JADE = 'jade@jade.vault', $ = (s, r = document) => r.querySelector(s);
  const D = window.DOCS || { pages: [], version: '?' };
  const LEVELS = [[0, 'All'], [1, 'Overview'], [2, 'Guides'], [3, 'Internals'], [4, 'Reference']];
  const S = { level: 0, view: 'browse', page: null, anchor: '', over: new Map(), notes: [], marks: new Set(), asks: [], answers: [], goto: null, q: '', waiting: false, ctx: null, uidn: 0 };
  const uid = () => 'm' + Date.now().toString(36) + (S.uidn++).toString(36) + Math.random().toString(36).slice(2, 5);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } }, lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };

  /* ---------- pages (base docs + edits replayed from updates) ---------- */
  const base = new Map(D.pages.map(p => [p.id, p]));
  const pages = () => { const m = new Map(base); for (const [id, o] of S.over) { if (o.deleted) m.delete(id); else m.set(id, Object.assign({}, base.get(id) || { order: 999, level: 2, tags: [] }, o)); } return m; };
  let PG = pages(), KIDS = new Map();
  function rebuild() {
    PG = pages(); KIDS = new Map();
    for (const p of PG.values()) { const k = p.parent && PG.has(p.parent) ? p.parent : ''; (KIDS.get(k) || KIDS.set(k, []).get(k)).push(p); }
    for (const a of KIDS.values()) a.sort((x, y) => (x.order || 0) - (y.order || 0) || x.title.localeCompare(y.title));
    buildIndex();
  }

  /* ---------- markdown (small, safe: everything is escaped first) ---------- */
  const slug = s => String(s).toLowerCase().replace(/<[^>]+>/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  function inline(t) {
    const codes = []; t = t.replace(/`([^`]+)`/g, (m, c) => { codes.push(c); return '\u0001' + (codes.length - 1) + '\u0001'; });
    t = esc(t);
    t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, txt, url) => {
      url = url.replace(/&amp;/g, '&');
      let d = /^#doc:([\w.-]+)(?:#([\w-]+))?$/.exec(url);
      if (d) return `<a data-doc="${esc(d[1])}" data-anchor="${esc(d[2] || '')}">${txt}</a>`;
      if (/^https?:\/\//i.test(url)) return `<a class="ext" title="${esc(url)}">${txt}</a> <small class="u">(${esc(url.replace(/^https?:\/\//, '').slice(0, 48))})</small>`;
      return `<span>${txt}</span>`;
    });
    t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
    return t.replace(/\u0001(\d+)\u0001/g, (m, i) => '<code>' + esc(codes[+i]) + '</code>');
  }
  function md(src) {
    const L = String(src).replace(/\r/g, '').split('\n'); let out = '', i = 0;
    const listRe = /^(\s*)([-*]|\d+\.)\s+(.*)$/;
    while (i < L.length) {
      let l = L[i];
      if (/^```/.test(l)) { const buf = []; i++; while (i < L.length && !/^```/.test(L[i])) buf.push(L[i++]); i++; out += `<pre><code>${esc(buf.join('\n'))}</code></pre>`; continue; }
      let h = /^(#{1,4})\s+(.*)$/.exec(l); if (h) { out += `<h${h[1].length} id="h-${slug(h[2])}">${inline(h[2])}</h${h[1].length}>`; i++; continue; }
      if (/^\s*([-*_])\1\1+\s*$/.test(l)) { out += '<hr>'; i++; continue; }
      if (/^\s*>/.test(l)) { const buf = []; while (i < L.length && /^\s*>/.test(L[i])) buf.push(L[i++].replace(/^\s*>\s?/, '')); out += `<blockquote>${md(buf.join('\n'))}</blockquote>`; continue; }
      if (/^\s*\|.*\|\s*$/.test(l) && /^\s*\|?\s*:?-{2,}/.test(L[i + 1] || '')) {
        const row = r => r.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim()); const head = row(l); i += 2; const rows = [];
        while (i < L.length && /^\s*\|.*\|\s*$/.test(L[i])) rows.push(row(L[i++]));
        out += `<table><thead><tr>${head.map(c => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`; continue;
      }
      if (listRe.test(l)) {
        const stack = []; // [indent, tag]
        while (i < L.length && (listRe.test(L[i]) || (/^\s+\S/.test(L[i]) && stack.length))) {
          const m = listRe.exec(L[i]);
          if (!m) { out = out.replace(/<\/li>$/, ' ' + inline(L[i].trim()) + '</li>'); i++; continue; }
          const ind = m[1].length, tag = /\d/.test(m[2]) ? 'ol' : 'ul';
          while (stack.length && ind < stack[stack.length - 1][0]) out += `</li></${stack.pop()[1]}>`;
          if (!stack.length || ind > stack[stack.length - 1][0]) { out += `<${tag}>`; stack.push([ind, tag]); } else out += '</li>';
          out += `<li>${inline(m[3])}`; i++;
        }
        while (stack.length) out += `</li></${stack.pop()[1]}>`; continue;
      }
      if (!l.trim()) { i++; continue; }
      const buf = []; while (i < L.length && L[i].trim() && !/^(```|#{1,4}\s|\s*>|\s*\|.*\|\s*$)/.test(L[i]) && !listRe.test(L[i])) buf.push(L[i++]);
      if (!buf.length) { buf.push(L[i++]); }
      out += `<p>${inline(buf.join(' '))}</p>`;
    }
    return out;
  }

  /* ---------- BM25 over sections ---------- */
  const STOP = new Set('a an and are as at be by for from has have how i in is it its of on or that the this to was what when where which who why will with you your do does can'.split(' '));
  const stem = w => w.length > 4 ? w.replace(/(ing|edly|ed|es|s|ly)$/, '') : w.replace(/s$/, '');
  const tok = s => (String(s).toLowerCase().match(/[a-z0-9_]+/g) || []).filter(w => w.length > 1 && !STOP.has(w)).map(stem);
  let IDX = { docs: [], df: new Map(), avg: 1, vocab: [] };
  const K1 = 1.2, B = 0.75;
  function sectionsOf(p) {
    const out = [], L = String(p.md).split('\n'); let cur = { h: '', anchor: '', lines: [] }, inCode = false;
    for (const l of L) {
      if (/^```/.test(l)) inCode = !inCode;
      const h = !inCode && /^(#{2,3})\s+(.*)$/.exec(l);
      if (h) { out.push(cur); cur = { h: h[2].replace(/[`*]/g, ''), anchor: slug(h[2]), lines: [] }; } else cur.lines.push(l);
    }
    out.push(cur); return out.filter(s => s.h || s.lines.join('').trim());
  }
  function buildIndex() {
    const docs = [], df = new Map(); let total = 0;
    for (const p of PG.values()) for (const s of sectionsOf(p)) {
      const text = s.lines.join('\n'), tf = new Map(); let len = 0;
      const add = (str, w) => { for (const t of tok(str)) { tf.set(t, (tf.get(t) || 0) + w); len += w; } };
      add(p.title, 3); add((p.tags || []).join(' '), 2); add(s.h, 2.5); add(text, 1);
      docs.push({ page: p.id, title: p.title, h: s.h, anchor: s.anchor, text, tf, len, low: (p.title + ' ' + s.h + ' ' + text).toLowerCase(), level: p.level });
      total += len; for (const t of tf.keys()) df.set(t, (df.get(t) || 0) + 1);
    }
    IDX = { docs, df, avg: total / Math.max(1, docs.length), vocab: [...df.keys()] };
  }
  function search(q, level, limit) {
    const qt = [...new Set(tok(q))]; if (!qt.length) return [];
    const N = IDX.docs.length, terms = [];   // [term, weight]
    for (const t of qt) {
      if (IDX.df.has(t)) terms.push([t, 1]);
      if (t.length >= 3) for (const v of IDX.vocab) if (v !== t && v.startsWith(t)) terms.push([v, 0.5]);
    }
    if (!terms.length) return [];
    const phrase = String(q).toLowerCase().trim(), res = [];
    for (const d of IDX.docs) {
      if (level && d.level !== level) continue;
      let sc = 0;
      for (const [t, w] of terms) {
        const f = d.tf.get(t); if (!f) continue; const n = IDX.df.get(t), idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
        sc += w * idf * (f * (K1 + 1)) / (f + K1 * (1 - B + B * d.len / IDX.avg));
      }
      if (!sc) continue;
      if (phrase.length > 3 && d.low.includes(phrase)) sc *= 1.5;
      if (qt.every(t => d.tf.has(t))) sc *= 1.2;
      res.push({ d, score: sc });
    }
    res.sort((a, b) => b.score - a.score); return res.slice(0, limit || 30);
  }
  function snippet(d, q) {
    const words = [...new Set((String(q).toLowerCase().match(/[a-z0-9_]+/g) || []).filter(w => w.length > 1 && !STOP.has(w)))];
    const text = d.text.replace(/```[\s\S]*?```/g, m => m.replace(/\n/g, ' ')).replace(/[#*>|`]/g, ' ').replace(/\s+/g, ' ').trim();
    let best = 0, bs = -1; const low = text.toLowerCase();
    for (let p = 0; p < Math.max(1, low.length - 100); p += 40) { let s = 0; for (const w of words) if (low.slice(p, p + 220).includes(w)) s++; if (s > bs) { bs = s; best = p; } }
    let sn = text.slice(best, best + 220); let h = esc(sn);
    for (const w of words) h = h.replace(new RegExp('(' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[a-z0-9_]*)', 'ig'), '<mark>$1</mark>');
    return (best > 0 ? '…' : '') + h + (best + 220 < text.length ? '…' : '');
  }

  /* ---------- rendering ---------- */
  const edited = id => S.over.has(id);
  const lvName = n => (LEVELS.find(x => x[0] === n) || [0, ''])[1];
  function renderLevels() {
    $('#levels').innerHTML = LEVELS.map(([n, name]) => `<button data-lv="${n}" aria-pressed="${S.level === n}">${name}</button>`).join('');
  }
  function treeHtml(parent, depth) {
    return (KIDS.get(parent) || []).filter(p => !S.level || p.level === S.level || (KIDS.get(p.id) || []).some(k => !S.level || k.level === S.level)).map(p => {
      const kids = KIDS.get(p.id) || [];
      return `<button class="n${p.id === S.page ? ' cur' : ''}" data-doc="${esc(p.id)}" style="padding-left:${10 + depth * 12}px">${kids.length ? '<span class="tw">▸</span>' : '<span class="tw"></span>'}${esc(p.title)}${edited(p.id) ? '<span class="ed">✎</span>' : ''}${S.marks.has(p.id) ? ' ★' : ''}</button>` + (depth < 2 ? treeHtml(p.id, depth + 1) : '');
    }).join('');
  }
  function renderTree() { $('#tree').innerHTML = treeHtml('', 0) || '<div class="empty">Nothing at this level.</div>'; }
  function crumbs(p) { const a = []; let c = p, g = 0; while (c && c.parent && PG.has(c.parent) && g++ < 6) { c = PG.get(c.parent); a.unshift(`<a data-doc="${esc(c.id)}">${esc(c.title)}</a>`); } return a.join(' › '); }
  function renderPage() {
    const p = PG.get(S.page) || PG.get('overview') || [...PG.values()][0]; if (!p) { $('#page').innerHTML = '<div class="empty">No pages.</div>'; return; }
    S.page = p.id;
    const notes = S.notes.filter(n => n.page === p.id);
    const kids = KIDS.get(p.id) || [];
    $('#page').innerHTML =
      (crumbs(p) ? `<div class="crumbs">${crumbs(p)}</div>` : '') +
      `<div><span class="badge">${esc(lvName(p.level))}</span>${edited(p.id) ? '<span class="badge ed">edited</span>' : ''}${(p.tags || []).slice(0, 5).map(t => `<span class="badge">${esc(t)}</span>`).join('')}</div>` +
      (S.goto && S.goto.page !== p.id ? '' : '') +
      `<div class="tools"><button data-act="askpage">Ask Jade about this page</button><button data-act="asksel">Ask about selection</button><button data-act="mark">${S.marks.has(p.id) ? '★ Bookmarked' : '☆ Bookmark'}</button></div>` +
      md(p.md) +
      (kids.length ? `<h2>In this section</h2><ul>${kids.map(k => `<li><a data-doc="${esc(k.id)}">${esc(k.title)}</a></li>`).join('')}</ul>` : '') +
      `<h2>Notes</h2>` + (notes.length ? notes.map(noteHtml).join('') : '<div class="sub">No notes on this page yet.</div>') +
      `<form class="noteform" data-page="${esc(p.id)}"><input placeholder="Add a note to this page (Jade sees it too)" maxlength="600"><button class="btn">Add</button></form>`;
    if (S.anchor) { const el = document.getElementById('h-' + S.anchor); if (el) el.scrollIntoView(); S.anchor = ''; } else $('#page').scrollTop = 0;
  }
  function noteHtml(n) { return `<div class="note ${n.by === JADE ? 'jade' : ''}"><div class="meta">${n.by === JADE ? 'Jade' : 'You'} · ${new Date(n.ts).toLocaleString()}</div>${inline(n.text)}</div>`; }
  function renderGoto() {
    const old = $('#goto'); if (old) old.remove(); if (!S.goto) return;
    const t = PG.get(S.goto.page); if (!t) return;
    const el = document.createElement('div'); el.className = 'goto'; el.id = 'goto';
    el.innerHTML = `Jade suggests: <a data-doc="${esc(t.id)}" data-anchor="${esc(S.goto.anchor || '')}"><b>${esc(t.title)}</b></a>${S.goto.why ? ' — ' + inline(S.goto.why) : ''} <button class="btn" data-act="dismiss">✕</button>`;
    $('#tabs').after(el);
  }
  function renderResults() {
    const box = $('#results'), q = S.q.trim();
    if (!q) { box.innerHTML = '<div class="empty">Type in the box above. Results are ranked with BM25 over every section of every page, with prefix matches and a bonus for the exact phrase.</div>'; return; }
    const res = search(q, S.level, 30);
    box.innerHTML = `<div class="sub">${res.length} section${res.length === 1 ? '' : 's'} for “${esc(q)}”${S.level ? ' · ' + lvName(S.level) + ' only' : ''}</div>` +
      (res.map(({ d, score }) => `<div class="hit" data-doc="${esc(d.page)}" data-anchor="${esc(d.anchor)}"><span class="sc">${score.toFixed(1)}</span><div class="t">${esc(d.title)}${d.h ? ' › ' + esc(d.h) : ''}</div><div class="p">${esc(lvName(d.level))}</div><div class="s">${snippet(d, q)}</div></div>`).join('') || '<div class="empty">No matches. Try fewer or different words, or ask Jade.</div>') +
      `<div class="tools"><button data-act="askq">Ask Jade: “${esc(q.slice(0, 50))}”</button></div>`;
  }
  function answerFor(id) { return S.answers.find(a => a.to === id); }
  function renderThread() {
    const items = [];
    for (const a of S.asks) { items.push(a); const an = S.answers.filter(x => x.to === a.id); for (const x of an) items.push(x); }
    for (const x of S.answers) if (!S.asks.some(a => a.id === x.to)) items.push(x);
    $('#thread').innerHTML = items.length ? items.map(m => {
      if (m.kind === 'ask') return `<div class="msg me"><div class="meta">You${m.title ? ' · on ' + esc(m.title) : ''}</div>${esc(m.text).replace(/\n/g, '<br>')}</div>`;
      const refs = (m.refs || []).filter(r => PG.has(r)).map(r => `<a data-doc="${esc(r)}">${esc(PG.get(r).title)}</a>`).join('');
      return `<div class="msg jade"><div class="meta">Jade</div>${md(m.text)}${refs ? `<div class="refs">${refs}</div>` : ''}</div>`;
    }).join('') : `<div class="empty"><p>Ask Jade anything about Jade Vault.</p><p class="sub">She can read these docs and the real source, and she can add notes or fix pages here.</p></div>`;
    const open = S.asks.filter(a => !answerFor(a.id)).length; $('#askCount').textContent = open ? '(' + open + ')' : '';
    $('#asksend').disabled = false;
    const th = $('#thread'); th.scrollTop = th.scrollHeight;
  }
  function renderNotes() {
    const mk = [...S.marks].filter(id => PG.has(id));
    $('#notelist').innerHTML = (mk.length ? `<h3>Bookmarks</h3>${mk.map(id => `<div class="hit" data-doc="${esc(id)}"><div class="t">★ ${esc(PG.get(id).title)}</div></div>`).join('')}` : '') +
      `<h3>Notes</h3>` + (S.notes.length ? S.notes.slice().reverse().map(n => `<div class="hit" data-doc="${esc(n.page)}"><div class="p">${esc((PG.get(n.page) || { title: n.page }).title)}</div>${noteHtml(n)}</div>`).join('') : '<div class="empty">No notes yet. Add one at the bottom of any page.</div>');
    $('#noteCount').textContent = S.notes.length ? '(' + S.notes.length + ')' : '';
  }
  function renderAll() { renderLevels(); renderTree(); renderPage(); renderThread(); renderNotes(); renderGoto(); if (S.view === 'search') renderResults(); }
  function setView(v) {
    S.view = v; document.querySelectorAll('#tabs button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.view === v)));
    for (const s of ['browse', 'search', 'ask', 'notes']) $('#' + s).hidden = s !== v;
    if (v === 'search') renderResults(); if (v === 'ask') { renderThread(); renderCtx(); }
  }
  function openDoc(id, anchor) { if (!PG.has(id)) return; S.page = id; S.anchor = anchor || ''; setView('browse'); renderTree(); renderPage(); lsSet('page', id); }
  function renderCtx() { const p = PG.get(S.page); $('#askctx').textContent = S.ctx && S.ctx.selection ? 'About: “' + S.ctx.selection.slice(0, 80) + '” in ' + (p ? p.title : '') : p ? 'Context: ' + p.title : ''; }

  /* ---------- sending ---------- */
  function send(payload, notifyText, summary) {
    const u = { payload: Object.assign({ author: X.selfAddr, ts: Date.now() }, payload) };
    if (notifyText) u.notify = { [JADE]: String(notifyText).slice(0, 200) };
    X.sendUpdate(u, summary || payload.type);
  }
  function ask(text, extra) {
    text = String(text || '').trim(); if (!text) return;
    const p = PG.get(S.page), top = search(text, 0, 3).map(r => r.d.page).filter((v, i, a) => a.indexOf(v) === i);
    send({ type: 'ask', id: uid(), text: text.slice(0, 1500), page: S.page, title: p ? p.title : '', selection: extra && extra.selection ? String(extra.selection).slice(0, 600) : undefined, top }, text, 'ask');
    S.waiting = true; setStatus('thinking'); setView('ask');
  }
  function setStatus(s, t) { const el = $('#status'); el.className = 'status ' + (s === 'idle' ? '' : s); $('#statusText').textContent = t || ({ thinking: 'Jade is thinking…', error: 'Jade hit an error', idle: 'ready' }[s] || s); }

  /* ---------- applying updates ---------- */
  function apply(u) {
    const p = u.payload; if (!p || typeof p !== 'object') return; const by = u.sender || p.author || '';
    switch (p.type) {
      case 'ask': if (!S.asks.some(a => a.id === p.id)) S.asks.push({ kind: 'ask', id: String(p.id), text: String(p.text || ''), page: p.page, title: p.title, by }); break;
      case 'answer': case 'msg': {
        const text = String(p.text || ''); if (!text) break;
        let to = p.to; if (!to) { const open = S.asks.filter(a => !answerFor(a.id)); to = open.length ? open[open.length - 1].id : (S.asks.length ? S.asks[S.asks.length - 1].id : ''); }
        S.answers.push({ kind: 'answer', to, text, refs: Array.isArray(p.refs) ? p.refs.map(String).slice(0, 8) : [], by });
        if (by === JADE) { S.waiting = false; setStatus('idle'); }
        if (p.goto) S.goto = { page: String(p.goto), anchor: p.anchor, why: p.why };
        break;
      }
      case 'note': if (p.page && p.text) S.notes.push({ id: String(p.id || u.serial), page: String(p.page), text: String(p.text).slice(0, 1200), by, ts: u.timestamp ? u.timestamp * 1000 : (p.ts || Date.now()) }); break;
      case 'bookmark': if (p.page) { if (p.on === false) S.marks.delete(String(p.page)); else S.marks.add(String(p.page)); } break;
      case 'goto': if (p.page) S.goto = { page: String(p.page), anchor: p.anchor, why: p.why }; break;
      case 'page':
        if (p.op === 'del' && p.id) S.over.set(String(p.id), { deleted: true });
        else if ((p.op === 'set' || !p.op) && p.id && p.md != null) S.over.set(String(p.id), { id: String(p.id), title: String(p.title || p.id).slice(0, 120), parent: p.parent != null ? String(p.parent) : (base.get(p.id) || {}).parent || 'overview', level: [1, 2, 3, 4].includes(+p.level) ? +p.level : ((base.get(p.id) || {}).level || 2), order: +p.order || (base.get(p.id) || {}).order || 900, tags: Array.isArray(p.tags) ? p.tags.map(String).slice(0, 8) : ((base.get(p.id) || {}).tags || []), md: String(p.md).slice(0, 60000), editedBy: by });
        break;
    }
  }
  let t = 0; const queue = () => { clearTimeout(t); t = setTimeout(() => { rebuild(); renderAll(); }, 60); };

  /* ---------- events ---------- */
  document.addEventListener('click', e => {
    const a = e.target.closest('[data-doc]'); if (a && !e.target.closest('form')) { openDoc(a.dataset.doc, a.dataset.anchor); return; }
    const lv = e.target.closest('[data-lv]'); if (lv) { S.level = +lv.dataset.lv; lsSet('level', S.level); renderLevels(); renderTree(); if (S.view === 'search') renderResults(); return; }
    const tab = e.target.closest('#tabs button'); if (tab) { setView(tab.dataset.view); return; }
    const act = e.target.closest('[data-act]'); if (!act) return;
    const p = PG.get(S.page);
    if (act.dataset.act === 'mark' && p) { send({ type: 'bookmark', page: p.id, on: !S.marks.has(p.id) }, null, 'bookmark'); }
    if (act.dataset.act === 'dismiss') { S.goto = null; renderGoto(); }
    if (act.dataset.act === 'askpage' && p) { S.ctx = null; setView('ask'); $('#asktext').value = 'Explain “' + p.title + '” to me, and tell me what is easy to get wrong.'; $('#asktext').focus(); }
    if (act.dataset.act === 'asksel' && p) { const sel = String(window.getSelection ? window.getSelection() : '').trim(); S.ctx = sel ? { selection: sel } : null; setView('ask'); $('#asktext').value = sel ? 'What does this mean, and where is it implemented?' : ''; $('#asktext').focus(); renderCtx(); }
    if (act.dataset.act === 'askq') { S.ctx = null; setView('ask'); $('#asktext').value = S.q; $('#asktext').focus(); }
  });
  document.addEventListener('submit', e => {
    e.preventDefault();
    if (e.target.id === 'askform') { const ta = $('#asktext'); ask(ta.value, S.ctx); ta.value = ''; S.ctx = null; renderCtx(); }
    if (e.target.classList.contains('noteform')) { const i = e.target.querySelector('input'); if (i.value.trim()) send({ type: 'note', id: uid(), page: e.target.dataset.page, text: i.value.trim() }, null, 'note'); i.value = ''; }
  });
  $('#asktext').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); $('#askform').requestSubmit(); } });
  $('#q').addEventListener('input', e => { S.q = e.target.value; $('#clearq').hidden = !S.q; if (S.q.trim()) setView('search'); else renderResults(); if (S.q.trim()) renderResults(); });
  $('#clearq').addEventListener('click', () => { $('#q').value = ''; S.q = ''; $('#clearq').hidden = true; setView('browse'); });

  /* ---------- start ---------- */
  S.level = +(lsGet('level') || 0); S.page = lsGet('page') && base.has(lsGet('page')) ? lsGet('page') : 'overview';
  rebuild(); renderAll();
  try { const rt = X.joinRealtimeChannel(); rt.setListener(data => { try { const m = JSON.parse(new TextDecoder().decode(data)); if (m.jade) { if (m.jade === 'idle') { S.waiting = false; setStatus('idle'); } else setStatus(m.jade, m.text); } } catch (e) {} }); } catch (e) {}
  X.setUpdateListener(u => { apply(u); queue(); }, 0).then(() => { rebuild(); renderAll(); });
  window.__docs = { search, PG: () => PG, S, md, openDoc, ask, IDX: () => IDX };
})();
