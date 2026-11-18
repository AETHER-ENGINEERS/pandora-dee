# ---------- curiosity: sparks about one thread clustered, and loops halted (asked for by Pandora Dee Fae) ----------
# Exec'd by build.py after vector_digest.py, on the finished page. Each curiosity wake-up (a spark) now names its
# subject when she reports. Wake-ups within two hours of each other on the same subject are one thread: the engine
# keeps one cluster entry for it under /Pandora/Sparks/clusters/, each wake-up a sub-item, and tells her about it at
# the next wake-up so she adds to the thread instead of writing yet another note about it. A third wake-up in a row
# on the same subject halts the chain whether or not the clustering worked: it's filed under
# /Pandora/Sparks/loop-halts/, she leaves one question for the person in Questions.md, and the subject rests for 12
# hours unless the person says otherwise. She can tag a wake-up thread "same" or "new", and the engine learns where
# one thread ends and the next begins.

rep("parameters: { type: 'object', properties: { action: { type: 'string', enum: ['status', 'history', 'menu', 'choose', 'report'] }, activity: { type: 'string' },",
    "parameters: { type: 'object', properties: { action: { type: 'string', enum: ['status', 'history', 'menu', 'choose', 'report'] }, activity: { type: 'string' }, subject: { type: 'string', description: 'report: the one main subject of this wake-up in a few words (\"Lunar Forge pre-brief\"), so wake-ups about one thread are clustered' }, thread: { type: 'string', enum: ['same', 'new'], description: 'report, optional: \"same\" if this continues the thread of your last wake-up even if worded differently, \"new\" if it only looks like it' },")
rep("report {summary, self_score 0-1, next: sooner|later, notify: a short message for {{PERSON_NAME}} only if it really matters}.",
    "report {summary, subject: its main subject in a few words, thread: same|new (optional), self_score 0-1, next: sooner|later, notify: a short message for {{PERSON_NAME}} only if it really matters}. Wake-ups on one subject within two hours are clustered into one entry; three in a row halt that thread until {{PERSON_NAME}} says go on.")

rep("    const f = cuFinish(self, CU.pending.report.summary);",
    "    CU.pending.subject = String(args.subject || '').trim().slice(0, 120); CU.pending.thread = ['same', 'new'].includes(args.thread) ? args.thread : '';\n"
    "    const f = cuFinish(self, CU.pending.report.summary); const sp = f ? spAfter() : '';")
rep("    return f ? `Recorded. Measured:", "    return f ? `${sp}Recorded. Measured:")

rep("note: String(note || '').slice(0, 300), dp: cuDaypart(Date.now()) });",
    "note: String(note || '').slice(0, 300), dp: cuDaypart(Date.now()), subject: P.subject || '', thread: P.thread || '', paths: d.paths || [] });")

rep('`3. Call curiosity with action "report": what you did, what you found, and optionally next:',
    '`3. Call curiosity with action "report": what you did, what you found, its subject in a few words, and optionally next:')
rep("`Rules: never delete anything. When you finish an item",
    "spPromptBlock(st) + `Rules: never delete anything. When you finish an item")

