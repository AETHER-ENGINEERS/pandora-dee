// Flows: engine (every step type, expressions, errors, retries, stop), triggers (schedule, note change),
// Jade's flow tool, the API routes, and the Flows tab (list, editor, run view).
import { start } from './_harness.mjs';
const { page, ok, sh, api, write, read, model, ollaya, done } = await start();
const E = (fn, arg) => page.evaluate(fn, arg);
const runFlow = (flow, input = null) => E(async ([f, i]) => { const r = await flowRun(f, i, { via: 'test' }); return { status: r.status, error: r.error, output: r.output, steps: r.steps.map(s => ({ name: s.name, type: s.type, status: s.status, note: s.note || null, error: s.error || null })) }; }, [flow, input]);

await write('/Inbox.md', '# Inbox\n\n- buy milk\n- server on fire asap\n- read paper\n');
await write('/projects/Alpha.md', '---\nstatus: active\n---\n# Alpha\n#proj\n');

// ---------- validation ----------
let v = await E(() => flowValidate({ name: 'x', steps: [{ type: 'nope' }, { type: 'tool' }, { type: 'if', condition: '1', then: 'bad' }], trigger: { type: 'schedule', when: 'whenever' } }));
ok(v.some(e => /unknown type "nope"/.test(e)) && v.some(e => /"tool" is required/.test(e)) && v.some(e => /"then" must be a list/.test(e)) && v.some(e => /trigger\.when/.test(e)), 'validation finds unknown types, missing fields, bad branches, bad schedules: ' + v.join(' | '));
v = await E(() => flowValidate({ name: 'x', trigger: { type: 'schedule', when: 'in 5 minutes' }, steps: [] }));
ok(v.some(e => /must repeat/.test(e)), 'a flow schedule must repeat');
v = await E(() => flowValidate({ name: 'x', steps: [{ type: 'tool', tool: 'flow' }, { type: 'tool', tool: 'no_such_tool' }] }));
ok(v.some(e => /use a "flow" step/.test(e)) && v.some(e => /no tool named "no_such_tool"/.test(e)), 'tool steps must name a real tool (and not "flow")');

// ---------- expressions, set, types ----------
let r = await runFlow({ name: 'Expr', steps: [
  { type: 'set', name: 'A', fields: { n: '{{ $input.n * 2 }}', s: 'n is {{ $input.n }}', list: ['{{ $input.n }}', 'x'], d: '{{ $date("YYYY-MM-DD", "2026-03-05", 1) }}', today: '{{ $today }}' } },
  { type: 'set', name: 'B', fields: { fromNode: '{{ $node.A.n + 1 }}', vars: '{{ $vars.k }}', flow: '{{ $flow.name }}' }, keep: true },
], vars: { k: 'V' } }, { n: 21 });
ok(r.status === 'ok' && r.output.n === 42 && r.output.s === 'n is 21' && r.output.list[0] === 21 && r.output.d === '2026-03-06' && /^\d{4}-\d{2}-\d{2}$/.test(r.output.today), 'expressions: a lone {{ }} keeps its type, mixed text interpolates, $date works: ' + JSON.stringify(r.output));
ok(r.output.fromNode === 43 && r.output.vars === 'V' && r.output.flow === 'Expr' && r.output.n === 42, '$node, $vars, $flow, and keep merges the incoming object');
r = await runFlow({ name: 'Loop', steps: [{ type: 'set', fields: { x: '{{ (() => { while (true) {} })() }}' } }] });
ok(r.status === 'error' && /longer than 5 s/.test(r.error), 'an endless expression is stopped after 5 s: ' + r.error);
r = await runFlow({ name: 'Bad expr', steps: [{ type: 'set', name: 'Oops', fields: { x: '{{ $json.nope.deeper }}' } }] });
ok(r.status === 'error' && /Oops/.test(r.error) && /\$json\.nope\.deeper/.test(r.error), 'expression errors name the step and the expression: ' + r.error);
r = await runFlow({ name: 'NoNet', steps: [{ type: 'set', fields: { x: '{{ typeof fetch }}' } }] });
ok(r.output.x === 'undefined', 'expressions have no network');

