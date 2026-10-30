/* =====================================================================
   RUST CORE
   The parts of the engine where Rust is faster, run in Rust:
   - on the phone (libjade, native): the network (every fetch() to another site), parsing notes for the index and
     searching them on all cores straight from storage, the vault folder, and Sentry's rules;
   - in both variants (WebAssembly, embedded below): turning web pages into Markdown for web_fetch.
   Everything else stays JavaScript: measured, it was as fast or faster than crossing into WebAssembly.
   If the Rust part is missing or fails, the JavaScript versions carry on.
   ===================================================================== */
/*JADE_CORE_GLUE*/
const RustCore = {
  ready: false, w: null, p: null,
  native: (() => { try { const A = window.NetrunnerAndroid; return A && typeof A.vaultParse === 'function' && typeof A.vaultSearch === 'function' ? A : null; } catch { return null; } })(),
  init() {
    return this.p ||= (async () => {
      try {
        if (typeof jadeRustGlue !== 'function' || !document.getElementById('jade-core-wasm')) return;
        await jadeRustGlue({ module_or_path: await gunzipB64('jade-core-wasm') });
        this.w = jadeRustGlue; this.ready = true;
      } catch (e) { console.warn('Rust core (WebAssembly) unavailable:', e?.message || e); }
    })();
  },
  // parse many notes on the phone's cores, straight from storage: [[path, sig]] → {path: {sig, wiki, md, tags, words}}
  parseNative(list) { const r = this.native.vaultParse(JSON.stringify({ paths: list })); if (typeof r === 'string' && r.startsWith('ERR:')) throw new Error(r.slice(4)); return JSON.parse(r); },
  searchNative(req) { const r = this.native.vaultSearch(JSON.stringify(req)); if (typeof r === 'string' && r.startsWith('ERR:')) throw new Error(r.slice(4)); return JSON.parse(r); },
};
setTimeout(() => RustCore.init(), 0);

/* ---- the phone's network, in Rust ----
   On Android the page's fetch() to other sites goes through rust/android/src/net.rs: native threads, many requests at
   once, no CORS (a model server or a web page does not have to allow the app), HTTP/2, gzip. The page polls for what
   has arrived. Requests to the page's own origin, blob: and data: URLs stay in the WebView. Turn it off with
   localStorage 'jadeNativeNet' = 'off'. */
