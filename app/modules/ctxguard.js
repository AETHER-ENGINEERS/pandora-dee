/* =====================================================================
   CONTEXT GUARD — keep every request inside the model's context window.
   Ollama's prompt_eval_count only counts tokens it did not have cached, so it can't be
   trusted for "how full is the window". We estimate the whole request ourselves
   (system prompt + tool schemas + history), compact or trim before sending, and when a
   server still says "prompt is too long" we learn its real limit and retry.
   ===================================================================== */
const CTX = { last: null };
const ctxKey = () => `${activeProv}:${S.model}`;
function ctxRatio() { return +(ls.get('ctxRatio', {})[ctxKey()] || 3.3); }          // characters per token (conservative)
function ctxLimit() {
  const learned = +(ls.get('ctxLimits', {})[ctxKey()] || 0);
  const base = activeProv === 'local' ? (+S.numCtx || 16384) : 131072;   // local Ollama silently truncates past num_ctx
  return learned ? Math.min(base, learned) : base;
}
const ctxReserve = lim => Math.min(4096, Math.round(lim * 0.15));          // room for the reply
const ctxTarget = lim => Math.max(2048, Math.floor(lim * Math.min(0.95, (+S.compactPct || 85) / 100)) - ctxReserve(lim));
const msgChars = m => String(m.content || '').length + (m.tool_calls ? JSON.stringify(m.tool_calls).length : 0) + 12;
const toolsChars = tools => JSON.stringify(tools || []).length;
function estRequest(msgs, tools) {
  let c = 0, img = 0; for (const m of msgs) { c += msgChars(m); img += (m.images?.length || 0); }
  return Math.ceil((c + toolsChars(tools)) / ctxRatio()) + img * 800;
}
function ctxLearn(msg, estTok) {
  const num = s => +String(s).replace(/,/g, '');
  const maxM = /(?:maximum context length(?: is)?|context (?:length|size|window)(?: is| of)?|n_ctx|max(?:imum)?(?: allowed)?(?: tokens)?)\D{0,24}?(\d[\d,]{2,})/i.exec(msg);
  const prM = /(?:prompt is too long|resulted in|request(?:ed)?|prompt has|prompt tokens?|input (?:is|of|length))\D{0,24}?(\d[\d,]{2,})/i.exec(msg);
  const lims = ls.get('ctxLimits', {}), rat = ls.get('ctxRatio', {}), k = ctxKey();
  if (prM && estTok) { const actual = num(prM[1]); if (actual > estTok) rat[k] = Math.max(0.8, ctxRatio() * estTok / actual * 0.97); }
  if (maxM && num(maxM[1]) >= 1024) lims[k] = num(maxM[1]);
  else if (!prM) lims[k] = Math.max(2048, Math.floor(Math.min(ctxLimit(), estTok) * 0.7));   // no numbers: assume we were well over
  ls.set('ctxLimits', lims); ls.set('ctxRatio', rat);
}
const isCtxError = msg => /prompt is too long|maximum context length|context[_ ]length[_ ]exceeded|exceeds? (?:the )?(?:available |maximum )?context|context (?:size|window) (?:exceeded|is too small)|too many (?:input )?tokens|reduce the length of the (?:messages|prompt)|input is too long/i.test(msg);
function clip(s, keep, why) {
  s = String(s || ''); if (s.length <= keep) return s;
  const head = Math.round(keep * 0.7), tail = keep - head;
  return `${s.slice(0, head)}\n[… ${s.length - keep} characters ${why} …]\n${s.slice(-tail)}`;
}
// make the request fit: shrink old tool results, then drop the oldest turns, then (last resort) the system prompt
function shrinkMessages(msgs, tools, target) {
  let out = msgs.map(m => ({ ...m })); const fits = () => estRequest(out, tools) <= target;
  const toolIdx = out.map((m, i) => m.role === 'tool' ? i : -1).filter(i => i >= 0);
  for (const keep of [2000, 800]) {
    for (const i of toolIdx.slice(0, -2)) out[i].content = clip(out[i].content, keep, 'left out to fit the context window; run the tool again if you need them');
    if (fits()) return out;
  }
  for (const keep of [6000, 2000]) {
    for (const i of toolIdx) out[i].content = clip(out[i].content, keep, 'left out to fit the context window; use read with offset/limit or grep for the part you need');
    for (const m of out) if (m.role !== 'system' && m.role !== 'tool' && String(m.content || '').length > keep * 2) m.content = clip(m.content, keep * 2, 'left out to fit the context window');
    if (fits()) return out;
  }
  // drop whole turns from the front (always at a user message, so tool calls stay paired)
  const sys = out[0]?.role === 'system' ? out[0] : null; let rest = sys ? out.slice(1) : out; let dropped = 0;
  while (estRequest([sys, ...rest].filter(Boolean), tools) > target) {
    const next = rest.findIndex((m, i) => i > 0 && m.role === 'user');
    if (next <= 0) break;
    dropped += next; rest = rest.slice(next);
  }
  if (dropped) rest = [{ role: 'user', content: `[${dropped} earlier messages were left out to fit the model's context window. Ask the user if you need something from them.]` }, { role: 'assistant', content: 'Understood.' }, ...rest];
  out = [sys, ...rest].filter(Boolean);
  if (sys && !fits()) {
    const room = Math.max(2000, Math.floor((target - estRequest(rest, tools)) * ctxRatio()));
    out[0] = { ...sys, content: clip(sys.content, room, 'of the system prompt cut to fit the context window (see /context)') };
  }
  return out;
}
let ctxWarned = '';
async function fitContext(msgs, tools, mount) {
  const lim = ctxLimit(), target = ctxTarget(lim);
  let est = estRequest(msgs, tools), how = '';
  const fixed = estRequest(msgs.slice(0, 1), tools);
  if (fixed > target * 0.6 && ctxWarned !== ctxKey() + fixed) { ctxWarned = ctxKey() + fixed; toast(`The system prompt and tools alone take ~${fmtK(fixed)} of ${fmtK(lim)} tokens for ${esc(S.model)}. Type <b>/context</b> to see what is using it.`, 'err'); }
  if (est > target && S.compactAuto !== false && !compacting && userTurnStarts(windowStart()).length > 1) {
    const r = await compactHistory({ keepTurns: 1, reason: 'context', mount });
    if (r) { msgs = buildApiMessages(); est = estRequest(msgs, tools); how = 'compacted'; }
  }
  if (est > target) { msgs = shrinkMessages(msgs, tools, target); est = estRequest(msgs, tools); how = how ? how + '+trimmed' : 'trimmed'; }
  CTX.last = { est, lim, how, at: Date.now() };
  $('#hudCtx').textContent = `~${fmtK(est)} / ${fmtK(lim)}`;
  return { msgs, est, lim, how };
}
// "/context": where the window goes
function contextReport() {
  const R = ctxRatio(), tok = n => Math.ceil(n / R); const lim = ctxLimit();
  const sp = systemPrompt(); const st = steering(); const rows = [];
  const add = (label, chars) => { if (chars > 0) rows.push([label, tok(chars)]); };
  const soulC = st.soul.length, agC = st.agents.reduce((a, x) => a + x.t.length, 0), skC = st.skills.reduce((a, x) => a + x.name.length + x.description.length + 4, 0);
  const memC = memoryContext().length, mcpC = mcpPromptBlock().length, custom = st.system.length;
  add(custom ? 'Custom system prompt (/Jade/SYSTEM.md)' : 'Built-in instructions', sp.length - soulC - agC - skC - memC - mcpC);
  add('SOUL.md persona', soulC); for (const a of st.agents) add(`AGENTS: ${a.p}`, a.t.length); add(`Skills list (${st.skills.length})`, skC);
  add('Memory + journal', memC); add('MCP server list', mcpC);
  const tools = activeTools(); const builtin = tools.filter(t => !mcpHandles(t.function.name) && !/^mcp__/.test(t.function.name));
  add(`Built-in tools (${builtin.length})`, toolsChars(builtin));
  const bySrv = {}; for (const t of tools) if (!builtin.includes(t)) { const s = /^mcp__([^_]+(?:_[^_]+)*?)__/.exec(t.function.name)?.[1] || 'mcp helpers'; bySrv[s] = (bySrv[s] || 0) + JSON.stringify(t).length; }
  for (const [s, c] of Object.entries(bySrv)) add(`MCP tools: ${s}`, c);
  const msgs = cur ? buildApiMessages().slice(1) : [];
  add(`Chat history (${msgs.length} messages)`, msgs.reduce((a, m) => a + msgChars(m), 0));
  const big = msgs.map((m, i) => ({ m, i, c: msgChars(m) })).sort((a, b) => b.c - a.c).slice(0, 4).filter(x => x.c > 2000);
  const total = rows.reduce((a, r) => a + r[1], 0);
  rows.sort((a, b) => b[1] - a[1]);
  return { lim, total, rows, big: big.map(x => `${x.m.role}${x.m.tool_name ? ' ' + x.m.tool_name : ''}: ~${fmtK(tok(x.c))} (${String(x.m.content || '').slice(0, 60).replace(/\s+/g, ' ')}…)`) };
}
function showContext() {
  const r = contextReport(); const pct = x => Math.round(100 * x / r.lim);
  const d = document.createElement('details'); d.className = 'compact-card'; d.open = true;
  d.innerHTML = `<summary><span class="compact-ic">▤</span><span>Context: ~${fmtK(r.total)} of ${fmtK(r.lim)} tokens (${pct(r.total)}%)</span><span class="hud">${esc(S.model)} · ${esc(providerName())}</span></summary><div class="compact-body mono text-xs" style="white-space:pre-wrap"></div>`;
  d.querySelector('.compact-body').textContent = r.rows.map(([l, t]) => `${String('~' + fmtK(t)).padStart(7)}  ${l}`).join('\n')
    + (r.big.length ? `\n\nLargest messages:\n${r.big.map(s => '  ' + s).join('\n')}` : '')
    + `\n\nThe limit is ${activeProv === 'local' ? 'Config → Context window (num_ctx)' : 'what the provider reported'}. Long chats are compacted automatically before they overflow; /compact does it now, /new starts fresh.`;
  chatEl.appendChild(d); scrollDown(true);
}
