// The bridge queue: every message that arrives on Vector or Discord, kept on disk in the order it arrived, until her
// turn has handled it. Nothing in it expires, is trimmed or is answered on its own. While the host naps, messages only
// gather here; when a client connects she gets them all, oldest first.
//
// On disk it's an append-only log of JSON lines in the host's state folder:
//   {"op":"add","seq":12,"bridge":"vector","id":"…","chat":"…","from":"…","text":"…","at":…,"receivedAt":…}
//   {"op":"done","seq":12}
// A message is pending from its "add" until its "done". "done" is written only after her turn for it has finished,
// so a host stopped in the middle of one gives it to her again after the restart (marked as a retry), never loses it.
// When nothing is pending the log is started afresh.

'use strict';
const fs = require('node:fs');
const path = require('node:path');

const WARN_AT = 1000; // pending messages before the host says the queue is large (it never trims it)

function createQueue(file, { warnAt = WARN_AT, log = () => {} } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const pending = new Map(); // seq → message, in arrival order (Map keeps insertion order)
  const seen = new Set();    // bridge + id, so a bridge handing the same message twice doesn't queue it twice
  let seq = 0, warned = false;

  // read what's there (a host restarted with messages waiting)
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      let r; try { r = JSON.parse(line); } catch { continue; } // a line cut off by a crash
      if (r.op === 'add') { const { op, ...m } = r; pending.set(m.seq, m); if (m.id) seen.add(m.bridge + '\n' + m.id); seq = Math.max(seq, m.seq); }
      else if (r.op === 'done') pending.delete(r.seq);
      else if (r.op === 'try') { const m = pending.get(r.seq); if (m) m.tries = (m.tries || 0) + 1; }
    }
    if (!pending.size) fs.writeFileSync(file, '');
  }
  const append = (r) => { const fd = fs.openSync(file, 'a'); try { fs.writeSync(fd, JSON.stringify(r) + '\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); } };
  function checkSize() {
    if (pending.size >= warnAt && !warned) { warned = true; log('queue.large', { pending: pending.size, warnAt }); }
    if (pending.size < warnAt) warned = false;
  }

  return {
    /** Keep a message that just arrived. → its record, or null if this bridge already handed it over. */
    add(bridge, m) {
      const key = m.id != null ? bridge + '\n' + m.id : null;
      if (key && seen.has(key)) return null;
      const rec = { seq: ++seq, bridge, id: m.id ?? null, chat: m.chat ?? null, from: m.from ?? null, text: String(m.text ?? ''), at: m.at ?? null, receivedAt: Date.now(), live: !!m.live };
      append({ op: 'add', ...rec });
      pending.set(rec.seq, rec);
      if (key) seen.add(key);
      log('queue.add', { seq: rec.seq, bridge, chat: rec.chat, id: rec.id, pending: pending.size });
      checkSize();
      return rec;
    },
    /** The oldest pending message, or null. */
    first() { for (const m of pending.values()) return m; return null; },
    /** Her turn for this one is starting (so a retry after a crash can be told apart). */
    trying(s) { append({ op: 'try', seq: s }); const m = pending.get(s); if (m) m.tries = (m.tries || 0) + 1; },
    /** Her turn for this one has finished: it leaves the queue. */
    done(s) {
      if (!pending.has(s)) return;
      append({ op: 'done', seq: s }); pending.delete(s);
      log('queue.done', { seq: s, pending: pending.size });
      checkSize();
      if (!pending.size) { fs.writeFileSync(file, ''); seen.clear(); }
    },
    list: () => [...pending.values()],
    size: () => pending.size,
    large: () => pending.size >= warnAt,
    warnAt,
    file,
  };
}

module.exports = { createQueue, WARN_AT };
