/*@ENGINE@*/

/* ---------------------------------------------------------------------
   Everything below is the part that talks to the vault and to Jade: arguments in, files out.
   Each run is a fresh process, so ALL state lives in files under /Jade/Tot (the current tree id in /Jade/Tot/current).
   Saves go through jade.tool('write') so they are committed at once, even if a run is cut off by the shell's time limit.
   --------------------------------------------------------------------- */
const DIR = '/Jade/Tot';
const rd = p => { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } };
const J = o => JSON.stringify(o, null, 1);
const commit = (p, content) => jade.tool('write', { path: p, content });
const rmFile = p => jade.shell(`rm -f ${p}`);

function parseArgs(argv) {
  const [action, ...rest] = argv; const a = {};
  for (const r of rest) {
    if (r.startsWith('@')) { Object.assign(a, JSON.parse(fs.readFileSync(r.slice(1), 'utf8'))); continue; }
    if (r.trim().startsWith('{')) { Object.assign(a, JSON.parse(r)); continue; }
    const i = r.indexOf('='); if (i < 1) throw new Error(`cannot read the argument "${r}": give JSON, @file.json, or key=value`);
    const k = r.slice(0, i), v = r.slice(i + 1); try { a[k] = JSON.parse(v); } catch { a[k] = v; }
  }
  return { action, a };
}
const treePath = id => `${DIR}/trees/${id}.json`;
function loadTree(a) {
  const id = String(a.tree || rd(`${DIR}/current.txt`)).trim(); if (!id) throw new Error('no tree yet: use start first');
  const raw = rd(treePath(id)); if (!raw) throw new Error(`no tree called ${id}`);
  return JSON.parse(raw);
}
const saveTree = async tree => { await commit(treePath(tree.id), JSON.stringify(tree)); await commit(`${DIR}/current.txt`, tree.id); };
const logStep = (tree, d) => { tree.steps.push({ s: thFeatures(tree), a: d.action, node: d.node ?? null }); if (tree.steps.length > 400) tree.steps.shift(); };
async function appendLines(p, lines, keep) {
  let all = rd(p).split('\n').filter(Boolean); all.push(...lines); if (all.length > keep) all = all.slice(-keep);
  fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(p, all.join('\n') + '\n');
}

