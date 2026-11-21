# ---------- search the branches (what was said in them, not just their names) ----------
# Exec'd by build.py last. With many branches, finding the one where something happened meant opening them one by one:
# the list shows titles only, and chat_history's search needs the memory index. Now a search box sits above the list.
# It reads the saved branches themselves: titles, what you and Pandora said, compaction summaries, and tool calls and
# their results (so file names, repos and commands match too). Every word must appear, in any order, any case. Matching
# branches stay in their usual order, each with a line around the first match; Esc or ✕ clears it. Nothing is indexed
# or stored: each branch's text is cached in memory and read again when the branch changes.
rep('  <div id="sessList" class="overflow-y-auto min-h-0"></div>',
    '  <div class="sess-search"><input id="sessSearch" class="field" type="search" placeholder="Search branches…" aria-label="Search branches by what was said in them" autocomplete="off" spellcheck="false"></div>\n'
    '  <div id="sessSearchNote" class="hint sess-search-note" hidden></div>\n'
    '  <div id="sessList" class="overflow-y-auto min-h-0"></div>')
rep(".sess-row{display:flex;align-items:stretch;min-width:0}",
    ".sess-row{display:flex;align-items:stretch;min-width:0}\n"
    ".sess-search{padding:0 12px 8px}.sess-search .field{width:100%}.sess-search-note{padding:0 12px 6px}\n"
    ".sess-snip{display:block;margin-top:2px;font-size:11px;color:var(--dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.sess-snip mark{background:rgba(31,229,165,.18);color:var(--yl)}")
rep("  const list = [...sessions]; if (cur && !list.find(s => s.id === cur.id)) list.unshift({ id: cur.id, title: cur.title, _unsaved: true });",
    "  let list = [...sessions]; if (cur && !list.find(s => s.id === cur.id)) list.unshift({ id: cur.id, title: cur.title, _unsaved: true });\n"
    "  if (BS.hits) list = list.filter(s => BS.hits.has(s.id));")
rep("  if (PEEK?.id) $$('#sessList .sess').forEach(",
    "  bsDecorate();\n  if (PEEK?.id) $$('#sessList .sess').forEach(")
rep("function renderSessions() {", r"""const BS = { q: '', hits: null, cache: new Map(), gen: 0, timer: 0 };
// everything searchable in one branch, as plain text
function bsText(s) {
  const out = [String(s.title || '')]; const cap = (t, n) => { t = String(t ?? ''); return t.length > n ? t.slice(0, n) : t; };
  for (const m of s.messages || []) {
    if (m.role === 'user') out.push(String(m.display || m.content || ''));
    else if (m.role === 'assistant') { if (m.content) out.push(String(m.content)); for (const t of m.tool_calls || []) out.push(`${t.function?.name || ''} ${cap(JSON.stringify(t.function?.arguments || {}), 4000)}`); }
    else if (m.role === 'tool') out.push(`${m.tool_name || ''} ${cap(m.content, 4000)}`);
    else if (m.role === 'compaction') out.push(String(m.summary || ''));
  }
  return out.join('\n');
}
async function bsEntry(meta) {
  const live = cur && cur.id === meta.id; const key = live ? `${cur.updated || 0}:${cur.messages.length}` : String(meta.updated || 0);
  const hit = BS.cache.get(meta.id); if (hit && hit.key === key) return hit;
  const s = live ? cur : await idb.get('session:' + meta.id); if (!s) return null;
  const text = bsText(s); const e = { key, text, lower: text.toLowerCase() }; BS.cache.set(meta.id, e); return e;
}
function bsSnippet(e, words, title) {
  const body = e.text.slice(String(title || '').length); const low = body.toLowerCase();
  let at = -1, w = ''; for (const x of words) { const i = low.indexOf(x); if (i >= 0 && (at < 0 || i < at)) { at = i; w = x; } }
  if (at < 0) return '';
  const from = Math.max(0, at - 40), raw = body.slice(from, at + w.length + 80).replace(/\s+/g, ' ').trim();
  const lead = from > 0 ? '…' : '';
  const re = new RegExp('(' + words.map(x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'gi');
  return lead + esc(raw).replace(re, '<mark>$1</mark>');
}
// Run a search: every word must appear somewhere in the branch (title, messages, tool calls and results).
async function branchSearch(q) {
  const gen = ++BS.gen; BS.q = String(q || '').trim(); const note = $('#sessSearchNote');
  if (!BS.q) { BS.hits = null; note.hidden = true; renderSessions(); return null; }
  const words = [...new Set(BS.q.toLowerCase().split(/\s+/).filter(Boolean))];
  const metas = [...sessions]; if (cur && !metas.find(s => s.id === cur.id)) metas.unshift({ id: cur.id, title: cur.title, updated: cur.updated });
  const hits = new Map();
  for (const m of metas) {
    const e = await bsEntry(m); if (gen !== BS.gen) return null;
    if (e && words.every(w => e.lower.includes(w))) hits.set(m.id, bsSnippet(e, words, m.title));
  }
  BS.hits = hits; note.hidden = false;
  note.textContent = hits.size ? `${hits.size} of ${metas.length} branch${metas.length === 1 ? '' : 'es'} match` : `No branch mentions “${BS.q}”.`;
  renderSessions(); return [...hits.keys()];
}
function bsDecorate() {
  if (!BS.hits) return;
  for (const b of $$('#sessList .sess')) { const snip = BS.hits.get(b.dataset.id); if (snip) b.insertAdjacentHTML('beforeend', `<span class="sess-snip">${snip}</span>`); }
}
function renderSessions() {""")
rep("$('#sessList').addEventListener('click', e => {",
    "$('#sessSearch').addEventListener('input', e => { clearTimeout(BS.timer); const v = e.target.value; BS.timer = setTimeout(() => branchSearch(v), 180); });\n"
    "$('#sessSearch').addEventListener('keydown', e => { if (e.key === 'Escape' && e.target.value) { e.preventDefault(); e.stopPropagation(); e.target.value = ''; clearTimeout(BS.timer); branchSearch(''); } });\n"
    "$('#sessSearch').addEventListener('search', e => { if (!e.target.value) { clearTimeout(BS.timer); branchSearch(''); } });   // the ✕ in the box\n"
    "$('#sessList').addEventListener('click', e => {")
rep("/* =====================================================================\n   BOOT", "Object.assign(window, { branchSearch });   // for tests/branch_search_test.mjs\n/* =====================================================================\n   BOOT")
