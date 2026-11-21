# ---------- every tool result in a request names its tool ----------
# Exec'd by build.py last. Kimi K3 (and other strict backends) refuse a request whose history has a tool result they
# can't tie to a named tool: "tool message 1 has no resolvable tool name". That happens when an earlier reply had a
# tool call without a name (some models or streams leave it out), or a result has no call before it. Before the
# history goes to any provider:
# - a tool call without a name is left out of its reply, and its result goes in as a plain note;
# - a result takes its tool's name from the call it answers (in order), and one with no call becomes a note;
# - on OpenAI-style providers the tool message also carries the tool's "name", next to tool_call_id.
# The chat itself isn't changed; only what's sent.
rep("""  return relFillMsgs(out);
}
function transcriptOf(msgs) {""", """  return relFillMsgs(pairToolNames(out));
}
// What's sent: a tool call without a name is left out (its result becomes a note), every result names its tool, and a
// result with no call before it becomes a note. Calls and results pair in order, as Ollama pairs them.
function pairToolNames(msgs) {
  const out = []; let pending = [];
  const note = (name, content) => ({ role: 'user', content: `[Result of ${name || 'a tool'}]\\n${content ?? ''}` });
  for (const m of msgs) {
    if (m.role === 'tool') {
      const p = pending.shift();
      if (!p || !p.name) { out.push(note(m.tool_name, m.content)); continue; }
      out.push({ ...m, tool_name: m.tool_name || p.name });
      continue;
    }
    pending = [];
    if (m.role === 'assistant' && m.tool_calls?.length) {
      const named = m.tool_calls.filter(t => String(t?.function?.name || '').trim());
      pending = m.tool_calls.map(t => ({ name: String(t?.function?.name || '').trim() }));
      const o = { ...m }; if (named.length) o.tool_calls = named; else delete o.tool_calls;
      out.push(o); continue;
    }
    out.push(m);
  }
  return out;
}
function transcriptOf(msgs) {""")
rep("if (pending.length) { const p = pending.splice(k, 1)[0]; out.push({ role: 'tool', tool_call_id: p.id, content: String(m.content ?? '') }); }",
    "if (pending.length) { const p = pending.splice(k, 1)[0]; out.push({ role: 'tool', tool_call_id: p.id, ...(p.name || m.tool_name ? { name: p.name || m.tool_name } : {}), content: String(m.content ?? '') }); }")
rep("/* =====================================================================\n   BOOT", "Object.assign(window, { pairToolNames, toOpenAIMessages });   // for tests/tool_names_test.mjs\n/* =====================================================================\n   BOOT")
