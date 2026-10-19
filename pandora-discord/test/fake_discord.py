#!/usr/bin/env python3
"""A tiny fake Discord (REST + Gateway) so the Jade Discord bridge can be tested with the real discord.py, offline.

    python3 fake_discord.py --port 8790 [--reject-content-once]

Control:  POST /_inject {channel_id, author, content, mention_bot, reply_to, attachments, bot}
          POST /_seed {channel_id, author, content, reply_to, attachments}   (history only: no Gateway event, for backfills)
          POST /_edit {id, content}       POST /_delete {id}       (MESSAGE_UPDATE / MESSAGE_DELETE on the Gateway)
          POST /_file {name, base64}     (served at /cdn/<name>, for attachments)
          POST /_kill                    (drops the Gateway connection: the bot must resume)
          GET  /_state                   (what the bot sent, reacted, edited, deleted; REST calls; identifies; resumes)
Server 70000000000000700 "Book Club" with channels ...800 #general and ...801 #offtopic, a forum ...820 #book-forum with an archived post ...821, an active thread ...810
"Plot holes" and an archived thread ...811 "Old picks" under #general. A DM with user N is channel 88N.
"""
import argparse, asyncio, base64, json, time
from aiohttp import web, WSMsgType


def _json(obj, status=200):
    # discord.py only parses a body as JSON when content-type is exactly application/json (no charset)
    return web.Response(body=json.dumps(obj).encode(), status=status, content_type='application/json')


BOT = {'id': '90000000000000900', 'username': 'JadeBot', 'discriminator': '0', 'global_name': 'Jade', 'avatar': None, 'bot': True}


def user(id, username, global_name=None):
    return {'id': str(id), 'username': username, 'discriminator': '0', 'global_name': global_name or username.title(), 'avatar': None}


USERS = {'10000000000000100': user(10000000000000100, 'owner', 'Sam'), '10000000000000111': user(10000000000000111, 'alice', 'Alice'), '10000000000000120': user(10000000000000120, 'mod', 'Mod'), '10000000000000222': user(10000000000000222, 'bob', 'Bob')}
CHANNELS = {'80000000000000800': {'id': '80000000000000800', 'type': 0, 'guild_id': '70000000000000700', 'name': 'general', 'position': 0, 'permission_overwrites': [], 'nsfw': False, 'parent_id': None},
            '80000000000000801': {'id': '80000000000000801', 'type': 0, 'guild_id': '70000000000000700', 'name': 'offtopic', 'position': 1, 'permission_overwrites': [], 'nsfw': False, 'parent_id': None},
            '80000000000000820': {'id': '80000000000000820', 'type': 15, 'guild_id': '70000000000000700', 'name': 'book-forum', 'position': 2, 'permission_overwrites': [], 'nsfw': False, 'parent_id': None, 'available_tags': [], 'flags': 0}}
THREADS = {'80000000000000810': {'id': '80000000000000810', 'type': 11, 'guild_id': '70000000000000700', 'name': 'Plot holes', 'parent_id': '80000000000000800',
                                 'owner_id': '10000000000000111', 'message_count': 0, 'member_count': 1, 'rate_limit_per_user': 0, 'flags': 0,
                                 'thread_metadata': {'archived': False, 'auto_archive_duration': 1440, 'archive_timestamp': '2026-01-01T00:00:00.000000+00:00', 'locked': False}},
           '80000000000000811': {'id': '80000000000000811', 'type': 11, 'guild_id': '70000000000000700', 'name': 'Old picks', 'parent_id': '80000000000000800',
                                 'owner_id': '10000000000000111', 'message_count': 0, 'member_count': 1, 'rate_limit_per_user': 0, 'flags': 0,
                                 'thread_metadata': {'archived': True, 'auto_archive_duration': 1440, 'archive_timestamp': '2026-01-01T00:00:00.000000+00:00', 'locked': False}},
           '80000000000000821': {'id': '80000000000000821', 'type': 11, 'guild_id': '70000000000000700', 'name': 'Archived post', 'parent_id': '80000000000000820',
                                 'owner_id': '10000000000000111', 'message_count': 0, 'member_count': 1, 'rate_limit_per_user': 0, 'flags': 0,
                                 'thread_metadata': {'archived': True, 'auto_archive_duration': 1440, 'archive_timestamp': '2026-01-01T00:00:00.000000+00:00', 'locked': False}}}
