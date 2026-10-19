#!/usr/bin/env python3
"""Jade Discord bridge: runs a Discord bot with discord.py and serves it over HTTP as an MCP server, with a bearer
token, so Jade Vault (phone or browser) can be that bot. Runs next to the Jade Vector bridge (own port, own token).

    python3 jade_discord_bridge.py [--port 8788] [--host 0.0.0.0]

First run creates ~/.jade-discord/ with:
    token       the password Jade Vault sends (Config -> Discord -> Bridge token)
    bot_token   your Discord bot's token (made by:  python3 jade_discord_bridge.py --set-token)

Needs:  pip install discord.py        (Python 3.9+; on 3.13 pip also installs audioop-lts)
The bridge itself uses only the standard library besides discord.py.

What it does: keeps the bot online (discord.py handles the Gateway, resume and reconnects), queues the messages the
bot may care about (DMs, and messages in servers; never bots), and exposes tools to send, reply, react, edit, delete, read
history, send and download files, list servers/channels, look people up, and moderate. It never pings @everyone, @here or
roles. Jade Vault decides who gets an answer.
"""
import argparse, asyncio, base64, collections, getpass, hmac, http.server, io, json, os, pathlib, secrets, signal, socketserver, ssl, sys, threading, time

HOME = pathlib.Path(os.environ.get('JADE_DISCORD_HOME', pathlib.Path.home() / '.jade-discord'))
MAX_BODY = 48 * 1024 * 1024
PROTOCOL = '2025-06-18'
MAX_FILE = 25 * 1024 * 1024


def log(*a):
    print(time.strftime('%H:%M:%S'), *a, file=sys.stderr, flush=True)


def read_secret(path, make):
    if path.exists():
        return path.read_text().strip()
    v = make()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(v + '\n')
    os.chmod(path, 0o600)
    return v


def chunks(text, limit=1900):
    """A message of any length, split at line breaks (then spaces) under Discord's 2000-character limit."""
    out = []
    t = (text or '').strip()
    while len(t) > limit:
        i = t.rfind('\n', 0, limit)
        if i < limit // 2:
            i = t.rfind(' ', 0, limit)
        if i < limit // 2:
            i = limit
        out.append(t[:i].strip())
        t = t[i:].strip()
    if t:
        out.append(t)
    return out


# ---------- the archive (optional: --archive) ----------
# Every message the bot can see, kept on this computer as append-only JSON lines, one file per channel or thread:
#   <archive>/<guild_id>/<channel_id>.jsonl     {"ev": "create" | "edit" | "delete", ...}
#   <archive>/<guild_id>/channels.json          names, types, topics and parents of the channels seen
#   <archive>/<guild_id>/files/<msg>-<n>-<name> attachments, downloaded when seen (Discord's links expire)
#   <archive>/dm/...                            DMs, only with --archive-dms
#   <archive>/state.json                        how far the backfill got in each channel
# Unlike the reply queue, the archive keeps everything: bots, webhooks, the bot's own messages, edits and deletions.
# It never decides what matters; it is the floor that later passes (distillation, search) dig in.
def iso(dt):
    return dt.isoformat() if dt else None


def local(stamp):
    """An archived ISO time in this computer's time zone, as 'YYYY-MM-DD HH:MM'."""
    import datetime
    try:
        return datetime.datetime.fromisoformat(stamp).astimezone().strftime('%Y-%m-%d %H:%M')
    except Exception:
        return (stamp or '0000-00-00 00:00')[:16].replace('T', ' ')


def safe_name(s, limit=80):
    s = ''.join('_' if c in '/\\:*?"<>|\0' or ord(c) < 32 else c for c in str(s or '')).strip().lstrip('.')
    return (s or '_')[:limit]


def msg_record(m):
    """A Discord message as a plain dict: everything worth keeping, nothing that needs discord.py to read back."""
    ref = None
    if m.reference and m.reference.message_id:
        ref = {'message_id': str(m.reference.message_id), 'channel_id': str(m.reference.channel_id or m.channel.id),
               'guild_id': str(getattr(m.reference, 'guild_id', None) or '')}
    a = m.author
    rec = {
        'id': str(m.id), 'channel_id': str(m.channel.id), 'guild_id': str(m.guild.id) if m.guild else '',
        'author': {'id': str(a.id), 'name': getattr(a, 'display_name', None) or a.name, 'username': a.name, 'bot': bool(a.bot)},
        'created': iso(m.created_at), 'edited': iso(m.edited_at),
        'type': getattr(m.type, 'name', str(m.type)), 'content': m.content, 'text': m.clean_content,
        'reply_to': ref, 'pinned': bool(m.pinned),
        'attachments': [{'id': str(x.id), 'filename': x.filename, 'size': x.size, 'content_type': x.content_type or '', 'url': x.url} for x in m.attachments],
        'embeds': [e.to_dict() for e in m.embeds],
        'stickers': [s.name for s in getattr(m, 'stickers', [])],
        'reactions': [{'emoji': str(r.emoji), 'count': r.count} for r in m.reactions],
        'mentions': [str(u.id) for u in m.mentions],
    }
    if m.webhook_id:
        rec['webhook_id'] = str(m.webhook_id)
    th = getattr(m, 'thread', None)
    if th:
        rec['thread_id'] = str(th.id)
    return rec


def channel_meta(ch):
    parent = getattr(ch, 'parent', None)
    return {'id': str(ch.id), 'name': getattr(ch, 'name', '') or '', 'type': getattr(getattr(ch, 'type', None), 'name', ''),
            'topic': getattr(ch, 'topic', None) or '', 'parent_id': str(getattr(ch, 'parent_id', '') or ''),
            'parent_name': getattr(parent, 'name', '') or '', 'thread': getattr(getattr(ch, 'type', None), 'name', '').endswith('thread')}


