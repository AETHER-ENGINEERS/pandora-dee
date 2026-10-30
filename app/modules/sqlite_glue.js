/* SQLite 3.53 compiled to WebAssembly (clang + wasi-libc, SQLITE_OS_OTHER), plus a small JS API.
   Self-contained: this whole function is shipped into workers as source text.
   Databases live in memory; files are loaded with sqlite3_deserialize and saved with sqlite3_serialize. */
function __jvSqlite(wasmModule) {
  let mem = null;
  const imports = { wasi_snapshot_preview1: {
    clock_time_get(id, prec, out) { new DataView(mem.buffer).setBigUint64(out, BigInt(Date.now()) * 1000000n, true); return 0; },
    // sqlite-vec pulls in a little of wasi-libc's stdio: no files, no preopened folders, nothing to write to
    fd_close() { return 8; }, fd_seek() { return 8; }, fd_write(fd, iov, n, out) { let t = 0; const d = new DataView(mem.buffer); for (let i = 0; i < n; i++) t += d.getUint32(iov + i * 8 + 4, true); d.setUint32(out, t, true); return 0; },
    fd_prestat_get() { return 8; }, fd_prestat_dir_name() { return 8; }, proc_exit(c) { throw new Error('sqlite exited (' + c + ')'); },
    random_get(ptr, len) { const u = new Uint8Array(mem.buffer, ptr, len); for (let i = 0; i < len; i += 65536) crypto.getRandomValues(u.subarray(i, Math.min(len, i + 65536))); return 0; },
  } };
  const inst = new WebAssembly.Instance(wasmModule, imports); const X = inst.exports; mem = X.memory;
  X._initialize(); X.sqlite3_initialize();
  const te = new TextEncoder(), td = new TextDecoder();
  const u8 = () => new Uint8Array(mem.buffer), dv = () => new DataView(mem.buffer);
  const cstr = (p) => { if (!p) return null; const m = u8(); let e = p; while (m[e]) e++; return td.decode(m.subarray(p, e)); };
  const alloc = (n) => { const p = X.jv_malloc(Math.max(1, n)); if (!p) throw new Error('out of memory'); return p; };
  const withStr = (s, fn) => { const b = te.encode(String(s)); const p = alloc(b.length + 1); u8().set(b, p); u8()[p + b.length] = 0; try { return fn(p, b.length); } finally { X.jv_free(p); } };
  const SQLITE_OK = 0, SQLITE_ROW = 100, SQLITE_DONE = 101, TRANSIENT = -1;
  const version = cstr(X.sqlite3_libversion());

  class SqliteError extends Error { constructor(msg, code) { super(msg); this.code = code; this.name = 'SqliteError'; } }
  class Statement {
    constructor(db, p, sql) { this.db = db; this.p = p; this.sql = sql; this.readonly = !!X.sqlite3_stmt_readonly(p); }
    columns() { const n = X.sqlite3_column_count(this.p), out = []; for (let i = 0; i < n; i++) out.push(cstr(X.sqlite3_column_name(this.p, i))); return out; }
    bind(params) {
      X.sqlite3_reset(this.p); X.sqlite3_clear_bindings(this.p);
      if (params == null) return this;
      const n = X.sqlite3_bind_parameter_count(this.p);
      const set = (i, v) => {
        let rc;
        if (v === null || v === undefined) rc = X.sqlite3_bind_null(this.p, i);
        else if (typeof v === 'bigint') rc = X.sqlite3_bind_int64(this.p, i, v);
        else if (typeof v === 'boolean') rc = X.sqlite3_bind_int64(this.p, i, v ? 1n : 0n);
        else if (typeof v === 'number') rc = Number.isSafeInteger(v) ? X.sqlite3_bind_int64(this.p, i, BigInt(v)) : X.sqlite3_bind_double(this.p, i, v);
        else if (v instanceof Uint8Array || v instanceof ArrayBuffer) { const b = v instanceof Uint8Array ? v : new Uint8Array(v); const q = alloc(b.length); u8().set(b, q); rc = X.sqlite3_bind_blob(this.p, i, q, b.length, TRANSIENT); X.jv_free(q); }
        else rc = withStr(typeof v === 'object' ? JSON.stringify(v) : v, (q, len) => X.sqlite3_bind_text(this.p, i, q, len, TRANSIENT));
        if (rc !== SQLITE_OK) throw this.db.err(rc);
      };
      if (Array.isArray(params)) { if (params.length > n) throw new SqliteError(`${params.length} values for ${n} parameters`, 25); params.forEach((v, k) => set(k + 1, v)); }
      else if (typeof params === 'object' && !(params instanceof Uint8Array)) {
        for (const [k, v] of Object.entries(params)) {
          let idx = 0; for (const pre of /^[:@$?]/.test(k) ? [''] : [':', '@', '$']) { idx = withStr(pre + k, q => X.sqlite3_bind_parameter_index(this.p, q)); if (idx) break; }
          if (!idx) throw new SqliteError(`no parameter named ${k}`, 25); set(idx, v);
        }
      } else set(1, params);
      return this;
    }
    value(i) {
      switch (X.sqlite3_column_type(this.p, i)) {
        case 1: { const v = X.sqlite3_column_int64(this.p, i); return (v >= BigInt(Number.MIN_SAFE_INTEGER) && v <= BigInt(Number.MAX_SAFE_INTEGER)) ? Number(v) : v; }
        case 2: return X.sqlite3_column_double(this.p, i);
        case 3: { const q = X.sqlite3_column_text(this.p, i); const n = X.sqlite3_column_bytes(this.p, i); return td.decode(u8().subarray(q, q + n)); }
        case 4: { const q = X.sqlite3_column_blob(this.p, i); const n = X.sqlite3_column_bytes(this.p, i); return u8().slice(q, q + n); }
        default: return null;
      }
    }
    step() { const rc = X.sqlite3_step(this.p); if (rc === SQLITE_ROW) return true; if (rc === SQLITE_DONE) { if (!this.readonly) this.db.dirty = true; return false; } throw this.db.err(rc); }
    row() { const n = X.sqlite3_data_count(this.p), r = []; for (let i = 0; i < n; i++) r.push(this.value(i)); return r; }
    *iterate(params) { this.bind(params); while (this.step()) yield this.row(); }
    rows(params) { return [...this.iterate(params)]; }
    finalize() { if (this.p) { X.sqlite3_finalize(this.p); this.p = 0; } }
  }
  class Database {
    constructor(bytes) {
      this.p = withStr(':memory:', q => { const pp = alloc(4); try { const rc = X.sqlite3_open_v2(q, pp, 0x02 | 0x04, 0); const db = dv().getUint32(pp, true); if (rc !== SQLITE_OK) throw new SqliteError('cannot open database', rc); return db; } finally { X.jv_free(pp); } });
      this.dirty = false;
      if (bytes && bytes.length) {
        const n = bytes.length; const q = X.sqlite3_malloc64(BigInt(n)); u8().set(bytes, q);
        const rc = withStr('main', s => X.sqlite3_deserialize(this.p, s, q, BigInt(n), BigInt(n), 1 | 2));   // FREEONCLOSE | RESIZEABLE
        if (rc !== SQLITE_OK) throw new SqliteError('file is not a database', 26);
        try { this.exec('SELECT count(*) FROM sqlite_schema'); } catch (e) { throw new SqliteError('file is not a database', 26); }
      }
    }
    err(rc) { return new SqliteError(cstr(X.sqlite3_errmsg(this.p)) || `SQLite error ${rc}`, X.sqlite3_extended_errcode(this.p)); }
    // prepare every statement in sql; calls fn(stmt) for each (stmt is finalized afterwards)
    each(sql, fn) {
      const b = te.encode(String(sql)); const base = alloc(b.length + 1); u8().set(b, base); u8()[base + b.length] = 0;
      const pp = alloc(4), pt = alloc(4); let cur = base; const end = base + b.length;
      try {
        while (cur < end) {
          const rc = X.sqlite3_prepare_v2(this.p, cur, end - cur, pp, pt); if (rc !== SQLITE_OK) throw this.err(rc);
          const sp = dv().getUint32(pp, true); const next = dv().getUint32(pt, true);
          if (sp) { const st = new Statement(this, sp, td.decode(u8().subarray(cur, next)).trim()); try { fn(st); } finally { st.finalize(); } }
          if (next <= cur) break; cur = next;
        }
      } finally { X.jv_free(pp); X.jv_free(pt); X.jv_free(base); }
    }
    exec(sql, params) { const out = []; let first = true; this.each(sql, st => { const r = { columns: st.columns(), values: st.rows(first ? params : null) }; first = false; if (r.columns.length) out.push(r); }); return out; }
    prepare(sql) {
      const pp = alloc(4); try { const rc = withStr(sql, (q, n) => X.sqlite3_prepare_v2(this.p, q, n, pp, 0)); if (rc !== SQLITE_OK) throw this.err(rc); const sp = dv().getUint32(pp, true); if (!sp) throw new SqliteError('empty statement', 21); return new Statement(this, sp, sql); } finally { X.jv_free(pp); }
    }
    changes() { return X.sqlite3_changes(this.p); }
    totalChanges() { return X.sqlite3_total_changes(this.p); }
    lastInsertRowid() { const v = X.sqlite3_last_insert_rowid(this.p); return v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v; }
    inTransaction() { return !X.sqlite3_get_autocommit(this.p); }
    export() {
      const ps = alloc(8); try { const q = withStr('main', s => X.sqlite3_serialize(this.p, s, ps, 0)); const n = Number(dv().getBigInt64(ps, true)); if (!q) return new Uint8Array(0); const out = u8().slice(q, q + n); X.sqlite3_free(q); return out; } finally { X.jv_free(ps); }
    }
    close() { if (this.p) { X.sqlite3_close_v2(this.p); this.p = 0; } }
  }
  const complete = (sql) => withStr(sql, q => X.sqlite3_complete(q)) !== 0;

  /* ---------- the sqlite3 command-line shell (batch mode) ---------- */
  function cli({ argv, stdin, readFile, dbBytes }) {
    let out = '', err = '', exit = 0, mode = 'list', headers = false, sep = '|', nullv = '', bail = false, readonly = false, dbPath = null, cmds = [], sqls = [];
    const o = s => { out += s; }, e = s => { err += s; };
    const opts = { '-json': 'json', '-csv': 'csv', '-column': 'column', '-box': 'box', '-table': 'table', '-markdown': 'markdown', '-line': 'line', '-list': 'list', '-html': 'html', '-tabs': 'tabs', '-quote': 'quote' };
    for (let i = 0; i < argv.length; i++) {
      const a = argv[i].replace(/^--/, '-');
      if (opts[a]) { mode = opts[a]; if (['csv', 'tabs'].includes(mode)) sep = mode === 'csv' ? ',' : '\t'; if (['column', 'box', 'table', 'markdown'].includes(mode)) headers = true; }
      else if (a === '-header' || a === '-headers') headers = true; else if (a === '-noheader') headers = false;
      else if (a === '-separator') sep = argv[++i] ?? '|'; else if (a === '-nullvalue') nullv = argv[++i] ?? '';
      else if (a === '-cmd') cmds.push(argv[++i] ?? ''); else if (a === '-bail') bail = true; else if (a === '-readonly') readonly = true;
      else if (a === '-version') { o(version + '\n'); return { out, err, code: 0 }; }
      else if (a === '-help') { o(HELP); return { out, err, code: 0 }; }
      else if (a.startsWith('-') && a.length > 1) { e(`sqlite3: unknown option: ${argv[i]}\nUse -help for a list of options.\n`); return { out, err, code: 1 }; }
      else if (dbPath === null) dbPath = argv[i]; else sqls.push(argv[i]);
    }
    let db;
    try { db = new Database(dbPath && dbPath !== ':memory:' ? dbBytes : null); } catch (x) { e(`Error: unable to open database "${dbPath}": ${x.message}\n`); return { out, err, code: 1 }; }
    let changesOn = false; let stop = false;
    const fmt = v => v === null ? nullv : v instanceof Uint8Array ? (mode === 'json' || mode === 'quote' ? "X'" + [...v].map(b => b.toString(16).padStart(2, '0')).join('') + "'" : td.decode(v)) : typeof v === 'bigint' ? v.toString() : String(v);
    const csvq = s => /[",\n\r]/.test(s) || s !== s.trim() ? '"' + s.replace(/"/g, '""') + '"' : s;
    const sqlq = v => v === null ? 'NULL' : typeof v === 'number' || typeof v === 'bigint' ? String(v) : v instanceof Uint8Array ? "X'" + [...v].map(b => b.toString(16).padStart(2, '0')).join('') + "'" : "'" + String(v).replace(/'/g, "''") + "'";
    const show = (cols, rows) => {
      if (!cols.length) return;
      if (mode === 'json') { if (!rows.length) return; o('[' + rows.map(r => '{' + cols.map((c, i) => JSON.stringify(c) + ':' + (r[i] instanceof Uint8Array ? JSON.stringify(fmt(r[i])) : typeof r[i] === 'bigint' ? r[i].toString() : JSON.stringify(r[i]))).join(',') + '}').join(',\n') + ']\n'); return; }
      if (mode === 'line') { const w = Math.max(...cols.map(c => c.length)); rows.forEach((r, k) => { if (k) o('\n'); cols.forEach((c, i) => o(c.padStart(w) + ' = ' + fmt(r[i]) + '\n')); }); return; }
      if (mode === 'csv') { if (headers) o(cols.map(csvq).join(sep) + '\r\n'); for (const r of rows) o(r.map(v => v === null ? '' : csvq(fmt(v))).join(sep) + '\r\n'); return; }
      if (mode === 'quote') { if (headers) o(cols.map(c => "'" + c + "'").join(',') + '\n'); for (const r of rows) o(r.map(sqlq).join(',') + '\n'); return; }
      if (mode === 'html') { if (headers) o('<TR>' + cols.map(c => `<TH>${c}</TH>`).join('') + '\n</TR>\n'); for (const r of rows) o('<TR>' + r.map(v => `<TD>${fmt(v).replace(/&/g, '&amp;').replace(/</g, '&lt;')}</TD>`).join('') + '\n</TR>\n'); return; }
      if (['column', 'box', 'table', 'markdown'].includes(mode)) {
        const cells = rows.map(r => r.map(v => fmt(v).replace(/\n/g, ' ')));
        const w = cols.map((c, i) => Math.max(c.length, ...cells.map(r => (r[i] || '').length)));
        const num = cols.map((c, i) => rows.length && rows.every(r => r[i] === null || typeof r[i] === 'number' || typeof r[i] === 'bigint'));
        const pad = (s, i) => num[i] ? s.padStart(w[i]) : s.padEnd(w[i]);
        if (mode === 'column') { o(cols.map((c, i) => c.padEnd(w[i])).join('  ').trimEnd() + '\n' + w.map(n => '-'.repeat(n)).join('  ') + '\n'); for (const r of cells) o(r.map(pad).join('  ').trimEnd() + '\n'); return; }
        if (mode === 'markdown') { o('| ' + cols.map((c, i) => c.padEnd(w[i])).join(' | ') + ' |\n|' + w.map((n, i) => (num[i] ? '-'.repeat(n + 1) + ':' : ':' + '-'.repeat(n + 1))).join('|') + '|\n'); for (const r of cells) o('| ' + r.map(pad).join(' | ') + ' |\n'); return; }
        const [tl, tm, tr, ml, mm, mr, bl, bm, br, h, v] = mode === 'box' ? ['┌', '┬', '┐', '├', '┼', '┤', '└', '┴', '┘', '─', '│'] : ['+', '+', '+', '+', '+', '+', '+', '+', '+', '-', '|'];
        const line = (a, b, c) => a + w.map(n => h.repeat(n + 2)).join(b) + c + '\n';
        o(line(tl, tm, tr) + v + cols.map((c, i) => ' ' + c.padEnd(w[i]) + ' ').join(v) + v + '\n' + line(ml, mm, mr)); for (const r of cells) o(v + r.map((s, i) => ' ' + pad(s, i) + ' ').join(v) + v + '\n'); o(line(bl, bm, br)); return;
      }
      if (headers) o(cols.join(sep) + '\n'); for (const r of rows) o(r.map(fmt).join(mode === 'tabs' ? '\t' : sep) + '\n');
    };
    const runSql = (sql) => {
      try {
        db.each(sql, st => { if (readonly && !st.readonly) throw new SqliteError('attempt to write a readonly database', 8); const cols = st.columns(); const rows = st.rows(); show(cols, rows); if (changesOn && !st.readonly) o(`changes: ${db.changes()}   total_changes: ${db.totalChanges()}\n`); });
      } catch (x) { e(`${/syntax error|incomplete input|unrecognized token/.test(x.message) ? 'Parse error' : 'Runtime error'}: ${x.message}\n`); exit = 1; if (bail) stop = true; }
    };
    const tableList = (pat) => db.exec(`SELECT name FROM sqlite_schema WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ${pat ? 'AND name LIKE ?' : ''} ORDER BY 1`, pat ? [pat] : null)[0]?.values.map(r => r[0]) || [];
    const dot = (line) => {
      const args = (line.match(/"[^"]*"|'[^']*'|\S+/g) || []).map(s => s.replace(/^["']|["']$/g, '')); const c = args[0].slice(1);
      if (c === 'quit' || c === 'exit') { stop = true; return; }
      if (c === 'tables') { const t = tableList(args[1]); if (t.length) o(t.join('  ') + '\n'); return; }
      if (c === 'schema' || c === 'fullschema') { const r = db.exec(`SELECT sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ${args[1] ? 'AND (name LIKE ?1 OR tbl_name LIKE ?1)' : ''} ORDER BY tbl_name, type DESC, name`, args[1] ? [args[1]] : null)[0]; for (const [s] of r?.values || []) o(s + ';\n'); return; }
      if (c === 'indexes' || c === 'indices') { const r = db.exec(`SELECT name FROM sqlite_schema WHERE type='index' ${args[1] ? 'AND tbl_name LIKE ?' : ''} ORDER BY 1`, args[1] ? [args[1]] : null)[0]; if (r) o(r.values.map(x => x[0]).join('  ') + '\n'); return; }
      if (c === 'mode') { const m = args[1] || 'list'; if (!['list', 'csv', 'json', 'line', 'column', 'box', 'table', 'markdown', 'html', 'tabs', 'quote'].includes(m)) { e(`Error: mode should be one of: box column csv html json line list markdown quote table tabs\n`); exit = 1; return; } mode = m; if (m === 'csv') sep = ','; else if (m === 'tabs') sep = '\t'; else if (m === 'list') sep = '|'; if (['column', 'box', 'table', 'markdown'].includes(m)) headers = true; return; }
      if (c === 'headers' || c === 'header') { headers = /^(on|1|yes|true)$/i.test(args[1] || ''); return; }
      if (c === 'separator') { sep = (args[1] ?? '|').replace(/\\t/g, '\t').replace(/\\n/g, '\n'); return; }
      if (c === 'nullvalue') { nullv = args[1] ?? ''; return; }
      if (c === 'changes') { changesOn = /^(on|1|yes|true)$/i.test(args[1] || ''); return; }
      if (c === 'bail') { bail = /^(on|1|yes|true)$/i.test(args[1] || ''); return; }
      if (c === 'databases') { o(`main: ${dbPath && dbPath !== ':memory:' ? dbPath : '""'} r${readonly ? 'o' : 'w'}\n`); return; }
      if (c === 'print') { o(args.slice(1).join(' ') + '\n'); return; }
      if (c === 'read') { const t = readFile(args[1]); if (t == null) { e(`Error: cannot open "${args[1]}"\n`); exit = 1; return; } feed(t); return; }
      if (c === 'import') {
        const flags = args.filter(a => a.startsWith('--')); const rest = args.slice(1).filter(a => !a.startsWith('--')); const [file, table] = rest;
        const text = readFile(file); if (text == null) { e(`Error: cannot open "${file}"\n`); exit = 1; return; }
        const rows = parseCsv(text, mode === 'tabs' || flags.includes('--tabs') ? '\t' : ','); if (!rows.length) return;
        const skip = +(flags.find(f => f.startsWith('--skip'))?.split('=')[1] || 0);
        const exists = tableList(table).includes(table); let data = rows.slice(skip);
        try {
          if (!exists) { const hdr = data.shift(); db.exec(`CREATE TABLE "${table.replace(/"/g, '""')}"(${hdr.map(h => '"' + String(h).replace(/"/g, '""') + '" TEXT').join(', ')})`); db.dirty = true; }
          const ncol = db.exec(`SELECT count(*) FROM pragma_table_info(?)`, [table])[0].values[0][0];
          const st = db.prepare(`INSERT INTO "${table.replace(/"/g, '""')}" VALUES(${Array(ncol).fill('?').join(',')})`);
          try { db.exec('BEGIN'); for (const r of data) { const v = r.slice(0, ncol); while (v.length < ncol) v.push(null); st.bind(v); st.step(); } db.exec('COMMIT'); } finally { st.finalize(); }
          db.dirty = true;
        } catch (x) { try { db.exec('ROLLBACK'); } catch {} e(`Error: ${x.message}\n`); exit = 1; }
        return;
      }
      if (c === 'dump') {
        o('PRAGMA foreign_keys=OFF;\nBEGIN TRANSACTION;\n');
        const objs = db.exec(`SELECT type, name, sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ${args[1] ? 'AND tbl_name LIKE ?' : ''} ORDER BY type='table' DESC, rowid`, args[1] ? [args[1]] : null)[0]?.values || [];
        for (const [type, name, s] of objs) { if (type !== 'table') continue; o(s + ';\n'); for (const r of db.exec(`SELECT * FROM "${name.replace(/"/g, '""')}"`)[0]?.values || []) o(`INSERT INTO ${/^[A-Za-z_]\w*$/.test(name) ? name : '"' + name + '"'} VALUES(${r.map(sqlq).join(',')});\n`); }
        for (const [type, , s] of objs) if (type !== 'table') o(s + ';\n');
        o('COMMIT;\n'); return;
      }
      if (c === 'help') { o(HELP); return; }
      e(`Error: unknown command or invalid arguments: "${c}". Enter ".help" for help\n`); exit = 1;
    };
    let buf = '';
    function feed(text) {
      for (const line of String(text).split(/\r?\n/)) {
        if (stop) return;
        if (!buf.trim() && /^\s*\./.test(line)) { dot(line.trim()); continue; }
        buf += line + '\n';
        if (complete(buf)) { runSql(buf); buf = ''; }
      }
    }
    for (const c of cmds) { if (stop) break; /^\s*\./.test(c) ? dot(c.trim()) : runSql(c); }
    if (sqls.length) { for (const s of sqls) { if (stop) break; /^\s*\./.test(s) ? dot(s.trim()) : runSql(s); } }
    else if (stdin && stdin.trim()) { feed(stdin); if (buf.trim() && !stop) runSql(buf); }
    else if (!cmds.length) { e('sqlite3: no SQL given. Use: sqlite3 FILE "SQL" | sqlite3 FILE < script.sql | echo "SQL" | sqlite3 FILE\n'); db.close(); return { out, err, code: 1 }; }
    const res = { out, err, code: exit };
    if (db.dirty && dbPath && dbPath !== ':memory:' && !readonly) res.dbBytes = db.export();
    db.close(); return res;
  }
  function parseCsv(text, sep) {
    const rows = []; let row = [], f = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch; continue; }
      if (ch === '"' && f === '') { q = true; continue; }
      if (ch === sep) { row.push(f); f = ''; continue; }
      if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(f); f = ''; if (row.length > 1 || row[0] !== '') rows.push(row); row = []; continue; }
      f += ch;
    }
    if (f !== '' || row.length) { row.push(f); rows.push(row); }
    return rows;
  }
  const HELP = `SQLite ${version} shell (batch mode)
usage: sqlite3 [OPTIONS] [FILE] ["SQL" ...]      (SQL can also come from stdin or < file.sql)
options: -json -csv -column -box -table -markdown -line -list -html -tabs -quote
         -header -noheader -separator SEP -nullvalue TEXT -cmd CMD -bail -readonly -version
dot commands: .tables [pat]  .schema [table]  .indexes [table]  .mode MODE  .headers on|off
              .separator SEP  .nullvalue TEXT  .import FILE TABLE [--skip=N]  .read FILE
              .dump [table]  .changes on|off  .bail on|off  .databases  .print TEXT  .quit
`;
  return { Database, Statement, SqliteError, version, complete, cli, parseCsv };
}
