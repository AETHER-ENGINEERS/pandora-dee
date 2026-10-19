/* =====================================================================
   CHAT ATTACHMENTS
   Files you attach are saved into the vault under /attachments/YYYY-MM-DD/. Text files are also
   inlined into your message (trimmed), images go to vision models (downscaled), and PDFs get their
   text extracted to a sidecar note (<file>.pdf.md) that Pandora can read and thread to other leaves.
   ===================================================================== */
const ATT = { pending: [] };   // {name, type, size, path, kind, text?, image?, note?}
const TEXT_EXT = /\.(md|markdown|txt|text|csv|tsv|json|jsonl|ya?ml|toml|ini|xml|html?|css|js|mjs|cjs|ts|tsx|jsx|py|rb|go|rs|java|kt|c|h|cpp|hpp|cs|sh|bash|zsh|sql|log|srt|vtt|tex|bib|org|rst|env|conf|cfg|svg)$/i;
const fmtKB = n => n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`;
function attachPath(name) {
  const dir = `/attachments/${todayStr()}`; const clean = String(name || 'file').replace(/[\\/:*?"<>|\x00-\x1f]+/g, '_').replace(/^\.+/, '').slice(0, 120) || 'file';
  let p = `${dir}/${clean}`, i = 2; const dot = clean.lastIndexOf('.');
  while (vfs.exists(p)) { p = `${dir}/${dot > 0 ? clean.slice(0, dot) + `-${i}` + clean.slice(dot) : clean + `-${i}`}`; i++; }
  return p;
}
async function downscaleImage(file, max = 1568) {
  try {
    const bmp = await createImageBitmap(file); const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height); bmp.close?.();
    return c.toDataURL('image/jpeg', 0.85).split(',')[1];
  } catch { return null; }
}
let pdfjsP = null;
function loadPdfJs() {
  return (pdfjsP ||= import('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs').then(m => {
    m.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs'; return m;
  }).catch(e => { pdfjsP = null; throw e; }));
}
async function pdfText(bytes) {
  const pdfjs = await loadPdfJs();
  const doc = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false }).promise;
  const pages = [];
  for (let i = 1; i <= Math.min(doc.numPages, 300); i++) {
    const pg = await doc.getPage(i); const tc = await pg.getTextContent();
    let line = '', out = []; let lastY = null;
    for (const it of tc.items) { const y = it.transform?.[5]; if (lastY != null && Math.abs(y - lastY) > 2) { out.push(line); line = ''; } line += it.str + (it.hasEOL ? '\n' : ''); lastY = y; }
    out.push(line); pages.push(out.join('\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim());
  }
  return { pages: doc.numPages, text: pages.map((t, i) => `<!-- page ${i + 1} -->\n${t}`).join('\n\n') };
}
async function addAttachments(files) {
  for (const f of files) {
    if (f.size > 25 * 1048576) { toast(`${esc(f.name)} is over 25 MB, so it was not attached.`, 'err'); continue; }
    const bytes = new Uint8Array(await f.arrayBuffer());
    const path = attachPath(f.name || `pasted-${Date.now()}.${(f.type.split('/')[1] || 'bin').replace('jpeg', 'jpg')}`);
    vfs.write(path, bytes, { mkdirs: true });
    const a = { name: vfs.base(path), type: f.type || '', size: f.size, path, kind: 'file' };
    if (/^image\//.test(f.type) && !/svg/.test(f.type)) { a.kind = 'image'; a.image = await downscaleImage(f); a.thumb = await downscaleImage(f, 112); }
    else if (TEXT_EXT.test(f.name) || /^text\/|json|xml|javascript/.test(f.type) || isText(bytes)) { a.kind = 'text'; a.text = dec.decode(bytes); }
    else if (/pdf/i.test(f.type) || /\.pdf$/i.test(f.name)) {
      a.kind = 'pdf'; ATT.pending.push(a); renderAttachBar();
      try {
        const r = await pdfText(bytes); a.pages = r.pages;
        if (r.text.replace(/<!--.*?-->|\s/g, '').length > 20) { a.note = path + '.md'; vfs.write(a.note, `---\nsource: ${path}\npages: ${r.pages}\n---\n# ${a.name}\n\n${r.text}\n`, { mkdirs: true }); }
        else a.noText = true;
      } catch (e) { a.pdfError = 'could not extract text (' + String(e.message || e).slice(0, 60) + ')'; }
      renderAttachBar(); continue;
    }
    ATT.pending.push(a); renderAttachBar();
  }
}
function renderAttachBar() {
  const bar = $('#attachBar'); bar.hidden = !ATT.pending.length;
  bar.innerHTML = ATT.pending.map((a, i) => `<span class="att-chip pending">${a.kind === 'image' && a.thumb ? `<img src="data:image/jpeg;base64,${a.thumb}" alt="">` : `<b>${{ text: '≡', pdf: 'PDF', file: '◇' }[a.kind] || '◇'}</b>`}<span class="truncate">${esc(a.name)}</span><small>${fmtKB(a.size)}${a.kind === 'pdf' && !a.note && !a.pdfError && !a.noText ? ' · reading…' : ''}</small><button type="button" data-rm="${i}" aria-label="Remove ${esc(a.name)}">×</button></span>`).join('');
}
// the text the model sees for a message's attachments
function attachmentBlock(atts) {
  if (!atts?.length) return '';
  let budget = 16000; const lines = [`[Attached: ${atts.length} file${atts.length > 1 ? 's' : ''}, saved in the vault]`];
  for (const a of atts) {
    const head = `- ${a.path} (${a.kind === 'pdf' ? `PDF${a.pages ? ', ' + a.pages + ' pages' : ''}` : a.type || a.kind}, ${fmtKB(a.size)})`;
    if (a.kind === 'text' && a.text != null) {
      const take = Math.min(a.text.length, Math.max(0, Math.min(8000, budget))); budget -= take;
      lines.push(head + (take < a.text.length ? `: first ${take} of ${a.text.length} characters below; use read for the rest` : ':'));
      if (take) lines.push('```' + (a.name.split('.').pop() || '') + '\n' + a.text.slice(0, take) + '\n```');
    } else if (a.kind === 'image') lines.push(head + (a.image ? ': attached as an image you can see' : ': image (could not be prepared for viewing)'));
    else if (a.kind === 'pdf') lines.push(head + (a.note ? `: text extracted to ${a.note} (read it)` : a.noText ? ': no text layer (scanned PDF)' : `: ${a.pdfError || 'text not extracted'}`));
    else lines.push(head + ': binary file');
  }
  return '\n\n' + lines.join('\n');
}
function attachmentChips(atts) {
  if (!atts?.length) return '';
  return `<div class="att-row">${atts.map(a => `<a href="#" class="att-chip" data-att="${esc(a.note || a.path)}">${a.kind === 'image' && a.thumb ? `<img src="data:image/jpeg;base64,${a.thumb}" alt="">` : `<b>${{ text: '≡', pdf: 'PDF', file: '◇' }[a.kind] || '◇'}</b>`}<span class="truncate">${esc(a.name)}</span></a>`).join('')}</div>`;
}
$('#btnAttach').onclick = () => $('#attachInput').click();
$('#attachInput').onchange = e => { const fs = [...e.target.files]; e.target.value = ''; addAttachments(fs); };
$('#attachBar').addEventListener('click', e => { const b = e.target.closest('[data-rm]'); if (!b) return; ATT.pending.splice(+b.dataset.rm, 1); renderAttachBar(); });
input.addEventListener('paste', e => { const fs = [...(e.clipboardData?.files || [])]; if (fs.length) { e.preventDefault(); addAttachments(fs); } });
for (const el of [chatEl, $('.composer-wrap')]) {
  el.addEventListener('dragover', e => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); el.classList.add('drop-hot'); } });
  el.addEventListener('dragleave', () => el.classList.remove('drop-hot'));
  el.addEventListener('drop', e => { el.classList.remove('drop-hot'); if (e.dataTransfer?.files?.length) { e.preventDefault(); addAttachments([...e.dataTransfer.files]); } });
}
chatEl.addEventListener('click', e => {
  const c = e.target.closest('.att-chip[data-att]'); if (!c) return; e.preventDefault();
  const p = c.dataset.att; if (!vfs.isFile(p)) return toast('That file is no longer in the Atelier.', 'err');
  if (isNote(p) || TEXT_EXT.test(p)) openFile(p, { mode: isNote(p) ? 'read' : undefined }); else toast(`Saved in the Atelier at ${esc(p)}`);
});
// take the pending attachments for a message being sent
function takeAttachments() { const a = ATT.pending.filter(x => !(x.kind === 'pdf' && !x.note && !x.pdfError && !x.noText)); const waiting = ATT.pending.length - a.length; ATT.pending = ATT.pending.filter(x => !a.includes(x)); renderAttachBar(); if (waiting) toast('A PDF is still being read; it will go with your next message.'); return a; }

// turn the user's text + pending attachments into the stored message
function composeUserMessage(text, content) {
  const atts = takeAttachments(); const block = attachmentBlock(atts);
  const msg = { role: 'user', content: (content || text || (atts.length ? 'Please look at the attached file' + (atts.length > 1 ? 's' : '') + '.' : '')) + block };
  const disp = text || (atts.length ? '📎 ' + atts.map(a => a.name).join(', ') : '');
  if (disp !== msg.content) msg.display = disp;
  if (atts.length) {
    msg.attachments = atts.map(({ text: _t, image: _i, ...a }) => a); msg._attBlock = block;
    const imgs = atts.filter(a => a.image).map(a => a.image); if (imgs.length) msg.images = imgs;
  }
  return msg;
}
