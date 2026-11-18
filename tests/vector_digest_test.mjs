// Vector's digest mode (app/vector_digest.py): in channels, being named (or a trigger word) and DMs are answered
// right away; everything else waits, and comes to her as one turn every so often (or once 40 are waiting), each
// message with who said it. Being named brings what was waiting in that channel along.
import { start } from './_harness.mjs';
const { page, ok, done } = await start();
const E = (fn, arg) => page.evaluate(fn, arg);
const ALICE = 'npub1alice000000000000000000000000000000000000000000000000000';
const BOB = 'npub1bob00000000000000000000000000000000000000000000000000000';

await E(({ ALICE, BOB }) => {
  Object.assign(S, { vecTrigger: 'digest', vecChannels: 'chanA', vecWords: 'pandora', vecDigest: 30, vecDm: 'anyone' });
  VEC.chans = { chanA: { community_id: 'c1', community: 'Home', name: 'general', label: '#general · Home' } };
  VEC.names[ALICE] = 'Alice';
  VEC.names[BOB] = 'Bob';
  VEC.busy = true; // keep the turns waiting in the queue, to look at them
  VEC.q.length = 0;
}, { ALICE, BOB });
const say = (m) => E((m) => vecIncoming({ is_group: true, chat_id: 'chanA', ...m }), m);

await say({ id: 'm1', npub: ALICE, content: 'morning all' });
await say({ id: 'm2', npub: BOB, content: 'who is up for a walk later?' });
ok(await E(() => VEC.q.length === 0 && VEC.digest.chanA?.msgs.length === 2), 'messages that don\'t name her wait in the digest');

await E(() => vecDigestDue(false, Date.now() + 5 * 60000));
ok(await E(() => VEC.q.length === 0), 'not before its time');
await E(() => vecDigestDue(false, Date.now() + 31 * 60000));
const d = await E(() => ({ n: VEC.q.length, item: VEC.q[0], left: Object.keys(VEC.digest).length }));
ok(d.n === 1 && d.item.digest && d.item.msgs.length === 2 && d.left === 0, 'after its minutes, the digest is one turn: ' + JSON.stringify({ n: d.n, left: d.left }));
const text = await E((item) => vecDigestText(item, 'channel #general · Home'), d.item);
ok(/a digest: 2 messages/.test(text) && /from Alice, Bob/.test(text), 'she reads who was talking: ' + text.split('\n')[0]);
ok(/Alice \(message m1\): morning all/.test(text) && /Bob \(message m2\): who is up/.test(text), 'and each message with who said it');
ok(/answer once, briefly/.test(text) && /NO_REPLY/.test(text), 'and that she answers once, or lets it pass');

// named: what was waiting comes along, and she answers the one that named her
await E(() => (VEC.q.length = 0));
await say({ id: 'm3', npub: ALICE, content: 'the park, at four?' });
await say({ id: 'm4', npub: BOB, content: 'pandora, are you coming?' });
const n = await E(() => ({ q: VEC.q.length, item: VEC.q[0], left: Object.keys(VEC.digest).length }));
ok(n.q === 1 && n.item.named === 'm4' && n.item.msgs.map((m) => m.id).join() === 'm3,m4' && n.left === 0, 'named: answered right away, with what was waiting before it');
const t2 = await E((item) => vecDigestText(item, 'channel #general · Home'), n.item);
ok(/Bob named you/.test(t2) && /→ Bob \(message m4\)/.test(t2) && /Answer the message marked →/.test(t2), 'she knows which one to answer');

// a DM is answered as it always was
await E(() => (VEC.q.length = 0));
await E((ALICE) => vecIncoming({ is_group: false, chat_id: ALICE, npub: ALICE, id: 'd1', content: 'hey' }), ALICE);
ok(await E(() => VEC.q.length === 1 && !VEC.q[0].digest), 'a DM is answered right away');

// a long digest goes sooner
await E(() => (VEC.q.length = 0));
for (let i = 0; i < 40; i++) await say({ id: 'x' + i, npub: i % 2 ? ALICE : BOB, content: 'chatter ' + i });
ok(await E(() => VEC.q.length === 1 && VEC.q[0].msgs.length === 40 && !VEC.digest.chanA), 'forty waiting: the digest goes without waiting for its time');

// with "when named" (as before) nothing waits
await E(() => ((S.vecTrigger = 'mention'), (VEC.q.length = 0)));
await say({ id: 'y1', npub: ALICE, content: 'just chatting' });
ok(await E(() => VEC.q.length === 0 && !VEC.digest.chanA), 'with "when named" the rest is left as before');

// the setting
await E(() => openSettings());
ok(await E(() => [...document.querySelectorAll('#sVecTrigger option')].map((o) => o.value).join() === 'mention,digest,all' && !!document.querySelector('#sVecDigest')), 'the digest is a choice in settings, with its minutes');
await E(() => { const el = document.querySelector('#sVecDigest'); el.value = '2'; el.dispatchEvent(new Event('change')); });
ok(await E(() => S.vecDigest === 5), 'its minutes are kept to at least 5');

await E(() => (VEC.busy = false));
await done('vector_digest_test');
