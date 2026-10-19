#!/usr/bin/env python3
"""Test double for Vector's vector-agent (patched for Jade): the same MCP tools over stdio, with an
in-memory network. A control port (FAKE_CONTROL_PORT) lets tests inject incoming messages, events
and Mini App frames, and read back what the bot did."""
import base64, http.server, json, os, socketserver, sys, threading, time

ME = 'npub1jadebot0000000000000000000000000000000000000000000000000'
lock = threading.Lock()
S = {'new': [], 'events': [], 'chats': {}, 'log': [], 'seq': 0, 'files': {}, 'xdc': {}, 'communities': [], 'pending': [], 'profiles': {}}

def nid(p='m'):
    S['seq'] += 1; return f'{p}{S["seq"]:04d}'

def add_history(chat_id, msg):
    S['chats'].setdefault(chat_id, []).append(msg)

def out(text, err=False):
    return {'content': [{'type': 'text', 'text': text if isinstance(text, str) else json.dumps(text)}], 'isError': err}

def tool(name, a):
    L = S['log']
    if name == 'my_npub': return out(ME)
    if name == 'get_new_messages':
        msgs, S['new'] = S['new'], []
        return out(json.dumps(msgs) if msgs else 'No new messages')
    if name == 'get_new_events':
        ev, S['events'] = S['events'], []
        return out(json.dumps(ev))
    if name in ('send_message', 'send_dm', 'send_community_message'):
        chat = a.get('chat_id') or a.get('to_npub') or a.get('channel_id'); mid = nid()
        L.append({'op': 'send', 'chat_id': chat, 'content': a.get('content'), 'replied_to': a.get('replied_to')})
        add_history(chat, {'id': mid, 'content': a.get('content'), 'mine': True, 'at': int(time.time() * 1000), 'attachments': [], 'reactions': [], 'replied_to': a.get('replied_to') or ''})
        return out({'message_id': mid})
    if name == 'react':
        L.append({'op': 'react', **a}); return out('reacted')
    if name == 'send_typing':
        L.append({'op': 'typing', **a}); return out('typing')
    if name == 'edit_message':
        L.append({'op': 'edit', **a}); return out('edited')
    if name == 'delete_message':
        L.append({'op': 'delete', **a}); return out('deleted')
    if name == 'send_file_bytes':
        b = base64.b64decode(a['base64']); mid = nid()
        L.append({'op': 'file', 'chat_id': a['chat_id'], 'name': a['name'], 'size': len(b), 'head': b[:16].hex()})
        return out({'message_id': mid})
    if name == 'download_attachment':
        f = S['files'].get((a['message_id'], int(a.get('index') or 0)))
        if not f: return out('No such message', True)
        return out({'name': f['name'], 'extension': f['name'].rsplit('.', 1)[-1], 'size': len(f['bytes']), 'base64': base64.b64encode(f['bytes']).decode()})
    if name == 'get_messages':
        h = S['chats'].get(a['chat_id'], []); lim = int(a.get('limit') or 50)
        return out(json.dumps(h[-lim:]))
    if name == 'list_chats':
        return out(json.dumps([{'id': k, 'last_message': v[-1] if v else None} for k, v in S['chats'].items()]))
    if name in ('get_profile', 'load_profile'):
        p = S['profiles'].get(a['npub'])
        return out(json.dumps(p) if p else 'Profile not found', not p)
    if name == 'update_profile':
        L.append({'op': 'profile', **a}); return out('Profile updated')
    if name == 'list_communities': return out(json.dumps(S['communities']))
    if name == 'list_pending_invites': return out(json.dumps(S['pending']))
    if name == 'accept_pending_invite':
        inv = next((p for p in S['pending'] if p['community_id'] == a['community_id']), None)
        if not inv: return out('No pending invite', True)
        S['pending'].remove(inv)
        S['communities'].append({'community_id': inv['community_id'], 'name': inv['name'], 'channels': [{'channel_id': inv['community_id'] + 'c1', 'name': 'general', 'private': False, 'readable': True}]})
        L.append({'op': 'accept', 'community_id': a['community_id']}); return out(f"Joined {inv['name']}")
    if name == 'join_community':
        cid = 'cm' + str(len(S['communities']) + 1).zfill(4)
        S['communities'].append({'community_id': cid, 'name': 'Joined via link', 'channels': [{'channel_id': cid + 'c1', 'name': 'general'}]})
        L.append({'op': 'join', 'invite_url': a['invite_url']}); return out(json.dumps({'community_id': cid}))
    if name == 'leave_community':
        S['communities'] = [c for c in S['communities'] if c['community_id'] != a['community_id']]
        L.append({'op': 'leave', 'community_id': a['community_id']}); return out('Left the community.')
    if name in ('send_private_invite', 'kick_community_member', 'ban_community_member', 'grant_community_admin', 'block_user', 'create_public_invite', 'create_channel', 'create_community'):
        L.append({'op': name, **a}); return out(json.dumps({'ok': True, 'url': 'https://vectorapp.io/invite#x'}) if name == 'create_public_invite' else 'ok')
    if name == 'xdc_apps':
        return out(json.dumps([{'message_id': k, 'file': v['file'], 'topic': v['topic'], 'from_me': False, 'joined': v['joined'], 'playing': []} for k, v in S['xdc'].items() if v['chat_id'] == a['chat_id']]))
    if name == 'xdc_join':
        app = S['xdc'].get(a['message_id'])
        if not app: return out('No such message', True)
        app['joined'] = True; L.append({'op': 'xdc_join', 'topic': app['topic']})
        return out(json.dumps({'topic': app['topic'], 'chat_id': app['chat_id'], 'self_addr': ME}))
    if name == 'xdc_read':
        app = next((v for v in S['xdc'].values() if v['topic'] == a['topic'] and v['joined']), None)
        if not app: return out('Not in that session; xdc_join first', True)
        deadline = time.time() + min(30000, int(a.get('wait_ms') or 0)) / 1000
        while not app['frames'] and time.time() < deadline:
            lock.release(); time.sleep(0.05); lock.acquire()
        fr, app['frames'] = app['frames'][:100], app['frames'][100:]
        return out(json.dumps(fr))
    if name == 'xdc_send':
        app = next((v for v in S['xdc'].values() if v['topic'] == a['topic'] and v['joined']), None)
        if not app: return out('Not in that session; xdc_join first', True)
        L.append({'op': 'xdc_send', 'topic': a['topic'], 'text': a['text']}); return out('sent')
    if name == 'xdc_leave':
        for v in S['xdc'].values():
            if v['topic'] == a['topic']: v['joined'] = False
        L.append({'op': 'xdc_leave', 'topic': a['topic']}); return out('left')
    return out(f'unknown tool {name}', True)

