#!/usr/bin/env python3
"""The Discord bridge's archive (--archive, --backfill, --render) with the real discord.py against a fake Discord.

Live messages (people, bots, replies, files), edits and deletions are kept; DMs are not unless asked; a backfill pulls
channel and thread history (active and archived) and resumes; search digs in; the render makes linked markdown notes
under the name the user chose. Run from tests/.work (node tests/run.mjs discord_archive_py) or any directory with
pandora-discord/ next to it. Needs discord.py.
"""
import base64, json, os, pathlib, shutil, subprocess, sys, time, urllib.request

CWD = pathlib.Path.cwd()
ROOT = CWD if (CWD / 'pandora-discord').exists() else pathlib.Path(__file__).resolve().parent.parent
DC = ROOT / 'pandora-discord'
HOME = CWD / 'jdhome-arc'
ARC = HOME / 'archive'
OUT = CWD / 'arc-render'
FDP, DBP = 8796, 8797
G, GEN, OFF, TH, OLD = '70000000000000700', '80000000000000800', '80000000000000801', '80000000000000810', '80000000000000811'
OWNER, ALICE = '10000000000000100', '10000000000000111'
PYENV = '. /home/claude/pyenv.sh; ' if os.path.exists('/home/claude/pyenv.sh') else ''
results, procs = [], []


def ok(cond, msg):
    results.append(('PASS ' if cond else 'FAIL ') + msg)


def sh(args, env=None, wait=False):
    e = {**os.environ, **(env or {})}
    cmd = ['bash', '-c', f'{PYENV}exec python3 {args}']
    if wait:
        return subprocess.run(cmd, env=e, capture_output=True, text=True, timeout=120)
    p = subprocess.Popen(cmd, env=e, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
    procs.append(p)
    return p


def post(url, body, headers=None):
    req = urllib.request.Request(url, data=json.dumps(body).encode(), headers={'content-type': 'application/json', **(headers or {})}, method='POST')
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read() or b'null')


def fd(path, body):
    return post(f'http://127.0.0.1:{FDP}{path}', body)


def tool(token, name, args=None):
    r = post(f'http://127.0.0.1:{DBP}/mcp', {'jsonrpc': '2.0', 'id': 1, 'method': 'tools/call', 'params': {'name': name, 'arguments': args or {}}},
             {'authorization': 'Bearer ' + token})['result']
    text = r['content'][0]['text']
    if r.get('isError'):
        raise RuntimeError(text)
    try:
        return json.loads(text)
    except Exception:
        return text


def lines(scope, cid):
    p = ARC / scope / f'{cid}.jsonl'
    return [json.loads(x) for x in p.read_text(encoding='utf-8').splitlines()] if p.exists() else []