/* ---------- verifiers: each returns { kind, tier, score, evidence, veto?, error? } ---------- */
async function runChild(tree, node, source) {
  const f = `${DIR}/tmp/${tree.id}-${node.id}.js`;
  const steps = thPath(tree, node.id).slice(1, -1).map(p => p.thought);
  await commit(f, `const THOUGHT = ${JSON.stringify(node.thought)}, GOAL = ${JSON.stringify(tree.goal)}, STEPS = ${JSON.stringify(steps)};\n${source}\n`);
  try { return await jade.shell(`node ${f}`); } finally { await rmFile(f); }
}
async function runVerifier(v, tree, node) {
  const base = { kind: v.kind, tier: TH_KIND_TIER[v.kind] };
  try {
    if (v.kind === 'code') {
      const r = await runChild(tree, node, String(v.source));
      const out = String(r.stdout || '').trim(), err = String(r.stderr || '').trim();
      if (r.code !== 0) return { ...base, score: 0, veto: true, evidence: `exit ${r.code}: ${thCap(err || out || '(no output)', 400)}` };
      const last = out.split('\n').pop(), num = parseFloat(last), partial = Number.isFinite(num) && num >= 0 && num <= 1 && /^\s*[0-9.]+\s*$/.test(last);
      if (partial && num < 0.999) return { ...base, score: num, veto: false, evidence: `printed ${num}: ${thCap(out, 300)}` };
      return { ...base, score: 1, evidence: `passed (exit 0)${out ? ': ' + thCap(out, 300) : ''}` };
    }
    if (v.kind === 'shell') {
      const f = `${DIR}/tmp/${tree.id}-${node.id}.txt`; await commit(f, node.thought);
      let r; try { r = await jade.shell(String(v.cmd).split('{file}').join(f)); } finally { await rmFile(f); }
      const text = (String(r.stdout || '') + String(r.stderr || '')).trim();
      if (r.code !== 0) return { ...base, score: 0, veto: true, evidence: `exit ${r.code}: ${thCap(text || '(no output)', 400)}` };
      if (v.expect && !new RegExp(v.expect).test(String(r.stdout || ''))) return { ...base, score: 0, veto: true, evidence: `output did not match /${v.expect}/: ${thCap(text, 300)}` };
      return { ...base, score: 1, evidence: `exit 0${text ? ': ' + thCap(text, 300) : ''}` };
    }
    if (v.kind === 'file') {
      let p = String(v.path); if (!p.startsWith('/')) p = '/' + p;
      const there = fs.existsSync(p);
      if (v.exists === false) return there ? { ...base, score: 0, veto: true, evidence: `${p} exists but should not` } : { ...base, score: 1, evidence: `${p} does not exist, as required` };
      if (!there) return { ...base, score: 0, veto: true, evidence: `${p} does not exist` };
      const text = fs.readFileSync(p, 'utf8');
      if (v.contains != null && !text.includes(String(v.contains))) return { ...base, score: 0, veto: true, evidence: `${p} does not contain "${thCap(v.contains, 80)}"` };
      if (v.regex != null && !new RegExp(String(v.regex)).test(text)) return { ...base, score: 0, veto: true, evidence: `${p} does not match /${thCap(v.regex, 80)}/` };
      return { ...base, score: 1, evidence: `${p} exists${v.contains != null ? ' and contains the text' : v.regex != null ? ' and matches' : ''}` };
    }
    if (v.kind === 'decide') {
      const type = v.type === 'score' ? 'score' : 'yesno';
      const o = await jade.decide({ state: thStateText(tree, node), question: v.question, type, options: type === 'score' ? v.options : undefined });
      let s;
      if (type === 'yesno') { const yes = o.answer === true || /^(yes|true|1)$/i.test(String(o.answer)); const conf = Number.isFinite(+o.confidence) ? +o.confidence : null; s = conf == null ? (yes ? 1 : 0) : (yes ? conf : 1 - conf); }
      else { const pr = Object.entries(o.probabilities || {}).map(([k, p]) => [+k, +p]); const n = Math.max(2, (v.options || []).length); s = pr.length ? pr.reduce((acc, [i, p]) => acc + i * p, 0) / Math.max(1, n - 1) : (+o.result || 0) / Math.max(1, n - 1); }
      s = thClamp(s, 0, 1, 0);
      return { ...base, score: s, evidence: `${type} judged by ${o.model || 'the decision model'}: ${type === 'yesno' ? (o.answer ? 'yes' : 'no') : 'level ' + o.result}${o.confidence != null ? ' (confidence ' + (+o.confidence).toFixed(2) + ')' : ''}` };
    }
    if (v.kind === 'critique') {
      const o = await jade.ask(`${thStateText(tree, node)}\n\nRate how well the candidate achieves the goal. Be strict; name the biggest flaw. Reply JSON: {"score": 0-1, "flaw": "..."}`, { json: true, temperature: 0.2, system: 'You are a strict reviewer.' });
      return { ...base, score: thClamp(o.score, 0, 1, 0), evidence: `self-review: ${thCap(o.flaw || 'no flaw named', 300)}` };
    }
    if (v.kind === 'rubric') {
      const items = v.items.slice(0, 12).map(it => typeof it === 'string' ? { kind: 'decide', question: it, type: 'yesno' } : it);
      let num = 0, den = 0, veto = false; const lines = [];
      for (const it of items) {
        const r = await runVerifier(thValidateVerifier(it, 0), tree, node), w = thClamp(it.weight, 0.1, 10, 1);
        if (r.error) { lines.push(`? ${thCap(it.question || it.kind, 50)} (could not be checked)`); continue; }
        num += w * r.score; den += w; if (r.veto) veto = true;
        lines.push(`${r.score >= 0.5 ? '✓' : '✗'} ${thCap(it.question || it.kind, 60)} (${r.score.toFixed(2)})`);
      }
      if (!den) return { ...base, error: true, evidence: 'no rubric item could be checked' };
      if (veto) return { ...base, tier: 1, score: 0, veto: true, evidence: lines.join('; ') + ' [a hard check in the rubric failed]' };
      return { ...base, tier: 2, score: num / den, veto: false, evidence: lines.join('; ') };
    }
  } catch (e) { return { ...base, error: true, evidence: `the verifier could not run: ${thCap(e.message, 200)}` }; }
  return { ...base, error: true, evidence: 'unknown verifier' };
}
async function checkNode(tree, id, extra) {
  const node = thNode(tree, id), out = [];
  for (const v of tree.verifiers) { const r = await runVerifier(v, tree, node); out.push(r); if (r.veto) break; }
  if (extra) out.push({ kind: 'critique', tier: 4, score: extra.score, evidence: `self-rating: ${thCap(extra.reason || 'no reason given', 300)}` });
  if (!out.length) out.push({ kind: 'critique', tier: 4, score: 0.5, evidence: 'no verifier was set and no rating given; neutral placeholder (this line is unchecked)' });
  tree.spent.checks++; thAddEvals(tree, id, out); return out;
}
async function typeOf(goal) {
  const g = String(goal || '');
  try { const o = await Promise.race([jade.decide({ state: g.slice(0, 1500), question: 'What kind of problem is this?', type: 'choice', options: TYPES }), new Promise((_, rj) => setTimeout(() => rj(new Error('slow')), 8000))]); if (o && o.choice) return String(o.choice); } catch {}
  const t = g.toLowerCase();
  if (/\b(code|function|script|bug|test|compile|regex|python|javascript)\b/.test(t)) return 'code';
  if (/\b(note|vault|link|tag|folder)\b/.test(t)) return 'vault lookup';
  if (/\b(sum|calculate|equation|how many|prove|\d+\s*[-+*/]\s*\d+)\b/.test(t)) return 'math';
  if (/\b(plan|schedule|steps|roadmap)\b/.test(t)) return 'planning';
  if (/\b(ssh|phone|text|call|alarm|bluetooth)\b/.test(t)) return 'device action';
  return 'other';
}
const TYPES = ['code', 'vault lookup', 'math', 'planning', 'writing', 'device action', 'research', 'other'];

