const SEED = {
  '/Welcome.md': `# Welcome to the Vault

This is your second brain, jacked straight into the browser. Every note is a
markdown file in a filesystem stored on this device. Jade can read, write,
search and link them for you, and she still has the full BusyBox shell.

## Start here
- [[Markdown Reference]]: everything the editor renders
- [[Linking Notes]]: how [[wiki links]] and backlinks work
- [[Graph View]]: see your notes as a constellation
- [[Todo List]]: tap a checkbox in Read mode to tick it
- [[Inbox]]: drop quick thoughts here, then ask Jade to file them

## Ask Jade
- "Read my Inbox and turn each idea into its own linked note"
- "What links to [[Linking Notes]]?"
- "Make a Map of Content that links every note by tag"

#start
`,
  '/Inbox.md': `# Inbox

Quick capture. Ask Jade to sort these into notes.

- Look into spaced repetition for the notes in #learning
- Idea: a weekly review note every Sunday (try "schedule a weekly review every sunday at 6pm")
- [[Project Neon]] needs a plan
`,
  '/Todo List.md': `# Todo List

- [x] Open the vault
- [ ] Write a note with a [[wiki link]] in it
- [ ] Tap a missing (pink) link to create that note
- [ ] Open the [[Graph View]]
- [ ] Ask Jade to summarise the vault

#tasks
`,
  '/guides/Markdown Reference.md': `# Markdown Reference

## Text
**Bold**, _italic_, ~~strike~~, \`inline code\` and [external links](https://ollama.com).

## Lists
- Bullet
  - Nested bullet
1. Numbered
2. Items

## Tasks
- [ ] Open task
- [x] Done task

## Quote
> Wake up, samurai. We have notes to write.

## Code
\`\`\`js
const note = '[[Welcome]]'; // links inside code are ignored
console.log(note);
\`\`\`

## Table
| Syntax | Result |
| --- | --- |
| \`[[Note]]\` | link to a note |
| \`[[Note|label]]\` | link with your own label |
| \`[[Note#Heading]]\` | link to a heading |
| \`#tag\` | tag, tap it to filter |

---
Back to [[Welcome]] · #guide
`,
  '/guides/Linking Notes.md': `# Linking Notes

Type \`[[\` in the editor and pick a note from the suggestions. Links work
by note name, so you can move notes between folders without breaking them.

- Green links point at notes that exist.
- Pink links point at notes that do not exist yet. Tap one to create it.
- **Backlinks**: open the Links panel under any note to see what points to it.
- Normal markdown links to \`.md\` files count too: [the reference](Markdown%20Reference.md).

Jump to a heading with [[Markdown Reference#Tasks]], or give a link a label:
[[Graph View|the constellation]].

#guide
`,
  '/guides/Graph View.md': `# Graph View

The Graph button on the Notes screen draws every note as a node and every
link as a line. Bigger nodes have more links. Pink nodes are notes you linked
to but have not written yet.

- Tap a node to open it
- Drag to pan, pinch or scroll to zoom
- Open it from a note for the **local** graph (two hops around that note)

Related: [[Linking Notes]] · #guide
`,
  '/projects/Project Neon.md': `---
status: idea
created: ${new Date().toISOString().slice(0, 10)}
---
# Project Neon

A placeholder project so the graph has something to show. Ask Jade to
"plan Project Neon with tasks and write the plan into this note".

- Inspiration: [[Inbox]]
- Next: [[Neon Plan]]

#project #learning
`,
  '/scripts/vault-stats.js': `// Run me from the Shell tab:  node scripts/vault-stats.js
const fs = require('fs'), path = require('path');
const walk = d => fs.readdirSync(d).flatMap(n => { const p = path.join(d, n); try { return walk(p); } catch { return [p]; } });
const notes = walk('/').filter(p => p.endsWith('.md'));
let words = 0, links = 0;
for (const p of notes) { const t = fs.readFileSync(p, 'utf8'); words += (t.match(/\\S+/g) || []).length; links += (t.match(/\\[\\[[^\\]]+\\]\\]/g) || []).length; }
console.log(\`\${notes.length} notes, \${words} words, \${links} wiki links\`);
`,
};
function seedFs() { for (const [p, c] of Object.entries(SEED)) vfs.write(p, c, { mkdirs: true }); }
