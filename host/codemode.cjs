// Her codemode, on the host (parity: her Atelier's codemode, app/modules/mcp.js). A script of hers, in JavaScript, that
// calls her tools: her tool servers' (MCP) codemode and direct tools, and her own built-in tools, each `await
// tools.<name>(args)`. It runs in a process of its own (host/codemode_child.cjs) with Node's permission system on and
// nothing of Node's in its hands; every tool call comes back here, where it is run as her loop runs it, with the same
// checks. Only what it prints, returns or shows reaches her. It stops after its time (60 s, or // @options
// {"timeout": N} on the first line, up to 600 s).
'use strict';
const path = require('node:path');
const { spawn } = require('node:child_process');

const CHILD = path.join(__dirname, 'codemode_child.cjs');
const OUT_MAX = 20000;

/** The timeout a script asks for on its first line, in seconds (60 when it asks for none; 1 to 600). */
function timeoutOf(code) {
  const om = /^\s*\/\/\s*@options\s+(\{.*\})\s*$/.exec(String(code).split('\n')[0] || '');
  if (!om) return 60;
  try { return Math.min(600, Math.max(1, +JSON.parse(om[1]).timeout || 60)); } catch { return 60; }
}

/**
 * Run one script. o: { code, catalog: [{ name, description, inputSchema }], ns: { 'mcp__<server>': {...} }, store: {},
 *   call(name, args) → value (throws to say no), onStore(key, value), saveImage(b64, mime) → vault path,
 *   saveLong(text) → vault path, meta(text)? } → the text she gets back (throws with what went wrong, as her Atelier).
 */
async function runCodemode(o) {
  const code = String(o.code || '');
  if (!code.trim()) throw new Error('codemode needs JavaScript in "code"');
  const timeout = timeoutOf(code);
  let calls = 0;
  const r = await new Promise((resolve) => {
    let child, done = false;
    const finish = (v) => { if (done) return; done = true; clearTimeout(kill); try { child.kill(); } catch { /* gone */ } resolve(v); };
    try {
      child = spawn(process.execPath, ['--permission', '--disallow-code-generation-from-strings', '--max-old-space-size=256', CHILD], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'], windowsHide: true, env: {} });
    } catch (e) { resolve({ err: 'could not start the sandbox', out: [], images: [] }); return; }
    const kill = setTimeout(() => finish({ err: `codemode: script stopped after ${timeout}s (raise it with // @options {"timeout": N})`, out: [], images: [] }), timeout * 1000);
    child.on('error', () => finish({ err: 'could not start the sandbox', out: [], images: [] }));
    child.on('exit', () => finish({ err: 'the sandbox stopped before the script finished', out: [], images: [] }));
    child.on('message', async (m) => {
      if (!m || typeof m !== 'object') return;
      if (m.t === 'done') return finish(m);
      if (m.t === 'store') { try { o.onStore && o.onStore(String(m.key), m.value); } catch { /* kept for the script anyway */ } return; }
      if (m.t !== 'call') return;
      calls++; try { o.meta && o.meta(`${calls} call${calls > 1 ? 's' : ''} · ${m.name}`); } catch { /* only a status */ }
      let reply;
      try { reply = { t: 'ret', id: m.id, ok: true, value: await o.call(String(m.name), m.args && typeof m.args === 'object' ? m.args : {}) }; }
      catch (err) { reply = { t: 'ret', id: m.id, ok: false, error: String((err && err.message) || err) }; }
      if (!done) try { child.send(reply); } catch { /* it has gone */ }
    });
    child.send({ t: 'init', code, catalog: o.catalog || [], ns: o.ns || {}, store: o.store || {} });
  });
  const notes = [];
  for (const [i, im] of (r.images || []).entries()) {
    let where; try { where = await o.saveImage(im.data, im.mimeType); } catch (e) { where = null; }
    notes.push(where ? `[image ${i + 1} saved to ${where}]` : `[image ${i + 1} could not be saved]`);
  }
  let out = [...(r.out || [])].join('\n');
  if (r.ret !== undefined && r.ret !== null) out += (out ? '\n' : '') + (typeof r.ret === 'string' ? r.ret : JSON.stringify(r.ret, null, 1));
  if (notes.length) out += '\n' + notes.join('\n');
  if (r.err) throw new Error((out ? out + '\n' : '') + 'Error: ' + String(r.err).replace(/^(Error:\s*)+/, '').replace(/\n\s+at [\s\S]*$/, ''));
  out = out || '(the script returned nothing: return a value or console.log what you need)';
  if (out.length > OUT_MAX) {
    let p = null; try { p = await o.saveLong(out); } catch { p = null; }
    out = out.slice(0, 12000) + `\n\n…[${out.length - 18000} characters cut${p ? `; full output in ${p}` : ''}]…\n\n` + out.slice(-6000);
  }
  return out;
}

/** Her Atelier's description of codemode, with her servers. */
function codemodeDef(nsLines) {
  return {
    type: 'function',
    function: {
      name: 'codemode',
      description: `Run JavaScript in a sandbox that can call tools, to use MCP servers. Call a tool with \`await tools.<name>(args)\`: MCP tools are named mcp__<server>__<tool> and resolve to {content, structuredContent, isError}; your built-in tools work too and resolve to their text (e.g. await tools.read({path: "Inbox.md"})). Run independent calls together with Promise.all. Find tools with searchTools("words"), describeTool(name) (gives the inputSchema), describeNamespace("mcp__<server>") and ALL_TOOLS. Only console.log output, text(...), the return value and image(block) reach you, so filter and summarise inside the script. store(key, value) / load(key) keep JSON between scripts in this chat. Optional first line: // @options {"timeout": 120}\nMCP servers:\n${nsLines}`,
      parameters: { type: 'object', properties: { code: { type: 'string', description: 'JavaScript (the body of an async function; use await and return)' } }, required: ['code'] },
    },
  };
}

module.exports = { runCodemode, codemodeDef, timeoutOf };