const NATIVE_NET = (() => { try { const A = window.NetrunnerAndroid; return A && typeof A.netStart === 'function' && typeof A.netPoll === 'function' ? A : null; } catch { return null; } })();
const pageFetch = window.fetch.bind(window);
const NET = { live: new Map(), t: 0, n: 0 };
const nb64 = u => { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
const nunb64 = b => { const s = atob(b); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; };
function netOn() { if (!NATIVE_NET || NET.broken) return false; try { return localStorage.getItem('jadeNativeNet') !== 'off'; } catch { return true; } }
function netPump() {
  NET.t = 0; let busy = false;
  for (const [id, h] of [...NET.live]) {
    let p; try { p = JSON.parse(NATIVE_NET.netPoll(id)); } catch (e) { p = { done: true, error: String(e.message || e) }; }
    if (p.head) h.head(p.head);
    if (p.data) { h.data(nunb64(p.data)); busy = true; }
    if (p.done) { NET.live.delete(id); h.end(p.error); }
  }
  // the native side wakes the page when something arrives (window.__netWake); the timer is only a safety net then
  if (NET.live.size) NET.t = setTimeout(netPump, NET.pushed ? 250 : busy ? 4 : 12);
}
window.__netWake = () => { NET.pushed = true; clearTimeout(NET.t); netPump(); };
function nativeEligible(input, init) {
  if (!netOn()) return false;
  let u; try { u = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href); } catch { return false; }
  if (!/^https?:$/.test(u.protocol) || u.origin === location.origin) return false;
  const b = init?.body; if (b && typeof ReadableStream !== 'undefined' && b instanceof ReadableStream) return false;
  return true;
}
async function nativeFetch(input, init = {}) {
  const req = new Request(input instanceof Request ? input.clone() : input, init); const signal = init.signal || req.signal;   // a clone: the WebView may still need the original
  const abortErr = () => new DOMException('The operation was aborted.', 'AbortError');
  if (signal?.aborted) throw abortErr();
  const body = req.method === 'GET' || req.method === 'HEAD' ? null : new Uint8Array(await req.arrayBuffer());
  if (body && body.length > 16 * 1048576) throw Object.assign(new Error('large upload: sent by the WebView'), { notStarted: true });   // base64 through the bridge would double it in memory
  let r; try { r = NATIVE_NET.netStart(JSON.stringify({ method: req.method, url: req.url, headers: [...req.headers], body: body?.length ? nb64(body) : undefined })); }
  catch (e) { NET.broken = String(e?.message || e); throw Object.assign(new Error('native network unavailable: ' + NET.broken), { notStarted: true }); }   // the library did not load
  if (String(r).startsWith('ERR:native')) NET.broken = String(r).slice(4);
  if (String(r).startsWith('ERR:')) throw Object.assign(new TypeError('Failed to fetch (' + String(r).slice(4) + ')'), { notStarted: true });
  const id = +r; NET.n++;
  return new Promise((resolve, reject) => {
    let ctrl = null, gotHead = false, over = false;
    const stream = new ReadableStream({ start(c) { ctrl = c; }, cancel() { over = true; NATIVE_NET.netAbort(id); NET.live.delete(id); } });
    const fail = e => { if (over) return; over = true; if (!gotHead) reject(e); else try { ctrl.error(e); } catch {} };
    NET.live.set(id, {
      head(h) {
        gotHead = true; const hd = new Headers();
        for (const [k, v] of h.headers || []) { try { hd.append(k, v); } catch {} }
        const st = h.status >= 200 && h.status <= 599 ? h.status : 502;
        const res = new Response([101, 204, 205, 304].includes(st) || req.method === 'HEAD' ? null : stream, { status: st, statusText: h.statusText || '', headers: hd });
        try { Object.defineProperty(res, 'url', { value: h.url || req.url }); Object.defineProperty(res, 'redirected', { value: !!h.redirected }); } catch {}
        resolve(res);
      },
      data(u8) { if (!over) try { ctrl.enqueue(u8); } catch {} },
      end(err) { if (err) return fail(new TypeError('Failed to fetch (' + err + ')')); if (!gotHead) return fail(new TypeError('Failed to fetch')); if (!over) { over = true; try { ctrl.close(); } catch {} } }
    });
    signal?.addEventListener('abort', () => { NATIVE_NET.netAbort(id); NET.live.delete(id); fail(abortErr()); }, { once: true });
    if (!NET.t) NET.t = setTimeout(netPump, 0);
  });
}
if (NATIVE_NET) {
  window.fetch = async (input, init) => {
    if (!nativeEligible(input, init)) return pageFetch(input, init);
    try { return await nativeFetch(input, init); }
    catch (e) {   // nothing was sent (the request could not start, or TLS failed): let the WebView try, it has the phone's own certificate store
      if (e?.notStarted || (e?.name !== 'AbortError' && /TLS with|certificate/i.test(e?.message || ''))) { console.warn('native fetch: using the WebView for this request:', e.message); return pageFetch(input, init); }
      throw e;
    }
  };
}
Object.defineProperty(RustCore, 'net', { get: () => netOn() });
RustCore.netReset = () => { NET.broken = null; };   // after a failed load, try the native side again

/* ---- web_fetch: on the phone, fetch the page directly and turn it into Markdown in Rust (no third-party reader) ---- */
if (NATIVE_NET) {
  const readerFetch = webFetch;
  webFetch = async function (url) {
    if (netOn() && /^https?:\/\//.test(String(url))) {
      try {
        const r = await fetch(url, { headers: { Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,application/json;q=0.8,*/*;q=0.5', 'Accept-Language': navigator.language || 'en' } });
        if (r.ok) {
          const ct = r.headers.get('content-type') || '';
          const buf = new Uint8Array(await r.arrayBuffer());
          let cs = /charset=([\w-]+)/i.exec(ct)?.[1];
          if (!cs && /html/i.test(ct)) cs = /<meta[^>]+charset=["']?([\w-]+)/i.exec(new TextDecoder('latin1').decode(buf.subarray(0, 4096)))?.[1];
          let text; try { text = new TextDecoder(cs || 'utf-8').decode(buf); } catch { text = new TextDecoder().decode(buf); }
          if (/html|xml/i.test(ct) || /^\s*<(!doctype|html)/i.test(text)) {
            await RustCore.init();
            if (RustCore.ready) { const j = JSON.parse(RustCore.w.html_markdown(text, r.url || url)); if (j.text.trim().length >= 80) return truncateHead(`# ${j.title || url}\n\n${j.text}`); }
          } else if (/^text\/|json|markdown/i.test(ct)) return truncateHead(text);
        }
      } catch (e) { console.warn('web_fetch: direct fetch failed, using a reader', e.message); }
    }
    return readerFetch(url);
  };
}
