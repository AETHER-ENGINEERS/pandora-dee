// The vault as a real folder, for Pandora Dee's desktop app. It answers the same disk* calls the Android app's
// DiskHost answers (app/modules/vfs_disk.js uses them), in the same shapes: every call returns a string, a value or
// "ERR:message". Vault paths ("/Pandora/SOUL.md") map straight onto files under one root folder, so the vault is an
// ordinary folder that bash, file managers and MCP file tools all see the same way.
//
// Two differences from the phone, both so nothing is lost: deleting a file or folder moves it into a dated trash
// folder beside the vault (not inside it, so it doesn't show up in the vault), and "clear" (a full-backup restore that
// starts from nothing) moves everything there too instead of deleting it.

'use strict';
const fs = require('node:fs');
const path = require('node:path');

const TMP = '.jvtmp';

function createDiskHost(rootIn, { trashDir } = {}) {
  const root = path.resolve(rootIn);
  fs.mkdirSync(root, { recursive: true });
  const trashRoot = path.resolve(trashDir || path.join(path.dirname(root), path.basename(root) + ' (trash)'));
  const caseless = process.platform === 'win32' || process.platform === 'darwin';
  const same = (a, b) => (caseless ? a.toLowerCase() === b.toLowerCase() : a === b);
  const inside = (full) => { const r = root + path.sep; return caseless ? full.toLowerCase().startsWith(r.toLowerCase()) : full.startsWith(r); };

  /** A vault path to the real file inside the root. Refuses anything that would reach outside it. */
  function file(vp) {
    const s = String(vp ?? '');
    if (!s.startsWith('/') || s.includes('\0')) throw new Error(`${s}: not a vault path`);
    const parts = s.split('/').filter(Boolean);
    for (const p of parts) {
      if (p === '..' || p === '.') throw new Error(`${s}: not a vault path`);
      if (process.platform === 'win32' && (/[<>:"|?*\\]/.test(p) || /[. ]$/.test(p))) throw new Error(`${s}: that name can't be used on Windows`);
    }
    if (!parts.length) throw new Error(`${s}: that is the vault itself`);
    const full = path.resolve(root, ...parts);
    if (!inside(full)) throw new Error(`${s} isn't inside the vault folder`);
    // a link inside the folder must not lead out of it
    let real;
    try { real = fs.realpathSync(full); } catch { real = null; }
    if (real && !inside(real) && !same(real, root)) throw new Error(`${s} leads outside the vault folder`);
    return full;
  }
  const vaultPath = (full) => '/' + path.relative(root, full).split(path.sep).join('/');
  const ms = (st) => Math.floor(st.mtimeMs);

  const stamp = () => { const d = new Date(); const t = (x) => String(x).padStart(2, '0'); return `${d.getFullYear()}-${t(d.getMonth() + 1)}-${t(d.getDate())} ${t(d.getHours())}${t(d.getMinutes())}${t(d.getSeconds())}`; };
  /** Move a file or folder into the trash, keeping its place in the vault. Returns where it went. */
  function toTrash(full, batch) {
    const dest = path.join(trashRoot, batch || stamp(), path.relative(root, full));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    let to = dest; for (let i = 2; fs.existsSync(to); i++) to = `${dest} (${i})`;
    try { fs.renameSync(full, to); }
    catch (e) { if (e.code !== 'EXDEV') throw e; fs.cpSync(full, to, { recursive: true }); fs.rmSync(full, { recursive: true, force: true }); }
    return to;
  }

  function scanList() {
    const out = [];
    const walk = (dir) => {
      let list;
      try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of list) {
        const full = path.join(dir, e.name);
        if (e.name.endsWith(TMP)) { try { fs.rmSync(full, { force: true }); } catch {} continue; }   // a write that never finished
        let st; try { st = fs.statSync(full); } catch { continue; }
        if (e.isSymbolicLink()) { let real = ''; try { real = fs.realpathSync(full); } catch {} if (!inside(real)) continue; }
        if (st.isDirectory()) { out.push([vaultPath(full), true, 0, ms(st)]); walk(full); }
        else if (st.isFile()) out.push([vaultPath(full), false, st.size, ms(st)]);
      }
    };
    walk(root);
    return out;
  }

  const writing = new Map();   // vault path → temp file of a write still arriving in pieces
  const freeBytes = () => { try { const s = fs.statfsSync(root); return Number(s.bavail) * Number(s.bsize); } catch { return 0; } };

  const ops = {
    info: () => JSON.stringify({ root, mode: 'desktop', sharedOk: true, free: freeBytes(), warn: '', trash: trashRoot }),
    scan: () => JSON.stringify(scanList()),
    get(vp, off, len) {
      const full = file(vp);
      const fd = fs.openSync(full, 'r');
      try { const buf = Buffer.alloc(Math.max(0, len | 0)); const n = fs.readSync(fd, buf, 0, buf.length, Math.max(0, Number(off) || 0)); return buf.subarray(0, n).toString('base64'); }
      finally { fs.closeSync(fd); }
    },
    // chunked and atomic: the first piece starts a temp file, the last renames it into place
    put(vp, b64, first, last) {
      const full = file(vp);
      if (fs.existsSync(full) && fs.statSync(full).isDirectory()) throw new Error(`${vp}: Is a directory`);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      const tmp = full + TMP;
      const bytes = Buffer.from(String(b64 || ''), 'base64');
      if (first || !writing.has(vp)) { fs.writeFileSync(tmp, bytes); writing.set(vp, tmp); }
      else fs.appendFileSync(tmp, bytes);
      if (!last) return 'ok:0';
      writing.delete(vp);
      fs.renameSync(tmp, full);
      return 'ok:' + ms(fs.statSync(full));
    },
    mkdir(vp) { const full = file(vp); if (fs.existsSync(full) && !fs.statSync(full).isDirectory()) throw new Error(`${vp}: File exists`); fs.mkdirSync(full, { recursive: true }); return 'ok'; },
    del(vp) { const full = file(vp); if (fs.existsSync(full)) toTrash(full); return 'ok'; },
    move(a, b) {
      const from = file(a), to = file(b);
      if (!fs.existsSync(from)) throw new Error(`${a}: No such file or directory`);
      if (same(from, to)) return 'ok';
      const batch = stamp();
      if (fs.existsSync(to) && !same(fs.realpathSync(from), fs.realpathSync(to))) toTrash(to, batch);   // the page already let go of what was there
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.renameSync(from, to);
      return 'ok';
    },
    touch(vp, mtime) { const full = file(vp); const t = new Date(Number(mtime) || Date.now()); fs.utimesSync(full, t, t); return 'ok:' + ms(fs.statSync(full)); },
    clear() { const batch = stamp(); for (const name of fs.readdirSync(root)) toTrash(path.join(root, name), batch); return 'ok'; },
    useShared: () => 'ok',
  };

  /** Answer one call the way the Android bridge does: a string, or "ERR:message". */
  function call(name, args = []) {
    const f = ops[name];
    if (!f) return `ERR:${name}: unknown call`;
    try { return f(...args); } catch (e) { return 'ERR:' + (e && e.message ? e.message : String(e)); }
  }
  return { root, trash: trashRoot, call, file };
}

module.exports = { createDiskHost, TMP };
