/* =====================================================================
   NOTE SCRIPTS & TEMPLATES (Obsidian style)
   - Live scripts, run while a note is shown in Read or Split view:
       ```dataviewjs  /  ```jade-js   blocks, with a Dataview-like `dv` (dv.pages, dv.table, dv.list …)
       `$= expression`                 inline values
   - Templates (Templater syntax) in the templates folder (default /Templates):
       <% tp.date.now("YYYY-MM-DD") %>  <% tp.file.title %>  <%* code; tR += "text" %>  <%- … -%> trims a line break
     Insert one with the {} button in the editor's toolbar, or run the tags already in a note.
   The code runs in the node sandbox with no network and no file writes. It can read the vault.
   Calling Jade's tools (jade.tool, jade.decide, jade.ask, jade.flow …) needs Config → Tools →
   "Let leaf scripts and templates call Pandora's tools", because a leaf written from web content could otherwise run them.
   ===================================================================== */
const TPL_LANGS = ['dataviewjs', 'jade-js', 'jadejs'];
const TplState = { stamp: 0, cache: new Map(), pages: null, pagesStamp: -1, queue: Promise.resolve() };
// note at once (not after the 60 ms listener debounce) that the vault changed, so a note written and opened
// right away is already in the index the scripts see
{ const changed0 = vfs.changed.bind(vfs); vfs.changed = function () { TplState.stamp++; Vault.dirty = true; return changed0(); }; }
const tplDir = () => vfs.norm(String(S.tplDir || '/Templates').trim() || '/Templates');

