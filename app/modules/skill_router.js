/* =====================================================================
   SKILL ROUTER: with many skills, only the ones that fit the message go in the prompt
   ===================================================================== */
// Up to SKILL_ALL_MAX skills are listed in full as before. Past that, each turn lists only the best matches (found by
// keywords + meaning with the vector index, collection "skills") and Jade gets a find_skill tool for the rest.
const SKILL_ALL_MAX = 15, SKILL_TOP = 6;
let skillCtx = { q: '', names: null };            // set before each turn (the prompt builder is synchronous)
const skillActive = () => (typeof listSkills === 'function' ? listSkills().filter(s => !s.off) : []);
const skillRouted = () => skillActive().length > SKILL_ALL_MAX;
function skillStat(name, key) {
  try { const st = ls.get('skillStats', {}); const r = st[name] || (st[name] = { offered: 0, used: 0, found: 0 }); r[key] = (r[key] || 0) + 1; ls.set('skillStats', st); } catch {}
}
const vmemSkillChunks = () => skillActive().map(s => ({ coll: 'skills', src: s.path, head: s.name, text: `${s.name}: ${s.description || ''}`.slice(0, 600) }));

// filler words match almost every description by keyword ("and", "for", "my"), so they are dropped from the search text
const SEARCH_STOP = new Set('a an and are as at be by can do does for from has have how i in into is it its me my of on or our so than that the their then there these they this to up us was we what when where which who why will with would you your please help need want'.split(' '));
const searchText = q => { const w = String(q || '').split(/\s+/).filter(x => x && !SEARCH_STOP.has(x.toLowerCase().replace(/[^a-z0-9]/g, ''))); return w.length ? w.join(' ') : String(q || ''); };
// Skill descriptions are short sentences, so meaning search is the main signal. It is fused (reciprocal rank) with a plain
// whole-word match, not the index's prefix search: prefix/stem matching let unrelated skills ("filler") win on "filing".
async function skillSearch(query, k = SKILL_TOP, strict = false) {
  const all = skillActive(); const byName = new Map(all.map(s => [s.name, s]));
  const qtext = searchText(query); let note = ''; const score = new Map();
  const add = (names, w) => names.forEach((n, i) => score.set(n, (score.get(n) || 0) + w / (60 + i + 1)));
  const qw = new Set(bm25Tokens(qtext).filter(t => t.length > 2));
  const lex = all.map(s => ({ n: s.name, c: [...new Set(bm25Tokens(s.name.replace(/[-_]/g, ' ') + ' ' + (s.description || '')))].filter(t => qw.has(t)).length })).filter(x => x.c).sort((a, b) => b.c - a.c).map(x => x.n);
  add(lex, 1);
  if (S.embedOn !== false) {
    try {
      const r = await Promise.race([vmemSearch(qtext, { colls: ['skills'], k: Math.max(k * 3, 12), mode: 'semantic', sync: true }), new Promise((_, no) => setTimeout(() => no(new Error('timeout')), 6000))]);
      add(r.hits.filter(h => !strict || (h.distance !== null && h.distance < 0.6) || lex.includes(h.head)).map(h => h.head).filter(n => byName.has(n)), 1.2);
      note = r.note || '';
    } catch (e) { note = 'meaning search unavailable (' + e.message + '); word match only'; }
  } else note = 'embeddings are off; word match only';
  const names = [...score.entries()].sort((a, b) => b[1] - a[1]).slice(0, k).map(e => e[0]);
  return { skills: names.map(n => byName.get(n)), note };
}
async function skillPrefetch() {
  if (!skillRouted()) { skillCtx = { q: '', names: null }; return; }
  const q = (typeof memoryQuery === 'function' ? memoryQuery() : '').trim();
  if (!q) { skillCtx = { q: '', names: [] }; return; }
  if (skillCtx.q === q && skillCtx.names) return;
  const r = await skillSearch(q, SKILL_TOP, true); skillCtx = { q, names: r.skills.map(s => s.name) };
  for (const n of skillCtx.names) skillStat(n, 'offered');
}
// the lines for the system prompt (also used by the context report)
function skillLines(skills) {
  const line = s => `- ${s.name}: ${String(s.description).slice(0, 160)}`;
  if (!skillRouted() || !skillCtx.names) return skills.slice(0, 60).map(line).join('\n') + (skills.length > 60 ? `\n- (${skills.length - 60} more: /skills)` : '');
  const show = skillCtx.names.map(n => skills.find(s => s.name === n)).filter(Boolean);
  return (show.map(line).join('\n') || '- (none matched this message)') + `\n(You have ${skills.length} skills; these are the ones that fit this message best. If none fits, call find_skill with a short description of the job to search the rest.)`;
}
async function findSkillTool(args) {
  const q = String(args.query || args.q || '').trim(); if (!q) throw new Error('find_skill needs a query: a short description of the job');
  const r = await skillSearch(q, Math.max(1, Math.min(10, +args.limit || 6)));
  if (!r.skills.length) return `No skill matches "${q}". There are ${skillActive().length} skills; /skills lists them all.`;
  for (const s of r.skills) skillStat(s.name, 'found');
  return `Skills that fit "${q}" (call the skill tool with the name to load one):\n` + r.skills.map(s => `- ${s.name}: ${String(s.description).slice(0, 220)}`).join('\n') + (r.note ? `\n(${r.note})` : '');
}
WORLD_TOOL_DEFS.push({
  name: 'find_skill',
  description: 'Search your skills by what you want to do. Use it when the Skills list in your instructions does not show one that fits (you have more skills than are listed). Returns the best matching skill names and descriptions; then call the skill tool to load one.',
  parameters: { type: 'object', properties: { query: { type: 'string', description: 'A short description of the job, e.g. "turn a transcript into notes"' }, limit: { type: 'number', description: 'How many to return (default 6)' } }, required: ['query'] },
});
Object.assign(window, { searchText, skillRouted, skillPrefetch, skillLines, skillSearch, findSkillTool, vmemSkillChunks, skillStat, SKILL_ALL_MAX, skillCtxGet: () => skillCtx });
