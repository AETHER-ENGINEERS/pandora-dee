// The host is her bridge to Vector and Discord. It runs each bridge itself (the Atelier's own pandora-vector and
// pandora-discord programs, started and kept running as the host's children, or reached where they already run) and
// is the only thing that talks to them:
//   - it reads new messages from each bridge all the time, napping or not, into the durable queue (host/queue.cjs),
//     so nothing is lost while she can't answer;
//   - the Atelier reaches the bridge through the host (/bridges/<name>/mcp), with the very same tools it uses today,
//     so its Vector and Discord behaviour stays as it is. The host hands it the messages it may answer now, and checks
//     everything it sends (host/runtime.cjs): switches, provider error text, and the redactor.

'use strict';
const { spawn } = require('node:child_process');

// Bridge tools that only read: always passed through. Anything else could put something in front of people, so it
// goes through the host's checks (an unknown tool counts as one that sends).
const READS = new Set(['get_new_messages', 'get_new_events', 'status', 'list_guilds', 'list_channels', 'list_chats', 'list_communities', 'list_pending_invites',
  'download_attachment', 'archive_query', 'history', 'get_profile', 'load_profile', 'my_npub', 'xdc_read', 'xdc_apps', 'get_messages', 'read_channel', 'search']);
// the arguments of a sending tool that carry words to people
const TEXT_ARGS = ['content', 'text', 'message', 'caption', 'bio', 'about', 'name', 'reason'];

/** A message as the bridge gives it → the queue's shape (the bridge's own object is kept whole in `raw`). */
function normalize(item) {
  const a = item.author;
  return {
    id: item.id ?? item.message_id ?? null,
    chat: item.chat_id ?? item.channel_id ?? item.chat ?? null,
    from: (a && typeof a === 'object' ? (a.name || a.display_name || a.username || a.id) : a) || item.sender_name || item.sender || item.from || null,
    text: String(item.text ?? item.content ?? ''),
    at: item.timestamp ? Date.parse(item.timestamp) || Number(item.timestamp) || null : (item.created_at ? Date.parse(item.created_at) || null : (item.at ?? null)),
    raw: item,
  };
}

/**
 * cfg: { name, url, token, command?, args?, env? }  (url: the bridge's /mcp address; command: how to start it, if the
 * host runs it)
 */
function createBridgeLink(cfg, { log = () => {} } = {}) {
  const name = cfg.name;
  let sid = null, ready = null, child = null, stopping = false, restarts = 0;
  const forClient = []; // messages the Atelier may answer now, handed over on its next get_new_messages

  async function rpc(method, params, notify = false) {
    const body = { jsonrpc: '2.0', method, ...(params ? { params } : {}), ...(notify ? {} : { id: Date.now() + Math.random() }) };
    const r = await fetch(cfg.url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...(cfg.token ? { Authorization: 'Bearer ' + cfg.token } : {}), ...(sid ? { 'Mcp-Session-Id': sid } : {}) }, body: JSON.stringify(body), signal: AbortSignal.timeout(120000) });
    const s = r.headers.get('mcp-session-id'); if (s) sid = s;
    if (notify || r.status === 202) return null;
    const t = await r.text();
    if (!r.ok) throw new Error(`${name} bridge: HTTP ${r.status}`);
    let j; try { j = JSON.parse(/^\s*(event|data):/m.test(t) ? t.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).pop() : t); } catch { throw new Error(`${name} bridge: not an answer`); }
    if (Array.isArray(j)) j = j[0];
    if (j.error) throw new Error(`${name} bridge: ${j.error.message || 'error'}`);
    return j.result;
  }
  function init() {
    if (!ready) ready = (async () => { await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'pandora-dee-host', version: '1' } }); await rpc('notifications/initialized', null, true); })().catch((e) => { ready = null; throw e; });
    return ready;
  }
  async function callTool(tool, args = {}) { await init(); return rpc('tools/call', { name: tool, arguments: args }); }
  const textOf = (res) => (res?.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');

  function startChild() {
    if (!cfg.command || child) return;
    child = spawn(cfg.command, cfg.args || [], { env: { ...process.env, ...(cfg.env || {}) }, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    log('bridge.started', { bridge: name });
    child.stderr.on('data', () => { /* its own log; not kept here */ });
    child.on('exit', (code) => {
      child = null; ready = null; sid = null;
      log('bridge.exited', { bridge: name, code });
      if (!stopping) setTimeout(startChild, Math.min(60000, 1000 * 2 ** Math.min(6, restarts++)));
    });
  }

  return {
    name, forClient, READS, TEXT_ARGS,
    start() { stopping = false; startChild(); return this; },
    stop() { stopping = true; if (child) child.kill(); child = null; },
    /** New messages since the last read (the bridge forgets them once read: they're the host's to keep now). */
    async poll() {
      const res = await callTool('get_new_messages');
      const t = textOf(res);
      const list = /^\s*\[/.test(t) ? JSON.parse(t) : [];
      return list.map(normalize);
    },
    async send({ chat, text, replyTo }) { return callTool('send_message', { chat_id: String(chat), content: String(text), ...(replyTo != null ? { replied_to: String(replyTo) } : {}) }); },
    callTool,
    async listTools() { await init(); return rpc('tools/list', {}); },
  };
}

module.exports = { createBridgeLink, normalize, READS, TEXT_ARGS };
