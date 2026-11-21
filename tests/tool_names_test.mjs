// Every tool result sent to a provider names its tool (app/tool_names.py). Strict backends (Kimi K3) refuse a history
// with a result they can't tie to a named tool: "tool message 1 has no resolvable tool name".
import { start } from './_harness.mjs';
const { page, ok, model, done } = await start();
const E = (fn, arg) => page.evaluate(fn, arg);

// the rules on their own
const r = await E(() => pairToolNames([
  { role: 'system', content: 'sys' },
  { role: 'tool', tool_name: 'read', content: 'orphan result' },                       // no call before it
  { role: 'user', content: 'go' },
  { role: 'assistant', content: '', tool_calls: [{ function: { name: 'read', arguments: {} } }, { function: { name: '', arguments: {} } }, { function: { name: 'web_search', arguments: {} } }] },
  { role: 'tool', content: 'r1' },                                                      // no tool_name: takes the call's
  { role: 'tool', tool_name: undefined, content: 'r2' },                                // its call had no name
  { role: 'tool', tool_name: 'web_search', content: 'r3' },
  { role: 'assistant', content: '', tool_calls: [{ function: { arguments: {} } }] },     // the only call has no name
  { role: 'tool', content: 'r4' },
]));
ok(r[1].role === 'user' && /^\[Result of read\]\norphan result/.test(r[1].content), 'a result with no call before it goes in as a note');
ok(JSON.stringify(r[3].tool_calls.map(t => t.function.name)) === '["read","web_search"]', 'a call without a name is left out of its reply');
ok(r[4].role === 'tool' && r[4].tool_name === 'read', 'a result without a name takes it from its call');
ok(r[5].role === 'user' && /^\[Result of a tool\]\nr2/.test(r[5].content), "the nameless call's result goes in as a note");
ok(r[6].role === 'tool' && r[6].tool_name === 'web_search', 'the next result still pairs with its own call');
ok(!r[7].tool_calls && r[8].role === 'user', 'a reply whose only call has no name keeps its text, and the result becomes a note');
ok(r.filter(m => m.role === 'tool').every(m => m.tool_name), 'every tool message left names its tool');

// a real turn on the Ollama path: a nameless call in the history doesn't reach the model
await E(() => {
  newSession();
  cur.messages.push({ role: 'user', content: 'earlier' },
    { role: 'assistant', content: '', tool_calls: [{ function: { name: '', arguments: {} }, _id: 'x1' }, { function: { name: 'read', arguments: { path: '/a.md' } }, _id: 'x2' }] },
    { role: 'tool', tool_name: undefined, content: 'nameless result', _for: 'x1' },
    { role: 'tool', tool_name: 'read', content: 'alpha', _for: 'x2' },
    { role: 'assistant', content: 'Done earlier.' });
  saveSession();
});
const n0 = model.chats.length;
await page.fill('#input', 'and now?'); await E(() => document.querySelector('#btnSend').click());
await page.waitForFunction(() => !running && cur.messages.at(-1)?.role === 'assistant', null, { timeout: 15000 });
const sent = model.chats[n0] || [];
const tools = sent.filter(m => m.role === 'tool'), calls = sent.flatMap(m => m.tool_calls || []);
ok(tools.length === 1 && tools[0].tool_name === 'read' && tools[0].content === 'alpha', 'the model gets only named tool results: ' + JSON.stringify(tools.map(t => t.tool_name)));
ok(calls.length === 1 && calls[0].function.name === 'read', 'and only named calls');
ok(sent.some(m => m.role === 'user' && /^\[Result of a tool\]\nnameless result/.test(m.content)), 'the nameless result is still there, as a note');
ok(await E(() => cur.messages.filter(m => m.role === 'tool').length) === 2, 'the chat itself is unchanged');

// OpenAI-style providers: tool messages carry the tool's name next to tool_call_id
const oa = await E(() => toOpenAIMessages(pairToolNames([
  { role: 'user', content: 'go' },
  { role: 'assistant', content: '', tool_calls: [{ function: { name: 'read', arguments: {} } }, { function: { name: 'notes_search', arguments: {} } }] },
  { role: 'tool', tool_name: 'read', content: 'a' }, { role: 'tool', content: 'b' }])));
const otools = oa.filter(m => m.role === 'tool'), ocalls = oa.find(m => m.tool_calls)?.tool_calls || [];
ok(otools.length === 2 && otools.every(t => t.name && t.tool_call_id && ocalls.some(c => c.id === t.tool_call_id && c.function.name === t.name)), 'OpenAI-style tool messages name their tool and match their call: ' + JSON.stringify(otools.map(t => t.name)));
await done('tool_names_test');
