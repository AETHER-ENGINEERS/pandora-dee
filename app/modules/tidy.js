/* =====================================================================
   RENAME & TIDY — rename a leaf or a workshop, delete a workshop that holds nothing, and clear away
   every empty workshop at once. Renaming carries the threads with it: leaves that thread to a renamed
   leaf (by name, by path, or by a markdown link) are rewritten, keeping #headings and |aliases.
   Pandora's own home (/Pandora and what is in it), the attachments and the templates workshop stay.
   ===================================================================== */
const keptWorkshop = d => d === '/' || d === PD_HOME || d.startsWith(PD_HOME + '/') || d === '/attachments' || d.startsWith('/attachments/') || (S.tplDir && (d === S.tplDir || S.tplDir.startsWith(d + '/')));
const filesUnder = d => { let n = 0; for (const [p, x] of vfs.nodes) if (!x.dir && p.startsWith(d + '/')) n++; return n; };
const cleanName = s => String(s || '').replace(/[\\/:*?"<>|\[\]#^]+/g, ' ').replace(/\s+/g, ' ').trim();

// before a move: every thread (wiki or markdown link) that leads to one of these leaves
function threadsTo(targets) {
  const plan = [];
  for (const n of vaultIndex().notes) {
    let text; try { text = vfs.read(n); } catch { continue; }
    const hits = [];
    for (const m of text.matchAll(WIKI_RE)) { const r = resolveNote(m[1], n); if (r && targets.has(r)) hits.push({ wiki: true, i: m.index, len: m[0].length, target: r, raw: m[1].trim(), heading: m[2] || '', alias: m[3] }); }
    for (const m of text.matchAll(/\]\(([^)\s]+\.(?:md|markdown))((?:#[^)\s]*)?)\)/gi)) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(m[1])) continue;
      let t; try { t = decodeURIComponent(m[1]); } catch { t = m[1]; }
      const r = resolveNote(t, n); if (r && targets.has(r)) hits.push({ wiki: false, i: m.index, len: m[0].length, target: r, heading: m[2] || '' });
    }
    if (hits.length) plan.push({ note: n, hits });
  }
  return plan;
}
// after it: point those threads at the new paths (a thread by name that still finds its leaf is left as written)
function rethread(plan, moved) {
  Vault.dirty = true; buildIndex();
  let leaves = 0, threads = 0;
  for (const { note, hits } of plan) {
    const at = moved.get(note) || note; let text; try { text = vfs.read(at); } catch { continue; }
    let changed = false;
    for (const h of hits.sort((a, b) => b.i - a.i)) {
      const to = moved.get(h.target); if (!to) continue;
      let next;
      if (h.wiki) {
        if (!h.raw.includes('/') && resolveNote(h.raw, at) === to) continue;
        const name = h.raw.includes('/') ? to.slice(1).replace(/\.(md|markdown)$/i, '') : linkName(to);
        next = `[[${name}${h.heading}${h.alias != null ? '|' + h.alias : ''}]]`;
      } else next = `](${encodeURI(to)}${h.heading})`;
      if (text.slice(h.i, h.i + h.len) === next) continue;
      text = text.slice(0, h.i) + next + text.slice(h.i + h.len); changed = true; threads++;
    }
    if (changed) { vfs.write(at, text); leaves++; }
  }
  return { leaves, threads };
}
const rethreadNote = r => r.threads ? ` ${r.threads} thread${r.threads === 1 ? '' : 's'} in ${r.leaves} lea${r.leaves === 1 ? 'f' : 'ves'} now lead there.` : '';

async function renameLeaf(p) {
  if (!vfs.isFile(p)) return;
  const ext = (p.match(/\.[^./]+$/) || ['.md'])[0], old = isNote(p) ? noteName(p) : vfs.base(p).slice(0, -ext.length);
  const got = await jvDialog({ title: 'Rename leaf', message: `In ${vfs.parent(p)}. Threads to it follow the new name.`, def: old });
  const name = cleanName(got); if (!name || name === old) return null;
  const q = vfs.norm(name + ext, vfs.parent(p));
  if (vfs.exists(q) && q.toLowerCase() !== p.toLowerCase()) { toast(`${esc(vfs.base(q))} is already in this workshop`, 'err'); return null; }
  flushSave();
  const plan = isNote(p) ? threadsTo(new Set([p])) : [];
  vfs.move(p, q);
  const r = rethread(plan, new Map([[p, q]]));
  if (editing === p) { editing = selPath = q; $('#filePath').textContent = isNote(q) ? noteName(q) : vfs.base(q); $('#filePath').title = q; }
  else if (selPath === p) selPath = q;
  toast(`Renamed to ${esc(name)}.${rethreadNote(r)}`, 'ok'); renderTree(); return q;
}
async function renameWorkshop(d) {
  if (!vfs.isDir(d)) return null;
  if (keptWorkshop(d)) { toast(`${esc(d)} keeps its name: Pandora and the app look for it there`, 'err'); return null; }
  const got = await jvDialog({ title: 'Rename workshop', message: `${d}. Its leaves keep their threads.`, def: vfs.base(d) });
  const name = cleanName(got); if (!name || name === vfs.base(d)) return null;
  const e = vfs.norm(name, vfs.parent(d));
  if (vfs.exists(e) && e.toLowerCase() !== d.toLowerCase()) { toast(`${esc(vfs.base(e))} already exists here`, 'err'); return null; }
  flushSave();
  const notes = vaultIndex().notes.filter(p => p.startsWith(d + '/'));
  const plan = threadsTo(new Set(notes));
  vfs.move(d, e);
  const under = p => p === d || p.startsWith(d + '/') ? e + p.slice(d.length) : p;
  const r = rethread(plan, new Map(notes.map(p => [p, under(p)])));
  for (const o of [...openDirs]) if (under(o) !== o) { openDirs.delete(o); openDirs.add(under(o)); }
  ls.set('openDirs', [...openDirs]);
  let settings = 0; for (const [k, v] of Object.entries(S)) if (typeof v === 'string' && under(v) !== v) { S[k] = under(v); settings++; }
  if (settings) saveSettings();
  if (editing && under(editing) !== editing) { editing = under(editing); $('#filePath').title = editing; $('#fileDir').textContent = vfs.parent(editing); }
  if (selPath) selPath = under(selPath);
  toast(`Renamed the workshop to ${esc(name)}.${rethreadNote(r)}`, 'ok'); renderTree(); return e;
}
async function deleteWorkshop(d) {
  if (!vfs.isDir(d)) return false;
  if (keptWorkshop(d)) { toast(`${esc(d)} stays: Pandora and the app keep things there`, 'err'); return false; }
  const n = filesUnder(d);
  if (n) { toast(`${esc(vfs.base(d))} holds ${n} file${n === 1 ? '' : 's'}. Move or delete ${n === 1 ? 'it' : 'them'} first.`, 'err'); return false; }
  vfs.rm(d, true); openDirs.delete(d); ls.set('openDirs', [...openDirs]);
  toast(`Deleted the empty workshop ${esc(vfs.base(d))}`, 'ok'); renderTree(); return true;
}
// every workshop with no file anywhere inside it, deepest first
const emptyWorkshops = () => [...vfs.nodes].filter(([p, x]) => x.dir && !keptWorkshop(p) && !filesUnder(p)).map(([p]) => p).sort((a, b) => b.length - a.length);
async function tidyWorkshops() {
  const all = emptyWorkshops(); if (!all.length) { toast('No empty workshops to tidy away.', 'ok'); return 0; }
  const top = all.filter(p => !all.some(q => q !== p && p.startsWith(q + '/')));
  const ok = await jvDialog({ title: 'Tidy the Atelier', message: `Remove ${all.length} empty workshop${all.length === 1 ? '' : 's'}: ${top.slice(0, 8).join(', ')}${top.length > 8 ? '…' : ''}`, items: ['Remove them'] });
  if (ok !== 0) return 0;
  for (const p of top) if (vfs.isDir(p)) vfs.rm(p, true);
  for (const o of [...openDirs]) if (!vfs.isDir(o)) openDirs.delete(o); ls.set('openDirs', [...openDirs]);
  toast(`Removed ${all.length} empty workshop${all.length === 1 ? '' : 's'}`, 'ok'); renderTree(); return all.length;
}
async function treeMenu(p) {
  const dir = vfs.isDir(p);
  if (dir) {
    const n = filesUnder(p), kept = keptWorkshop(p);
    const items = kept ? ['Kept: Pandora and the app use this workshop'] : ['Rename', n ? `Delete (holds ${n} file${n === 1 ? '' : 's'})` : 'Delete'];
    const i = await jvDialog({ title: vfs.base(p) + '/', items }); if (i == null || kept) return;
    if (i === 0) renameWorkshop(p); else deleteWorkshop(p);
  } else {
    const i = await jvDialog({ title: isNote(p) ? noteName(p) : vfs.base(p), items: ['Open', 'Rename', 'Delete'] }); if (i == null) return;
    if (i === 0) openFile(p); else if (i === 1) renameLeaf(p);
    else if ((await jvDialog({ title: 'Delete ' + (isNote(p) ? noteName(p) : vfs.base(p)) + '?', message: p, items: ['Delete it'] })) === 0) { if (editing === p) { clearTimeout(saveT); saveT = null; editing = selPath = null; } vfs.rm(p, true); toast(`Deleted ${esc(p)}`); renderTree(); }
  }
}
