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
  return out.sort(VAULT_COLL.compare);
}
const WIKI_RE = /\[\[([^\[\]\n|#]+)(#[^\[\]\n|]*)?(?:\|([^\[\]\n]+))?\]\]/g;
const TAG_RE = /(^|[\s(\[,;])#([A-Za-z][\w\/-]*)/g;
const stripCode = (md) => String(md).replace(/^(```|~~~)[\s\S]*?^\1/gm, ' ').replace(/`[^`\n]*`/g, ' ').replace(/\$\$[\s\S]*?\$\$/g, ' ').replace(/\$(?!\s)[^$\n]+?\$/g, ' ');
const KNOWN_EXT = /\.(md|markdown|txt|js|mjs|cjs|ts|json|csv|tsv|html?|css|sh|py|ya?ml|xml|svg|log|ini|toml|png|jpe?g|gif|webp|pdf)$/i;
const nameKey = s => noteName(s).toLowerCase().replace(/[\s_\-]+/g, ' ').trim();
// O(1) basename / normalised-name lookups for link resolution, built once per notes array (a rebuild makes a new array)
const _lookupCache = new WeakMap();
function noteLookup(notes) {
  let L = _lookupCache.get(notes);
  if (!L) {
    L = { byBase: new Map(), byKey: new Map() };
    for (const p of notes) {
      const b = vfs.base(p).toLowerCase(), k = nameKey(p);
      (L.byBase.get(b) || L.byBase.set(b, []).get(b)).push(p);
      if (k) (L.byKey.get(k) || L.byKey.set(k, []).get(k)).push(p);
    }
    _lookupCache.set(notes, L);
  }
  return L;
}
function resolveNote(target, fromPath) {
  let t = String(target ?? '').trim().replace(/\\/g, '/');
  if (!t) return null;
  if (!isNote(t)) t += '.md';
  const notes = Vault.index?.notes || allNotes();
  const dir = fromPath ? vfs.parent(fromPath) : '/';
  for (const cand of [vfs.norm(t, dir), vfs.norm(t, '/')]) if (vfs.isFile(cand)) return cand;
  const lc = t.toLowerCase(), base = lc.split('/').pop();
  const L = noteLookup(notes);
  let hits = lc.includes('/') ? (L.byBase.get(base) || []).filter(p => p.toLowerCase().endsWith('/' + lc.replace(/^\/+/, ''))) : [];
  if (!hits.length) hits = L.byBase.get(base) || [];
  if (!hits.length) { const k = nameKey(base); if (k) hits = L.byKey.get(k) || []; }
  hits = hits.slice();
  if (!hits.length) return null;
  hits.sort((a, b) => (vfs.parent(b) === dir) - (vfs.parent(a) === dir) || a.length - b.length || a.localeCompare(b));
  return hits[0];
}
// Per-note parse cache (links, tags and word count only, never the text: on Android the vault lives on the phone's storage). A note's links, tags and word count only change when its file node is replaced (every write makes a new
// node), so a rebuild re-reads only the notes that changed. Link resolution depends on the set of paths, so it is redone only
// when that set changed (a note added, removed or renamed) and otherwise reused per note.
const VaultParsed = new Map();
const VAULT_COLL = new Intl.Collator();
const nodeSig = n => `${n.size != null ? n.size : n.data?.length ?? 0}:${n.mtime || 0}`;   // a disk node's size is known without reading the file
function noteParse(p) {
  const n = vfs.nodes.get(p); let e = VaultParsed.get(p);
  if (e && (e.node === n || (e.node == null && n && e.sig === nodeSig(n)))) { e.node = n; return e; }   // e.node null: saved by the last session
  let text = ''; try { text = vfs.read(p); } catch {}
  const body = stripCode(text), wiki = [], md = [], tags = new Set();
  for (const m of body.matchAll(WIKI_RE)) { if (body[m.index - 1] === '!' && /\.\w{2,5}$/.test(m[1].trim()) && !/\.(md|markdown)$/i.test(m[1].trim())) continue; wiki.push(m[1]); }   // ![[image.png]] is an embed, not a note link
  for (const m of body.matchAll(/\]\(([^)\s]+\.(?:md|markdown))(?:#[^)]*)?\)/gi)) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(m[1])) continue;
    let target; try { target = decodeURIComponent(m[1]); } catch { target = m[1]; }
    md.push(target);
  }
  for (const m of body.matchAll(TAG_RE)) { const tag = m[2].replace(/[\/-]+$/, '').toLowerCase(); if (tag) tags.add(tag); }
  e = { node: n, sig: n ? nodeSig(n) : '', wiki, md, tags, words: (text.match(/\S+/g) || []).length, pv: -1, out: null, miss: null };
  VaultParsed.set(p, e); VaultParsed.dirty = true; return e;
}
// the parse cache is saved, so the next launch does not re-read every note from storage to build the index
let vpLoaded = false, vpSaveT = 0;
idb.get('vaultParse').then(x => {
  if (x?.v !== 1 || !Array.isArray(x.e)) return;
  for (const [p, sig, wiki, md, tags, words] of x.e) if (!VaultParsed.has(p)) VaultParsed.set(p, { node: null, sig, wiki, md, tags: new Set(tags), words, pv: -1, out: null, miss: null });
}).catch(() => {}).finally(() => { vpLoaded = true; });
function vaultParseSave() {
  if (!vpLoaded || !VaultParsed.dirty) return; clearTimeout(vpSaveT);
  vpSaveT = setTimeout(() => { VaultParsed.dirty = false; idb.set('vaultParse', { v: 1, e: [...VaultParsed].filter(([, e]) => e.node).map(([p, e]) => [p, e.sig, e.wiki, e.md, [...e.tags], e.words]) }); }, 5000);
}
// lower-cased note text for search: a small cache with a fixed budget, so repeated searches do not re-read storage, without holding the vault in memory
const NoteLC = { map: new Map(), chars: 0, max: 6e6,
  get(p) {
    const n = vfs.nodes.get(p), c = this.map.get(p);
    if (c && c.node === n) { this.map.delete(p); this.map.set(p, c); return c.lc; }
    if (c) { this.chars -= c.lc.length; this.map.delete(p); }
    let lc; try { lc = vfs.read(p).toLowerCase(); } catch { return null; }
    if (lc.length < 300000) { this.map.set(p, { node: n, lc }); this.chars += lc.length; for (const [k, v] of this.map) { if (this.chars <= this.max) break; this.map.delete(k); this.chars -= v.lc.length; } }
    return lc;
  } };
// on the phone: parse every note that is not cached yet on all cores, straight from storage (only files whose
// contents on storage are what the page has: nothing waiting to be written, same size and time)
function nativeParse(notes) {
  if (!RustCore.native || !vfs.diskOn || vfs.ops.length) return;
  const want = [];
  for (const p of notes) {
    const n = vfs.nodes.get(p), e = VaultParsed.get(p);
    if (!n || n.dirty || (e && (e.node === n || (e.node == null && e.sig === nodeSig(n))))) continue;
    want.push([p, '']);
  }
  if (want.length < 8) return;   // a few notes: not worth the trip
  let got; try { got = RustCore.parseNative(want); } catch (x) { console.warn('native parse', x.message); return; }
  for (const [p] of want) {
    const r = got[p], n = vfs.nodes.get(p);
    if (!r || !n || r.sig !== nodeSig(n)) continue;   // changed on storage since the last scan: read it the usual way
    VaultParsed.set(p, { node: n, sig: r.sig, wiki: r.wiki, md: r.md, tags: new Set(r.tags), words: r.words, pv: -1, out: null, miss: null });
    VaultParsed.dirty = true;
  }
}
function buildIndex() {
  let notes = allNotes(); const prev = Vault.index;
  const same = !!prev && prev.nodeCount === vfs.nodes.size && prev.notes.length === notes.length && prev.notes.every((x, i) => x === notes[i]);
  if (same) notes = prev.notes; else Vault.pv = (Vault.pv || 0) + 1;
  const idx = { notes, out: new Map(), back: new Map(), tags: new Map(), missing: new Map(), words: 0, nodeCount: vfs.nodes.size };
  Vault.index = idx;
  for (const p of notes) idx.back.set(p, new Set());
  nativeParse(notes);
  for (const p of notes) {
    const e = noteParse(p);
    if (e.pv !== Vault.pv) {
      const out = new Set(), miss = new Set();
      for (const t of e.wiki) { const r = resolveNote(t, p); if (r) { if (r !== p) out.add(r); } else miss.add(t.trim()); }
      for (const t of e.md) { const r = resolveNote(t, p); if (r && r !== p) out.add(r); }
      e.out = out; e.miss = miss; e.pv = Vault.pv;
    }
    for (const r of e.out) idx.back.get(r)?.add(p);
    idx.out.set(p, e.out); idx.missing.set(p, e.miss);
    for (const tag of e.tags) { let st = idx.tags.get(tag); if (!st) idx.tags.set(tag, st = new Set()); st.add(p); }
    idx.words += e.words;
  }
  if (VaultParsed.size > notes.length + 64) { const keep = new Set(notes); for (const k of VaultParsed.keys()) if (!keep.has(k)) VaultParsed.delete(k); VaultParsed.dirty = true; }
  vaultParseSave();
  Vault.dirty = false;
  return idx;
}
const vaultIndex = () => (Vault.dirty || !Vault.index ? buildIndex() : Vault.index);
vfs.listeners.add(() => { Vault.dirty = true; });
function noteTags(p) { const idx = vaultIndex(); return [...idx.tags.entries()].filter(([, s]) => s.has(p)).map(([t]) => t).sort(); }
function searchNotes(query, limit = 20) {
  const q = String(query ?? '').trim(); if (!q) return [];
  const idx = vaultIndex(), cand = [];
  const tagQ = /^#[\w\/-]+$/.test(q) ? q.slice(1).toLowerCase() : null;
  const terms = tagQ ? [] : q.toLowerCase().split(/\s+/).filter(Boolean);
  let tagHit = null; if (tagQ) { tagHit = new Set(); for (const [t, st] of idx.tags) if (t === tagQ || t.startsWith(tagQ + '/')) for (const p of st) tagHit.add(p); }
  // on the phone, when the notes are not in memory yet (or do not fit), search them natively on all cores straight
  // from storage instead of pulling each through the WebView bridge
  if (RustCore.native && vfs.diskOn && !vfs.ops.length && idx.notes.length > 50) {
    let warm = 0; for (const p of idx.notes) { const c = NoteLC.map.get(p); if (c && c.node === vfs.nodes.get(p)) warm++; }
    if (warm < idx.notes.length * 0.9) {
      try { const back = {}; for (const [p, st] of idx.back) if (st.size) back[p] = st.size; return RustCore.searchNative({ q, paths: idx.notes, backlinks: back, tag_hit: tagHit ? [...tagHit] : null, limit }); }
      catch (x) { console.warn('native search', x.message); }
    }
  }
  for (const p of idx.notes) {
    if (tagQ && !tagHit.has(p)) continue;
    const lc = NoteLC.get(p); if (lc == null) continue;   // capped cache; the vault itself stays on storage
    const name = noteName(p).toLowerCase(), pl = p.toLowerCase();
    if (!tagQ && !terms.every(t => lc.includes(t) || pl.includes(t))) continue;
    let score = 0, first = -1;
    for (const t of terms) {
      if (name === t) score += 30; else if (name.includes(t)) score += 12;
      let i = -1, c = 0; while ((i = lc.indexOf(t, i + 1)) >= 0 && c < 60) { if (first < 0 || i < first) first = i; c++; }
      score += c;
    }
    if (tagQ) { first = lc.indexOf('#' + tagQ); score = 1; }
    score += Math.min(5, idx.back.get(p)?.size || 0) * 0.5;
    cand.push({ path: p, score, first });
  }
  cand.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  return cand.slice(0, limit).map(c => {   // snippets only for what is returned
    let text = ''; try { text = vfs.read(c.path); } catch {}
    const s = Math.max(0, (c.first < 0 ? 0 : c.first) - 50);
    return { path: c.path, score: c.score, snippet: (s ? '…' : '') + text.slice(s, s + 190).replace(/\s+/g, ' ').trim() + (text.length > s + 190 ? '…' : '') };
  });
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
// for tests and the console
Object.defineProperties(window, { RustCore: { value: RustCore }, VaultParsed: { value: VaultParsed }, Vault: { value: Vault }, noteParse: { value: noteParse }, searchNotes: { value: searchNotes, configurable: true }, NoteLC: { value: NoteLC } });