GUILD = {'id': '70000000000000700', 'name': 'Book Club', 'owner_id': '10000000000000100', 'member_count': 4, 'unavailable': False, 'channels': list(CHANNELS.values()), 'roles': [], 'emojis': [], 'stickers': [],
         'features': [], 'system_channel_flags': 0, 'premium_tier': 0, 'verification_level': 0, 'default_message_notifications': 0, 'explicit_content_filter': 0,
         'afk_timeout': 300, 'mfa_level': 0, 'preferred_locale': 'en-US', 'nsfw_level': 0, 'premium_progress_bar_enabled': False}
FILES = {}
S = {'sent': [], 'msgs': {}, 'next': 5000, 'wss': [], 'seq': 0, 'calls': [], 'reactions': [], 'deleted': [], 'edited': [], 'typing': [], 'identifies': [], 'resumes': [], 'rejected': False}
OPT = {'reject_content_once': False}


def snow():
    # a real snowflake: milliseconds since the Discord epoch in the high bits, so created_at is right
    S['next'] += 1
    return str(((int(time.time() * 1000) - 1420070400000) << 22) | (S['next'] & 0xFFF))


def ts():
    return time.strftime('%Y-%m-%dT%H:%M:%S.000000+00:00', time.gmtime())


def is_dm(cid):
    return str(cid).startswith('88')


def channel_obj(cid):
    cid = str(cid)
    if cid in CHANNELS:
        return CHANNELS[cid]
    if cid in THREADS:
        return THREADS[cid]
    if is_dm(cid):
        uid = cid[2:]
        return {'id': cid, 'type': 1, 'recipients': [USERS.get(uid) or user(uid, 'user' + uid)]}
    return None


def find_msg(mid):
    for l in S['msgs'].values():
        for m in l:
            if m['id'] == str(mid):
                return m
    return None


def msg_obj(id, channel_id, author, content, ref=None, atts=None, mentions=None):
    m = {'id': id, 'channel_id': channel_id, 'author': author, 'content': content, 'timestamp': ts(), 'edited_timestamp': None, 'tts': False,
         'mention_everyone': False, 'mentions': mentions or [], 'mention_roles': [], 'attachments': atts or [], 'embeds': [], 'pinned': False, 'type': 19 if ref else 0, 'flags': 0}
    if channel_id in CHANNELS or channel_id in THREADS:
        m['guild_id'] = '70000000000000700'
    if ref:
        m['message_reference'] = {'message_id': str(ref), 'channel_id': channel_id}
        r = find_msg(ref)
        if r:
            m['referenced_message'] = r
    S['msgs'].setdefault(channel_id, []).append(m)
    return m


async def dispatch(t, d):
    S['seq'] += 1
    for ws in list(S['wss']):
        try:
            await ws.send_json({'op': 0, 't': t, 's': S['seq'], 'd': d})
        except Exception:
            pass


async def gateway(req):
    ws = web.WebSocketResponse()
    await ws.prepare(req)
    await ws.send_json({'op': 10, 'd': {'heartbeat_interval': 20000}})
    async for m in ws:
        if m.type != WSMsgType.TEXT:
            continue
        p = json.loads(m.data)
        if p['op'] == 2:
            intents = p['d'].get('intents') or 0
            S['identifies'].append(intents)
            if OPT['reject_content_once'] and not S['rejected'] and intents & (1 << 15):
                S['rejected'] = True
                await ws.close(code=4014, message=b'Disallowed intent(s)')
                continue
            S['wss'].append(ws)
            S['seq'] += 1
            await ws.send_json({'op': 0, 't': 'READY', 's': S['seq'], 'd': {'v': 10, 'user': BOT, 'guilds': [{'id': '70000000000000700', 'unavailable': True}], 'session_id': 'sess1',
                                                                          'resume_gateway_url': f"ws://{req.host}/gateway", 'application': {'id': '90000000000000900', 'flags': 0}}})
            S['seq'] += 1
            await ws.send_json({'op': 0, 't': 'GUILD_CREATE', 's': S['seq'], 'd': {**GUILD, 'members': [], 'threads': [t for t in THREADS.values() if not t['thread_metadata']['archived']], 'presences': [], 'voice_states': []}})
        elif p['op'] == 6:
            S['resumes'].append(p['d'])
            S['wss'].append(ws)
            S['seq'] += 1
            await ws.send_json({'op': 0, 't': 'RESUMED', 's': S['seq'], 'd': {}})
        elif p['op'] == 1:
            await ws.send_json({'op': 11})
    if ws in S['wss']:
        S['wss'].remove(ws)
    return ws


