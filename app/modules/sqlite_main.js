/* =====================================================================
   SQLITE — SQLite 3.53 compiled to WebAssembly (embedded, works offline).
   - shell:  sqlite3 [opts] FILE ["SQL"...] | < script.sql | .dot commands
   - node:   require('node:sqlite').DatabaseSync, require('better-sqlite3')
   - python: import sqlite3 (DB-API: connect / execute / fetchall / commit / Row)
   Database files are ordinary vault files (real SQLite format, readable anywhere).
   ===================================================================== */
let sqliteModP = null;
const sqliteModule = () => (sqliteModP ||= gunzipB64('sqlite-wasm').then(b => WebAssembly.compile(b)).catch(e => { sqliteModP = null; throw e; }));
const SQLITE_GLUE_SRC = __jvSqlite.toString();
const isSqliteBytes = b => b && b.length >= 16 && String.fromCharCode(...b.subarray(0, 15)) === 'SQLite format 3';
const SQLITE_CLI_WORKER = `
self.onmessage = (ev) => {
  const { module, argv, stdin, dbBytes, files } = ev.data;
  try {
    const S = __jvSqlite(module);
    const r = S.cli({ argv, stdin, dbBytes, readFile: p => files[p] ?? null });
    self.postMessage(r, r.dbBytes ? [r.dbBytes.buffer] : []);
  } catch (e) { self.postMessage({ out: '', err: 'sqlite3: ' + ((e && e.message) || e) + '\\n', code: 1 }); }
};`;
async function runSqliteCli(c) {
  const argv = c.argv; let dbArg = null;
  for (let i = 0; i < argv.length; i++) { const a = argv[i]; if (['-separator', '--separator', '-nullvalue', '--nullvalue', '-cmd', '--cmd'].includes(a)) { i++; continue; } if (!a.startsWith('-')) { dbArg = a; break; } }
  const dbPath = dbArg && dbArg !== ':memory:' ? c.P(dbArg) : null;
  if (dbPath && vfs.isDir(dbPath)) { c.e(`Error: unable to open database "${dbArg}": it is a directory\n`); return 1; }
  const dbBytes = dbPath && vfs.isFile(dbPath) ? vfs.readBytes(dbPath) : null;
  if (dbBytes && dbBytes.length && !isSqliteBytes(dbBytes)) { c.e(`Error: file is not a database: ${dbArg}\n`); return 1; }
  // files that .import / .read may need (resolved relative to the shell's cwd)
  const files = {}; const src = [c.stdin || '', ...argv].join('\n');
  for (const m of src.matchAll(/^\s*\.(?:import|read)\s+(.+)$/gm)) for (const tok of m[1].match(/"[^"]*"|'[^']*'|\S+/g) || []) {
    const t = tok.replace(/^["']|["']$/g, ''); if (t.startsWith('--')) continue; const p = c.P(t); if (vfs.isFile(p)) files[t] = vfs.read(p);
  }
  let module; try { module = await sqliteModule(); } catch (e) { c.e(`sqlite3: could not load SQLite (${e.message})\n`); return 1; }
  const url = URL.createObjectURL(new Blob([SQLITE_GLUE_SRC, '\n', SQLITE_CLI_WORKER], { type: 'text/javascript' }));
  const r = await new Promise(resolve => {
    let w; try { w = new Worker(url); } catch (e) { resolve({ out: '', err: `sqlite3: could not start a worker (${e.message})\n`, code: 1 }); return; }
    const done = v => { clearTimeout(t); clearInterval(poll); w.terminate(); resolve(v); };
    const t = setTimeout(() => done({ out: '', err: `sqlite3: interrupted after ${c.sh.timeoutMs / 1000}s timeout\n`, code: 124 }), c.sh.timeoutMs);
    const poll = setInterval(() => { if (c.sh.aborted) done({ out: '', err: '^C\n', code: 130 }); }, 250);
    w.onmessage = e => done(e.data);
    w.onerror = e => { e.preventDefault?.(); done({ out: '', err: `sqlite3: ${e.message || 'worker error'}\n`, code: 1 }); };
    w.postMessage({ module, argv, stdin: c.stdin || '', dbBytes, files });
  });
  URL.revokeObjectURL(url);
  if (r.out) c.o(r.out); if (r.err) c.e(r.err);
  if (r.dbBytes && dbPath) { try { vfs.write(dbPath, new Uint8Array(r.dbBytes), { mkdirs: true }); } catch (e) { c.e(`sqlite3: could not save ${dbPath}: ${e.message}\n`); return 1; } }
  return r.code ?? 1;
}
// the Python side: a tiny string-only bridge (MicroPython ↔ JS) + the DB-API module written in Python
const SQLITE_PY_BRIDGE = `
function __jvSqliteBridge(S, FS) {
  const H = new Map(); let hid = 0;
  const abs = p => p.startsWith('/') ? p : ((FS.cwd() === '/' ? '' : FS.cwd()) + '/' + p);
  const b64 = u => { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
  const enc = v => v instanceof Uint8Array ? { $b: b64(v) } : typeof v === 'bigint' ? { $i: v.toString() } : v;
  const revive = (k, v) => v && typeof v === 'object' && !Array.isArray(v) ? (typeof v.$b === 'string' ? Uint8Array.from(atob(v.$b), c => c.charCodeAt(0)) : typeof v.$i === 'string' ? BigInt(v.$i) : v) : v;
  const flush = (h) => { const x = H.get(h); if (x && x.fp && x.d.dirty) { FS.writeFile(x.fp, x.d.export()); x.d.dirty = false; } return 0; };
  return {
    version: () => S.version,
    open: (path) => { const p = String(path); let fp = null, bytes = null; if (p && p !== ':memory:') { fp = abs(p); try { bytes = FS.readFile(fp); } catch (e) {} } const d = new S.Database(bytes); H.set(++hid, { d, fp }); return hid; },
    execute: (h, sql, pj) => { const x = H.get(h); try { const params = pj ? JSON.parse(pj, revive) : null; let cols = [], rows = [], n = 0;
        x.d.each(String(sql), st => { if (n++) throw new Error('You can only execute one statement at a time.'); cols = st.columns(); rows = st.rows(params); });
        return JSON.stringify({ cols, rows: rows.map(r => r.map(enc)), changes: x.d.changes(), lastrowid: Number(x.d.lastInsertRowid()), total: x.d.totalChanges() });
      } catch (e) { return JSON.stringify({ error: String(e.message || e) }); } },
    script: (h, sql) => { try { H.get(h).d.exec(String(sql)); return '{}'; } catch (e) { return JSON.stringify({ error: String(e.message || e) }); } },
    flush,
    close: (h) => { flush(h); const x = H.get(h); if (x) { x.d.close(); H.delete(h); } return 0; },
    flushAll: () => { for (const h of H.keys()) flush(h); return 0; },
  };
}`;
const SQLITE_PY_SHIM = `
def __jv_sqlite():
    import sys, json, binascii
    import _jvsqlite as J
    class Error(Exception): pass
    class Warning(Exception): pass
    class InterfaceError(Error): pass
    class DatabaseError(Error): pass
    class OperationalError(DatabaseError): pass
    class IntegrityError(DatabaseError): pass
    class ProgrammingError(DatabaseError): pass
    def _enc(v):
        if isinstance(v, (bytes, bytearray)):
            return {'$b': binascii.b2a_base64(bytes(v)).decode().strip()}
        return v
    def _dec(v):
        if isinstance(v, dict):
            if '$b' in v:
                return binascii.a2b_base64(v['$b'])
            if '$i' in v:
                return int(v['$i'])
        return v
    def _raise(msg):
        low = msg.lower()
        if 'constraint' in low:
            raise IntegrityError(msg)
        if 'one statement' in low or 'parameter' in low or 'values for' in low:
            raise ProgrammingError(msg)
        raise OperationalError(msg)
    def _starts(s, words):
        for w in words:
            if s.startswith(w):
                return True
        return False
    class Row:
        def __init__(self, cols, vals):
            self._c = cols
            self._v = vals
        def keys(self):
            return list(self._c)
        def __getitem__(self, k):
            if isinstance(k, str):
                lk = k.lower()
                for i, c in enumerate(self._c):
                    if c.lower() == lk:
                        return self._v[i]
                raise IndexError('No item with that key')
            return self._v[k]
        def __len__(self):
            return len(self._v)
        def __iter__(self):
            return iter(self._v)
        def __eq__(self, o):
            return isinstance(o, Row) and o._c == self._c and o._v == self._v
        def __repr__(self):
            return '<Row %r>' % (tuple(self._v),)
    class Cursor:
        def __init__(self, conn):
            self.connection = conn
            self._rows = []
            self._i = 0
            self.description = None
            self.rowcount = -1
            self.lastrowid = None
            self.row_factory = None
            self.arraysize = 1
        def execute(self, sql, params=()):
            c = self.connection
            c._check()
            if isinstance(params, dict):
                p = {}
                for k in params:
                    p[k] = _enc(params[k])
            else:
                p = [_enc(v) for v in params]
            r = json.loads(J.execute(c._h, sql, json.dumps(p) if p else ''))
            if 'error' in r:
                _raise(r['error'])
            cols = r['cols']
            rf = self.row_factory or c.row_factory
            rows = [tuple([_dec(v) for v in row]) for row in r['rows']]
            if rf is Row:
                rows = [Row(cols, list(t)) for t in rows]
            elif rf:
                rows = [rf(self, t) for t in rows]
            self._rows = rows
            self._i = 0
            self.description = tuple([(n, None, None, None, None, None, None) for n in cols]) if cols else None
            u = sql.lstrip()[:7].upper()
            self.rowcount = r['changes'] if _starts(u, ('INSERT', 'UPDATE', 'DELETE', 'REPLACE')) else -1
            if _starts(u, ('INSERT', 'REPLACE')):
                self.lastrowid = r['lastrowid']
            c.total_changes = r.get('total', c.total_changes)
            return self
        def executemany(self, sql, seq):
            n = 0
            for p in seq:
                self.execute(sql, p)
                if self.rowcount > 0:
                    n += self.rowcount
            self.rowcount = n
            return self
        def executescript(self, script):
            self.connection.executescript(script)
            return self
        def fetchone(self):
            if self._i < len(self._rows):
                self._i += 1
                return self._rows[self._i - 1]
            return None
        def fetchmany(self, size=None):
            size = size or self.arraysize
            out = self._rows[self._i:self._i + size]
            self._i += len(out)
            return out
        def fetchall(self):
            out = self._rows[self._i:]
            self._i = len(self._rows)
            return out
        def __iter__(self):
            return self
        def __next__(self):
            r = self.fetchone()
            if r is None:
                raise StopIteration
            return r
        def close(self):
            pass
    class Connection:
        def __init__(self, path):
            self._h = J.open(str(path))
            self.row_factory = None
            self.total_changes = 0
            self.isolation_level = ''
        def _check(self):
            if self._h is None:
                raise ProgrammingError('Cannot operate on a closed database.')
        def cursor(self):
            self._check()
            return Cursor(self)
        def execute(self, sql, params=()):
            return self.cursor().execute(sql, params)
        def executemany(self, sql, seq):
            return self.cursor().executemany(sql, seq)
        def executescript(self, script):
            self._check()
            r = json.loads(J.script(self._h, script))
            if 'error' in r:
                _raise(r['error'])
            return self.cursor()
        def commit(self):
            self._check()
            J.flush(self._h)
        def rollback(self):
            pass
        def close(self):
            if self._h is not None:
                J.close(self._h)
                self._h = None
        def __enter__(self):
            return self
        def __exit__(self, t, v, tb):
            if t is None:
                self.commit()
            return False
    class _Mod:
        pass
    m = _Mod()
    m.Error = Error
    m.Warning = Warning
    m.InterfaceError = InterfaceError
    m.DatabaseError = DatabaseError
    m.OperationalError = OperationalError
    m.IntegrityError = IntegrityError
    m.ProgrammingError = ProgrammingError
    m.Row = Row
    m.Cursor = Cursor
    m.Connection = Connection
    def connect(database, *a, **k):
        return Connection(database)
    m.connect = connect
    m.sqlite_version = J.version()
    m.version = '2.6.0'
    m.PARSE_DECLTYPES = 1
    m.PARSE_COLNAMES = 2
    m.paramstyle = 'qmark'
    sys.modules['sqlite3'] = m
try:
    __jv_sqlite()
except Exception as e:
    print('sqlite3 module failed to load:', e)
del __jv_sqlite
`;
