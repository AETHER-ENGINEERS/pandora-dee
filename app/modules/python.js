/* =====================================================================
   PYTHON — MicroPython (the WebAssembly build PyScript uses), run in a worker
   `python file.py args`, `python -c "code"`, `echo code | python`. The vault is the filesystem:
   open()/os see the same files as the shell and node, and changes are written back.
   The runtime (~0.5 MB) comes from jsDelivr once and is kept in IndexedDB, so it then works offline.
   ===================================================================== */
const MPY_VER = '1.27.0';
const MPY_BASE = `https://cdn.jsdelivr.net/npm/@micropython/micropython-webassembly-pyscript@${MPY_VER}/`;
let mpyAssetsP = null;
// a real wasm module starts with the bytes 00 61 73 6d; an empty or truncated download (or cache entry) fails here
const wasmOk = u8 => !!u8 && u8.length >= 8 && u8[0] === 0 && u8[1] === 0x61 && u8[2] === 0x73 && u8[3] === 0x6d;
async function mpyAssets() {
  return (mpyAssetsP ||= (async () => {
    let c = await idb.get('mpy:' + MPY_VER);
    if (c && (!c.mjs || !wasmOk(c.wasm && new Uint8Array(c.wasm)))) { c = null; try { await idb.del('mpy:' + MPY_VER); } catch {} }   // bad cache entry: download again
    if (!c) {
      let m, w;
      try {
        [m, w] = await Promise.all([
          fetch(MPY_BASE + 'micropython.mjs').then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); }),
          fetch(MPY_BASE + 'micropython.wasm').then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); }),
        ]);
      } catch (e) { throw new Error(`could not download MicroPython ${MPY_VER} (${e.message}). Python needs internet once; after that it works offline.`); }
      const wb = new Uint8Array(w);
      if (!m || !wasmOk(wb)) throw new Error(`MicroPython ${MPY_VER} downloaded incomplete (${wb.length} bytes of wasm). Check the connection and try again.`);
      c = { mjs: m, wasm: wb }; await idb.set('mpy:' + MPY_VER, c);
    }
    c.wasm = new Uint8Array(c.wasm);
    // a data: URL (not blob:) so the worker can fetch it even on file:// pages
    return { factory: mpyClassic(c.mjs), wasm: 'data:application/wasm;base64,' + b64enc(c.wasm), size: c.wasm.length };
  })().catch(e => { mpyAssetsP = null; throw e; }));
}
// micropython.mjs is an ES module (Emscripten output + api.js). Module workers and blob imports fail on
// file:// pages (the Android app), so turn it into a classic script: wrap it in an async function (its
// top-level awaits are Node-only) and drop the export keywords / import.meta.
function mpyClassic(src) {
  const meta = JSON.stringify(MPY_BASE + 'micropython.mjs');
  const named = {};                                   // exported name -> local name
  const body = String(src)
    .replace(/import\.meta\.url/g, meta).replace(/import\.meta\b/g, `({ url: ${meta} })`)
    // export { a as loadMicroPython, b }  (minified builds put this at the very end of one long line)
    .replace(/\bexport\s*\{([^}]*)\}\s*;?/g, (m, list) => { for (const part of list.split(',')) { const [local, as] = part.trim().split(/\s+as\s+/); if (local) named[(as || local).trim()] = local.trim(); } return ';'; })
    // export default X;
    .replace(/\bexport\s+default\s+(?=[\w$])/g, 'var __mpyDefault = ')
    // export async function / function / const / let / var / class
    .replace(/\bexport\s+(?=(?:async\s+function|function\*?|const|let|var|class)\b)/g, '');
  const loader = named.loadMicroPython || 'loadMicroPython';
  // Emscripten's browser check reads "Version/4.0 ... Safari/537.36" in Android WebView's user agent as
  // Safari 4 and refuses to run. Give the module a navigator whose userAgent lacks the Version/ token.
  const nav = `const navigator = (() => { const n = globalThis.navigator; if (!n) return n; const ua = String(n.userAgent || '').replace(/\\s*Version\\/[\\d.]+/, '');
    return new Proxy(n, { get: (t, k) => k === 'userAgent' ? ua : (typeof t[k] === 'function' ? t[k].bind(t) : t[k]) }); })();\n`;
  return `const __mpyFactory = async () => {\n${nav}${body}\n;return { loadMicroPython: typeof ${loader} === 'function' ? ${loader} : undefined };\n};\n`;
}
// os.walk / os.path / os.makedirs for scripts written for CPython (MicroPython's os lacks them)
const MPY_COMPAT = "def __jv_compat():\n    import sys\n    import os as _os\n    if hasattr(_os, 'walk') and hasattr(_os, 'path'):\n        return\n    S_IFMT, S_IFDIR, S_IFREG = 0o170000, 0o040000, 0o100000\n    class _Path:\n        sep = '/'\n        curdir = '.'\n        def join(self, a, *p):\n            for b in p:\n                if b.startswith('/'):\n                    a = b\n                elif not a or a.endswith('/'):\n                    a = a + b\n                else:\n                    a = a + '/' + b\n            return a\n        def _mode(self, p):\n            try:\n                return _os.stat(p)[0]\n            except OSError:\n                return None\n        def exists(self, p):\n            return self._mode(p) is not None\n        def isdir(self, p):\n            m = self._mode(p)\n            return m is not None and (m & S_IFMT) == S_IFDIR\n        def isfile(self, p):\n            m = self._mode(p)\n            return m is not None and (m & S_IFMT) == S_IFREG\n        def getsize(self, p):\n            return _os.stat(p)[6]\n        def basename(self, p):\n            return p.rsplit('/', 1)[-1]\n        def dirname(self, p):\n            if '/' not in p:\n                return ''\n            d = p.rsplit('/', 1)[0]\n            return d if d else '/'\n        def split(self, p):\n            return (self.dirname(p), self.basename(p))\n        def splitext(self, p):\n            b = self.basename(p)\n            i = b.rfind('.')\n            if i <= 0:\n                return (p, '')\n            return (p[:len(p) - len(b) + i], b[i:])\n        def normpath(self, p):\n            absolute = p.startswith('/')\n            out = []\n            for s in p.split('/'):\n                if s in ('', '.'):\n                    continue\n                if s == '..':\n                    if out and out[-1] != '..':\n                        out.pop()\n                    elif not absolute:\n                        out.append(s)\n                else:\n                    out.append(s)\n            r = '/'.join(out)\n            return ('/' + r) if absolute else (r or '.')\n        def abspath(self, p):\n            return self.normpath(p if p.startswith('/') else self.join(_os.getcwd(), p))\n        def relpath(self, p, start='.'):\n            a = [x for x in self.abspath(p).split('/') if x]\n            b = [x for x in self.abspath(start).split('/') if x]\n            i = 0\n            while i < len(a) and i < len(b) and a[i] == b[i]:\n                i += 1\n            return '/'.join(['..'] * (len(b) - i) + a[i:]) or '.'\n        def expanduser(self, p):\n            return '/' + p[2:] if p.startswith('~/') else ('/' if p == '~' else p)\n    path = _Path()\n    def walk(top, topdown=True):\n        try:\n            names = _os.listdir(top)\n        except OSError:\n            return\n        dirs, files = [], []\n        for n in names:\n            (dirs if path.isdir(path.join(top, n)) else files).append(n)\n        if topdown:\n            yield top, dirs, files\n        for d in dirs:\n            yield from walk(path.join(top, d), topdown)\n        if not topdown:\n            yield top, dirs, files\n    def makedirs(p, exist_ok=False):\n        cur = '/' if p.startswith('/') else ''\n        for part in [x for x in p.split('/') if x]:\n            cur = path.join(cur, part) if cur else part\n            if not path.isdir(cur):\n                _os.mkdir(cur)\n            elif cur == p.rstrip('/') and not exist_ok:\n                raise OSError(17)\n    class _OS:\n        def __getattr__(self, k):\n            return getattr(_os, k)\n    m = _OS()\n    m.path = path\n    m.sep = '/'\n    if not hasattr(_os, 'walk'):\n        m.walk = walk\n    if not hasattr(_os, 'makedirs'):\n        m.makedirs = makedirs\n    sys.modules['os'] = m\n    sys.modules['os.path'] = path\ntry:\n    __jv_compat()\nexcept Exception:\n    pass\ndel __jv_compat\n";
const MPY_WORKER = `
const dec = new TextDecoder();
self.onmessage = async (ev) => {
  const { wasm, files, dirs, cwd, argv, code, stdin, heap, compat, sqliteModule, sqliteShim } = ev.data;
  const outB = [], errB = [], out = [];
  const flush = () => { if (outB.length) { out.push(['o', dec.decode(new Uint8Array(outB.splice(0)))]); } if (errB.length) { out.push(['e', dec.decode(new Uint8Array(errB.splice(0)))]); } };
  let exit = 0, FS = null, SQ = null; const orig = new Map(Object.entries(files));
  try {
    const { loadMicroPython } = await __mpyFactory();
    let si = 0; const sin = new TextEncoder().encode(stdin || '');
    const mp = await loadMicroPython({ url: wasm, heapsize: heap, linebuffer: false,
      stdout: b => { for (const x of b) outB.push(x); if (outB.length > 4096) flush(); },
      stderr: b => { for (const x of b) errB.push(x); if (errB.length > 4096) flush(); },
      stdin: () => si < sin.length ? sin[si++] : null });
    FS = mp.FS;
    const mk = p => { const parts = p.split('/').filter(Boolean); let cur = ''; for (const s of parts) { cur += '/' + s; try { FS.mkdir(cur); } catch {} } };
    for (const d of dirs) if (d !== '/') mk(d);
    for (const [p, data] of orig) { mk(p.slice(0, p.lastIndexOf('/')) || '/'); FS.writeFile(p, data); }
    try { FS.chdir(cwd); } catch {}
    const scriptDir = argv[0] && argv[0].startsWith('/') ? argv[0].slice(0, argv[0].lastIndexOf('/')) || '/' : cwd;
    try { mp.runPython(compat); } catch (e) {}
    if (sqliteModule && typeof __jvSqliteBridge === 'function') { SQ = __jvSqliteBridge(__jvSqlite(sqliteModule), FS); mp.registerJsModule('_jvsqlite', SQ); try { mp.runPython(sqliteShim); } catch (e) {} }
    mp.runPython('import sys\\nsys.argv[:] = ' + JSON.stringify(argv) + '\\nif ' + JSON.stringify(scriptDir) + ' not in sys.path: sys.path.insert(0, ' + JSON.stringify(scriptDir) + ')');
    await mp.runPythonAsync(code);
  } catch (e) {
    flush();
    const msg = String((e && e.message) || e);
    const m = /SystemExit(?::\\s*(-?\\d+))?\\s*$/.exec(msg.trim());
    if (m) exit = m[1] ? +m[1] : 0;
    else { out.push(['e', msg.endsWith('\\n') ? msg : msg + '\\n']); exit = 1; }
  }
  flush();
  try { SQ && SQ.flushAll(); } catch (e) {}
  const writes = {}, deletes = [], mkdirs = [];
  if (FS) {
    const seen = new Set();
    const walk = (dir) => {
      let names = []; try { names = FS.readdir(dir); } catch { return; }
      for (const n of names) {
        if (n === '.' || n === '..') continue;
        const p = (dir === '/' ? '' : dir) + '/' + n;
        if (/^\\/(dev|proc|home\\/web_user)(\\/|$)/.test(p) || p === '/home' && !dirs.includes('/home')) continue;
        let st; try { st = FS.stat(p); } catch { continue; }
        if (FS.isDir(st.mode)) { if (!dirs.includes(p) && p !== '/tmp') mkdirs.push(p); walk(p); }
        else { seen.add(p); const data = FS.readFile(p); const o = orig.get(p); if (!o || o.length !== data.length || o.some((x, i) => x !== data[i])) writes[p] = data; }
      }
    };
    walk('/');
    for (const p of orig.keys()) if (!seen.has(p)) deletes.push(p);
  }
  self.postMessage({ out, writes, deletes, mkdirs, code: exit });
};`;
async function runPython(c) {
  const a = c.argv; let code, argv;
  if (a[0] === '--version' || a[0] === '-V') { c.o(`MicroPython ${MPY_VER} (WebAssembly, the PyScript build)\n`); return 0; }
  if (a[0] === '-m' && a[1] === 'pip') { c.e('pip is not available: MicroPython runs in the browser and has no package installer. Use its standard library (json, re, math, random, collections, os, time, hashlib, struct, binascii, heapq, io).\n'); return 1; }
  if (a[0] === '-c') { code = a[1] ?? ''; argv = ['-c', ...a.slice(2)]; }
  else if (a.length && a[0] !== '-') { const p = c.P(a[0]); if (!vfs.isFile(p)) { c.e(`python: can't open file '${a[0]}': No such file\n`); return 2; } code = vfs.read(p); argv = [p, ...a.slice(1)]; }
  else { code = c.stdin; argv = ['']; }
  if (!String(code).trim()) { c.e('python: no script given. Use python file.py or python -c "code"\n'); return 2; }
  let assets; try { assets = await mpyAssets(); } catch (e) { c.e(`python: ${e.message}\n`); return 1; }
  // files under 4 MB go to every script; a bigger one (a backup, say) only when the script names it, by path or file name, in its code or arguments
  const named = s => String(code).includes(s) || argv.some(x => String(x).includes(s)); let room = 64e6, bigBytes = 0;
  const files = {}, dirs = [];
  for (const [p, n] of vfs.nodes) { if (n.dir) dirs.push(p); else if (n.data.length < 4e6) files[p] = n.data; else if (n.data.length <= room && (named(p) || named(vfs.base(p)))) { files[p] = n.data; room -= n.data.length; bigBytes += n.data.length; } }
  // SQLite rides along only when something mentions it (the script or any .py it may import)
  let sqMod = null;
  if (/sqlite/i.test(code) || [...vfs.nodes].some(([p, n]) => !n.dir && p.endsWith('.py') && n.data.length < 2e6 && /sqlite/i.test(dec.decode(n.data)))) {
    try { sqMod = await sqliteModule(); } catch (e) { c.e(`python: could not load SQLite (${e.message})\n`); }
  }
  const wurl = URL.createObjectURL(new Blob(sqMod ? [assets.factory, SQLITE_GLUE_SRC, '\n', SQLITE_PY_BRIDGE, '\n', MPY_WORKER] : [assets.factory, MPY_WORKER], { type: 'text/javascript' }));
  const r = await new Promise(resolve => {
    let w; try { w = new Worker(wurl); } catch (e) { resolve({ out: [['e', `python: could not start a worker (${e.message})\n`]], code: 1 }); return; }
    const done = (v) => { clearTimeout(t); clearInterval(poll); w.terminate(); resolve(v); };
    const t = setTimeout(() => done({ out: [['e', `python: killed after ${c.sh.timeoutMs / 1000}s timeout\n`]], code: 124 }), c.sh.timeoutMs);
    const poll = setInterval(() => { if (c.sh.aborted) done({ out: [['e', '^C\n']], code: 130 }); }, 250);
    w.onmessage = e => done(e.data);
    w.onerror = e => { e.preventDefault?.(); done({ out: [['e', `python: ${e.message || 'worker error'}\n`]], code: 1 }); };
    w.postMessage({ sqliteModule: sqMod, sqliteShim: SQLITE_PY_SHIM, compat: MPY_COMPAT, wasm: assets.wasm, files, dirs, cwd: c.sh.cwd, argv, code, stdin: a[0] === '-c' || a.length && a[0] !== '-' ? c.stdin : '', heap: Math.min(256 * 1024 * 1024, Math.max(16 * 1024 * 1024, 4 * bigBytes)) });
  });
  URL.revokeObjectURL(wurl);
  for (const [k, v] of r.out || []) k === 'o' ? c.o(v) : c.e(v);
  for (const q of r.deletes || []) { const p = pandoraPath(q); if (vfs.isFile(p)) vfs.rm(p); }
  for (const p of r.mkdirs || []) { try { vfs.mkdirp(pandoraPath(p)); } catch {} }
  for (const [p, d] of Object.entries(r.writes || {})) { try { vfs.write(pandoraPath(p), d, { mkdirs: true }); } catch (e) { c.e(`python: could not save ${p}: ${e.message}\n`); } }
  return r.code ?? 1;
}
// fetch the runtime in the background once, so Python also works offline later (phone app)
setTimeout(() => {
  if (navigator.onLine === false) return; const go = () => mpyAssets().catch(() => {});
  if (window.requestIdleCallback) requestIdleCallback(go, { timeout: 10000 }); else setTimeout(go, 2000);
}, 20000);
