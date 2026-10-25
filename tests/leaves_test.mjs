// Leaf tools: rename a leaf or workshop (threads follow), delete an empty workshop, tidy away every empty one.
import { start } from './_harness.mjs';
const { page, ok, read, done } = await start();
const E = (fn, arg) => page.evaluate(fn, arg);
// the small dialog: pick an item, or type an answer and press OK
const pick = async (label) => { await page.waitForSelector('.jv-dlg .jv-dlg-item'); await page.click(`.jv-dlg .jv-dlg-item:has-text("${label}")`); await page.waitForTimeout(150); };
const answer = async (text) => { await page.waitForSelector('.jv-dlg input'); await page.fill('.jv-dlg input', text); await page.click('.jv-dlg [data-x=ok]'); await page.waitForTimeout(250); };
const more = async (p) => { await E(p => { for (const d of ['/Garden', '/Meadow', '/Notes', '/Pandora']) openDirs.add(d); renderTree(); }, p); await page.waitForTimeout(100); await page.click(`.tree-more[data-more="${p}"]`); };
const toasts = () => E(() => [...document.querySelectorAll('.toast')].map(t => t.textContent).join(' | '));

await E(() => {
  const w = (p, t) => vfs.write(p, t, { mkdirs: true });
  w('/Garden/Rose.md', '# Rose\n\n## Petals\nRed.\n');
  w('/Notes/A.md', '# A\n\nSee [[Rose]], the [[Rose#Petals|petals]], by path [[Garden/Rose]], as a link [rose](Garden/Rose.md), and inline: ![[Rose]]\n');
  w('/Notes/B.md', '# B\n\nNot the same: [[Rosebud]]\n');
  vfs.mkdirp('/Empty One'); vfs.mkdirp('/Empty Two/Deeper'); vfs.mkdirp('/Pandora/Spare');
  setTab('files'); renderTree();
});
await page.waitForTimeout(300);

// ---------- rename a leaf from the tree ----------
await more('/Garden/Rose.md'); await pick('Rename'); await answer('Wild Rose');
let a = await read('/Notes/A.md');
ok(await E(() => vfs.isFile('/Garden/Wild Rose.md') && !vfs.exists('/Garden/Rose.md')), 'the ⋯ menu renames a leaf');
ok(a.includes('See [[Wild Rose]]') && a.includes('[[Wild Rose#Petals|petals]]') && a.includes('[[Garden/Wild Rose]]') && a.includes('](/Garden/Wild%20Rose.md)') && a.includes('![[Wild Rose]]'), 'every thread to it follows: by name, with a heading and alias, by path, a markdown link, an embed:\n' + a);
ok((await read('/Notes/B.md')).includes('[[Rosebud]]'), 'a thread to another leaf is left alone');
ok(/Renamed to Wild Rose\. 5 threads in 1 leaf now lead there/.test(await toasts()), 'it says how many threads followed: ' + (await toasts()).slice(-120));

// ---------- rename the open leaf from its footer ----------
await E(() => openFile('/Garden/Wild Rose.md', { mode: 'read' })); await page.waitForTimeout(200);
await page.click('#btnFileRename'); await answer('Briar Rose');
ok(await E(() => editing === '/Garden/Briar Rose.md' && document.querySelector('#filePath').textContent === 'Briar Rose'), 'the open leaf renames from its footer and stays open');
ok((await read('/Notes/A.md')).includes('[[Briar Rose#Petals|petals]]'), 'and its threads follow again');

// ---------- rename a workshop ----------
await E(() => noteBack?.()); await E(() => setTab('files'));
await more('/Garden'); await pick('Rename'); await answer('Meadow');
a = await read('/Notes/A.md');
ok(await E(() => vfs.isFile('/Meadow/Briar Rose.md') && !vfs.exists('/Garden') && editing === '/Meadow/Briar Rose.md'), 'a workshop renames, its leaves move with it (the open one too)');
ok(a.includes('[[Meadow/Briar Rose]]') && a.includes('](/Meadow/Briar%20Rose.md)') && a.includes('See [[Briar Rose]]'), 'threads by path follow the workshop; threads by name still find the leaf and stay as written:\n' + a);

// ---------- delete a workshop ----------
await more('/Meadow'); await pick('Delete');
ok(await E(() => vfs.isDir('/Meadow')) && /holds 1 file/.test(await toasts()), 'a workshop with leaves in it is not deleted: it says what it holds');
await more('/Empty One'); await pick('Delete');
ok(await E(() => !vfs.exists('/Empty One')), 'an empty workshop deletes');
await more('/Pandora');
ok(/Kept/.test(await E(() => document.querySelector('.jv-dlg').textContent)), "Pandora's home is kept: her menu offers no rename or delete");
await E(() => document.querySelector('.jv-dlg [data-x=cancel]').click());