def main():
    for d in (HOME, OUT):
        shutil.rmtree(d, ignore_errors=True)
    sh(f'{DC}/test/fake_discord.py --port {FDP}')
    time.sleep(1.5)
    botfile = CWD / 'jdbot-arc.txt'
    botfile.write_text('FAKE.bot.token\n')
    env = {'JADE_DISCORD_HOME': str(HOME), 'JADE_DISCORD_TEST_API': f'http://127.0.0.1:{FDP}/api/v10'}
    bridge = sh(f'{DC}/jade_discord_bridge.py --port {DBP} --host 127.0.0.1 --bot-token-file {botfile} --archive', env)
    token = ''
    for _ in range(60):
        time.sleep(0.5)
        try:
            token = (HOME / 'token').read_text().strip()
            if tool(token, 'status')['ready']:
                break
        except Exception:
            pass
    ok(bool(token) and tool(token, 'status')['ready'], 'bridge with --archive comes online')

    # ---- live: people, a bot, a reply, a file, a DM; then an edit and a deletion
    cat = base64.b64encode(b'\x89PNG\r\n\x1a\n' + b'cat' * 50).decode()
    fd('/_file', {'name': 'cat.png', 'base64': cat})
    first = fd('/_inject', {'channel_id': GEN, 'author': OWNER, 'content': 'Remember the thing about the property'})['id']
    botmsg = fd('/_inject', {'channel_id': GEN, 'author': '30000000000000300', 'bot': True, 'content': 'I am a character bot'})['id']
    reply = fd('/_inject', {'channel_id': GEN, 'author': ALICE, 'content': 'pancakes on Sunday?', 'reply_to': first})['id']
    pic = fd('/_inject', {'channel_id': GEN, 'author': ALICE, 'content': 'look',
                          'attachments': [{'filename': 'cat.png', 'size': 158, 'url': f'http://127.0.0.1:{FDP}/cdn/cat.png', 'content_type': 'image/png'}]})['id']
    fd('/_inject', {'channel_id': '88' + ALICE, 'author': ALICE, 'content': 'a private DM'})
    time.sleep(1.0)
    fd('/_edit', {'id': first, 'content': 'Remember the thing about the property (edited)'})
    fd('/_delete', {'id': botmsg})
    time.sleep(1.0)

    ev = lines(G, GEN)
    kinds = [(e['ev'], e['id']) for e in ev]
    ok(('create', first) in kinds and ('create', reply) in kinds and ('create', pic) in kinds, 'live: messages are kept as they arrive')
    ok(('create', botmsg) in kinds, 'live: bot messages are kept (the reply queue skips them, the archive does not)')
    ok(('edit', first) in kinds and ('delete', botmsg) in kinds, 'live: edits and deletions are recorded')
    r = next(e for e in ev if e['id'] == reply)
    ok(r['reply_to'] and r['reply_to']['message_id'] == first, 'live: replies keep the message they answer')
    p = next(e for e in ev if e['id'] == pic)
    saved = p['attachments'][0].get('file')
    ok(bool(saved) and (ARC / saved).read_bytes() == base64.b64decode(cat), 'live: attachments are downloaded into the archive')
    ok(not (ARC / 'dm').exists(), 'live: DMs are not kept without --archive-dms')
    q = tool(token, 'get_new_messages')
    ok(all(m['author']['id'] != '30000000000000300' for m in q), 'the reply queue still never carries bots')
    meta = json.loads((ARC / G / 'channels.json').read_text())
    ok(meta['guild']['name'] == 'Book Club' and meta['channels'][GEN]['name'] == 'general', 'channels.json names the server and channel')

    # ---- backfill: history that never came through the Gateway, in channels and threads
    o1 = fd('/_seed', {'channel_id': OFF, 'author': ALICE, 'content': 'old offtopic one'})['id']
    fd('/_seed', {'channel_id': OFF, 'author': OWNER, 'content': 'old offtopic two', 'reply_to': o1})
    fd('/_seed', {'channel_id': TH, 'author': ALICE, 'content': 'a hole in the plot'})
    fd('/_seed', {'channel_id': OLD, 'author': OWNER, 'content': 'an archived pick'})
    fd('/_seed', {'channel_id': '80000000000000821', 'author': ALICE, 'content': 'an old forum post'})
    st = tool(token, 'archive_backfill')
    ok(st.get('started') is True, 'archive_backfill starts in the background')
    for _ in range(80):
        time.sleep(0.25)
        b = tool(token, 'archive_status')['backfill']
        if not b.get('running'):
            break
    ok(not b.get('running') and b.get('finished'), 'backfill finishes')
    ok(len([e for e in lines(G, OFF) if e['ev'] == 'create']) == 2, 'backfill: channel history is archived')
    ok(any(e['text'] == 'a hole in the plot' for e in lines(G, TH)), 'backfill: active threads are archived')
    ok(any(e['text'] == 'an archived pick' for e in lines(G, OLD)), 'backfill: archived threads are archived')
    ok(any(e['text'] == 'an old forum post' for e in lines(G, '80000000000000821')), 'backfill: archived forum posts are archived')
    ok(not any('TypeError' in x for x in b.get('skipped', [])), 'backfill: forum channels raise no TypeError')
    meta = json.loads((ARC / G / 'channels.json').read_text())
    ok(meta['channels'][TH]['thread'] and meta['channels'][TH]['parent_name'] == 'general', 'backfill: threads know their parent channel')
    state = json.loads((ARC / 'state.json').read_text())
    ok(state.get(OFF) and state.get(TH), 'backfill: progress is saved per channel')
    n_before = sum(1 for _ in open(ARC / G / f'{OFF}.jsonl'))
    tool(token, 'archive_backfill')
    for _ in range(80):
        time.sleep(0.25)
        if not tool(token, 'archive_status')['backfill'].get('running'):
            break
    ok(sum(1 for _ in open(ARC / G / f'{OFF}.jsonl')) == n_before, 'backfill: a second run resumes and adds nothing twice')

    # ---- search: the floor you dig in with intent
    hits = tool(token, 'archive_search', {'query': 'property'})
    ok(len(hits) == 1 and hits[0]['id'] == first and '(edited)' in hits[0]['text'], 'archive_search finds the edited version')
    ok(not tool(token, 'archive_search', {'query': 'character bot'}), 'archive_search leaves deleted messages out')
    ok(len(tool(token, 'archive_search', {'query': 'offtopic', 'chat_id': OFF})) == 2, 'archive_search can stay in one channel')

    # ---- render: a vault under the user's own name
    bridge.terminate()
    bridge.wait(10)
    r = sh(f'{DC}/jade_discord_bridge.py --render {OUT} --name "The Chalice" --description "What the server remembers." --archive-dir {ARC}', wait=True)
    ok(r.returncode == 0 and 'note(s)' in r.stdout, 'render runs without Discord or a token')
    v = OUT / 'The Chalice'
    idx = (v / 'The Chalice.md').read_text()
    ok('name: "The Chalice"' in idx and 'What the server remembers.' in idx and '[[Book Club/general/' in idx, 'render: the index note carries the chosen name and description')
    gen = next((v / 'Book Club' / 'general').glob('*.md')).read_text()
    month = next((v / 'Book Club' / 'general').glob('*.md')).stem
    ok(f'^m{first}' in gen and f'[[Book Club/general/{month}#^m{first}|reply]]' in gen, 'render: replies link to the message they answer')
    ok('(edited) ^m' in gen and '· edited' in gen, 'render: edits show the latest text')
    ok(f'pancakes on Sunday? ^m{reply}' in gen, 'render: block ids end each message, so Obsidian can link to it')
    ok('character bot' not in gen, 'render: deleted messages are left out')
    ok(f'![[{pathlib.Path(saved).name}]]' in gen and (v / '_files' / saved).exists(), 'render: images are embedded from _files')
    ok((v / 'Book Club' / 'general' / 'threads' / f'Plot holes ({TH}).md').exists(), 'render: threads get their own notes under their channel')

    # ---- --backfill from the command line, then exit
    fd('/_seed', {'channel_id': OFF, 'author': ALICE, 'content': 'newer offtopic'})
    r = sh(f'{DC}/jade_discord_bridge.py --port {DBP + 1} --host 127.0.0.1 --bot-token-file {botfile} --backfill {G}', env, wait=True)
    ok(r.returncode == 0 and 'done: 1 new message' in r.stderr, '--backfill from the command line adds only what is new, then exits')

    for p in procs:
        try:
            p.terminate()
        except Exception:
            pass
    print('\n'.join(results))
    bad = [x for x in results if x.startswith('FAIL')]
    print(f'\n{len(results) - len(bad)}/{len(results)} passed' + ('' if bad else '\nALL PASS'))
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    try:
        main()
    finally:
        for p in procs:
            try:
                p.kill()
            except Exception:
                pass
