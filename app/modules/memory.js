/* =====================================================================
   LONG-TERM MEMORY
   - /Jade/Memory.md: durable facts, one bullet per line, under sections.
     Injected into every chat's instructions; Jade edits it with the memory tool.
   - /Jade/Journal/YYYY-MM-DD.md: episodic memory. When you leave a chat (or it is
     compacted) the model writes a short entry, and new durable facts it noticed
     are added to Memory.md. Both are ordinary notes you can read and edit.
   ===================================================================== */
const MEM_PATH = '/Jade/Memory.md', JOURNAL_DIR = '/Jade/Journal';
const MEM_SECTIONS = { about: 'About you', preferences: 'Preferences', projects: 'Projects & people', notes: 'Notes to self', learned: 'Learned from chats' };
const MEM_TEMPLATE = `# Memory

Jade reads this note at the start of every chat. Edit it freely: one fact per line.
She adds to it when you tell her something worth keeping (or say "remember…"), and her
chat journal in [[Journal]] adds facts it learns. #memory

## About you

## Preferences

## Projects & people

## Notes to self

## Learned from chats
`;
const memKey = s => String(s).toLowerCase().replace(/\(\d{4}-\d{2}-\d{2}\)/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
function ensureMemory() {
  if (!vfs.isFile(MEM_PATH)) vfs.write(MEM_PATH, MEM_TEMPLATE, { mkdirs: true });
  if (!vfs.isFile('/Jade/Journal.md')) vfs.write('/Jade/Journal.md', `# Journal\n\nJade's diary of past chats, one note per day in the Journal folder. She searches it with the memory tool to recall earlier conversations. #memory\n`, { mkdirs: true });
}
function memoryLines() {
  if (!vfs.isFile(MEM_PATH)) return [];
  let sec = ''; const out = [];
  for (const line of vfs.read(MEM_PATH).split('\n')) {
    const h = /^##\s+(.+)/.exec(line); if (h) { sec = h[1].trim(); continue; }
    const b = /^\s*[-*]\s+(.+)/.exec(line); if (b && b[1].trim()) out.push({ sec, text: b[1].trim(), line });
  }
  return out;
}
function memorySave(text, section) {
  ensureMemory();
  text = String(text || '').replace(/\s+/g, ' ').replace(/^[-*]\s+/, '').trim();
  if (!text) throw new Error('save needs text');
  const k = memKey(text);
  const dup = memoryLines().find(m => { const mk = memKey(m.text); return mk === k || (k.length > 12 && (mk.includes(k) || k.includes(mk) && mk.length > 12)); });
  if (dup) return { added: false, msg: `Already remembered: "${dup.text}"` };
  const head = MEM_SECTIONS[section] || (Object.values(MEM_SECTIONS).includes(section) ? section : MEM_SECTIONS.notes);
  const lines = vfs.read(MEM_PATH).split('\n');
  let i = lines.findIndex(l => new RegExp('^##\\s+' + head.replace(/[.*+?^${}()|[\]\\&]/g, '\\$&') + '\\s*$', 'i').test(l));
  if (i < 0) { lines.push('', '## ' + head); i = lines.length - 1; }
  let j = i + 1; while (j < lines.length && !/^##\s/.test(lines[j])) j++;
  while (j > i + 1 && !lines[j - 1].trim()) j--;   // insert after the section's last bullet
  lines.splice(j, 0, `- ${text} (${todayStr()})`);
  vfs.write(MEM_PATH, lines.join('\n').replace(/\n{3,}/g, '\n\n'));
  return { added: true, msg: `Saved to memory under "${head}": ${text}` };
}
function memoryForget(text) {
  const k = memKey(text); if (!k) throw new Error('forget needs the text (or part of it) to remove');
  const hits = memoryLines().filter(m => memKey(m.text).includes(k));
  if (!hits.length) throw new Error(`Nothing in memory matches "${text}". Use action "list" to see what is stored.`);
  if (hits.length > 3) throw new Error(`${hits.length} memories match "${text}"; be more specific:\n${hits.map(h => '- ' + h.text).join('\n')}`);
  const drop = new Set(hits.map(h => h.line));
  vfs.write(MEM_PATH, vfs.read(MEM_PATH).split('\n').filter(l => !drop.has(l)).join('\n'));
  return `Forgot ${hits.length}: ${hits.map(h => '"' + h.text + '"').join(', ')}`;
}
function memorySearch(query, limit = 15) {
  const terms = memKey(query).split(' ').filter(t => t.length > 1);
  const res = [];
  const files = [MEM_PATH, ...[...vfs.nodes.keys()].filter(p => p.startsWith(JOURNAL_DIR + '/') && isNote(p)).sort().reverse()];
  for (const f of files) {
    if (!vfs.isFile(f)) continue; let head = '';
    for (const line of vfs.read(f).split('\n')) {
      if (/^#{1,3}\s/.test(line)) { head = line.replace(/^#+\s*/, ''); continue; }
      if (!line.trim()) continue;
      const lk = memKey(line); const score = terms.length ? terms.filter(t => lk.includes(t)).length : 1;
      if (score) res.push({ f, head, line: line.trim(), score: score + (f === MEM_PATH ? 0.5 : 0) });
    }
  }
  res.sort((a, b) => b.score - a.score);
  return res.slice(0, limit);
}
function memoryTool(args) {
  const a = String(args.action || '').toLowerCase();
  if (a === 'save' || a === 'remember' || a === 'add') return memorySave(args.text ?? args.fact ?? args.content, String(args.section || '').toLowerCase()).msg;
  if (a === 'forget' || a === 'remove' || a === 'delete') return memoryForget(args.text ?? args.query);
  if (a === 'search' || a === 'recall') {
    const r = memorySearch(args.text ?? args.query ?? '', 15);
    return r.length ? r.map(x => `${x.f === MEM_PATH ? 'memory' : noteName(x.f)}${x.head && x.f !== MEM_PATH ? ' · ' + x.head : ''}: ${x.line.slice(0, 300)}`).join('\n') : 'Nothing found in memory or the journal. Try notes_search for the rest of the vault.';
  }
  if (a === 'list' || !a) { ensureMemory(); return vfs.read(MEM_PATH); }
  throw new Error(`unknown action "${a}" (use save, search, forget or list)`);
}
/* ---------- BM25 retrieval (Okapi BM25, same scoring as Python's rank_bm25.BM25Okapi) ----------
   Optional (Settings → Long-term memory → "Rank memories with BM25"). Instead of pasting the
   newest memory lines up to a budget, only the lines that best match the user's current
   message are put in the system prompt. Everything stays on the device. */
const BM25_STOP = new Set('a an and are as at be but by for from had has have he her his i if in into is it its me my of on or our she so that the their them then there they this to was we were what when where which who will with you your do does did can could would should about just not no yes am been being than too very also how why'.split(' '));
function bm25Tokens(text) {
  const out = [];
  for (let w of String(text).toLowerCase().replace(/\(\d{4}-\d{2}-\d{2}\)/g, ' ').split(/[^\p{L}\p{N}]+/u)) {
    if (w.length < 2 || BM25_STOP.has(w)) continue;
    if (w.length > 4 && /[a-z]$/.test(w)) w = w.replace(/(ing|ed|es|s)$/, '');   // tiny stemmer: likes/liking/liked → lik
    out.push(w);
  }
  return out;
}
class BM25Okapi {
  constructor(corpus, { k1 = 1.5, b = 0.75, epsilon = 0.25 } = {}) {
    this.k1 = k1; this.b = b; this.N = corpus.length;
    this.tf = corpus.map(doc => { const m = new Map(); for (const t of doc) m.set(t, (m.get(t) || 0) + 1); return m; });
    this.len = corpus.map(d => d.length);
    this.avgdl = this.N ? this.len.reduce((a, c) => a + c, 0) / this.N : 0;
    const nd = new Map(); for (const m of this.tf) for (const t of m.keys()) nd.set(t, (nd.get(t) || 0) + 1);
    this.idf = new Map(); let sum = 0; const neg = [];
    for (const [t, n] of nd) { const v = Math.log((this.N - n + 0.5) / (n + 0.5)); this.idf.set(t, v); sum += v; if (v < 0) neg.push(t); }
    // rank_bm25: words that occur in over half the documents get epsilon * average idf instead of a negative weight
    const floor = Math.max(epsilon * (nd.size ? sum / nd.size : 0), 0.01);
    for (const t of neg) this.idf.set(t, floor);
  }
  scores(query) {
    const sc = new Array(this.N).fill(0);
    for (const q of new Set(query)) {
      const idf = this.idf.get(q); if (idf === undefined) continue;
      for (let i = 0; i < this.N; i++) {
        const f = this.tf[i].get(q); if (!f) continue;
        sc[i] += idf * (f * (this.k1 + 1)) / (f + this.k1 * (1 - this.b + this.b * this.len[i] / (this.avgdl || 1)));
      }
    }
    return sc;
  }
}
let bm25Cache = { key: null, mem: null, idx: null };
function memoryRank(query, k) {
  const mem = memoryLines(); if (!mem.length) return { hits: [], total: 0 };
  const key = mem.map(m => m.text).join('\n');
  if (bm25Cache.key !== key) bm25Cache = { key, mem, idx: new BM25Okapi(mem.map(m => bm25Tokens(m.text))) };
  const q = bm25Tokens(query);
  const sc = q.length ? bm25Cache.idx.scores(q) : [];
  const hits = sc.map((s, i) => ({ ...mem[i], score: s, i })).filter(h => h.score > 0).sort((a, b) => b.score - a.score || b.i - a.i).slice(0, k);
  return { hits, total: mem.length };
}
// the text we match memories against: the last couple of things the user said in this chat
function memoryQuery() {
  try {
    const us = (typeof cur !== 'undefined' && cur?.messages || []).filter(m => m.role === 'user');
    return us.slice(-2).map(m => String(m.display || m.content || '')).join('\n').slice(-1500);
  } catch { return ''; }
}

// what goes into the system prompt
function memoryContext() {
  if (!S.memoryOn) return '';
  ensureMemory();
  const days = [...vfs.nodes.keys()].filter(p => p.startsWith(JOURNAL_DIR + '/') && isNote(p)).sort().slice(-2);
  let jr = days.map(p => vfs.read(p).replace(/^#[^\n]*\n/, '').replace(/#journal/g, '').trim()).join('\n').trim();
  if (jr.length > 1400) jr = '…' + jr.slice(-1400);
  const journal = jr ? `\n\nRecent journal (earlier chats; memory search finds older ones):\n${jr}` : '';
  const mem = memoryLines();
  if (S.memoryRag) {
    const K = Math.max(1, Math.min(30, +S.memoryRagK || 8));
    const q = memoryQuery();
    const { hits, total } = memoryRank(q, K);
    let lines, note;
    if (hits.length) { lines = hits.map(h => `- ${h.text}${h.sec ? ` [${h.sec}]` : ''}`); note = `the ${hits.length} of ${total} memory lines that best match the user's message`; }
    else { lines = mem.slice(-5).map(m => `- ${m.text}${m.sec ? ` [${m.sec}]` : ''}`); note = q.trim() ? `nothing matched this message, so the ${lines.length} newest of ${total} lines` : `the ${lines.length} newest of ${total} lines`; }
    return `\n\nLong-term memory (from the note [[Memory]], ${note}; use memory search for anything else, and keep it current with the memory tool):\n${lines.join('\n') || '(empty so far)'}${journal}`;
  }
  let block = '', used = 0; const budget = 2600;
  const bySec = {}; for (const m of mem) (bySec[m.sec] ||= []).push(m.text);
  const parts = [];
  for (const [sec, items] of Object.entries(bySec)) {
    const keep = []; for (const t of items.slice().reverse()) { if (used + t.length + 4 > budget) break; keep.unshift(t); used += t.length + 4; }
    if (keep.length) parts.push(`${sec}:\n${keep.map(t => '- ' + t).join('\n')}${keep.length < items.length ? `\n- (${items.length - keep.length} older lines: use memory search)` : ''}`);
  }
  block = parts.join('\n') || '(empty so far)';
  return `\n\nLong-term memory (the note [[Memory]]; keep it current with the memory tool):\n${block}${journal}`;
}

/* ---------- journal: summarise a finished chat into episodic memory ---------- */
const JOURNAL_SYS = `You keep Jade's diary. Jade is an AI assistant that manages the user's markdown notes vault. Read the chat and reply in exactly this format:

SUMMARY:
- 2 to 5 short bullets: what the user wanted, what was done or decided, which notes were created or changed (as [[Note Name]]), anything left open.

REMEMBER:
- 0 to 4 bullets of durable facts about the user worth knowing in future chats: who they are, preferences, ongoing projects, people, goals, standing instructions. Only facts the user stated or clearly implied. Write "- none" if there are none.

No other text.`;
const journaling = new Set();
const jMarks = () => ls.get('journaled', {});
async function journalSession(sess, { reason = 'leave', summary = null, upto = null } = {}) {
  if (!S.journalOn || !sess || !S.model) return;
  const done = jMarks()[sess.id] || 0; const msgs = sess.messages || [];
  const end = upto ?? msgs.length;
  const fresh = msgs.slice(done, end).filter(m => m.role !== 'compaction');
  const userTurns = fresh.filter(m => m.role === 'user').length;
  if (!summary && (userTurns < 1 || fresh.length < 2)) return;
  if (journaling.has(sess.id)) return; journaling.add(sess.id);
  try {
    let out = summary;
    if (!out) {
      let text = transcriptOf(fresh); if (text.length > 14000) text = '[…]\n' + text.slice(-14000);
      const r = await fetch(S.host.replace(/\/+$/, '') + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: S.model, stream: false, think: false, messages: [{ role: 'system', content: JOURNAL_SYS }, { role: 'user', content: `Chat title: ${sess.title}\n\n${text}` }], options: { temperature: 0.2, num_ctx: +S.numCtx } }) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      out = String((await r.json()).message?.content || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    }
    if (out.length < 10) throw new Error('empty journal entry');
    const m = /SUMMARY:\s*([\s\S]*?)(?:\n\s*REMEMBER:\s*([\s\S]*))?$/i.exec(out);
    const sum = (m ? m[1] : out).trim();
    const facts = m && m[2] ? m[2].split('\n').map(l => l.replace(/^\s*[-*•]\s*/, '').trim()).filter(l => l && !/^none\.?$/i.test(l) && l.length < 300) : [];
    const day = todayStr(), p = `${JOURNAL_DIR}/Journal ${day}.md`, t = new Date();
    const entry = `\n## ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')} · ${String(sess.title || 'Chat').replace(/\n/g, ' ').slice(0, 70)}\n${sum}\n`;
    if (!vfs.isFile(p)) vfs.write(p, `# Journal ${day}\n\n#journal · [[Journal]]\n`, { mkdirs: true });
    vfs.append(p, entry);
    let learned = 0; for (const f of facts) if (memorySave(f, 'learned').added) learned++;
    const marks = jMarks(); marks[sess.id] = end; ls.set('journaled', marks);
    if (reason !== 'quiet') toast(`Jade wrote today's journal${learned ? ` and learned ${learned} new thing${learned > 1 ? 's' : ''}` : ''}`, 'ok');
  } catch (e) { console.warn('journal failed', e); }
  finally { journaling.delete(sess.id); }
}

let journalT = null;
function scheduleJournal() { clearTimeout(journalT); if (!S.journalOn) return; journalT = setTimeout(() => { if (!running && cur) journalSession(cur, { reason: 'quiet' }); }, 4 * 60e3); }
document.addEventListener('visibilitychange', () => { if (document.hidden && !running && cur) journalSession(cur, { reason: 'quiet' }); });
