// Curiosity sparks about one thread (app/spark_clusters.py): wake-ups on one subject within two hours are one
// cluster entry, a third in a row halts the thread (filed, a question left, the subject rests), and her
// "same"/"new" tags teach it where a thread ends.
import { start } from './_harness.mjs';
const { page, ok, done } = await start();
const E = (fn, arg) => page.evaluate(fn, arg);

const wake = (subject, thread = '', summary = 'looked into it') =>
  E(({ subject, thread, summary }) => {
    CU().pending = { suggested: 'reflect', chosen: 'reflect', intent: '', before: { files: new Map([...vfs.nodes].filter(([, n]) => !n.dir).map(([p, n]) => [p, n.mtime || 0])), mem: 0 }, startedAt: Date.now(), done: false };
    const said = curiosityTool({ action: 'report', summary, subject, thread });
    CU().pending = null;
    return said;
  }, { subject, thread, summary });
const read = (p) => E((p) => (vfs.isFile(p) ? vfs.read(p) : ''), p);
const clusters = () => E(() => [...vfs.nodes.keys()].filter((p) => p.startsWith('/Pandora/Sparks/clusters/') && p.endsWith('.md')));

ok(await E(() => typeof spSame === 'function' && typeof CU === "function"), 'the clustering is on the page');
const s1 = await wake('Lunar Forge pre-brief', '', 'drafted the pre-brief outline');
ok(!/clustered/.test(s1) && (await clusters()).length === 0, 'one wake-up on a subject is just itself');
ok(/Your last wake-up .* was about "Lunar Forge pre-brief"/.test(await E(() => spPromptBlock(cuState()))), 'the next wake-up hears what the last one was about');

const s2 = await wake('Lunar Forge pre-brief readiness', '', 'checked what is still blocking it');
const [c] = await clusters();
ok(/continues the thread "Lunar Forge pre-brief" \(2 wake-ups in a row\)/.test(s2) && c, 'a second on the same subject is clustered: ' + s2.slice(0, 120));
const body = await read(c);
ok(/^# Lunar Forge pre-brief/.test(body) && (body.match(/^- /gm) || []).length === 2 && /drafted the pre-brief outline/.test(body) && /checked what is still blocking/.test(body), 'one entry, each wake-up a sub-item');
ok(/would be the third in a row and halt/.test(await E(() => spPromptBlock(cuState()))), 'and she is told a third would halt it');

const s3 = await wake('the Lunar Forge decision', '', 'another readiness note');
ok(/3 in a row: the chain is halted/.test(s3), 'a third in a row halts the thread, whatever the clustering did');
ok((await read(c)).match(/^- /gm).length === 3, 'the cluster has all three');
const halts = await E(() => [...vfs.nodes.keys()].filter((p) => p.startsWith('/Pandora/Sparks/loop-halts/')));
ok(halts.length === 1 && /ask before continuing/.test(await read(halts[0])), 'the halt is filed in loop-halts');
ok(/Should I keep going on it/.test(await read('/Pandora/Curiosity/Questions.md')), 'and she leaves the person one question');
ok(/Resting after a loop halt.*"Lunar Forge pre-brief"/.test(await E(() => spPromptBlock(cuState()))), 'the subject rests at the next wake-ups');

// another subject is its own; her "same" teaches it, her "new" keeps two apart
await wake('cat genetics', '', 'read about coat colours');
const s5 = await wake('kitten breeding sim', 'same', 'sketched the sim');
ok(/continues the thread "cat genetics"/.test(s5), '"same" joins a thread in other words');
ok(await E(() => spSame('cat genetics', 'kitten breeding sim')), 'and it remembers they are one thread');
const s6 = await wake('kitten breeding sim cards', 'new', 'a different idea');
ok(!/continues the thread/.test(s6), '"new" keeps a look-alike apart');
ok(!(await E(() => spSame('kitten breeding sim', 'kitten breeding sim cards'))), 'and remembers that too');
ok(await E(() => cuState().log.at(-1).subject === 'kitten breeding sim cards'), 'each wake-up keeps its subject in the history');

await done('spark_clusters_test');