class Archive:
    def __init__(self, root, dms=False, files_mb=25):
        self.root = pathlib.Path(root)
        self.dms = dms
        self.max_file = int(files_mb * 1048576)
        self.lock = threading.Lock()
        self.counts = collections.Counter()
        self.progress = {'running': False}
        self.known = {}  # channel id -> the metadata last written, so channels.json is only touched when something changes
        self.root.mkdir(parents=True, exist_ok=True)
        try:
            os.chmod(self.root, 0o700)
        except OSError:
            pass

    def scope(self, guild_id):
        return str(guild_id) if guild_id else 'dm'

    def keeps(self, guild_id):
        return bool(guild_id) or self.dms

    def _append(self, scope, channel_id, obj):
        p = self.root / scope / f'{channel_id}.jsonl'
        line = json.dumps(obj, ensure_ascii=False) + '\n'
        with self.lock:
            p.parent.mkdir(parents=True, exist_ok=True)
            with open(p, 'a', encoding='utf-8') as f:
                f.write(line)
            self.counts[obj['ev']] += 1

    def note_channel(self, ch):
        g = getattr(ch, 'guild', None)
        if not g:
            return
        meta = channel_meta(ch)
        if self.known.get(meta['id']) == (g.name, meta):
            return
        p = self.root / str(g.id) / 'channels.json'
        with self.lock:
            self.known[meta['id']] = (g.name, meta)
            p.parent.mkdir(parents=True, exist_ok=True)
            try:
                data = json.loads(p.read_text(encoding='utf-8'))
            except Exception:
                data = {'guild': {}, 'channels': {}}
            changed = data['guild'].get('name') != g.name
            data['guild'] = {'id': str(g.id), 'name': g.name}
            if changed or data['channels'].get(meta['id']) != meta:
                data['channels'][meta['id']] = meta
                tmp = p.with_suffix('.tmp')
                tmp.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding='utf-8')
                os.replace(tmp, p)

    async def record(self, ev, m, src='live'):
        """Keep a message (ev 'create' or 'edit'), downloading its attachments. Never raises."""
        try:
            gid = m.guild.id if m.guild else None
            if not self.keeps(gid):
                return
            scope = self.scope(gid)
            if gid:
                self.note_channel(m.channel)
            rec = msg_record(m)
            if ev == 'create' and self.max_file > 0:
                for i, att in enumerate(m.attachments):
                    rec['attachments'][i]['file'] = await self._save(scope, m, i, att)
            self._append(scope, rec['channel_id'], {'ev': ev, 'src': src, 'seen': time.time(), **rec})
        except Exception as e:
            log(f'archive: could not keep message {getattr(m, "id", "?")}: {type(e).__name__}: {e}')

    async def _save(self, scope, m, i, att):
        rel = f'{scope}/files/{m.id}-{i}-{safe_name(att.filename)}'
        p = self.root / rel
        if p.exists():
            return rel
        if att.size > self.max_file:
            return None
        try:
            data = await att.read()
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_bytes(data)
            return rel
        except Exception as e:
            log(f'archive: attachment {att.filename} of {m.id} not saved: {type(e).__name__}: {e}')
            return None

    def deleted(self, message_id, channel_id, guild_id):
        if self.keeps(guild_id):
            self._append(self.scope(guild_id), str(channel_id), {'ev': 'delete', 'id': str(message_id), 'channel_id': str(channel_id),
                                                                  'guild_id': str(guild_id or ''), 'seen': time.time()})

    # --- backfill: the whole history of every channel and thread the bot can read
    def _state(self):
        try:
            return json.loads((self.root / 'state.json').read_text(encoding='utf-8'))
        except Exception:
            return {}

    def _save_state(self, st):
        with self.lock:
            tmp = self.root / 'state.tmp'
            tmp.write_text(json.dumps(st, indent=1), encoding='utf-8')
            os.replace(tmp, self.root / 'state.json')

    async def backfill(self, client, discord, guild_ids=None):
        if self.progress.get('running'):
            raise RuntimeError('a backfill is already running')
        P = self.progress = {'running': True, 'started': time.time(), 'channels_done': 0, 'messages': 0, 'skipped': [], 'channel': ''}
        st = self._state()
        try:
            for g in list(client.guilds):
                if guild_ids and str(g.id) not in guild_ids:
                    continue
                P['guild'] = g.name
                targets = [c for c in g.channels if isinstance(c, discord.abc.Messageable)]
                containers = [c for c in g.channels if isinstance(c, (discord.TextChannel, discord.ForumChannel))]
                seen = {c.id for c in targets}
                try:
                    threads = list(await g.active_threads())
                except Exception as e:
                    threads = []
                    P['skipped'].append(f'active threads of {g.name}: {type(e).__name__}')
                for c in containers:
                    for private in (False, True):
                        if private and isinstance(c, discord.ForumChannel):
                            continue
                        try:  # forum channels take no `private` argument (their posts are always public threads)
                            it = c.archived_threads(limit=None) if isinstance(c, discord.ForumChannel) else c.archived_threads(limit=None, private=private)
                            async for t in it:
                                threads.append(t)
                        except discord.Forbidden:
                            if not private:
                                P['skipped'].append(f'archived threads of #{c.name}: no access')
                        except Exception as e:
                            P['skipped'].append(f'archived threads of #{c.name}: {type(e).__name__}')
                for t in threads:
                    if t.id not in seen:
                        seen.add(t.id)
                        targets.append(t)
                for c in targets:
                    await self._backfill_channel(c, st, P, discord)
            P['finished'] = time.time()
        finally:
            P['running'] = False
            P['channel'] = ''
            self._save_state(st)
        return P

    async def _backfill_channel(self, c, st, P, discord):
        P['channel'] = getattr(c, 'name', str(c.id))
        self.note_channel(c)
        key = str(c.id)
        after = st.get(key)
        n = 0
        try:
            async for m in c.history(limit=None, after=discord.Object(id=int(after)) if after else None, oldest_first=True):
                await self.record('create', m, src='backfill')
                st[key] = str(m.id)
                n += 1
                P['messages'] += 1
                if n % 250 == 0:
                    self._save_state(st)
        except discord.Forbidden:
            P['skipped'].append(f'#{P["channel"]}: no access (Read Message History)')
        except Exception as e:
            P['skipped'].append(f'#{P["channel"]}: {type(e).__name__}: {e}')
        P['channels_done'] += 1
        self._save_state(st)

    # --- reading back
    def iter_messages(self, scope=None):
        """Every kept message, folded: edits applied, deletions removed. Yields (scope, record)."""
        for d in sorted(p for p in self.root.iterdir() if p.is_dir()):
            if scope and d.name != scope:
                continue
            for f in sorted(d.glob('*.jsonl')):
                yield from ((d.name, r) for r in fold(f))

    def search(self, query, limit=20, chat_id=None):
        q = str(query or '').lower()
        if not q:
            raise ValueError('query is empty')
        hits = []
        for scope, r in self.iter_messages():
            if chat_id and r['channel_id'] != str(chat_id):
                continue
            if q in (r.get('text') or r.get('content') or '').lower() or q in r['author']['name'].lower():
                hits.append(r)
        hits.sort(key=lambda r: r.get('created') or '')
        return [{'id': r['id'], 'chat_id': r['channel_id'], 'guild_id': r['guild_id'], 'author': r['author']['name'], 'created': r['created'],
                 'text': (r.get('text') or '')[:500], 'reply_to': (r.get('reply_to') or {}).get('message_id', '')} for r in hits[-limit:]]

    def status(self):
        size = files = 0
        for p in self.root.rglob('*'):
            if p.is_file():
                size += p.stat().st_size
                files += 1
        return {'dir': str(self.root), 'dms': self.dms, 'files_mb': self.max_file // 1048576, 'bytes': size, 'files': files,
                'this_run': dict(self.counts), 'backfill': self.progress}


