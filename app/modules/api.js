/* =====================================================================
   HTTP API (Android app) — GET only, JSON only.
   The native shell (ApiServer.java) listens on a port and calls window.__jadeApi(id, route, params) with the
   query string as an object. We answer through NetrunnerAndroid.apiResult(id, status, jsonText).
     /v1/chat?message=…      runs the message through the normal chat: it shows up in the app and Jade
                             answers there. Also: session=<id>|new, new=1, wait=0, tools=0, json={…}
     /v1/status  /v1/history  /v1/chats
   ===================================================================== */
const API_VERSION = 1, API_MAX_MESSAGE = 20000;
var apiState = null, apiBusy = false;
const apiNative = () => typeof window.NetrunnerAndroid?.apiConfigure === 'function';
const apiTruthy = v => v === true || /^(1|true|yes|on)$/i.test(String(v ?? ''));
function apiGenToken() {
  const b = new Uint8Array(18); (globalThis.crypto || window.crypto).getRandomValues(b);
  return 'jv_' + [...b].map(x => x.toString(16).padStart(2, '0')).join('');
}
// push the saved settings to the native server (on boot and after Save)
function apiApply() {
  if (!apiNative()) return null;
  if (S.apiOn && !S.apiToken) { S.apiToken = apiGenToken(); saveSettings(); }
  try { apiState = JSON.parse(window.NetrunnerAndroid.apiConfigure(!!S.apiOn, +S.apiPort || 8787, !!S.apiLan, S.apiToken || '')); }
  catch (e) { apiState = { enabled: !!S.apiOn, listening: false, error: String(e.message || e), addresses: [] }; }
  try { bgSync(); } catch {}
  return apiState;
}
const apiErr = (status, code, message, extra = {}) => ({ status, body: { ok: false, api: API_VERSION, error: { code, message }, ...extra } });
const apiPreview = (v, n) => { const s = typeof v === 'string' ? v : JSON.stringify(v ?? ''); return s.length > n ? s.slice(0, n) + '…' : s; };
const apiClean = t => String(t || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
const apiSessionInfo = s => ({ id: s.id, title: s.title || '', messages: (s.messages || []).filter(m => m.role === 'user' || m.role === 'assistant').length, updated: s.updated || null });

// JSON can also arrive as ?json={"message":"hi","new":true}; plain query keys win over it
function apiParams(p) {
  let q = {};
  if (p.json !== undefined && p.json !== '') {
    try { q = JSON.parse(p.json); } catch (e) { return { error: apiErr(400, 'bad_json', 'the json parameter is not valid JSON: ' + e.message) }; }
    if (!q || typeof q !== 'object' || Array.isArray(q)) return { error: apiErr(400, 'bad_json', 'the json parameter must be a JSON object') };
  }
  for (const [k, v] of Object.entries(p)) if (k !== 'json' && k !== 'timeout') q[k] = v;
  return { q };
}

async function apiChat(q) {
  const message = String(q.message ?? q.q ?? q.text ?? q.prompt ?? '').trim();
  if (!message) return apiErr(400, 'missing_message', 'send the text in the message parameter, e.g. /v1/chat?message=hello');
  if (message.length > API_MAX_MESSAGE) return apiErr(413, 'message_too_long', `messages are limited to ${API_MAX_MESSAGE} characters`);
  if (message.startsWith('/') && !/^\/skill:/i.test(message)) return apiErr(400, 'slash_command', 'slash commands are not available over the API (only /skill:name)');
  if (running || apiBusy || (typeof compacting !== 'undefined' && compacting)) return apiErr(409, 'busy', 'Jade is already working on something. Try again when she is done (see /v1/status).', { busy: true });
  if (!S.model) return apiErr(503, 'no_model', 'No model is selected in the app (Config → Model provider).');
  apiBusy = true;
  const wait = q.wait === undefined ? true : apiTruthy(q.wait);
  try {
    const want = q.session === undefined ? '' : String(q.session);
    if (want === 'new' || apiTruthy(q.new)) newSession();
    else if (want && want !== cur?.id) {
      if (!sessions.find(x => x.id === want)) { apiBusy = false; return apiErr(404, 'unknown_session', `no chat with id ${want}. List them with /v1/chats`); }
      await openSession(want);
    }
    if (!cur) newSession();
    try { setTab('chat'); } catch {}
    const sess = cur, n0 = sess.messages.length, t0 = Date.now();
    const done = send(message);
    const result = async () => {
      await done;
      const slice = sess.messages.slice(n0);
      if (!slice.some(m => m.role === 'user')) return apiErr(500, 'not_sent', 'the app did not accept the message (is a model selected and reachable?)');
      const asst = slice.filter(m => m.role === 'assistant');
      const finalMsg = [...asst].reverse().find(m => apiClean(m.content) && !m.tool_calls?.length) || [...asst].reverse().find(m => apiClean(m.content));
      const reply = finalMsg ? apiClean(finalMsg.content) : '';
      const agentError = slice.find(m => m._error)?._error || null;
      const calls = asst.flatMap(m => (m.tool_calls || []).map(t => t.function || {}));
      const results = slice.filter(m => m.role === 'tool');
      const out = {
        ok: !(agentError && !reply), api: API_VERSION,
        session: apiSessionInfo(sess), reply, error: agentError ? { code: 'agent_error', message: String(agentError) } : null,
        model: S.model, elapsed_ms: Date.now() - t0,
      };
      if (apiTruthy(q.tools ?? '1')) out.tool_calls = calls.map((f, i) => ({ name: f.name, arguments: JSON.parse(safeArgs(f.arguments)), ok: results[i] ? !results[i]._err : null, result: results[i] ? apiPreview(results[i].content, 300) : null }));
      return { status: out.ok ? 200 : 502, body: out };
    };
    if (!wait) {
      done.catch(() => {}).finally(() => { apiBusy = false; });
      return { status: 202, body: { ok: true, api: API_VERSION, accepted: true, session: apiSessionInfo(sess), message: 'Jade is working on it in the app. Poll /v1/status, then read /v1/history.' } };
    }
    const r = await result(); apiBusy = false; return r;
  } catch (e) { apiBusy = false; return apiErr(500, 'internal', String(e.message || e)); }
}
// tool arguments can hold whole files: keep each string short so the JSON reply stays small
function safeArgs(a) {
  const o = {}; for (const [k, v] of Object.entries(a && typeof a === 'object' ? a : {})) o[k] = typeof v === 'string' && v.length > 200 ? v.slice(0, 200) + '…' : v;
  return JSON.stringify(o);
}

function apiStatus() {
  return { status: 200, body: { ok: true, api: API_VERSION, app: 'jade-vault', version: typeof APP_VERSION !== 'undefined' ? APP_VERSION : undefined, busy: !!(running || apiBusy), model: S.model || null, provider: S.provider || null, session: cur ? apiSessionInfo(cur) : null } };
}
async function apiHistory(q) {
  let s = cur;
  if (q.session && q.session !== cur?.id) {
    if (!sessions.find(x => x.id === q.session)) return apiErr(404, 'unknown_session', `no chat with id ${q.session}. List them with /v1/chats`);
    s = await idb.get('session:' + q.session);
  }
  if (!s) return { status: 200, body: { ok: true, api: API_VERSION, session: null, messages: [] } };
  const limit = Math.max(1, Math.min(200, parseInt(q.limit) || 20));
  const msgs = (s.messages || []).filter(m => (m.role === 'user' || m.role === 'assistant') && apiClean(m.display || m.content))
    .map(m => ({ role: m.role, content: apiClean(m.display || m.content), ts: m.ts || null })).slice(-limit);
  return { status: 200, body: { ok: true, api: API_VERSION, session: apiSessionInfo(s), messages: msgs } };
}
function apiChats() {
  const all = [...sessions]; if (cur?.messages?.length && !all.find(s => s.id === cur.id)) all.push(cur);   // the open chat is saved a moment after it changes
  const list = all.sort((a, b) => (b.updated || 0) - (a.updated || 0)).slice(0, 100).map(s => ({ id: s.id, title: s.title || '', updated: s.updated || null, current: s.id === cur?.id }));
  return { status: 200, body: { ok: true, api: API_VERSION, chats: list } };
}

// rituals over the API: GET /v1/rituals, GET /v1/ritual?name=…&input={json} (Jade Vault's /v1/flows and /v1/flow still answer)
async function apiFlows(key = 'flows') {
  await flowRecordsLoad();
  const list = flowList().map(f => { const last = FlowRuns.recent.find(r => r.path === f._path); return { name: f.name, description: f.description || '', enabled: f.enabled !== false, valid: !f._bad, trigger: f.trigger?.type || 'manual', trigger_text: f._bad ? null : flowTriggerText(f), steps: flowCount(f.steps), last_run: last ? { id: last.id, status: last.status, started: last.started, error: last.error || null } : null }; });
  return { status: 200, body: { ok: true, api: API_VERSION, [key]: list } };
}
async function apiFlowRun(q, word = 'flow') {
  const name = String(q.name ?? q.ritual ?? q.flow ?? '').trim();
  if (!name) return apiErr(400, 'missing_name', `say which ${word}: /v1/${word}?name=Daily%20digest`);
  const f = flowFind(name); if (!f) return apiErr(404, `unknown_${word}`, `no ${word} named "${name}". List them with /v1/${word}s`);
  let input = q.input ?? null;
  if (typeof input === 'string' && /^\s*[\[{"]|^\s*(-?\d|true|false|null)/.test(input)) { try { input = JSON.parse(input); } catch (e) { return apiErr(400, 'bad_input', 'input is not valid JSON: ' + e.message); } }
  const run = await flowRun(f, input, { via: 'api' });
  const body = { ok: run.status === 'ok', api: API_VERSION, run: { id: run.id, ritual: run.flow, flow: run.flow, status: run.status, error: run.error, output: run.output ?? null, elapsed_ms: run.ended - run.started,
    steps: q.steps === '0' ? undefined : run.steps.map(s => ({ name: s.name, type: s.type, status: s.status, ms: s.ms, note: s.note || null, error: s.error || null })) } };
  return { status: run.status === 'ok' ? 200 : 502, body };
}

window.__jadeApi = async (id, route, params) => {
  let r;
  try {
    const pq = apiParams(params || {});
    if (pq.error) r = pq.error;
    else if (route === 'chat') r = await apiChat(pq.q);
    else if (route === 'status') r = apiStatus();
    else if (route === 'history') r = await apiHistory(pq.q);
    else if (route === 'chats') r = apiChats();
    else if (route === 'rituals') r = await apiFlows('rituals');
    else if (route === 'ritual') r = await apiFlowRun(pq.q, 'ritual');
    else if (route === 'flows') r = await apiFlows();
    else if (route === 'flow') r = await apiFlowRun(pq.q);
    else r = apiErr(404, 'not_found', 'unknown endpoint');
  } catch (e) { r = apiErr(500, 'internal', String(e.message || e)); }
  try { window.NetrunnerAndroid.apiResult(id, r.status, JSON.stringify(r.body)); } catch (e) { console.warn('apiResult failed', e); }
};

/* ---------- settings section ---------- */
function apiExampleUrl() { const base = apiState?.addresses?.[apiState.addresses.length - 1] || `http://127.0.0.1:${S.apiPort || 8787}`; return base; }
function renderApiSettings() {
  const native = apiNative();
  $('#apiNative').hidden = !native; $('#apiWeb').hidden = native;
  if (!native) return;
  $('#sApiOn').checked = !!S.apiOn; $('#sApiPort').value = S.apiPort || 8787; $('#sApiLan').checked = !!S.apiLan;
  $('#sApiToken').value = S.apiToken || '';
  try { apiState = JSON.parse(window.NetrunnerAndroid.apiStatus()); } catch {}
  const st = apiState || {};
  $('#apiStatus').innerHTML = !S.apiOn ? '<span class="dot"></span>Off.' : st.listening ? `<span class="dot ok"></span>Listening: ${(st.addresses || []).map(a => `<code>${esc(a)}</code>`).join(' · ')}` : `<span class="dot bad"></span>Not running${st.error ? ': ' + esc(st.error) : '. Save to start it.'}`;
  const tok = S.apiToken || 'YOUR_TOKEN', base = apiExampleUrl();
  $('#apiExample').textContent = `curl -H "Authorization: Bearer ${tok}" \\\n  "${base}/v1/chat?message=Hello%20Jade"`;
}
function apiReadFields() {
  if (!apiNative()) return {};
  const port = Math.max(1024, Math.min(65535, parseInt($('#sApiPort').value) || 8787));
  return { apiOn: $('#sApiOn').checked, apiPort: port, apiLan: $('#sApiLan').checked, apiToken: $('#sApiToken').value.trim() };
}
$('#btnApiToken').onclick = () => { $('#sApiToken').value = apiGenToken(); };
$('#btnApiCopy').onclick = async () => { try { await navigator.clipboard.writeText($('#sApiToken').value); toast('Token copied'); } catch { $('#sApiToken').select(); toast('Select and copy the token', 'err'); } };
$('#btnApiCopyEx').onclick = async () => { try { await navigator.clipboard.writeText($('#apiExample').textContent); toast('Example copied'); } catch { toast('Could not copy', 'err'); } };
