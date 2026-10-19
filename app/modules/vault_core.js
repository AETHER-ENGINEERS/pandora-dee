/* =====================================================================
   VAULT CORE — an Obsidian-style knowledge base on top of the VFS.
   Notes are .md files anywhere in the filesystem. [[wiki links]] (with
   |alias and #heading), markdown links to .md files, backlinks, #tags,
   ranked search. The index rebuilds lazily whenever any file changes.
   ===================================================================== */
const isNote = (p) => /\.(md|markdown)$/i.test(p);
const noteName = (p) => vfs.base(p).replace(/\.(md|markdown)$/i, '');
const Vault = { index: null, dirty: true, renderFrom: null };
function allNotes() {
  const out = [];
  for (const [p, n] of vfs.nodes) if (!n.dir && isNote(p) && !/\/(node_modules|\.git|\.trash)\//.test(p) && !/^\/(?:pandora|jade)\/skills\//i.test(p)) out.push(p);
  return out.sort((a, b) => a.localeCompare(b));
}
const WIKI_RE = /\[\[([^\[\]\n|#]+)(#[^\[\]\n|]*)?(?:\|([^\[\]\n]+))?\]\]/g;
const TAG_RE = /(^|[\s(\[,;])#([A-Za-z][\w\/-]*)/g;
const stripCode = (md) => String(md).replace(/^(```|~~~)[\s\S]*?^\1/gm, ' ').replace(/`[^`\n]*`/g, ' ').replace(/\$\$[\s\S]*?\$\$/g, ' ').replace(/\$(?!\s)[^$\n]+?\$/g, ' ');
const KNOWN_EXT = /\.(md|markdown|txt|js|mjs|cjs|ts|json|csv|tsv|html?|css|sh|py|ya?ml|xml|svg|log|ini|toml|png|jpe?g|gif|webp|pdf)$/i;
const nameKey = s => noteName(s).toLowerCase().replace(/[\s_\-]+/g, ' ').trim();
function resolveNote(target, fromPath) {
  let t = String(target ?? '').trim().replace(/\\/g, '/');
  if (!t) return null;
  if (!isNote(t)) t += '.md';
  const notes = Vault.index?.notes || allNotes();
  const dir = fromPath ? vfs.parent(fromPath) : '/';
  for (const cand of [vfs.norm(t, dir), vfs.norm(t, '/')]) if (vfs.isFile(cand)) return cand;
  const lc = t.toLowerCase(), base = lc.split('/').pop();
  let hits = lc.includes('/') ? notes.filter(p => p.toLowerCase().endsWith('/' + lc.replace(/^\/+/, ''))) : [];
  if (!hits.length) hits = notes.filter(p => vfs.base(p).toLowerCase() === base);
  if (!hits.length) { const k = nameKey(base); if (k) hits = notes.filter(p => nameKey(p) === k); }
  if (!hits.length) return null;
  hits.sort((a, b) => (vfs.parent(b) === dir) - (vfs.parent(a) === dir) || a.length - b.length || a.localeCompare(b));
  return hits[0];
}
function buildIndex() {
  const notes = allNotes();
  const idx = { notes, out: new Map(), back: new Map(), tags: new Map(), missing: new Map(), words: 0 };
  Vault.index = idx;
  for (const p of notes) idx.back.set(p, new Set());
  for (const p of notes) {
    let text = ''; try { text = vfs.read(p); } catch {}
    const body = stripCode(text), out = new Set(), miss = new Set();
    for (const m of body.matchAll(WIKI_RE)) {
      const r = resolveNote(m[1], p);
      if (r) { if (r !== p) { out.add(r); idx.back.get(r)?.add(p); } } else miss.add(m[1].trim());
    }
    for (const m of body.matchAll(/\]\(([^)\s]+\.(?:md|markdown))(?:#[^)]*)?\)/gi)) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(m[1])) continue;
      let target; try { target = decodeURIComponent(m[1]); } catch { target = m[1]; }
      const r = resolveNote(target, p); if (r && r !== p) { out.add(r); idx.back.get(r)?.add(p); }
    }
    idx.out.set(p, out); idx.missing.set(p, miss);
    for (const m of body.matchAll(TAG_RE)) { const tag = m[2].replace(/[\/-]+$/, '').toLowerCase(); if (!tag) continue; if (!idx.tags.has(tag)) idx.tags.set(tag, new Set()); idx.tags.get(tag).add(p); }
    idx.words += (text.match(/\S+/g) || []).length;
  }
  Vault.dirty = false;
  return idx;
}
const vaultIndex = () => (Vault.dirty || !Vault.index ? buildIndex() : Vault.index);
vfs.listeners.add(() => { Vault.dirty = true; });
function noteTags(p) { const idx = vaultIndex(); return [...idx.tags.entries()].filter(([, s]) => s.has(p)).map(([t]) => t).sort(); }
function searchNotes(query, limit = 20) {
  const q = String(query ?? '').trim(); if (!q) return [];
  const idx = vaultIndex(), res = [];
  const tagQ = /^#[\w\/-]+$/.test(q) ? q.slice(1).toLowerCase() : null;
  const terms = tagQ ? [] : q.toLowerCase().split(/\s+/).filter(Boolean);
  for (const p of idx.notes) {
    let text = ''; try { text = vfs.read(p); } catch { continue; }
    const lc = text.toLowerCase(), name = noteName(p).toLowerCase(), pl = p.toLowerCase();
    if (tagQ) { const ok = [...idx.tags.entries()].some(([t, s]) => (t === tagQ || t.startsWith(tagQ + '/')) && s.has(p)); if (!ok) continue; }
    else if (!terms.every(t => lc.includes(t) || pl.includes(t))) continue;
    let score = 0, first = -1;
    for (const t of terms) {
      if (name === t) score += 30; else if (name.includes(t)) score += 12;
      let i = -1, c = 0; while ((i = lc.indexOf(t, i + 1)) >= 0 && c < 60) { if (first < 0 || i < first) first = i; c++; }
      score += c;
    }
    if (tagQ) { const i = lc.indexOf('#' + tagQ); first = i; score = 1; }
    score += Math.min(5, idx.back.get(p)?.size || 0) * 0.5;
    const s = Math.max(0, (first < 0 ? 0 : first) - 50);
    const snippet = (s ? '…' : '') + text.slice(s, s + 190).replace(/\s+/g, ' ').trim() + (text.length > s + 190 ? '…' : '');
    res.push({ path: p, score, snippet });
  }
  return res.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path)).slice(0, limit);
}
// ---- markdown: [[wiki links]] and #tags as marked extensions (used for notes AND chat replies) ----
(() => {
  if (!window.marked?.use) return;
  const wiki = {
    name: 'wikilink', level: 'inline',
    start(src) { const i = src.indexOf('[['); return i < 0 ? undefined : i; },
    tokenizer(src) {
      const m = /^\[\[([^\[\]\n|#]+)(#[^\[\]\n|]*)?(?:\|([^\[\]\n]+))?\]\]/.exec(src);
      if (m) return { type: 'wikilink', raw: m[0], target: m[1].trim(), heading: (m[2] || '').slice(1).trim(), alias: (m[3] || '').trim() };
    },
    renderer(tok) {
      const r = resolveNote(tok.target, Vault.renderFrom);
      const label = tok.alias || (tok.heading ? `${tok.target} › ${tok.heading}` : tok.target);
      return `<a href="#" class="wiki-link${r ? '' : ' missing'}" data-wiki="${esc(tok.target)}"${tok.heading ? ` data-heading="${esc(tok.heading)}"` : ''} title="${esc(r || 'Not created yet: tap to create')}">${esc(label)}</a>`;
    },
  };
  const tag = {
    name: 'notetag', level: 'inline',
    start(src) { const m = /(^|[\s(\[,;])#[A-Za-z]/.exec(src); return m ? m.index + m[1].length : undefined; },
    tokenizer(src) { const m = /^#([A-Za-z][\w\/-]*)/.exec(src); if (m) return { type: 'notetag', raw: m[0], tag: m[1].replace(/[\/-]+$/, '') }; },
    renderer(tok) { return `<a href="#" class="tag-chip" data-tag="${esc(tok.tag.toLowerCase())}">#${esc(tok.tag)}</a>`; },
  };
  // LaTeX: $$display$$, \[display\], $inline$, \(inline\). Rendered with KaTeX after sanitising (see md()).
  const mathBlock = {
    name: 'mathBlock', level: 'block',
    start(src) { const m = /(^|\n) {0,3}(\$\$|\\\[)/.exec(src); return m ? m.index + m[1].length : undefined; },
    tokenizer(src) { const m = /^ {0,3}\$\$([\s\S]+?)\$\$[ \t]*(?:\n+|$)/.exec(src) || /^ {0,3}\\\[([\s\S]+?)\\\][ \t]*(?:\n+|$)/.exec(src); if (m) return { type: 'mathBlock', raw: m[0], text: m[1].trim() }; },
    renderer(t) { return `<div class="math-tex" data-display="1" data-tex="${esc(t.text)}"></div>\n`; },
  };
  const mathInline = {
    name: 'mathInline', level: 'inline',
    start(src) { const m = /\$|\\\(/.exec(src); return m ? m.index : undefined; },
    tokenizer(src) {
      let m = /^\$\$([^$]+?)\$\$/.exec(src); if (m) return { type: 'mathInline', raw: m[0], text: m[1].trim(), display: true };
      m = /^\$(?![\s$])((?:\\.|[^\\$\n])+?)(?<![\s\\])\$(?!\d)/.exec(src); if (m) return { type: 'mathInline', raw: m[0], text: m[1], display: false };
      m = /^\\\(([\s\S]+?)\\\)/.exec(src); if (m) return { type: 'mathInline', raw: m[0], text: m[1].trim(), display: false };
    },
    renderer(t) { return `<span class="math-tex" data-display="${t.display ? 1 : 0}" data-tex="${esc(t.text)}"></span>`; },
  };
  try { marked.use({ extensions: [mathBlock, mathInline] }); } catch (e) { console.warn('math extension failed', e); }
  try { marked.use({ extensions: [wiki, tag] }); } catch (e) { console.warn('wiki link extension failed', e); }
})();

// ---- tool paths: forgiving about missing ".md", case and folders, strict about duplicates ----
const cleanPath = raw => vfs.norm(String(raw ?? '').trim().replace(/^["'`]+|["'`]+$/g, '').replace(/\s*\/\s*/g, '/').replace(/[ \t]+/g, ' '), '/');
function findExisting(raw) {
  const p = cleanPath(raw); if (vfs.exists(p)) return p;
  const want = [p.toLowerCase()]; if (!KNOWN_EXT.test(p)) want.push(p.toLowerCase() + '.md');
  for (const k of vfs.nodes.keys()) if (!vfs.isDir(k) && want.includes(k.toLowerCase())) return k;
  if (isNote(p) || !KNOWN_EXT.test(p)) { const r = resolveNote(String(raw ?? '').trim().replace(/^\/+/, ''), null); if (r) return r; }
  return null;
}
const readPath = raw => findExisting(raw) || cleanPath(raw);
function writePath(raw) {
  let p = cleanPath(raw); if (p === '/') throw new Error('path is required');
  const ex = findExisting(raw);
  if (ex && [p.toLowerCase(), p.toLowerCase() + '.md'].includes(ex.toLowerCase())) return ex;
  if (!KNOWN_EXT.test(p) && !vfs.isDir(p)) p += '.md';
  if (isNote(p) && !vfs.exists(p)) {
    const k = nameKey(p); const twin = vaultIndex().notes.find(q => nameKey(q) === k);
    if (twin && !/^(skill|agents|soul|system|readme|index)\.md$/i.test(vfs.base(p))) throw new Error(`A note named "${noteName(twin)}" already exists at ${twin}. Do not create a duplicate: read ${twin} and use edit to change it, or write to exactly "${twin}" to replace it. If you really need a separate note, pick a clearly different name.`);
  }
  return p;
}

function renderTex(el) {
  const tex = el.dataset.tex || '', disp = el.dataset.display === '1';
  if (window.katex) { try { el.innerHTML = katex.renderToString(tex, { displayMode: disp, throwOnError: false, strict: 'ignore', trust: false, maxExpand: 500 }); el.classList.add('math-ok'); return; } catch (e) { el.title = e.message; } }
  el.textContent = disp ? `$$${tex}$$` : `$${tex}$`; el.classList.add('math-raw');
}