def fold(path):
    """Read one channel's JSON lines: the last version of each message, deleted ones left out, oldest first."""
    msgs, gone = {}, set()
    with open(path, encoding='utf-8') as f:
        for line in f:
            try:
                e = json.loads(line)
            except Exception:
                continue
            mid = e.get('id')
            if e.get('ev') == 'delete':
                gone.add(mid)
            elif mid in msgs:
                old = msgs[mid]
                for i, a in enumerate(e.get('attachments') or []):  # an edit carries no saved files: keep the earlier ones
                    if i < len(old.get('attachments') or []) and not a.get('file'):
                        a['file'] = old['attachments'][i].get('file')
                msgs[mid] = {**old, **{k: v for k, v in e.items() if k not in ('ev', 'src', 'seen')}}
            else:
                msgs[mid] = e
    return sorted((m for k, m in msgs.items() if k not in gone), key=lambda m: int(m['id']))


# ---------- rendering the archive as an Obsidian-style vault (--render) ----------
def render(archive_dir, out_dir, name='Discord Archive', description='', with_files=True):
    """Markdown notes from the archive: <name>/<server>/<channel>/<YYYY-MM>.md, threads in <channel>/threads/,
    replies as links to the message they answer (^m<id> block ids), attachments copied to <name>/_files/."""
    import shutil
    root, out = pathlib.Path(archive_dir), pathlib.Path(out_dir) / safe_name(name)
    out.mkdir(parents=True, exist_ok=True)
    notes, where, index = {}, {}, []
    for d in sorted(p for p in root.iterdir() if p.is_dir()):
        try:
            meta = json.loads((d / 'channels.json').read_text(encoding='utf-8'))
        except Exception:
            meta = {'guild': {'name': 'Direct messages' if d.name == 'dm' else d.name}, 'channels': {}}
        gname = safe_name(meta['guild'].get('name') or d.name)
        chans = meta['channels']
        for f in sorted(d.glob('*.jsonl')):
            cid = f.stem
            c = chans.get(cid) or {'name': cid, 'thread': False}
            cname = safe_name(c.get('name') or cid)
            for m in fold(f):
                if c.get('thread'):
                    parent = safe_name(c.get('parent_name') or (chans.get(c.get('parent_id')) or {}).get('name') or 'threads')
                    rel = f'{gname}/{parent}/threads/{cname} ({cid})'
                else:
                    rel = f'{gname}/{cname}/{local(m.get("created"))[:7]}'
                notes.setdefault(rel, {'channel': c, 'guild': meta['guild'].get('name') or d.name, 'msgs': []})['msgs'].append((d.name, m))
                where[m['id']] = rel
    for rel, n in notes.items():
        c = n['channel']
        lines = ['---', f'server: {json.dumps(n["guild"], ensure_ascii=False)}', f'channel: {json.dumps(c.get("name") or "", ensure_ascii=False)}',
                 f'channel_id: "{c.get("id") or ""}"', f'thread: {"true" if c.get("thread") else "false"}']
        if c.get('topic'):
            lines.append(f'topic: {json.dumps(c["topic"], ensure_ascii=False)}')
        lines += [f'messages: {len(n["msgs"])}', '---', '']
        for scope, m in n['msgs']:
            block = []
            who = m['author']['name'] + (' (bot)' if m['author'].get('bot') else '')
            block.append(f'**{who}** · {local(m.get("created"))}{" · edited" if m.get("edited") else ""}')
            rt = (m.get('reply_to') or {}).get('message_id')
            if rt:
                block.append(f'↪ [[{where[rt]}#^m{rt}|reply]]' if rt in where else '↪ reply to a message not in the archive')
            body = (m.get('text') or m.get('content') or '').strip()
            if body:
                block.append(body)
            for a in m.get('attachments') or []:
                if with_files and a.get('file') and (root / a['file']).exists():
                    dest = out / '_files' / a['file']
                    if not dest.exists():
                        dest.parent.mkdir(parents=True, exist_ok=True)
                        try:
                            os.link(root / a['file'], dest)
                        except OSError:
                            shutil.copy2(root / a['file'], dest)
                    img = (a.get('content_type') or '').startswith('image/')
                    block.append(f'{"!" if img else ""}[[{dest.name}]]')
                else:
                    block.append(f'📎 {a.get("filename")} (not downloaded)')
            for e in m.get('embeds') or []:
                if e.get('url') or e.get('title'):
                    block.append(f'> {e.get("title") or ""} {e.get("url") or ""}'.rstrip())
            if m.get('reactions'):
                block.append(' '.join(f'{r["emoji"]} {r["count"]}' for r in m['reactions']))
            block[-1] += f' ^m{m["id"]}'  # Obsidian block id: the end of the message's paragraph, so replies can link here
            lines += block + ['']
        p = out / (rel + '.md')
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text('\n'.join(lines), encoding='utf-8')
        index.append((rel, len(n['msgs'])))
    head = ['---', f'name: {json.dumps(name, ensure_ascii=False)}']
    if description:
        head.append(f'description: {json.dumps(description, ensure_ascii=False)}')
    head += [f'rendered: {time.strftime("%Y-%m-%d %H:%M")}', f'messages: {sum(c for _, c in index)}', '---', '', f'# {name}', '']
    if description:
        head += [description, '']
    head += [f'- [[{rel}]] ({cnt})' for rel, cnt in sorted(index)]
    (out / f'{safe_name(name)}.md').write_text('\n'.join(head) + '\n', encoding='utf-8')
    return {'notes': len(index), 'messages': sum(c for _, c in index), 'dir': str(out)}


