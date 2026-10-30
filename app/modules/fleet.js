/* =====================================================================
   JADE FLEET — this page as one terminal of a fleet (only in the Fleet build: dist/jade-fleet.html and the
   Pandora Fleet APK). The vault, the shell and the models live on the fleet's broker (jade-fleet, on the OptiPlex):
   - the vault is the broker's shared folder: same contract as the phone's vault folder (FleetDisk below stands in
     for NetrunnerAndroid.disk*), notes fetched in bulk at start, changes from other phones pushed live;
   - shell commands, `bash`, python3 and node run as real processes on the broker; the terminal is a real
     pseudo-terminal there when xterm is available, line by line otherwise;
   - models: chat (llama-server), embeddings (Ollama), decisions (Ollaya or Ollama) and vision all go through the
     broker to the Xavier; every request to the broker carries the fleet token;
   - extra tools: vault_search (meaning-based search over the whole fleet's notes and memories) and vision
     (YOLO / MobileNet on the Xavier's DLA cores).
   Phone tools (TTS, screen, Sentry, alarms …) stay on the phone.
   ===================================================================== */
const FLEET = (() => {
  const LS = 'jadeFleet';
  const read = () => { try { return JSON.parse(localStorage.getItem(LS) || 'null'); } catch { return null; } };
  // the broker serves this page over plain http at its own address; a copy on an https host (GitHub Pages) is not the broker
  const served = location.protocol === 'http:' && !/\.html$/.test(location.pathname);
  const cfg = Object.assign({ url: served ? location.origin : '', token: '', device: '' }, read() || {});
  if (!cfg.device) cfg.device = (window.NetrunnerAndroid ? 'phone-' : 'browser-') + Math.random().toString(36).slice(2, 6);
  cfg.url = String(cfg.url || '').replace(/\/+$/, '');
  const F = { cfg, on: !!(cfg.url && cfg.token), online: false, peers: new Set(), pty: { live: false, dead: false, ws: null } };
  F.save = c => { try { localStorage.setItem(LS, JSON.stringify(c)); } catch {} };
  F.save(cfg);
  const H = () => ({ Authorization: 'Bearer ' + cfg.token, 'X-Pandora-Device': cfg.device });
  const wsUrl = (path, q = {}) => cfg.url.replace(/^http/, 'ws') + path + '?' + new URLSearchParams({ ...q, token: cfg.token, device: cfg.device });
  F.isFleetUrl = u => F.on && typeof u === 'string' && (u === cfg.url || u.startsWith(cfg.url + '/'));
  const u8b64 = u => { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
  const b64u8 = b => { const s = atob(b); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; };

  // ---------------------------------------------------------------- the vault (synchronous, like the native bridge)
  // XMLHttpRequest in synchronous mode: the vault code expects answers straight away, as from the phone's own storage.
  // On a LAN this takes a few milliseconds; notes are fetched in bulk at start (prefetch) so most reads never wait.
  function xs(method, path, body, binary) {
    const r = new XMLHttpRequest(); r.open(method, cfg.url + path, false);
    const h = H(); for (const k in h) r.setRequestHeader(k, h[k]);
    if (binary) r.overrideMimeType('text/plain; charset=x-user-defined');
    if (body != null && !(body instanceof Uint8Array)) { r.setRequestHeader('Content-Type', 'application/json'); body = JSON.stringify(body); }
    r.send(body == null ? null : body);
    return r;
  }
  const errOf = r => { try { return JSON.parse(r.responseText).error || ('HTTP ' + r.status); } catch { return 'HTTP ' + r.status; } };
  const call = (fn) => { if (!F.on) return 'ERR:not connected to a fleet'; try { return fn(); } catch (e) { return 'ERR:could not reach the fleet at ' + cfg.url + ' (' + (e.message || e) + ')'; } };
  const q = o => '?' + new URLSearchParams(o);
  const op = (o) => call(() => { const r = xs('POST', '/v1/vault/op', o); if (r.status !== 200) return 'ERR:' + errOf(r); const j = JSON.parse(r.responseText); return j.mtime != null ? 'ok:' + j.mtime : 'ok'; });
  window.FleetDisk = {
    diskInfo: () => call(() => { const r = xs('GET', '/v1/vault/info'); return r.status === 200 ? r.responseText : 'ERR:' + errOf(r); }),
    diskScan: () => call(() => { const r = xs('GET', '/v1/vault/scan'); return r.status === 200 ? r.responseText : 'ERR:' + errOf(r); }),
    diskGet: (p, off, len) => call(() => {
      const r = xs('GET', '/v1/vault/file' + q({ path: p, off, len }), null, true);
      if (r.status !== 200) return 'ERR:' + errOf(r);
      const t = r.responseText; const u = new Uint8Array(t.length); for (let i = 0; i < t.length; i++) u[i] = t.charCodeAt(i) & 0xff;
      return u8b64(u);
    }),
    diskPut: (p, b64, first, last) => call(() => { const r = xs('PUT', '/v1/vault/file' + q({ path: p, first: first ? 1 : 0, last: last ? 1 : 0 }), b64u8(b64)); return r.status === 200 ? 'ok:' + (JSON.parse(r.responseText).mtime || 0) : 'ERR:' + errOf(r); }),
    diskMkdir: p => op({ op: 'mkdir', path: p }),
    diskDel: p => op({ op: 'delete', path: p }),
    diskMove: (a, b) => op({ op: 'move', path: a, to: b }),
    diskTouch: (p, t) => op({ op: 'touch', path: p, mtime: t }),
    diskClear: () => op({ op: 'clear' }),
  };

  // notes and other small text files, in a few bulk requests, so building the index does not ask for them one by one
  F.prefetch = async (v) => {
    if (!F.on) return 0;
    const want = []; let total = 0;
    for (const [p, n] of v.nodes) if (n && !n.dir && n.size != null && n.size < 524288 && !n._d && /\.(md|markdown|txt|json|canvas|csv|ya?ml|css|js|py|html?)$/i.test(p)) { if (total + n.size > 32e6) break; total += n.size; want.push(p); }
    let got = 0;
    for (let i = 0; i < want.length; i += 400) {
      try {
        const r = await fetch(cfg.url + '/v1/vault/read_many', { method: 'POST', headers: { ...H(), 'Content-Type': 'application/json' }, body: JSON.stringify({ paths: want.slice(i, i + 400) }) });
        const j = await r.json();
        for (const [p, b] of Object.entries(j.files || {})) { const n = v.nodes.get(p); if (n && !n.dir && !n._d) { const u = b64u8(b); if (u.length === n.size) { n._d = u; LRU.add(n); got++; } } }
      } catch (e) { console.warn('fleet: prefetch', e.message); break; }
    }
    return got;
  };

  // ---------------------------------------------------------------- live changes from the other phones
  let soonT = 0;
  const rescanSoon = () => { clearTimeout(soonT); soonT = setTimeout(() => { try { if (vfs.ops?.length) return rescanSoon(); vfs.rescan(true); } catch (e) { console.warn('fleet: rescan', e.message); } }, 250); };
  F.listen = () => {
    if (!F.on) return;
    let delay = 1000, first = true;
    const go = () => {
      let ws; try { ws = new WebSocket(wsUrl('/v1/events')); } catch { return setTimeout(go, delay); }
      ws.onopen = () => { delay = 1000; F.online = true; if (!first) rescanSoon(); first = false; F.chip(); };
      ws.onmessage = (e) => {
        let m; try { m = JSON.parse(e.data); } catch { return; }
        if (m.type === 'changed') { if ((m.paths || []).some(p => (m.by || {})[p] !== cfg.device)) rescanSoon(); }
        else if (m.type === 'resync') rescanSoon();
        else if (m.type === 'hello') F.peers = new Set(m.online || []);
        else if (m.type === 'device') { if (m.online) F.peers.add(m.device); else F.peers.delete(m.device); }
        F.chip();
      };
      ws.onclose = () => { F.online = false; F.chip(); setTimeout(go, delay); delay = Math.min(delay * 2, 30000); };
    };
    go();
  };

  // ---------------------------------------------------------------- the broker's address and token in every request
  F.installFetch = () => {
    if (!F.on || F._fetch) return;
    const inner = window.fetch; F._fetch = inner;
    window.fetch = function (input, init) {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url;
      if (!F.isFleetUrl(url)) return inner.call(this, input, init);
      if (typeof input === 'string' || input instanceof URL) {
        const h = new Headers(init?.headers || {}); const add = H(); for (const k in add) h.set(k, add[k]);
        return inner.call(this, input, { ...init, headers: h });
      }
      const h = new Headers(input.headers); const add = H(); for (const k in add) h.set(k, add[k]);
      return inner.call(this, new Request(input, { headers: h }), init);
    };
  };
  const api = async (method, path, body, raw) => {
    const r = await fetch(cfg.url + path, { method, headers: { ...H(), ...(raw ? { 'Content-Type': raw } : body != null ? { 'Content-Type': 'application/json' } : {}) }, body: raw ? body : body != null ? JSON.stringify(body) : undefined });
    let j; try { j = await r.json(); } catch { j = { ok: false, error: 'HTTP ' + r.status }; }
    if (!r.ok || j.ok === false) throw new Error(j.error || 'HTTP ' + r.status);
    return j;
  };
  F.api = api;

  // ---------------------------------------------------------------- real shells on the broker
  // Commands that act on this page (open a note, jade/flow/crontab, help …) still run here; everything else runs in
  // bash on the broker, in the shared vault folder, and the shell keeps its working folder between commands.
  const LOCAL = new Set(['open', 'links', 'backlinks', 'tags', 'search', 'today', 'help', 'clear', 'preview', 'mcp', 'jade', 'flow', 'crontab']);
  F.remoteRun = async (sh, src, stdin) => {
    const chunks = []; const emit = (s, err = false) => { if (!s) return; chunks.push({ s, err }); sh.onOutput?.(s, err); };
    const id = 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const script = String(src) + '\n__jv=$?; case "$PWD" in "$JADE_VAULT"|"$JADE_VAULT"/*) printf \'\\036%s\' "${PWD#"$JADE_VAULT"}";; *) printf \'\\036?\';; esac; exit $__jv\n';
    const watch = setInterval(() => { if (sh.aborted) api('POST', '/v1/exec/kill', { id }).catch(() => {}); }, 250);
    let r;
    try { r = await api('POST', '/v1/exec', { cmd: 'bash', script, cwd: sh.cwd || '/', stdin: stdin || '', timeout: (sh.timeoutMs || 600000) / 1000, id }); }
    catch (e) { emit(`sh: the fleet could not run this: ${e.message}\n`, true); sh.lastCode = 127; return { chunks, code: 127 }; }
    finally { clearInterval(watch); }
    let out = r.stdout || ''; const k = out.lastIndexOf('\x1e');
    if (k >= 0) { const pwd = out.slice(k + 1); out = out.slice(0, k); if (pwd !== '?') sh.cwd = pwd ? (pwd.startsWith('/') ? pwd : '/' + pwd) : '/'; }
    emit(out); emit(r.stderr, true);
    if (r.timed_out) emit(`timed out after ${(sh.timeoutMs || 600000) / 1000}s\n`, true);
    if (r.truncated) emit('(output cut at 1 MB)\n', true);
    sh.lastCode = r.code;
    return { chunks, code: r.code };
  };
  F.patchShell = () => {
    if (!F.on || F._shell) return; F._shell = true;
    window.Shell = Shell;   // (tests and scripts)
    const orig = Shell.prototype.run;
    Shell.prototype.run = async function (src, opts = {}) {
      const first = String(src).trim().split(/[\s;|&<>()]/)[0];
      if (!String(src).trim() || LOCAL.has(first)) return orig.call(this, src, opts);
      return F.remoteRun(this, src, opts.stdin || '');
    };
  };

  // the terminal: a real pseudo-terminal on the broker when xterm is here
  F.startPty = () => {
    const t = typeof term !== 'undefined' && term._t; if (!F.on || !t || F.pty.live) return false;
    const ws = new WebSocket(wsUrl('/v1/term', { cmd: 'bash', cols: t.cols, rows: t.rows })); ws.binaryType = 'arraybuffer';
    F.pty = { live: false, dead: false, ws };
    const write = term.write;
    ws.onopen = () => { F.pty.live = true; t.reset(); t.options.disableStdin = false; term.write = () => {}; F.chip(); };
    ws.onmessage = (e) => {
      if (typeof e.data === 'string') { try { const m = JSON.parse(e.data); if (m.type === 'exit') t.write(`\r\n\x1b[2m[shell ended with code ${m.code}]\x1b[0m`); } catch {} return; }
      t.write(new Uint8Array(e.data));
    };
    ws.onclose = () => { const was = F.pty.live; F.pty.live = false; F.pty.dead = true; term.write = write; if (was) t.write('\r\n\x1b[2m[the fleet shell closed: press Enter for a new one]\x1b[0m\r\n'); F.chip(); };
    if (!F._resize) { F._resize = true; t.onResize(({ cols, rows }) => { if (F.pty.live) F.pty.ws.send(JSON.stringify({ type: 'resize', cols, rows })); }); }
    return true;
  };
  F.ptyInput = (d) => {   // keys typed in the terminal; true when handled here
    if (F.pty.live) { F.pty.ws.send(new TextEncoder().encode(d)); return true; }
    if (F.pty.dead && d === '\r') { F.startPty(); return true; }
    return false;
  };
  F.ptyLine = (line) => {  // a line from the input bar (phones)
    if (F.pty.live) { F.pty.ws.send(new TextEncoder().encode(line + '\r')); return true; }
    if (F.pty.dead) { F.startPty(); setTimeout(() => F.pty.live && F.pty.ws.send(new TextEncoder().encode(line + '\r')), 600); return true; }
    return false;
  };

  // ---------------------------------------------------------------- tools that only the fleet has
  F.toolDefs = [
    { name: 'vault_search', description: 'Search the whole fleet\'s shared vault and long-term memories by meaning (vector search on the fleet server), not just by words. Use it to find notes about a topic even when they use other words, or to recall what any phone saved. Returns the nearest note passages (with their paths) and memories.',
      parameters: { type: 'object', properties: { query: { type: 'string', description: 'What to look for, in plain words' }, k: { type: 'number', description: 'How many results (default 6, max 20)' }, kind: { type: 'string', enum: ['all', 'note', 'memory'], description: 'notes, memories or both (default)' } }, required: ['query'] } },
    { name: 'vision', description: 'Look at an image in the vault with the fleet\'s vision models on the Xavier: detect finds objects (YOLO, 80 everyday kinds such as person, car, dog, cup) with boxes in the image\'s pixels; classify names what the picture shows (MobileNet, 1000 ImageNet classes).',
      parameters: { type: 'object', properties: { action: { type: 'string', enum: ['detect', 'classify'] }, path: { type: 'string', description: 'Image file in the vault (jpg, png, webp, bmp)' }, conf: { type: 'number', description: 'detect: lowest confidence to report (default 0.25)' }, top: { type: 'number', description: 'classify: how many guesses (default 5)' } }, required: ['action', 'path'] } },
  ];
  F.tool = async (name, args, ui) => {
    if (name === 'vault_search') {
      const k = Math.min(20, Math.max(1, +args.k || 6));
      const j = await api('GET', '/v1/search?' + new URLSearchParams({ q: String(args.query || ''), k, kind: args.kind || 'all' }));
      ui?.meta?.(`${j.hits.length} result${j.hits.length === 1 ? '' : 's'}`);
      if (!j.hits.length) return 'Nothing found. (The fleet indexes notes in the background; a note written moments ago may not be searchable yet.)';
      return j.hits.map(h => h.kind === 'note' ? `[note] ${h.source} (distance ${h.distance.toFixed(3)})\n${h.content}` : `[memory · ${h.source}] (distance ${h.distance.toFixed(3)})\n${h.content}`).join('\n\n');
    }
    if (name === 'vision') {
      const action = args.action === 'classify' ? 'classify' : 'detect';
      const p = vfs.norm(String(args.path || ''), '/'); if (!vfs.isFile(p)) throw new Error(`${args.path}: no such image in the vault`);
      const ext = (p.split('.').pop() || '').toLowerCase(); const type = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', bmp: 'image/bmp', gif: 'image/gif' }[ext] || 'image/jpeg';
      const qs = action === 'detect' ? '?' + new URLSearchParams({ conf: String(args.conf ?? 0.25) }) : '?' + new URLSearchParams({ top: String(args.top ?? 5) });
      const j = await api('POST', '/v1/vision/' + action + qs, vfs.readBytes(p), type);
      ui?.meta?.(`${j.device || ''} · ${j.ms?.total ?? '?'} ms`);
      if (action === 'classify') return `${p} (${j.width}×${j.height}), ${j.model} on ${j.device}:\n` + j.top.map(t => `${t.label}: ${(t.prob * 100).toFixed(1)}%`).join('\n');
      if (!j.detections.length) return `${p} (${j.width}×${j.height}): nothing found at confidence ${args.conf ?? 0.25} or more.`;
      return `${p} (${j.width}×${j.height}), ${j.model} on ${j.device}, ${j.detections.length} object${j.detections.length === 1 ? '' : 's'}:\n` + j.detections.map(d => `${d.label} ${(d.confidence * 100).toFixed(0)}% at [${d.box.map(Math.round).join(', ')}]`).join('\n');
    }
    throw new Error('unknown fleet tool ' + name);
  };

  // ---------------------------------------------------------------- first connection: point every model at the broker
  F.preset = async (force) => {
    if (!F.on || (!force && localStorage.getItem(LS + ':preset') === cfg.url)) return;
    const u = cfg.url;
    Object.assign(S, { provider: 'llamacpp', lcppHost: u, lcppKey: '', host: u, ollamaKey: '', embedHost: u, embedKey: '', embedModel: S.embedModel || 'nomic-embed-text',
      ollayaOn: true, ollayaHost: u + '/ollaya', ollayaKey: '', decideProv: 'ollaya', ollayaModel: S.ollayaModel || 'laya', fallbacks: [] });
    try { const j = await (await fetch(u + '/v1/models', { headers: H() })).json(); const m = (j.data || j.models || [])[0]; if (m) S.model = m.id || m.name || S.model; } catch {}
    try { saveSettings(); } catch {}
    localStorage.setItem(LS + ':preset', u);
  };

  // ---------------------------------------------------------------- connect screen and status chip
  const overlay = (msg) => {
    let el = document.getElementById('fleetGate');
    if (!el) { el = document.createElement('div'); el.id = 'fleetGate'; document.body.appendChild(el); }
    el.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(3,9,7,.97);display:flex;align-items:center;justify-content:center;padding:16px;font:14px/1.5 system-ui,sans-serif;color:#dceee7';
    const v = s => String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    el.innerHTML = `<form id="fleetForm" style="width:100%;max-width:420px;border:1px solid #1fe5a5;padding:20px;background:#06100c">
      <div style="font:700 18px ui-monospace,monospace;color:#1fe5a5;letter-spacing:.08em">JADE FLEET</div>
      <p style="margin:8px 0 14px;color:#9fb8ae">${msg ? '<span style="color:#ff8fb1">' + v(msg) + '</span><br>' : ''}Connect this ${window.NetrunnerAndroid ? 'phone' : 'browser'} to your fleet's broker (the OptiPlex). The token is printed by <code style="color:#e9d27a">sudo -u jade jade-fleet token</code>.${location.protocol === 'https:' ? '<br><span style="color:#e9d27a">This page was opened over https, so the browser will block a plain-http broker: open the client from the broker itself instead (http://OPTIPLEX:8765/).</span>' : ''}</p>
      <label style="display:block;font-size:12px;color:#9fb8ae">Broker address</label><input id="fgUrl" value="${v(cfg.url)}" placeholder="http://192.168.1.50:8765" style="width:100%;margin:4px 0 10px;padding:8px;background:#000;border:1px solid #2a3b35;color:#dceee7">
      <label style="display:block;font-size:12px;color:#9fb8ae">Fleet token</label><input id="fgTok" type="password" value="${v(cfg.token)}" style="width:100%;margin:4px 0 10px;padding:8px;background:#000;border:1px solid #2a3b35;color:#dceee7">
      <label style="display:block;font-size:12px;color:#9fb8ae">This device's name</label><input id="fgDev" value="${v(cfg.device)}" style="width:100%;margin:4px 0 14px;padding:8px;background:#000;border:1px solid #2a3b35;color:#dceee7">
      <div style="display:flex;gap:8px;align-items:center"><button style="padding:8px 16px;background:#1fe5a5;color:#000;border:0;font-weight:700">Connect</button>${F.on ? '<button type="button" id="fgRetry" style="padding:8px 16px;background:transparent;color:#1fe5a5;border:1px solid #1fe5a5">Retry</button>' : ''}<span id="fgNote" style="color:#9fb8ae;font-size:12px"></span></div></form>`;
    const note = el.querySelector('#fgNote');
    el.querySelector('#fgRetry')?.addEventListener('click', () => location.reload());
    el.querySelector('#fleetForm').onsubmit = async (e) => {
      e.preventDefault();
      const c = { url: el.querySelector('#fgUrl').value.trim().replace(/\/+$/, ''), token: el.querySelector('#fgTok').value.trim(), device: el.querySelector('#fgDev').value.trim().replace(/[^\w.-]/g, '-').slice(0, 64) || cfg.device };
      if (!/^https?:\/\//.test(c.url)) { note.textContent = 'The address starts with http://'; return; }
      note.textContent = 'Connecting…';
      try {
        const r = await (F._fetch || fetch)(c.url + '/v1/info', { headers: { Authorization: 'Bearer ' + c.token } });
        if (r.status === 401) throw new Error('the token was not accepted');
        if (!r.ok) throw new Error('HTTP ' + r.status);
        F.save(c); note.textContent = 'Connected.'; location.reload();
      } catch (err) { note.textContent = 'Could not connect: ' + err.message; }
    };
    return el;
  };
  F.fail = (msg) => { overlay(F.on ? msg : ''); return new Promise(() => {}); };   // the page waits here until the user reconnects
  F.settings = () => overlay('');
  F.chip = () => {
    let c = document.getElementById('chipFleet');
    if (!c) { const ref = document.getElementById('chipOllaya'); if (!ref) return; c = document.createElement('span'); c.className = 'chip'; c.id = 'chipFleet'; c.style.cursor = 'pointer'; c.onclick = () => F.settings(); c.innerHTML = '<span class="dot" id="dotFleet"></span><span id="txtFleet">FLEET</span>'; ref.parentNode.insertBefore(c, ref); }
    document.getElementById('dotFleet').className = 'dot ' + (F.online ? 'ok' : 'bad');
    const others = [...F.peers].filter(d => d !== cfg.device).length;
    document.getElementById('txtFleet').textContent = 'FLEET ' + (F.online ? (others ? `+${others}` : 'ONLINE') : 'OFFLINE') + (F.pty.live ? ' · SH' : '');
    c.title = `${cfg.device} at ${cfg.url}${others ? ' · also online: ' + [...F.peers].filter(d => d !== cfg.device).join(', ') : ''}`;
  };

  // ---------------------------------------------------------------- at boot (after settings load, before connecting)
  F.boot = async () => {
    if (!F.on) return;
    F.installFetch(); F.patchShell(); await F.preset(); F.listen(); F.chip();
    setTimeout(() => F.startPty(), 300);
  };
  window.FLEET = F;
  return F;
})();
