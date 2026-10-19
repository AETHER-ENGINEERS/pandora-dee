/* =====================================================================
   NOTES: vault tree / search / editor + reader / links / graph
   ===================================================================== */
const openDirs = new Set(ls.get('openDirs', ['/']));
let selPath = null, editing = null, noteMode = ls.get('noteMode', 'read');
const noteHist = [];
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const linkName = (p) => { const n = noteName(p); const hits = vaultIndex().notes.filter(q => noteName(q).toLowerCase() === n.toLowerCase()); return hits.length > 1 ? p.slice(1).replace(/\.(md|markdown)$/i, '') : n; };

/* ---------- tree ---------- */
function renderTree() {
  const idx = vaultIndex(); const rows = [];
  const rec = (p, depth) => {
    const names = vfs.list(p);
    const dirs = names.filter(n => vfs.isDir(vfs.norm(n, p))), files = names.filter(n => !vfs.isDir(vfs.norm(n, p)));
    for (const n of [...dirs, ...files]) {
      const q = vfs.norm(n, p); const dir = vfs.isDir(q); const open = openDirs.has(q); const note = !dir && isNote(q);
      let right = '';
      if (note) { const b = idx.back.get(q)?.size || 0, o = idx.out.get(q)?.size || 0; right = `<span class="ml-auto flex gap-1 flex-none">${b ? `<span class="lk-badge" title="${b} backlinks">↙${b}</span>` : ''}${o ? `<span class="lk-badge out" title="${o} outgoing links">↗${o}</span>` : ''}</span>`; }
      else if (!dir) right = `<span class="ml-auto text-[10px] text-dim">${fmtSize(vfs.stat(q).size)}</span>`;
      rows.push(`<div class="tree-row ${selPath === q ? 'sel' : ''}" tabindex="0" role="button" data-p="${esc(q)}" style="padding-left:${10 + depth * 14}px"><span class="ic">${dir ? (open ? '▾' : '▸') : note ? '◆' : '·'}</span><span class="${dir ? 'text-yl' : note ? '' : 'text-dim'} truncate">${esc(note ? noteName(q) : n)}${dir ? '/' : ''}</span>${right}</div>`);
      if (dir && open) rec(q, depth + 1);
    }
  };
  rec('/', 0);
  $('#tree').innerHTML = rows.join('') || '<div class="px-3 text-xs text-dim">Empty vault. Tap + Note.</div>';
  let links = 0, miss = 0; for (const s of idx.out.values()) links += s.size; for (const s of idx.missing.values()) miss += s.size;
  $('#fsStats').innerHTML = `<b>${idx.notes.length}</b> notes · <b>${links}</b> links${miss ? ` · <span class="text-rd">${miss} unresolved</span>` : ''} · <b>${idx.words.toLocaleString()}</b> words`;
  renderTagBar();
}
let treeT; const renderTreeSoon = () => { clearTimeout(treeT); treeT = setTimeout(() => { renderTree(); if ($('#noteSearch').value.trim()) runVaultSearch(); }, 120); };
$('#tree').addEventListener('click', e => { const r = e.target.closest('.tree-row'); if (!r) return; const p = r.dataset.p; if (vfs.isDir(p)) { openDirs.has(p) ? openDirs.delete(p) : openDirs.add(p); ls.set('openDirs', [...openDirs]); renderTree(); } else openFile(p); });
$('#tree').addEventListener('keydown', e => { if (e.key === 'Enter') e.target.closest('.tree-row')?.click(); });