// ---------- tool, note, js (with jade.* and fs), shell ----------
r = await runFlow({ name: 'Tools', steps: [
  { type: 'tool', name: 'Search', tool: 'notes_search', args: { query: 'Inbox' } },
  { type: 'note', name: 'Read', action: 'read', path: 'Inbox' },
  { type: 'js', name: 'Count', code: "const lines = $json.split('\\n').filter(l => l.startsWith('- '));\nconst viaTool = await jade.tool('read', { path: '/projects/Alpha.md' });\nfs.writeFileSync('/out/js.md', 'from js ' + lines.length);\nreturn { lines: lines.length, alpha: viaTool.includes('Alpha'), search: $node.Search.includes('Inbox') };" },
  { type: 'shell', name: 'Shell', command: 'cat /out/js.md && echo " and {{ $json.lines }}"' },
  { type: 'note', name: 'Append', action: 'append', path: '/out/log', content: '- {{ $node.Shell.stdout.trim() }}' },
] });
ok(r.status === 'ok' && r.steps.every(s => s.status === 'ok'), 'tool, note, js and shell steps run: ' + JSON.stringify(r.steps.map(s => s.status + ' ' + (s.error || ''))));
ok(await read('/out/js.md') === 'from js 3', 'a JavaScript step writes files with fs');
ok(/from js 3 and 3/.test(await read('/out/log.md')), 'shell output feeds the next step; note append adds .md: ' + await read('/out/log.md'));
r = await runFlow({ name: 'JS out', steps: [{ type: 'js', code: "console.log('printed'); console.log('lines')" }, { type: 'js', name: 'R', code: 'return { got: $json, input: $input }' }] }, 'in');
ok(r.output.got === 'printed\nlines' && r.output.input === 'in', 'a JS step without return outputs what it printed: ' + JSON.stringify(r.output));
r = await runFlow({ name: 'Shell fail', steps: [{ type: 'shell', command: 'ls /does-not-exist' }] });
ok(r.status === 'error' && /exit [1-9]/.test(r.error), 'a failing shell command fails its step: ' + r.error);
r = await runFlow({ name: 'Shell allow', steps: [{ type: 'shell', command: 'ls /does-not-exist', allowFail: true }, { type: 'set', fields: { code: '{{ $json.code }}' } }] });
ok(r.status === 'ok' && r.output.code !== 0, 'allowFail passes {code, stdout, stderr} on');
r = await runFlow({ name: 'JS error', steps: [{ type: 'js', name: 'Boom', code: "throw new Error('kaboom')" }] });
ok(r.status === 'error' && /kaboom/.test(r.error) && /Boom/.test(r.error), 'a throwing JS step fails with its message: ' + r.error);

