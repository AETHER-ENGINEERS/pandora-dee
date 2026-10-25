/* =====================================================================
   IMAGES IN MARKDOWN — ![[photo.png]], ![[photo.png|300]], ![alt](images/photo.png),
   ![alt](https://…). Vault files are shown from memory (blob URLs, cached per file version).
   ![[Some Note]] embeds that note's text. Tap an image to view it full screen.
   ===================================================================== */
const IMG_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|avif|ico)$/i;
const isImagePath = p => IMG_EXT.test(String(p || ''));
const IMG_MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', avif: 'image/avif', ico: 'image/x-icon' };
function resolveFile(target, fromPath) {
  let t = String(target ?? '').trim().replace(/\\/g, '/'); if (!t) return null;
  try { t = decodeURIComponent(t); } catch {}
  const dir = fromPath ? vfs.parent(fromPath) : '/';
  for (const cand of [vfs.norm(t, dir), vfs.norm(t, '/')]) if (vfs.isFile(cand)) return cand;
  const lc = t.toLowerCase().replace(/^\.?\/+/, ''), base = lc.split('/').pop(); const hits = [];
  for (const [p, n] of vfs.nodes) if (!n.dir) { const pl = p.toLowerCase(); if (pl.endsWith('/' + lc) || (!lc.includes('/') && vfs.base(pl) === base)) hits.push(p); }
  if (!hits.length) return null;
  hits.sort((a, b) => (vfs.parent(b) === dir) - (vfs.parent(a) === dir) || a.length - b.length || a.localeCompare(b));
  return hits[0];
}
const blobCache = new Map();   // path -> { data, url }
function vaultBlobUrl(p) {
  const n = vfs.nodes.get(p); if (!n || n.dir) return null;
  const c = blobCache.get(p); if (c && c.data === n.data) return c.url;
  if (c) URL.revokeObjectURL(c.url);
  const ext = (p.split('.').pop() || '').toLowerCase();
  const url = URL.createObjectURL(new Blob([n.data], { type: IMG_MIME[ext] || 'application/octet-stream' }));
  blobCache.set(p, { data: n.data, url }); return url;
}
// ![[...]] as a marked extension (registered ahead of [[wiki links]])
(() => {
  if (!window.marked?.use) return;
  const embed = {
    name: 'wikiembed', level: 'inline',
    start(src) { const i = src.indexOf('![['); return i < 0 ? undefined : i; },
    tokenizer(src) { const m = /^!\[\[([^\[\]\n|#]+)(#[^\[\]\n|]*)?(?:\|([^\[\]\n]+))?\]\]/.exec(src); if (m) return { type: 'wikiembed', raw: m[0], target: m[1].trim(), heading: (m[2] || '').slice(1).trim(), alias: (m[3] || '').trim() }; },
    renderer(tok) {
      const t = tok.target;
      if (isImagePath(t)) {
        const sz = /^(\d{1,4})(?:x(\d{1,4}))?$/.exec(tok.alias); const alt = sz ? vfs.base(t) : (tok.alias || vfs.base(t));
        return `<img class="md-img" data-vault="${esc(t)}" alt="${esc(alt)}"${sz ? ` width="${sz[1]}"${sz[2] ? ` height="${sz[2]}"` : ''}` : ''}>`;
      }
      if (/\.\w{2,5}$/.test(t) && !/\.(md|markdown)$/i.test(t)) return `<a href="#" class="file-chip" data-file="${esc(t)}">📎 ${esc(tok.alias || vfs.base(t))}</a>`;
      return `<div class="note-embed" data-embed="${esc(t)}"${tok.heading ? ` data-heading="${esc(tok.heading)}"` : ''}></div>`;
    },
  };
  try { marked.use({ extensions: [embed] }); } catch (e) { console.warn('embed extension failed', e); }
})();
let embedDepth = 0;
function hydrateMedia(div) {
  const from = Vault.renderFrom;
  for (const img of div.querySelectorAll('img')) {
    img.loading = 'lazy'; img.classList.add('md-img');
    let target = img.dataset.vault;
    const src = img.getAttribute('src') || '';
    if (!target && src && !/^([a-z][a-z0-9+.-]*:|\/\/)/i.test(src)) target = src;
    if (!target) continue;
    const p = resolveFile(target, from);
    const url = p && vaultBlobUrl(p);
    if (url) { img.src = url; img.dataset.path = p; }
    else { img.removeAttribute('src'); img.classList.add('missing'); img.alt = `missing image: ${target}`; img.title = `${target} is not in the vault`; }
  }
  for (const box of div.querySelectorAll('.note-embed')) {
    const p = resolveNote(box.dataset.embed, from);
    if (!p || embedDepth > 1) { box.innerHTML = `<a href="#" class="wiki-link missing" data-wiki="${esc(box.dataset.embed)}">${esc(box.dataset.embed)}</a>`; continue; }
    let body = splitFrontmatter(vfs.read(p)).body;
    if (box.dataset.heading) { const re = new RegExp('^(#{1,6})\\s+' + box.dataset.heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*$', 'mi'); const m = re.exec(body); if (m) { const rest = body.slice(m.index + m[0].length); const end = new RegExp(`^#{1,${m[1].length}}\\s`, 'm').exec(rest); body = m[0] + rest.slice(0, end ? end.index : undefined); } }
    embedDepth++; const prev = Vault.renderFrom; Vault.renderFrom = p;
    try { const inner = md(body.length > 20000 ? body.slice(0, 20000) + '\n\n…' : body); box.innerHTML = `<div class="embed-h"><a href="#" class="wiki-link" data-wiki="${esc(noteName(p))}">${esc(noteName(p))}</a></div>`; box.appendChild(inner); }
    finally { Vault.renderFrom = prev; embedDepth--; }
  }
}
// full-screen viewer
function openLightbox(src, caption) {
  const o = document.createElement('div'); o.className = 'lightbox'; o.setAttribute('role', 'dialog');
  o.innerHTML = `<img alt=""><div class="lb-cap mono text-xs"></div><button type="button" class="btn lb-x" aria-label="Close">✕</button>`;
  o.querySelector('img').src = src; o.querySelector('.lb-cap').textContent = caption || '';
  o.onclick = e => { if (e.target === o || e.target.closest('.lb-x')) o.remove(); };
  document.body.appendChild(o);
}
document.addEventListener('click', e => {
  const img = e.target.closest?.('.md img.md-img'); if (img && img.src && !img.classList.contains('missing')) { e.preventDefault(); openLightbox(img.src, img.dataset.path || img.alt); return; }
  const chip = e.target.closest?.('.file-chip'); if (chip) { e.preventDefault(); const p = resolveFile(chip.dataset.file, editing); if (p) openFile(p); else toast(`${esc(chip.dataset.file)} is not in the vault`, 'err'); }
});
// opening an image file from the vault shows the picture
function showImageFile(p) {
  const body = $('#noteBody'); body.dataset.mode = 'read'; $('#mdTools').hidden = true;
  const st = vfs.stat?.(p)?.size ?? vfs.nodes.get(p)?.data?.length ?? 0;
  const box = document.createElement('div'); box.className = 'md note-md image-file';
  box.innerHTML = `<img class="md-img" alt=""><p class="mono text-xs text-dim mt-2"></p><p class="hint">Embed it in a note with <code></code></p>`;
  const img = box.querySelector('img'); img.src = vaultBlobUrl(p); img.dataset.path = p;
  img.onload = () => { box.querySelector('p').textContent = `${img.naturalWidth}×${img.naturalHeight} · ${fmtKB(st)} · ${p}`; };
  box.querySelector('code').textContent = `![[${vfs.base(p)}]]`;
  $('#notePrev').replaceChildren(box); $('#noteStats').textContent = fmtKB(st);
}
// adding images to notes: toolbar button, paste, drop. Big photos are scaled down first.
async function shrinkImage(file) {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size < 400 * 1024) return { data: new Uint8Array(await file.arrayBuffer()), type: file.type };
  try {
    const bmp = await createImageBitmap(file); const max = 1800; const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    if (k === 1 && file.size < 1.5 * 1024 * 1024) return { data: new Uint8Array(await file.arrayBuffer()), type: file.type };
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const keepPng = file.type === 'image/png' && file.size < 1.5 * 1024 * 1024;
    const blob = await new Promise(r => c.toBlob(r, keepPng ? 'image/png' : 'image/jpeg', 0.85));
    if (!blob || blob.size >= file.size) return { data: new Uint8Array(await file.arrayBuffer()), type: file.type };
    return { data: new Uint8Array(await blob.arrayBuffer()), type: blob.type };
  } catch { return { data: new Uint8Array(await file.arrayBuffer()), type: file.type }; }
}
async function saveImageFile(file, dir = '/attachments/images') {
  const { data, type } = await shrinkImage(file);
  const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg' }[type] || (file.name.split('.').pop() || 'png');
  let base = (file.name || 'image').replace(/\.[^.]+$/, '').replace(/[^\w\- ]+/g, '_').trim().slice(0, 60) || 'image';
  if (/^image$/i.test(base)) base = 'image-' + new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  let p = `${dir}/${base}.${ext}`, i = 2; while (vfs.exists(p)) p = `${dir}/${base}-${i++}.${ext}`;
  vfs.write(p, data, { mkdirs: true }); return p;
}
function embedRef(p) { const b = vfs.base(p); let n = 0; for (const [q, x] of vfs.nodes) if (!x.dir && vfs.base(q) === b) n++; return n > 1 ? p : b; }
function insertAtCursor(text) {
  const ta = $('#fileEd'); const s = ta.selectionStart ?? ta.value.length, e = ta.selectionEnd ?? s;
  const before = ta.value.slice(0, s); const pre = before && !before.endsWith('\n') ? '\n' : '';
  ta.setRangeText(pre + text + '\n', s, e, 'end'); ta.dispatchEvent(new Event('input', { bubbles: true }));
}
// some pickers (Android galleries, Files apps) hand over a photo with no type: go by its name then
const isImageFile = f => /^image\//.test(f.type) || (!f.type && isImagePath(f.name));
async function addImagesToNote(files) {
  if (!editing || !isNote(editing)) return toast('Open a leaf first.', 'err');
  const all = [...(files || [])], imgs = all.filter(isImageFile);
  if (!imgs.length) return toast(all.length ? `${esc(all[0].name || 'That file')} is not an image this page can add.` : 'No image came back from the picker. Try again, or drop the image onto the leaf.', 'err');
  if ($('#noteBody').dataset.mode === 'read') setNoteMode('split');
  for (const f of imgs) { const p = await saveImageFile(f); insertAtCursor(`![[${embedRef(p)}]]`); }
  renderNotePreview(); toast(`Added ${imgs.length} image${imgs.length > 1 ? 's' : ''} to /attachments/images`, 'ok');
}
(() => {
  const tools = $('#mdTools'); if (!tools) return;
  const b = document.createElement('button'); b.type = 'button'; b.dataset.img = '1'; b.setAttribute('aria-label', 'Insert image'); b.textContent = '🖼'; tools.prepend(b);
  const pick = document.createElement('input'); pick.type = 'file'; pick.accept = 'image/*'; pick.multiple = true; pick.hidden = true; document.body.appendChild(pick);
  b.addEventListener('click', e => { e.stopPropagation(); pick.value = ''; pick.click(); });
  pick.onchange = () => addImagesToNote(pick.files);
  const ta = $('#fileEd');
  ta.addEventListener('paste', e => { const fs_ = [...(e.clipboardData?.files || [])].filter(isImageFile); if (fs_.length) { e.preventDefault(); addImagesToNote(fs_); } });
  ta.addEventListener('drop', e => { const fs_ = [...(e.dataTransfer?.files || [])].filter(isImageFile); if (fs_.length) { e.preventDefault(); addImagesToNote(fs_); } });
})();