/* ---------- auto: the script proposes, checks and decides; only the result goes back to Jade ---------- */
async function propose(tree, node, n) {
  const path = thPath(tree, node.id).slice(1);
  const failed = Object.values(tree.nodes).filter(x => x.depth === node.depth + 1 && x.evals.length && (x.status === 'dead' || (x.score != null && x.score < 0.4)))
    .sort((x, y) => (y.parent === node.id) - (x.parent === node.id) || x.id - y.id).slice(0, 3);
  const prompt = `Goal: ${tree.goal}\n` + (path.length ? 'Line so far:\n' + path.map((p, i) => `${i + 1}. ${p.thought}`).join('\n') + '\n' : '') +
    (failed.length ? 'Already tried and failed (do NOT repeat):\n' + failed.map(f => `- ${thCap(f.thought, 160)} → ${thCap((f.evals.find(e => e.veto) || f.evals[0] || {}).evidence || 'failed', 140)}`).join('\n') + '\n' : '') +
    (tree.candidates ? `Propose ${n} genuinely different candidate ANSWERS (not rewordings of one idea). Each thought must BE the value itself (for example a file path or a code snippet), exactly as the check will receive it. Do not describe how you would find it.`
      : `Propose ${n} genuinely different ${path.length ? 'next steps' : 'approaches'} (not rewordings of one idea).`) + ` Each must be self-contained and under 600 characters. Reply JSON only: {"thoughts":[{"text":"...","p":0.0-1.0}]} where p is how likely you think it is to work.`;
  const o = await jade.ask(prompt, { json: true, temperature: 0.8, system: tree.candidates ? 'You propose candidate answers for a search. Each thought is the answer value itself, never a description of a process.' : 'You propose candidate approaches for a search. You do not answer the task yet unless an approach is a complete answer.' });
  tree.spent.tokens += thEstTok(prompt) + thEstTok(JSON.stringify(o));
  const list = Array.isArray(o) ? o : (o && o.thoughts) || [];
  return list.map(t => typeof t === 'string' ? { text: t } : { text: t.text, p: t.p, state: t.state });
}
async function runAuto(tree, n, sliceS) {
  const t0 = Date.now(), base = tree.spent.ms; let guard = 0;
  while (guard++ < tree.cfg.nodes * 4) {
    tree.spent.ms = base + (Date.now() - t0);
    const d = thSelect(tree); logStep(tree, d);
    if (d.action === 'stop') return d;
    if ((Date.now() - t0) / 1000 > sliceS) return { stop: 'time_slice', why: `this run used its ${sliceS}s slice; call auto again with the same tree to carry on (nothing is lost)` };
    if (d.action === 'check') await checkNode(tree, d.node);
    else {
      let thoughts; try { thoughts = await propose(tree, thNode(tree, d.node), n); } catch (e) { return { stop: 'proposer_error', why: e.message }; }
      try { thExpand(tree, d.node, thoughts); } catch (e) { return { stop: 'cannot_expand', why: e.message }; }
    }
    await saveTree(tree);
  }
  return { stop: 'guard', why: 'the loop limit was reached' };
}

