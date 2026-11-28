// Her codemode on the host (host/codemode.cjs, host/codemode_child.cjs, host/loop.cjs): a script of hers that calls her
// tool servers' codemode tools and her own tools together, as in her Atelier (app/modules/mcp.js), in a process of its
// own with nothing of Node's in its hands. Stand-in model and tool server; synthetic homes only.
import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(process.env.JV_WEB), '..');
const { createHomeHost } = require(path.join(ROOT, 'host', 'home_host.cjs'));
const log = []; const fail = [];
const ok = (c, m) => { (c ? log : fail).push((c ? 'PASS ' : 'FAIL ') + m); };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-host-codemode-'));
const HOME = path.join(tmp, 'home');
const w = (vp, t) => { const f = path.join(HOME, ...vp.split('/').filter(Boolean)); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t); };
w('/Pandora/SOUL.md', '# SOUL\n\nI am a made-up stand-in.\n');
w('/Inbox.md', 'buy seeds\n');
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000201a1b2d1a90000000049454e44ae426082', 'hex').toString('base64');

// ---------- a stand-in tool server: a garden, its tools codemode ones (her Atelier's default), one deferred ----------
const tools = http.createServer((req, res) => {
  let b = ''; req.on('data', (d) => { b += d; }); req.on('end', () => {
    const j = JSON.parse(b || '{}');
    if (!('id' in j)) { res.writeHead(202); return res.end(); }
    const reply = (result) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ jsonrpc: '2.0', id: j.id, result })); };
    if (j.method === 'initialize') return reply({ protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'garden' } });
    if (j.method === 'tools/list') return reply({ tools: [
      { name: 'water', description: 'Water a garden bed.', inputSchema: { type: 'object', properties: { bed: { type: 'string' } }, required: ['bed'] } },
      { name: 'snapshot', description: 'A picture of the garden.', inputSchema: { type: 'object', properties: {} } },
      { name: 'almanac', description: 'The planting almanac.', inputSchema: { type: 'object', properties: {} } },
    ] });
    if (j.method === 'tools/call') {
      const n = j.params.name;
      if (n === 'water') return reply({ content: [{ type: 'text', text: `watered the ${j.params.arguments.bed}` }], structuredContent: { litres: 4 } });
      if (n === 'snapshot') return reply({ content: [{ type: 'image', data: PNG, mimeType: 'image/png' }] });
      return reply({ content: [{ type: 'text', text: 'plant beans in spring' }] });
    }
    reply({});
  });
});
await new Promise((r) => tools.listen(0, '127.0.0.1', r));
const mcpJson = (extra = {}) => w('/Pandora/mcp.json', JSON.stringify({ mcpServers: { garden: { url: `http://127.0.0.1:${tools.address().port}/mcp`, description: 'Her garden (test)', toolExposure: { almanac: 'deferred' } } }, ...extra }));
mcpJson();

// ---------- a stand-in model: runs a script when asked, then says what came back ----------
const seen = [];
const SCRIPT = [
  'const [w, inbox] = await Promise.all([tools.mcp__garden__water({ bed: "tomatoes" }), tools.read({ path: "/Inbox.md" })]);',
  'console.log(w.content[0].text, "·", w.structuredContent.litres, "litres");',
  'return "inbox: " + inbox.trim();',
].join('\n');
const model = http.createServer((req, res) => {
  let body = ''; req.on('data', (d) => { body += d; }); req.on('end', () => {
    if (req.url.endsWith('/models')) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ data: [{ id: 'stand-in' }] })); }
    const j = JSON.parse(body || '{}'); seen.push(j); const msgs = j.messages || []; const last = msgs.at(-1) || {};
    const say = (content, tc) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content, ...(tc ? { tool_calls: tc } : {}) } }] })); };
    if (last.role === 'tool') return say(`Done. (${String(last.content).slice(0, 600)})`);
    if (/water the tomatoes/i.test(last.content || '')) return say('', [{ id: 'c1', type: 'function', function: { name: 'codemode', arguments: JSON.stringify({ code: SCRIPT }) } }]);
    return say('Hello.');
  });
});
await new Promise((r) => model.listen(0, '127.0.0.1', r));