// ---------- logic: if, switch, each, stop, onError, retries, disabled ----------
r = await runFlow({ name: 'Logic', steps: [
  { type: 'set', fields: { items: ['a', 'bb', 'ccc'], kind: 'two' } },
  { type: 'if', name: 'Has items', condition: '$json.items.length > 2', then: [{ type: 'set', fields: { branch: 'then', items: '{{ $json.items }}', kind: '{{ $json.kind }}' } }], else: [{ type: 'set', fields: { branch: 'else' } }] },
  { type: 'switch', name: 'Kind', value: '$json.kind', cases: [{ match: 'one', steps: [{ type: 'set', fields: { k: 1 } }] }, { match: ['two', 'deux'], steps: [{ type: 'set', fields: { k: 2, items: '{{ $json.items }}' } }] }], default: [{ type: 'set', fields: { k: 0 } }] },
  { type: 'each', name: 'Lens', items: '$json.items', steps: [{ type: 'set', fields: { i: '{{ $index }}', len: '{{ $item.length }}' } }] },
] });
ok(r.status === 'ok' && JSON.stringify(r.output) === JSON.stringify([{ i: 0, len: 1 }, { i: 1, len: 2 }, { i: 2, len: 3 }]), 'if → switch (list match) → for each with $item/$index: ' + JSON.stringify(r.output));
ok(r.steps.find(s => s.name === 'Has items').note === 'then' && /case \["two","deux"\]/.test(r.steps.find(s => s.name === 'Kind').note) && r.steps.find(s => s.name === 'Lens').note === '3 items', 'the run log records which branch ran');
r = await runFlow({ name: 'Stop', steps: [{ type: 'set', fields: { a: 1 } }, { type: 'if', condition: 'true', then: [{ type: 'stop', value: 'early {{ $json.a }}' }] }, { type: 'set', name: 'Never', fields: { b: 2 } }] });
ok(r.status === 'ok' && r.output === 'early 1' && !r.steps.some(s => s.name === 'Never'), 'stop ends the flow from inside a branch, with its value');
r = await runFlow({ name: 'Continue', steps: [{ type: 'js', name: 'Bad', code: "throw new Error('nope')", onError: 'continue' }, { type: 'set', fields: { saw: '{{ $json.error }}' } }] });
ok(r.status === 'ok' && /nope/.test(r.output.saw), 'onError continue passes {error} to the next step');
r = await runFlow({ name: 'Retry', steps: [{ type: 'js', name: 'Flaky', retries: 2, code: "const n = +(fs.existsSync('/tmp/tries') ? fs.readFileSync('/tmp/tries', 'utf8') : 0) + 1;\nfs.writeFileSync('/tmp/tries', String(n));\nif (n < 3) throw new Error('flaky ' + n);\nreturn n;" }] });
ok(r.status === 'ok' && r.output === 3 && /retry 2/.test(r.steps[0].note || ''), 'a step is retried until it works (retries: 2): ' + JSON.stringify(r));
r = await runFlow({ name: 'Retry out', steps: [{ type: 'js', name: 'Always', retries: 1, code: "fs.appendFileSync('/tmp/always', 'x'); throw new Error('still no')" }] });
ok(r.status === 'error' && /still no/.test(r.error) && await read('/tmp/always') === 'xx', 'after its retries a step fails (1 retry = 2 tries)');
r = await runFlow({ name: 'Skip', steps: [{ type: 'set', fields: { a: 1 } }, { type: 'js', code: "throw new Error('x')", disabled: true }, { type: 'set', fields: { b: '{{ $json.a }}' } }] });
ok(r.status === 'ok' && r.output.b === 1 && r.steps[1].status === 'skipped', 'disabled steps are skipped and pass data through');
r = await runFlow({ name: 'Nested fail', steps: [{ type: 'each', items: '[1,2]', steps: [{ type: 'js', name: 'Inner', code: 'if ($item === 2) throw new Error("two"); return $item' }] }] });
ok(r.status === 'error' && /Inner/.test(r.error) && /two/.test(r.error) && r.steps[0].status === 'error', 'a failing step inside for-each fails the flow with the inner step\'s name: ' + r.error);

// ---------- decide (Ollaya), Ask AI, agent, wait, notify, sub-flow ----------
r = await runFlow({ name: 'Decide', steps: [
  { type: 'decide', name: 'Pick', state: '{{ $input }}', question: 'Which?', kind: 'choice', options: ['red', 'blue'] },
  { type: 'decide', name: 'YN', state: 'server on fire', question: 'Urgent?', kind: 'yesno' },
  { type: 'decide', name: 'Score', state: 'x', question: 'How bad?', kind: 'score', options: 'low\nmid\nhigh' },
  { type: 'set', fields: { pick: '{{ $node.Pick.result }}', conf: '{{ $node.Pick.confidence }}', yn: '{{ $node.YN.result }}', score: '{{ $node.Score.score }}' } },
] }, 'a red car');
ok(r.status === 'ok' && r.output.pick === 'red' && r.output.conf === 0.91 && r.output.yn === true && r.output.score === 2, 'decide steps return structured results (choice, yes/no, score): ' + JSON.stringify(r.output));
ok(ollaya.calls[0].state === 'a red car' && ollaya.calls[0].questions.q.criteria.join() === 'red,blue' && ollaya.calls[2].questions.q.criteria.length === 3, 'decide sends the state, question and options to Ollaya');
r = await runFlow({ name: 'Ask', steps: [{ type: 'llm', name: 'Plain', prompt: 'Say {{ $input }}' }, { type: 'llm', name: 'J', prompt: 'topics', json: true }, { type: 'set', fields: { plain: '{{ $node.Plain }}', n: '{{ $node.J.n }}' } }] }, 'hi');
ok(r.status === 'ok' && r.output.plain === 'ANSWER: Say hi' && r.output.n === 3, 'Ask AI returns text, or parsed JSON (code fences removed): ' + JSON.stringify(r.output));
r = await runFlow({ name: 'Agent', steps: [{ type: 'agent', name: 'Ask Jade', prompt: 'File {{ $input }}', chat: 'new' }] }, 'the paper');
ok(r.status === 'ok' && r.output.reply === 'Agent says: File the paper' && await E(id => cur.id === id && /⚙ Agent/.test(cur.title), r.output.chat), 'an agent step runs a real chat turn (it shows up in the chat): ' + JSON.stringify(r.output));
await E(() => { window.__notes.length = 0; });
r = await runFlow({ name: 'Notify', steps: [{ type: 'wait', seconds: 1 }, { type: 'notify', title: 'Hi {{ $input }}', body: 'body' }] }, 'you');
ok(r.status === 'ok' && await E(() => window.__notes.some(n => n[0] === 'Hi you' && n[1] === 'body')), 'wait then notify (phone notification)');
await E(() => flowSave({ name: 'Child', steps: [{ type: 'set', fields: { doubled: '{{ $input.x * 2 }}', via: '{{ $run.via }}' } }] }));
r = await runFlow({ name: 'Parent', steps: [{ type: 'flow', flow: 'Child', input: { x: '{{ $input }}' } }] }, 21);
ok(r.status === 'ok' && r.output.doubled === 42 && r.output.via === 'flow:Parent', 'a flow step runs another flow with an input');
await E(() => flowSave({ name: 'Loop A', steps: [{ type: 'flow', flow: 'Loop A' }] }));
r = await E(async () => { const run = await flowRunByName('Loop A'); return { status: run.status, error: run.error }; });
ok(r.status === 'error' && /too deeply/.test(r.error), 'flows that call themselves stop at the depth limit: ' + r.error);

