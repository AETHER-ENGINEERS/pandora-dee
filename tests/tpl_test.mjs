// Note scripts & templates: ```dataviewjs / ```jade-js blocks and `$= …` in Read view (dv API),
// Templater-style templates (<% %>, <%* %>, tp.*), the {} button, the sandbox and its settings.
import { start } from './_harness.mjs';
const { page, ok, write, read, done } = await start();
const E = (fn, arg) => page.evaluate(fn, arg);

await write('/projects/Alpha.md', '---\nstatus: active\nowner: Sam\ntags: [work, q4]\nrank: 2\n---\n# Alpha\n#proj\n- [ ] ship it\n- [x] plan it\n');
await write('/projects/Beta.md', '---\nstatus: paused\nrank: 1\n---\n# Beta\n#proj links to [[Alpha]]\n- [ ] restart\n');
await write('/projects/Gamma.md', '# Gamma\nno tag here\n');
await write('/Other.md', 'Included text from Other.');
const open = async (p) => { await E(p => openFile(p, { mode: 'read' }), p); await page.waitForTimeout(120); };
const settle = () => page.waitForFunction(() => !document.querySelector('#notePrev .jv-js-wait') && ![...document.querySelectorAll('#notePrev .jv-js-inline')].some(s => s.textContent === '…'), null, { timeout: 20000 });

// ---------- live blocks ----------
await write('/Dash.md', `# Dashboard

Projects: \`$= dv.pages('#proj').length\` · Active owner: \`$= dv.pages('"projects"').where(p => p.status === 'active')[0].owner\`

\`\`\`dataviewjs
const pages = dv.pages('#proj').sort(p => p.rank);
dv.header(3, 'Projects by rank');
dv.table(['Note', 'Status', 'Rank', 'Tags'], pages.map(p => [p.file.link, p.status, p.rank, p.file.tags]));
dv.list(dv.pages('"projects"').map(p => p.file.name));
dv.taskList(dv.pages('#proj').flatMap(p => p.file.tasks).filter(t => !t.completed));
dv.paragraph('Here: **' + dv.current().file.name + '** with ' + dv.current().file.outlinks.length + ' links');
console.log('logged line');
\`\`\`

\`\`\`jade-js
const t = await dv.io.load('Other');
dv.span(t.toUpperCase());
\`\`\`
`);
await open('/Dash.md'); await settle();
let h = await E(() => document.querySelector('#notePrev').innerHTML);
let tx = await E(() => document.querySelector('#notePrev').textContent);
ok(/Projects: 2/.test(tx) && /Active owner: Sam/.test(tx), 'inline `$= …` shows values: ' + tx.slice(0, 120).replace(/\n/g, ' '));
ok(/<h3>Projects by rank<\/h3>/.test(h) && /<table class="jv-dv-table">/.test(h), 'dv.header and dv.table render');
const rows = await E(() => [...document.querySelectorAll('#notePrev .jv-dv-table tbody tr')].map(tr => [...tr.children].map(td => td.textContent.trim())));
ok(JSON.stringify(rows) === JSON.stringify([['Beta', 'paused', '1', '#proj'], ['Alpha', 'active', '2', '#proj, #q4, #work']]), 'pages are filtered by #tag, sorted, and fields/frontmatter come through: ' + JSON.stringify(rows));
ok(await E(() => !!document.querySelector('#notePrev .jv-dv-table a.wiki-link[data-wiki="Alpha"]')), 'file.link renders as a tappable [[link]]');
ok(/<li>Alpha<\/li><li>Beta<\/li><li>Gamma<\/li>/.test(h), 'dv.list and folder sources ("projects")');
ok(/ship it/.test(tx) && /restart/.test(tx) && !/plan it/.test(tx), 'dv.taskList shows open tasks from file.tasks');
ok(/Here: Dash with 0 links/.test(tx) && /<strong>Dash<\/strong>/.test(h), 'dv.current() and markdown in dv.paragraph');
ok(/logged line/.test(tx), 'console.log output is shown under the block');
ok(/INCLUDED TEXT FROM OTHER\./.test(tx), '```jade-js blocks work too; dv.io.load reads a note');
await page.screenshot({ path: 'tpl_dash.png' });
// clicking a link in the output opens the note
await page.click('#notePrev .jv-dv-table a.wiki-link[data-wiki="Alpha"]'); await page.waitForTimeout(200);
ok(await E(() => editing === '/projects/Alpha.md'), 'links in script output open notes');

