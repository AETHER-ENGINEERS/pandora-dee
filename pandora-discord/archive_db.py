"""The archive database: the Discord archive, indexed for search.

The archive (--archive) keeps every message as JSON lines, one file per channel. This module reads those files
into one SQLite database (archive/archive.db) with full-text search (FTS5), and keeps it up to date by reading
only what was appended since last time. Searching it costs no model tokens: a character asks one question and
gets back a handful of compact lines, instead of paging through channels.

Nothing is thrown away. Noise (join notices, "lol", emoji-only replies, bot commands) is flagged, and left out of
search unless asked for. Deleted messages are flagged too, and never returned.

Each channel knows whether everyone in the server can see it ("public"). A search in the "public" scope only
looks at those channels: what a character may bring up with anyone. The "all" scope (the keyholder) sees every
channel the archive kept, including DMs when they are archived.

Standard library only. Used by the Discord bridge, and on its own:
    python3 archive_db.py ARCHIVE_DIR "search words"
"""
import json
import pathlib
import re
import sqlite3
import sys
import threading
import time

SCHEMA = """
CREATE TABLE IF NOT EXISTS sources(path TEXT PRIMARY KEY, pos INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS channels(id TEXT PRIMARY KEY, guild_id TEXT, guild TEXT, name TEXT, topic TEXT,
    parent_id TEXT, parent_name TEXT, thread INTEGER DEFAULT 0, public INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY, guild_id TEXT, channel_id TEXT, author_id TEXT, author TEXT,
    bot INTEGER DEFAULT 0, created TEXT, edited TEXT, text TEXT, reply_to INTEGER, files TEXT, noise INTEGER DEFAULT 0,
    deleted INTEGER DEFAULT 0);
CREATE INDEX IF NOT EXISTS m_chan ON messages(channel_id, id);
CREATE INDEX IF NOT EXISTS m_author ON messages(author_id);
CREATE VIRTUAL TABLE IF NOT EXISTS fts USING fts5(text, author, tokenize='porter unicode61 remove_diacritics 2');
"""
CHAT_TYPES = {'default', 'reply', 'thread_starter_message', 'chat_input_command', 'context_menu_command', ''}
FILLER = re.compile(r'(lol+|lmf?ao+|rofl|ok(ay)?|k+|ty|thx|thanks?|ya?e?s+|no+|yep|yup|nope|ha(ha)+|he(he)+|heh|xd+|gm|gn|ikr|same|nice|wow|omg|rip|f)[\s!.?~]*', re.I)
EMOJI_ONLY = re.compile(r'(<a?:\w+:\d+>|[\W_])+', re.U)


def message_text(rec):
    """What a message says: its text, plus what an embed (often how bots and webhooks post) says."""
    t = (rec.get('text') or rec.get('content') or '').strip()
    for e in rec.get('embeds') or []:
        bits = [e.get('title') or '', e.get('description') or '']
        bits += [f"{f.get('name', '')}: {f.get('value', '')}" for f in e.get('fields') or []]
        extra = '\n'.join(b for b in bits if b).strip()
        if extra and extra not in t:
            t = (t + '\n' + extra).strip()
    return t


def is_noise(rec, text):
    """Flagged, never deleted: system notices, filler, emoji-only replies and bot commands."""
    if (rec.get('type') or 'default') not in CHAT_TYPES:
        return 1  # joins, pins, boosts, thread renames...
    if not text:
        return 0 if rec.get('attachments') or rec.get('stickers') else 1
    if EMOJI_ONLY.fullmatch(text) or FILLER.fullmatch(text):
        return 1
    if len(text) < 40 and re.match(r'^[!?.$/;][a-z]\w*', text, re.I) and not rec.get('author', {}).get('bot'):
        return 1  # !roll, ?help, /command typed as text
    return 0


