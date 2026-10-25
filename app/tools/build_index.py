#!/usr/bin/env python3
"""Make the Android app's page: dist/pandora-dee.html with Tailwind compiled in, so the phone needs no CDN for
the basics (build.py already inlines marked, DOMPurify and KaTeX with its fonts). Writes android/proj/assets/index.html."""
import re, sys, os
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
s = open(os.path.join(ROOT, 'dist', 'pandora-dee.html'), encoding='utf-8').read()
css = open(os.path.join(ROOT, 'dist', 'tw.css'), encoding='utf-8').read()
a = s.index('<script src="https://cdn.tailwindcss.com/3.4.17"></script>'); b = s.index('</script>', s.index('<script>', a)) + len('</script>')
s = s[:a] + '<style id="tw-compiled">\n' + css + '\n</style>' + s[b:]
for a_, b_ in [('<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"', '<script async src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"'),
               ('<script src="https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/lib/xterm.js"', '<script defer src="https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/lib/xterm.js"'),
               ('<script src="https://cdn.jsdelivr.net/npm/@xterm/addon-fit@0.10.0/lib/addon-fit.js"', '<script defer src="https://cdn.jsdelivr.net/npm/@xterm/addon-fit@0.10.0/lib/addon-fit.js"')]:
    assert s.count(a_) == 1; s = s.replace(a_, b_)
m = re.search(r'<link rel="stylesheet" href="https://fonts.googleapis.com[^"]*">', s); s = s.replace(m.group(0), m.group(0)[:-1] + ' media="print" onload="this.media=\'all\'">')

s = '<!doctype html>\n<html lang="en">\n' + s + '\n</html>\n'
os.makedirs(os.path.join(ROOT, 'android', 'proj', 'assets'), exist_ok=True)
open(os.path.join(ROOT, 'android', 'proj', 'assets', 'index.html'), 'w', encoding='utf-8').write(s); print('index.html', len(s))
