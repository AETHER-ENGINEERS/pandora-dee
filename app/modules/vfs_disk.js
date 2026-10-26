/* =====================================================================
   VIRTUAL FILESYSTEM
   In the Android app the vault is a real folder on the phone (JadeVault): every file is an ordinary file there, and
   the page keeps only the file list in memory. A node's contents are read from the folder when something asks for
   them (a small cache keeps the recent ones) and writes go to the folder a moment later, in order. In a plain browser
   there is no folder to use, so the vault stays in IndexedDB as before.
   ===================================================================== */
const DISK = (() => { try { const A = window.NetrunnerAndroid; return A && typeof A.diskInfo === 'function' && typeof A.diskScan === 'function' ? A : null; } catch { return null; } })();
const fsize = n => n.dir ? 0 : (n.size != null ? n.size : n.data.length);
const DK = (() => {
  const CH = 3 * 1048576;
  const u8b64 = u => { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
  const b64u8 = b => { const s = atob(b); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; };
  const chk = r => { if (typeof r === 'string' && r.startsWith('ERR:')) throw new Error(r.slice(4)); return r; };
  return {
    info: () => JSON.parse(chk(DISK.diskInfo())),
    scan: () => JSON.parse(chk(DISK.diskScan())),
    read(p, size) {
      if (!size) return new Uint8Array(0);
      const out = new Uint8Array(size); let off = 0;
      while (off < size) { const part = b64u8(chk(DISK.diskGet(p, off, Math.min(CH, size - off)))); if (!part.length) break; out.set(part.subarray(0, size - off), off); off += part.length; }
      return off === size ? out : out.slice(0, off);   // a file that shrank behind our back
    },
    write(p, bytes) {   // → the mtime the file got
      let r = '';
      if (bytes.length <= CH) r = chk(DISK.diskPut(p, u8b64(bytes), true, true));
      else for (let off = 0; off < bytes.length; off += CH) r = chk(DISK.diskPut(p, u8b64(bytes.subarray(off, off + CH)), off === 0, off + CH >= bytes.length));
      return +r.slice(3);
    },
    mkdir: p => chk(DISK.diskMkdir(p)),
    del: p => chk(DISK.diskDel(p)),
    move: (a, b) => chk(DISK.diskMove(a, b)),
    touch: (p, t) => +chk(DISK.diskTouch(p, t)).slice(3),
    clear: () => chk(DISK.diskClear())
  };
})();
// the contents of recently used files, so a note read ten times is read from the folder once
const LRU = {
  map: new Map(), bytes: 0, max: 48 * 1048576,
  add(n) { if (this.map.has(n)) return; this.map.set(n, n.size); this.bytes += n.size; this.trim(n); },
  touch(n) { if (this.map.has(n)) { const z = this.map.get(n); this.map.delete(n); this.map.set(n, z); } },
  drop(n) { if (n && this.map.has(n)) { this.bytes -= this.map.get(n); this.map.delete(n); } },
  trim(keep) { for (const [n, z] of this.map) { if (this.bytes <= this.max) break; if (n === keep || n.dirty) continue; n._d = null; this.map.delete(n); this.bytes -= z; } }
};
class DNode {
  constructor(p, size, mtime, bytes) { this.p = p; this.size = size; this.mtime = mtime; this._d = bytes || null; this.dirty = !!bytes; }
  get data() {
    if (this._d) { LRU.touch(this); return this._d; }
    const b = DK.read(this.p, this.size); this._d = b; this.size = b.length; LRU.add(this); return b;
  }
}
class VFS {
  constructor() { this.nodes = new Map([['/', { dir: true, mtime: Date.now() }]]); this.listeners = new Set(); this.ops = []; this.diskOn = !!DISK; this.info = null; this._failN = 0; }
  norm(p, cwd = '/') {
    if (p == null || p === '') p = '.';
    p = String(p);
    if (p === '~') p = '/'; else if (p.startsWith('~/')) p = '/' + p.slice(2);
    const parts = (p.startsWith('/') ? p : cwd + '/' + p).split('/'); const out = [];
    for (const s of parts) { if (!s || s === '.') continue; if (s === '..') out.pop(); else out.push(s); }
    return '/' + out.join('/');
  }
  parent(p) { if (p === '/') return '/'; const i = p.lastIndexOf('/'); return i <= 0 ? '/' : p.slice(0, i); }
  base(p) { return p === '/' ? '/' : p.slice(p.lastIndexOf('/') + 1); }
  exists(p) { return this.nodes.has(p); }
  isDir(p) { return this.nodes.get(p)?.dir === true; }
  isFile(p) { const n = this.nodes.get(p); return !!n && !n.dir; }
  stat(p) { const n = this.nodes.get(p); if (!n) throw new Error(`${p}: No such file or directory`); return { dir: !!n.dir, size: n.dir ? 4096 : fsize(n), mtime: n.mtime }; }
  // ---- changes to the folder are queued here and applied in order by flush() ----
  op(k, a, b, node) {
    if (!this.diskOn) return;
    if (k === 'put') { for (let i = this.ops.length - 1; i >= 0; i--) { const o = this.ops[i]; if (o.k === 'del' || o.k === 'mv' || o.k === 'clear') break; if (o.k === 'put' && o.a === a) this.ops.splice(i, 1); } }
    this.ops.push({ k, a, b, node });
  }
  mkdirp(p) { if (p === '/') return; if (this.isFile(p)) throw new Error(`${p}: Not a directory`); if (this.isDir(p)) return; this.mkdirp(this.parent(p)); this.nodes.set(p, { dir: true, mtime: Date.now() }); this.op('mkdir', p); this.changed(); }
  mkdir(p) { if (this.exists(p)) throw new Error(`${p}: File exists`); if (!this.isDir(this.parent(p))) throw new Error(`${this.parent(p)}: No such file or directory`); this.nodes.set(p, { dir: true, mtime: Date.now() }); this.op('mkdir', p); this.changed(); }
  readBytes(p) { const n = this.nodes.get(p); if (!n) throw new Error(`${p}: No such file or directory`); if (n.dir) throw new Error(`${p}: Is a directory`); return n.data; }
  read(p) { return dec.decode(this.readBytes(p)); }
  write(p, data, { mkdirs = false } = {}) {
    if (p === '/') throw new Error('/: Is a directory');
    const par = this.parent(p);
    if (mkdirs) this.mkdirp(par); else if (!this.isDir(par)) throw new Error(`${par}: No such file or directory`);
    if (this.isDir(p)) throw new Error(`${p}: Is a directory`);
    const bytes = typeof data === 'string' ? enc.encode(data) : data;
    LRU.drop(this.nodes.get(p));
    let node;
    if (this.diskOn) { node = new DNode(p, bytes.length, Date.now(), bytes); this.op('put', p, bytes, node); }
    else node = { data: bytes, mtime: Date.now() };
    this.nodes.set(p, node); this.changed();
  }
  append(p, data) {
    const prev = this.isFile(p) ? this.readBytes(p) : new Uint8Array(); const add = typeof data === 'string' ? enc.encode(data) : data;
    const m = new Uint8Array(prev.length + add.length); m.set(prev); m.set(add, prev.length); this.write(p, m);
  }
  touch(p) { const n = this.nodes.get(p); if (!n) throw new Error(`${p}: No such file or directory`); n.mtime = Date.now(); this.op('touch', p, n.mtime, n); this.changed(); }
  list(p) {
    if (!this.exists(p)) throw new Error(`${p}: No such file or directory`);
    if (!this.isDir(p)) throw new Error(`${p}: Not a directory`);
    const pre = p === '/' ? '/' : p + '/'; const out = [];
    for (const k of this.nodes.keys()) if (k !== p && k.startsWith(pre) && !k.slice(pre.length).includes('/')) out.push(k.slice(pre.length));
    return out.sort();
  }
  *walk(p) { const pre = p === '/' ? '/' : p + '/'; for (const k of [...this.nodes.keys()].sort()) if (k === p || k.startsWith(pre)) yield k; }
  rm(p, recursive = false) {
    if (p === '/') throw new Error("refusing to remove '/'");
    if (!this.exists(p)) throw new Error(`${p}: No such file or directory`);
    if (this.isDir(p)) { if (this.list(p).length && !recursive) throw new Error(`${p}: Directory not empty`); for (const k of [...this.nodes.keys()]) if (k.startsWith(p + '/')) { LRU.drop(this.nodes.get(k)); this.nodes.delete(k); } }
    LRU.drop(this.nodes.get(p)); this.nodes.delete(p); this.op('del', p); this.changed();
  }
  move(a, b) {
    if (!this.exists(a)) throw new Error(`${a}: No such file or directory`);
    if (this.isDir(b)) b = (b === '/' ? '' : b) + '/' + this.base(a);
    if (b === a) return; if (b.startsWith(a + '/')) throw new Error(`cannot move '${a}' into itself`);
    if (!this.isDir(this.parent(b))) throw new Error(`${this.parent(b)}: No such file or directory`);
    const moves = [...this.nodes.entries()].filter(([k]) => k === a || k.startsWith(a + '/'));
    for (const k of [...this.nodes.keys()]) if (k === b || k.startsWith(b + '/')) { LRU.drop(this.nodes.get(k)); this.nodes.delete(k); }
    for (const [k] of moves) this.nodes.delete(k);
    for (const [k, v] of moves) { const t = b + k.slice(a.length); if (v instanceof DNode) v.p = t; this.nodes.set(t, v); }
    this.op('mv', a, b); this.changed();
  }
  copy(a, b, recursive = false) {
    if (!this.exists(a)) throw new Error(`${a}: No such file or directory`);
    if (this.isDir(b)) b = (b === '/' ? '' : b) + '/' + this.base(a);
    if (this.isDir(a)) {
      if (!recursive) throw new Error(`-r not specified; omitting directory '${a}'`);
      for (const k of [...this.walk(a)]) { const n = this.nodes.get(k); const t = b + k.slice(a.length); if (n.dir) this.mkdirp(t); else this.write(t, n.data.slice(), { mkdirs: true }); }
    } else this.write(b, this.readBytes(a).slice());
  }
  changed() {
    clearTimeout(this._t); if (!this._since) this._since = Date.now();
    const wait = Date.now() - this._since > 1500 ? 0 : 60;      // a long burst of writes still reaches the folder
    this._t = setTimeout(() => { this._since = 0; this.listeners.forEach(f => f()); this.persist(); }, wait);
  }
  persist() { if (window.__restoring) return; if (this.diskOn) this.flush(); else idb.set('vfs', [...this.nodes.entries()]); }
  // apply the queued changes to the folder, in order. Returns false if one could not be written (it is retried).
  flush(force) {
    if (!this.diskOn || !this.ops.length) return true;
    if (window.__restoring && !force) return true;
    const ops = this.ops; this.ops = []; let i = 0;
    try {
      for (; i < ops.length; i++) {
        const o = ops[i];
        if (o.k === 'put') { const m = DK.write(o.a, o.b); o.node.mtime = m; o.node.dirty = false; if (this.nodes.get(o.node.p) === o.node) LRU.add(o.node); else o.node._d = null; }
        else if (o.k === 'mkdir') DK.mkdir(o.a);
        else if (o.k === 'del') DK.del(o.a);
        else if (o.k === 'mv') DK.move(o.a, o.b);
        else if (o.k === 'touch') { const m = DK.touch(o.a, o.b); if (o.node) o.node.mtime = m; }
        else if (o.k === 'clear') DK.clear();
      }
      this._failN = 0; return true;
    } catch (e) {
      const bad = ops[i]; bad.tries = (bad.tries || 0) + 1;
      const rest = ops.slice(bad.tries >= 3 ? i + 1 : i);
      this.ops = rest.concat(this.ops);
      console.warn('vault: could not write to storage', bad.k, bad.a, e.message);
      if (!this._warned || Date.now() - this._warned > 30000) { this._warned = Date.now(); try { toast('Could not save ' + esc(bad.a) + ' to storage: ' + esc(e.message), 'err'); } catch {} }
      if (this.ops.length) setTimeout(() => this.flush(), 4000);
      return false;
    }
  }
  // re-read the folder: pick up files that other apps added, changed or removed
  applyScan(list) {
    const next = new Map([['/', this.nodes.get('/') || { dir: true, mtime: Date.now() }]]); let changes = 0;
    for (const [p, d, size, mtime] of list) {
      const cur = this.nodes.get(p);
      if (d) { if (cur?.dir) next.set(p, cur); else { next.set(p, { dir: true, mtime }); changes++; } }
      else if (cur instanceof DNode && cur.size === size && cur.mtime === mtime) next.set(p, cur);
      else { LRU.drop(cur); const n = new DNode(p, size, mtime, null); next.set(p, n); changes++; }
    }
    for (const [p, n] of this.nodes) if (!next.has(p)) { LRU.drop(n); changes++; }
    this.nodes = next; return changes;
  }
  rescan(force) {
    if (!this.diskOn || !this.flush() || this.ops.length) return 0;
    if (!force && Date.now() - (this._scanned || 0) < 2000) return 0;
    this._scanned = Date.now();
    try { const c = this.applyScan(DK.scan()); if (c) this.listeners.forEach(f => f()); return c; } catch (e) { console.warn('vault: rescan failed', e.message); return 0; }
  }
  async load() {
    if (this.diskOn) {
      try { this.info = DK.info(); this.applyScan(DK.scan()); }
      catch (e) { console.warn('vault: storage unavailable, using the browser database', e.message); this.diskOn = false; }
    }
    if (!this.diskOn) { const e = await idb.get('vfs'); if (Array.isArray(e) && e.length) { this.nodes = new Map(e); return true; } return false; }
    await this.migrate();
    return this.nodes.size > 1;
  }
  // the vault used to be one big record in the browser database: copy it into the folder, check, then delete it
  async migrate() {
    const old = await idb.get('vfs'); if (!Array.isArray(old) || !old.length) return;
    let n = 0; const wrote = [];
    for (const [p, v] of old) {
      if (p === '/') continue;
      try { if (v.dir) { if (!this.exists(p)) this.mkdirp(p); } else if (!this.exists(p) && v.data) { this.write(p, v.data instanceof Uint8Array ? v.data : new Uint8Array(v.data), { mkdirs: true }); wrote.push([p, v.data.length]); n++; } } catch (e) { console.warn('vault: migrate', p, e.message); }
    }
    if (!this.flush(true)) { toast('Could not copy the vault to storage yet. Your notes are still safe in the app.', 'err'); return; }
    this.rescan(true);
    const missing = wrote.filter(([p, len]) => !this.isFile(p) || fsize(this.nodes.get(p)) !== len);
    if (missing.length) { toast(`Copied the vault but ${missing.length} files did not check out; the old copy is kept.`, 'err'); return; }
    await idb.del('vfs'); await idb.set('vfs-migrated', Date.now());
    if (n) setTimeout(() => toast(`Moved ${n} files out of the app database into ${esc(this.info?.root || 'storage')}.`, 'ok'), 1500);
  }
  entries() { return [...this.nodes.entries()]; }
  // swap the whole vault for these entries ([path, {dir}|{data}]); wipe=true also removes everything else from the folder first
  replace(entries, wipe) {
    const now = Date.now(); const next = new Map([['/', { dir: true, mtime: now }]]);
    if (!this.diskOn) { this.nodes = new Map(entries); if (!this.nodes.has('/')) this.nodes.set('/', { dir: true, mtime: now }); this.changed(); return; }
    if (wipe) { this.ops = [{ k: 'clear' }]; this.nodes.forEach(LRU.drop.bind(LRU)); } 
    const cur = wipe ? new Map() : this.nodes;
    for (const [p, n] of entries) {
      if (p === '/') continue;
      const old = cur.get(p);
      if (old === n) { next.set(p, old); continue; }
      if (n.dir) { if (!old?.dir) { if (old) this.op('del', p); this.op('mkdir', p); next.set(p, { dir: true, mtime: n.mtime || now }); } else next.set(p, old); }
      else {
        const bytes = n.data; LRU.drop(old);
        const node = new DNode(p, bytes.length, now, bytes); this.op('put', p, bytes, node); next.set(p, node);
      }
    }
    for (const [p, o] of cur) if (p !== '/' && !next.has(p)) { LRU.drop(o); this.op('del', p); }
    this.nodes = next; this.changed();
  }
}
