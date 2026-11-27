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

  // the host's tool server: same address only, with this device's token
  var own = location.origin + '/mcp';
  var f = window.fetch && window.fetch.bind(window);
  if (f) window.fetch = function (input, init) {
    var u = typeof input === 'string' ? input : (input && input.url) || String(input);
    if (u === own || u === '/mcp') {
      init = Object.assign({}, init || {});
      var hd = new Headers(init.headers || (typeof input !== 'string' && input.headers) || {});
      hd.set('Authorization', 'Bearer ' + token);
      init.headers = hd;
    }
    return f(input, init);
  };
})();