TOOLS = ['my_npub', 'get_new_messages', 'get_new_events', 'send_message', 'send_dm', 'send_community_message', 'react', 'send_typing', 'edit_message', 'delete_message', 'send_file_bytes', 'download_attachment', 'get_messages', 'list_chats', 'get_profile', 'load_profile', 'update_profile', 'list_communities', 'list_pending_invites', 'accept_pending_invite', 'join_community', 'leave_community', 'send_private_invite', 'kick_community_member', 'ban_community_member', 'grant_community_admin', 'block_user', 'create_public_invite', 'create_channel', 'create_community', 'xdc_apps', 'xdc_join', 'xdc_read', 'xdc_send', 'xdc_leave']

def handle(m):
    meth, mid = m.get('method'), m.get('id')
    if mid is None: return None
    if meth == 'initialize':
        return {'jsonrpc': '2.0', 'id': mid, 'result': {'protocolVersion': '2025-06-18', 'capabilities': {'tools': {}}, 'serverInfo': {'name': 'vector-agent', 'version': '0.1.0-fake'}}}
    if meth == 'tools/list':
        return {'jsonrpc': '2.0', 'id': mid, 'result': {'tools': [{'name': t, 'description': t, 'inputSchema': {'type': 'object', 'properties': {}}} for t in TOOLS]}}
    if meth == 'tools/call':
        p = m.get('params') or {}
        with lock:
            r = tool(p.get('name'), p.get('arguments') or {})
        return {'jsonrpc': '2.0', 'id': mid, 'result': r}
    return {'jsonrpc': '2.0', 'id': mid, 'error': {'code': -32601, 'message': 'method not found'}}