# ---------- the bot (discord.py) ----------
class Bridge:
    def __init__(self, bot_token, max_age=600, queue_max=500, archive=None):
        import discord  # imported here so --help and --set-token work without it
        self.discord = discord
        self.archive = archive
        self.token = bot_token
        self.max_age = max_age
        self.queue = collections.deque(maxlen=queue_max)
        self.lock = threading.Lock()
        self.ready = threading.Event()
        self.loop = asyncio.new_event_loop()
        self.client = None
        self.content_intent = True
        self.warn = ''
        self.error = ''
        self.stopping = False
        self.user = None

    # --- lifecycle
    def start(self):
        threading.Thread(target=self._thread, daemon=True).start()

    def _thread(self):
        asyncio.set_event_loop(self.loop)
        self.loop.run_until_complete(self._main())

    def _make_client(self):
        discord = self.discord
        bridge = self
        intents = discord.Intents.default()          # guilds, guild messages, DMs, reactions, typing...
        intents.message_content = self.content_intent  # privileged: switch it on under Bot -> Privileged Gateway Intents
        intents.typing = False
        intents.presences = False

        class JadeClient(discord.Client):
            async def on_ready(self):
                bridge.user = self.user
                bridge.error = ''
                bridge.ready.set()
                log(f'online as {self.user} ({self.user.id}) in {len(self.guilds)} server(s)')

            async def on_disconnect(self):
                log('disconnected from the Gateway (discord.py reconnects)')

            async def on_message(self, message):
                bridge.enqueue(message)
                if bridge.archive:
                    await bridge.archive.record('create', message)

            async def on_raw_message_edit(self, payload):
                m = getattr(payload, 'message', None)
                if bridge.archive and m is not None:
                    await bridge.archive.record('edit', m)

            async def on_raw_message_delete(self, payload):
                if bridge.archive:
                    bridge.archive.deleted(payload.message_id, payload.channel_id, payload.guild_id)

            async def on_raw_bulk_message_delete(self, payload):
                if bridge.archive:
                    for mid in payload.message_ids:
                        bridge.archive.deleted(mid, payload.channel_id, payload.guild_id)

            async def on_thread_create(self, thread):
                if bridge.archive:
                    bridge.archive.note_channel(thread)

            async def on_thread_update(self, before, after):
                if bridge.archive:
                    bridge.archive.note_channel(after)

            async def on_guild_channel_update(self, before, after):
                if bridge.archive:
                    bridge.archive.note_channel(after)

        return JadeClient(intents=intents, allowed_mentions=discord.AllowedMentions.none(), max_messages=None)

    async def _main(self):
        discord = self.discord
        delay = 3
        while not self.stopping:
            self.client = self._make_client()
            try:
                await self.client.start(self.token)
                delay = 3
            except discord.LoginFailure:
                self.error = 'Discord rejected the bot token. Run: python3 jade_discord_bridge.py --set-token'
                log(self.error)
                return
            except discord.PrivilegedIntentsRequired:
                if self.content_intent:
                    self.content_intent = False
                    self.warn = ('Message Content Intent is off in the Developer Portal: the bot only sees DMs and messages that '
                                 '@mention it. Turn it on under Bot -> Privileged Gateway Intents.')
                    log(self.warn)
                    continue
                self.error = 'Discord refused the connection (privileged intents)'
                log(self.error)
                return
            except Exception as e:  # network down etc.: try again with a fresh client
                self.error = f'{type(e).__name__}: {e}'
                log('bot stopped:', self.error)
            finally:
                self.ready.clear()
                try:
                    await self.client.close()
                except Exception:
                    pass
            if self.stopping:
                return
            await asyncio.sleep(delay)
            delay = min(60, delay * 2)

    def stop(self):
        self.stopping = True
        try:
            if self.client:
                asyncio.run_coroutine_threadsafe(self.client.close(), self.loop).result(10)
        except Exception:
            pass

    # --- incoming
    def enqueue(self, m):
        d = self.discord
        if m.author.bot or (self.user and m.author.id == self.user.id):
            return
        if m.type not in (d.MessageType.default, d.MessageType.reply):
            return
        ref = None
        if m.reference and m.reference.resolved is not None and isinstance(m.reference.resolved, d.Message):
            r = m.reference.resolved
            ref = {'id': str(r.id), 'author_id': str(r.author.id), 'text': r.clean_content[:300]}
        elif m.reference and m.reference.message_id:
            ref = {'id': str(m.reference.message_id), 'author_id': '', 'text': ''}
        is_group = m.guild is not None
        item = {
            'id': str(m.id), 'chat_id': str(m.channel.id), 'guild_id': str(m.guild.id) if is_group else '', 'is_group': is_group,
            'channel': getattr(m.channel, 'name', '') or '', 'guild': m.guild.name if is_group else '',
            'author': {'id': str(m.author.id), 'name': getattr(m.author, 'display_name', None) or m.author.name, 'username': m.author.name},
            'text': m.clean_content, 'content': m.content, 'at': m.created_at.timestamp(),
            'mentions_me': bool(self.user and self.user in m.mentions), 'reply_to': ref,
            'attachments': [{'index': i, 'name': a.filename, 'content_type': a.content_type or '', 'size': a.size} for i, a in enumerate(m.attachments)],
        }
        with self.lock:
            self.queue.append(item)

    def drain(self):
        with self.lock:
            items = list(self.queue)
            self.queue.clear()
        cutoff = time.time() - self.max_age
        fresh = [i for i in items if i['at'] >= cutoff]
        if len(fresh) < len(items):
            log(f'dropped {len(items) - len(fresh)} message(s) older than {self.max_age} s')
        return fresh

    # --- tools (all run on the bot's event loop)
    def call(self, name, args, timeout=60):
        fn = getattr(self, 't_' + name, None)
        if not fn:
            raise ValueError(f'unknown tool {name}')
        if name not in ('status',) and not self.ready.wait(timeout=30):
            raise RuntimeError(self.error or 'the bot is not online yet (still connecting)')
        return asyncio.run_coroutine_threadsafe(fn(args or {}), self.loop).result(timeout)

    async def _user(self, uid):
        uid = int(uid)
        return self.client.get_user(uid) or await self.client.fetch_user(uid)

    async def _channel(self, a):
        if a.get('user_id'):
            return await (await self._user(a['user_id'])).create_dm()
        cid = int(a.get('chat_id') or 0)
        if not cid:
            raise ValueError('chat_id (or user_id) is required')
        return self.client.get_channel(cid) or await self.client.fetch_channel(cid)

    async def _guild(self, a):
        g = self.client.get_guild(int(a.get('guild_id') or 0))
        if not g:
            raise ValueError('unknown server: guild_id (list_guilds shows the servers the bot is in)')
        return g

    async def t_status(self, a):
        u = self.user
        return {'ready': self.ready.is_set(), 'user': {'id': str(u.id), 'username': u.name} if u else None, 'warn': self.warn, 'error': self.error,
                'content_intent': self.content_intent, 'guilds': len(self.client.guilds) if self.client else 0}

    async def t_my_user(self, a):
        return await self.t_status(a)

    async def t_get_new_messages(self, a):
        return self.drain()

    async def t_send_message(self, a):
        d = self.discord
        ch = await self._channel(a)
        parts = chunks(str(a.get('content') or ''))
        if not parts:
            raise ValueError('content is empty')
        last = None
        for i, p in enumerate(parts):
            ref = None
            if i == 0 and a.get('replied_to'):
                ref = d.MessageReference(message_id=int(a['replied_to']), channel_id=ch.id, fail_if_not_exists=False)
            last = await ch.send(p, reference=ref, mention_author=False, allowed_mentions=d.AllowedMentions.none())
        return {'chat_id': str(ch.id), 'message_id': str(last.id), 'parts': len(parts)}

    async def t_send_typing(self, a):
        ch = await self._channel(a)
        await self.client.http.send_typing(ch.id)
        return 'ok'

    async def t_react(self, a):
        ch = await self._channel(a)
        m = await ch.fetch_message(int(a['message_id']))
        await m.add_reaction(str(a.get('emoji') or '👍'))
        return 'ok'

    async def t_edit_message(self, a):
        d = self.discord
        ch = await self._channel(a)
        m = await ch.fetch_message(int(a['message_id']))
        await m.edit(content=str(a.get('content') or '')[:2000], allowed_mentions=d.AllowedMentions.none())
        return 'ok'

    async def t_delete_message(self, a):
        ch = await self._channel(a)
        m = await ch.fetch_message(int(a['message_id']))
        await m.delete()
        return 'ok'

    async def t_get_messages(self, a):
        ch = await self._channel(a)
        out = []
        async for m in ch.history(limit=max(1, min(int(a.get('limit') or 20), 100))):
            out.append({'id': str(m.id), 'at': m.created_at.timestamp(), 'mine': bool(self.user and m.author.id == self.user.id),
                        'author': {'id': str(m.author.id), 'name': getattr(m.author, 'display_name', None) or m.author.name},
                        'text': m.clean_content, 'reply_to': str(m.reference.message_id) if m.reference and m.reference.message_id else '',
                        'attachments': [{'index': i, 'name': x.filename} for i, x in enumerate(m.attachments)],
                        'reactions': [{'emoji': str(r.emoji), 'count': r.count} for r in m.reactions]})
        out.reverse()
        return out

    async def t_send_file_bytes(self, a):
        d = self.discord
        ch = await self._channel(a)
        data = base64.b64decode(a.get('base64') or '')
        if len(data) > MAX_FILE:
            raise ValueError('files over 25 MB are not sent')
        name = os.path.basename(str(a.get('name') or 'file')) or 'file'
        m = await ch.send(str(a.get('content') or '')[:2000] or None, file=d.File(io.BytesIO(data), filename=name), allowed_mentions=d.AllowedMentions.none())
        return {'chat_id': str(ch.id), 'message_id': str(m.id)}

    async def t_download_attachment(self, a):
        ch = await self._channel(a)
        m = await ch.fetch_message(int(a['message_id']))
        i = int(a.get('index') or 0)
        if i < 0 or i >= len(m.attachments):
            raise ValueError('that message has no such attachment')
        att = m.attachments[i]
        if att.size > int(float(a.get('max_mb') or 25) * 1048576):
            raise ValueError(f'the attachment is {att.size // 1024} KB, over the limit')
        data = await att.read()
        return {'name': att.filename, 'size': len(data), 'content_type': att.content_type or '', 'base64': base64.b64encode(data).decode()}

    async def t_get_user(self, a):
        u = await self._user(a['user_id'])
        return {'id': str(u.id), 'username': u.name, 'global_name': getattr(u, 'global_name', None), 'bot': u.bot}

    async def t_list_guilds(self, a):
        return [{'id': str(g.id), 'name': g.name, 'members': g.member_count} for g in self.client.guilds]

    async def t_list_channels(self, a):
        g = await self._guild(a)
        return [{'id': str(c.id), 'name': c.name, 'type': str(c.type)} for c in g.channels if getattr(c, 'send', None) or c.type.name in ('forum',)]

    async def t_list_members(self, a):
        g = await self._guild(a)
        out = []
        try:
            async for m in g.fetch_members(limit=max(1, min(int(a.get('limit') or 50), 200))):
                out.append({'id': str(m.id), 'name': m.display_name, 'bot': m.bot})
        except Exception as e:  # needs the Server Members Intent
            raise RuntimeError(f'cannot list members ({e}). Turn on Server Members Intent in the Developer Portal and in the bridge.')
        return out

    async def t_kick(self, a):
        g = await self._guild(a)
        await g.kick(self.discord.Object(id=int(a['user_id'])), reason=str(a.get('reason') or 'Jade'))
        return 'ok'

    async def t_ban(self, a):
        g = await self._guild(a)
        await g.ban(self.discord.Object(id=int(a['user_id'])), reason=str(a.get('reason') or 'Jade'))
        return 'ok'

    async def t_unban(self, a):
        g = await self._guild(a)
        await g.unban(self.discord.Object(id=int(a['user_id'])), reason=str(a.get('reason') or 'Jade'))
        return 'ok'

    async def t_leave_guild(self, a):
        g = await self._guild(a)
        await g.leave()
        return 'ok'

    # --- the archive
    def _archive(self):
        if not self.archive:
            raise RuntimeError('the archive is off: start the bridge with --archive (or JADE_DISCORD_ARCHIVE=1)')
        return self.archive

    async def t_archive_status(self, a):
        return self._archive().status()

    async def t_archive_backfill(self, a):
        arc = self._archive()
        if arc.progress.get('running'):
            return {'started': False, 'backfill': arc.progress}
        ids = [str(a['guild_id'])] if a.get('guild_id') else None

        async def run():
            try:
                p = await arc.backfill(self.client, self.discord, ids)
                log(f"archive: backfill done, {p['messages']} message(s) in {p['channels_done']} channel(s)")
            except Exception as e:
                log(f'archive: backfill failed: {type(e).__name__}: {e}')
        self.loop.create_task(run())
        await asyncio.sleep(0)
        return {'started': True, 'note': 'runs in the background; archive_status shows progress'}

    async def t_archive_search(self, a):
        arc = self._archive()
        lim = max(1, min(int(a.get('limit') or 20), 200))
        return await asyncio.get_running_loop().run_in_executor(None, lambda: arc.search(a.get('query'), lim, a.get('chat_id')))