async def j(req):
    try:
        return await req.json()
    except Exception:
        return {}


def nf(what, code):
    return _json({'message': what, 'code': code}, 404)


async def rest(req):
    path = req.path.split('/api/v10', 1)[-1]
    parts = [x for x in path.split('/') if x]
    S['calls'].append(f'{req.method} {path}')
    if path == '/gateway/bot':
        return _json({'url': f"ws://{req.host}/gateway", 'shards': 1, 'session_start_limit': {'total': 1000, 'remaining': 999, 'reset_after': 1000, 'max_concurrency': 1}})
    if path == '/oauth2/applications/@me':
        return _json({'id': '90000000000000900', 'name': 'Jade', 'description': '', 'verify_key': '', 'flags': 0, 'bot_public': True, 'bot_require_code_grant': False,
                      'team': None, 'owner': USERS['10000000000000100'], 'icon': None, 'summary': '', 'install_params': None})
    if path == '/users/@me':
        return _json(BOT)
    if path == '/users/@me/channels' and req.method == 'POST':
        rid = str((await j(req)).get('recipient_id'))
        return _json(channel_obj('88' + rid))
    if parts[:1] == ['users'] and len(parts) == 2:
        u = USERS.get(parts[1])
        return _json(u) if u else nf('Unknown User', 10013)
    if parts[:1] == ['channels'] and len(parts) >= 2:
        cid = parts[1]
        ch = channel_obj(cid)
        if len(parts) == 2:
            return _json(ch) if ch else nf('Unknown Channel', 10003)
        if parts[2] == 'threads' and len(parts) >= 5 and parts[3] == 'archived':
            if parts[4] == 'private':
                return _json({'message': 'Missing Access', 'code': 50001}, 403)
            ths = [t for t in THREADS.values() if t['parent_id'] == cid and t['thread_metadata']['archived']]
            return _json({'threads': ths, 'members': [], 'has_more': False})
        if parts[2] == 'typing':
            S['typing'].append(cid)
            return web.Response(status=204)
        if parts[2] == 'messages' and len(parts) == 3:
            if req.method == 'GET':
                lim = int(req.query.get('limit', 50))
                ms = sorted(S['msgs'].get(cid, []), key=lambda m: int(m['id']))
                if 'after' in req.query:  # like Discord: the oldest `limit` after the id, newest first
                    a = int(req.query['after'])
                    return _json(list(reversed([m for m in ms if int(m['id']) > a][:lim])))
                if 'before' in req.query:
                    ms = [m for m in ms if int(m['id']) < int(req.query['before'])]
                return _json(list(reversed(ms))[:lim])
            body, fname, fbytes = {}, None, None
            if req.content_type.startswith('multipart'):
                rd = await req.multipart()
                async for part in rd:
                    if part.name == 'payload_json':
                        body = json.loads(await part.text())
                    elif part.filename:
                        fname, fbytes = part.filename, await part.read()
            else:
                body = await j(req)
            ref = (body.get('message_reference') or {}).get('message_id')
            atts = [{'id': snow(), 'filename': fname, 'size': len(fbytes), 'url': 'x', 'proxy_url': 'x', 'content_type': 'application/octet-stream'}] if fname else []
            m = msg_obj(snow(), cid, BOT, body.get('content') or '', ref, atts)
            S['sent'].append({'chat_id': cid, 'content': body.get('content'), 'reply_to': ref, 'id': m['id'], 'allowed_mentions': body.get('allowed_mentions'),
                              'file': fname, 'file_len': len(fbytes) if fbytes else 0, 'file_head': (fbytes or b'')[:64].decode('latin1')})
            return _json(m)
        if parts[2] == 'messages' and len(parts) >= 4:
            mid = parts[3]
            found = find_msg(mid)
            if len(parts) == 4 and req.method == 'GET':
                return _json(found) if found else nf('Unknown Message', 10008)
            if len(parts) == 4 and req.method == 'PATCH':
                b = await j(req)
                S['edited'].append({'id': mid, 'content': b.get('content')})
                if found:
                    found['content'] = b.get('content')
                return _json(found or {})
            if len(parts) == 4 and req.method == 'DELETE':
                S['deleted'].append(mid)
                return web.Response(status=204)
            if len(parts) >= 6 and parts[4] == 'reactions':
                S['reactions'].append({'id': mid, 'emoji': parts[5]})
                return web.Response(status=204)
    if parts[:1] == ['guilds'] and parts[2:] == ['threads', 'active']:
        return _json({'threads': [t for t in THREADS.values() if not t['thread_metadata']['archived']], 'members': []})
    if parts[:1] == ['guilds'] and len(parts) == 2:
        return _json(GUILD)
    if parts[:1] == ['guilds'] and len(parts) >= 3 and parts[2] in ('members', 'bans'):
        return web.Response(status=204)
    return _json({'message': f'fake: unhandled {req.method} {path}', 'code': 0}, 404)


