/* =====================================================================
   VECTOR MEMORY — embeddings from Ollama, stored with sqlite-vec, searched together with SQLite FTS5.
   - Pandora's embedded SQLite (see sqlite_glue.js) has sqlite-vec 0.1.9 linked in: vec0 tables, vec_distance_*, vec_f32 …
     (also available in the sqlite3 shell, Python and node scripts).
   - /Pandora/.index/vectors.db is an ordinary SQLite file: chunks (text + source), an FTS5 index and a vec0 table.
     It is a cache: delete it and it is rebuilt from the notes.
   - Collections: "memory" (the bullets of /Pandora/Memory.md) and "journal" (one entry per chat) stay in sync by themselves,
     "notes" is the vault (Config → Embeddings → index my notes, or the embeddings tool's index action), and any other
     name is a collection Pandora fills herself with the embeddings tool.
   - Hybrid search = reciprocal rank fusion (k = 60) of the FTS5 keyword ranking and the vec0 nearest neighbours.
     Without embeddings (no model, Ollama off) it quietly falls back to keyword-only, then to the old BM25.
   - SQLite lives in a Web Worker (the browser will not instantiate a 900 KB WebAssembly module on the main thread).
   ===================================================================== */
const VMEM_DB = '/Pandora/.index/vectors.db';
const VMEM_AUTO = ['memory', 'journal'];                 // collections rebuilt from the notes (everything else is Pandora's own)
const VMEM_RRF = 60;
const vmemWorkerSrc = () => `
let S = null, db = null;
self.onmessage = (ev) => {
  const { id, op, a } = ev.data;
  try {
    let out = true;
    if (op === 'init') { S = __jvSqlite(a.module); db = new S.Database(a.bytes || undefined); out = db.exec('select vec_version(), sqlite_version()')[0].values[0]; }
    else if (op === 'sql') out = db.exec(a.sql, a.params);
    else if (op === 'tx') { db.exec('BEGIN'); try { for (const [sql, p] of a.stmts) db.exec(sql, p); db.exec('COMMIT'); } catch (e) { try { db.exec('ROLLBACK'); } catch (_) {} throw e; } }
    else if (op === 'export') { const b = db.export(); self.postMessage({ id, ok: true, out: b }, [b.buffer]); return; }
    self.postMessage({ id, ok: true, out });
  } catch (e) { self.postMessage({ id, ok: false, err: String((e && e.message) || e) }); }
};`;
const vmemS = { worker: null, ready: null, calls: new Map(), seq: 0, dim: 0, model: '', dirty: false, busy: null, last: '', syncT: null, error: '', counts: null };
function vmemCall(op, a, transfer) {
  return new Promise((ok, no) => {
    const id = ++vmemS.seq; vmemS.calls.set(id, { ok, no });
    vmemS.worker.postMessage({ id, op, a }, transfer || []);
  });
}
async function vmemOpen() {
  if (vmemS.ready) return vmemS.ready;
  vmemS.ready = (async () => {
    const module = await sqliteModule();
    const url = URL.createObjectURL(new Blob([__jvSqlite.toString(), '\n', vmemWorkerSrc()], { type: 'text/javascript' }));
    vmemS.worker = new Worker(url);
    vmemS.worker.onmessage = e => { const c = vmemS.calls.get(e.data.id); if (!c) return; vmemS.calls.delete(e.data.id); e.data.ok ? c.ok(e.data.out) : c.no(new Error(e.data.err)); };
    vmemS.worker.onerror = e => { e.preventDefault?.(); for (const c of vmemS.calls.values()) c.no(new Error(e.message || 'worker error')); vmemS.calls.clear(); vmemS.ready = null; };
    let bytes = null; try { if (vfs.isFile(VMEM_DB)) { bytes = vfs.readBytes(VMEM_DB); if (!isSqliteBytes(bytes)) bytes = null; } } catch { bytes = null; }
    try { await vmemCall('init', { module, bytes }); } catch (e) { if (!bytes) throw e; await vmemCall('init', { module, bytes: null }); }   // a damaged cache is simply rebuilt
    await vmemCall('tx', { stmts: [
      ['CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT)'],
      ['CREATE TABLE IF NOT EXISTS chunks(id INTEGER PRIMARY KEY, coll TEXT NOT NULL, src TEXT NOT NULL DEFAULT \'\', head TEXT NOT NULL DEFAULT \'\', text TEXT NOT NULL, hash TEXT NOT NULL, ts INTEGER NOT NULL DEFAULT 0, emb INTEGER NOT NULL DEFAULT 0)'],
      ['CREATE INDEX IF NOT EXISTS chunks_src ON chunks(coll, src)'],
      ['CREATE VIRTUAL TABLE IF NOT EXISTS fts USING fts5(text, tokenize=\'porter unicode61\')'],
    ] });
    const m = Object.fromEntries((await vmemCall('sql', { sql: 'SELECT k, v FROM meta' }))[0]?.values || []);
    vmemS.dim = +m.dim || 0; vmemS.model = m.model || '';
  })().catch(e => { vmemS.ready = null; throw e; });
  return vmemS.ready;
}
async function vmemPersist() {
  if (!vmemS.dirty) return; vmemS.dirty = false;
  try { const b = await vmemCall('export'); vfs.write(VMEM_DB, b, { mkdirs: true }); } catch (e) { vmemS.dirty = true; console.warn('vector index not saved', e); }
}
const vmemHash = s => { let h1 = 0xdeadbeef, h2 = 0x41c6ce57; for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); } h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909); h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909); return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36) + s.length.toString(36); };
const vmemBlob = f => new Uint8Array(f.buffer, f.byteOffset, f.byteLength);

