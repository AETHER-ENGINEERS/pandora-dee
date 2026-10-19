import fs from 'node:fs';
import path from 'node:path';
// Compile the Tailwind classes the page uses into plain CSS (the APK has no CDN for it).
const root = path.join(process.env.JV_NODE_MODULES || new URL('../../node_modules', import.meta.url).pathname, 'tailwindcss');
const tw = await import(path.join(root, 'dist', 'lib.mjs'));
const html = fs.readFileSync(process.argv[2], 'utf8');
const input = `@import "tailwindcss";
@theme { --color-void:#040807; --color-panel:#09100e; --color-panel2:#0f1a17; --color-cy:#ffb8c6; --color-yl:#1fe5a5; --color-rd:#ff3d4f; --color-ok:#b8ffdf; --color-dim:#83998f; --color-line:#1a2d27;
  --font-disp: Rajdhani, 'Arial Narrow', sans-serif; --font-body: 'Chakra Petch', system-ui, sans-serif; --font-mono: 'JetBrains Mono', ui-monospace, monospace; }`;
const c = await tw.compile(input, { base: root, loadStylesheet: async (id, base) => { const p = id === 'tailwindcss' ? path.join(root, 'index.css') : path.resolve(base, id.replace(/^tailwindcss\//, '')); const f = fs.existsSync(p) ? p : path.join(root, id.replace(/^tailwindcss\//, '') ); return { path: f, base: path.dirname(f), content: fs.readFileSync(f, 'utf8') }; } });
const cands = new Set(html.match(/[A-Za-z0-9_\-:\[\]\.#\/%(),]+/g));
fs.writeFileSync(process.argv[3], c.build([...cands]));
console.log('css bytes', fs.statSync(process.argv[3]).size);
