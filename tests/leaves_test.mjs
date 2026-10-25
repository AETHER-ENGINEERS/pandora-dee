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

// ---------- import from notes apps ----------
const files = await E(async () => {
  const enc = new TextEncoder(), png = async (w = 8) => { const c = document.createElement('canvas'); c.width = w; c.height = w; c.getContext('2d').fillRect(0, 0, w, w); return new Uint8Array(await (await new Promise(r => c.toBlob(r, 'image/png'))).arrayBuffer()); };
  const us = d => String(Date.parse(d) * 1000);
  const keep = zipStore({
    'Takeout/Keep/Shopping.json': enc.encode(JSON.stringify({ title: 'Shopping', isPinned: true, isArchived: false, isTrashed: false, color: 'YELLOW', listContent: [{ text: 'Milk', isChecked: false }, { text: 'Bread', isChecked: true }], labels: [{ name: 'Home stuff' }], attachments: [{ filePath: '1a2b3c.png', mimetype: 'image/png' }], createdTimestampUsec: us('2025-03-01T10:00:00Z'), userEditedTimestampUsec: us('2025-03-02T11:30:00Z') })),
    'Takeout/Keep/Shopping.html': enc.encode('<html><body><div class="title">Shopping</div></body></html>'),
    'Takeout/Keep/1a2b3c.png': await png(),
    'Takeout/Keep/Old idea.json': enc.encode(JSON.stringify({ title: 'Old idea', textContent: 'gone', isTrashed: true, userEditedTimestampUsec: us('2024-01-01T00:00:00Z') })),
    'Takeout/Keep/Someday.json': enc.encode(JSON.stringify({ title: 'Someday', textContent: 'Learn the harp', isArchived: true, isTrashed: false, userEditedTimestampUsec: us('2024-06-01T00:00:00Z') })),
    'Takeout/Keep/2025-05-05T10_00_00.000Z.json': enc.encode(JSON.stringify({ title: '', textContent: 'Call the vet\nabout Mrrowr', isTrashed: false, userEditedTimestampUsec: us('2025-05-05T10:00:00Z') })),
    'Takeout/Keep/Labels.txt': enc.encode('Home stuff\n'),
  });
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
  const docx = zipStore({
    'word/document.xml': enc.encode(`<?xml version="1.0"?><w:document ${W}><w:body>
      <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Trip plan</w:t></w:r></w:p>
      <w:p><w:r><w:t xml:space="preserve">Pack the </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>passport</w:t></w:r><w:r><w:t xml:space="preserve"> and </w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t>maps</w:t></w:r></w:p>
      <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>Tickets</w:t></w:r></w:p>
      <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>Hotel</w:t></w:r></w:p>
      <w:p><w:r><w:t>☐ Book the train</w:t></w:r></w:p><w:p><w:r><w:t>☑ Ask for leave</w:t></w:r></w:p>
      <w:tbl><w:tr><w:tc><w:p><w:r><w:t>Day</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>City</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>1</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Lisbon</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
      <w:p><w:r><w:drawing><a:blip r:embed="rId5"/></w:drawing></w:r></w:p>
    </w:body></w:document>`),
    'word/_rels/document.xml.rels': enc.encode('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId5" Target="media/image1.png"/></Relationships>'),
    'word/media/image1.png': await png(12),
  });
  const apple = zipStore({ 'iCloud Notes/Notes/Recipes/Pancakes.txt': enc.encode('Pancakes\n\n2 eggs, flour, milk\n'), 'iCloud Notes/Notes/Hello.txt': enc.encode('Hello from my iPhone\n') });
  const html = enc.encode('<html><head><title>Garden ideas</title></head><body><h1>Garden ideas</h1><p>Plant <b>roses</b> by the <a href="https://example.org/fence">fence</a>.</p><ul><li><input type="checkbox" checked> Buy seeds</li><li><input type="checkbox"> Dig</li></ul></body></html>');
  return { keep: [...keep], docx: [...docx], apple: [...apple], html: [...html] };
});
const buf = a => Buffer.from(Uint8Array.from(a));
await E(() => setTab('files'));
await page.setInputFiles('#upload', [
  { name: 'takeout-20251020T101010Z-001.zip', mimeType: 'application/zip', buffer: buf(files.keep) },
  { name: 'Trip plan.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: buf(files.docx) },
  { name: 'iCloud Notes.zip', mimeType: 'application/zip', buffer: buf(files.apple) },
  { name: 'Garden.html', mimeType: 'text/html', buffer: buf(files.html) },
  { name: 'Diary.sdocx', mimeType: 'application/octet-stream', buffer: Buffer.from('PK\u0003\u0004 not really') },
]);
await page.waitForFunction(() => [...vfs.nodes.keys()].some(p => p.startsWith('/Imported/Import report')), null, { timeout: 20000 });
const im = await E(() => { const r = p => vfs.isFile(p) ? vfs.read(p) : null; const all = [...vfs.nodes.keys()].filter(p => p.startsWith('/Imported/')); return { all, shop: r('/Imported/Google Keep/Shopping.md'), someday: r('/Imported/Google Keep/Archived/Someday.md'), vet: r('/Imported/Google Keep/Call the vet.md'), trip: r('/Imported/Trip plan.md'), cakes: r('/Imported/iCloud Notes/Notes/Recipes/Pancakes.md'), hello: r('/Imported/iCloud Notes/Notes/Hello.md'), garden: r('/Imported/Garden ideas.md'), report: r(all.find(p => p.includes('Import report'))), tags: [...vaultIndex().tags.keys()] }; });
ok(im.shop && /^---\nsource: Google Keep\ncreated: 2025-03-01 10:00:00\nupdated: 2025-03-02 11:30:00\npinned: true\ncolor: yellow\n---/.test(im.shop) && im.shop.includes('- [ ] Milk\n- [x] Bread') && /!\[\[1a2b3c\.png\]\]/.test(im.shop) && im.shop.includes('#Home-stuff') && im.tags.includes('home-stuff'), 'Google Keep: a checklist becomes tasks, its label a sigil, its picture comes along, pin, colour and dates go in the front matter:\n' + im.shop);
ok(im.someday && /archived: true/.test(im.someday) && !im.all.some(p => /Old idea|Labels|Shopping \d|Shopping\.html/.test(p)), 'Keep: archived notes go to Archived; the trash, the .html copies and Labels.txt stay out: ' + JSON.stringify(im.all.filter(p => p.includes('Keep'))));
ok(im.vet && im.vet.includes('Call the vet\nabout Mrrowr'), 'a Keep note with no title is named by its first line');
ok(im.trip && im.trip.startsWith('# Trip plan\n\nPack the **passport** and *maps*\n\n- Tickets\n- Hotel\n- [ ] Book the train\n- [x] Ask for leave') && im.trip.includes('| Day | City |\n| --- | --- |\n| 1 | Lisbon |') && /!\[\[image1\.png\]\]/.test(im.trip), 'Samsung Notes (Word): heading, bold, italic, list, checkboxes, table and picture:\n' + im.trip);
ok(im.cakes === 'Pancakes\n\n2 eggs, flour, milk\n' && im.hello, 'Apple Notes (the iCloud .zip of .txt notes): every note, in its folders');
ok(im.garden && im.garden.startsWith('# Garden ideas\n\nPlant **roses** by the [fence](https://example.org/fence).\n\n- [x] Buy seeds\n- [ ] Dig'), 'HTML becomes markdown, checkboxes and all:\n' + im.garden);
ok(im.report && /9 leaves from Google Keep/.test(im.report) === false && /from Google Keep/.test(im.report) && /1 note was in the Keep trash/.test(im.report) && /Diary\.sdocx: Samsung Notes' own format can't be read here/.test(im.report), 'a report leaf says what came in, what the trash kept, and why the .sdocx could not be read:\n' + im.report);
await done();