// ---------- errors, sandbox, settings ----------
await write('/Bad.md', "```dataviewjs\ndv.paragraph(nope.x)\n```\n\nInline: `$= 1 +`\n\n```dataviewjs\nconst r = await fetch('https://example.test/data.json'); dv.paragraph('net ' + r.status)\n```\n\n```dataviewjs\nfs.writeFileSync('/hacked.md', 'x'); dv.paragraph('wrote? ' + fs.existsSync('/hacked.md'))\n```\n\n```dataviewjs\nconst x = await jade.tool('bash', { command: 'echo pwned > /pwned.md' }); dv.paragraph(x)\n```\n");
await open('/Bad.md'); await settle();
const errs = await E(() => [...document.querySelectorAll('#notePrev .jv-js-err')].map(e => e.textContent));
tx = await E(() => document.querySelector('#notePrev').textContent);
ok(errs.some(e => /nope is not defined/.test(e)), 'a script error is shown in place: ' + errs[0]);
ok(await E(() => /⚠/.test(document.querySelector('#notePrev .jv-js-inline.err')?.textContent || '')), 'an inline error is shown in place');
ok(errs.some(e => /fetch is not a function|fetch is not defined/.test(e)), 'note scripts have no network');
ok(/wrote\? true/.test(tx) && !(await read('/hacked.md')), 'note scripts cannot change the vault (writes stay in the sandbox)');
ok(errs.some(e => /off for note scripts/.test(e)) && !(await read('/pwned.md')), 'note scripts cannot call Jade\'s tools unless allowed');
await E(() => { S.tplTools = true; TplState.cache.clear(); });
await open('/Bad.md'); await settle();
ok(await read('/pwned.md') === 'pwned\n', 'with "Let note scripts call Jade\'s tools" on, they can');
await E(() => { S.tplTools = false; TplState.cache.clear(); vfs.rm('/pwned.md'); });
await E(() => { S.tplOn = false; });
await open('/Dash.md');
ok(await E(() => !document.querySelector('#notePrev .jv-js') && !!document.querySelector('#notePrev code.language-dataviewjs')), 'with "Run JavaScript in notes" off, blocks are shown as code');
await E(() => { S.tplOn = true; });
// results are cached until the vault changes
await open('/Dash.md'); await settle();
const n1 = await E(() => TplState.cache.size);
await E(() => renderNotePreview()); await settle();
ok(await E(() => TplState.cache.size) === n1, 'rendering again uses the cached results');
await write('/projects/Delta.md', '# Delta\n#proj\n');
await E(() => renderNotePreview()); await settle();
ok(/Projects: 3/.test(await E(() => document.querySelector('#notePrev').textContent)), 'after a vault change the scripts run again (3 projects)');
// split view runs them too
await E(() => setNoteMode('split')); await settle();
ok(await E(() => !!document.querySelector('#notePrev .jv-dv-table')), 'scripts run in Split view');
await E(() => setNoteMode('read'));

