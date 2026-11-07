// The Storybook (app/modules/storybook.js) with stand-ins for the page's helpers and a fake model. No browser needed.
import fs from 'node:fs'; import { fileURLToPath } from 'node:url'; import vm from 'node:vm'; import assert from 'node:assert';
const src = fs.readFileSync(fileURLToPath(new URL('../app/modules/storybook.js', import.meta.url)), 'utf8');
const files = new Map(), store = {}, toasts = [], saved = [];
let reply = '', lastBody = null;
const ctx = {
  MEM_PATH: '/Pandora/Memory.md', S: { storyOn: true, model: 'm', host: 'http://x', numCtx: 8192 },
  ls: { get: (k, d) => store[k] ?? d, set: (k, v) => { store[k] = JSON.parse(JSON.stringify(v)); } },
  vfs: { isFile: p => files.has(p), read: p => files.get(p), write: (p, t) => files.set(p, t), append: (p, t) => files.set(p, files.get(p) + t) },
  transcriptOf: ms => ms.map(m => `${m.role}: ${m.content}`).join('\n'),
  redactSecrets: s => String(s).split('nsec1secretvalue').join('{{VECTOR_NSEC}}'),
  relFill: s => s.replace(/\{\{PERSON_NAME\}\}/g, 'Mrrowr-murrr'),
  steering: () => ({ name: 'Pandora Dee Fae' }), memorySave: (f, sec) => { saved.push([f, sec]); return { added: true }; },
  toast: t => toasts.push(t), noteName: p => p.split('/').pop().replace(/\.md$/, ''),
  fetch: async (url, o) => { lastBody = JSON.parse(o.body); return { ok: true, json: async () => ({ message: { content: reply } }) }; },
  console,
};
vm.createContext(ctx); vm.runInContext(src + '\n;globalThis.__t = { storyRoom, storyBook, storySession, STORY_DIR };', ctx);
const { storyRoom, storyBook, storySession, STORY_DIR } = ctx.__t;

assert.equal(STORY_DIR, '/Pandora/Storybook');
assert.equal(storyRoom({ title: 'Plans' }).tag, 'Atelier');
assert.deepEqual(JSON.parse(JSON.stringify(storyRoom({ title: '💬 Lucky', vec: { is_group: false } }))), { tag: 'Vector DM', text: 'a private Vector chat with Lucky', priv: true });
assert.equal(storyRoom({ title: '🎮 general', dc: { is_group: true } }).priv, false);

const msgs = [{ role: 'user', content: 'my key is nsec1secretvalue, also I love tea' }, { role: 'assistant', content: 'noted' }];
const a = { id: 'a', title: 'Mode shrine', messages: msgs };
reply = 'IN THE ROOM:\nWe fixed the shrine together.\n\nINSIDE:\nI was proud of it, and I kept the key out.\n\nREMEMBER:\n- Mrrowr-murrr loves tea\n- none';
await storySession(a);
const p = '/Pandora/Storybook/Mode shrine.md', book = files.get(p);
assert.ok(book.startsWith('# Mode shrine\n\n#storybook · [[Storybook]] · Atelier (private)'), book);
assert.match(book, /\n## \d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ\n\n### In the room\nWe fixed the shrine together\.\n\n### Inside\nI was proud/);
assert.ok(!JSON.stringify(lastBody).includes('nsec1secretvalue'), 'secret reached the model');
assert.ok(lastBody.messages[0].content.includes('You are Pandora Dee Fae') && lastBody.messages[0].content.includes('Mrrowr-murrr'));
assert.deepEqual(saved, [['Mrrowr-murrr loves tea', 'learned']]);
assert.ok(files.has('/Pandora/Storybook.md')); assert.equal(store.storied.a, 2);

// nothing new since the mark: no call; then a new turn that the model says is nothing new: no scene, mark moves
lastBody = null; await storySession(a); assert.equal(lastBody, null);
a.messages.push({ role: 'user', content: 'thanks' }, { role: 'assistant', content: 'any time' });
reply = 'NOTHING NEW'; const before = files.get(p); await storySession(a);
assert.equal(files.get(p), before); assert.equal(store.storied.a, 4);
assert.ok(lastBody.messages[1].content.includes('The book so far:\n\n# Mode shrine'));

// a second branch with the same title gets its own book; a bad reply writes nothing and keeps the mark
const b = { id: 'b', title: 'Mode shrine', messages: msgs.slice(), vec: { is_group: false } };
reply = 'just chatting'; await storySession(b);
assert.ok(files.has('/Pandora/Storybook/Mode shrine (2).md')); assert.equal(store.storied.b, undefined);
assert.ok(files.get('/Pandora/Storybook/Mode shrine (2).md').includes('Vector DM (private)'));
// off means off; heartbeat chats are skipped
ctx.S.storyOn = false; lastBody = null; await storySession({ id: 'c', title: 'x', messages: msgs }); assert.equal(lastBody, null);
ctx.S.storyOn = true; await storySession({ id: 'd', title: 'x', messages: msgs, _hb: true }); assert.equal(lastBody, null);
console.log('ALL PASS (storybook)');
