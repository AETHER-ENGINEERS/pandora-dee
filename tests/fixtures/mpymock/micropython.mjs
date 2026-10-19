// Test double with the same JS surface as MicroPython's ports/webassembly/api.js (loadMicroPython → {FS, runPython, runPythonAsync}).
// It understands a handful of Python statements so the host plumbing can be exercised.
class PythonError extends Error {}
function makeFS() {
  const nodes = new Map([['/', { dir: true }], ['/tmp', { dir: true }], ['/home', { dir: true }], ['/home/web_user', { dir: true }], ['/dev', { dir: true }], ['/proc', { dir: true }]]);
  let cwd = '/';
  const abs = p => { if (!p.startsWith('/')) p = (cwd === '/' ? '' : cwd) + '/' + p; const o = []; for (const s of p.split('/')) { if (!s || s === '.') continue; if (s === '..') o.pop(); else o.push(s); } return '/' + o.join('/'); };
  const err = c => { const e = new Error(c); e.code = c; return e; };
  return {
    mkdir(p) { p = abs(p); if (nodes.has(p)) throw err('EEXIST'); nodes.set(p, { dir: true }); },
    writeFile(p, d) { p = abs(p); nodes.set(p, { data: typeof d === 'string' ? new TextEncoder().encode(d) : new Uint8Array(d) }); },
    readFile(p, o) { p = abs(p); const n = nodes.get(p); if (!n || n.dir) throw err('ENOENT'); return o?.encoding === 'utf8' ? new TextDecoder().decode(n.data) : n.data; },
    readdir(p) { p = abs(p); const pre = p === '/' ? '/' : p + '/'; const s = new Set(['.', '..']); for (const k of nodes.keys()) if (k !== p && k.startsWith(pre)) s.add(k.slice(pre.length).split('/')[0]); return [...s]; },
    stat(p) { p = abs(p); const n = nodes.get(p); if (!n) throw err('ENOENT'); return { mode: n.dir ? 0o40755 : 0o100644, size: n.data?.length || 0 }; },
    isDir: m => (m & 0o170000) === 0o40000,
    unlink(p) { nodes.delete(abs(p)); }, chdir(p) { p = abs(p); if (!nodes.get(p)?.dir) throw err('ENOENT'); cwd = p; }, cwd: () => cwd, _abs: abs,
  };
}
// Emscripten's runtime browser check (src/shell.js, MIN_SAFARI_VERSION=150000), as in the real build
function humanReadableVersionToPacked(str){str=str.split("-")[0];var parts=str.split(".").slice(0,3);while(parts.length<3)parts.push("00");parts=parts.map((n,i,arr)=>n.padStart(2,"0"));return parts.join("")}
var currentSafariVersion=typeof navigator!=="undefined"&&navigator.userAgent?.includes("Safari/")&&navigator.userAgent.match(/Version\/(\d+\.?\d*\.?\d*)/)?humanReadableVersionToPacked(navigator.userAgent.match(/Version\/(\d+\.?\d*\.?\d*)/)[1]):2147483647;
if(currentSafariVersion<150000){throw new Error(`This emscripten-generated code requires Safari v15.0.0 (detected v${currentSafariVersion})`)}
export async function loadMicroPython(options) {
  const { url, stdout, stderr, stdin, heapsize } = options;
  const wasm = new Uint8Array(await (await fetch(url)).arrayBuffer());
  if (new TextDecoder().decode(wasm.slice(8)) !== 'MOCK-27') throw new Error('bad wasm ' + wasm.length);
  const FS = makeFS(); const enc = s => new TextEncoder().encode(s);
  const out = s => stdout(enc(s)), errOut = s => stderr(enc(s));
  let argv = [];
  const strArg = s => { const m = /^\s*["'](.*)["']\s*$/s.exec(s); return m ? m[1].replace(/\\n/g, '\n') : null; };
  const run = (code) => {
    const lines = code.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i].trim(); let m;
      if ((m = /^JSCALL (\w+)\.(\w+)\((.*)\)$/.exec(l))) { const mod = (globalThis.__mpyMods || {})[m[1]]; if (!mod) throw new Error("ImportError: no module named '" + m[1] + "'"); out(String(mod[m[2]](...JSON.parse('[' + m[3] + ']'))) + '\n'); continue; }
      if (!l || l.startsWith('#') || /^import /.test(l) || /^if .* not in sys\.path/.test(l)) continue;
      if ((m = /^sys\.argv\[:\] = (.*)$/.exec(l))) { argv = JSON.parse(m[1]); continue; }
      if (l === 'print(sys.argv)') { out('[' + argv.map(a => `'${a}'`).join(', ') + ']\n'); continue; }
      if (l === 'print(os.getcwd())') { out(FS.cwd() + '\n'); continue; }
      if ((m = /^print\(open\((.+?)\)\.read\(\)\)$/.exec(l))) { out(FS.readFile(strArg(m[1]), { encoding: 'utf8' }) + '\n'); continue; }
      if ((m = /^print\(len\(os\.listdir\((.+?)\)\)\)$/.exec(l))) { out(String(FS.readdir(strArg(m[1])).length - 2) + '\n'); continue; }
      if ((m = /^open\((.+?),\s*["']w["']\)\.write\((.+)\)$/.exec(l))) { FS.writeFile(strArg(m[1]), strArg(m[2])); continue; }
      if ((m = /^os\.mkdir\((.+)\)$/.exec(l))) { FS.mkdir(strArg(m[1])); continue; }
      if ((m = /^os\.remove\((.+)\)$/.exec(l))) { FS.unlink(strArg(m[1])); continue; }
      if (l === 'print(input())') { let s = ''; for (let c; (c = stdin()) != null && c !== 10;) s += String.fromCharCode(c); out(s + '\n'); continue; }
      if ((m = /^print\((.+)\)$/.exec(l))) { const v = strArg(m[1]); out((v ?? String(eval(m[1]))) + '\n'); continue; }
      if ((m = /^sys\.exit\((\d*)\)$/.exec(l))) throw new PythonError('Traceback (most recent call last):\n  File "<stdin>", line ' + (i + 1) + ', in <module>\nSystemExit: ' + (m[1] || '0'));
      if ((m = /^raise (\w+)\((.*)\)$/.exec(l))) throw new PythonError(`Traceback (most recent call last):\n  File "<stdin>", line ${i + 1}, in <module>\n${m[1]}: ${strArg(m[2]) ?? ''}`);
      if (l === 'while True: pass') { for (;;) {} }
      throw new PythonError(`Traceback (most recent call last):\n  File "<stdin>", line ${i + 1}\nSyntaxError: invalid syntax`);
    }
  };
  return { FS, PyProxy: class {}, globals: {}, registerJsModule(n, m) { (globalThis.__mpyMods ||= {})[n] = m; }, pyimport() {}, runPython: run, runPythonAsync: async c => run(c), _heap: heapsize };
}