async def inject(req):
    b = await j(req)
    cid = str(b.get('channel_id') or '8810000000000000111')
    a = b.get('author') or USERS['10000000000000100']
    if isinstance(a, str):
        a = USERS.get(a) or user(a, 'user' + a)
    atts = b.get('attachments') or []
    for x in atts:
        x.setdefault('id', snow())
        x.setdefault('proxy_url', x.get('url', 'x'))
    ments = [BOT] if b.get('mention_bot') else []
    m = msg_obj(snow(), cid, {**a, **({'bot': True} if b.get('bot') else {})}, b.get('content') or '', b.get('reply_to'), atts, ments)
    await dispatch('MESSAGE_CREATE', m)
    return _json({'id': m['id']})


async def seed(req):
    b = await j(req)
    a = b.get('author') or USERS['10000000000000111']
    if isinstance(a, str):
        a = USERS.get(a) or user(a, 'user' + a)
    atts = b.get('attachments') or []
    for x in atts:
        x.setdefault('id', snow())
        x.setdefault('proxy_url', x.get('url', 'x'))
    m = msg_obj(snow(), str(b['channel_id']), {**a, **({'bot': True} if b.get('bot') else {})}, b.get('content') or '', b.get('reply_to'), atts)
    return _json({'id': m['id']})


async def edit(req):
    b = await j(req)
    m = find_msg(b['id'])
    m['content'] = b.get('content') or ''
    m['edited_timestamp'] = ts()
    await dispatch('MESSAGE_UPDATE', m)
    return _json({'ok': True})


async def delete(req):
    b = await j(req)
    m = find_msg(b['id'])
    S['msgs'][m['channel_id']].remove(m)
    await dispatch('MESSAGE_DELETE', {'id': m['id'], 'channel_id': m['channel_id'], **({'guild_id': m['guild_id']} if m.get('guild_id') else {})})
    return _json({'ok': True})


async def put_file(req):
    b = await j(req)
    FILES[b['name']] = base64.b64decode(b['base64'])
    return _json({'ok': True})


async def cdn(req):
    d = FILES.get(req.match_info['name'])
    return web.Response(body=d, content_type='application/octet-stream') if d is not None else web.Response(status=404)


async def state(req):
    return _json({k: S[k] for k in ('sent', 'reactions', 'deleted', 'edited', 'typing', 'calls', 'identifies', 'resumes')} | {'connected': len(S['wss'])})


async def reset(req):
    for k in ('sent', 'reactions', 'deleted', 'edited', 'typing', 'calls'):
        S[k].clear()
    return _json({'ok': True})


async def kill(req):
    for ws in list(S['wss']):
        await ws.close(code=4000)
    return _json({'ok': True})


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--port', type=int, default=8790)
    ap.add_argument('--reject-content-once', action='store_true', help='close the first Gateway session that asks for Message Content with 4014')
    a = ap.parse_args()
    OPT['reject_content_once'] = a.reject_content_once
    app = web.Application(client_max_size=64 * 1024 * 1024)
    app.router.add_get('/gateway', gateway)
    app.router.add_post('/_inject', inject)
    app.router.add_post('/_file', put_file)
    app.router.add_post('/_seed', seed)
    app.router.add_post('/_edit', edit)
    app.router.add_post('/_delete', delete)
    app.router.add_get('/cdn/{name}', cdn)
    app.router.add_get('/_state', state)
    app.router.add_post('/_reset', reset)
    app.router.add_post('/_kill', kill)
    app.router.add_route('*', '/api/v10/{tail:.*}', rest)
    web.run_app(app, host='127.0.0.1', port=a.port, print=None)


if __name__ == '__main__':
    main()
