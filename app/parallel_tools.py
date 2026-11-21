# ---------- read-only tools asked for together run at the same time, in groups (as in PDA SEASIDE and Jade Vault 2.20) ----------
# Exec'd by build.py last, after spark_clusters.py. Since 2.19 a reply whose calls were ALL web_search / web_fetch ran them
# together; one other call anywhere in the reply sent the whole reply back to one-by-one. Now the reply is cut into groups:
# consecutive read-only calls form one group that runs with Promise.all, anything that writes or acts (write, edit, bash, ssh,
# phone, screen, browser, memory, MCP tools, …) runs on its own, in order. The cards, the tool messages and the trajectory
# record stay in the order the model asked, whatever order the calls finish in. A group of one runs exactly as before.
rep("const PARALLEL_TOOLS = new Set(['web_search', 'web_fetch']);   // read-only network tools: safe to run together\n",
    "const PARALLEL_TOOLS = new Set(['web_search', 'web_fetch']);   // read-only network tools: safe to run together\n"
    "// every tool that only reads, so calls of these asked for side by side can run at the same time (see toolGroups)\n"
    "const PARALLEL_READ = new Set([...PARALLEL_TOOLS, 'read', 'notes_search', 'note_links', 'skill', 'find_skill', 'decide', 'tool_search', 'list_mcp_resources', 'list_mcp_resource_templates', 'discord_history']);\n"
    "const toolParallelOK = (name, args) => PARALLEL_READ.has(name) || (name === 'chat_history' && /^(list|read|search)$/i.test(String(args?.action || 'list')));   // chat_history index builds, so it waits its turn\n"
    "// Cut one reply's calls into groups, in the model's order: a run of read-only calls is one group, every other call is a group of its own.\n"
    "function toolGroups(calls) {\n"
    "  const out = [];\n"
    "  for (const tc of calls || []) { const par = toolParallelOK(tc.function?.name, tc.function?.arguments || {}); const prev = out.at(-1); if (par && prev?.par) prev.push(tc); else { const g = [tc]; g.par = par; out.push(g); } }\n"
    "  return out;\n"
    "}\n")
rep_between("      if (!abortReq && asst.tool_calls.length > 1 && asst.tool_calls.every(tc => PARALLEL_TOOLS.has(tc.function.name))) {\n",
            "    if (abortReq) { body.appendChild(errorEl('Aborted by operator.')); }",
"""      const groups = toolGroups(asst.tool_calls);
      for (let gi = 0; gi < groups.length; gi++) {
        if (abortReq) break;
        const grp = groups[gi];
        if (grp.length > 1) {
          setState(`TOOLS ▸ ${grp.length} AT ONCE`); jadeMood('working'); jadeBubble(toolCaption(grp[0].function.name, grp[0].function.arguments || {}));
          const cards = grp.map(tc => { const c = toolCard(tc.function.name, tc.function.arguments || {}); body.appendChild(c.el); return c; }); scrollDown();
          const res = await Promise.all(grp.map(async (tc, i) => { const name = tc.function.name; try { vecGuard(name); dcGuard(name); return [await runTool(name, tc.function.arguments || {}, cards[i]), false]; } catch (e) { return ['Error: ' + (e.message || e), true]; } }));
          grp.forEach((tc, i) => {
            const [result, isErr] = res[i]; if (isErr || cards[i].el.classList.contains('err')) jadeMood('error', 1800, 'working');
            cards[i].done(result, isErr);
            cur.messages.push({ role: 'tool', tool_name: tc.function.name, content: String(result), _for: tc._id, _err: isErr || undefined, ts: Date.now() }); TR.tool(tc.function.name, result, isErr);
          });
          saveSession(); scrollDown();
        } else {
          const tc = grp[0];
          const name = tc.function.name, args = tc.function.arguments || {};
          setState('TOOL ▸ ' + String(name).toUpperCase());
          jadeMood('working'); jadeBubble(toolCaption(name, args));
          const card = toolCard(name, args); body.appendChild(card.el); scrollDown();
          let result, isErr = false;
          try { vecGuard(name); dcGuard(name); result = await runTool(name, args, card); } catch (e) { result = 'Error: ' + (e.message || e); isErr = true; }
          if (isErr || card.el.classList.contains('err')) jadeMood('error', 1800, 'working');
          card.done(result, isErr); scrollDown();
          cur.messages.push({ role: 'tool', tool_name: name, content: String(result), _for: tc._id, _err: isErr || undefined, ts: Date.now() }); saveSession(); TR.tool(name, result, isErr);
        }
        if (gi === groups.length - 1) { const lv = worldFlushViews(); if (lv) { cur.messages.push(lv); chatEl.appendChild(userBlock(lv.display, cur.messages.length - 1)); scrollDown(); saveSession(); } }
      }
    }
""")
rep("/* =====================================================================\n   BOOT", "Object.assign(window, { toolGroups, toolParallelOK, PARALLEL_READ });   // for tests/parallel_tools_test.mjs\n/* =====================================================================\n   BOOT")