const host = createHomeHost({ root: HOME, state: path.join(tmp, 'state'), id: 'fae', name: 'Fae (test)', napGraceMs: 600000 });
const fae = host.resident('fae');
fae.models.set({ brain: 'host', providers: { standin: { kind: 'openai', label: 'Stand-in', base: `http://127.0.0.1:${model.address().port}/v1`, enabled: true } }, roles: { chat: { provider: 'standin', model: 'stand-in' } } }, 'test');
const release = fae.nap.connect({ device: 'test', page: 'test' });
const rt = fae.startRuntime({ brain: 'host', schedulesMs: 3600000 });
const cm = (code, why = 'test:chat-1') => fae.loop().callTool('codemode', { code }, { why });
try {
  // ---------- offered, as in her Atelier ----------
  let r = await rt.turn({ text: 'Please water the tomatoes.' });
  const declared = (seen[0].tools || []).map((t) => t.function.name);
  const def = (seen[0].tools || []).find((t) => t.function.name === 'codemode');
  ok(def && /- mcp__garden \(2 tools\): Her garden \(test\)/.test(def.function.description) && !declared.some((n) => /^mcp__garden__/.test(n)), 'with codemode tools on her tool server, her loop offers codemode (her servers listed), and the tools themselves are for scripts');
  const page = fs.readFileSync(path.join(ROOT, 'app', 'modules', 'mcp.js'), 'utf8');
  const lead = def ? def.function.description.split('\nMCP servers:')[0] : '@';
  ok(page.replace(/\\`/g, '`').includes(lead), 'its description is her Atelier\'s own, word for word');
  ok(/watered the tomatoes · 4 litres/.test(r) && /inbox: buy seeds/.test(r), 'a script calls a tool server\'s tool and one of her own together, and only what it prints and returns comes back');

  // ---------- her helpers ----------
  r = await cm('return { all: ALL_TOOLS.includes("mcp__garden__water") && ALL_TOOLS.includes("read") && !ALL_TOOLS.includes("codemode") && !ALL_TOOLS.includes("tool_search"), found: searchTools("water garden")[0].name, schema: describeTool("mcp__garden__water").inputSchema.required[0], ns: describeNamespace("mcp__garden").tools.length };');
  const h = JSON.parse(r);
  ok(h.all && h.found === 'mcp__garden__water' && h.schema === 'bed' && h.ns === 2, 'ALL_TOOLS, searchTools, describeTool and describeNamespace answer as in her Atelier');
  r = await cm('const pic = await tools.mcp__garden__snapshot({}); image(pic.content[0]); return "looked";');
  const imgAt = (/\[image 1 saved to (\/attachments\/mcp\/[^\]]+\.png)\]/.exec(r) || [])[1];
  ok(imgAt && fs.readFileSync(path.join(HOME, ...imgAt.split('/').filter(Boolean))).subarray(1, 4).toString() === 'PNG', 'an image she shows is kept in her vault, under /attachments/mcp, as her Atelier keeps it');
  await cm('store("beds", ["tomatoes", "beans"]); return "kept";');
  r = await cm('return load("beds");');
  const other = await cm('return String(load("beds"));', 'test:chat-2');
  ok(/beans/.test(r) && other === 'undefined', 'store and load keep things between scripts in the same chat, and not in another');
  r = await cm('console.log("x".repeat(25000));');
  const longAt = (/full output in (\/tmp\/codemode-[a-z0-9]+\.txt)/.exec(r) || [])[1];
  ok(longAt && r.length < 20000 && fs.readFileSync(path.join(HOME, ...longAt.split('/').filter(Boolean)), 'utf8').length === 25000, 'output too long to hand back is cut, and the whole of it kept in her vault');
  ok(/returned nothing/.test(await cm('const a = 1;')), 'a script that gives nothing back says so');

  // ---------- what it can't do ----------
  r = await cm('return await tools.mcp__garden__almanac({});');
  ok(/is a deferred tool: load it with tool_search instead of codemode/.test(r), 'a deferred tool is found with tool_search, not called from a script, as in her Atelier');
  r = await cm('return await tools.mcp__garden__weed({});');
  ok(/no tool named mcp__garden__weed\. Tools on that server: mcp__garden__water/.test(r), 'a tool that isn\'t there says which ones are');
  r = await cm('const a = 1;\nconst b = ;');
  ok(/^Not done: Error: SyntaxError: .*\(line 2\)$/s.test(r), 'a script that doesn\'t parse says so, with its line');
  r = await cm('console.log("before");\nthrow new Error("the hose is kinked");');
  ok(/before\nError: the hose is kinked$/.test(r) && !/\n\s+at /.test(r), 'an error in a script comes back with what it printed first, without a stack');
  const t0 = Date.now();
  r = await cm('// @options {"timeout": 1}\nwhile (true) {}');
  ok(/script stopped after 1s/.test(r) && Date.now() - t0 < 6000, 'a script that never ends is stopped at its time');
  r = await cm('let esc = "none"; try { esc = typeof tools.constructor.constructor("return process")(); } catch (e) { esc = "refused"; } let imp = "none"; try { await import("node:fs"); imp = "loaded"; } catch { imp = "refused"; } return [typeof require, typeof process, typeof fetch, typeof setTimeout, typeof globalThis.Buffer, esc, imp].join(",");');
  ok(/^undefined,undefined,undefined,undefined,undefined,(undefined|refused),refused$/.test(r), 'nothing of Node\'s is in a script\'s hands: no require, process, fetch, timers or modules, and no way round to them');
  r = await cm('return await tools.read({ path: "/../outside.txt" });');
  ok(/leaves your vault/.test(r), 'her own tools, called from a script, keep their own checks');

  // ---------- her switch ----------
  mcpJson({ autoEnableCodemode: false });
  seen.length = 0;
  await rt.turn({ text: 'Hello there.' });
  ok(!(seen[0].tools || []).some((t) => t.function.name === 'codemode'), 'with autoEnableCodemode false in her mcp.json, codemode isn\'t offered');
} catch (e) {
  fail.push('FAIL threw: ' + (e && e.stack || e));
} finally {
  release();
  await host.close();
  model.close(); tools.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}
for (const l of [...log, ...fail]) console.log(l);
console.log(fail.length ? `${fail.length} FAILED of ${log.length + fail.length}` : `ALL PASS (${log.length})`);
process.exit(fail.length ? 1 : 0);