/* ---------- embeddings from Ollama ---------- */
const embedBase = () => String(S.embedHost || S.host || DEFAULTS.host).replace(/\/+$/, '');
const embedModel = () => String(S.embedModel || 'nomic-embed-text').trim();
function embedPrefix(kind) {            // nomic-embed-text was trained with task prefixes
  return /nomic-embed/i.test(embedModel()) ? (kind === 'query' ? 'search_query: ' : 'search_document: ') : '';
}
async function ollamaEmbed(texts, kind = 'document') {
  const model = embedModel(), headers = { 'Content-Type': 'application/json' }; if (S.embedKey) headers.Authorization = 'Bearer ' + S.embedKey;
  const pre = embedPrefix(kind), input = texts.map(t => pre + String(t).slice(0, 6000));
  let r;
  try { r = await fetch(embedBase() + '/api/embed', { method: 'POST', headers, body: JSON.stringify({ model, input, truncate: true }) }); }
  catch (e) { throw new Error(`could not reach Ollama at ${embedBase()} for embeddings (is it running with OLLAMA_ORIGINS="*"?)`); }
  let vecs = null;
  if (r.ok) vecs = (await r.json()).embeddings;
  else if (r.status === 404) {
    let msg = ''; try { msg = (await r.clone().json()).error || ''; } catch {}
    if (/not found/i.test(msg) && /model/i.test(msg)) throw new Error(`the embedding model "${model}" is not installed on ${embedBase()}. Run: ollama pull ${model}`);
    vecs = []; for (const t of input) {   // Ollama older than 0.3: one text per request
      const r2 = await fetch(embedBase() + '/api/embeddings', { method: 'POST', headers, body: JSON.stringify({ model, prompt: t }) });
      if (!r2.ok) throw new Error(`embeddings failed (HTTP ${r2.status})`); vecs.push((await r2.json()).embedding);
    }
  } else { let msg = ''; try { msg = (await r.json()).error || ''; } catch {} throw new Error(`embeddings failed (HTTP ${r.status}${msg ? ': ' + msg : ''})`); }
  if (!Array.isArray(vecs) || vecs.length !== texts.length || !vecs.every(v => Array.isArray(v) && v.length)) throw new Error('Ollama returned no embeddings (is "' + model + '" an embedding model?)');
  return vecs.map(v => { const f = Float32Array.from(v); let n = 0; for (const x of f) n += x * x; n = Math.sqrt(n) || 1; for (let i = 0; i < f.length; i++) f[i] /= n; return f; });   // unit length: cosine = dot
}
async function vmemEnsureDim(dim) {      // (re)create the vec0 table when the model or its size changed
  if (vmemS.dim === dim && vmemS.model === embedModel()) return;
  await vmemCall('tx', { stmts: [
    ['DROP TABLE IF EXISTS vec'],
    [`CREATE VIRTUAL TABLE vec USING vec0(coll text partition key, embedding float[${dim | 0}] distance_metric=cosine)`],
    ['UPDATE chunks SET emb = 0'],
    ["INSERT OR REPLACE INTO meta(k, v) VALUES('dim', ?), ('model', ?)", [String(dim), embedModel()]],
  ] });
  vmemS.dim = dim; vmemS.model = embedModel(); vmemS.dirty = true;
}
// embed everything that has no vector yet (batches of 16; a failure keeps the text searchable by keywords)
async function vmemEmbedPending(progress) {
  let done = 0;
  for (;;) {
    const rows = (await vmemCall('sql', { sql: 'SELECT id, coll, text FROM chunks WHERE emb = 0 ORDER BY id LIMIT 16' }))[0]?.values || [];
    if (!rows.length) break;
    const vs = await ollamaEmbed(rows.map(r => r[2]), 'document');
    await vmemEnsureDim(vs[0].length);
    await vmemCall('tx', { stmts: rows.flatMap((r, i) => [
      ['DELETE FROM vec WHERE rowid = ?', [r[0]]],
      ['INSERT INTO vec(rowid, coll, embedding) VALUES (?, ?, ?)', [r[0], r[1], vmemBlob(vs[i])]],
      ['UPDATE chunks SET emb = 1 WHERE id = ?', [r[0]]],
    ]) });
    vmemS.dirty = true; done += rows.length; progress?.(done);
  }
  return done;
}

