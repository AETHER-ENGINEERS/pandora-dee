/* =====================================================================
   IMPORT FROM NOTES APPS — Google Keep, Samsung Notes, Apple Notes, and anything else that exports
   text, HTML, Word or PDF. Pick the files or a .zip with Import (or drop them on the leaf list):
   - Google Keep: the Google Takeout .zip (or its .json files). Checklists become tasks, labels become
     #sigils, images come along, pinned/archived/colour and the dates go in the front matter; notes in
     the trash stay out, archived ones go in an Archived workshop.
   - Samsung Notes: Share → Microsoft Word (.docx), PDF, or Text file. Its own .sdocx can't be read.
   - Apple Notes: the iCloud data copy from privacy.apple.com (a .zip of .txt notes), Export as PDF,
     or Markdown from an exporter app.
   - .md and .txt come in as they are, .html as markdown, .docx with headings, lists, bold, italic,
     tables and pictures, .pdf as its text (the PDF reader loads from the internet the first time).
   Everything lands in /Imported/<where it came from>/, beside a short report.
   ===================================================================== */
const IMPORT_ROOT = '/Imported';
const NOTES_APP_FILE = /\.(zip|json|html?|docx|pdf|sdocx)$/i;
const impName = s => String(s || '').replace(/[\\/:*?"<>|\[\]#^]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 90);
function impPath(dir, name, ext = '.md') {
  const base = impName(name) || 'Untitled'; let p = `${dir}/${base}${ext}`, i = 2;
  while (vfs.exists(p)) p = `${dir}/${base} ${i++}${ext}`;
  return p;
}
const impSigil = s => '#' + String(s).trim().replace(/\s+/g, '-').replace(/[^\p{L}\p{N}_\/-]/gu, '');
const impIso = ms => { try { return new Date(ms).toISOString().slice(0, 19).replace('T', ' '); } catch { return ''; } };
function impFront(meta) {
  const lines = Object.entries(meta).filter(([, v]) => v !== undefined && v !== '' && v !== false).map(([k, v]) => `${k}: ${typeof v === 'string' && (/: |\s#|:$/.test(v) || /^[\[\]{},&*?|<>=!%@`'"#-]/.test(v)) ? JSON.stringify(v) : v}`);
  return lines.length ? `---\n${lines.join('\n')}\n---\n\n` : '';
}
const impText = bytes => new TextDecoder().decode(bytes).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
const impImageExt = /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i;
function impSaveImage(name, bytes) {
  const ext = (name.match(impImageExt) || ['.png'])[0].toLowerCase();
  const p = impPath('/attachments/images', vfs.base(name).replace(impImageExt, ''), ext);
  vfs.write(p, bytes, { mkdirs: true }); return p;
}

/* ---------- HTML → markdown (Keep's .html, Apple exporters, web clippings) ---------- */
function htmlToMd(html, { image } = {}) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  for (const x of doc.querySelectorAll('script,style,head,noscript')) x.remove();
  const inline = n => [...n.childNodes].map(walk).join('');
  const block = s => '\n\n' + s.trim() + '\n\n';
  function walk(n) {
    if (n.nodeType === 3) return n.nodeValue.replace(/\s+/g, ' ');
    if (n.nodeType !== 1) return '';
    const t = n.tagName.toLowerCase(), c = () => inline(n);
    switch (t) {
      case 'br': return '\n';
      case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': return block('#'.repeat(+t[1]) + ' ' + c().trim());
      case 'p': case 'section': case 'article': return block(c());
      case 'div': { const s = c(); return /\n/.test(s) || n.parentElement?.tagName === 'BODY' ? block(s) : s + '\n'; }
      case 'b': case 'strong': { const s = c(); return s.trim() ? `**${s.trim()}**` : s; }
      case 'i': case 'em': { const s = c(); return s.trim() ? `*${s.trim()}*` : s; }
      case 's': case 'del': case 'strike': { const s = c(); return s.trim() ? `~~${s.trim()}~~` : s; }
      case 'code': return n.parentElement?.tagName === 'PRE' ? n.textContent : '`' + n.textContent + '`';
      case 'pre': return block('```\n' + n.textContent.replace(/\n$/, '') + '\n```');
      case 'blockquote': return block(c().trim().split('\n').map(l => '> ' + l).join('\n'));
      case 'a': { const h = n.getAttribute('href') || '', s = c().trim(); return h && !/^javascript:/i.test(h) ? `[${s || h}](${h})` : s; }
      case 'img': { const src = n.getAttribute('src') || ''; const got = image?.(src); return got ? `![[${embedRef(got)}]]` : /^https?:/i.test(src) ? `![](${src})` : ''; }
      case 'ul': case 'ol': {
        let i = 0;
        return block([...n.children].filter(li => li.tagName === 'LI').map(li => {
          const box = li.querySelector(':scope > input[type=checkbox]'); const txt = inline(li).trim().replace(/^[☐☑✓✔]\s*/, '');
          const done = box ? box.checked || box.hasAttribute('checked') : /^[☑✓✔]/.test(li.textContent.trim());
          const mark = box || /^[☐☑✓✔]/.test(li.textContent.trim()) ? `- [${done ? 'x' : ' '}] ` : t === 'ol' ? `${++i}. ` : '- ';
          return mark + txt.replace(/\n+/g, '\n  ');
        }).join('\n'));
      }
      case 'table': return block([...n.querySelectorAll('tr')].map((tr, k) => { const cells = [...tr.children].map(td => inline(td).trim().replace(/\|/g, '\\|').replace(/\n+/g, ' ')); return '| ' + cells.join(' | ') + ' |' + (k === 0 ? '\n|' + cells.map(() => ' --- |').join('') : ''); }).join('\n'));
      case 'hr': return block('---');
      default: return c();
    }
  }
  return inline(doc.body || doc).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

/* ---------- Word (.docx): Samsung Notes and others ---------- */
async function docxToMd(bytes) {
  const z = await unzip(bytes), xml = z['word/document.xml'];
  if (!xml) throw new Error('not a Word document (word/document.xml is missing)');
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main', R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const doc = new DOMParser().parseFromString(impText(xml), 'application/xml');
  const rels = {}; if (z['word/_rels/document.xml.rels']) for (const r of new DOMParser().parseFromString(impText(z['word/_rels/document.xml.rels']), 'application/xml').getElementsByTagName('Relationship')) rels[r.getAttribute('Id')] = r.getAttribute('Target');
  const kids = (n, name) => [...n.childNodes].filter(c => c.namespaceURI === W && c.localName === name);
  const on = (pr, name) => { const e = pr && kids(pr, name)[0]; if (!e) return false; const v = e.getAttributeNS(W, 'val'); return v == null || !/^(0|false|none)$/i.test(v); };
  const run = r => {
    const pr = kids(r, 'rPr')[0]; let s = '';
    for (const c of r.childNodes) {
      if (c.namespaceURI !== W) continue;
      if (c.localName === 't') s += c.textContent; else if (c.localName === 'tab') s += '\t'; else if (c.localName === 'br' || c.localName === 'cr') s += '\n';
      else if (c.localName === 'drawing' || c.localName === 'pict') { const blip = c.getElementsByTagNameNS('*', 'blip')[0] || c.getElementsByTagNameNS('*', 'imagedata')[0]; const id = blip?.getAttributeNS(R, 'embed') || blip?.getAttributeNS(R, 'id'); const target = id && rels[id]; const data = target && z['word/' + target.replace(/^\.?\//, '')]; if (data) s += `![[${embedRef(impSaveImage(target, data))}]]`; }
    }
    if (!s.trim() || /^!\[\[/.test(s)) return s;
    const lead = s.match(/^\s*/)[0], trail = s.match(/\s*$/)[0], core = s.trim();
    let out = core; if (on(pr, 'strike')) out = `~~${out}~~`; if (on(pr, 'i')) out = `*${out}*`; if (on(pr, 'b')) out = `**${out}**`;
    return lead + out + trail;
  };
  const para = p => {
    const pr = kids(p, 'pPr')[0], style = (pr && kids(pr, 'pStyle')[0]?.getAttributeNS(W, 'val')) || '';
    let text = [...p.childNodes].map(c => c.namespaceURI === W && c.localName === 'r' ? run(c) : c.namespaceURI === W && c.localName === 'hyperlink' ? kids(c, 'r').map(run).join('') : '').join('').replace(/\*\*\*\*|\*\*(\s*)\*\*/g, '$1');
    const h = /^(?:Heading|Überschrift|Titre)\s?([1-6])$/i.exec(style), title = /^Title$/i.test(style);
    if ((h || title) && text.trim()) return '#'.repeat(h ? +h[1] : 1) + ' ' + text.trim();
    const box = /^\s*([☐☑✓✔□■])\s*/.exec(text); if (box) return `- [${/[☑✓✔■]/.test(box[1]) ? 'x' : ' '}] ` + text.slice(box[0].length);
    if (pr && kids(pr, 'numPr').length) { const lvl = +(kids(kids(pr, 'numPr')[0], 'ilvl')[0]?.getAttributeNS(W, 'val') || 0); return '  '.repeat(lvl) + '- ' + text.trim(); }
    return text;
  };
  const out = [];
  const body = doc.getElementsByTagNameNS(W, 'body')[0];
  for (const n of body ? body.childNodes : []) {
    if (n.namespaceURI !== W) continue;
    if (n.localName === 'p') out.push(para(n));
    else if (n.localName === 'tbl') out.push('', kids(n, 'tr').map((tr, k) => { const cells = kids(tr, 'tc').map(tc => kids(tc, 'p').map(para).join(' ').replace(/\|/g, '\\|').trim()); return '| ' + cells.join(' | ') + ' |' + (k === 0 ? '\n|' + cells.map(() => ' --- |').join('') : ''); }).join('\n'), '');
  }
  // list items sit together; other paragraphs get a blank line between them
  let md = ''; for (let i = 0; i < out.length; i++) { const cur = out[i], prev = out[i - 1]; md += i === 0 ? cur : (/^\s*(- |\d+\. )/.test(cur) && /^\s*(- |\d+\. )/.test(prev || '') ? '\n' : '\n\n') + cur; }
  return md.replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

/* ---------- Google Keep (Takeout) ---------- */
const isKeepNote = o => o && typeof o === 'object' && ('textContent' in o || 'listContent' in o) && ('userEditedTimestampUsec' in o || 'createdTimestampUsec' in o || 'isTrashed' in o);
function keepToMd(n, find) {
  const parts = [];
  if (n.textContent) parts.push(String(n.textContent).replace(/\r\n?/g, '\n').trim());
  if (Array.isArray(n.listContent) && n.listContent.length) parts.push(n.listContent.map(i => `- [${i.isChecked ? 'x' : ' '}] ${String(i.text || '').replace(/\n+/g, ' ')}`).join('\n'));
  const pics = [], other = [];
  for (const a of n.attachments || []) {
    const data = find(a.filePath); if (!data) continue;
    if (/^image\//.test(a.mimetype || '') || impImageExt.test(a.filePath)) pics.push(`![[${embedRef(impSaveImage(a.filePath, data))}]]`);
    else { const p = impPath(`${IMPORT_ROOT}/Google Keep/attachments`, a.filePath.replace(/\.[^.]+$/, ''), (a.filePath.match(/\.[^.]+$/) || [''])[0]); vfs.write(p, data, { mkdirs: true }); other.push(`[${vfs.base(p)}](${encodeURI(p)})`); }
  }
  if (pics.length) parts.push(pics.join('\n'));
  if (other.length) parts.push(other.join('\n'));
  if (Array.isArray(n.annotations) && n.annotations.length) parts.push(n.annotations.filter(a => a.url).map(a => `- [${a.title || a.url}](${a.url})`).join('\n'));
  const labels = (n.labels || []).map(l => l.name).filter(Boolean);
  if (labels.length) parts.push(labels.map(impSigil).join(' '));
  const us = v => +v ? +v / 1000 : 0;
  const meta = { source: 'Google Keep', created: us(n.createdTimestampUsec) ? impIso(us(n.createdTimestampUsec)) : '', updated: us(n.userEditedTimestampUsec) ? impIso(us(n.userEditedTimestampUsec)) : '', pinned: !!n.isPinned, archived: !!n.isArchived, color: n.color && n.color !== 'DEFAULT' ? String(n.color).toLowerCase() : '' };
  const firstLine = String(n.textContent || n.listContent?.[0]?.text || '').split('\n')[0];
  return { title: String(n.title || '').trim() || firstLine.slice(0, 60) || 'Untitled', md: impFront(meta) + parts.join('\n\n') + '\n', mtime: us(n.userEditedTimestampUsec) || Date.now() };
}

/* ---------- the importer ---------- */
async function importNotes(fileList) {
  const report = { leaves: 0, trashed: 0, skipped: [], dirs: new Set(), apps: new Set() };
  const put = (dir, title, md, mtime) => { const p = impPath(dir, title); vfs.write(p, md, { mkdirs: true }); if (mtime) { const nd = vfs.nodes.get(p); if (nd) nd.mtime = mtime; } report.leaves++; report.dirs.add(dir); return p; };
  // one file, from a zip (with its neighbours) or on its own
  async function one(name, bytes, dir, zip) {
    const lower = name.toLowerCase(), title = vfs.base(name).replace(/\.[^.]+$/, '');
    try {
      if (lower.endsWith('.sdocx')) { report.skipped.push(`${vfs.base(name)}: Samsung Notes' own format can't be read here. In Samsung Notes choose Share → Microsoft Word file, PDF file or Text file, and import that.`); return; }
      if (lower.endsWith('.json')) {
        let o; try { o = JSON.parse(impText(bytes)); } catch { report.skipped.push(`${vfs.base(name)}: not JSON`); return; }
        if (!isKeepNote(o)) { report.skipped.push(`${vfs.base(name)}: not a Google Keep note`); return; }
        if (o.isTrashed) { report.trashed++; return; }
        const keepDir = `${IMPORT_ROOT}/Google Keep` + (o.isArchived ? '/Archived' : ''); report.apps.add('Google Keep');
        const find = f => { if (!zip || !f) return null; const want = vfs.base(f).toLowerCase(); const k = Object.keys(zip).find(z => vfs.base(z).toLowerCase() === want); return k ? zip[k] : null; };
        const n = keepToMd(o, find); put(keepDir, n.title, n.md, n.mtime); return;
      }
      if (lower.endsWith('.docx')) { put(dir, title, await docxToMd(bytes)); return; }
      if (lower.endsWith('.pdf')) { const r = await pdfText(bytes); put(dir, title, r.text.replace(/^<!-- page 1 -->\n/, '') + '\n'); return; }
      if (/\.html?$/.test(lower)) {
        const html = impText(bytes);
        const image = src => { if (/^data:image\//.test(src)) { try { const [, mime, b64] = /^data:(image\/[\w+.-]+);base64,(.*)$/.exec(src); const ext = '.' + (mime.split('/')[1] || 'png').replace('jpeg', 'jpg').replace('svg+xml', 'svg'); return impSaveImage(title + ext, Uint8Array.from(atob(b64), c => c.charCodeAt(0))); } catch { return null; } } if (!zip) return null; const want = decodeURIComponent(src.split(/[?#]/)[0]).split('/').pop().toLowerCase(); const k = Object.keys(zip).find(z => vfs.base(z).toLowerCase() === want); return k && impImageExt.test(k) ? impSaveImage(k, zip[k]) : null; };
        const t = (/<title>([^<]*)<\/title>/i.exec(html)?.[1] || '').trim();
        put(dir, t && !/^untitled$/i.test(t) ? t : title, htmlToMd(html, { image })); return;
      }
      if (/\.(md|markdown|txt|text)$/.test(lower)) { put(dir, title, impText(bytes)); return; }
      if (impImageExt.test(lower)) { if (!zip) impSaveImage(name, bytes); return; }
      report.skipped.push(`${vfs.base(name)}: not a kind of note this can read`);
    } catch (e) { report.skipped.push(`${vfs.base(name)}: ${e.message || e}`); }
  }
  for (const f of fileList) {
    const bytes = new Uint8Array(await f.arrayBuffer());
    if (/\.zip$/i.test(f.name)) {
      let z; try { z = await unzip(bytes); } catch (e) { report.skipped.push(`${f.name}: ${e.message}`); continue; }
      const names = Object.keys(z).filter(n => !/(^|\/)(__MACOSX|\.DS_Store)/.test(n));
      const keep = names.some(n => /(^|\/)Keep\/[^/]+\.json$/i.test(n));
      const zdir = `${IMPORT_ROOT}/${impName(f.name.replace(/\.zip$/i, '')) || 'Archive'}`;
      // a zip whose entries all sit in one top folder: that folder is the zip itself
      const top = names[0]?.split('/')[0], strip = names.length && names.every(n => n.includes('/') && n.split('/')[0] === top) ? top.length + 1 : 0;
      // a Takeout .html only when its .json is missing; inside other zips the folders are kept
      const jsonBase = new Set(names.filter(n => /\.json$/i.test(n)).map(n => n.replace(/\.json$/i, '').toLowerCase()));
      for (const n of names) {
        if (keep && /\.html?$/i.test(n) && jsonBase.has(n.replace(/\.html?$/i, '').toLowerCase())) continue;
        if (keep && /\.json$/i.test(n) && !/(^|\/)Keep\//i.test(n)) continue;
        if (keep && /(^|\/)Keep\/Labels\.txt$/i.test(n)) continue;   // Takeout's list of label names, already sigils on the notes
        const inner = n.slice(strip), rel = inner.includes('/') ? '/' + inner.slice(0, inner.lastIndexOf('/')).split('/').map(impName).join('/') : '';
        await one(n, z[n], zdir + rel, z);
      }
    } else await one(f.name, bytes, IMPORT_ROOT, null);
  }
  // the report, as a leaf beside what came in
  const where = [...report.dirs].sort();
  const lines = [`# Import ${impIso(Date.now())}`, '', `${report.leaves} lea${report.leaves === 1 ? 'f' : 'ves'}${report.apps.size ? ' from ' + [...report.apps].join(', ') : ''}.`];
  if (report.trashed) lines.push(`${report.trashed} note${report.trashed === 1 ? ' was' : 's were'} in the Keep trash and stayed out.`);
  if (where.length) lines.push('', 'Into:', ...where.map(d => `- ${d}`));
  if (report.skipped.length) lines.push('', 'Not imported:', ...report.skipped.map(s => `- ${s}`));
  if (report.leaves || report.skipped.length) vfs.write(impPath(IMPORT_ROOT, `Import report ${impIso(Date.now()).replace(/:/g, '.')}`), lines.join('\n') + '\n', { mkdirs: true });
  for (const d of [IMPORT_ROOT, ...where]) { let p = d; while (p && p !== '/') { openDirs.add(p); p = vfs.parent(p); } }
  ls.set('openDirs', [...openDirs]); renderTree();
  toast(report.leaves ? `Imported ${report.leaves} lea${report.leaves === 1 ? 'f' : 'ves'} into ${esc(where.length === 1 ? where[0] : IMPORT_ROOT)}${report.trashed ? ` (${report.trashed} from the Keep trash left out)` : ''}${report.skipped.length ? `; ${report.skipped.length} not imported, see the report` : ''}` : report.skipped.length ? esc(report.skipped[0]) : 'Nothing to import.', report.leaves ? 'ok' : 'err');
  return report;
}
// Import and drops: notes-app files go through the importer, everything else is copied in as before
async function importAny(fileList) {
  const all = [...fileList], apps = all.filter(f => NOTES_APP_FILE.test(f.name)), plain = all.filter(f => !NOTES_APP_FILE.test(f.name));
  if (plain.length) await uploadFiles(plain);
  if (apps.length) return importNotes(apps);
}
