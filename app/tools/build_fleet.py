#!/usr/bin/env python3
"""Make the Jade Fleet client from the phone page (android/proj/assets/index.html, CDN-free basics inlined):
dist/jade-fleet.html. The same page is the browser client the fleet's broker serves at / and the page inside the
Jade Fleet APK (android/build-apk.sh fleet). See app/modules/fleet.js for what changes."""
import os, re, sys
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
s = open(os.path.join(ROOT, 'android', 'proj', 'assets', 'index.html')).read()
fleet = open(os.path.join(ROOT, 'app', 'modules', 'fleet.js')).read()
assert '</script' not in fleet.lower()


def rep(old, new, count=1):
    global s
    n = s.count(old)
    if n != count:
        sys.exit(f'FLEET: expected {count} of {old[:90]!r}, found {n}')
    s = s.replace(old, new)


def sub(pattern, new, flags=0):
    global s
    s, n = re.subn(pattern, lambda m: new, s, count=1, flags=flags)
    if n != 1:
        sys.exit(f'FLEET: pattern not found: {pattern[:90]}')


rep('<title>Jade Vault</title>', '<title>Jade Fleet</title>')
# the vault is the broker's shared folder (FleetDisk stands in for the phone's own storage)
rep('const DISK = (() => {', fleet + '\nconst DISK = window.FleetDisk || (() => {')
rep("      try { this.info = DK.info(); this.applyScan(DK.scan()); }\n      catch (e) { console.warn('vault: storage unavailable, using the browser database', e.message); this.diskOn = false; }",
    "      try { this.info = DK.info(); this.applyScan(DK.scan()); await FLEET.prefetch(this); }\n      catch (e) { await FLEET.fail(e.message); }")
rep('    await this.migrate();\n', '')                       # never copy a browser's old local vault into the shared one
rep('native: (() => { try { const A = window.NetrunnerAndroid;', 'native: (() => { try { const A = window.FleetDisk ? null : window.NetrunnerAndroid;')   # the phone's own folder is not the vault here
# the terminal: a real pseudo-terminal on the broker
rep('} else term.onData(async d => {\n  const S_ = termState;', '} else term.onData(async d => {\n  if (FLEET.ptyInput(d)) return;\n  const S_ = termState;')
rep('async function termExec(cmd) {\n', 'async function termExec(cmd) {\n  if (FLEET.ptyLine(cmd)) return;\n')
# boot: after the settings load, before connecting to the model
rep('  if (!(await vfs.load())) seedFs();\n  await applyPendingSettings();\n', '  if (!(await vfs.load())) seedFs();\n  await applyPendingSettings();\n  await FLEET.boot();\n')
rep("  if (cmd === 'memory') { ensureMemory();", "  if (cmd === 'fleet') { FLEET.settings(); return; }\n  if (cmd === 'memory') { ensureMemory();")
# tools: vault_search and vision; bash runs on the broker
rep('const OLLAMA_TOOLS = TOOL_DEFS.map(', 'TOOL_DEFS.push(...FLEET.toolDefs);\nconst OLLAMA_TOOLS = TOOL_DEFS.map(')
rep("    case 'bash': {\n", "    case 'vault_search': case 'vision': return await FLEET.tool(name, args, ui);\n    case 'bash': {\n")
sub(r"\{ name: 'bash', description: '(?:[^'\\]|\\.)*'",
    "{ name: 'bash', description: 'Run a command in a real bash shell on the fleet server (Debian), in the shared vault folder: every phone of the fleet sees the same files. Loops, if, functions, pipes, network access, python3 and node work. Each call starts at the vault root. Returns stdout and stderr (last 2000 lines / 50KB) and the exit code. Commands run as the fleet user, not root.'")
rep("const TR_CORE = new Set(['read', ", "const TR_CORE = new Set(['vault_search', 'read', ")
rep("  litert: 'tflite model", "  vision: 'vision detect detection object objects yolo classify classification image photo picture what is in recognise recognize',\n  litert: 'tflite model")
# Jade's instructions: the shell is real bash on the server
a = s.index('- bash runs a ${bb.module ?')
b = s.index('Quote paths with spaces.', a) + len('Quote paths with spaces.')
s = s[:a] + ("- bash runs a real bash shell on the fleet's server (Debian, the OptiPlex), in the shared vault folder; every phone and browser of the fleet sees the same files. "
             "The whole shell works (loops, if, functions, pipes), with network access, python3, node and the server's other programs. Each bash call starts at the vault root; cd does not persist between calls. "
             "Commands run as the fleet's own user, not root: do not use sudo. For long jobs pass a timeout (seconds) or start them with nohup … &. "
             "Vault commands search, tags, links, backlinks and open still work as whole commands. Quote paths with spaces.") + s[b:]
a = s.index('- "node file.js" or node -e "code" runs JavaScript in a sandboxed worker')
b = s.index('- Today is ${longToday()}', a)
s = s[:a] + ("- node and python3 are the server's real ones, run in its vault folder: use them for scripts, bulk edits across notes and data work (pip/npm packages only if installed there). "
             "The jade.* helpers of the in-page node do not exist on the server.\\n"
             "- vault_search finds notes and memories by meaning across the whole fleet; vision detects objects (YOLO) or names what an image shows (MobileNet) on the Xavier's vision engines.\n") + s[b:]
for bad in ['window.FleetDisk || (() => {']:
    assert s.count(bad) == 1
os.makedirs(os.path.join(ROOT, 'dist'), exist_ok=True)
open(os.path.join(ROOT, 'dist', 'jade-fleet.html'), 'w').write(s)
print('jade-fleet.html', len(s))
