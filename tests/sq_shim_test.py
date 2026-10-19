# Run the Python sqlite3 shim in CPython against a fake _jvsqlite that follows the bridge's JSON contract.
import sys, json, base64, types, re
import sqlite3 as real
class FakeJ:
    def __init__(self): self.h = {}; self.n = 0
    def version(self): return real.sqlite_version
    def open(self, p): self.n += 1; self.h[self.n] = real.connect(p if p else ':memory:', isolation_level=None); return self.n
    def _dec(self, v):
        if isinstance(v, dict) and '$b' in v: return base64.b64decode(v['$b'])
        if isinstance(v, dict) and '$i' in v: return int(v['$i'])
        return v
    def _enc(self, v):
        if isinstance(v, bytes): return {'$b': base64.b64encode(v).decode()}
        if isinstance(v, int) and abs(v) > 2**53: return {'$i': str(v)}
        return v
    def execute(self, h, sql, pj):
        c = self.h[h]
        try:
            p = json.loads(pj) if pj else []
            p = {k: self._dec(v) for k, v in p.items()} if isinstance(p, dict) else [self._dec(v) for v in p]
            if not real.complete_statement(sql.rstrip().rstrip(';') + ';') or re.search(r';\s*\S', sql.strip().rstrip(';')): raise Exception('You can only execute one statement at a time.')
            cur = c.execute(sql, p); rows = cur.fetchall(); cols = [d[0] for d in cur.description] if cur.description else []
            return json.dumps({'cols': cols, 'rows': [[self._enc(v) for v in r] for r in rows], 'changes': c.execute('select changes()').fetchone()[0], 'lastrowid': cur.lastrowid, 'total': c.total_changes})
        except Exception as e: return json.dumps({'error': str(e)})
    def script(self, h, sql):
        try: self.h[h].executescript(sql); return '{}'
        except Exception as e: return json.dumps({'error': str(e)})
    def flush(self, h): return 0
    def close(self, h): self.h.pop(h).close(); return 0
mod = types.ModuleType('_jvsqlite'); fj = FakeJ()
for k in ('version', 'open', 'execute', 'script', 'flush', 'close'): setattr(mod, k, getattr(fj, k))
sys.modules['_jvsqlite'] = mod
src = open('vault/sqlite_main.js').read(); shim = src[src.index('const SQLITE_PY_SHIM = `') + len('const SQLITE_PY_SHIM = `'):src.rindex('`;')]
exec(shim)
import sqlite3
print('module:', type(sqlite3).__name__, sqlite3.sqlite_version, sqlite3.paramstyle)
con = sqlite3.connect(':memory:')
con.executescript('CREATE TABLE notes(id INTEGER PRIMARY KEY, title TEXT, words INT, raw BLOB);')
cur = con.cursor()
cur.executemany('INSERT INTO notes(title, words, raw) VALUES (?, ?, ?)', [('Inbox', 42, b'\x00\x01'), ('Welcome', 120, None), ('Graph View', 77, None)])
print('rowcount', cur.rowcount, 'lastrowid', cur.lastrowid)
print(con.execute('SELECT title, words FROM notes WHERE words > ? ORDER BY words DESC', (50,)).fetchall())
print(con.execute('SELECT raw FROM notes WHERE id=1').fetchone())
con.row_factory = sqlite3.Row
r = con.execute('SELECT id, title AS Name FROM notes WHERE title = :t', {'t': 'Inbox'}).fetchone()
print('Row:', r['name'], r[0], r.keys(), tuple(r))
print('description:', [d[0] for d in con.execute('SELECT * FROM notes').description])
print('iterate:', [row['title'] for row in con.execute('SELECT title FROM notes ORDER BY id')])
try: con.execute('INSERT INTO notes(id, title) VALUES (1, "dup")')
except sqlite3.IntegrityError as e: print('IntegrityError:', e)
try: con.execute('SELEC 1')
except sqlite3.OperationalError as e: print('OperationalError:', e)
try: con.execute('SELECT 1; SELECT 2')
except sqlite3.ProgrammingError as e: print('ProgrammingError:', e)
with con: con.execute("UPDATE notes SET words = words + 1")
print('total_changes', con.total_changes, 'fetchmany', con.execute('SELECT id FROM notes ORDER BY id').fetchmany(2) and 'ok')
con.close()
try: con.execute('SELECT 1')
except sqlite3.ProgrammingError as e: print('closed:', e)