class ArchiveDB:
    def __init__(self, archive_dir, db_path=None):
        self.root = pathlib.Path(archive_dir)
        self.path = pathlib.Path(db_path) if db_path else self.root / 'archive.db'
        self.lock = threading.Lock()
        self.indexing = {'running': False, 'done_at': 0, 'added': 0}
        c = self._conn()
        try:
            c.executescript(SCHEMA)
        finally:
            c.close()

    def _conn(self):
        c = sqlite3.connect(self.path, timeout=30)
        c.execute('PRAGMA journal_mode=WAL')
        c.execute('PRAGMA synchronous=NORMAL')
        c.row_factory = sqlite3.Row
        return c

    # ---------- keeping up with the archive ----------
    def sync(self, wait=True):
        """Read whatever the archive gained since last time. wait: True, False (skip if another sync is running),
        or seconds to wait for one (a long first indexing run should not hold up a search)."""
        got = self.lock.acquire(timeout=wait) if isinstance(wait, (int, float)) and not isinstance(wait, bool) else self.lock.acquire(blocking=wait)
        if not got:
            return 0
        try:
            self.indexing['running'] = True
            n = self._sync()
            self.indexing.update(done_at=time.time(), added=self.indexing.get('added', 0) + n)
            return n
        finally:
            self.indexing['running'] = False
            self.lock.release()

    def _sync(self):
        if not self.root.exists():
            return 0
        added = 0
        c = self._conn()
        try:
            for d in sorted(p for p in self.root.iterdir() if p.is_dir() and p.name != 'files'):
                self._channels(c, d)
                for f in sorted(d.glob('*.jsonl')):
                    added += self._file(c, d.name, f)
            c.commit()
        finally:
            c.close()
        return added

    def _channels(self, c, d):
        p = d / 'channels.json'
        if d.name == 'dm' or not p.exists():
            return
        try:
            data = json.loads(p.read_text(encoding='utf-8'))
        except Exception:
            return
        g = data.get('guild') or {}
        for ch in (data.get('channels') or {}).values():
            c.execute('INSERT INTO channels(id, guild_id, guild, name, topic, parent_id, parent_name, thread, public) VALUES (?,?,?,?,?,?,?,?,?) '
                      'ON CONFLICT(id) DO UPDATE SET guild_id=excluded.guild_id, guild=excluded.guild, name=excluded.name, topic=excluded.topic, '
                      'parent_id=excluded.parent_id, parent_name=excluded.parent_name, thread=excluded.thread, public=excluded.public',
                      (ch.get('id'), g.get('id', d.name), g.get('name', ''), ch.get('name', ''), ch.get('topic', ''), ch.get('parent_id', ''),
                       ch.get('parent_name', ''), int(bool(ch.get('thread'))), int(ch.get('public') is True)))

    def _file(self, c, scope, f):
        key = str(f.relative_to(self.root))
        row = c.execute('SELECT pos FROM sources WHERE path=?', (key,)).fetchone()
        pos = row['pos'] if row else 0
        size = f.stat().st_size
        if size < pos:
            pos = 0  # the file was replaced: read it again (every write is an upsert)
        if size == pos:
            return 0
        n = 0
        with open(f, 'rb') as fh:
            fh.seek(pos)
            for raw in fh:
                if not raw.endswith(b'\n'):
                    break  # a line still being written: next time
                pos += len(raw)
                try:
                    e = json.loads(raw)
                except Exception:
                    continue
                n += self._event(c, scope, f.stem, e)
        c.execute('INSERT INTO sources(path, pos) VALUES (?,?) ON CONFLICT(path) DO UPDATE SET pos=excluded.pos', (key, pos))
        return n

    def _event(self, c, scope, channel_id, e):
        mid = e.get('id')
        if not mid or not str(mid).isdigit():
            return 0
        mid = int(mid)
        if e.get('ev') == 'delete':
            c.execute('UPDATE messages SET deleted=1 WHERE id=?', (mid,))
            return 0
        old = c.execute('SELECT * FROM messages WHERE id=?', (mid,)).fetchone()
        a = e.get('author') or {}
        text = message_text(e)
        files = ', '.join(x.get('filename', '') for x in e.get('attachments') or [] if x.get('filename'))
        if old and e.get('ev') == 'edit':
            files = files or old['files']
        reply = (e.get('reply_to') or {}).get('message_id')
        ch = e.get('channel_id') or channel_id
        if scope == 'dm' and not c.execute('SELECT 1 FROM channels WHERE id=?', (ch,)).fetchone():
            c.execute('INSERT INTO channels(id, guild_id, guild, name, public) VALUES (?,?,?,?,0)', (ch, '', 'DMs', f"DM with {a.get('name', '?')}"))
        vals = (str(e.get('guild_id') or ''), str(ch), str(a.get('id', '')), a.get('name') or a.get('username') or '?', int(bool(a.get('bot'))),
                e.get('created') or (old['created'] if old else ''), e.get('edited') or '', text, int(reply) if reply and str(reply).isdigit() else None,
                files, is_noise(e, text))
        if old:
            c.execute('DELETE FROM fts WHERE rowid=?', (mid,))
            c.execute('UPDATE messages SET guild_id=?, channel_id=?, author_id=?, author=?, bot=?, created=?, edited=?, text=?, reply_to=?, files=?, noise=? WHERE id=?',
                      (*vals, mid))
        else:
            c.execute('INSERT INTO messages(guild_id, channel_id, author_id, author, bot, created, edited, text, reply_to, files, noise, id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
                      (*vals, mid))
        c.execute('INSERT INTO fts(rowid, text, author) VALUES (?,?,?)', (mid, text + (f'\n[files: {files}]' if files else ''), vals[3]))
        return 0 if old else 1

    # ---------- reading ----------
    @staticmethod
    def _where(scope, include_noise, alias='m'):
        w = [f'{alias}.deleted=0']
        if not include_noise:
            w.append(f'{alias}.noise=0')
        if scope != 'all':
            w.append('c.public=1')
        return w

    @staticmethod
    def _channel_filter(channel, w, args):
        if channel:
            ch = str(channel).strip().lstrip('#').lower()
            m = re.search(r'\d{15,}', ch)
            if m:
                w.append('(c.id=? OR c.parent_id=?)')
                args += [m.group(0), m.group(0)]
            else:
                w.append('(lower(c.name)=? OR lower(c.parent_name)=?)')
                args += [ch, ch]

    @staticmethod
    def _filters(w, args, author=None, since=None, until=None):
        if author:
            a = str(author).strip().lstrip('@')
            if a.isdigit():
                w.append('m.author_id=?')
                args.append(a)
            else:
                w.append('lower(m.author) LIKE ?')
                args.append(f'%{a.lower()}%')
        if since:
            w.append('m.created>=?')
            args.append(str(since))
        if until:
            w.append('m.created<?')
            args.append(str(until) + ('T99' if len(str(until)) <= 10 else ''))

    def line(self, r, text=None):
        where = f"#{r['parent_name']} › {r['cname']}" if r['thread'] and r['parent_name'] else (f"#{r['cname']}" if r['cname'] else 'unknown channel')
        t = (text if text is not None else r['text']) or ''
        t = re.sub(r'\s+', ' ', t).strip()
        if len(t) > 400:
            t = t[:399] + '…'
        extra = f" [files: {r['files']}]" if r['files'] and '[files:' not in t else ''
        rep = f" ↩{r['reply_to']}" if r['reply_to'] else ''
        return f"[{r['id']}] {(r['created'] or '')[:16].replace('T', ' ')} {where} {r['author']}{' (bot)' if r['bot'] else ''}{rep}: {t}{extra}"

    COLS = 'm.*, c.name AS cname, c.parent_name, c.thread, c.public'

    def search(self, query, scope='public', channel=None, author=None, since=None, until=None, limit=15, include_noise=False):
        q = str(query or '').strip()
        if not q:
            raise ValueError('query is empty')
        limit = max(1, min(int(limit or 15), 50))
        w = ['fts MATCH ?'] + self._where(scope, include_noise)
        args = [q]
        self._channel_filter(channel, w, args)
        self._filters(w, args, author, since, until)
        sql = (f"SELECT {self.COLS}, snippet(fts, 0, '«', '»', '…', 40) AS snip FROM fts JOIN messages m ON m.id=fts.rowid "
               f"LEFT JOIN channels c ON c.id=m.channel_id WHERE {' AND '.join(w)} ORDER BY bm25(fts, 1.0, 0.4) LIMIT ?")
        c = self._conn()
        try:
            try:
                rows = c.execute(sql, args + [limit]).fetchall()
            except sqlite3.OperationalError:  # not valid FTS syntax: search the words themselves
                words = re.findall(r'\w+', q, re.U)
                if not words:
                    return []
                args[0] = ' '.join(f'"{x}"' for x in words)
                rows = c.execute(sql, args + [limit]).fetchall()
        finally:
            c.close()
        return [self.line(r, r['snip']) for r in rows]

    def _get(self, c, mid, scope):
        r = c.execute(f'SELECT {self.COLS} FROM messages m LEFT JOIN channels c ON c.id=m.channel_id WHERE m.id=?', (int(mid),)).fetchone()
        if not r or r['deleted'] or (scope != 'all' and not r['public']):
            raise ValueError(f'no message {mid} in the archive' + ('' if scope == 'all' else ' that you can see here'))
        return r

    def context(self, message_id, scope='public', before=6, after=6):
        """The conversation around one message, noise included (it is part of the flow)."""
        before, after = max(0, min(int(before), 40)), max(0, min(int(after), 40))
        c = self._conn()
        try:
            r = self._get(c, re.sub(r'\D', '', str(message_id)) or 0, scope)
            q = f'SELECT {self.COLS} FROM messages m LEFT JOIN channels c ON c.id=m.channel_id WHERE m.channel_id=? AND m.deleted=0 AND m.id{{}}? ORDER BY m.id {{}} LIMIT ?'
            prev = c.execute(q.format('<', 'DESC'), (r['channel_id'], r['id'], before)).fetchall()[::-1]
            nxt = c.execute(q.format('>', 'ASC'), (r['channel_id'], r['id'], after)).fetchall()
        finally:
            c.close()
        return [self.line(x) for x in prev] + ['→ ' + self.line(r)] + [self.line(x) for x in nxt]

    def timeline(self, channel, scope='public', since=None, until=None, author=None, limit=30, include_noise=False):
        """A channel's messages in order: from `since` onwards, or the latest ones."""
        if not channel:
            raise ValueError('say which channel')
        limit = max(1, min(int(limit or 30), 100))
        w = self._where(scope, include_noise)
        args = []
        self._channel_filter(channel, w, args)
        self._filters(w, args, author, since, until)
        order = 'ASC' if since else 'DESC'
        c = self._conn()
        try:
            rows = c.execute(f"SELECT {self.COLS} FROM messages m LEFT JOIN channels c ON c.id=m.channel_id WHERE {' AND '.join(w)} ORDER BY m.id {order} LIMIT ?",
                             args + [limit]).fetchall()
        finally:
            c.close()
        return [self.line(r) for r in (rows if since else rows[::-1])]

    def channels(self, scope='public'):
        c = self._conn()
        try:
            rows = c.execute(f"SELECT c.*, count(m.id) AS n, min(m.created) AS first, max(m.created) AS last FROM channels c "
                             f"JOIN messages m ON m.channel_id=c.id AND m.deleted=0 {'' if scope == 'all' else 'WHERE c.public=1'} "
                             f"GROUP BY c.id ORDER BY c.guild, c.thread, c.parent_name, c.name").fetchall()
        finally:
            c.close()
        out = []
        for r in rows:
            name = f"#{r['parent_name']} › {r['name']}" if r['thread'] and r['parent_name'] else f"#{r['name']}"
            out.append(f"{name} ({r['id']}): {r['n']} messages, {(r['first'] or '')[:10]} to {(r['last'] or '')[:10]}"
                       f"{'' if r['public'] else ' (private)'}{' — ' + r['topic'][:120] if r['topic'] else ''}")
        return out

    def status(self):
        c = self._conn()
        try:
            s = c.execute('SELECT count(*) AS n, sum(noise) AS noise, sum(deleted) AS deleted, min(created) AS first, max(created) AS last FROM messages').fetchone()
            ch = c.execute('SELECT count(*) AS n, sum(public) AS pub FROM channels').fetchone()
        finally:
            c.close()
        return {'db': str(self.path), 'bytes': self.path.stat().st_size if self.path.exists() else 0, 'messages': s['n'], 'noise': s['noise'] or 0,
                'deleted': s['deleted'] or 0, 'first': s['first'], 'last': s['last'], 'channels': ch['n'], 'public_channels': ch['pub'] or 0,
                'indexing': dict(self.indexing)}


def main():
    if len(sys.argv) < 2:
        sys.exit('usage: archive_db.py ARCHIVE_DIR [search words]')
    db = ArchiveDB(sys.argv[1])
    t = time.time()
    n = db.sync()
    print(f'indexed {n} new message(s) in {time.time() - t:.1f}s', file=sys.stderr)
    if len(sys.argv) > 2:
        print('\n'.join(db.search(' '.join(sys.argv[2:]), scope='all')) or 'no matches')
    else:
        print(json.dumps(db.status(), indent=1))


if __name__ == '__main__':
    main()