TOOLS = {
    'status': 'Is the bot online? Returns the bot user, warnings and server count.',
    'my_user': 'The bot account (id, username).',
    'get_new_messages': 'Messages the bot received since the last call (DMs and server messages, never from bots). Each: id, chat_id, guild_id, is_group, text, author, mentions_me, reply_to, attachments.',
    'send_message': 'Send text to chat_id (a channel) or user_id (a DM). content is split under 2000 characters; replied_to makes the first part a reply. Never pings @everyone/@here/roles.',
    'send_typing': 'Show the typing indicator in chat_id / user_id.',
    'react': 'Add an emoji reaction to message_id.',
    'edit_message': "Edit one of the bot's messages.",
    'delete_message': 'Delete message_id (the bot\'s own, or any if it has Manage Messages).',
    'get_messages': 'Recent messages of a chat, oldest first.',
    'send_file_bytes': 'Upload a file (base64) to a chat.',
    'download_attachment': 'Download attachment index of message_id as base64.',
    'get_user': 'Look a user up by id.',
    'list_guilds': 'Servers the bot is in.',
    'list_channels': "A server's channels.",
    'list_members': "A server's members (needs the Server Members Intent).",
    'kick': 'Kick user_id from guild_id.',
    'ban': 'Ban user_id from guild_id.',
    'unban': 'Unban user_id from guild_id.',
    'leave_guild': 'Leave guild_id.',
    'archive_status': 'The archive (--archive): where it is, its size, and how a running backfill is doing.',
    'archive_backfill': 'Archive the whole history of every channel and thread the bot can read (or only guild_id), in the background. Resumes where it stopped.',
    'archive_search': 'Search the archive for query (text or author name); optional chat_id, limit (20). Oldest first. Deleted messages are left out.',
}
TOOL_DEFS = [{'name': n, 'description': d, 'inputSchema': {'type': 'object', 'properties': {}, 'additionalProperties': True}} for n, d in TOOLS.items()]


