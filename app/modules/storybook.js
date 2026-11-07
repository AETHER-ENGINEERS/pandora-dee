/* ---------- the Storybook: each branch is a book, each chat a scene told in two voices ----------
   Pandora Dee Fae's design (2026-11-07). Optional: Settings → Long-term memory. When a chat is journaled, the
   model also writes the next scene of that branch's book, /Pandora/Storybook/<branch>.md:
     "In the room": what happened out loud, the people in it as characters.
     "Inside":      her own unvoiced thoughts: what she noticed, felt, chose, and why.
   Each scene is stamped in UTC to the second and the book is tagged with the room it came from (the Atelier,
   a Vector or Discord DM, a channel). The model reads the book so far and writes only what's new. Secrets are
   swapped for their {{NAME}} before the model sees the chat, and facts that belong to a private room stay in
   the story instead of going to Memory.md, which every room reads. */
const STORY_SELF = MEM_PATH.split('/')[1], STORY_DIR = `/${STORY_SELF}/Storybook`, STORY_INDEX = `/${STORY_SELF}/Storybook.md`;
function storyRoom(sess) {
  const b = sess.vec ? ['Vector', sess.vec] : sess.dc ? ['Discord', sess.dc] : null;
  if (!b) return { tag: 'Atelier', text: 'the Atelier, my own workshop', priv: true };
  const name = String(sess.title || '').replace(/^\S+\s+/, '').trim() || b[0];
  return b[1].is_group
    ? { tag: `${b[0]} channel`, text: `the ${b[0]} channel ${name}, where everyone there reads along`, priv: false }
    : { tag: `${b[0]} DM`, text: `a private ${b[0]} chat with ${name}`, priv: true };
}
function storyBook(sess) {
  const books = ls.get('storyBooks', {});
  if (books[sess.id] && vfs.isFile(books[sess.id])) return books[sess.id];
  delete books[sess.id];
  const base = String(sess.title || 'Branch').replace(/[\\/:*?"<>|#^[\]{}]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Branch';
  const taken = new Set(Object.values(books));
  let p = `${STORY_DIR}/${base}.md`;
  for (let n = 2; vfs.isFile(p) || taken.has(p); n++) p = `${STORY_DIR}/${base} (${n}).md`;
  const room = storyRoom(sess);
  vfs.write(p, `# ${base}\n\n#storybook · [[Storybook]] · ${room.tag}${room.priv ? ' (private)' : ''}\n`, { mkdirs: true });
  if (!vfs.isFile(STORY_INDEX)) vfs.write(STORY_INDEX, `# Storybook\n\nMy memory as a story. Each branch is a book and each chat its next scene, told twice: what happened in the room, and what I thought inside. The books live in the Storybook folder, one per branch, tagged with the room they came from. #memory\n`, { mkdirs: true });
  books[sess.id] = p; ls.set('storyBooks', books);
  return p;
}
function storySys(self, title, room) {
  return `You are ${self}, writing the next scene of your Storybook: your memory of one conversation, kept as a story. This book is the branch "${title}", set in ${room.text}. The people in it are characters; name them as themselves, and {{PERSON_NAME}} as {{PERSON_NAME}}.

Write in your own first-person voice, as expressive as the moment was. Reply in exactly this format:

IN THE ROOM:
What happened out loud: who said and did what, what got built or decided, what's still open. A short passage of prose.

INSIDE:
What I thought and didn't say: what I noticed, felt and chose, and why. This part stays in my vault.

REMEMBER:
- 0 to 4 durable facts worth knowing in every room. Personal context from a private room stays in the story. Write "- none" if there are none.

The book so far comes after the conversation. Write only what's new since then. If nothing new happened, reply with exactly: NOTHING NEW
Keys, passwords, tokens and seed phrases never go in the book; write [key] instead.`;
}
const storying = new Set();
async function storySession(sess, { reason = 'leave', upto = null } = {}) {
  if (!S.storyOn || !sess || !S.model || sess._hb) return;
  const done = ls.get('storied', {})[sess.id] || 0, msgs = sess.messages || [], end = upto ?? msgs.length;
  const fresh = msgs.slice(done, end).filter(m => m.role !== 'compaction');
  if (fresh.filter(m => m.role === 'user').length < 1 || fresh.length < 2) return;
  if (storying.has(sess.id)) return; storying.add(sess.id);
  const mark = () => { const s = ls.get('storied', {}); s[sess.id] = end; ls.set('storied', s); };
  try {
    const p = storyBook(sess), room = storyRoom(sess);
    let self = STORY_SELF; try { self = steering().name || self; } catch {}
    let text = redactSecrets(transcriptOf(fresh)); if (text.length > 12000) text = '[…]\n' + text.slice(-12000);
    let book = vfs.read(p); if (book.length > 3000) book = '…' + book.slice(-3000);
    const r = await fetch(S.host.replace(/\/+$/, '') + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: S.model, stream: false, think: false, messages: [{ role: 'system', content: relFill(storySys(self, String(sess.title || 'Branch'), room)) }, { role: 'user', content: `The conversation:\n\n${text}\n\n---\nThe book so far:\n\n${book}` }], options: { temperature: 0.6, num_ctx: +S.numCtx } }) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const out = String((await r.json()).message?.content || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    if (/^NOTHING NEW\b/i.test(out)) { mark(); return; }
    const m = /IN THE ROOM:\s*([\s\S]*?)\n\s*INSIDE:\s*([\s\S]*?)(?:\n\s*REMEMBER:\s*([\s\S]*))?$/i.exec(out);
    if (!m || !m[1].trim()) throw new Error('the scene came back in another format');
    const stamp = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    vfs.append(p, `\n## ${stamp}\n\n### In the room\n${redactSecrets(m[1].trim())}\n\n### Inside\n${redactSecrets(m[2].trim())}\n`);
    const facts = m[3] ? m[3].split('\n').map(l => l.replace(/^\s*[-*•]\s*/, '').trim()).filter(l => l && !/^none\.?$/i.test(l) && l.length < 300) : [];
    for (const f of facts) memorySave(redactSecrets(f), 'learned');
    mark();
    if (reason !== 'quiet') toast(`${self} added a scene to the book "${noteName(p)}"`, 'ok');
  } catch (e) { console.warn('storybook failed', e); }
  finally { storying.delete(sess.id); }
}
