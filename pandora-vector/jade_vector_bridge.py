#!/usr/bin/env python3
"""Jade Vector bridge: runs Vector's vector-agent (an MCP server on stdio) and serves it over HTTP
so Jade Vault (phone or browser) can use it as an MCP server, with a bearer token.

    python3 jade_vector_bridge.py --agent /path/to/vector-agent [--port 8787] [--host 0.0.0.0]

First run creates ~/.jade-vector/ with:
    token   the password Jade Vault sends (Config -> Vector messenger -> Bridge token)
    nsec    the bot's Vector key, if you did not give one (VECTOR_NSEC or --nsec-file)
    data/   vector-agent's account store (chats, keys, history)

Only the Python standard library is used.
"""
import argparse, shlex, ssl, hmac, http.server, json, os, pathlib, secrets, signal, socketserver, subprocess, sys, threading, time

HOME = pathlib.Path(os.environ.get('JADE_VECTOR_HOME', pathlib.Path.home() / '.jade-vector'))
MAX_BODY = 48 * 1024 * 1024
PROTOCOL = '2025-06-18'

def log(*a):
    print(time.strftime('%H:%M:%S'), *a, file=sys.stderr, flush=True)

# ---------- keys ----------
_B32 = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'
def _polymod(values):
    gen = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3]
    chk = 1
    for v in values:
        b = chk >> 25
        chk = (chk & 0x1ffffff) << 5 ^ v
        for i in range(5):
            chk ^= gen[i] if ((b >> i) & 1) else 0
    return chk
def _bech32(hrp, data8):
    acc = bits = 0; data5 = []
    for b in data8:
        acc = (acc << 8) | b; bits += 8
        while bits >= 5:
            bits -= 5; data5.append((acc >> bits) & 31)
    if bits: data5.append((acc << (5 - bits)) & 31)
    hrpx = [ord(c) >> 5 for c in hrp] + [0] + [ord(c) & 31 for c in hrp]
    pm = _polymod(hrpx + data5 + [0] * 6) ^ 1
    return hrp + '1' + ''.join(_B32[d] for d in data5 + [(pm >> 5 * (5 - i)) & 31 for i in range(6)])
def new_nsec():
    n = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141
    while True:
        k = secrets.token_bytes(32)
        if 0 < int.from_bytes(k, 'big') < n:
            return _bech32('nsec', k)

def read_secret(path, make):
    if path.exists():
        return path.read_text().strip()
    v = make()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(v + '\n')
    os.chmod(path, 0o600)
    return v

# ---------- the agent (stdio MCP) ----------
class Agent:
    def __init__(self, cmd, env):
        self.cmd, self.env = cmd, env
        self.proc = None; self.lock = threading.Lock(); self.wlock = threading.Lock()
        self.waiting = {}; self.seq = 0; self.init_result = None; self.npub = None
        self.ready = threading.Event(); self.stopping = False

    def start(self):
        threading.Thread(target=self._supervise, daemon=True).start()

    def _supervise(self):
        while not self.stopping:
            try:
                self._run_once()
            except Exception as e:
                log('agent error:', e)
            self.ready.clear()
            for slot in list(self.waiting.values()):
                slot['error'] = 'vector-agent restarted'; slot['ev'].set()
            if self.stopping: break
            log('vector-agent stopped; restarting in 3 s')
            time.sleep(3)

    def _run_once(self):
        log('starting', ' '.join(self.cmd))
        self.proc = subprocess.Popen(self.cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=self.env, bufsize=0)
        threading.Thread(target=self._stderr, args=(self.proc,), daemon=True).start()
        reader = threading.Thread(target=self._stdout, args=(self.proc,), daemon=True); reader.start()
        res = self.call('initialize', {'protocolVersion': PROTOCOL, 'capabilities': {}, 'clientInfo': {'name': 'jade-vector-bridge', 'version': '1.0'}}, timeout=180, wait_ready=False)
        self.init_result = res
        self.notify('notifications/initialized')
        try:
            r = self.call('tools/call', {'name': 'my_npub', 'arguments': {}}, timeout=60, wait_ready=False)
            self.npub = ''.join(c.get('text', '') for c in r.get('content', [])).strip() or None
        except Exception as e:
            log('could not read the npub yet:', e)
        self.ready.set()
        log('ready' + (f' as {self.npub}' if self.npub else ''))
        self.proc.wait()

    def _stderr(self, p):
        for line in iter(p.stderr.readline, b''):
            s = line.decode('utf-8', 'replace').rstrip()
            if s: log('[agent]', s)

    def _stdout(self, p):
        for line in iter(p.stdout.readline, b''):
            line = line.strip()
            if not line: continue
            try: msg = json.loads(line)
            except Exception:
                log('[agent stdout]', line[:200]); continue
            for m in (msg if isinstance(msg, list) else [msg]):
                if 'id' in m and ('result' in m or 'error' in m):
                    slot = self.waiting.get(m['id'])
                    if slot: slot['msg'] = m; slot['ev'].set()
                elif m.get('method') == 'ping' and 'id' in m:
                    self._write({'jsonrpc': '2.0', 'id': m['id'], 'result': {}})
                elif 'id' in m and m.get('method'):
                    self._write({'jsonrpc': '2.0', 'id': m['id'], 'error': {'code': -32601, 'message': 'not supported'}})

    def _write(self, obj):
        data = (json.dumps(obj, ensure_ascii=False) + '\n').encode()
        if not self.proc or self.proc.poll() is not None:
            raise RuntimeError('process not running')
        with self.wlock:
            self.proc.stdin.write(data); self.proc.stdin.flush()

    def notify(self, method, params=None):
        self._write({'jsonrpc': '2.0', 'method': method, **({'params': params} if params is not None else {})})

    def call_raw(self, method, params, timeout=120, wait_ready=True):
        if wait_ready and not self.ready.wait(timeout=60):
            return {'error': {'code': -32000, 'message': 'vector-agent is not ready (still starting, or it crashed: see the bridge log)'}}
        with self.lock:
            self.seq += 1; iid = f'b{self.seq}'
        slot = {'ev': threading.Event(), 'msg': None, 'error': None}
        self.waiting[iid] = slot
        try:
            try:
                self._write({'jsonrpc': '2.0', 'id': iid, 'method': method, **({'params': params} if params is not None else {})})
            except Exception as e:
                return {'error': {'code': -32003, 'message': f'vector-agent is not running ({e})'}}
            if not slot['ev'].wait(timeout):
                return {'error': {'code': -32001, 'message': f'vector-agent did not answer {method} within {timeout} s'}}
            if slot['error']:
                return {'error': {'code': -32002, 'message': slot['error']}}
            return slot['msg']
        finally:
            self.waiting.pop(iid, None)

    def call(self, method, params, timeout=120, wait_ready=True):
        m = self.call_raw(method, params, timeout, wait_ready)
        if 'error' in m: raise RuntimeError(m['error'].get('message'))
        return m.get('result')