// a small YAML subset for frontmatter: key: value, key: [a, b], and "key:" followed by "- item" lines
function tplYaml(fm) {
  const out = {}; let listKey = null;
  const val = v => { v = v.trim(); if (!v) return null; if (/^\[.*\]$/.test(v)) return v.slice(1, -1).split(',').map(x => val(x)).filter(x => x !== null && x !== ''); if (/^(['"]).*\1$/.test(v)) return v.slice(1, -1); if (/^-?\d+(\.\d+)?$/.test(v)) return +v; if (/^(true|false)$/i.test(v)) return /^true$/i.test(v); if (/^(null|~)$/i.test(v)) return null; return v; };
  for (const line of String(fm || '').split(/\r?\n/)) {
    const li = /^\s+-\s+(.*)$/.exec(line); if (li && listKey) { (out[listKey] = Array.isArray(out[listKey]) ? out[listKey] : []).push(val(li[1])); continue; }
    const m = /^([\w][\w -]*?)\s*:\s*(.*)$/.exec(line); if (!m) { listKey = null; continue; }
    const k = m[1].trim(); const v = val(m[2]); out[k] = v; listKey = v === null ? k : null;
  }
  return out;
}
// everything a script may want to know about the vault's notes (built once per vault change)
function tplPages() {
  if (TplState.pages && TplState.pagesStamp === TplState.stamp) return TplState.pages;
  const idx = vaultIndex(); const tagsOf = new Map(); const nameCount = new Map();
  for (const [t, set] of idx.tags) for (const p of set) (tagsOf.get(p) || tagsOf.set(p, []).get(p)).push(t);
  for (const p of idx.notes) { const k = noteName(p).toLowerCase(); nameCount.set(k, (nameCount.get(k) || 0) + 1); }
  const link = p => nameCount.get(noteName(p).toLowerCase()) > 1 ? p.slice(1).replace(/\.(md|markdown)$/i, '') : noteName(p);
  const pages = idx.notes.map(p => {
    let text = ''; try { text = vfs.read(p); } catch {}
    const n = vfs.nodes.get(p); const meta = tplYaml(splitFrontmatter(text).fm);
    const fmTags = [].concat(meta.tags ?? meta.tag ?? []).flatMap(x => String(x).split(/[\s,]+/)).map(x => x.replace(/^#/, '').toLowerCase()).filter(Boolean);
    const tags = [...new Set([...(tagsOf.get(p) || []), ...fmTags])].sort();
    const tasks = []; let line = 0, fence = false;
    for (const l of text.split('\n')) { line++; if (/^\s*(```|~~~)/.test(l)) fence = !fence; if (fence) continue; const m = /^\s*[-*+] \[( |x|X)\] (.+)$/.exec(l); if (m) tasks.push({ text: m[2], completed: m[1] !== ' ', line, path: p }); }
    const day = /(\d{4}-\d{2}-\d{2})/.exec(noteName(p))?.[1] || null;
    return { ...meta, file: { name: noteName(p), path: p, folder: vfs.parent(p), link: `[[${link(p)}]]`, linkName: link(p), ext: (p.split('.').pop() || '').toLowerCase(), size: n?.data?.length || 0, mtime: n?.mtime || 0, ctime: n?.ctime || n?.mtime || 0, tags: tags.map(t => '#' + t), outlinks: [...(idx.out.get(p) || [])], inlinks: [...(idx.back.get(p) || [])], tasks, day, frontmatter: meta } };
  });
  TplState.pages = pages; TplState.pagesStamp = TplState.stamp; return pages;
}

/* ---------- the library that runs inside the sandbox (stringified into the script) ---------- */
function __tplLib(T, $date) {
  const pages = T.pages || [];
  const byPath = new Map(pages.map(p => [p.file.path, p]));
  const findPage = ref => {
    if (ref && typeof ref === 'object') ref = ref.file?.path || ref.path || '';
    let r = String(ref ?? '').trim().replace(/^\[\[|\]\]$/g, '').split('|')[0].split('#')[0].trim(); if (!r) return null;
    if (byPath.has(r)) return byPath.get(r); const md = /\.(md|markdown)$/i.test(r) ? r : r + '.md';
    if (byPath.has(md)) return byPath.get(md); if (byPath.has('/' + md.replace(/^\/+/, ''))) return byPath.get('/' + md.replace(/^\/+/, ''));
    const lc = r.toLowerCase().replace(/\.(md|markdown)$/i, ''); return pages.find(p => p.file.name.toLowerCase() === lc) || pages.find(p => p.file.path.toLowerCase().endsWith('/' + lc + '.md')) || null;
  };
  const get = (o, k) => typeof k === 'function' ? k(o) : String(k).split('.').reduce((x, y) => x == null ? undefined : x[y], o);
  const cmp = (a, b) => { if (a == null && b == null) return 0; if (a == null) return -1; if (b == null) return 1; if (a instanceof Date) a = +a; if (b instanceof Date) b = +b; if (typeof a === 'number' && typeof b === 'number') return a - b; return String(a).localeCompare(String(b), undefined, { numeric: true }); };
  class DA extends Array {
    static of2(a) { const d = new DA(); for (const x of a) d.push(x); return d; }
    where(f) { return DA.of2([...this].filter(f)); }
    sort(k, dir) { const arr = [...this]; if (typeof k === 'function' && k.length >= 2) return DA.of2(arr.sort(k)); const key = k == null ? (x => x) : (x => get(x, k)); arr.sort((a, b) => cmp(key(a), key(b))); if (String(dir).toLowerCase() === 'desc') arr.reverse(); return DA.of2(arr); }
    limit(n) { return DA.of2([...this].slice(0, n)); }
    groupBy(k) { const m = new Map(); for (const x of this) { const g = get(x, k); const key = typeof g === 'object' && g !== null ? JSON.stringify(g) : g; if (!m.has(key)) m.set(key, { key: g, rows: new DA() }); m.get(key).rows.push(x); } return DA.of2([...m.values()]); }
    distinct(k) { const seen = new Set(); return DA.of2([...this].filter(x => { const v = JSON.stringify(k ? get(x, k) : x); if (seen.has(v)) return false; seen.add(v); return true; })); }
    pluck(k) { return DA.of2([...this].map(x => get(x, k))); }
    first() { return this[0]; } last() { return this[this.length - 1]; } array() { return [...this]; } get values() { return [...this]; }
    sum(k) { return [...this].reduce((a, x) => a + (+(k ? get(x, k) : x) || 0), 0); }
  }
  const matchAtom = (p, atom) => {
    atom = atom.trim(); let neg = false; if (atom.startsWith('-')) { neg = true; atom = atom.slice(1).trim(); }
    let ok;
    if (atom.startsWith('#')) { const t = atom.slice(1).toLowerCase(); ok = p.file.tags.some(x => x.slice(1) === t || x.slice(1).startsWith(t + '/')); }
    else if (/^"[^"]*"$/.test(atom)) { const f = '/' + atom.slice(1, -1).replace(/^\/+|\/+$/g, ''); ok = f === '/' || p.file.path.startsWith(f + '/') || p.file.path === f || p.file.path === f + '.md'; }
    else if (/^\[\[.*\]\]$/.test(atom)) { const t = findPage(atom); ok = !!t && (p.file.outlinks.includes(t.file.path) || p.file.path === t.file.path); }
    else ok = p.file.path.toLowerCase().includes(atom.toLowerCase());
    return neg ? !ok : ok;
  };
  const query = src => { src = String(src ?? '').trim(); if (!src) return pages; return pages.filter(p => src.split(/\s+or\s+/i).some(part => part.split(/\s+and\s+/i).every(a => matchAtom(p, a)))); };
  const ops = [];
  const cell = v => v == null ? '' : v instanceof Date ? $date('YYYY-MM-DD', v) : Array.isArray(v) ? v.map(cell).join(', ') : typeof v === 'object' ? (v.file?.path ? `[[${v.file.linkName || v.file.name}]]` : typeof v.path === 'string' && /\.(md|markdown)$/i.test(v.path) ? `[[${v.path.slice(1).replace(/\.(md|markdown)$/i, '')}]]` : JSON.stringify(v)) : String(v);
  const dv = {
    pages: src => DA.of2(query(src)),
    pagePaths: src => DA.of2(query(src).map(p => p.file.path)),
    page: ref => findPage(ref),
    current: () => byPath.get(T.path) || null,
    array: a => DA.of2(Array.isArray(a) ? a : a == null ? [] : [a]),
    isArray: a => Array.isArray(a),
    compare: cmp,
    date: s => s === 'today' ? new Date(new Date().setHours(0, 0, 0, 0)) : s === 'now' ? new Date() : new Date(typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s + 'T00:00:00' : s),
    fileLink: (path, embed, display) => { const p = findPage(path); const name = p ? p.file.linkName : String(path).replace(/\.(md|markdown)$/i, ''); return `${embed ? '!' : ''}[[${name}${display ? '|' + display : ''}]]`; },
    table: (headers, rows) => { ops.push({ t: 'table', h: [...(headers || [])].map(cell), r: [...(rows || [])].map(r => [...(Array.isArray(r) ? r : [r])].map(cell)) }); },
    list: items => { ops.push({ t: 'list', items: [...(items || [])].map(cell) }); },
    taskList: (tasks, group = true) => { ops.push({ t: 'tasks', group: !!group, items: [...(tasks || [])].map(x => ({ text: cell(x.text ?? x), done: !!x.completed, path: x.path || '' })) }); },
    header: (n, text) => { ops.push({ t: 'h', n: Math.min(6, Math.max(1, n | 0 || 2)), text: cell(text) }); },
    paragraph: text => { ops.push({ t: 'p', text: cell(text) }); },
    span: text => { ops.push({ t: 'span', text: cell(text) }); },
    el: (tag, text, o = {}) => { ops.push({ t: 'el', tag: String(tag), text: cell(text), cls: o.cls || o.attr?.class || '' }); },
    markdown: text => { ops.push({ t: 'p', text: cell(text) }); },
    io: { load: async ref => { const p = findPage(ref); const path = p ? p.file.path : String(ref); return fs.readFileSync(path, 'utf8'); } },
  };
  const tfile = { title: T.title, content: T.content, tags: T.tags || [], path: rel => rel ? String(T.path || '').replace(/^\/+/, '') : T.path, folder: rel => rel ? T.folder : String(T.folder || '/').split('/').filter(Boolean).pop() || '/',
    creation_date: f => $date(f || 'YYYY-MM-DD HH:mm', T.ctime ? new Date(T.ctime) : new Date()), last_modified_date: f => $date(f || 'YYYY-MM-DD HH:mm', T.mtime ? new Date(T.mtime) : new Date()),
    cursor: () => '\u0001CURSOR\u0001', exists: ref => !!findPage(ref),
    include: async ref => { const p = findPage(ref); if (!p) throw new Error(`tp.file.include: no note ${ref}`); const txt = fs.readFileSync(p.file.path, 'utf8'); return T.depth < 5 ? await __tplRun(txt, T.depth + 1) : txt; } };
  const ref = r => r == null ? new Date() : typeof r === 'string' && /^\d{4}-\d{2}-\d{2}/.test(r) ? new Date(r.slice(0, 10) + 'T00:00:00') : new Date(r);
  const tp = {
    date: { now: (f, off, r) => $date(f || 'YYYY-MM-DD', ref(r), typeof off === 'number' ? off : 0), tomorrow: f => $date(f || 'YYYY-MM-DD', new Date(), 1), yesterday: f => $date(f || 'YYYY-MM-DD', new Date(), -1),
      weekday: (f, wd, r) => { const d = ref(r); return $date(f || 'YYYY-MM-DD', d, (+wd || 0) - d.getDay()); } },
    file: tfile, frontmatter: T.frontmatter || {},
    system: { prompt: async (msg, def) => jade.prompt(msg, def), suggester: async (texts, items, _t, placeholder) => { const arr = [...(items || [])]; const labels = typeof texts === 'function' ? arr.map(texts) : [...(texts || [])]; const i = await jade.suggest(labels, labels.map((_, k) => k), placeholder); return i == null ? null : arr[i]; }, clipboard: async () => '' },
    config: { template_file: { path: T.templatePath || '', basename: String(T.templatePath || '').split('/').pop().replace(/\.(md|markdown)$/i, '') }, target_file: { path: T.path, basename: T.title } },
    user: {},
  };
  const __str = v => v == null ? '' : typeof v === 'object' ? (v instanceof Date ? $date('YYYY-MM-DD', v) : JSON.stringify(v)) : String(v);
  async function __tplRun(text, depth) { const fn = new (Object.getPrototypeOf(async function () {}).constructor)('tp', 'dv', 'jade', 'pandora', 'fs', '__str', T.compiledOf(text)); return await fn(tp, dv, jade, jade, fs, __str); }
  return { dv, tp, ops, cell, __str, __tplRun };
}
// Templater text → JavaScript that builds tR
function tplCompile(text) {
  let code = 'let tR = "";\n'; const re = /<%([*+]?)([-_]?)([\s\S]*?)([-_]?)%>/g; let m, last = 0, trimNext = null;
  const lit = s => { if (trimNext === '-') s = s.replace(/^[ \t]*\r?\n/, ''); else if (trimNext === '_') s = s.replace(/^\s+/, ''); return s; };
  while ((m = re.exec(text))) {
    let before = lit(text.slice(last, m.index)); trimNext = null;
    if (m[2] === '-') before = before.replace(/\r?\n[ \t]*$/, ''); else if (m[2] === '_') before = before.replace(/\s+$/, '');
    if (before) code += `tR += ${JSON.stringify(before)};\n`;
    const body = m[3];
    if (m[1] === '*') code += body + '\n'; else if (body.trim()) code += `tR += __str(await (${body.trim()}\n));\n`;
    trimNext = m[4] || null; last = re.lastIndex;
  }
  const tail = lit(text.slice(last)); if (tail) code += `tR += ${JSON.stringify(tail)};\n`;
  return code + 'return tR;';
}
const TPL_LIB_SRC = `const __L = (${__tplLib.toString()})(__T, ${jvDate.toString()});\nconst { dv, tp, __str } = __L;\n`;
function tplAllow() { return S.tplTools ? null : new Set(['ui.prompt', 'ui.suggest']); }
function tplContext(path, extra = {}) {
  let text = ''; try { if (path && vfs.isFile(path)) text = vfs.read(path); } catch {}
  const n = path ? vfs.nodes.get(path) : null; const page = path ? tplPages().find(p => p.file.path === path) : null;
  return { pages: tplPages(), path: path || '', title: path ? noteName(path) : '', folder: path ? vfs.parent(path) : '/', content: text, tags: page ? page.file.tags : [], frontmatter: page ? page.file.frontmatter : {}, ctime: n?.ctime || n?.mtime || 0, mtime: n?.mtime || 0, depth: 0, ...extra };
}
// run a script against the vault; returns { ops, value, out, error }
async function tplExec(body, path, { ui = false, extra = {} } = {}) {
  const T = tplContext(path, extra);
  // tp.file.include runs nested templates, so the Templater compiler goes into the sandbox too
  const pre = `__T.compiledOf = (txt) => (${tplCompile.toString()})(txt);\n` + TPL_LIB_SRC;
  const r = await runNodeScript({ code: pre + body, argv: [path || '[template]'], globals: { __T: T }, readOnly: true, noNet: true, bridge: true, allow: tplAllow(), ui, timeoutMs: 20000, lineShift: pre.split('\n').length - 1, via: 'template' });
  const out = r.out.filter(x => x[0] === 'o').map(x => x[1]).join(''), err = r.out.filter(x => x[0] === 'e').map(x => x[1]).join('').split('\n').filter(l => !/^\s+at\s/.test(l)).join('\n').trim();
  return { ops: r.ret?.__dv || [], value: r.ret?.__v, text: r.ret?.__t, out, error: r.code !== 0 ? (err || `exit code ${r.code}`) : null };
}

/* ---------- live blocks in Read / Split view ---------- */
const tplMd = (text, path, inline = true) => { const prev = Vault.renderFrom; Vault.renderFrom = path; try { const s = String(text ?? ''); return window.marked && window.DOMPurify ? DOMPurify.sanitize(inline ? marked.parseInline(s) : marked.parse(s)) : esc(s); } finally { Vault.renderFrom = prev; } };
function tplRenderOps(ops, path) {
  const ALLOWED = new Set(['p', 'span', 'div', 'b', 'i', 'em', 'strong', 'code', 'blockquote', 'li', 'small', 'mark', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
  return ops.map(o => {
    if (o.t === 'table') return `<div class="jv-dv-wrap"><table class="jv-dv-table"><thead><tr>${o.h.map(h => `<th>${tplMd(h, path)}</th>`).join('')}</tr></thead><tbody>${o.r.map(r => `<tr>${r.map(c => `<td>${tplMd(c, path)}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${o.h.length || 1}" class="hint">no results</td></tr>`}</tbody></table></div>`;
    if (o.t === 'list') return `<ul>${o.items.map(x => `<li>${tplMd(x, path)}</li>`).join('')}</ul>`;
    if (o.t === 'tasks') { const groups = new Map(); for (const t of o.items) { const k = o.group ? t.path : ''; (groups.get(k) || groups.set(k, []).get(k)).push(t); } return [...groups].map(([p, ts]) => `${p ? `<div class="jv-dv-group">${tplMd(`[[${noteName(p)}]]`, path)}</div>` : ''}<ul class="contains-task-list">${ts.map(t => `<li class="md-task${t.done ? ' done' : ''}"><input type="checkbox" disabled ${t.done ? 'checked' : ''}> ${tplMd(t.text, path)}</li>`).join('')}</ul>`).join(''); }
    if (o.t === 'h') return `<h${o.n}>${tplMd(o.text, path)}</h${o.n}>`;
    if (o.t === 'p') return `<div class="jv-dv-p">${tplMd(o.text, path, false)}</div>`;
    if (o.t === 'span') return `<span>${tplMd(o.text, path)}</span>`;
    if (o.t === 'el') { const tag = ALLOWED.has(String(o.tag).toLowerCase()) ? String(o.tag).toLowerCase() : 'span'; return `<${tag}${o.cls ? ` class="${esc(String(o.cls).replace(/[^\w\s-]/g, ''))}"` : ''}>${tplMd(o.text, path)}</${tag}>`; }
    return '';
  }).join('');
}
function tplRunQueued(fn) { const p = TplState.queue.then(fn, fn); TplState.queue = p.catch(() => {}); return p; }
async function tplBlock(code, path, inline) {
  const key = `${path}\u0001${TplState.stamp}\u0001${inline ? 'i' : 'b'}\u0001${code}`;
  if (TplState.cache.has(key)) return TplState.cache.get(key);
  const body = inline ? `return { __v: __L.cell(await (async () => (${code}\n))()), __dv: [] };` : `await (async () => {\n${code}\n})();\nreturn { __dv: __L.ops };`;
  const r = await tplRunQueued(() => tplExec(body, path));
  if (TplState.cache.size > 200) TplState.cache.delete(TplState.cache.keys().next().value);
  TplState.cache.set(key, r); return r;
}
function tplHydrate(root, path) {
  if (!root || S.tplOn === false) return;
  const blocks = [...root.querySelectorAll('pre > code')].filter(c => TPL_LANGS.some(l => c.classList.contains('language-' + l)));
  const inl = [...root.querySelectorAll('code')].filter(c => !c.closest('pre') && /^\$=\s*\S/.test(c.textContent));
  for (const c of blocks) {
    const code = c.textContent; const box = document.createElement('div'); box.className = 'jv-js'; box.innerHTML = '<div class="hint jv-js-wait">running…</div>';
    c.closest('pre').replaceWith(box);
    tplBlock(code, path, false).then(r => {
      if (!box.isConnected) return;
      box.innerHTML = tplRenderOps(r.ops, path) + (r.out.trim() ? `<pre class="jv-js-log">${esc(redactSecrets(r.out.trim()))}</pre>` : '') + (r.error ? `<div class="jv-js-err">${esc(r.error)}</div>` : '') + (!r.ops.length && !r.out.trim() && !r.error ? '<div class="hint">(the script showed nothing: use dv.table, dv.list, dv.paragraph or console.log)</div>' : '');
    });
  }
  for (const c of inl) {
    const code = c.textContent.replace(/^\$=\s*/, ''); const span = document.createElement('span'); span.className = 'jv-js-inline'; span.textContent = '…'; span.title = code;
    c.replaceWith(span);
    tplBlock(code, path, true).then(r => { if (!span.isConnected) return; if (r.error) { span.className = 'jv-js-inline err'; span.textContent = '⚠ ' + r.error.split('\n')[0].slice(0, 120); } else span.innerHTML = tplMd(r.value ?? '', path); });
  }
}

/* ---------- templates: insert into the open note, or run the tags already in it ---------- */
async function tplRender(text, targetPath, { templatePath = '', ui = true } = {}) {
  const body = `return { __t: await (async () => { ${tplCompile(String(text))} })() };`;
  const r = await tplExec(body, targetPath, { ui, extra: { templatePath } });
  if (r.error) throw new Error(r.error);
  return String(r.text ?? '');
}
function tplList() { const d = tplDir(); const pre = d === '/' ? '/' : d + '/'; return [...vfs.nodes.keys()].filter(p => p.startsWith(pre) && isNote(p) && vfs.isFile(p)).sort(); }
const TPL_EXAMPLE = `---
created: <% tp.date.now("YYYY-MM-DD HH:mm") %>
tags: daily
---
# <% tp.file.title %>

<% tp.date.now("dddd, D MMMM YYYY") %> · [[<% tp.date.yesterday() %>|← yesterday]] · [[<% tp.date.tomorrow() %>|tomorrow →]]

## Focus
- <% tp.file.cursor() %>

## Open tasks across the vault
<%* const open = dv.pages().flatMap(p => p.file.tasks).filter(t => !t.completed).slice(0, 10);
for (const t of open) tR += "- [ ] " + t.text + " (" + t.path.split("/").pop().replace(".md", "") + ")\\n"; -%>

## Notes
`;
async function tplInsertFlow() {
  if (!editing || !isNote(editing)) { toast('Open a leaf first', 'err'); return; }
  flushSave();
  const list = tplList(); const here = $('#fileEd').value; const hasTags = /<%[\s\S]*?%>/.test(here);
  const labels = [...list.map(p => p.slice(tplDir().length + 1).replace(/\.(md|markdown)$/i, '')), ...(hasTags ? ['⟳ Run the <% %> tags in this note'] : []), ...(list.length ? [] : [`＋ Create an example template in ${tplDir()}`])];
  const i = await jvDialog({ title: list.length ? 'Insert template' : 'No templates yet', message: list.length ? '' : `Templates are notes in ${tplDir()} (change it in Config → Tools). They use Templater tags like <% tp.date.now() %>.`, items: labels });
  if (i == null) return;
  if (i >= list.length) {
    const label = labels[i];
    if (label.startsWith('＋')) { const p = `${tplDir()}/Daily note.md`; if (!vfs.exists(p)) vfs.write(p, TPL_EXAMPLE, { mkdirs: true }); toast(`Created ${esc(p)}. Tap {} again to use it.`, 'ok'); return; }
    try { const out = await tplRender(here, editing); tplPut(out, 'all'); toast('Ran the template tags', 'ok'); } catch (e) { toast('Template error: ' + esc(e.message), 'err'); }
    return;
  }
  try { const tpl = vfs.read(list[i]); const out = await tplRender(tpl, editing, { templatePath: list[i] }); tplPut(out, here.trim() ? 'cursor' : 'all'); toast(`Inserted ${esc(labels[i])}`, 'ok'); }
  catch (e) { toast('Template error: ' + esc(e.message), 'err'); }
}
function tplPut(text, where) {
  const ta = $('#fileEd'); const CUR = '\u0001CURSOR\u0001'; const at = text.indexOf(CUR); const clean = text.split(CUR).join('');
  let s, e; if (where === 'all') { s = 0; e = ta.value.length; } else { s = ta.selectionStart; e = ta.selectionEnd; }
  ta.setRangeText(clean, s, e, 'end'); if (at >= 0) ta.setSelectionRange(s + at, s + at);
  ta.dispatchEvent(new Event('input')); saveNote(); if ($('#noteBody').dataset.mode !== 'edit') renderNotePreview();
}
(() => {
  const tools = $('#mdTools'); if (!tools) return;
  const b = document.createElement('button'); b.type = 'button'; b.dataset.tpl = '1'; b.setAttribute('aria-label', 'Insert template'); b.title = 'Insert template'; b.textContent = '{ }'; tools.appendChild(b);
  b.addEventListener('click', e => { e.stopPropagation(); tplInsertFlow(); });
})();

/* ---------- settings ---------- */
function renderTplSettings() { $('#sTplOn').checked = S.tplOn !== false; $('#sTplTools').checked = !!S.tplTools; $('#sTplDir').value = S.tplDir || '/Templates'; }
function tplReadFields() { TplState.cache.clear(); return { tplOn: $('#sTplOn').checked, tplTools: $('#sTplTools').checked, tplDir: $('#sTplDir').value.trim() || '/Templates' }; }