/* ---------- tags + search ---------- */
function renderTagBar() {
  const tags = [...vaultIndex().tags.entries()].sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0])).slice(0, 30);
  const q = $('#noteSearch').value.trim().toLowerCase();
  $('#tagBar').hidden = !tags.length;
  $('#tagBar').innerHTML = tags.map(([t, s]) => `<button class="tag-chip${q === '#' + t ? ' on' : ''}" data-tag="${esc(t)}">#${esc(t)} <span class="text-dim">${s.size}</span></button>`).join('');
}
function hl(text, terms) {
  let h = esc(text);
  for (const t of terms) { if (!t) continue; const re = new RegExp('(' + esc(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi'); h = h.replace(re, '<mark>$1</mark>'); }
  return h;
}
function runVaultSearch() {
  const q = $('#noteSearch').value.trim(); const box = $('#searchRes');
  $('#btnSearchClear').hidden = !q;
  if (!q) { box.hidden = true; $('#tree').hidden = false; renderTagBar(); return; }
  const res = searchNotes(q, 40); const terms = q.startsWith('#') ? [q] : q.split(/\s+/);
  box.hidden = false; $('#tree').hidden = true; renderTagBar();
  box.innerHTML = `<div class="hud px-3 py-2">${res.length} match${res.length === 1 ? '' : 'es'} for <span class="text-cy">${esc(q)}</span></div>` +
    (res.map(r => `<button class="search-hit" data-p="${esc(r.path)}"><div class="disp text-yl font-bold text-[14px] truncate">${hl(noteName(r.path), terms)}</div><div class="mono text-[10.5px] text-dim truncate">${esc(r.path)}</div><div class="text-[12.5px] text-[#c2d6ce] leading-snug mt-1">${hl(r.snippet, terms)}</div></button>`).join('') ||
    `<div class="px-3 py-4 text-sm text-dim">Nothing found. <button class="btn btn-ghost mt-2" data-newnote="${esc(q.replace(/^#/, ''))}">+ Create “${esc(q.replace(/^#/, ''))}”</button></div>`);
}
let searchT; $('#noteSearch').addEventListener('input', () => { clearTimeout(searchT); searchT = setTimeout(runVaultSearch, 120); });
$('#noteSearch').addEventListener('keydown', e => { if (e.key === 'Enter') { const h = $('#searchRes .search-hit'); if (h) { e.preventDefault(); openFile(h.dataset.p); } } if (e.key === 'Escape') { e.target.value = ''; runVaultSearch(); } });
$('#btnSearchClear').onclick = () => { $('#noteSearch').value = ''; runVaultSearch(); };
$('#searchRes').addEventListener('click', e => {
  const h = e.target.closest('.search-hit'); if (h) return openFile(h.dataset.p);
  const n = e.target.closest('[data-newnote]'); if (n) createNoteFromLink(n.dataset.newnote, null);
});
function searchTag(tag) { const on = $('#noteSearch').value.trim().toLowerCase() === '#' + tag && document.body.dataset.screen === 'files'; setTab('files'); $('#noteSearch').value = on ? '' : '#' + tag; runVaultSearch(); }

/* ---------- note screen ---------- */
function openFile(p, opts = {}) {
  if (!vfs.isFile(p)) { toast(`${esc(p)} does not exist`, 'err'); return; }
  flushSave();
  if (editing && editing !== p && !opts.noHist) { noteHist.push(editing); if (noteHist.length > 50) noteHist.shift(); }
  selPath = p; editing = p;
  let text; try { text = vfs.read(p); } catch (e) { toast(esc(e.message), 'err'); return; }
  const bin = /[\x00-\x08\x0e-\x1f]/.test(text.slice(0, 2000));
  $('#fileEd').value = bin ? `[binary file, ${vfs.stat(p).size} bytes]` : text; $('#fileEd').readOnly = bin;
  $('#filePath').textContent = isNote(p) ? noteName(p) : vfs.base(p); $('#filePath').title = p; $('#fileDir').textContent = vfs.parent(p);
  delArmed = false; $('#btnFileDel').textContent = 'Delete'; $('#btnFileDel').style.color = '';
  $('#linksPanel').hidden = true; $('#linkSuggest').hidden = true;
  setSaveState('');
  setNoteMode(isNote(p) ? (opts.mode || noteMode) : 'edit', true);
  renderNoteLinks();
  if (!opts.stay) setTab('file');
  if (opts.heading) setTimeout(() => scrollToHeading(opts.heading), 60); else { $('#notePrev').scrollTop = 0; $('#fileEd').scrollTop = 0; }
  renderTreeSoon();
}
function setNoteMode(m, quiet) {
  const note = editing && isNote(editing); if (!note) m = 'edit';
  const body = $('#noteBody'); body.dataset.mode = m;
  for (const b of $$('#modeSeg button')) b.setAttribute('aria-pressed', String(b.dataset.mode === m));
  $('#modeSeg').hidden = !note; $('#mdTools').hidden = m === 'read' || !note;
  if (m !== 'edit') renderNotePreview();
  if (note && !quiet) { noteMode = m; ls.set('noteMode', m); }
  if (note && quiet && m !== noteMode) {}
  if (m === 'read') $('#linkSuggest').hidden = true;
}
$('#modeSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { setNoteMode(b.dataset.mode); if (b.dataset.mode !== 'read') setTimeout(() => $('#fileEd').focus({ preventScroll: true }), 30); } });
const slug = s => String(s).toLowerCase().trim().replace(/<[^>]+>/g, '').replace(/[^\wÀ-￿\s-]/g, '').replace(/\s+/g, '-');
function splitFrontmatter(text) { const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text); return m ? { fm: m[1], body: text.slice(m[0].length) } : { fm: '', body: text }; }
function renderNotePreview() {
  if (!editing) return;
  const { fm, body } = splitFrontmatter($('#fileEd').value);
  Vault.renderFrom = editing; const el = md(body); Vault.renderFrom = null;
  el.classList.add('note-md');
  for (const h of el.querySelectorAll('h1,h2,h3,h4,h5,h6')) h.id = 'h-' + slug(h.textContent);
  el.querySelectorAll('input[type=checkbox]').forEach((c, i) => { c.disabled = false; c.dataset.ti = i; const li = c.closest('li'); if (li) { li.classList.add('md-task'); if (c.checked) li.classList.add('done'); } });
  if (fm.trim()) {
    const props = document.createElement('div'); props.className = 'note-props';
    props.innerHTML = fm.split(/\r?\n/).filter(l => /^\s*[\w-]+\s*:/.test(l)).map(l => { const i = l.indexOf(':'); return `<div><span>${esc(l.slice(0, i).trim())}</span><b>${esc(l.slice(i + 1).trim())}</b></div>`; }).join('');
    el.prepend(props);
  }
  const tags = noteTags(editing);
  const pv = $('#notePrev'); const st = pv.scrollTop; pv.replaceChildren(el); pv.scrollTop = st;
  const words = (body.match(/\S+/g) || []).length;
  $('#noteStats').textContent = `${words} words · ${Math.max(1, Math.round(words / 220))} min${tags.length ? ' · ' + tags.length + ' tags' : ''}`;
}
function scrollToHeading(h) {
  const t = $('#notePrev').querySelector('#h-' + CSS.escape(slug(h)));
  if (t && $('#noteBody').dataset.mode !== 'edit') { t.scrollIntoView({ block: 'start' }); t.classList.add('flash'); setTimeout(() => t.classList.remove('flash'), 1200); return; }
  const ta = $('#fileEd'); const re = new RegExp('^#{1,6}\\s+' + h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*$', 'mi'); const m = re.exec(ta.value);
  if (m) { ta.focus({ preventScroll: true }); ta.setSelectionRange(m.index, m.index); ta.scrollTop = ta.value.slice(0, m.index).split('\n').length * 19 - 40; }
}
function toggleTask(i) {
  const lines = $('#fileEd').value.split('\n'); let n = -1, fence = false;
  for (let k = 0; k < lines.length; k++) {
    if (/^\s*(```|~~~)/.test(lines[k])) { fence = !fence; continue; } if (fence) continue;
    const m = /^(\s*(?:[-*+]|\d+[.)])\s+\[)( |x|X)(\].*)$/.exec(lines[k]);
    if (m && ++n === i) { lines[k] = m[1] + (m[2] === ' ' ? 'x' : ' ') + m[3]; break; }
  }
  $('#fileEd').value = lines.join('\n'); saveNote(); renderNotePreview();
}
$('#notePrev').addEventListener('change', e => { const c = e.target.closest('input[type=checkbox][data-ti]'); if (c) toggleTask(+c.dataset.ti); });

/* ---------- autosave ---------- */
let saveT = null;
function setSaveState(s) { const el = $('#saveState'); el.textContent = s; el.dataset.s = s; }
function saveNote() { clearTimeout(saveT); saveT = null; if (!editing || $('#fileEd').readOnly) return; const v = $('#fileEd').value; let cur = null; try { cur = vfs.read(editing); } catch {} if (cur !== v) { vfs.write(editing, v, { mkdirs: true }); } setSaveState('saved'); }
const flushSave = () => { if (saveT) saveNote(); };
let pvT2;
$('#fileEd').addEventListener('input', () => {
  setSaveState('editing…'); clearTimeout(saveT); saveT = setTimeout(saveNote, 700);
  if ($('#noteBody').dataset.mode === 'split') { clearTimeout(pvT2); pvT2 = setTimeout(renderNotePreview, 250); }
  updateLinkSuggest();
});
$('#fileEd').addEventListener('click', updateLinkSuggest);
$('#fileEd').addEventListener('keyup', e => { if (/Arrow|Home|End/.test(e.key)) updateLinkSuggest(); });
$('#fileEd').addEventListener('blur', () => { flushSave(); setTimeout(() => { if (document.activeElement !== $('#fileEd')) $('#linkSuggest').hidden = true; }, 200); });
$('#fileEd').addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); saveNote(); toast(`Saved ${esc(editing)}`, 'ok'); }
  if (e.key === 'Tab') { e.preventDefault(); const t = e.target, s = t.selectionStart; t.setRangeText('  ', s, t.selectionEnd, 'end'); t.dispatchEvent(new Event('input')); }
  if (e.key === 'Enter' && !$('#linkSuggest').hidden) { const f = $('#linkSuggest button'); if (f) { e.preventDefault(); f.click(); } }
});
addEventListener('pagehide', flushSave); document.addEventListener('visibilitychange', () => { if (document.hidden) flushSave(); });
$('#btnFileCopy').onclick = e => copyText($('#fileEd').value, e.currentTarget);
let delArmed = false;
$('#btnFileDel').onclick = () => {
  if (!editing) return;
  if (!delArmed) { delArmed = true; $('#btnFileDel').textContent = 'Confirm delete'; $('#btnFileDel').style.color = 'var(--rd)'; return; }
  clearTimeout(saveT); saveT = null; vfs.rm(editing, true); toast(`Deleted ${esc(editing)}`);
  editing = selPath = null; $('#fileEd').value = ''; delArmed = false; $('#btnFileDel').textContent = 'Delete'; $('#btnFileDel').style.color = '';
  noteBack();
};
vfs.listeners.add(() => {
  renderTreeSoon();
  if (!editing) return;
  if (!vfs.isFile(editing)) { if (!$('[data-panel="file"]').hidden) { toast(`${esc(editing)} was removed`); editing = null; noteBack(); } return; }
  if (document.activeElement !== $('#fileEd') && !saveT) { const t = vfs.read(editing); if (t !== $('#fileEd').value) { $('#fileEd').value = t; if ($('#noteBody').dataset.mode !== 'edit') renderNotePreview(); } }
  clearTimeout(linksT); linksT = setTimeout(renderNoteLinks, 200);
});
let linksT;
function noteBack() {
  flushSave();
  while (noteHist.length) { const p = noteHist.pop(); if (vfs.isFile(p)) return openFile(p, { noHist: true }); }
  setTab('files');
}

/* ---------- links panel ---------- */
function linkContext(src, target) {
  let text = ''; try { text = vfs.read(src); } catch { return ''; }
  text = text.replace(/^(```|~~~)[\s\S]*?^\1/gm, '');
  for (const raw of text.split('\n')) {
    const line = raw.replace(/`[^`\n]*`/g, '');
    for (const m of line.matchAll(WIKI_RE)) if (resolveNote(m[1], src) === target) return line.trim();
    if (line.toLowerCase().includes(vfs.base(target).toLowerCase()) && /\]\(/.test(line)) return line.trim();
  }
  return '';
}
function renderNoteLinks() {
  if (!editing || !isNote(editing)) { $('#btnLinks').hidden = true; return; }
  const idx = vaultIndex(); const back = [...(idx.back.get(editing) || [])].sort(), out = [...(idx.out.get(editing) || [])].sort(), miss = [...(idx.missing.get(editing) || [])].sort();
  $('#btnLinks').hidden = false; $('#btnLinks').innerHTML = `Links <span class="lk-badge">↙${back.length}</span> <span class="lk-badge out">↗${out.length}</span>`;
  const item = (p, ctx) => `<button class="link-item" data-p="${esc(p)}"><span class="text-yl">${esc(noteName(p))}</span>${ctx ? `<span class="text-[12px] text-dim leading-snug" style="display:block;margin-top:2px">${esc(ctx.slice(0, 160))}</span>` : ''}</button>`;
  $('#linksPanel').innerHTML =
    `<div class="lbl">Backlinks · ${back.length}</div>${back.map(p => item(p, linkContext(p, editing))).join('') || '<div class="text-xs text-dim py-1">No notes link here yet.</div>'}` +
    `<div class="lbl mt-3">Outgoing · ${out.length}</div>${out.map(p => item(p)).join('') || '<div class="text-xs text-dim py-1">No links. Type [[ in the editor to add one.</div>'}` +
    (miss.length ? `<div class="lbl mt-3" style="color:var(--rd)">Unresolved · ${miss.length}</div>${miss.map(m => `<button class="link-item" data-create="${esc(m)}"><span style="color:var(--rd)">${esc(m)}</span> <span class="text-[11px] text-dim">tap to create</span></button>`).join('')}` : '') +
    (noteTags(editing).length ? `<div class="lbl mt-3">Tags</div><div class="flex flex-wrap gap-1 py-1">${noteTags(editing).map(t => `<a href="#" class="tag-chip" data-tag="${esc(t)}">#${esc(t)}</a>`).join('')}</div>` : '');
}
$('#btnLinks').onclick = () => { const p = $('#linksPanel'); p.hidden = !p.hidden; if (!p.hidden) renderNoteLinks(); };
$('#linksPanel').addEventListener('click', e => {
  const i = e.target.closest('[data-p]'); if (i) return openFile(i.dataset.p);
  const c = e.target.closest('[data-create]'); if (c) createNoteFromLink(c.dataset.create, editing);
});

/* ---------- [[ autocomplete + markdown toolbar ---------- */
function linkQuery() {
  const ta = $('#fileEd'); const at = ta.selectionStart; if (at !== ta.selectionEnd) return null;
  const before = ta.value.slice(Math.max(0, at - 120), at); const i = before.lastIndexOf('[[');
  if (i < 0) return null; const q = before.slice(i + 2); if (/[\]\n]/.test(q)) return null;
  return { q, start: at - (before.length - i), at };
}
function updateLinkSuggest() {
  const box = $('#linkSuggest'); const lq = editing && isNote(editing) && $('#noteBody').dataset.mode !== 'read' ? linkQuery() : null;
  if (!lq) { box.hidden = true; return; }
  const q = lq.q.split('|')[0].split('#')[0].trim().toLowerCase(); const notes = vaultIndex().notes.filter(p => p !== editing);
  const scored = notes.map(p => { const n = noteName(p).toLowerCase(); return [p, !q ? 1 : n.startsWith(q) ? 3 : n.includes(q) ? 2 : p.toLowerCase().includes(q) ? 1 : 0]; }).filter(x => x[1]).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 8);
  const exact = notes.some(p => noteName(p).toLowerCase() === q);
  box.innerHTML = scored.map(([p]) => `<button data-link="${esc(linkName(p))}"><span>${esc(noteName(p))}</span><small>${esc(vfs.parent(p))}</small></button>`).join('') +
    (q && !exact ? `<button data-link="${esc(lq.q.trim())}" class="new"><span>+ ${esc(lq.q.trim())}</span><small>new note</small></button>` : '');
  box.hidden = !box.innerHTML;
}
$('#linkSuggest').addEventListener('mousedown', e => e.preventDefault());
$('#linkSuggest').addEventListener('click', e => {
  const b = e.target.closest('button[data-link]'); if (!b) return; const lq = linkQuery(); if (!lq) return;
  const ta = $('#fileEd'); const after = ta.value.slice(lq.at, lq.at + 2) === ']]' ? 2 : 0;
  ta.setRangeText(`[[${b.dataset.link}]]`, lq.start, lq.at + after, 'end');
  ta.dispatchEvent(new Event('input')); $('#linkSuggest').hidden = true; ta.focus({ preventScroll: true });
});
function mdWrap(l, r = l, ph = 'text') {
  const ta = $('#fileEd'); const s = ta.selectionStart, e = ta.selectionEnd; const sel = ta.value.slice(s, e) || ph;
  ta.setRangeText(l + sel + r, s, e, 'select'); ta.setSelectionRange(s + l.length, s + l.length + sel.length);
}
function mdLine(prefix) {
  const ta = $('#fileEd'); const s = ta.selectionStart; const ls0 = ta.value.lastIndexOf('\n', s - 1) + 1;
  const line = ta.value.slice(ls0, (ta.value.indexOf('\n', s) + 1 || ta.value.length + 1) - 1);
  if (line.startsWith(prefix)) ta.setRangeText('', ls0, ls0 + prefix.length, 'end');
  else { const clean = line.match(/^(#{1,6} |- \[[ xX]\] |[-*+] |> |\d+\. )/); ta.setRangeText(prefix, ls0, ls0 + (clean ? clean[0].length : 0), 'end'); }
}
$('#mdTools').addEventListener('mousedown', e => e.preventDefault());
$('#mdTools').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return; const ta = $('#fileEd'); ta.focus({ preventScroll: true });
  const k = b.dataset.md;
  if (k === 'link') { const s = ta.selectionStart, en = ta.selectionEnd; const sel = ta.value.slice(s, en); ta.setRangeText(`[[${sel}]]`, s, en, 'end'); ta.setSelectionRange(s + 2 + sel.length, s + 2 + sel.length); }
  else if (k === 'b') mdWrap('**'); else if (k === 'i') mdWrap('_'); else if (k === 'code') mdWrap('`', '`', 'code'); else if (k === 's') mdWrap('~~');
  else if (k === 'h') { const s = ta.selectionStart; const ls0 = ta.value.lastIndexOf('\n', s - 1) + 1; const m = /^(#{1,6}) /.exec(ta.value.slice(ls0)); const lvl = m ? m[1].length : 0; const next = lvl >= 3 ? '' : '#'.repeat(lvl + 1 || 1) + ' '; ta.setRangeText(next, ls0, ls0 + (m ? m[0].length : 0), 'end'); }
  else if (k === 'task') mdLine('- [ ] '); else if (k === 'ul') mdLine('- '); else if (k === 'quote') mdLine('> ');
  else if (k === 'tag') ta.setRangeText(/\S$/.test(ta.value.slice(0, ta.selectionStart)) ? ' #' : '#', ta.selectionStart, ta.selectionEnd, 'end');
  else if (k === 'date') ta.setRangeText(todayStr(), ta.selectionStart, ta.selectionEnd, 'end');
  ta.dispatchEvent(new Event('input'));
});

/* ---------- creating notes ---------- */
function createNoteFromLink(target, fromPath) {
  let t = String(target).trim().replace(/^\/+/, ''); if (!t) return;
  if (!isNote(t)) t += '.md';
  const p = vfs.norm(t, fromPath ? vfs.parent(fromPath) : '/');
  if (!vfs.exists(p)) { vfs.write(p, `# ${noteName(p)}\n\n${fromPath ? `Linked from [[${linkName(fromPath)}]].\n\n` : ''}`, { mkdirs: true }); toast(`Created ${esc(p)}`, 'ok'); }
  openFile(p, { mode: 'edit' });
  setTimeout(() => { const ta = $('#fileEd'); ta.focus({ preventScroll: true }); ta.setSelectionRange(ta.value.length, ta.value.length); }, 80);
  return p;
}
function openToday() {
  const d = todayStr(); const p = `/daily/${d}.md`;
  if (!vfs.exists(p)) {
    const y = new Date(Date.now() - 864e5); const yd = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, '0')}-${String(y.getDate()).padStart(2, '0')}`;
    vfs.write(p, `# ${d}\n\n#daily · ${vfs.isFile(`/daily/${yd}.md`) ? `previous: [[${yd}]] · ` : ''}[[Inbox]]\n\n## Notes\n\n\n## Tasks\n- [ ] \n`, { mkdirs: true });
  }
  openFile(p, { mode: 'edit' });
}
let newKind = null;
const startNew = k => { newKind = k; $('#newEntry').hidden = false; const i = $('#newEntryInput'); i.value = ''; i.placeholder = k === 'dir' ? 'folder name, e.g. projects' : 'note name, e.g. projects/Big Idea'; i.focus(); };
$('#btnNewFile').onclick = () => startNew('file'); $('#btnNewDir').onclick = () => startNew('dir');
$('#btnToday').onclick = openToday;
$('#newEntryInput').addEventListener('keydown', e => {
  if (e.key === 'Escape') { $('#newEntry').hidden = true; return; }
  if (e.key !== 'Enter') return; const v = e.target.value.trim(); $('#newEntry').hidden = true; if (!v) return;
  try {
    if (newKind === 'dir') { const p = vfs.norm(v); vfs.mkdirp(p); openDirs.add(p); openDirs.add(vfs.parent(p)); ls.set('openDirs', [...openDirs]); renderTree(); }
    else { const p = vfs.norm(KNOWN_EXT.test(v) ? v : v + '.md'); const twin = isNote(p) && !vfs.exists(p) && vaultIndex().notes.find(q => nameKey(q) === nameKey(p)); if (twin) { toast(`“${esc(noteName(twin))}” already exists, opening it`); openFile(twin); return; } if (!vfs.exists(p)) vfs.write(p, isNote(p) ? `# ${noteName(p)}\n\n` : '', { mkdirs: true }); openDirs.add(vfs.parent(p)); setTimeout(() => openFile(p, { mode: 'edit' }), 60); }
  } catch (err) { toast(esc(err.message), 'err'); }
});
async function uploadFiles(fileList, dir = '/') { for (const f of fileList) { const buf = new Uint8Array(await f.arrayBuffer()); vfs.write(vfs.norm(f.webkitRelativePath || f.name, dir), buf, { mkdirs: true }); } toast(`Imported ${fileList.length} file${fileList.length > 1 ? 's' : ''}`, 'ok'); }
$('#upload').onchange = e => { uploadFiles(e.target.files); e.target.value = ''; };
const side = $('#tree');
side.addEventListener('dragover', e => { e.preventDefault(); side.style.borderColor = 'var(--cy)'; });
side.addEventListener('dragleave', () => side.style.borderColor = '');
side.addEventListener('drop', e => { e.preventDefault(); side.style.borderColor = ''; if (e.dataTransfer.files.length) uploadFiles(e.dataTransfer.files); });

/* ---------- wiki links + tags anywhere (notes, chat, links panel) ---------- */
document.addEventListener('click', e => {
  const w = e.target.closest('a.wiki-link'); const t = e.target.closest('.tag-chip');
  if (!w && !t) return; e.preventDefault();
  if (t) return searchTag(t.dataset.tag);
  const from = w.closest('#notePrev') ? editing : null; const target = w.dataset.wiki; const r = resolveNote(target, from);
  if (r) openFile(r, { heading: w.dataset.heading, mode: noteMode === 'edit' ? 'read' : undefined });
  else if (!target && w.dataset.heading) scrollToHeading(w.dataset.heading);
  else createNoteFromLink(target, from);
});

/* ---------- graph ---------- */
const Graph = { nodes: [], edges: [], byId: new Map(), cam: { x: 0, y: 0, k: 1 }, alpha: 0, raf: 0, focus: null, local: false, from: 'files', drag: null };
function buildGraph() {
  const idx = vaultIndex(); const keep = new Set();
  const focus = Graph.local && editing && isNote(editing) ? editing : null;
  if (focus) { keep.add(focus); const lvl1 = [...(idx.out.get(focus) || []), ...(idx.back.get(focus) || [])]; lvl1.forEach(p => keep.add(p)); for (const p of lvl1) [...(idx.out.get(p) || []), ...(idx.back.get(p) || [])].forEach(q => keep.add(q)); }
  const notes = idx.notes.filter(p => !focus || keep.has(p));
  const old = Graph.byId; Graph.byId = new Map(); Graph.nodes = []; Graph.edges = [];
  const add = (id, kind) => { if (Graph.byId.has(id)) return Graph.byId.get(id); const o = old.get(id); const a = Math.random() * 6.283, r = 60 + Math.random() * 180; const n = { id, kind, x: o?.x ?? Math.cos(a) * r, y: o?.y ?? Math.sin(a) * r, vx: 0, vy: 0, deg: 0, label: kind === 'missing' ? id.slice(2) : noteName(id) }; Graph.byId.set(id, n); Graph.nodes.push(n); return n; };
  for (const p of notes) add(p, 'note');
  for (const p of notes) {
    for (const q of idx.out.get(p) || []) if (Graph.byId.has(q)) Graph.edges.push([Graph.byId.get(p), Graph.byId.get(q)]);
    for (const m of idx.missing.get(p) || []) Graph.edges.push([Graph.byId.get(p), add('?:' + m, 'missing')]);
  }
  for (const [a, b] of Graph.edges) { a.deg++; b.deg++; }
  Graph.focus = focus; Graph.alpha = 1;
  $('#graphTitle').textContent = focus ? `Local graph · ${noteName(focus)}` : `Vault graph · ${notes.length} notes`;
  $('#btnGraphLocal').hidden = !(editing && isNote(editing)); $('#btnGraphLocal').setAttribute('aria-pressed', String(!!focus));
}
function graphStep() {
  const N = Graph.nodes, a = Graph.alpha;
  for (let i = 0; i < N.length; i++) { const n = N[i]; for (let j = i + 1; j < N.length; j++) { const m = N[j]; let dx = n.x - m.x, dy = n.y - m.y, d2 = dx * dx + dy * dy + 0.01; if (d2 > 160000) continue; const f = 1400 / d2 * a; const d = Math.sqrt(d2); dx /= d; dy /= d; n.vx += dx * f; n.vy += dy * f; m.vx -= dx * f; m.vy -= dy * f; } }
  for (const [s, t] of Graph.edges) { const dx = t.x - s.x, dy = t.y - s.y, d = Math.sqrt(dx * dx + dy * dy) || 1; const f = (d - 70) * 0.02 * a; const fx = dx / d * f, fy = dy / d * f; s.vx += fx; s.vy += fy; t.vx -= fx; t.vy -= fy; }
  for (const n of N) { n.vx -= n.x * 0.006 * a; n.vy -= n.y * 0.006 * a; if (Graph.drag?.node === n) { n.vx = n.vy = 0; continue; } n.vx *= 0.82; n.vy *= 0.82; n.x += Math.max(-20, Math.min(20, n.vx)); n.y += Math.max(-20, Math.min(20, n.vy)); }
  Graph.alpha = Math.max(0, a * 0.985 - 0.0005);
}
function graphDraw() {
  const cv = $('#graphCv'); const dpr = devicePixelRatio || 1; const w = cv.clientWidth, h = cv.clientHeight;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
  const { x: cx, y: cy, k } = Graph.cam; const X = n => w / 2 + (n.x + cx) * k, Y = n => h / 2 + (n.y + cy) * k;
  const hot = Graph.drag?.node || Graph.byId.get(Graph.focus) || Graph.byId.get(editing);
  const nb = new Set(); if (hot) for (const [s, t] of Graph.edges) { if (s === hot) nb.add(t); if (t === hot) nb.add(s); }
  g.lineWidth = 1;
  for (const [s, t] of Graph.edges) { const on = hot && (s === hot || t === hot); g.strokeStyle = on ? 'rgba(255,184,198,.75)' : t.kind === 'missing' ? 'rgba(255,61,79,.22)' : 'rgba(31,229,165,.22)'; g.beginPath(); g.moveTo(X(s), Y(s)); g.lineTo(X(t), Y(t)); g.stroke(); }
  for (const n of Graph.nodes) {
    const r = (n.kind === 'missing' ? 3 : 4 + Math.min(8, Math.sqrt(n.deg) * 2)) * Math.max(0.6, Math.min(1.6, k));
    const isHot = n === hot, isNb = nb.has(n);
    g.beginPath(); g.arc(X(n), Y(n), r, 0, 6.283);
    g.fillStyle = n.kind === 'missing' ? 'rgba(255,61,79,.55)' : isHot ? '#ffb8c6' : isNb ? '#b8ffdf' : '#1fe5a5';
    g.shadowColor = g.fillStyle; g.shadowBlur = isHot ? 16 : 6; g.fill(); g.shadowBlur = 0;
    if (k > 0.7 || isHot || isNb || n.deg >= 4 || Graph.nodes.length < 25) {
      g.font = `${isHot ? 600 : 500} ${Math.round(11 * Math.max(0.85, Math.min(1.3, k)))}px "Chakra Petch", system-ui, sans-serif`; g.textAlign = 'center';
      g.fillStyle = n.kind === 'missing' ? 'rgba(255,61,79,.8)' : isHot ? '#ffb8c6' : 'rgba(227,242,237,.85)'; g.fillText(n.label.length > 28 ? n.label.slice(0, 27) + '…' : n.label, X(n), Y(n) + r + 12);
    }
  }
}
function graphLoop() {
  cancelAnimationFrame(Graph.raf);
  const tick = () => { if ($('[data-panel="graph"]').hidden) return; if (Graph.alpha > 0.002 || Graph.drag) { for (let i = 0; i < 2; i++) graphStep(); } graphDraw(); Graph.raf = requestAnimationFrame(tick); };
  Graph.raf = requestAnimationFrame(tick);
}
function openGraph(local) {
  Graph.from = document.body.dataset.screen || 'files'; Graph.local = !!local; Graph.cam = { x: 0, y: 0, k: 1 };
  buildGraph(); for (let i = 0; i < 120; i++) graphStep(); setTab('graph'); graphLoop();
}
function graphPick(px, py) {
  const cv = $('#graphCv'); const r = cv.getBoundingClientRect(); const { x: cx, y: cy, k } = Graph.cam;
  const gx = (px - r.left - cv.clientWidth / 2) / k - cx, gy = (py - r.top - cv.clientHeight / 2) / k - cy;
  let best = null, bd = (22 / k) ** 2; for (const n of Graph.nodes) { const d = (n.x - gx) ** 2 + (n.y - gy) ** 2; if (d < bd) { bd = d; best = n; } }
  return { node: best, gx, gy };
}
(() => {
  const cv = $('#graphCv'); const pts = new Map(); let pinch = null, moved = 0;
  cv.addEventListener('pointerdown', e => {
    cv.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); moved = 0;
    if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), k: Graph.cam.k }; Graph.drag = null; return; }
    const { node } = graphPick(e.clientX, e.clientY); Graph.drag = { node, x: e.clientX, y: e.clientY, cam: { ...Graph.cam } }; if (node) Graph.alpha = Math.max(Graph.alpha, 0.3);
  });
  cv.addEventListener('pointermove', e => {
    if (!pts.has(e.pointerId)) return; pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pts.size === 2) { const [a, b] = [...pts.values()]; Graph.cam.k = Math.max(0.2, Math.min(4, pinch.k * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d)); moved = 99; return; }
    const d = Graph.drag; if (!d) return; moved = Math.max(moved, Math.hypot(e.clientX - d.x, e.clientY - d.y));
    if (d.node) { const { gx, gy } = graphPick(e.clientX, e.clientY); d.node.x = gx; d.node.y = gy; Graph.alpha = Math.max(Graph.alpha, 0.25); }
    else { Graph.cam.x = d.cam.x + (e.clientX - d.x) / Graph.cam.k; Graph.cam.y = d.cam.y + (e.clientY - d.y) / Graph.cam.k; }
  });
  const up = e => {
    pts.delete(e.pointerId); if (pts.size < 2) pinch = null;
    const d = Graph.drag; Graph.drag = null;
    if (d?.node && moved < 8) { if (d.node.kind === 'missing') createNoteFromLink(d.node.label, null); else openFile(d.node.id); }
  };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  cv.addEventListener('wheel', e => { e.preventDefault(); Graph.cam.k = Math.max(0.2, Math.min(4, Graph.cam.k * (e.deltaY < 0 ? 1.12 : 1 / 1.12))); }, { passive: false });
})();
$('#btnGraph').onclick = () => openGraph(false);
$('#btnNoteGraph').onclick = () => openGraph(true);
$('#btnGraphLocal').onclick = () => { Graph.local = !Graph.local; buildGraph(); for (let i = 0; i < 120; i++) graphStep(); graphLoop(); };
$('#btnGraphFit').onclick = () => { Graph.cam = { x: 0, y: 0, k: 1 }; Graph.alpha = 0.6; };
$('#btnGraphBack').onclick = () => setTab(Graph.from === 'graph' ? 'files' : Graph.from);
vfs.listeners.add(() => { if (!$('[data-panel="graph"]').hidden) { clearTimeout(Graph.rt); Graph.rt = setTimeout(() => { buildGraph(); Graph.alpha = 0.4; }, 300); } });
$('#btnFileBack').onclick = () => noteBack();