// ---------- stopping a run ----------
const longRun = E(async () => { const p = flowRun({ name: 'Long', steps: [{ type: 'wait', seconds: 60 }, { type: 'set', fields: { never: 1 } }] }, null); await new Promise(r => setTimeout(r, 400)); for (const r of FlowRuns.active.values()) if (r.flow === 'Long') r.stop = true; const run = await p; return { status: run.status, steps: run.steps.length }; });
r = await longRun;
ok(r.status === 'stopped' && r.steps === 1, 'a running flow can be stopped: ' + JSON.stringify(r));

// ---------- run history ----------
r = await E(async () => { await flowRecordsLoad(); const db = await idb.get('flowRuns'); return { mem: FlowRuns.recent.length, db: db.length, first: db[0].flow, keys: Object.keys(db[0]).join() }; });
ok(r.mem >= 20 && r.db === r.mem && r.first === 'Long' && /steps/.test(r.keys), 'runs are kept (newest first) in IndexedDB: ' + JSON.stringify(r));

// ---------- triggers ----------
await E(() => flowSave({ name: 'Ticker', trigger: { type: 'schedule', when: 'every 5 minutes' }, steps: [{ type: 'note', action: 'append', path: '/out/ticks.md', content: 'tick {{ $input.trigger }}' }] }));
r = await E(async () => { flowsArm(); const p = flowFind('Ticker')._path; const next = FlowTrig.next.get(p); FlowTrig.next.set(p, Date.now() - 1000); flowTick(); await new Promise(r => setTimeout(r, 1500)); return { next: next - Date.now(), again: FlowTrig.next.get(p) - Date.now() }; });
ok(r.next > 0 && r.next <= 300e3 && r.again > 0, 'a schedule trigger is armed for the next matching time: ' + JSON.stringify(r));
ok((await read('/out/ticks.md') || '').includes('tick schedule'), 'a due schedule trigger runs the flow (input.trigger = schedule)');
await E(() => { const f = flowFind('Ticker'); f.enabled = false; flowSave(f, f._path); });
await E(async () => { const p = flowFind('Ticker')._path; FlowTrig.next.set(p, Date.now() - 1000); flowTick(); await new Promise(r => setTimeout(r, 600)); });
ok(((await read('/out/ticks.md')) || '').split('tick').length - 1 === 1, 'a turned-off flow does not fire');

