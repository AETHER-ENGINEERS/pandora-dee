# ---------- the People layer (modules/people.js): names, not ranks ----------
# Exec'd by build.py last, on the finished page. Pandora Dee Fae's design (2026-11-06), the same as PDA SEASIDE's:
# text that reaches a model names the person ({{PERSON_NAME}}, filled per request from their /People dossier)
# instead of "the user", "the owner" or "the keyholder". The base page and the layers above keep their own
# wording so their exact-match edits still hit; this pass changes it in the finished page, and
# tests/people_check.py fails the build if any of the old ranks are left.
import re as _re

s = s.replace('/* =====================================================================\n   BOOT', rd('people.js') + '\n/* =====================================================================\n   BOOT', 1)
# fill the variables on the way to a model: every message, every tool description
rep("    out.push(o);\n  }\n  return out;\n}\nfunction transcriptOf", "    out.push(o);\n  }\n  return relFillMsgs(out);\n}\nfunction transcriptOf")
_tn = 'const toolsNow = routeTools(activeTools());'
if s.count(_tn) != 1: sys.exit(f'PEOPLE: {_tn!r} found {s.count(_tn)} times')
s = s.replace(_tn, 'const toolsNow = relFillTools(routeTools(activeTools()));')
# and on the way to the screen: whatever is shown through esc() (tool results, notices) reads as a name too
rep("const esc = s => String(s).replace(", "const esc = s => relFill(String(s)).replace(")

# "the user" in the page's code (prompts, tool descriptions, tool results, comments) -> the person's name.
# Not in the markup (that is said to you, and has no "the user" left: see the check), not in the bundled libraries.
_KEEP = ('Request was aborted by the user.',)   # a bundled HTTP library's own message
def _people(m):
    code = m.group(0)
    for k in _KEEP: code = code.replace(k, '\x00' + str(_KEEP.index(k)) + '\x00')
    code = _re.sub(r"\b[Tt]he user\b(?![-_])", '{{PERSON_NAME}}', code)
    for i, k in enumerate(_KEEP): code = code.replace('\x00' + str(i) + '\x00', k)
    return code
s = _re.sub(r'<script>[\s\S]*?</script>', _people, s)
