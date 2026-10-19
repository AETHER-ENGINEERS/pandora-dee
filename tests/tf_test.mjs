// TensorFlow.js 4.22 (embedded) in Jade's scripts: node in the shell, flow JavaScript steps, Jade's bash.
// Not in note scripts. Real TensorFlow.js, not a stand-in.
import { start } from './_harness.mjs';
const { page, ok, sh, write, done } = await start();
const E = (fn, arg) => page.evaluate(fn, arg);
const t0 = Date.now();
let r = await sh(`node -e "await tf.ready(); console.log(tf.version.tfjs, tf.getBackend())"`, 60000);
const [ver, backend] = r.out.trim().split(' ');
ok(r.code === 0 && ver === '4.22.0' && ['cpu', 'webgl', 'wasm'].includes(backend), `tf is there in node: TensorFlow.js ${ver}, backend ${backend} (${Date.now() - t0} ms): ` + JSON.stringify(r));
r = await sh(`node -e "const x = tf.tensor([1, 2, 3]); console.log(x.square().sum().dataSync()[0], tf.matMul(tf.tensor2d([[1, 2]]), tf.tensor2d([[3], [4]])).dataSync()[0])"`);
ok(r.out.trim() === '14 11', 'tensor maths works: ' + r.out.trim() + r.err);
r = await sh(`node -e "const t = require('@tensorflow/tfjs'); console.log(t === tf, typeof t.sequential)"`);
ok(r.out.trim() === 'true function', "require('@tensorflow/tfjs') gives the same tf");
await write('/ml/train.js', `import * as tfx from '@tensorflow/tfjs';
const model = tf.sequential();
model.add(tf.layers.dense({ units: 1, inputShape: [1] }));
model.compile({ loss: 'meanSquaredError', optimizer: tf.train.adam(0.1) });
const xs = tf.tensor2d([-1, 0, 1, 2, 3, 4], [6, 1]), ys = tf.tensor2d([-3, -1, 1, 3, 5, 7], [6, 1]);
const h = await model.fit(xs, ys, { epochs: 250, verbose: 0 });
const y = model.predict(tf.tensor2d([10], [1, 1])).dataSync()[0];
await model.save('indexeddb://jade-line');
fs.writeFileSync('/ml/result.json', JSON.stringify({ y, loss: h.history.loss.at(-1) }));
console.log('trained', y.toFixed(2));
`);
const tTrain = Date.now();
r = await sh('node /ml/train.js', 120000);
const res = JSON.parse((await E(() => vfs.isFile('/ml/result.json') ? vfs.read('/ml/result.json') : '{}')));
ok(r.code === 0 && Math.abs(res.y - 19) < 0.5 && res.loss < 0.05, `a small model trains (y = 2x - 1 → f(10) = ${res.y?.toFixed(3)}, loss ${res.loss?.toFixed(4)}, ${Date.now() - tTrain} ms): ` + r.err.slice(0, 300));
r = await sh(`node -e "const m = await tf.loadLayersModel('indexeddb://jade-line'); console.log(m.predict(tf.tensor2d([10], [1, 1])).dataSync()[0].toFixed(1))"`, 60000);
ok(r.code === 0 && Math.abs(+r.out.trim() - 19) < 0.5, 'a saved model loads again in a later script (indexeddb://): ' + r.out.trim() + r.err.slice(0, 200));
r = await sh(`node -e "const l = (await tf.io.listModels()); console.log(Object.keys(l).join())"`);
ok(/indexeddb:\/\/jade-line/.test(r.out), 'tf.io.listModels lists saved models');
// tf with jade.* and fs in the same script
r = await sh(`node -e "const n = (await jade.tool('read', { path: '/ml/result.json' })).length; console.log(tf.scalar(n).mul(2).dataSync()[0] === n * 2)"`);
ok(r.out.trim() === 'true', 'tf works next to jade.* and fs');
// errors are clear, and the script ends (no hanging timers)
r = await sh(`node -e "tf.tensor([1, 2]).reshape([3])"`);
ok(r.code === 1 && /reshape|size/i.test(r.err), 'a TensorFlow error fails the script with its message: ' + r.err.split('\n')[0]);
const tQuick = Date.now();
r = await sh(`node -e "console.log(tf.ones([2, 2]).sum().dataSync()[0])"`);
ok(r.out.trim() === '4' && Date.now() - tQuick < 10000, `a tf script finishes promptly (${Date.now() - tQuick} ms)`);
// scripts that do not use tf do not load it
const tPlain = Date.now();
r = await sh(`node -e "console.log(typeof tf, typeof self.tf)"`);
ok(r.out.trim() === 'undefined undefined', `scripts that do not use tf do not load it (${Date.now() - tPlain} ms)`);
r = await sh(`node -e "const tfjs = 1; console.log('no tf here')"`);
ok(r.out.trim() === 'no tf here', 'a variable named like tf does not break anything');
// a local module that uses tf: loaded because a vault .js file mentions it
await write('/ml/lib.js', "module.exports = { double: (a) => tf.tensor(a).mul(2).arraySync() };");
r = await sh(`node -e "console.log(JSON.stringify(require('/ml/lib.js').double([1, 2])))"`);
ok(r.out.trim() === '[2,4]', 'a required local module can use tf');
// flows: a JavaScript step can use tf
r = await E(async () => { const run = await flowRun({ name: 'TF step', steps: [{ type: 'js', code: 'return tf.tensor($input).mean().dataSync()[0]' }] }, [2, 4, 6]); return { status: run.status, output: run.output, error: run.error }; });
ok(r.status === 'ok' && r.output === 4, 'a flow JavaScript step can use tf: ' + JSON.stringify(r));
// Jade's own bash tool
r = await E(async () => await runTool('bash', { command: `node -e "console.log(tf.tensor([3, 4]).norm().dataSync()[0])"` }, null));
ok(String(r).trim() === '5', "Jade's bash tool can run tf scripts (clean output, no Node.js banner): " + JSON.stringify(r));
r = await sh(`node -e "tf.tensor([1]).dataSync()"`);
ok(r.code === 0 && r.out === '' && r.err === '', 'TensorFlow prints nothing of its own (no banners or WebGL warnings): ' + JSON.stringify(r));
// note scripts do not get it (scripts only)
await write('/TfNote.md', '```dataviewjs\ndv.paragraph("tf is " + typeof tf)\n```\n');
await E(() => openFile('/TfNote.md', { mode: 'read' }));
await page.waitForFunction(() => !document.querySelector('#notePrev .jv-js-wait'), null, { timeout: 20000 });
ok(/tf is undefined/.test(await E(() => document.querySelector('#notePrev').textContent)), 'note scripts do not load TensorFlow.js');
ok(await E(() => /TensorFlow\.js 4\.22 is built in/.test(systemPrompt())), 'Jade knows tf is there');
await done();