await E(() => flowSave({ name: 'Watcher', trigger: { type: 'note', path: '/Inbox.md' }, steps: [{ type: 'note', action: 'append', path: '/out/watch.md', content: '{{ $input.changed.join(",") }} {{ $input.content.split("\\n").length }}' }] }));
await E(() => flowNoteCheck());   // learns the current state
await write('/Inbox.md', '# Inbox\n\n- one\n- two\n');
await E(async () => { flowNoteCheck(); await new Promise(r => setTimeout(r, 1500)); flowNoteCheck(); await new Promise(r => setTimeout(r, 500)); });
let watched = await read('/out/watch.md');
ok(watched && watched.trim() === '/Inbox.md 5', 'a note trigger fires once when the note changes, with the path and content: ' + JSON.stringify(watched));
await write('/out/other.md', 'x');
await E(async () => { flowNoteCheck(); await new Promise(r => setTimeout(r, 500)); });
ok((await read('/out/watch.md')).trim().split('\n').length === 1, 'changes to other notes do not fire it');
r = await E(async () => { vfs.write('/Inbox.md', '# Inbox\n- three\n'); await new Promise(r => setTimeout(r, 3600)); return vfs.read('/out/watch.md'); });
ok(r.trim().split('\n').length === 2, 'the vault listener fires note triggers on its own a few seconds after a change: ' + JSON.stringify(r));
await E(() => flowSave({ name: 'Folder watch', trigger: { type: 'note', path: '/projects' }, steps: [{ type: 'set', fields: { c: '{{ $input.changed }}' } }, { type: 'note', action: 'append', path: '/out/folder.md', content: '{{ $json.c.join(",") }}' }] }));
await E(() => flowNoteCheck());
await write('/projects/Beta.md', '# Beta');
await E(async () => { flowNoteCheck(); await new Promise(r => setTimeout(r, 800)); });
ok((await read('/out/folder.md') || '').trim() === '/projects/Beta.md', 'a folder trigger reports which notes changed');

// ---------- Jade's flow tool ----------
const tool = a => E(async a => { try { return await flowTool(a); } catch (e) { return 'ERR ' + e.message; } }, a);
let t = await tool({ action: 'help' });
ok(/"trigger"/.test(t) && /- decide \(Decide\)/.test(t) && /\$node/.test(t) && /Example/.test(t), 'flow help documents the format, every step type and expressions');
t = await tool({ action: 'create', flow: { name: 'Bad', steps: [{ type: 'tool' }] } });
ok(/^ERR not saved/.test(t) && /"tool" is required/.test(t), 'create refuses an invalid flow and says why');
t = await tool({ action: 'create', flow: JSON.stringify({ name: 'Made by Jade', description: 'test', steps: [{ type: 'set', fields: { hello: '{{ $input.who }}' } }] }) });
ok(/Created ritual "Made by Jade"/.test(t) && await E(() => vfs.isFile('/Pandora/Rituals/Made by Jade.ritual.json')), 'create saves /Pandora/Rituals/<name>.ritual.json (flow given as an object or JSON text)');
t = await tool({ action: 'create', flow: { name: 'made by jade', steps: [] } });
ok(/already exists/.test(t), 'names are unique (case-insensitive)');
t = await tool({ action: 'run', name: 'Made by Jade', input: { who: 'Sam' } });
ok(/Ritual "Made by Jade" ok/.test(t) && /"hello": "Sam"/.test(t) && /✓/.test(t), 'run returns the status, each step and the output: ' + t.slice(0, 120));
t = await tool({ action: 'get', name: 'Made by Jade' });
ok(JSON.parse(t).steps[0].id === 's1', 'get returns the JSON (steps get ids)');
t = await tool({ action: 'update', name: 'Made by Jade', flow: { name: 'Renamed', steps: [{ type: 'set', fields: { v: 2 } }] } });
ok(/Updated ritual "Renamed"/.test(t) && await E(() => !vfs.isFile('/Pandora/Rituals/Made by Jade.ritual.json') && vfs.isFile('/Pandora/Rituals/Renamed.ritual.json')), 'update can rename (the old file goes)');
t = await tool({ action: 'disable', name: 'Renamed' }); ok(/disabled/.test(t) && await E(() => flowFind('Renamed').enabled === false), 'disable / enable');
t = await tool({ action: 'list' }); ok(/Renamed \(off\)/.test(t) && /Ticker/.test(t) && /⏰/.test(t), 'list shows triggers and on/off');
t = await tool({ action: 'runs', name: 'Made by Jade' }); ok(/^ERR no ritual/.test(t), 'runs of a renamed ritual: unknown name is an error');
t = await tool({ action: 'runs' }); ok(/via jade/.test(t), 'runs lists recent runs');
await E(() => flowSave({ name: 'Has agent', steps: [{ type: 'agent', prompt: 'x' }] }));
t = await tool({ action: 'run', name: 'Has agent' }); ok(/^ERR this ritual has a Pandora agent step/.test(t), 'the tool will not run rituals with an agent step inside a chat turn');
t = await tool({ action: 'delete', name: 'Renamed' }); ok(/Deleted/.test(t) && await E(() => !flowFind('Renamed')), 'delete');
ok(await E(() => activeTools().some(t => t.function.name === 'ritual') && !activeTools().some(t => t.function.name === 'flow') && /- ritual: build, change and run rituals/.test(systemPrompt())), 'her ritual tool is offered and described in her instructions (no separate flow tool)');
t = await E(async () => { const one = await runTool('ritual', { action: 'list' }, null); const two = await runTool('flow', { action: 'list' }, null); return [one, two]; });
ok(/Ticker/.test(t[0]) && t[0] === t[1], 'a call to flow (Jade Vault\'s name) still reaches the ritual tool');
t = await E(async () => { try { return await runTool('ritual', { action: 'create', ritual: { name: 'Via ritual', steps: [{ type: 'set', fields: { a: 1 } }] } }, null); } catch (e) { return 'ERR ' + e.message; } });
ok(/Via ritual/.test(t) && await E(() => vfs.isFile('/Pandora/Rituals/Via ritual.ritual.json')), 'the ritual tool takes the ritual JSON in "ritual" (and still in "flow"): ' + t.slice(0, 120));
v = await E(() => flowValidate({ name: 'x', steps: [{ type: 'tool', tool: 'ritual' }] }));
ok(v.some(e => /use a "flow" step \(Run ritual\)/.test(e)), 'a tool step cannot call the ritual tool either: ' + v.join(' | '));