// ---------- templates ----------
const render = (text, target, extra) => E(async ([t, p]) => { try { return await tplRender(t, p, { ui: false }); } catch (e) { return 'ERR ' + e.message; } }, [text, target]);
let out = await render('Today <% tp.date.now("YYYY-MM-DD") %>, title <% tp.file.title %>, folder <% tp.file.folder() %>.', '/projects/Alpha.md');
const today = await E(() => jvDate('YYYY-MM-DD'));
ok(out === `Today ${today}, title Alpha, folder projects.`, 'tp.date.now, tp.file.title, tp.file.folder: ' + out);
out = await render('<% tp.date.now("dddd D MMM YYYY", 1, "2026-01-01") %> | <% tp.date.tomorrow("YYYY-MM-DD") === tp.date.now("YYYY-MM-DD", 1) %> | <% tp.date.weekday("YYYY-MM-DD", 1, "2026-10-14") %>', '/x.md');
ok(out === 'Friday 2 Jan 2026 | true | 2026-10-12', 'date offsets, reference dates and weekday: ' + out);
out = await render('Owner: <% tp.frontmatter.owner %>, tags <% tp.file.tags.join(" ") %>', '/projects/Alpha.md');
ok(out === 'Owner: Sam, tags #proj #q4 #work', 'tp.frontmatter and tp.file.tags: ' + out);
out = await render('<%* for (let i = 1; i <= 3; i++) { tR += "- item " + i + "\\n"; } %>done', '/x.md');
ok(out === '- item 1\n- item 2\n- item 3\ndone', '<%* code %> with tR += …: ' + JSON.stringify(out));
out = await render('a\n<%* const x = 5 -%>\nb <% x * 2 %>', '/x.md');
ok(out === 'a\nb 10', '-%> trims the line break after a tag: ' + JSON.stringify(out));
out = await render('A <%_ "x" _%> B', '/x.md');
ok(out === 'AxB', '<%_ _%> trims all whitespace: ' + JSON.stringify(out));
out = await render('Inc: <% await tp.file.include("[[Other]]") %>', '/x.md');
ok(out === 'Inc: Included text from Other.', 'tp.file.include pulls in another note: ' + out);
await write('/Templates/Nested.md', 'nested <% 1 + 1 %>');
out = await render('Outer <% await tp.file.include("[[Nested]]") %>', '/x.md');
ok(out === 'Outer nested 2', '…and runs the tags inside it: ' + out);
out = await render('Open: <% dv.pages("#proj").flatMap(p => p.file.tasks).filter(t => !t.completed).length %>', '/x.md');
ok(out === 'Open: 2', 'dv works inside templates too: ' + out);
out = await render('<% nope() %>', '/x.md');
ok(/^ERR .*nope is not defined/.test(out), 'template errors are reported: ' + out);
out = await render('<% tp.system.prompt("name?") %>', '/x.md');
ok(/^ERR .*only work in a template you insert/.test(out), 'tp.system.prompt needs the interactive insert');
out = await render('<% tp.file.cursor() %>x', '/x.md');
ok(out === '\u0001CURSOR\u0001x', 'tp.file.cursor marks where the cursor goes');

