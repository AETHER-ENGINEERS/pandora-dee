/* =====================================================================
   FIND & REPLACE — in the leaf editor. 🔍 on the formatting bar, Ctrl/Cmd+F (Ctrl+H, or Cmd+Alt+F, for
   replace). Enter goes to the next match, Shift+Enter to the one before; match case and regular
   expressions are switches ($1 works in the replacement). Replacing goes through the browser's own
   editing, so Ctrl/Cmd+Z undoes it, and Replace all is one step to undo.
   ===================================================================== */
const Find = { at: -1, hits: [] };
function findRegex() {
  const q = $('#findQ').value; if (!q) return null;
  const flags = 'g' + ($('#findCase').getAttribute('aria-pressed') === 'true' ? '' : 'i');
  if ($('#findRe').getAttribute('aria-pressed') === 'true') { try { return new RegExp(q, flags + 'm'); } catch { return 'bad'; } }
  return new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
}
function findScan() {
  const re = findRegex(), text = $('#fileEd').value; Find.hits = [];
  if (re && re !== 'bad') for (const m of text.matchAll(re)) { if (!m[0].length) continue; Find.hits.push({ i: m.index, len: m[0].length, m }); if (Find.hits.length >= 10000) break; }
  $('#findQ').classList.toggle('bad', re === 'bad' || (!!re && !Find.hits.length));
  return re;
}
function findCount() {
  const re = findRegex(), n = Find.hits.length;
  $('#findCount').textContent = re === 'bad' ? 'bad pattern' : !re ? '' : !n ? 'no match' : Find.at >= 0 ? `${Find.at + 1} of ${n}` : `${n} match${n === 1 ? '' : 'es'}`;
}
// scroll the editor so a character offset is in view, measured with a copy of the text laid out the same way
function findScrollTo(ta, i) {
  const m = findScrollTo.mirror ||= Object.assign(document.createElement('div'), { ariaHidden: 'true' });
  const cs = getComputedStyle(ta);
  for (const k of ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderLeftWidth', 'borderRightWidth', 'tabSize', 'wordBreak', 'overflowWrap']) m.style[k] = cs[k];
  Object.assign(m.style, { position: 'absolute', visibility: 'hidden', top: '0', left: '-9999px', whiteSpace: 'pre-wrap', width: ta.clientWidth + 'px', boxSizing: 'border-box' });
  m.textContent = ta.value.slice(0, i) + '​'; document.body.appendChild(m);
  const y = m.scrollHeight; m.remove();
  ta.scrollTop = Math.max(0, y - ta.clientHeight / 3);
}
function findGo(dir = 1, fromCaret = false) {
  const ta = $('#fileEd'); findScan();
  if (!Find.hits.length) { Find.at = -1; return findCount(); }
  if (fromCaret || Find.at < 0) {
    const c = dir > 0 ? ta.selectionStart : ta.selectionEnd;
    const k = dir > 0 ? Find.hits.findIndex(h => h.i >= c) : Find.hits.findLastIndex(h => h.i + h.len <= c);
    Find.at = k < 0 ? (dir > 0 ? 0 : Find.hits.length - 1) : k;
  } else Find.at = (Find.at + dir + Find.hits.length) % Find.hits.length;
  const h = Find.hits[Find.at];
  ta.setSelectionRange(h.i, h.i + h.len); findScrollTo(ta, h.i);
  findCount();
}
// the replacement for one match ($1, $<name> and $& work in regex mode)
function findReplacement(h) {
  const r = $('#findR').value;
  if ($('#findRe').getAttribute('aria-pressed') !== 'true') return r;
  const m = h.m;
  return r.replace(/\$(\$|&|\d{1,2}|<[^>]+>)/g, (all, k) => k === '$' ? '$' : k === '&' ? m[0] : k[0] === '<' ? (m.groups?.[k.slice(1, -1)] ?? '') : (m[+k] ?? all));
}
// write text into the editor the way typing would, so undo keeps it
function findInsert(ta, start, end, text) {
  ta.focus({ preventScroll: true }); ta.setSelectionRange(start, end);
  let ok = false; try { ok = document.execCommand('insertText', false, text); } catch {}
  if (!ok || ta.value.slice(start, start + text.length) !== text) { ta.setRangeText(text, start, end, 'end'); ta.dispatchEvent(new Event('input', { bubbles: true })); }
}
function findReplace() {
  const ta = $('#fileEd'); if (ta.readOnly) return;
  findScan(); const h = Find.hits.find(x => x.i === ta.selectionStart && x.i + x.len === ta.selectionEnd);
  if (!h) return findGo(1, true);
  const rep = findReplacement(h); findInsert(ta, h.i, h.i + h.len, rep);
  ta.setSelectionRange(h.i + rep.length, h.i + rep.length); Find.at = -1; findGo(1, true);
  $('#findR').focus();
}
function findReplaceAll() {
  const ta = $('#fileEd'); if (ta.readOnly) return;
  const re = findScan(); if (!Find.hits.length || re === 'bad') return findCount();
  let out = '', last = 0; for (const h of Find.hits) { out += ta.value.slice(last, h.i) + findReplacement(h); last = h.i + h.len; }
  out += ta.value.slice(last); const n = Find.hits.length;
  findInsert(ta, 0, ta.value.length, out);
  Find.at = -1; findScan(); findCount(); toast(`Replaced ${n} match${n === 1 ? '' : 'es'}`, 'ok');
}
function openFind(replace = false) {
  if (!editing) return;
  if ($('#noteBody').dataset.mode === 'read') setNoteMode('split', true);
  const ta = $('#fileEd'), bar = $('#findBar'); bar.hidden = false; bar.classList.toggle('with-replace', replace || bar.classList.contains('with-replace'));
  const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd);
  if (sel && !sel.includes('\n') && sel.length < 200) $('#findQ').value = sel;
  Find.at = -1; findScan(); findCount();
  (replace && $('#findQ').value ? $('#findR') : $('#findQ')).focus(); $('#findQ').select();
}
// another leaf opened under the bar
function findRefresh() { if ($('#findBar') && !$('#findBar').hidden) { Find.at = -1; findScan(); findCount(); } }
function closeFind() { $('#findBar').hidden = true; Find.at = -1; Find.hits = []; $('#fileEd').focus({ preventScroll: true }); }
function findInit() {
  const bar = $('#findBar'); if (!bar) return;
  const tools = $('#mdTools'); if (tools) { const b = document.createElement('button'); b.type = 'button'; b.dataset.find = '1'; b.setAttribute('aria-label', 'Find and replace'); b.title = 'Find and replace (Ctrl/Cmd+F)'; b.textContent = '🔍'; b.addEventListener('click', e => { e.stopPropagation(); openFind(true); }); tools.prepend(b); }
  $('#findQ').addEventListener('input', () => { Find.at = -1; findScan(); findCount(); });
  for (const id of ['#findCase', '#findRe']) $(id).onclick = e => { const b = e.currentTarget; b.setAttribute('aria-pressed', String(b.getAttribute('aria-pressed') !== 'true')); Find.at = -1; findScan(); findCount(); };
  $('#findQ').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); findGo(e.shiftKey ? -1 : 1); } });
  $('#findR').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); (e.metaKey || e.ctrlKey) ? findReplaceAll() : findReplace(); } });
  bar.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); closeFind(); } });
  $('#findPrev').onclick = () => findGo(-1); $('#findNext').onclick = () => findGo(1);
  $('#findOne').onclick = findReplace; $('#findAll').onclick = findReplaceAll; $('#findClose').onclick = closeFind;
  $('#findToggle').onclick = () => { bar.classList.toggle('with-replace'); if (bar.classList.contains('with-replace')) $('#findR').focus(); };
  // the text changed under the bar: count again
  $('#fileEd').addEventListener('input', () => { if (!bar.hidden) { findScan(); findCount(); } });
  addEventListener('keydown', e => {
    if (document.body.dataset.screen !== 'file' || !editing) return;
    const mod = e.metaKey || e.ctrlKey, k = e.key.toLowerCase();
    if (mod && !e.shiftKey && k === 'f' && !e.altKey) { e.preventDefault(); openFind(false); }
    else if ((e.ctrlKey && !e.metaKey && k === 'h') || (e.metaKey && e.altKey && (k === 'f' || e.code === 'KeyF'))) { e.preventDefault(); openFind(true); }
    else if (e.key === 'F3' || (mod && k === 'g')) { if (!bar.hidden) { e.preventDefault(); findGo(e.shiftKey ? -1 : 1); } }
  });
}
