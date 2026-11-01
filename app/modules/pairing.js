/* =====================================================================
   PAIRING WITH PDA SEASIDE — opened on its own in a browser tab, the app can send requests through a paired
   PDA SEASIDE desktop when a server blocks pages (CORS: many MCP servers, a local Ollama, SearXNG). The pairing
   code (address#token) is made on the desktop (Settings → Classic) and pasted here; the desktop can remove it.
   Only what can't be sent twice goes again: reading (GET/HEAD), or a request the browser had to ask the server
   about first (keys, JSON, other methods), whose refusal means it never left. A plain "simple" POST may already
   have arrived, so it gets an error instead.
   Not used in the Android app (its native network has no CORS) or inside the desktop (it relays everything).
   ===================================================================== */
const SEAS = (() => {
  const insideDesktop = () => { try { return !!(window.parent && window.parent !== window && window.parent.__pddRelay); } catch { return false; } };
  const pair = () => { const p = S.seasidePair; return p && p.address && p.token ? p : null; };
  const relayed = new Set();
  const SIMPLE_HEADERS = new Set(['accept', 'accept-language', 'content-language', 'content-type']);
  const SIMPLE_TYPES = /^(application\/x-www-form-urlencoded|multipart\/form-data|text\/plain)(;|$)/i;
  const originOf = u => { try { return new URL(u).origin; } catch { return u; } };

  function safeToResend(method, headers) {
    method = String(method || 'GET').toUpperCase();
    if (method !== 'POST') return true;   // GET/HEAD read; PUT, PATCH, DELETE are always asked about first
    const keys = [...headers.keys()];
    if (keys.some(k => !SIMPLE_HEADERS.has(k.toLowerCase()))) return true;
    const t = headers.get('content-type'); return !!(t && !SIMPLE_TYPES.test(t));
  }

  /** Parse "http://192.168.1.20:15693#pdd_…" into { address, token }. */
  function parseCode(text) {
    const m = /^\s*(https?:\/\/[^\s#]+)#(pdd_[A-Za-z0-9_-]{20,})\s*$/.exec(String(text || ''));
    return m ? { address: m[1].replace(/\/+$/, ''), token: m[2] } : null;
  }

  async function hello(p = pair()) {
    if (!p) throw new Error('not paired');
    const r = await pageFetch(p.address + '/paired/hello', { headers: { Authorization: 'Bearer ' + p.token }, credentials: 'omit' });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `the desktop answered ${r.status}`);
    return j;
  }

  /** Send one request through the paired desktop; answers like fetch(). */
  async function viaDesktop(req) {
    const p = pair(); if (!p) throw new TypeError('Failed to fetch');
    const headers = {}; req.headers.forEach((v, k) => { headers[k] = v; });
    let bodyB64;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const buf = new Uint8Array(await req.clone().arrayBuffer());
      if (buf.length) { let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000)); bodyB64 = btoa(s); }
    }
    const r = await pageFetch(p.address + '/paired/relay', { method: 'POST', credentials: 'omit', signal: req.signal, headers: { Authorization: 'Bearer ' + p.token, 'Content-Type': 'application/json' }, body: JSON.stringify({ url: req.url, method: req.method, headers, bodyB64 }) });
    const status = Number(r.headers.get('X-Relay-Status') || 0);
    if (!status) { const j = await r.json().catch(() => ({})); throw new TypeError('Failed to fetch (' + (j.error || `the desktop answered ${r.status}`) + ')'); }
    let h = {}; try { h = JSON.parse(decodeURIComponent(r.headers.get('X-Relay-Headers') || '%7B%7D')); } catch {}
    const empty = [101, 204, 205, 304].includes(status) || req.method === 'HEAD';
    return new Response(empty ? null : r.body, { status: status >= 200 && status <= 599 ? status : 502, headers: h });
  }

  // the page's own fetch, before this (and before anything else wraps it)
  const pageFetch = window.fetch.bind(window);
  const native = (typeof NATIVE_NET !== 'undefined' && !!NATIVE_NET) || !!window.NetrunnerAndroid;
  if (!native && !insideDesktop()) {
    window.fetch = async (input, init) => {
      const p = pair();
      let req;
      try { req = new Request(input, init); } catch { return pageFetch(input, init); }
      const u = req.url;
      if (!p || !/^https?:/.test(u) || originOf(u) === location.origin || u.startsWith(p.address + '/')) return pageFetch(input, init);
      const o = originOf(u);
      const mixed = location.protocol === 'https:' && u.startsWith('http:');
      if (S.seasideAlways || relayed.has(o) || mixed) return viaDesktop(req);
      try { return await pageFetch(req.clone()); }
      catch (e) {
        if (req.signal?.aborted) throw e;
        if (!safeToResend(req.method, req.headers)) throw new TypeError(`Failed to fetch (${new URL(u).host} may be blocking pages, and this request may already have arrived, so it wasn't sent again)`);
        if (!relayed.has(o)) { relayed.add(o); try { toast(`${new URL(u).host} blocks pages (CORS): the paired PDA SEASIDE sends its requests now.`, 'info'); } catch {} }
        return viaDesktop(req);
      }
    };
  }
  return { parseCode, hello, viaDesktop, safeToResend, pair, available: !native };
})();

// ---- Config → Connect → Pair with PDA SEASIDE ----
(() => {
  const box = $('#seasPair'); if (!box) return;
  const status = $('#seasStatus');
  const show = () => {
    const p = SEAS.pair();
    $('#seasUnpair').hidden = !p;
    $('#seasAlways').checked = !!S.seasideAlways;
    if (!SEAS.available) status.textContent = 'Not needed here: this app sends requests natively, without browser limits.';
    else if (!p) status.textContent = 'Not paired.';
    else { status.textContent = `Paired with ${p.address}. Checking…`; SEAS.hello().then(j => { status.textContent = `Paired with ${p.address} (“${j.pairing}”). It answers.`; }, e => { status.textContent = `Paired with ${p.address}, but it doesn't answer: ${e.message}.`; }); }
  };
  $('#seasPairBtn').onclick = async () => {
    const p = SEAS.parseCode($('#seasCode').value);
    if (!p) return toast('Paste the whole pairing code from the desktop (Settings → Classic): an address, then #pdd_…', 'err');
    status.textContent = 'Checking…';
    try { const j = await SEAS.hello(p); S.seasidePair = p; saveSettings(); $('#seasCode').value = ''; toast(`Paired with PDA SEASIDE (“${j.pairing}”).`, 'ok'); }
    catch (e) { status.textContent = `The desktop didn't accept it: ${e.message}.${location.protocol === 'https:' && p.address.startsWith('http:') && !/^http:\/\/(localhost|127\.0\.0\.1)/.test(p.address) ? ' This page is https, and browsers block http addresses from https pages: use the desktop\'s https address (Tailscale) or localhost.' : ''}`; return; }
    show();
  };
  $('#seasUnpair').onclick = () => { delete S.seasidePair; saveSettings(); toast('Unpaired. Remove the pairing on the desktop too (Settings → Classic).', 'info'); show(); };
  $('#seasAlways').onchange = e => { S.seasideAlways = e.target.checked; saveSettings(); };
  show();
})();
