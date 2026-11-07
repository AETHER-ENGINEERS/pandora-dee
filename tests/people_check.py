#!/usr/bin/env python3
"""The People layer's check: the built pages name people instead of ranking them.
Fails if a built page says keyholder, keybearer, secretary, "your owner", "the owner", "the user" or "AI assistant"
anywhere a person or a model could read it. Internal names stay allowed (vecOwner, dcOwner, notify_owner, the API's
'assistant' role, role === 'owner'), as do the bundled libraries' own messages.
  python3 tests/people_check.py [page.html ...]     (default: the built pages and docs/index.html)"""
import os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RANKS = re.compile(r"\b(key ?holders?|keybearers?|secretary|your owner|the owner|(?<!not )my owner|the user|an? AI assistant)\b", re.I)
ALLOW = (
    'Request was aborted by the user.',   # a bundled HTTP library's own message
)

def check(path):
    s = open(path, encoding='utf-8').read()
    for a in ALLOW: s = s.replace(a, '')
    # base64 / wasm blobs and the bundled libraries are not text anyone reads
    s = re.sub(r'<script type="application/(octet-stream|json)"[^>]*>[\s\S]*?</script>', '', s)
    s = re.sub(r'<script id="(lib-[\w-]+|katex-js)"[^>]*>[\s\S]*?</script>', '', s)
    bad = []
    for m in RANKS.finditer(s):
        bad.append(s[max(0, m.start() - 70):m.end() + 30].replace('\n', ' '))
    return bad

def main():
    pages = sys.argv[1:] or [p for p in (os.path.join(ROOT, 'dist', n) for n in os.listdir(os.path.join(ROOT, 'dist')) if n.endswith('.html'))] + [os.path.join(ROOT, 'docs', 'index.html')]
    fails = 0
    for p in pages:
        if not os.path.isfile(p): continue
        bad = check(p)
        print(f"{'ok  ' if not bad else 'FAIL'} {os.path.relpath(p, ROOT)}{'' if not bad else f': {len(bad)} rank word(s)'}")
        for b in bad[:40]: print('      …' + b + '…')
        fails += len(bad)
    sys.exit(1 if fails else 0)

if __name__ == '__main__':
    main()