// insert from the editor: {} button → pick a template → filled in at the cursor
await write('/Templates/Meeting.md', '## Meeting <% tp.date.now("YYYY-MM-DD") %> about <% await tp.system.prompt("Topic?", "stuff") %>\nWho: <% await tp.system.suggester(["Sam", "Ana"], ["sam@x", "ana@x"]) %>\n- <% tp.file.cursor() %>\n');
await write('/Notes/Mon.md', '# Mon\n\n');
await E(() => openFile('/Notes/Mon.md', { mode: 'edit' })); await page.waitForTimeout(150);
await E(() => { const ta = $('#fileEd'); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); });
ok(await E(() => !!document.querySelector('#mdTools [data-tpl]')), 'the editor toolbar has a { } template button');
await page.click('#mdTools [data-tpl]'); await page.waitForSelector('.jv-dlg .jv-dlg-item');
const items = await E(() => [...document.querySelectorAll('.jv-dlg .jv-dlg-item')].map(b => b.textContent));
ok(items.join('|') === 'Meeting|Nested', 'the picker lists the notes in /Templates: ' + items.join('|'));
await page.click('.jv-dlg .jv-dlg-item[data-i="0"]');
await page.waitForSelector('.jv-dlg input'); await page.fill('.jv-dlg input', 'budget'); await page.click('.jv-dlg [data-x="ok"]');
await page.waitForSelector('.jv-dlg .jv-dlg-item'); await page.click('.jv-dlg .jv-dlg-item[data-i="1"]');
await page.waitForFunction(() => /Meeting/.test(document.querySelector('#fileEd').value), null, { timeout: 10000 });
const ed = await E(() => ({ v: $('#fileEd').value, cur: $('#fileEd').selectionStart }));
ok(ed.v === `# Mon\n\n## Meeting ${today} about budget\nWho: ana@x\n- \n`, 'the template is filled in (prompt + suggester answers) at the cursor: ' + JSON.stringify(ed.v));
ok(ed.cur === ed.v.lastIndexOf('- ') + 2, 'the cursor goes where tp.file.cursor() was');
await page.waitForTimeout(900);
ok(/about budget/.test(await read('/Notes/Mon.md')), 'the note is saved');
// cancel a prompt → nothing inserted
await page.click('#mdTools [data-tpl]'); await page.waitForSelector('.jv-dlg .jv-dlg-item'); await page.click('.jv-dlg [data-x="cancel"]'); await page.waitForTimeout(100);
ok(await E(() => !document.querySelector('.jv-dlg')), 'the picker can be cancelled');
// run the tags already in a note
await write('/Notes/Tue.md', '# <% tp.file.title %>\nmade <% tp.date.now("YYYY") %>\n');
await E(() => openFile('/Notes/Tue.md', { mode: 'edit' })); await page.waitForTimeout(150);
await page.click('#mdTools [data-tpl]'); await page.waitForSelector('.jv-dlg .jv-dlg-item');
const last = await E(() => [...document.querySelectorAll('.jv-dlg .jv-dlg-item')].at(-1).textContent);
ok(/Run the <% %> tags/.test(last), 'a note with tags offers to run them in place');
await page.click('.jv-dlg .jv-dlg-item:last-child'); await page.waitForTimeout(800);
ok(await read('/Notes/Tue.md') === `# Tue\nmade ${today.slice(0, 4)}\n`, 'running the tags replaces them with their values');
// no templates yet → offer an example
await E(() => { S.tplDir = '/Tpl2'; });
await page.click('#mdTools [data-tpl]'); await page.waitForSelector('.jv-dlg .jv-dlg-item');
ok(/Create an example template in \/Tpl2/.test(await E(() => document.querySelector('.jv-dlg').textContent)), 'with no templates it offers an example (folder from settings)');
await page.click('.jv-dlg .jv-dlg-item:last-child'); await page.waitForTimeout(150);
ok(/tp\.file\.title/.test(await read('/Tpl2/Daily note.md') || ''), 'the example template is created');
const daily = await render(await read('/Tpl2/Daily note.md'), '/Journal/2026-10-14.md');
ok(/^---\ncreated: \d{4}-\d{2}-\d{2} \d{2}:\d{2}\ntags: daily\n---\n# 2026-10-14\n/.test(daily) && /- \[ \] ship it \(Alpha\)/.test(daily) && /\[\[\d{4}-\d{2}-\d{2}\|← yesterday\]\]/.test(daily), 'the example template renders (dates, links, open tasks): ' + JSON.stringify(daily.slice(0, 160)));
await E(() => { S.tplDir = '/Templates'; });

// ---------- settings ----------
await E(() => openSettings()); await page.waitForTimeout(200);
await page.click('#setTabs [data-tab="tools"]');
ok(await E(() => !document.querySelector('#tplSection').classList.contains('tab-off') && $('#sTplOn').checked && !$('#sTplTools').checked && $('#sTplDir').value === '/Templates'), 'Config → Tools has the note scripts section with safe defaults');
await page.screenshot({ path: 'tpl_settings.png' });
await E(() => { $('#sTplTools').checked = true; $('#sTplDir').value = '/MyTemplates'; }); await page.click('#btnSave'); await page.waitForTimeout(300);
const saved = await E(() => JSON.parse(localStorage.getItem('jvault:settings')));
ok(saved.tplTools === true && saved.tplDir === '/MyTemplates' && saved.tplOn === true, 'the settings are saved');
ok(await E(() => /dataviewjs/.test(systemPrompt()) && /Templater tags/.test(systemPrompt()) && /\/MyTemplates/.test(systemPrompt())), 'Jade\'s instructions explain note scripts and the templates folder');
// jvDate tokens
const dates = await E(() => [jvDate('YYYY-MM-DD HH:mm:ss', new Date(2026, 0, 5, 14, 7, 9)), jvDate('ddd Do MMMM [at] h:mm a', new Date(2026, 0, 2, 9, 5)), jvDate('[W]ww YY', new Date(2026, 0, 1)), jvDate('dddd', '2026-10-14')]);
ok(JSON.stringify(dates) === JSON.stringify(['2026-01-05 14:07:09', 'Fri 2nd January at 9:05 am', 'W01 26', 'Wednesday']), 'date formats (moment-style tokens, [literals], ISO weeks): ' + JSON.stringify(dates));
await done();
