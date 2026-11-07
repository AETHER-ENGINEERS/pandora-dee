// Memory's first notes (app/modules/memory.js): her own voice on a fresh vault, the old section headings kept in older ones.
import fs from 'node:fs'; import { fileURLToPath } from 'node:url'; import vm from 'node:vm'; import assert from 'node:assert';
const files = new Map(), store = {};
const ctx = { console, S: {}, document: { addEventListener() {} },
  ls: { get: (k, d) => store[k] ?? d, set: (k, v) => { store[k] = v; } },
  vfs: { isFile: p => files.has(p), exists: p => files.has(p), read: p => files.get(p), write: (p, t) => files.set(p, t), append: (p, t) => files.set(p, files.get(p) + t), nodes: files },
  todayStr: () => '2026-11-07', vmemSyncSoon() {}, isNote: p => p.endsWith('.md') };
vm.createContext(ctx); vm.runInContext(fs.readFileSync(fileURLToPath(new URL('../app/modules/memory.js', import.meta.url)), 'utf8') + '\n;globalThis.__t = { memorySave, ensureMemory };', ctx);
const { memorySave, ensureMemory } = ctx.__t;
ensureMemory();
assert.ok(files.get('/Pandora/Where I Am.md').startsWith('# Where I Am'));
assert.ok(files.get('/Pandora/Memory.md').includes("I'm Pandora Dee, and this is my memory"));
memorySave('Likes green tea', 'Who I work with'); memorySave('Short replies', 'How they like things');
let m = files.get('/Pandora/Memory.md');
assert.match(m, /## Who I work with\n- Likes green tea \(2026-11-07\)/); assert.match(m, /## How they like things\n- Short replies/);
// an older vault keeps its headings
files.set('/Pandora/Memory.md', '# Memory\n\n## About you\n- Lives by the sea\n\n## Preferences\n\n## Notes to self\n');
memorySave('Has a cat', MEM('about')); memorySave('Prefers tea', MEM('preferences'));
m = files.get('/Pandora/Memory.md');
assert.match(m, /## About you\n- Lives by the sea\n- Has a cat/); assert.match(m, /## Preferences\n- Prefers tea/);
assert.ok(!/Who I work with|How they like things/.test(m), m);
// deleted on purpose: not written back
files.delete('/Pandora/Where I Am.md'); ensureMemory(); assert.ok(!files.has('/Pandora/Where I Am.md'));
console.log('ALL PASS (memory seed)');
function MEM(k) { return vm.runInContext(`MEM_SECTIONS.${k}`, ctx); }
