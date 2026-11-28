// The Atelier page's bridge to the home host (host/home_host.cjs), loaded before the page's own scripts.
//
// app/modules/vfs_disk.js reads a file the moment something asks for it, so its disk calls are synchronous. Here each
// one is a synchronous request to the host (browsers still allow these on a page's main thread). The calls and their
// answers are exactly the desktop app's (desktop/preload.cjs), so the page runs unchanged on her real files.
//
// It also gives this device's token to the host's own tool server (/mcp) when the page talks to it, so a tool server
// entry for the host needs no token typed in. Nothing else the page fetches gets it.
(function () {
  'use strict';
  var KEY = 'pdhost:token';
  var token = '';
  try { token = localStorage.getItem(KEY) || ''; } catch (e) { token = ''; }
  var page = Math.random().toString(36).slice(2) + Date.now().toString(36);

  function hello() {
    try {
      var x = new XMLHttpRequest();
      x.open('GET', '/host/hello', false);
      if (token) x.setRequestHeader('Authorization', 'Bearer ' + token);
      x.send();
      return JSON.parse(x.responseText);
    } catch (e) { return null; }
  }
  var h = hello();
  if (!h || !h.paired) {
    // not paired (or the pairing was removed): stop here, before the page could start on this browser's own storage
    try { window.stop(); } catch (e) { /* older browsers */ }
    location.replace('/pair');
    throw new Error('This device is not paired with the home host.');
  }

  function call(name) {
    return function () {
      var args = Array.prototype.slice.call(arguments);
      try {
        var x = new XMLHttpRequest();
        x.open('POST', '/host/disk', false);
        x.setRequestHeader('Content-Type', 'text/plain');
        x.setRequestHeader('Authorization', 'Bearer ' + token);
        x.setRequestHeader('X-Page', page);
        x.send(JSON.stringify({ name: name, args: args }));
        if (x.status === 401) return 'ERR:This device is no longer paired with the home host.';
        if (x.status !== 200) return 'ERR:The home host answered ' + x.status + '.';
        return x.responseText;
      } catch (e) {
        return 'ERR:The home host could not be reached (' + (e && e.message ? e.message : e) + ').';
      }
    };
  }
  window.PandoraDesk = {
    app: 'pandora-dee-host',
    host: { version: h.version, device: h.device },
    diskInfo: call('info'), diskScan: call('scan'), diskGet: call('get'), diskPut: call('put'), diskMkdir: call('mkdir'),
    diskDel: call('del'), diskMove: call('move'), diskTouch: call('touch'), diskClear: call('clear'), diskUseShared: call('useShared')
  };

  // ---- her things, one copy for every device (host/state.cjs; the page takes these in app/modules/hoststate.js) ----
  // What stays on this device: which chat is open, a draft, a few view choices, her own API keys and each device's own
  // model addresses (a "localhost" means this device), and the caches the page rebuilds on its own.
  var DEVICE_LS = { lastSession: 1, draft: 1, setTab: 1, noteMode: 1, openDirs: 1, hist: 1, diskHint: 1, jadeLinkVer: 1 };
  var DEVICE_SETTINGS = ['host', 'lcppHost', 'ollayaHost', 'oaiHost', 'engine', 'voiceName', 'voicePitch', 'voiceRate', 'jadeFrame', 'jadeShow',
    'jadeVoice', 'jadeCompact', 'bbUrl', 'ollamaKey', 'groqKey', 'oaiKey', 'lcppKey', 'ollayaKey', 'mcpSecrets'];
  function dbLocal(k) { return k === 'vfs' || k === 'vfs-migrated' || /^vfs-before-folder/.test(k) || /^mpy:/.test(k) || k === 'vaultParse' || k === 'settingsCopy' || k === 'pendingSettings'; }
  var cache = {}, revs = {}, changeFns = [], mergedFns = [], errorFns = [];
  function loadAll() {
    try {
      var x = new XMLHttpRequest();
      x.open('GET', '/host/state', false);
      x.setRequestHeader('Authorization', 'Bearer ' + token);
      x.send();
      if (x.status === 200) { var j = JSON.parse(x.responseText); cache = j.values || {}; return true; }
    } catch (e) { /* an empty start; the host is asked again on the next change */ }
    return false;
  }
  loadAll();
  var same = function (a, b) { try { return JSON.stringify(a) === JSON.stringify(b); } catch (e) { return false; } };
  var chain = Promise.resolve();
  function send(method, path, body) {
    // one at a time, in order: a later write never overtakes an earlier one
    var p = chain.then(function () {
      var b = typeof body === 'function' ? body() : body; // a write's starting point is read as it's sent
      var data = b === undefined ? undefined : JSON.stringify(b);
      return window.fetch(path, { method: method, keepalive: !!data && data.length < 60000, headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json', 'X-Page': page }, body: data })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) { errorFns.forEach(function (f) { try { f(j.error || ('The home host answered ' + r.status + '.')); } catch (e) { /* */ } }); } return j; }); });
    });
    chain = p.catch(function () { errorFns.forEach(function (f) { try { f('The home host could not be reached; that change did not reach it.'); } catch (e) { /* */ } }); });
    return p;
  }
  var enc = encodeURIComponent;
  var state = {
    dbLocal: dbLocal,
    lsGet: function (k, d, local) {
      if (DEVICE_LS[k]) return local.get(k, d);
      if (k === 'settings') {
        var out = {}, sh = cache.settings || {}, mine = local.get('settings', {}) || {};
        for (var a in sh) out[a] = sh[a];
        for (var i = 0; i < DEVICE_SETTINGS.length; i++) if (DEVICE_SETTINGS[i] in mine) out[DEVICE_SETTINGS[i]] = mine[DEVICE_SETTINGS[i]];
        return Object.keys(out).length ? out : d;
      }
      return k in cache ? cache[k] : d;
    },
    lsSet: function (k, v, local) {
      if (DEVICE_LS[k]) return local.set(k, v);
      if (k === 'settings') {
        var dev = {}, sh = {};
        for (var a in v) { if (DEVICE_SETTINGS.indexOf(a) >= 0) dev[a] = v[a]; else sh[a] = v[a]; }
        local.set('settings', dev);
        if (same(sh, cache.settings)) return;
        cache.settings = sh; send('PUT', '/host/state/ls/settings', { value: sh });
        return;
      }
      if (same(v, cache[k])) return;
      cache[k] = v; send('PUT', '/host/state/ls/' + enc(k), { value: v });
    },
    lsStorage: function () { var o = {}; for (var k in cache) if (k !== 'settings') o[k] = cache[k]; return o; },
    dbGet: function (k) {
      return window.fetch('/host/state/db/' + enc(k), { headers: { 'Authorization': 'Bearer ' + token }, cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) { if (!j) return undefined; revs[k] = j.rev; return j.exists ? j.value : undefined; })
        .catch(function () { return undefined; });
    },
    dbSet: function (k, v) {
      // the starting point is the version this value was built from: what this page knew when it asked to save
      var base = revs[k];
      return send('PUT', '/host/state/db/' + enc(k), function () { return { value: v, base: base }; }).then(function (j) {
        if (j && j.rev != null) revs[k] = j.rev;
        if (j && j.merged) mergedFns.forEach(function (f) { try { f(k, j.value); } catch (e) { /* */ } });
      }).catch(function () { /* told through errorFns */ });
    },
    dbDel: function (k) { return send('DELETE', '/host/state/db/' + enc(k)).then(function (j) { if (j && j.rev != null) revs[k] = j.rev; }).catch(function () {}); },
    dbAllShared: function () {
      return window.fetch('/host/state/db?all=1', { headers: { 'Authorization': 'Bearer ' + token }, cache: 'no-store' }).then(function (r) { return r.json(); })
        .then(function (all) { var o = {}; for (var k in all) if (!dbLocal(k)) o[k] = all[k]; return o; });
    },
    runs: {
      put: function (rec) { return send('PUT', '/host/state/runs/' + enc(rec && rec.id), rec); },
      get: function (id) { return window.fetch('/host/state/runs/' + enc(id), { headers: { 'Authorization': 'Bearer ' + token } }).then(function (r) { return r.ok ? r.json() : undefined; }); },
      all: function () { return window.fetch('/host/state/runs', { headers: { 'Authorization': 'Bearer ' + token }, cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : []; }); },
      count: function () { return window.fetch('/host/state/runs?count=1', { headers: { 'Authorization': 'Bearer ' + token } }).then(function (r) { return r.json(); }).then(function (j) { return j.count || 0; }); },
      clear: function () { return send('DELETE', '/host/state/runs'); },
      del: function (id) { return send('DELETE', '/host/state/runs/' + enc(id)); }
    },
    onChange: function (f) { changeFns.push(f); },
    onMerged: function (f) { mergedFns.push(f); },
    onError: function (f) { errorFns.push(f); }
  };
  window.PandoraDesk.state = state;
  // what other devices change, as it happens: this page's cache is refreshed, then the page is told
  function listen() {
    if (removed || !window.fetch) return;
    window.fetch('/host/state/stream', { headers: { 'Authorization': 'Bearer ' + token, 'X-Page': page }, cache: 'no-store' })
      .then(function (r) {
        if (r.status === 401) { removed = true; return; }
        if (!r.ok || !r.body) throw new Error('no stream');
        var rd = r.body.getReader(), dec = new TextDecoder(), buf = '';
        var pump = function () {
          return rd.read().then(function (x) {
            if (x.done) return;
            buf += dec.decode(x.value, { stream: true });
            var lines = buf.split('\n'); buf = lines.pop();
            lines.forEach(function (l) {
              var e; try { e = JSON.parse(l); } catch (er) { return; }
              if (!e || !e.kind || e.page === page) return; // its own writes, or a heartbeat
              if (e.kind === 'ls') loadAll();
              changeFns.forEach(function (f) { try { f(e); } catch (er) { /* */ } });
            });
            return pump();
          });
        };
        return pump();
      })
      .catch(function () { /* reopened below */ })
      .then(function () { if (!removed) setTimeout(listen, 2500); });
  }
  listen();

  // presence: while this page holds the stream open, the host is awake (host/nap.cjs). If it drops (the host restarted,
  // the Wi-Fi blinked), it's reopened; the host's grace period covers the gap. Closing the page closes it.
  var removed = false;
  function presence() {
    if (removed || !window.fetch) return;
    window.fetch('/host/presence/stream', { headers: { 'Authorization': 'Bearer ' + token, 'X-Page': page }, cache: 'no-store' })
      .then(function (r) {
        if (r.status === 401) { removed = true; return; }
        if (!r.ok || !r.body) throw new Error('no stream');
        var rd = r.body.getReader(), dec = new TextDecoder(), buf = '';
        var pump = function () {
          return rd.read().then(function (x) {
            if (x.done) return;
            buf += dec.decode(x.value, { stream: true });
            var lines = buf.split('\n'); buf = lines.pop();
            for (var i = lines.length - 1; i >= 0; i--) { if (lines[i].trim()) { try { waitingBadge(JSON.parse(lines[i])); } catch (e) { /* a partial line */ } break; } }
            return pump();
          });
        };
        return pump();
      })
      .catch(function () { /* reopened below */ })
      .then(function () { if (!removed) setTimeout(presence, 2000); });
  }
  presence();

  // "N messages waiting": what arrived on Vector or Discord while she napped (host/queue.cjs). Nothing is handed to her
  // on its own when the host wakes; the person chooses here: give them to her now (all, or the next five, oldest
  // first), later (they stay, without expiring), or write them to a file in her home to read at her own pace (they
  // stay queued until the person clears them). Drawn in its own shadow root, so the Atelier's styles and this don't mix.
  var badge = null, ui = null, lastState = null, note = '';
  function act(what, body) {
    return window.fetch('/host/waiting/' + what, { method: 'POST', headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); });
  }
  function say(t) { note = t; if (lastState) waitingBadge(lastState); }
  function waitingBadge(st) {
    lastState = st;
    var n = st && st.waiting || 0;
    if (!badge) {
      if (!document.body) { document.addEventListener('DOMContentLoaded', function () { waitingBadge(lastState); }, { once: true }); return; }
      badge = document.createElement('div'); badge.id = 'pd-host-waiting';
      badge.style.cssText = 'position:fixed;top:10px;right:64px;z-index:2147483000';
      ui = badge.attachShadow({ mode: 'open' });
      ui.innerHTML = '<style>' +
        ':host{font:13px/1.4 system-ui,sans-serif;color:#eee}' +
        '.pill{background:#2a1f44;border:1px solid #BD72F3;border-radius:999px;padding:4px 12px;cursor:pointer;color:#eee;font:inherit}' +
        '.panel{position:absolute;right:0;top:34px;width:300px;background:#15111f;border:1px solid #555;border-radius:10px;padding:12px;box-shadow:0 6px 24px #0008}' +
        '.panel[hidden]{display:none}.panel p{margin:0 0 10px}.row{display:flex;flex-wrap:wrap;gap:6px}' +
        'button.a{flex:1 1 45%;background:#241c36;color:#eee;border:1px solid #BD72F3;border-radius:7px;padding:6px 8px;cursor:pointer;font:inherit}' +
        '.note{margin-top:8px;opacity:.85;font-size:12px;word-break:break-word}.warn{color:#ffcf8a}</style>' +
        '<button class="pill" data-act="open"></button>' +
        '<div class="panel" hidden><p class="what"></p><div class="row">' +
        '<button class="a" data-act="deliver">Give them to her now</button><button class="a" data-act="next">The next five</button>' +
        '<button class="a" data-act="later">Later</button><button class="a" data-act="write">Write them to a file</button>' +
        '<button class="a" data-act="clear" hidden>Clear the queue</button></div><div class="note"></div></div>';
      ui.addEventListener('click', function (e) {
        var b = e.target.closest && e.target.closest('[data-act]'); if (!b) return;
        var a = b.getAttribute('data-act'), panel = ui.querySelector('.panel');
        if (a === 'open') { panel.hidden = !panel.hidden; return; }
        if (a === 'later') { act('later').then(function () { panel.hidden = true; say('They stay queued, without expiring.'); }); return; }
        if (a === 'deliver' || a === 'next') {
          say('Handing them to her, oldest first…');
          act('deliver', a === 'next' ? { count: 5 } : {}).then(function (r) { say(r.ok ? r.j.delivered + ' handed to her' + (r.j.left ? '; ' + r.j.left + ' still waiting.' : '.') : (r.j.error || 'That did not work.')); });
          return;
        }
        if (a === 'write') {
          act('write').then(function (r) { if (r.ok && r.j.path) { ui.querySelector('[data-act="clear"]').hidden = false; say('Written to ' + r.j.path + ' in her vault. They are still queued too; clear them when you are sure.'); } else say((r.j && r.j.error) || 'Nothing to write.'); });
          return;
        }
        if (a === 'clear') {
          if (!window.confirm('Remove the waiting messages from the host’s queue? The file just written keeps them.')) return;
          act('clear', { confirm: true }).then(function (r) { say(r.ok ? r.j.cleared + ' cleared from the queue; ' + r.j.file + ' keeps them.' : (r.j.error || 'Not cleared.')); });
        }
      });
      document.body.appendChild(badge);
    }
    badge.style.display = n || note ? '' : 'none';
    ui.querySelector('.pill').textContent = '✉ ' + n + ' message' + (n === 1 ? '' : 's') + ' waiting';
    ui.querySelector('.what').innerHTML = n + ' message' + (n === 1 ? '' : 's') + ' came while she napped. Nothing is handed to her on its own.' + (st.waitingLarge ? ' <span class="warn">That’s a lot. Nothing is trimmed: deciding what to do with them is the person’s call.</span>' : '');
    ui.querySelector('.note').textContent = note;
  }

  // the host's tool server: same address only, with this device's token
  var own = location.origin + '/mcp';
  var f = window.fetch && window.fetch.bind(window);
  if (f) window.fetch = function (input, init) {
    var u = typeof input === 'string' ? input : (input && input.url) || String(input);
    // (and its bridges to Vector and Discord, which the host runs: /bridges/<name>/mcp on the same address)
    if (u === own || u === '/mcp' || u.indexOf(location.origin + '/bridges/') === 0 || u.indexOf('/bridges/') === 0) {
      init = Object.assign({}, init || {});
      var hd = new Headers(init.headers || (typeof input !== 'string' && input.headers) || {});
      hd.set('Authorization', 'Bearer ' + token);
      init.headers = hd;
    }
    return f(input, init);
  };
})();
