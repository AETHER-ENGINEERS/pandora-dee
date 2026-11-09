/* =====================================================================
   HTTP — http_request tool (GET/POST/PUT/PATCH/DELETE/HEAD) + secrets.
   Secrets live in Config → Secrets and are written as {{NAME}} in url / headers / body:
   the model never sees the values, they never land in chats or trajectories, and any
   echo of them in a response is redacted.
   ===================================================================== */
const secretsMap = () => (S.secrets && typeof S.secrets === 'object' ? S.secrets : {});
function fillSecrets(s, used) {
  return String(s).replace(/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g, (m, k) => { const v = secretsMap()[k]; if (v == null || v === '') return m; used?.add(k); return v; });
}
function redactSecrets(s) {
  let out = String(s);
  for (const [k, v] of Object.entries(secretsMap())) if (v && String(v).length >= 4) out = out.split(String(v)).join(`{{${k}}}`);
  return out;
}
// ---- where requests may go, and where each secret may go ----
// The local network (this device, the home network, a tailnet) is out of reach unless it's listed: a page she reads can't
// steer a request at the router, another app's keys, or a service on this device. A secret tied to hosts goes only there,
// and stays out of scripts. Redirects aren't followed while a secret is in the request (a key header would go along).
const PRIVATE_NAME = /(^|\.)(localhost|local|lan|home|home\.arpa|internal|intranet|corp|ts\.net)$/i;
function isPrivateHost(host) {
  const h = String(host || '').toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!h) return true;
  const v4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(h);
  if (v4) { const a = +v4[1], b = +v4[2]; return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127); }
  if (h.includes(':')) return h === '::' || h === '::1' || /^f[cd]/.test(h) || /^fe[89ab]/.test(h) || h.startsWith('::ffff:');
  if (!h.includes('.')) return true; // one word ("nas", "router"): a machine on this network
  return PRIVATE_NAME.test(h);
}
const hostList = v => String(v || '').split(/[\s,]+/).map(x => x.trim().toLowerCase()).filter(Boolean);
const hostMatches = (host, pat) => (pat.startsWith('*.') ? host === pat.slice(2) || host.endsWith(pat.slice(1)) : host === pat);
const secretHosts = () => (S.secretHosts && typeof S.secretHosts === 'object' ? S.secretHosts : {});
/** The secrets a script may have as process.env: the ones not tied to hosts (those stay with http_request). */
const scriptSecrets = () => Object.fromEntries(Object.entries(secretsMap()).filter(([k]) => !hostList(secretHosts()[k]).length));
/** Secrets whose values are in this text (filled in here, or already filled in by a playbook). */
const secretsIn = (text, used) => { for (const [k, v] of Object.entries(secretsMap())) if (v && String(v).length >= 4 && String(text).includes(String(v))) used.add(k); return used; };
function checkDestination(url, used) {
  let host;
  try { host = new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, ''); } catch { throw new Error(redactSecrets(`that isn't a usable address: ${url}`)); }
  if (isPrivateHost(host) && !hostList(S.httpLocalHosts).some(p => hostMatches(host, p)))
    throw new Error(redactSecrets(`${host} is on this device or the local network, which http_request doesn't reach unless it's listed under Config → Secrets → "Local addresses".`));
  for (const k of used) {
    const hosts = hostList(secretHosts()[k]);
    if (hosts.length && !hosts.some(p => hostMatches(host, p))) throw new Error(redactSecrets(`{{${k}}} only goes to ${hosts.join(', ')}, not to ${host}.`));
  }
}
const MIME_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'application/pdf': 'pdf', 'application/zip': 'zip', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'video/mp4': 'mp4', 'application/json': 'json', 'text/csv': 'csv', 'text/plain': 'txt', 'text/html': 'html', 'application/octet-stream': 'bin', 'application/x-webxdc': 'xdc' };
const isTextType = ct => /^text\/|json|xml|javascript|ecmascript|x-www-form-urlencoded|yaml|toml|csv|graphql/i.test(ct || '');
let httpCtrl = null;
async function httpRequest(args) {
  const method = String(args.method || 'GET').toUpperCase();
  if (!/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(method)) throw new Error(`unsupported method ${method}`);
  const used = new Set();
  let url = fillSecrets(String(args.url || '').trim(), used);
  if (!/^https?:\/\//i.test(url)) throw new Error('url must start with http:// or https://');
  if (args.query && typeof args.query === 'object') { const u = new URL(url); for (const [k, v] of Object.entries(args.query)) if (v != null) u.searchParams.set(k, fillSecrets(typeof v === 'object' ? JSON.stringify(v) : String(v), used)); url = u.toString(); }
  let headers = {}; let hdrIn = args.headers;
  if (typeof hdrIn === 'string') { try { hdrIn = JSON.parse(hdrIn); } catch { hdrIn = Object.fromEntries(hdrIn.split('\n').map(l => l.split(/:(.*)/s)).filter(x => x[1]).map(([k, v]) => [k.trim(), v.trim()])); } }
  for (const [k, v] of Object.entries(hdrIn || {})) headers[k] = fillSecrets(String(v), used);
  const hasCT = Object.keys(headers).some(k => k.toLowerCase() === 'content-type');
  let body;
  if (args.form && typeof args.form === 'object') { body = new URLSearchParams(Object.entries(args.form).map(([k, v]) => [k, fillSecrets(typeof v === 'object' ? JSON.stringify(v) : String(v), used)])).toString(); if (!hasCT) headers['Content-Type'] = 'application/x-www-form-urlencoded'; }
  else if (args.json !== undefined || (args.body !== undefined && typeof args.body === 'object' && args.body !== null)) { body = fillSecrets(JSON.stringify(args.json !== undefined ? args.json : args.body), used); if (!hasCT) headers['Content-Type'] = 'application/json'; }
  else if (args.body !== undefined && args.body !== null && args.body !== '') { body = fillSecrets(String(args.body), used); if (!hasCT) { const t = String(args.body).trim(); headers['Content-Type'] = /^[\[{]/.test(t) ? 'application/json' : 'text/plain;charset=UTF-8'; } }
  if (body !== undefined && (method === 'GET' || method === 'HEAD')) throw new Error(`${method} requests cannot have a body; use method POST (or put the data in query)`);
  secretsIn(url + '\n' + Object.values(headers).join('\n') + '\n' + (body ?? ''), used);
  checkDestination(url, used);
  const timeout = Math.min(Math.max(1, +args.timeout || 30), 120) * 1000;
  const ctrl = new AbortController(); httpCtrl = ctrl; const t = setTimeout(() => ctrl.abort(new Error('timeout')), timeout);
  const t0 = Date.now(); let r;
  try { r = await fetch(url, { method, headers, body, signal: ctrl.signal, redirect: args.follow_redirects === false || used.size ? 'manual' : 'follow', credentials: 'omit' }); }
  catch (e) {
    const why = ctrl.signal.aborted ? `timed out after ${timeout / 1000}s` : (e.message || String(e));
    throw new Error(`${method} ${redactSecrets(url)} failed: ${why}.${/fetch|network|load failed/i.test(why) ? (window.NetrunnerAndroid ? ' Check the URL and the connection.' : ' In a browser tab this usually means the API does not allow cross-origin requests (CORS); it works in the Android app.') : ''}`);
  } finally { clearTimeout(t); httpCtrl = null; }
  const ms = Date.now() - t0;
  if (r.type === 'opaqueredirect') return redactSecrets(`HTTP redirect · ${method} ${url} · ${ms}ms\n\nIt redirected elsewhere. ${used.size ? `With secrets in the request (${[...used].join(', ')}), redirects aren't followed, since a key could go along to another site.` : 'Redirects weren\'t followed (follow_redirects is off).'} The new address isn't visible from here; ask for it directly if it's where you meant to go.`);
  const ct = r.headers.get('content-type') || '';
  const keepH = ['content-type', 'content-length', 'location', 'retry-after', 'x-request-id', 'etag', 'last-modified', 'link'];
  const hdrLines = []; r.headers.forEach((v, k) => { if (keepH.includes(k) || /ratelimit|rate-limit/i.test(k)) hdrLines.push(`${k}: ${v}`); });
  let head = `HTTP ${r.status}${r.statusText ? ' ' + r.statusText : ''} · ${method} ${redactSecrets(url)} · ${ms}ms${used.size ? ` · secrets used: ${[...used].join(', ')}` : ''}\n${hdrLines.join('\n')}`;
  if (method === 'HEAD') return redactSecrets(head);
  const buf = new Uint8Array(await r.arrayBuffer());
  const mime = ct.split(';')[0].trim().toLowerCase();
  const binary = !isTextType(mime) && (mime || !isText(buf.subarray(0, 4096)));
  let savePath = args.save_to ? vfs.norm(String(args.save_to), '/') : null;
  if (!savePath && binary && buf.length) {
    let name = (() => { try { return decodeURIComponent(new URL(r.url || url).pathname.split('/').pop() || ''); } catch { return ''; } })().replace(/[^\w.\- ]+/g, '_').slice(0, 80);
    const ext = MIME_EXT[mime] || (name.includes('.') ? name.split('.').pop() : 'bin');
    if (!name || !name.includes('.')) name = `download-${Date.now().toString(36)}.${ext}`;
    savePath = `/attachments/http/${new Date().toISOString().slice(0, 10)}/${name}`;
  }
  if (savePath) {
    if (vfs.isDir(savePath)) savePath = vfs.norm(savePath + '/' + (`download-${Date.now().toString(36)}.${MIME_EXT[mime] || 'bin'}`), '/');
    vfs.write(savePath, buf, { mkdirs: true });
    const img = /^image\//.test(mime) || /\.(png|jpe?g|gif|webp|svg)$/i.test(savePath);
    return redactSecrets(`${head}\n\nSaved ${fmtKB(buf.length)}${mime ? ` (${mime})` : ''} to ${savePath}.${img ? ` Show it in a note or reply with ![[${savePath}]].` : ''}${/\.xdc$/i.test(savePath) ? ` Install it with apps action=install path=${savePath}.` : ''}`);
  }
  let text = dec.decode(buf);
  if (/json/.test(mime) || (/^\s*[\[{]/.test(text) && !mime)) { try { text = JSON.stringify(JSON.parse(text), null, 2); } catch {} }
  return redactSecrets(`${head}\n\n${truncateHead(text || '(empty body)')}`);
}
// ---- Config → Secrets ----
function renderSecrets() {
  const box = $('#secretList'); if (!box) return; const sec = secretsMap();
  const hosts = k => hostList(secretHosts()[k]);
  box.innerHTML = Object.keys(sec).length ? Object.keys(sec).sort().map(k => `<div class="secret-row"><code class="text-cy">{{${esc(k)}}}</code><span class="text-dim mono text-xs">${'•'.repeat(Math.min(12, String(sec[k]).length))}</span><button type="button" class="btn" data-secret-hosts="${esc(k)}" title="Which hosts this secret may be sent to">${hosts(k).length ? `only to ${esc(hosts(k).join(', '))}` : 'any host: limit it…'}</button><button type="button" class="btn" data-del-secret="${esc(k)}">Remove</button></div>`).join('') : '<div class="hint">No secrets yet.</div>';
  const local = $('#sHttpLocal'); if (local && document.activeElement !== local) local.value = hostList(S.httpLocalHosts).join(', ');
}
/** Tie a secret to the hosts it may go to ("api.github.com, *.githubusercontent.com"); empty: any host. */
function setSecretHosts(k, text) {
  const list = hostList(text);
  const all = { ...secretHosts() };
  if (list.length) all[k] = list.join(', '); else delete all[k];
  S.secretHosts = all; saveSettings(); renderSecrets();
}
(() => {
  const add = $('#btnSecretAdd'); if (!add) return;
  add.onclick = () => {
    const k = $('#sSecretName').value.trim().replace(/[^A-Za-z0-9_]/g, '_').replace(/^(\d)/, '_$1'), v = $('#sSecretValue').value;
    const h0 = $('#sSecretHosts');
    if (k && !v && h0 && k in secretsMap()) { setSecretHosts(k, h0.value); h0.value = ''; $('#sSecretName').value = ''; return toast(hostList(secretHosts()[k]).length ? `{{${esc(k)}}} only goes to ${esc(secretHosts()[k])} now.` : `{{${esc(k)}}} can go to any host.`, 'ok'); }
    if (!k || !v) return toast('Give the secret a name and a value.', 'err');
    S.secrets = { ...secretsMap(), [k]: v }; saveSettings(); $('#sSecretName').value = ''; $('#sSecretValue').value = '';
    const h = $('#sSecretHosts'); if (h) { setSecretHosts(k, h.value); h.value = ''; }
    renderSecrets(); toast(`Saved. Pandora can use it as {{${esc(k)}}}`, 'ok');
  };
  $('#secretList').onclick = e => {
    const lim = e.target.closest('[data-secret-hosts]');
    // (into the form: its name, its hosts to change; Save with no value changes only the hosts)
    if (lim) { const k = lim.dataset.secretHosts; $('#sSecretName').value = k; $('#sSecretValue').value = ''; const h = $('#sSecretHosts'); if (h) { h.value = hostList(secretHosts()[k]).join(', '); h.focus(); } return; }
    const b = e.target.closest('[data-del-secret]'); if (!b) return; const s = { ...secretsMap() }; delete s[b.dataset.delSecret]; S.secrets = s; setSecretHosts(b.dataset.delSecret, ''); saveSettings(); renderSecrets();
  };
  const local = $('#sHttpLocal'); if (local) local.onchange = () => { S.httpLocalHosts = hostList(local.value).join(', '); saveSettings(); renderSecrets(); };
  renderSecrets();
})();