// ---------- API ----------
let a = await api('flows');
ok(a.status === 200 && a.body.flows.some(f => f.name === 'Ticker' && f.trigger === 'schedule' && f.enabled === false && f.last_run?.status === 'ok'), 'GET /v1/flows lists flows with their last run');
a = await api('flow', { name: 'Child', input: '{"x": 5}' });
ok(a.status === 200 && a.body.run.status === 'ok' && a.body.run.output.doubled === 10 && a.body.run.output.via === 'api' && a.body.run.steps.length === 1, 'GET /v1/flow?name=…&input={json} runs it and returns JSON: ' + JSON.stringify(a.body.run).slice(0, 160));
a = await api('flow', { json: JSON.stringify({ name: 'Child', input: { x: 1 } }) });
ok(a.status === 200 && a.body.run.output.doubled === 2, 'the input can come inside json={…}');
a = await api('flow', { name: 'Nope' }); ok(a.status === 404 && a.body.error.code === 'unknown_flow', 'unknown flow → 404');
a = await api('flow', { name: 'Child', input: '{bad' }); ok(a.status === 400 && a.body.error.code === 'bad_input', 'bad input JSON → 400');
a = await api('flow', { name: 'Loop A' }); ok(a.status === 502 && a.body.ok === false && /too deeply/.test(a.body.run.error), 'a failing flow → 502 with the error');
a = await api('rituals');
ok(a.status === 200 && a.body.rituals.some(f => f.name === 'Ticker' && f.last_run?.status === 'ok') && !a.body.flows, 'GET /v1/rituals lists rituals (GET /v1/flows still does too)');
a = await api('ritual', { name: 'Child', input: '{"x": 6}' });
ok(a.status === 200 && a.body.run.ritual === 'Child' && a.body.run.flow === 'Child' && a.body.run.output.doubled === 12, 'GET /v1/ritual?name=…&input={json} runs one: ' + JSON.stringify(a.body.run).slice(0, 120));
a = await api('ritual', { name: 'Nope' }); ok(a.status === 404 && a.body.error.code === 'unknown_ritual' && /\/v1\/rituals/.test(a.body.error.message), 'unknown ritual → 404 that points at /v1/rituals');
a = await api('ritual', {}); ok(a.status === 400 && /say which ritual/.test(a.body.error.message), 'no name → 400');

