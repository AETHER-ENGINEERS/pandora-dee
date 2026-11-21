# ---------- a quieter, correct browser console (from a Firefox console log on 2.10.8) ----------
# Exec'd by build.py last.
# 1. The web page had no doctype, so browsers ran it in quirks mode ("KaTeX doesn't work in quirks mode", and layout
#    differences from the Android page, which has one). It's a standards-mode page now, like the Android one
#    (app/tools/build_index.py no longer adds a second doctype).
# 2. Code blocks in PowerShell or Windows batch (```powershell, ```cmd, ```bat, ```ps1) showed uncoloured with a
#    highlight.js warning each: the common bundle has neither language. Their language packs (same CDN and version as
#    highlight.js) are fetched the first time such a block appears; until then, and offline, the block is plain text
#    with no warning. Unknown languages are shown as plain text too, instead of a console warning.
# 3. PixiJS pointed at a source map that isn't shipped ("Source map error"), like marked and DOMPurify did before.
HLJS_EXTRA = {'powershell': 'powershell', 'ps1': 'powershell', 'ps': 'powershell', 'pwsh': 'powershell',
              'cmd': 'dos', 'bat': 'dos', 'batch': 'dos', 'dos': 'dos'}
rep("const code = pre.querySelector('code'); if (final && code && window.hljs) { try { hljs.highlightElement(code); } catch {} }",
    "const code = pre.querySelector('code'); if (final && code && window.hljs) hljsBlock(code);")
rep("/* =====================================================================\n   BOOT", """// highlight one code block: a language highlight.js lacks is fetched once if it's one we know (PowerShell, batch),
// and anything else it doesn't know is left as plain text, without the console warning
const HLJS_EXTRA = %s, hljsPacks = {};
function hljsLoad(pack) {
  return hljsPacks[pack] ||= new Promise(res => { const s = document.createElement('script'); s.src = `https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/languages/${pack}.min.js`; s.onload = () => res(true); s.onerror = () => res(false); document.head.appendChild(s); });
}
function hljsBlock(code) {
  const lang = (/\\blanguage-([\\w+#-]+)/.exec(code.className) || [])[1]?.toLowerCase();
  const go = () => { try { hljs.highlightElement(code); } catch {} };
  if (!lang || hljs.getLanguage(lang)) return go();
  const pack = HLJS_EXTRA[lang];
  if (!pack) { code.classList.remove('language-' + lang); code.classList.add('nohighlight'); return; }   // unknown: plain text, no warning
  hljsLoad(pack).then(ok => { if (ok && hljs.getLanguage(lang) && code.isConnected) go(); });
}
/* =====================================================================
   BOOT""" % __import__('json').dumps(HLJS_EXTRA))
s = s.replace('//# sourceMappingURL=pixi.min.js.map', '//# sourceMappingURL_removed=pixi.min.js.map')
if not s.lstrip().lower().startswith('<!doctype'):
    s = '<!doctype html>\n<html lang="en">\n' + s + '\n</html>\n'