// ---------- tidy ----------
await page.click('#btnTidy'); await page.waitForSelector('.jv-dlg');
const msg = await E(() => document.querySelector('.jv-dlg').textContent);
await pick('Remove them');
const left = await E(() => ({ two: vfs.exists('/Empty Two'), deeper: vfs.exists('/Empty Two/Deeper'), spare: vfs.isDir('/Pandora/Spare'), meadow: vfs.isDir('/Meadow'), notes: vfs.isDir('/Notes'), att: [...vfs.nodes.keys()].some(p => p.startsWith('/attachments')) || true }));
ok(/Remove 2 empty workshops: \/Empty Two/.test(msg) && !left.two && !left.deeper && left.spare && left.meadow && left.notes, 'Tidy removes every empty workshop (nested ones too) and keeps those with leaves and Pandora\'s own: ' + JSON.stringify({ msg: msg.slice(0, 90), left }));
await page.click('#btnTidy'); await page.waitForTimeout(200);
ok(/No empty workshops/.test(await toasts()), 'with nothing to tidy it says so');

// ---------- find & replace in the editor ----------
await E(() => { vfs.write('/Find.md', 'The cat sat. The Cat ran. the end\n'); openFile('/Find.md', { mode: 'read' }); }); await page.waitForTimeout(300);
const ed = () => E(() => { const t = document.querySelector('#fileEd'); return { v: t.value, s: t.selectionStart, e: t.selectionEnd, count: document.querySelector('#findCount').textContent, mode: document.querySelector('#noteBody').dataset.mode, open: !document.querySelector('#findBar').hidden }; });
await page.keyboard.press('Control+f'); await page.waitForTimeout(150);
await page.keyboard.type('cat'); await page.waitForTimeout(100);
let f = await ed();
ok(f.open && f.mode === 'split' && f.count === '2 matches', 'Ctrl+F opens the find bar (Read mode switches to Split so the text shows) and counts as you type: ' + JSON.stringify(f));
await page.keyboard.press('Enter'); f = await ed();
ok(f.s === 4 && f.e === 7 && f.count === '1 of 2', 'Enter selects the first match: ' + JSON.stringify(f));
await page.keyboard.press('Enter'); f = await ed(); const second = f.s;
await page.keyboard.press('Shift+Enter'); f = await ed();
ok(second === 17 && f.s === 4 && f.count === '1 of 2', 'Enter goes on, Shift+Enter goes back');
await page.click('#findCase'); f = await ed();
ok(f.count === '1 match', 'Match case counts only "cat": ' + f.count);
await page.click('#findCase');
// replace, one at a time and all at once
await page.keyboard.press('Control+h'); await page.waitForTimeout(100);
await E(() => document.querySelector('#fileEd').setSelectionRange(0, 0)); await page.fill('#findQ', 'the'); await page.fill('#findR', 'a');
await page.focus('#findR'); await page.keyboard.press('Enter'); await page.keyboard.press('Enter'); f = await ed();
ok(f.v.startsWith('a cat sat. The Cat ran.') && f.count === '1 of 2', 'from the caret, Replace selects the first match, then replaces it and moves to the next ("The" found case-insensitively): ' + JSON.stringify(f));
await page.click('#findAll'); f = await ed();
ok(f.v === 'a cat sat. a Cat ran. a end\n' && f.count === 'no match', 'Replace all changes every match: ' + JSON.stringify(f.v));
await page.focus('#fileEd'); await page.keyboard.press('Control+z'); f = await ed();
ok(f.v === 'a cat sat. The Cat ran. the end\n', 'one Ctrl+Z undoes Replace all (the single Replace before it stays): ' + JSON.stringify(f.v));
// regular expressions with groups
await page.click('#findRe'); await page.fill('#findQ', '(\\w+) (sat|ran)'); await page.fill('#findR', '$2 the $1');
await page.click('#findAll'); f = await ed();
ok(f.v === 'a sat the cat. The ran the Cat. the end\n', 'a regular expression replaces with its groups: ' + JSON.stringify(f.v));
await page.fill('#findQ', '(unclosed'); f = await ed();
ok(f.count === 'bad pattern', 'a broken pattern says so: ' + f.count);
await page.click('#findRe');
await page.keyboard.press('Escape'); await page.waitForTimeout(250);
ok(!(await ed()).open && (await read('/Find.md')) === 'a sat the cat. The ran the Cat. the end\n', 'Esc closes the bar, and the leaf was saved');
// a long leaf: the editor scrolls to the match
await E(() => { vfs.write('/Long.md', Array.from({ length: 400 }, (_, i) => i === 380 ? 'here is the needle' : `line ${i} with some words to wrap around a little`).join('\n')); openFile('/Long.md', { mode: 'edit' }); }); await page.waitForTimeout(250);
await page.click('#mdTools [data-find]'); await page.fill('#findQ', 'needle'); await page.keyboard.press('Enter');
const sc = await E(() => { const t = document.querySelector('#fileEd'); return { top: t.scrollTop, h: t.clientHeight, sel: t.value.slice(t.selectionStart, t.selectionEnd) }; });
ok(sc.sel === 'needle' && sc.top > 3000, 'in a long leaf the editor scrolls to the match (the 🔍 button opens the bar too): ' + JSON.stringify(sc));
await page.keyboard.press('Escape');
await done();