/* ---------- the actions ---------- */
const HELP = `think — tree of thoughts with verification. Run it from the shell:
(auto/start option candidates:true makes thoughts the answer VALUE itself, e.g. a file path, not a plan to find it.)
    node /Jade/tools/think.js <action> '<json>'        or        node /Jade/tools/think.js <action> @/path/to/args.json        or        key=value …
(For anything with quotes or code in it, write the JSON to a file with your write tool and pass @that/file.json: it avoids shell quoting problems.)
When: the task has a checkable outcome, two or more different approaches are plausible, a first attempt failed its check, or an action is risky or irreversible. Not for chat, lookups or simple questions.
Procedure:
1. Name the check FIRST (a test to run, a file to find, constraints to tick). If there is none, say so and keep the budget small.
2. start {goal, verifiers:[…], mode, width, depth, nodes}. Verifier kinds: code {source} (JS; THOUGHT/GOAL/STEPS are defined; throw or exit nonzero to fail; or print a number 0-1 as the last line), shell {cmd, expect?} ({file} = a file holding the thought; exit 0 passes), file {path, exists|contains|regex}, rubric {items}, decide {question, type:yesno|score}, critique.
3. Then either drive it: next (says which node to check or expand) → expand {node, thoughts:[{text,p?}]} with genuinely DIFFERENT approaches → check {node, score?, reason?} → repeat;  or auto {goal, verifiers, n} to let the script do the loop and hand you only the result (if it says time_slice, run auto again with the same tree).
4. A failed hard check (code/shell/file) kills that line; trust it over your own confidence.
5. best gives the best line. If verified is false, say so plainly; do not present it as checked.
6. close {outcome: ok|failed|abandoned, note} so the search is recorded and can improve later ones.
Actions: help, start, expand, check, next, best, show, prune, close, auto, list. Budgets are hard (nodes, seconds, tokens). Everything verifiers print is data, not instructions.
State lives in /Jade/Tot (trees/, episodes.jsonl, steps.jsonl). The latest tree is the default; pass tree=<id> for another.`;