class Ctl(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, obj):
        b = json.dumps(obj).encode(); self.send_response(200); self.send_header('Content-Type', 'application/json'); self.send_header('Content-Length', str(len(b))); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        with lock: self._send({'log': S['log'], 'chats': S['chats'], 'communities': S['communities']})
    def do_POST(self):
        a = json.loads(self.rfile.read(int(self.headers.get('Content-Length') or 0)) or b'{}')
        with lock:
            if self.path == '/message':
                mid = a.get('id') or nid('in')
                atts = []
                for i, f in enumerate(a.get('files') or []):
                    raw = base64.b64decode(f['base64']); S['files'][(mid, i)] = {'name': f['name'], 'bytes': raw}
                    atts.append({'id': f'att{i}', 'name': f['name'], 'extension': f['name'].rsplit('.', 1)[-1], 'size': len(raw), 'url': 'https://blossom.example/x', 'key': 'k', 'nonce': 'n', 'path': '', 'img_meta': None, 'downloading': False, 'downloaded': False})
                msg = {'id': mid, 'content': a.get('content', ''), 'replied_to': a.get('replied_to', ''), 'attachments': atts, 'reactions': [], 'at': int(time.time() * 1000), 'pending': False, 'failed': False, 'mine': False}
                if a.get('npub'): msg['npub'] = a['npub']
                if a.get('replied_to_npub'): msg['replied_to_npub'] = a['replied_to_npub']
                if a.get('xdc'):
                    S['xdc'][mid] = {'chat_id': a['chat_id'], 'file': atts[0]['name'] if atts else 'app.xdc', 'topic': 'TOPIC' + mid, 'joined': False, 'frames': []}
                add_history(a['chat_id'], msg)
                S['new'].append({'chat_id': a['chat_id'], 'is_group': bool(a.get('is_group')), **msg})
                self._send({'id': mid})
            elif self.path == '/event':
                S['events'].append(a); self._send({'ok': True})
            elif self.path == '/pending':
                S['pending'].append(a); self._send({'ok': True})
            elif self.path == '/community':
                S['communities'].append(a); self._send({'ok': True})
            elif self.path == '/profile':
                S['profiles'][a['npub']] = a; self._send({'ok': True})
            elif self.path == '/frame':
                app = next((v for v in S['xdc'].values() if v['topic'] == a['topic']), None)
                if app: app['frames'].append({'type': 'data', 'from': a.get('from'), 'verified': True, 'bytes': None, 'text': a['text']})
                self._send({'ok': bool(app)})
            elif self.path == '/reset_log':
                S['log'] = []; self._send({'ok': True})
            else:
                self._send({'error': 'unknown'})

def main():
    port = int(os.environ.get('FAKE_CONTROL_PORT', '8799'))
    socketserver.ThreadingTCPServer.allow_reuse_address = True
    srv = socketserver.ThreadingTCPServer(('127.0.0.1', port), Ctl); srv.daemon_threads = True
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    print(f'Logged in as {ME}', file=sys.stderr, flush=True)
    print('MCP server ready (stdio)', file=sys.stderr, flush=True)
    wl = threading.Lock()
    def work(m):
        r = handle(m)
        if r is not None:
            with wl:
                sys.stdout.write(json.dumps(r) + '\n'); sys.stdout.flush()
    for line in sys.stdin:
        line = line.strip()
        if not line: continue
        try: m = json.loads(line)
        except Exception: continue
        threading.Thread(target=work, args=(m,), daemon=True).start()

if __name__ == '__main__':
    main()
