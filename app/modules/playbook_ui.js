/* =====================================================================
   PLAYBOOKS TAB: list, read, edit (JSON), run, delete. The files are plain JSON in /Pandora/Playbooks.
   ===================================================================== */
const PUI = { view: 'list', name: '', text: '', errs: [], runId: null, info: '', isNew: false };
const PB_EXAMPLES = [
  { name: 'Morning check', description: 'Count the notes tagged #todo and write a line to a log', playbook: { description: 'Count the notes tagged #todo and write a line to a log', vars: { tag: 'todo' }, tasks: [
    { name: 'Search notes', do: 'notes_search', query: '#{{ tag }}', limit: 30, register: 'found' },
    { name: 'Must find something', do: 'assert', that: ["len(found) > 0"], msg: 'no notes with that tag' },
    { name: 'Log it', do: 'save', path: '/Pandora/Playbooks/out/morning.log', value: '{{ today() }}: {{ len(split(found, "\\n")) }} lines', append: true }] } },
  { name: 'Page price', description: 'Read a price from a web page and stop if it is too high', playbook: { description: 'Read a price from a web page and stop if it is too high', allow_hosts: ['shop.example'], vars: { max: 50 }, tasks: [
    { do: 'browser.goto', url: 'https://shop.example/lamp' },
    { do: 'browser.extract', css: '.price', register: 'price' },
    { do: 'assert', that: ['price | float <= max'], msg: 'too expensive: {{ price }}' },
    { do: 'save', path: '/Pandora/Playbooks/out/price.txt', value: '{{ price }}' }] } },
  { name: 'Retry until ready', description: 'Poll a tool until the answer contains "ready", with a rescue path', playbook: { description: 'Poll until ready', tasks: [
    { block: [{ name: 'Poll', do: 'web_fetch', url: 'https://example.com/status', register: 'status', until: "'ready' in result", retries: 5, delay: 10 }], rescue: [{ do: 'debug', msg: 'gave up: {{ error }}' }], always: [{ do: 'debug', msg: 'done' }] }] } },
];
const pbEl = () => $('#playbooksPanel');
function pbRunUi() { if (PUI.view === 'run' && $('[data-panel="playbooks"]') && !$('[data-panel="playbooks"]').hidden) pbRender(); else pbBadge(); }
function pbBadge() { const b = $('#pbBadge'); if (b) { const n = PB_RUNS.active.size; b.hidden = !n; b.textContent = n; } }
const pbSt = s => `<span class="fl-st fl-st-${esc(s === 'failed' ? 'error' : s)}">${s === 'ok' ? '✓ ok' : s === 'error' || s === 'failed' ? '✗ failed' : s === 'running' ? '● running' : s === 'skipped' ? '– skipped' : s === 'ignored' ? '~ ignored' : esc(s)}</span>`;
function pbRender() {
  const el = pbEl(); if (!el) return; pbBadge();
  el.innerHTML = PUI.view === 'edit' ? pbEditHtml() : PUI.view === 'run' ? pbRunHtml() : pbListHtml();
}
function pbListHtml() {
  const rows = pbList(), recent = PB_RUNS.recent.slice(0, 8), active = [...PB_RUNS.active.values()];
  return `<div class="flex items-center justify-between gap-2"><div class="pane-h">Playbooks</div><div class="flex gap-1"><button class="btn btn-ghost" data-pa="ask">Ask Pandora</button><button class="btn btn-solid cut cut-sm" data-pa="new">+ New</button></div></div>
  <p class="hint leading-relaxed">Saved lists of tasks, like Ansible in JSON: any of Pandora's tools and the browser, with variables, when, loop, retries and rescue. They run without the model, here, from a schedule or a flow, or when Pandora runs them. Plain JSON files in <span class="mono text-cy">/Pandora/Playbooks</span>; changed ones ask you to approve before they run on their own.</p>
  ${PUI.info ? `<div class="fl-err">${esc(PUI.info)}</div>` : ''}
  <div class="fl-new" id="pbNew" hidden><div class="lbl">Start from</div>${PB_EXAMPLES.map((x, i) => `<button type="button" class="fl-ex" data-pa="example" data-i="${i}"><b>${esc(x.name)}</b><span>${esc(x.description)}</span></button>`).join('')}<button type="button" class="fl-ex" data-pa="example" data-i="-1"><b>Empty</b><span>one task to start from</span></button></div>
  ${active.length ? `<div class="fl-active">${active.map(r => `<button type="button" class="fl-runrow" data-pa="openrun" data-id="${r.id}">${pbSt('running')} <b>${esc(r.playbook)}</b> <span class="hint">${r.log.length} tasks so far</span></button>`).join('')}</div>` : ''}
  <div class="flex flex-col gap-2" id="pbCards">${rows.length ? rows.map(r => {
    const last = PB_RUNS.recent.find(x => x.playbook === r.name);
    return `<div class="sched-card fl-card" data-name="${esc(r.name)}"><div class="flex items-center gap-2"><span class="sched-name flex-1 min-w-0 truncate">${esc(r.name)}</span><span class="hud ${r.approved ? '' : 'text-yl'}">${r.approved ? 'approved' : 'NOT approved'}</span></div>
      ${r.bad ? `<div class="mono text-[11.5px] text-rd">${esc(r.bad)}</div>` : ''}${r.description ? `<div class="sched-prompt">${esc(r.description)}</div>` : ''}
      <div class="hud">${r.tasks} task${r.tasks === 1 ? '' : 's'} · ${last ? `last ${pbSt(last.status)} ${esc(relTime(last.started))}` : 'never run here'}</div>
      <div class="flex gap-1 flex-wrap"><button class="btn btn-ghost" data-pa="run">Run</button><button class="btn btn-ghost" data-pa="edit">Open</button><button class="btn btn-ghost" data-pa="dup">Duplicate</button><button class="btn btn-ghost" data-pa="del">Delete</button></div></div>`; }).join('') : `<div class="text-sm text-dim leading-relaxed border border-dashed border-line p-4">No playbooks yet. Press <b class="text-yl">+ New</b> to start from an example, or ask Pandora: <span class="mono text-cy">make a playbook that checks the lamp price every morning</span>.</div>`}</div>
  ${recent.length ? `<div class="pane-h mt-2">Recent runs</div><div class="flex flex-col">${recent.map(r => `<button type="button" class="fl-runrow" data-pa="openrun" data-id="${r.id}">${pbSt(r.status)} <b>${esc(r.playbook)}</b> <span class="hint">${esc(relTime(r.started))} · ${((r.ended - r.started) / 1000).toFixed(1)} s · ${esc(r.via)}</span></button>`).join('')}</div>` : ''}`;
}
function pbEditHtml() {
  return `<div class="flex items-center gap-2"><button class="btn btn-ghost" data-pa="back">← Playbooks</button><input class="field fl-title flex-1 min-w-0" id="pbName" value="${esc(PUI.name)}" placeholder="Playbook name" aria-label="Playbook name" ${PUI.isNew ? '' : 'readonly'}><button class="btn btn-solid cut cut-sm" data-pa="save">Save</button></div>
  <div class="flex items-center gap-2 flex-wrap"><button class="btn btn-ghost" data-pa="check">Check</button><button class="btn btn-ghost" data-pa="plan">Plan</button>${PUI.isNew ? '' : '<button class="btn btn-ghost" data-pa="runedit">Run</button>'}<span class="hint flex-1">Saving here counts as your approval.</span></div>
  <div class="fl-errs" id="pbErrs" ${PUI.errs.length ? '' : 'hidden'}>${PUI.errs.length ? 'Problems:<ul>' + PUI.errs.map(e => `<li>${esc(e)}</li>`).join('') + '</ul>' : ''}</div>
  ${PUI.plan ? `<pre class="fl-out">${esc(PUI.plan)}</pre>` : ''}
  <textarea class="field mono fl-json" id="pbJson" rows="24" spellcheck="false" autocapitalize="off">${esc(PUI.text)}</textarea>`;
}
function pbRunHtml() {
  const run = PB_RUNS.active.get(PUI.runId) || PB_RUNS.recent.find(r => r.id === PUI.runId);
  if (!run) return `<div><button class="btn btn-ghost" data-pa="back">← Playbooks</button></div><p class="hint">That run is gone.</p>`;
  const live = run.status === 'running', res = run.result, show = v => { let s; try { s = typeof v === 'string' ? v : JSON.stringify(v, null, 2); } catch { s = String(v); } return esc(s ?? 'null'); };
  return `<div class="flex items-center gap-2"><button class="btn btn-ghost" data-pa="back">← Playbooks</button><div class="sched-name flex-1 min-w-0 truncate">${esc(run.playbook)}</div></div>
  <div class="hud">${pbSt(run.status)} · ${live ? 'running for ' + ((Date.now() - run.started) / 1000).toFixed(0) + ' s' : ((run.ended - run.started) / 1000).toFixed(2) + ' s'} · via ${esc(run.via)} · ${esc(new Date(run.started).toLocaleString())}</div>
  ${run.error ? `<div class="fl-err">${esc(run.error)}</div>` : ''}${res ? `<div class="hud">ok ${res.recap.ok} · skipped ${res.recap.skipped} · failed ${res.recap.failed} · ignored ${res.recap.ignored} · rescued ${res.recap.rescued}</div>` : ''}
  <div class="pane-h mt-1">Tasks</div><div class="flex flex-col gap-1">${run.log.length ? run.log.map(l => `<div class="fl-srow ${l.status === 'failed' ? 'bad' : ''}" style="margin-left:${Math.min(5, l.depth || 0) * 14}px">${pbSt(l.status)} <b>${esc(l.name || l.do)}</b> <span class="hint">${esc(l.name ? l.do : '')}${l.ms ? ' · ' + l.ms + ' ms' : ''}</span>${l.note ? `<div class="hint mono">${esc(l.note)}</div>` : ''}</div>`).join('') : '<p class="hint">No tasks ran.</p>'}</div>
  ${res ? `<div class="pane-h mt-2">Variables</div><pre class="fl-out">${show(res.vars)}</pre>` : ''}`;
}
async function pbRunNamed(name, via = 'ui') {
  PUI.info = '';
  try {
    const pb = pbLoad(name); if (!(await pbApprove(pb, 'Run this playbook?'))) { PUI.info = `"${name}" was not approved, so it did not run.`; pbRender(); return; }
    const p = pbRun(pb, { via }); const id = [...PB_RUNS.active.keys()].at(-1); PUI.view = 'run'; PUI.runId = id; pbRender();
    const t = setInterval(() => { if (PUI.view === 'run' && PUI.runId === id && PB_RUNS.active.has(id)) pbRender(); else clearInterval(t); }, 700);
    await p.catch(e => { PUI.info = e.message; }); pbRender();
  } catch (e) { PUI.info = e.message; PUI.view = 'list'; pbRender(); }
}
function pbParseText() { let pb; try { pb = JSON.parse($('#pbJson').value); } catch (e) { return { errs: ['not valid JSON: ' + e.message] }; } return { pb, errs: pbValidate(pb, activeTools().map(t => t.function.name)) }; }
function pbOpen(name, text, isNew) { PUI.view = 'edit'; PUI.name = name; PUI.text = text; PUI.errs = []; PUI.plan = ''; PUI.isNew = !!isNew; PUI.info = ''; pbRender(); pbEl()?.parentElement?.scrollTo?.(0, 0); }
document.addEventListener('click', async e => {
  const b = e.target.closest('#playbooksPanel [data-pa]'); if (!b) return; const a = b.dataset.pa, card = b.closest('[data-name]'), name = card?.dataset.name;
  const armed = (label) => { if (!b.classList.contains('armed')) { b.classList.add('armed'); b.textContent = 'Tap again'; setTimeout(() => { if (b.isConnected) { b.classList.remove('armed'); b.textContent = label; } }, 3500); return false; } return true; };
  try {
    if (a === 'new') { const n = $('#pbNew'); if (n) n.hidden = !n.hidden; }
    else if (a === 'example') { const i = +b.dataset.i, ex = PB_EXAMPLES[i]; pbOpen(ex ? ex.name : 'New playbook', JSON.stringify(ex ? ex.playbook : { description: '', tasks: [{ name: 'Say hello', do: 'debug', msg: 'hello' }] }, null, 2), true); }
    else if (a === 'ask') { const inp = $('#chatInput') || $('#input'); setTab('chat'); if (inp) { inp.value = 'Make a playbook that '; inp.focus(); } }
    else if (a === 'back') { PUI.view = 'list'; pbRender(); }
    else if (a === 'edit') pbOpen(name, vfs.read(pbPath(name)), false);
    else if (a === 'dup') { let n = name + ' copy'; while (vfs.isFile(pbPath(n))) n += ' copy'; const pb = JSON.parse(vfs.read(pbPath(name))); pb.name = n; pbOpen(n, JSON.stringify(pb, null, 2), true); }
    else if (a === 'del') { if (!armed('Delete')) return; vfs.rm(pbPath(name)); const ok = ls.get('pbApproved', {}); delete ok[name]; ls.set('pbApproved', ok); pbRender(); }
    else if (a === 'run') await pbRunNamed(name);
    else if (a === 'openrun') { PUI.view = 'run'; PUI.runId = b.dataset.id; pbRender(); }
    else if (a === 'check' || a === 'plan') { const r = pbParseText(); PUI.text = $('#pbJson').value; PUI.errs = r.errs; PUI.plan = a === 'plan' && r.pb && !r.errs.length ? pbPlan(r.pb) : ''; pbRender(); if (!r.errs.length && a === 'check') { $('#pbErrs').hidden = false; $('#pbErrs').textContent = 'No problems found: ' + pbSummary(r.pb).tasks + ' tasks.'; } }
    else if (a === 'save' || a === 'runedit') {
      const r = pbParseText(); PUI.text = $('#pbJson').value; PUI.errs = r.errs;
      if (r.errs.length) { pbRender(); return; }
      const nm = pbName(PUI.isNew ? $('#pbName').value : PUI.name); if (PUI.isNew && vfs.isFile(pbPath(nm))) { PUI.errs = [`a playbook called "${nm}" already exists`]; pbRender(); return; }
      r.pb.name = nm; vfs.write(pbPath(nm), JSON.stringify(r.pb, null, 1), { mkdirs: true });
      const ok = ls.get('pbApproved', {}); ok[nm] = pbHash(pbCanon(r.pb)); ls.set('pbApproved', ok); PUI.name = nm; PUI.isNew = false; PUI.text = JSON.stringify(r.pb, null, 1);
      toast('Playbook saved', 'ok'); if (a === 'runedit') await pbRunNamed(nm); else pbRender();
    }
  } catch (er) { PUI.errs = [er.message]; PUI.view === 'edit' ? pbRender() : (PUI.info = er.message, pbRender()); }
});
Object.assign(window, { pbRender, pbRunUi, pbRunNamed });