# ---------- HTTP ----------
def make_handler(agent, token, origin):
    class H(http.server.BaseHTTPRequestHandler):
        protocol_version = 'HTTP/1.1'
        server_version = 'JadeVectorBridge/1.0'
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
            self.send_response(code); self._cors()
            if obj is not None: self.send_header('Content-Type', 'application/json')
            for k, v in (extra or {}).items(): self.send_header(k, v)
            self.send_header('Content-Length', str(len(body))); self.end_headers()
            if body: self.wfile.write(body)
        def _authed(self):
            got = self.headers.get('Authorization', '')
            ok = got.startswith('Bearer ') and hmac.compare_digest(got[7:].strip().encode(), token.encode())
            if not ok:
                time.sleep(0.5)
                self._send(401, {'error': 'missing or wrong bridge token'})
            return ok
        def do_OPTIONS(self):
            self._send(204)
        def do_GET(self):
            if self.path.split('?')[0] in ('/', '/health'):
                if not self._authed(): return
                return self._send(200, {'ok': True, 'agent': agent.ready.is_set(), 'npub': agent.npub})
            if self.path.split('?')[0] == '/mcp':
                return self._send(405, {'error': 'use POST'}, {'Allow': 'POST, DELETE'})
            self._send(404, {'error': 'not found'})
        def _drain(self):
            n = int(self.headers.get('Content-Length') or 0)
            if 0 < n <= MAX_BODY: self.rfile.read(n)
            elif n > MAX_BODY: self.close_connection = True
        def do_DELETE(self):
            self._drain()
            if not self._authed(): return
            self._send(200, {})
        def do_POST(self):
            n = int(self.headers.get('Content-Length') or 0)
            if n > MAX_BODY:
                self.close_connection = True
                return self._send(413, {'error': 'request too large'})
            if self.path.split('?')[0] != '/mcp' or not self.headers.get('Authorization', '').startswith('Bearer ') or not hmac.compare_digest(self.headers.get('Authorization', '')[7:].strip().encode(), token.encode()):
                if n: self.rfile.read(n)
                if self.path.split('?')[0] != '/mcp': return self._send(404, {'error': 'not found'})
                time.sleep(0.5)   # slows down guessing; the token itself is 192 random bits
                return self._send(401, {'error': 'missing or wrong bridge token'})
            try:
                req = json.loads(self.rfile.read(n) or b'null')
            except Exception:
                return self._send(400, {'jsonrpc': '2.0', 'id': None, 'error': {'code': -32700, 'message': 'parse error'}})
            batch = req if isinstance(req, list) else [req]
            out = []
            for m in batch:
                if not isinstance(m, dict): continue
                method, mid = m.get('method'), m.get('id')
                if mid is None:
                    if method and method != 'notifications/initialized':
                        try: agent.notify(method, m.get('params'))
                        except Exception: pass
                    continue
                if method == 'initialize':
                    res = dict(agent.init_result or {'protocolVersion': PROTOCOL, 'capabilities': {'tools': {}}, 'serverInfo': {'name': 'vector-agent'}})
                    res['instructions'] = ((res.get('instructions') or '') + ' Served by the Jade Vector bridge.').strip()
                    out.append({'jsonrpc': '2.0', 'id': mid, 'result': res}); continue
                if method == 'ping':
                    out.append({'jsonrpc': '2.0', 'id': mid, 'result': {}}); continue
                params = m.get('params')
                timeout = 150
                if method == 'tools/call':
                    a = (params or {}).get('arguments') or {}
                    timeout = 60 + min(30, int(a.get('wait_ms') or 0) // 1000) + (120 if (params or {}).get('name') in ('send_file_bytes', 'download_attachment', 'sync_dms', 'sync_communities', 'join_community') else 0)
                r = agent.call_raw(method, params, timeout=timeout)
                r = dict(r); r['id'] = mid; r['jsonrpc'] = '2.0'
                out.append(r)
            if not out:
                return self._send(202)
            self._send(200, out if isinstance(req, list) else out[0], {'Mcp-Session-Id': 'jade-vector'})
    return H

class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True

def main():
    ap = argparse.ArgumentParser(description='Serve Vector\'s vector-agent to Jade Vault over HTTP.')
    ap.add_argument('--agent', default=os.environ.get('VECTOR_AGENT', 'vector-agent'), help='path to the vector-agent binary (or a full command line)')
    ap.add_argument('--host', default=os.environ.get('JADE_VECTOR_HOST', '0.0.0.0'))
    ap.add_argument('--port', type=int, default=int(os.environ.get('JADE_VECTOR_PORT', '8787')))
    ap.add_argument('--nsec-file', default=None, help='file holding the bot\'s nsec (default ~/.jade-vector/nsec, created if missing)')
    ap.add_argument('--allow-origin', default='*', help='CORS origin for browser use (default *)')
    ap.add_argument('--tls-cert', default=os.environ.get('JADE_VECTOR_TLS_CERT'), help='serve HTTPS with this certificate (PEM); use with --tls-key')
    ap.add_argument('--tls-key', default=os.environ.get('JADE_VECTOR_TLS_KEY'), help='private key (PEM) for --tls-cert')
    ap.add_argument('--print-token', action='store_true', help='print the bridge token and exit')
    ap.add_argument('--new-token', action='store_true', help='make a new bridge token (the old one stops working)')
    args = ap.parse_args()

    HOME.mkdir(parents=True, exist_ok=True)
    try: os.chmod(HOME, 0o700)
    except OSError: pass
    tok_path = HOME / 'token'
    if args.new_token and tok_path.exists(): tok_path.unlink()
    token = read_secret(tok_path, lambda: secrets.token_urlsafe(24))
    if args.print_token:
        print(token); return
    env = dict(os.environ)
    if not env.get('VECTOR_NSEC'):
        env['VECTOR_NSEC'] = read_secret(pathlib.Path(args.nsec_file) if args.nsec_file else HOME / 'nsec', new_nsec)
    env.setdefault('VECTOR_DATA_DIR', str(HOME / 'data'))
    env.setdefault('VECTOR_LOG', 'warn')
    pathlib.Path(env['VECTOR_DATA_DIR']).mkdir(parents=True, exist_ok=True)

    agent = Agent(shlex.split(args.agent), env); agent.start()
    srv = Server((args.host, args.port), make_handler(agent, token, args.allow_origin))
    scheme = 'http'
    if args.tls_cert:
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER); ctx.minimum_version = ssl.TLSVersion.TLSv1_2
        ctx.load_cert_chain(args.tls_cert, args.tls_key)
        srv.socket = ctx.wrap_socket(srv.socket, server_side=True); scheme = 'https'
    elif args.host not in ('127.0.0.1', 'localhost', '::1'):
        log('note: plain HTTP. Keep the bridge on a trusted network (home Wi-Fi, Tailscale/WireGuard) or add --tls-cert/--tls-key.')
    log(f'Jade Vector bridge on {scheme}://{args.host}:{args.port}/mcp')
    log(f'Bridge token: {token}   (Jade Vault -> Config -> Vector messenger)')
    def stop(*_):
        agent.stopping = True
        try: agent.proc and agent.proc.terminate()
        except Exception: pass
        threading.Thread(target=srv.shutdown, daemon=True).start()
    signal.signal(signal.SIGINT, stop); signal.signal(signal.SIGTERM, stop)
    srv.serve_forever()

if __name__ == '__main__':
    main()