SPARK_JS = r"""
/* ---- sparks about one thread clustered; loops halted (spark_clusters.py) ---- */
const SP_WINDOW = 2 * 3600e3, SP_PAUSE = 12 * 3600e3;
const SP_STOP = new Set('a an and the of for to in on at with about from my our your this that these those is are was be i me it its again more some note notes'.split(' '));
const spWords = s => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, ' ').split(/[\s-]+/).filter(w => w && !SP_STOP.has(w));
const spKey = s => spWords(s).join(' ');
/** What she's taught it: subjects she said were one thread, and ones she said weren't. */
const spLearned = () => ls.get('spThreads', { same: [], apart: [] });
function spSame(a, b) {
  const ka = spKey(a), kb = spKey(b); if (!ka || !kb) return false;
  const L = spLearned(), pair = (x, y) => p => (p[0] === x && p[1] === y) || (p[0] === y && p[1] === x);
  if (L.apart.some(pair(ka, kb))) return false;
  if (ka === kb || L.same.some(pair(ka, kb))) return true;
  const A = new Set(spWords(a)), B = new Set(spWords(b)); let both = 0; for (const w of A) if (B.has(w)) both++;
  return both / Math.min(A.size, B.size) >= 0.6 && both >= Math.min(2, Math.min(A.size, B.size));
}
/** The thread the newest wake-ups are on: the wake-ups in a row on one subject, each within two hours of the next. */
function spRun(log, now = Date.now()) {
  const L = log.filter(e => e.id !== 'rest' && e.subject); if (!L.length) return [];
  const last = L.at(-1); if (now - last.at > SP_WINDOW) return [];
  const run = [last];
  for (let i = L.length - 2; i >= 0; i--) {
    const e = L[i], next = run[0];
    if (next.at - e.at > SP_WINDOW || next.thread === 'new' || !(next.thread === 'same' || spSame(e.subject, next.subject))) break;
    run.unshift(e);
  }
  return run;
}
const spSlug = s => spKey(s).split(' ').slice(0, 6).join(' ') || 'thread';
const spDay = t => new Date(t).toISOString().slice(0, 10);
const spTime = t => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const spItem = e => `- ${spTime(e.at)} · ${e.id}${e.subject ? ` · ${e.subject}` : ''}: ${String(e.note || '').replace(/\s+/g, ' ').slice(0, 300)}${(e.paths || []).filter(p => /\.md$/i.test(p)).length ? ` (${e.paths.filter(p => /\.md$/i.test(p)).slice(0, 4).map(p => `[[${p.replace(/^\//, '').replace(/\.md$/i, '')}]]`).join(', ')})` : ''}`;
const spPaused = () => (ls.get('spPaused', []) || []).filter(p => Date.now() - p.at < SP_PAUSE);
/** After a report: what she taught it, the thread's cluster entry, and a halt on the third in a row. Says what it did. */
function spAfter() {
  const st = cuState(), e = st.log.at(-1); if (!e || !e.subject) return '';
  const L = st.log.filter(x => x.id !== 'rest' && x.subject), prev = L.at(-2);
  if (prev && e.thread && Date.now() - prev.at <= SP_WINDOW) {
    const t = spLearned(), p = [spKey(prev.subject), spKey(e.subject)];
    if (p[0] !== p[1]) { (e.thread === 'same' ? t.same : t.apart).push(p); t.same = t.same.slice(-100); t.apart = t.apart.slice(-100); ls.set('spThreads', t); }
  }
  const run = spRun(st.log); if (run.length < 2) return '';
  const first = run[0], path = e.cluster || first.cluster || `/Pandora/Sparks/clusters/${spDay(first.at)} ${spSlug(first.subject)}.md`;
  const head = `# ${first.subject}\n\nWake-ups on one thread, clustered by the curiosity engine. Each is a sub-item; add to this thread here rather than in new notes. #curiosity #spark-cluster\n\n`;
  const have = vfs.isFile(path) ? vfs.read(path) : head;
  const missing = run.filter(x => !have.includes(spItem(x)));
  vfs.write(path, have.replace(/\n*$/, '\n') + missing.map(spItem).join('\n') + '\n', { mkdirs: true });
  for (const x of run) x.cluster = path; cuSave(st);
  let said = `This continues the thread "${first.subject}" (${run.length} wake-ups in a row), so it's clustered in ${path}. `;
  if (run.length >= 3) {
    const halt = `/Pandora/Sparks/loop-halts/${spDay(e.at)} ${spSlug(first.subject)}.md`;
    vfs.write(halt, `# Loop halt: ${first.subject}\n\n${run.length} curiosity wake-ups in a row on one subject. The chain is halted: ask before continuing. Cluster: [[${path.replace(/^\//, '').replace(/\.md$/i, '')}]]\n\n${run.map(spItem).join('\n')}\n`, { mkdirs: true });
    const Q = '/Pandora/Curiosity/Questions.md', q = `- [ ] ${spDay(e.at)}: I've woken to "${first.subject}" ${run.length} times in a row. Should I keep going on it, or leave it until something changes? ([[${halt.replace(/^\//, '').replace(/\.md$/i, '')}]])`;
    vfs.write(Q, (vfs.isFile(Q) ? vfs.read(Q).replace(/\n*$/, '\n') : '# Questions\n\n') + q + '\n', { mkdirs: true });
    ls.set('spPaused', [...spPaused().filter(p => p.key !== spKey(first.subject)), { key: spKey(first.subject), subject: first.subject, at: Date.now() }]);
    said += `That's ${run.length} in a row: the chain is halted (${halt}), a question for the person is in ${Q}, and the subject rests for 12 hours unless they say go on. `;
  }
  return said;
}
/** What she's told at a wake-up about the thread she's been on, and subjects resting after a halt. */
function spPromptBlock(st) {
  const run = spRun(st.log), paused = spPaused(), out = [];
  if (run.length) {
    const e = run.at(-1);
    out.push(run.length === 1
      ? `Your last wake-up (${spTime(e.at)}) was about "${e.subject}". If you go back to it, report the same subject so the two are clustered, and build on what you wrote then rather than writing another note about it.`
      : `Your last ${run.length} wake-ups were all about "${run[0].subject}"${e.cluster ? `, clustered in ${e.cluster}` : ''}. ${run.length >= 2 ? 'Another one on it would be the third in a row and halt the thread: choose something else, or rest, unless something has really changed (then add to the cluster entry, not a new note).' : ''}`);
    out.push('If this wake-up continues that thread in other words, report thread: "same"; if it only looks like it, thread: "new".');
  }
  if (paused.length) out.push(`Resting after a loop halt, until the person says go on: ${paused.map(p => `"${p.subject}"`).join(', ')}. Leave ${paused.length === 1 ? 'it' : 'them'} alone this time.`);
  return out.length ? `About your recent wake-ups:\n${out.map(x => '- ' + x).join('\n')}\n\n` : '';
}
Object.assign(window, { spSame, spRun, spAfter, spPromptBlock });
"""
rep("/* ---------- finishing a wake: learn from it ---------- */", SPARK_JS + "/* ---------- finishing a wake: learn from it ---------- */")