// ---------- Flows tab ----------
const tabs = await E(() => [...document.querySelectorAll('.m-nav .tab')].map(t => t.dataset.tab).join());
ok(tabs === 'chat,term,files,sched,flows,apps,tasks', 'the bottom bar has a Flows tab between Schedule and Apps: ' + tabs);
await page.click('.m-nav .tab[data-tab="flows"]'); await page.waitForTimeout(300);
ok(await E(() => document.querySelectorAll('#flCards .fl-card').length >= 6 && /Recent runs/.test(document.querySelector('#flowsPanel').textContent)), 'the list shows flow cards and recent runs');
await page.screenshot({ path: 'flows_list.png' });
await page.click('[data-fa="new"]'); await page.click('[data-fa="example"][data-i="1"]'); await page.waitForTimeout(200);
ok(await E(() => FUI.view === 'edit' && FUI.flow.name === 'Inbox triage' && document.querySelectorAll('#flowsPanel .fl-step').length === 3), 'an example opens in the editor');
await page.screenshot({ path: 'flows_editor.png' });
// add a step, fill it, save
await page.fill('.fl-title', 'UI flow');
await page.selectOption('select.fl-add[data-arr="steps"]', 'set'); await page.waitForTimeout(150);
ok(await E(() => FUI.flow.steps.length === 4 && FUI.open.has('steps.3') && !!document.querySelector('[data-sp="steps.3"] .fl-step-b')), 'adding a step opens it');
await page.fill('[data-sp="steps.3"] [data-f="name"]', 'Result');
await page.fill('[data-sp="steps.3"] textarea[data-f="fields"]', '{"count": "{{ $node[\'Each line\'].length }}"');
ok(await E(() => FUI.bad.size === 1 && document.querySelector('[data-sp="steps.3"] textarea[data-f="fields"]').classList.contains('bad')), 'invalid JSON is marked and kept');
await page.click('[data-fa="save"]'); await page.waitForTimeout(150);
ok(await E(() => !document.querySelector('#flErrs').hidden && /fix the JSON/.test(document.querySelector('#flErrs').textContent) && !flowFind('UI flow')), 'save is blocked while a field has bad JSON');
await page.fill('[data-sp="steps.3"] textarea[data-f="fields"]', '{"count": "{{ $node[\'Each line\'].length }}"}');
await page.click('[data-fa="save"]'); await page.waitForTimeout(200);
ok(await E(() => !!flowFind('UI flow') && flowFind('UI flow').steps[3].fields.count.includes('Each line') && !FUI.dirty), 'save writes the flow');
// move the new step up, then back down
await page.click('[data-sp="steps.3"] [data-fa="up"]'); await page.waitForTimeout(100);
ok(await E(() => FUI.flow.steps[2].name === 'Result' && FUI.dirty), 'steps move up / down');
await page.click('[data-sp="steps.2"] [data-fa="down"]'); await page.waitForTimeout(100);
// open the if-branch inside for-each and check nesting renders
await page.click('[data-sp="steps.1"] .fl-step-h'); await page.waitForTimeout(100);
ok(await E(() => !!document.querySelector('[data-sp="steps.1.steps.1"]') && !!document.querySelector('[data-arr="steps.1.steps"]')), 'nested steps (for-each body) are shown and editable');
// required field check on save
await page.selectOption('select.fl-add[data-arr="steps"]', 'tool'); await page.waitForTimeout(100);
await page.click('[data-fa="save"]'); await page.waitForTimeout(100);
ok(await E(() => /"tool" is required/.test(document.querySelector('#flErrs').textContent)), 'missing required fields are listed on save');
await page.selectOption('[data-sp="steps.4"] select[data-f="tool"]', 'read'); await page.waitForTimeout(150);
ok(await E(() => JSON.stringify(FUI.flow.steps[4].args) === '{"path":""}' && /Arguments: path\*/.test(document.querySelector('[data-sp="steps.4"] .fl-tooldesc').textContent)), 'picking a tool fills its required arguments and shows what it takes');
await page.fill('[data-sp="steps.4"] textarea[data-f="args"]', '{"path": "/Urgent.md"}');
// JSON mode round trip
await page.click('[data-fa="mode"][data-m="json"]'); await page.waitForTimeout(100);
const js = await E(() => JSON.parse(document.querySelector('#flJson').value));
ok(js.name === 'UI flow' && js.steps.length === 5 && js.steps[4].args.path === '/Urgent.md', 'JSON mode shows the whole flow');
await E(() => { const t = document.querySelector('#flJson'); const f = JSON.parse(t.value); f.description = 'edited as JSON'; f.steps.pop(); t.value = JSON.stringify(f); });
await page.click('[data-fa="mode"][data-m="steps"]'); await page.waitForTimeout(100);
ok(await E(() => FUI.flow.description === 'edited as JSON' && FUI.flow.steps.length === 4 && document.querySelector('#flDesc').value === 'edited as JSON'), 'edits in JSON mode carry back to the steps view');
// trigger fields
await page.selectOption('#flTrig', 'schedule'); await page.fill('#flWhen', 'every weekday at 9am'); await page.waitForTimeout(100);
ok(await E(() => /next:/.test(document.querySelector('#flTrigPv').textContent) && !document.querySelector('#flWhen').closest('[data-show]').hidden && document.querySelector('#flPath').closest('[data-show]').hidden), 'the trigger preview shows the next times');
await page.fill('#flWhen', 'whenever'); await page.waitForTimeout(80);
ok(await E(() => document.querySelector('#flTrigPv').classList.contains('text-rd')), 'a bad schedule shows an error');
await page.fill('#flWhen', 'every weekday at 9am');
// run from the editor (saves first), watch the run view
await write('/Inbox.md', '# Inbox\n\n- server on fire asap\n- buy milk\n');
await page.click('#flowsPanel [data-fa="testrun"]');
await page.waitForFunction(() => FUI.view === 'run' && FlowRuns.recent[0]?.flow === 'UI flow' && !FlowRuns.active.size, null, { timeout: 15000 });
await page.waitForTimeout(200);
ok(await E(() => document.querySelectorAll('#flowsPanel .fl-srow').length >= 6 && /✓ ok/.test(document.querySelector('#flowsPanel').textContent) && /"count": 2/.test(document.querySelector('.fl-out').textContent)), 'Run saves, then shows each step and the output');
ok(/- \[ \] server on fire asap/.test(await read('/Urgent.md') || '') && !/buy milk/.test(await read('/Urgent.md') || ''), 'the example flow did its job (the urgent item was filed)');
await page.screenshot({ path: 'flows_run.png' });
await page.click('#flowsPanel [data-fa="back"]'); await page.waitForTimeout(150);
// toggle and delete from the list
await page.click('.fl-card[data-path="/Pandora/Rituals/UI flow.ritual.json"] .sched-switch'); await page.waitForTimeout(150);
ok(await E(() => flowFind('UI flow').enabled === false), 'the switch on a card turns a scheduled flow off');
await page.click('.fl-card[data-path="/Pandora/Rituals/UI flow.ritual.json"] [data-fa="del"]'); await page.click('.fl-card[data-path="/Pandora/Rituals/UI flow.ritual.json"] [data-fa="del"]'); await page.waitForTimeout(150);
ok(await E(() => !flowFind('UI flow') && !document.querySelector('.fl-card[data-path="/Pandora/Rituals/UI flow.ritual.json"]')), 'delete asks for a second tap, then removes the flow');
// unsaved changes guard
await page.click('.fl-card [data-fa="edit"]'); await page.waitForTimeout(100);
await page.fill('#flDesc', 'changed'); await page.click('#flBack');
ok(await E(() => FUI.view === 'edit' && /Discard/.test(document.querySelector('#flBack').textContent)), 'leaving with unsaved changes asks first');
await page.click('#flBack'); ok(await E(() => FUI.view === 'list'), '…and a second tap discards');
// running badge
const badge = E(async () => { const p = flowRun({ name: 'Slow', steps: [{ type: 'wait', seconds: 1 }] }); await new Promise(r => setTimeout(r, 150)); const b = document.querySelector('#flowBadge'); const shown = !b.hidden && b.textContent === '1'; await p; return shown && document.querySelector('#flowBadge').hidden; });
ok(await badge, 'the Flows tab shows a badge while a flow runs');
// bottom bar fits at 360 px
await page.setViewportSize({ width: 360, height: 760 });
ok(await E(() => [...document.querySelectorAll('.m-nav .tab')].every(t => t.scrollWidth <= t.clientWidth + 1)), 'seven tabs fit the bottom bar at 360 px');
await page.screenshot({ path: 'flows_nav360.png' });
await done();