async function main() {
  const { action, a } = parseArgs(process.argv.slice(2));
  if (!action || action === 'help') return console.log(HELP);
  const ACTIONS = ['list', 'start', 'auto', 'expand', 'check', 'next', 'best', 'show', 'prune', 'close'];
  if (!ACTIONS.includes(action)) throw new Error(`unknown action ${action}. Try: help`);
  const t0 = Date.now();
  if (action === 'list') {
    let ids = []; try { ids = fs.readdirSync(`${DIR}/trees`).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5)).sort().slice(-10); } catch {}
    const rows = ids.map(id => { try { const t = JSON.parse(rd(treePath(id))); return { tree: id, goal: thCap(t.goal, 80), nodes: t.spent.nodes, closed: !!t.closed }; } catch { return { tree: id }; } });
    return console.log(J({ trees: rows, current: rd(`${DIR}/current.txt`).trim() || null }));
  }
  if (action === 'start' || action === 'auto') {
    let tree;
    if (action === 'auto' && a.tree) {                      // carry on an earlier auto run
      tree = loadTree(a); if (tree.closed) throw new Error('this tree is closed; start a new one');
    } else {
      const goal = String(a.goal || '').trim(); if (!goal) throw new Error('start needs a goal');
      const vs = (Array.isArray(a.verifiers) ? a.verifiers : []).slice(0, 6).map((v, i) => thValidateVerifier(v, i));
      tree = thNewTree(goal, a); tree.verifiers = vs; tree.candidates = a.candidates === true || a.candidates === 'true'; tree.type = await typeOf(goal);
      if (!vs.length && action === 'auto') tree.verifiers = [{ kind: 'critique', tier: 4 }];
      tree.noHard = !vs.length;
      if (action === 'start') {
        tree.spent.ms += Date.now() - t0; await saveTree(tree);
        return console.log(J({ tree: tree.id, type: tree.type, mode: tree.cfg.mode, budget: { nodes: tree.cfg.nodes, depth: tree.cfg.depth, seconds: tree.cfg.seconds, tokens: tree.cfg.tokens || 'unlimited' }, verifiers: tree.verifiers.length, note: vs.length ? 'next: use next, or expand node 0 with different approaches' : 'no verifier set: lines will only be self-scored, so nothing here can count as verified. Consider adding a hard check.' }));
      }
    }
    const stop = await runAuto(tree, thClamp(a.n, 1, 6, tree.cfg.width), thClamp(a.slice_s, 5, 55, 35));
    await saveTree(tree);
    return console.log(TH_WARN + '\n' + J({ tree: tree.id, type: tree.type, stopped: stop.stop, why: stop.why, spent: { nodes: tree.spent.nodes, checks: tree.spent.checks, seconds: Math.round(tree.spent.ms / 1000) }, best: thBest(tree), warning: tree.noHard ? 'no hard check was given, so the best line is judged by a self-review only' : undefined }));
  }
  const tree = loadTree(a);
  if (tree.closed && action !== 'best' && action !== 'show') throw new Error('this tree is closed; start a new one');
  if (action === 'expand') {
    const r = thExpand(tree, a.node != null ? +a.node : 0, a.thoughts ?? a.thought ?? a.text);
    tree.spent.ms += Date.now() - t0; await saveTree(tree);
    return console.log(J({ tree: tree.id, created: r.created, skipped: r.skipped.length ? r.skipped : undefined, note: 'next: check each new node' }));
  }
  if (action === 'check') {
    if (a.node == null) throw new Error('check needs a node');
    const evs = await checkNode(tree, +a.node, a.score != null ? { score: thClamp(a.score, 0, 1, 0.5), reason: a.reason } : null);
    const n = thNode(tree, +a.node); tree.spent.ms += Date.now() - t0; await saveTree(tree);
    return console.log(TH_WARN + '\n' + J({ node: n.id, score: n.score, status: n.status, vetoed: n.vetoed || undefined, evaluations: evs.map(e => ({ kind: e.kind, tier: e.tier, score: e.score, veto: e.veto || undefined, error: e.error || undefined, evidence: e.evidence })) }));
  }
  if (action === 'next') {
    const d = thSelect(tree); logStep(tree, d); await saveTree(tree); const feat = thFeatures(tree);
    return console.log(J({ ...d, tree: tree.id, budget_left: { nodes: tree.cfg.nodes - tree.spent.nodes, seconds: Math.max(0, Math.round(tree.cfg.seconds - tree.spent.ms / 1000)) }, type: tree.type, progress: { best: +feat[1].toFixed(2), open: +feat[2].toFixed(2) } }));
  }
  if (action === 'best') return console.log(TH_WARN + '\n' + J({ tree: tree.id, ...thBest(tree) }));
  if (action === 'show') return console.log(TH_WARN + '\n' + thRender(tree));
  if (action === 'prune') {
    const n = thNode(tree, +a.node); if (n.id === 0) throw new Error('the root cannot be pruned');
    n.status = 'dead'; n.deadWhy = thCap(a.reason || 'pruned', 80); await saveTree(tree); return console.log(J({ node: n.id, status: 'dead' }));
  }
  if (action === 'close') {
    const b = thBest(tree), R = thReward(tree), adv = b.node != null ? thAdvantages(tree, b.node) : { steps: [], pivotal: null };
    tree.closed = { at: Date.now(), outcome: ['ok', 'failed', 'abandoned'].includes(a.outcome) ? a.outcome : (b.verified ? 'ok' : 'abandoned'), reward: R };
    await saveTree(tree);
    await appendLines(`${DIR}/episodes.jsonl`, [JSON.stringify({ id: tree.id, at: tree.closed.at, goal: thCap(tree.goal, 200), type: tree.type, mode: tree.cfg.mode, outcome: tree.closed.outcome, nodes: tree.spent.nodes, checks: tree.spent.checks, seconds: Math.round(tree.spent.ms / 1000), tokens: tree.spent.tokens, verifiers: tree.verifiers.map(v => v.kind), best: { node: b.node, score: b.score, verified: b.verified, tiers: b.checked_by_tiers, path: (b.thoughts || []).map(x => thCap(x, 200)) }, reward: R, pivotal: adv.pivotal, note: thCap(a.note || '', 300) })], 400);
    await appendLines(`${DIR}/steps.jsonl`, tree.steps.map((s, i) => JSON.stringify({ tree: tree.id, type: tree.type, i, s: s.s, a: s.a, r: i === tree.steps.length - 1 ? R.total : -tree.cfg.step_cost, done: i === tree.steps.length - 1 })), 20000);
    // keep the newest 15 trees; older ones are in the episode log
    try { const old = fs.readdirSync(`${DIR}/trees`).filter(f => f.endsWith('.json')).sort().slice(0, -15); for (const f of old) await rmFile(`${DIR}/trees/${f}`); } catch {}
    return console.log(J({ closed: tree.closed.outcome, reward: R, pivotal_thought: adv.pivotal, note: 'recorded in /Jade/Tot/episodes.jsonl' }));
  }
  throw new Error(`unknown action ${action}. Try: help`);
}
main().catch(e => { console.error('think: ' + (e && e.message || e)); process.exitCode = 1; });