# ---------- HTTP (MCP) ----------
def make_handler(bridge, token, origin):
    def ok_token(h):
        got = h.headers.get('Authorization', '')
        return got.startswith('Bearer ') and hmac.compare_digest(got[7:].strip().encode(), token.encode())

    class H(http.server.BaseHTTPRequestHandler):
        protocol_version = 'HTTP/1.1'
        server_version = 'JadeDiscordBridge/1.0'

        def log_message(self, fmt, *a):
            pass

        def _cors(self):
            self.send_header('Access-Control-Allow-Origin', origin)
            self.send_header('Access-Control-Allow-Headers', 'authorization, content-type, accept, mcp-session-id, mcp-protocol-version')
            self.send_header('Access-Control-Allow-Methods', 'POST, GET, DELETE, OPTIONS')
            self.send_header('Access-Control-Expose-Headers', 'mcp-session-id')
            self.send_header('Access-Control-Max-Age', '600')

        def _send(self, code, obj=None, extra=None):
            body = b'' if obj is None else json.dumps(obj, ensure_ascii=False).encode()
            self.send_response(code)
            self._cors()
            if obj is not None:
                self.send_header('Content-Type', 'application/json')
            for k, v in (extra or {}).items():
                self.send_header(k, v)
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            if body:
                self.wfile.write(body)

        def _deny(self):
            time.sleep(0.5)  # slows down guessing; the token itself is 192 random bits
            self._send(401, {'error': 'missing or wrong bridge token'})

        def do_OPTIONS(self):
            self._send(204)

        def do_GET(self):
            p = self.path.split('?')[0]
            if p in ('/', '/health'):
                if not ok_token(self):
                    return self._deny()
                u = bridge.user
                return self._send(200, {'ok': True, 'ready': bridge.ready.is_set(), 'user': u.name if u else None, 'warn': bridge.warn, 'error': bridge.error})
            if p == '/mcp':
                return self._send(405, {'error': 'use POST'}, {'Allow': 'POST, DELETE'})
            self._send(404, {'error': 'not found'})

        def do_DELETE(self):
            n = int(self.headers.get('Content-Length') or 0)
            if 0 < n <= MAX_BODY:
                self.rfile.read(n)
            if not ok_token(self):
                return self._deny()
            self._send(200, {})

        def do_POST(self):
            n = int(self.headers.get('Content-Length') or 0)
            if n > MAX_BODY:
                self.close_connection = True
                return self._send(413, {'error': 'request too large'})
            if self.path.split('?')[0] != '/mcp' or not ok_token(self):
                if n:
                    self.rfile.read(n)
                if self.path.split('?')[0] != '/mcp':
                    return self._send(404, {'error': 'not found'})
                return self._deny()
            try:
                req = json.loads(self.rfile.read(n) or b'null')
            except Exception:
                return self._send(400, {'jsonrpc': '2.0', 'id': None, 'error': {'code': -32700, 'message': 'parse error'}})
            batch = req if isinstance(req, list) else [req]
            out = []
            for m in batch:
                if not isinstance(m, dict):
                    continue
                method, mid = m.get('method'), m.get('id')
                if mid is None:
                    continue  # notifications need no answer
                if method == 'initialize':
                    out.append({'jsonrpc': '2.0', 'id': mid, 'result': {'protocolVersion': PROTOCOL, 'capabilities': {'tools': {}}, 'serverInfo': {'name': 'jade-discord-bridge', 'version': '1.0'},
                                                                         'instructions': 'A Discord bot served by the Jade Discord bridge.'}})
                elif method == 'ping':
                    out.append({'jsonrpc': '2.0', 'id': mid, 'result': {}})
                elif method == 'tools/list':
                    out.append({'jsonrpc': '2.0', 'id': mid, 'result': {'tools': TOOL_DEFS}})
                elif method == 'tools/call':
                    p = m.get('params') or {}
                    try:
                        res = bridge.call(p.get('name'), p.get('arguments') or {}, timeout=240 if p.get('name') in ('send_file_bytes', 'download_attachment') else 60)
                        text = res if isinstance(res, str) else json.dumps(res, ensure_ascii=False)
                        out.append({'jsonrpc': '2.0', 'id': mid, 'result': {'content': [{'type': 'text', 'text': text}]}})
                    except Exception as e:
                        msg = str(e) or type(e).__name__
                        out.append({'jsonrpc': '2.0', 'id': mid, 'result': {'isError': True, 'content': [{'type': 'text', 'text': msg}]}})
                else:
                    out.append({'jsonrpc': '2.0', 'id': mid, 'error': {'code': -32601, 'message': f'method not found: {method}'}})
            if not out:
                return self._send(202)
            self._send(200, out if isinstance(req, list) else out[0], {'Mcp-Session-Id': 'jade-discord'})

    return H


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def main():
    ap = argparse.ArgumentParser(description="Serve a Discord bot (discord.py) to Jade Vault over HTTP.")
    ap.add_argument('--host', default=os.environ.get('JADE_DISCORD_HOST', '0.0.0.0'))
    ap.add_argument('--port', type=int, default=int(os.environ.get('JADE_DISCORD_PORT', '8788')))
    ap.add_argument('--bot-token-file', default=None, help="file holding the bot's token (default ~/.jade-discord/bot_token, or env DISCORD_BOT_TOKEN)")
    ap.add_argument('--set-token', action='store_true', help="ask for the bot's token and store it, then exit")
    ap.add_argument('--max-age', type=int, default=int(os.environ.get('JADE_DISCORD_MAX_AGE', '600')), help='drop queued messages older than this many seconds (default 600)')
    ap.add_argument('--allow-origin', default='*', help='CORS origin for browser use (default *)')
    ap.add_argument('--tls-cert', default=os.environ.get('JADE_DISCORD_TLS_CERT'), help='serve HTTPS with this certificate (PEM); use with --tls-key')
    ap.add_argument('--tls-key', default=os.environ.get('JADE_DISCORD_TLS_KEY'), help='private key (PEM) for --tls-cert')
    ap.add_argument('--print-token', action='store_true', help='print the bridge token and exit')
    ap.add_argument('--new-token', action='store_true', help='make a new bridge token (the old one stops working)')
    env = os.environ.get
    ap.add_argument('--archive', action='store_true', default=env('JADE_DISCORD_ARCHIVE', '') not in ('', '0', 'false'),
                    help='keep every message the bot sees (servers; DMs with --archive-dms) on this computer')
    ap.add_argument('--archive-dir', default=env('JADE_DISCORD_ARCHIVE_DIR'), help='where the archive lives (default ~/.jade-discord/archive)')
    ap.add_argument('--archive-dms', action='store_true', default=env('JADE_DISCORD_ARCHIVE_DMS', '') not in ('', '0', 'false'), help="also keep the bot's DMs")
    ap.add_argument('--archive-files-mb', type=float, default=float(env('JADE_DISCORD_ARCHIVE_FILES_MB', '25')),
                    help='download attachments up to this size (MB) into the archive; 0 keeps links only (default 25)')
    ap.add_argument('--backfill', nargs='*', metavar='GUILD_ID', default=None,
                    help='archive the full history of every server the bot is in (or these), then exit. Resumes where it stopped')
    ap.add_argument('--render', metavar='OUT_DIR', help='write the archive as markdown notes (an Obsidian-style vault) into OUT_DIR, then exit')
    ap.add_argument('--name', default=env('JADE_DISCORD_ARCHIVE_NAME', 'Discord Archive'), help='what you call the archive; the vault folder and index note get this name')
    ap.add_argument('--description', default=env('JADE_DISCORD_ARCHIVE_DESCRIPTION', ''), help='a line or two about it, for the index note')
    args = ap.parse_args()
    if args.backfill is not None:
        args.archive = True
    arc_dir = pathlib.Path(args.archive_dir) if args.archive_dir else HOME / 'archive'
    if args.render:
        if not arc_dir.exists():
            sys.exit(f'no archive at {arc_dir}')
        r = render(arc_dir, args.render, args.name, args.description, with_files=args.archive_files_mb > 0)
        print(f"{r['messages']} message(s) in {r['notes']} note(s): {r['dir']}")
        return
    import logging
    logging.basicConfig(level=logging.WARNING, format='%(asctime)s %(name)s %(message)s', datefmt='%H:%M:%S')

    HOME.mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(HOME, 0o700)
    except OSError:
        pass
    bot_path = pathlib.Path(args.bot_token_file) if args.bot_token_file else HOME / 'bot_token'
    if args.set_token:
        t = getpass.getpass("Paste the bot token (Developer Portal -> your app -> Bot -> Reset Token): ").strip()
        if not t:
            sys.exit('no token entered')
        bot_path.write_text(t + '\n')
        os.chmod(bot_path, 0o600)
        print(f'saved to {bot_path}')
        return
    tok_path = HOME / 'token'
    if args.new_token and tok_path.exists():
        tok_path.unlink()
    token = read_secret(tok_path, lambda: secrets.token_urlsafe(24))
    if args.print_token:
        print(token)
        return
    bot_token = os.environ.get('DISCORD_BOT_TOKEN') or (bot_path.read_text().strip() if bot_path.exists() else '')
    if not bot_token:
        sys.exit(f'No bot token. Run:  python3 {sys.argv[0]} --set-token')
    try:
        import discord  # noqa: F401
    except ImportError:
        sys.exit('discord.py is not installed:  pip install discord.py')
    base = os.environ.get('JADE_DISCORD_TEST_API')  # tests only: point discord.py at a fake Discord
    if base:
        import discord.http
        import discord.gateway, yarl
        discord.http.Route.BASE = base.rstrip('/')
        discord.gateway.DiscordWebSocket.DEFAULT_GATEWAY = yarl.URL(os.environ.get('JADE_DISCORD_TEST_GATEWAY', base.replace('http', 'ws').rsplit('/api', 1)[0] + '/gateway'))

    archive = Archive(arc_dir, dms=args.archive_dms, files_mb=args.archive_files_mb) if args.archive else None
    bridge = Bridge(bot_token, max_age=args.max_age, archive=archive)
    bridge.start()
    if args.backfill is not None:
        if not bridge.ready.wait(timeout=120):
            sys.exit(bridge.error or 'the bot did not come online')
        log(f'backfilling into {arc_dir} …')
        p = asyncio.run_coroutine_threadsafe(archive.backfill(bridge.client, bridge.discord, [str(g) for g in args.backfill] or None), bridge.loop).result()
        for s in p['skipped']:
            log('skipped:', s)
        log(f"done: {p['messages']} new message(s) in {p['channels_done']} channel(s)")
        bridge.stop()
        return
    if archive:
        log(f'archive: keeping every message in {arc_dir}{" (DMs too)" if args.archive_dms else ""}')
    srv = Server((args.host, args.port), make_handler(bridge, token, args.allow_origin))
    scheme = 'http'
    if args.tls_cert:
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.minimum_version = ssl.TLSVersion.TLSv1_2
        ctx.load_cert_chain(args.tls_cert, args.tls_key)
        srv.socket = ctx.wrap_socket(srv.socket, server_side=True)
        scheme = 'https'
    elif args.host not in ('127.0.0.1', 'localhost', '::1'):
        log('note: plain HTTP. Keep the bridge on a trusted network (home Wi-Fi, Tailscale/WireGuard) or add --tls-cert/--tls-key.')
    log(f'Jade Discord bridge on {scheme}://{args.host}:{args.port}/mcp')
    log(f'Bridge token: {token}   (Jade Vault -> Config -> Discord)')

    def stop(*_):
        bridge.stop()
        threading.Thread(target=srv.shutdown, daemon=True).start()

    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)
    srv.serve_forever()


if __name__ == '__main__':
    main()