/* ---------- what to index ---------- */
function vmemMemoryChunks() { return memoryLines().map(m => ({ coll: 'memory', src: MEM_PATH, head: m.sec || '', text: m.text })); }
function vmemJournalChunks() {
  const out = [];
  for (const f of [...vfs.nodes.keys()].filter(p => p.startsWith(JOURNAL_DIR + '/') && isNote(p)).sort()) {
    const day = (/Journal (\d{4}-\d{2}-\d{2})/.exec(f) || [])[1] || '';
    for (const part of vfs.read(f).split(/^(?=##\s)/m)) {
      const m = /^##\s+(.*)\n?([\s\S]*)$/.exec(part); if (!m) continue;
      const body = m[2].replace(/#journal/g, '').trim(); if (body.length < 8) continue;
      out.push({ coll: 'journal', src: f, head: `${day} ${m[1].trim()}`.trim(), text: `${day} · ${m[1].trim()}\n${body}`.slice(0, 2500) });
    }
  }
  return out;
}
function vmemNoteChunks(prefix) {
  const out = [];
  for (const p of [...vfs.nodes.keys()].sort()) {
    if (!isNote(p) || !vfs.isFile(p)) continue;
    if (prefix && !(p === prefix || p.startsWith(prefix.replace(/\/+$/, '') + '/'))) continue;
    if (p.startsWith(JOURNAL_DIR + '/') || p === MEM_PATH || p.startsWith('/Pandora/Rituals/') || p.startsWith('/Pandora/.index/')) continue;
    const text = vfs.read(p); if (text.length > 300000) continue;
    const name = noteName(p); let head = '';
    for (const part of text.split(/^(?=#{1,3}\s)/m)) {
      const h = /^#{1,3}\s+(.*)/.exec(part); if (h) head = h[1].trim();
      const body = part.replace(/^#{1,3}\s+.*\n?/, '').trim(); if (body.length < 20) continue;
      let buf = '';
      const flush = () => { if (buf.trim().length >= 20) out.push({ coll: 'notes', src: p, head, text: `${name}${head ? ' › ' + head : ''}\n${buf.trim()}` }); buf = ''; };
      for (const para of body.split(/\n{2,}/)) { if (buf.length + para.length > 900 && buf) flush(); buf += (buf ? '\n\n' : '') + para; while (buf.length > 1400) { out.push({ coll: 'notes', src: p, head, text: `${name}${head ? ' › ' + head : ''}\n${buf.slice(0, 1200)}` }); buf = buf.slice(1200); } }
      flush();
    }
    if (out.length > 4000) break;
  }
  return out;
}
// make the index match the notes for the given collections; returns { added, removed }
async function vmemReconcile(colls, want, srcPrefix) {
  const have = (await vmemCall('sql', { sql: `SELECT id, coll, src, hash FROM chunks WHERE coll IN (${colls.map(() => '?').join(',')})`, params: colls }))[0]?.values || [];
  const keyOf = (c, s, h) => c + '\u0001' + s + '\u0001' + h;
  const wantRows = want.map(w => ({ ...w, hash: vmemHash(w.head + '\u0001' + w.text) }));
  const wantKeys = new Map(); for (const w of wantRows) { const k = keyOf(w.coll, w.src, w.hash); wantKeys.set(k, (wantKeys.get(k) || 0) + 1); }
  const haveKeys = new Map(); for (const [id, c, s, h] of have) { const k = keyOf(c, s, h); (haveKeys.get(k) || haveKeys.set(k, []).get(k)).push(id); }
  const stmts = []; let removed = 0, added = 0;
  for (const [id, c, s, h] of have) {
    const k = keyOf(c, s, h);
    if (srcPrefix && !(s === srcPrefix || s.startsWith(srcPrefix.replace(/\/+$/, '') + '/'))) continue;
    if (!wantKeys.has(k)) { stmts.push(['DELETE FROM fts WHERE rowid = ?', [id]], ['DELETE FROM chunks WHERE id = ?', [id]]); if (vmemS.dim) stmts.push(['DELETE FROM vec WHERE rowid = ?', [id]]); removed++; }
  }
  for (const w of wantRows) {
    const k = keyOf(w.coll, w.src, w.hash); if (haveKeys.has(k)) continue;
    stmts.push(['INSERT INTO chunks(coll, src, head, text, hash, ts) VALUES (?, ?, ?, ?, ?, ?)', [w.coll, w.src, w.head, w.text, w.hash, Date.now()]], ['INSERT INTO fts(rowid, text) VALUES (last_insert_rowid(), ?)', [w.text]]);
    haveKeys.set(k, [0]); added++;
  }
  for (let i = 0; i < stmts.length; i += 400) await vmemCall('tx', { stmts: stmts.slice(i, i + 400) });
  if (stmts.length) vmemS.dirty = true;
  return { added, removed };
}
// keep memory + journal (and the notes, when switched on) in step with the files, then embed what is new
async function vmemSync({ notes = false, notesPath = '', progress } = {}) {
  if (vmemS.busy) return vmemS.busy;
  vmemS.busy = (async () => {
    await vmemOpen(); vmemS.error = '';
    const r1 = await vmemReconcile(['memory'], vmemMemoryChunks());
    const r2 = await vmemReconcile(['journal'], vmemJournalChunks());
    const rSk = await vmemReconcile(['skills'], typeof vmemSkillChunks === 'function' ? vmemSkillChunks() : []);
    let r3 = { added: 0, removed: 0 };
    if (notes || S.embedNotes) r3 = await vmemReconcile(['notes'], vmemNoteChunks(notes === true ? notesPath : ''), notes === true ? notesPath : '');
    let embedded = 0;
    try { embedded = await vmemEmbedPending(progress); } catch (e) { vmemS.error = e.message; }
    await vmemPersist();
    return { added: r1.added + r2.added + r3.added + rSk.added, removed: r1.removed + r2.removed + r3.removed + rSk.removed, embedded, error: vmemS.error };
  })().finally(() => { vmemS.busy = null; });
  return vmemS.busy;
}
function vmemSyncSoon() {
  vmemCtx = { q: '', hits: null };       // what was ranked for the prompt may be out of date now
  if (!S.memoryOn || S.embedOn === false) return;
  clearTimeout(vmemS.syncT);
  vmemS.syncT = setTimeout(() => { vmemSync().catch(e => { vmemS.error = e.message; console.warn('vector sync failed', e); }); }, 3000);
}
async function vmemStatus() {
  await vmemOpen();
  const rows = (await vmemCall('sql', { sql: 'SELECT coll, count(*), sum(emb) FROM chunks GROUP BY coll ORDER BY coll' }))[0]?.values || [];
  const ver = (await vmemCall('sql', { sql: 'select vec_version(), sqlite_version()' }))[0].values[0];
  return { sqlite: ver[1], vec: ver[0], model: vmemS.model || embedModel(), dim: vmemS.dim, host: embedBase(), collections: rows.map(r => ({ name: r[0], chunks: r[1], embedded: r[2] || 0 })), error: vmemS.error };
}

/* ---------- search: FTS5 + vec0, fused ---------- */
const vmemFtsQuery = q => { const t = [...new Set(bm25Tokens(q))].slice(0, 24); return t.length ? t.map(x => '"' + x.replace(/"/g, '') + '"*').join(' OR ') : ''; };
async function vmemSearch(query, { colls = ['memory', 'journal'], k = 8, mode = 'hybrid', sync = true } = {}) {
  await vmemOpen();
  if (!colls) colls = ((await vmemCall('sql', { sql: 'SELECT DISTINCT coll FROM chunks' }))[0]?.values || []).map(r => r[0]).filter(c => c !== 'skills' && c !== 'chats');
  if (!colls.length) return { hits: [], note: 'the index is empty' };
  if (sync) { try { await vmemSync(); } catch (e) { vmemS.error = e.message; } }
  query = String(query || '').trim(); if (!query) return { hits: [], note: 'empty query' };
  const N = Math.max(30, k * 6), inList = colls.map(() => '?').join(',');
  let note = '', fr = new Map(), vr = new Map(), dist = new Map();
  if (mode !== 'semantic') {
    const fq = vmemFtsQuery(query);
    if (fq) {
      const rows = (await vmemCall('sql', { sql: `SELECT fts.rowid FROM fts JOIN chunks c ON c.id = fts.rowid WHERE fts MATCH ? AND c.coll IN (${inList}) ORDER BY fts.rank LIMIT ?`, params: [fq, ...colls, N] }))[0]?.values || [];
      rows.forEach((r, i) => fr.set(r[0], i + 1));
    }
  }
  if (mode !== 'keyword' && vmemS.dim) {
    try {
      const [qv] = await ollamaEmbed([query], 'query');
      if (qv.length !== vmemS.dim) throw new Error(`the embedding model now returns ${qv.length} numbers per text, the index has ${vmemS.dim}: rebuild the index`);
      for (const c of colls) {
        const rows = (await vmemCall('sql', { sql: 'SELECT rowid, distance FROM vec WHERE embedding MATCH ? AND k = ? AND coll = ?', params: [vmemBlob(qv), N, c] }))[0]?.values || [];
        rows.forEach(r => dist.set(r[0], r[1]));
      }
      [...dist.entries()].sort((a, b) => a[1] - b[1]).forEach(([id], i) => vr.set(id, i + 1));
    } catch (e) { note = `keyword search only (${e.message})`; if (mode === 'semantic') throw e; }
  } else if (mode !== 'keyword' && !vmemS.dim) note = 'keyword search only (nothing is embedded yet: ' + (vmemS.error || 'run the embeddings status action') + ')';
  const score = new Map();
  for (const [id, r] of fr) score.set(id, (score.get(id) || 0) + 1 / (VMEM_RRF + r));
  for (const [id, r] of vr) score.set(id, (score.get(id) || 0) + 1 / (VMEM_RRF + r));
  const ids = [...score.entries()].sort((a, b) => b[1] - a[1]).slice(0, k).map(e => e[0]); if (!ids.length) return { hits: [], note };
  const rows = (await vmemCall('sql', { sql: `SELECT id, coll, src, head, text FROM chunks WHERE id IN (${ids.map(() => '?').join(',')})`, params: ids }))[0]?.values || [];
  const byId = new Map(rows.map(r => [r[0], { id: r[0], coll: r[1], src: r[2], head: r[3], text: r[4] }]));
  const hits = ids.map(id => { const h = byId.get(id); return h && { ...h, score: score.get(id), distance: dist.has(id) ? dist.get(id) : null, kw: fr.get(id) || 0, sem: vr.get(id) || 0 }; }).filter(Boolean);
  return { hits, note };
}
async function vmemAdd(coll, text, src = '', head = '') {
  await vmemOpen(); text = String(text || '').trim(); if (!text) throw new Error('add needs text');
  const hash = vmemHash(head + '\u0001' + text);
  const dup = (await vmemCall('sql', { sql: 'SELECT id FROM chunks WHERE coll = ? AND hash = ?', params: [coll, hash] }))[0]?.values?.[0];
  if (dup) return { id: dup[0], added: false };
  await vmemCall('tx', { stmts: [['INSERT INTO chunks(coll, src, head, text, hash, ts) VALUES (?, ?, ?, ?, ?, ?)', [coll, src, head, text, hash, Date.now()]], ['INSERT INTO fts(rowid, text) VALUES (last_insert_rowid(), ?)', [text]]] });
  const id = (await vmemCall('sql', { sql: 'SELECT max(id) FROM chunks' }))[0].values[0][0]; vmemS.dirty = true;
  let err = ''; try { await vmemEmbedPending(); } catch (e) { err = e.message; vmemS.error = e.message; }
  await vmemPersist(); return { id, added: true, error: err };
}
async function vmemRemove({ id, coll, src }) {
  await vmemOpen();
  const where = id ? ['id = ?', [id]] : src ? ['src = ?' + (coll ? ' AND coll = ?' : ''), coll ? [src, coll] : [src]] : coll ? ['coll = ?', [coll]] : null;
  if (!where) throw new Error('remove needs an id, a source or a collection');
  const ids = ((await vmemCall('sql', { sql: `SELECT id FROM chunks WHERE ${where[0]}`, params: where[1] }))[0]?.values || []).map(r => r[0]);
  const stmts = []; for (const i of ids) { stmts.push(['DELETE FROM fts WHERE rowid = ?', [i]], ['DELETE FROM chunks WHERE id = ?', [i]]); if (vmemS.dim) stmts.push(['DELETE FROM vec WHERE rowid = ?', [i]]); }
  for (let i = 0; i < stmts.length; i += 400) await vmemCall('tx', { stmts: stmts.slice(i, i + 400) });
  vmemS.dirty = true; await vmemPersist(); return ids.length;
}
// throw the whole index away and build it again (after changing the embedding model)
async function vmemRebuild(progress) {
  await vmemOpen();
  // memory, journal and notes are rebuilt from the files; Pandora's own collections keep their text and are embedded again
  await vmemCall('tx', { stmts: [
    ["DELETE FROM fts WHERE rowid IN (SELECT id FROM chunks WHERE coll IN ('memory','journal','notes'))"],
    ["DELETE FROM chunks WHERE coll IN ('memory','journal','notes')"], ['UPDATE chunks SET emb = 0'], ['DROP TABLE IF EXISTS vec'], ["DELETE FROM meta WHERE k IN ('dim','model')"]] });
  vmemS.dim = 0; vmemS.model = ''; vmemS.dirty = true;
  return vmemSync({ notes: !!S.embedNotes, progress });
}
async function vmemCompare(a, b) {
  const [x, y] = await ollamaEmbed([a, b], 'document'); let d = 0; for (let i = 0; i < x.length; i++) d += x[i] * y[i]; return d;
}

/* ---------- memory that uses it ---------- */
// ranked memory lines for the prompt: computed before each turn (the prompt builder itself is synchronous)
let vmemCtx = { q: '', hits: null };
async function memoryPrefetch() {
  if (!S.memoryOn || !S.memoryRag || S.embedOn === false) { vmemCtx = { q: '', hits: null }; return; }
  const q = memoryQuery(); if (!q.trim() || vmemCtx.q === q) return;
  try {
    const K = Math.max(1, Math.min(30, +S.memoryRagK || 8));
    const r = await Promise.race([vmemSearch(q, { colls: ['memory'], k: K, mode: 'hybrid', sync: true }), new Promise((_, no) => setTimeout(() => no(new Error('timeout')), 6000))]);
    // keep a hit when it matched keywords, or is close in meaning (cosine distance under 0.6)
    vmemCtx = { q, hits: r.hits.filter(h => h.kw || (h.distance !== null && h.distance < 0.6)), total: memoryLines().length, sem: !r.note };
  } catch (e) { vmemCtx = { q: '', hits: null }; }
}
async function memorySearchHybrid(query, limit = 10) {
  const r = await vmemSearch(query, { colls: ['memory', 'journal'], k: limit, mode: 'hybrid' });
  if (!r.hits.length) return { text: '', note: r.note };
  const text = r.hits.map(h => `${h.coll === 'memory' ? 'memory' : 'journal'}${h.head ? ' · ' + h.head : ''}: ${h.text.replace(/\s+/g, ' ').slice(0, 300)}`).join('\n');
  return { text, note: r.note };
}

/* ---------- the embeddings tool ---------- */
async function embeddingsTool(args) {
  const a = String(args.action || 'status').toLowerCase();
  const colls = args.collection ? String(args.collection).split(/\s*,\s*/).filter(Boolean) : null;   // null = every collection
  if (S.embedOn === false && a !== 'status') throw new Error('Embeddings are switched off (Config → Embeddings).');
  if (a === 'status') {
    const s = await vmemStatus();
    return `sqlite-vec ${s.vec} on SQLite ${s.sqlite}. Embedding model: ${s.model}${s.dim ? ` (${s.dim} numbers per text)` : ' (nothing embedded yet)'} via ${s.host}.\n` +
      (s.collections.length ? s.collections.map(c => `- ${c.name}: ${c.chunks} texts, ${c.embedded} embedded`).join('\n') : 'The index is empty.') + (s.error ? `\nLast problem: ${s.error}` : '');
  }
  if (a === 'search' || a === 'find' || a === 'query') {
    const q = args.query ?? args.text; if (!q) throw new Error('search needs a query');
    const mode = ['hybrid', 'semantic', 'keyword'].includes(args.mode) ? args.mode : 'hybrid';
    const r = await vmemSearch(q, { colls, k: Math.max(1, Math.min(30, +args.k || +args.limit || 8)), mode });
    if (!r.hits.length) return `Nothing found${colls ? ' in ' + colls.join(', ') : ''}${r.note ? ` (${r.note})` : ''}. Use the index action to embed the vault's notes first, or add text with the add action.`;
    return (r.note ? `[${r.note}]\n` : '') + r.hits.map((h, i) => `${i + 1}. [${h.coll}${h.src && h.coll !== 'memory' ? ' · ' + (h.coll === 'notes' || h.coll === 'journal' ? noteName(h.src) : h.src) : ''}${h.head && h.coll === 'notes' ? ' › ' + h.head : ''}] ${h.text.replace(/\s+/g, ' ').slice(0, 400)}  (id ${h.id}${h.distance !== null ? `, similarity ${(1 - h.distance).toFixed(2)}` : ''}${h.kw ? ', keyword match' : ''})`).join('\n');
  }
  if (a === 'add' || a === 'store' || a === 'save') {
    const coll = String(args.collection || '').trim(); if (!coll) throw new Error('add needs a collection name');
    if (VMEM_AUTO.includes(coll) || coll === 'notes') throw new Error(`"${coll}" is filled automatically from the vault; pick another collection name (or use the memory tool to remember a fact).`);
    const texts = Array.isArray(args.texts) ? args.texts : [args.text];
    let n = 0, err = ''; for (const t of texts) { if (!String(t || '').trim()) continue; const r = await vmemAdd(coll, t, String(args.source || ''), String(args.head || '')); if (r.added) n++; if (r.error) err = r.error; }
    return `Stored ${n} text${n === 1 ? '' : 's'} in "${coll}".` + (err ? ` Not embedded yet (${err}); keyword search still finds ${n === 1 ? 'it' : 'them'}.` : '');
  }
  if (a === 'index') {
    const path = args.path ? vfs.norm(String(args.path), '/') : '';
    const r = await vmemSync({ notes: true, notesPath: path });
    const s = await vmemStatus(); const n = s.collections.find(c => c.name === 'notes');
    return `Indexed the vault${path ? ' under ' + path : ''}: ${r.added} new, ${r.removed} removed, ${r.embedded} embedded; "notes" holds ${n ? n.chunks : 0} passages.` + (r.error ? ` Problem: ${r.error}` : '');
  }
  if (a === 'remove' || a === 'delete' || a === 'forget') {
    const n = await vmemRemove({ id: args.id ? +args.id : 0, coll: args.collection, src: args.source || args.path });
    return `Removed ${n} text${n === 1 ? '' : 's'}.`;
  }
  if (a === 'compare' || a === 'similar' || a === 'similarity') {
    if (!args.a || !args.b) throw new Error('compare needs texts a and b'); const d = await vmemCompare(String(args.a), String(args.b));
    return `Cosine similarity ${d.toFixed(3)} (1 = same meaning, near 0 = unrelated) using ${embedModel()}.`;
  }
  throw new Error(`unknown action "${a}" (use search, add, index, remove, compare or status)`);
}
