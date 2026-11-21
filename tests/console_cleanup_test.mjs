// A quieter, correct console (app/console_cleanup.py): the page is in standards mode, PowerShell / batch code blocks
// fetch their highlight.js language pack once and are coloured, unknown languages stay plain text without a warning,
// and no shipped library points at a missing source map.
import fs from 'node:fs';
import pw from 'playwright';
import { start } from './_harness.mjs';

// a stand-in highlight.js (the harness blocks the CDN): it records what it was asked to do, and like the real one it
// warns about a language it doesn't know
const HLJS = `window.hljs = (() => { const langs = { javascript: 1, bash: 1, python: 1 }; const aliases = {}; const log = window.__hl = [];
  const get = n => langs[n] || langs[aliases[n]] ? (aliases[n] || n) : undefined;
  return { getLanguage: n => get(n), registerLanguage: (n, f) => { langs[n] = 1; for (const a of (f(window.hljs).aliases || [])) aliases[a] = n; },
    highlightElement: el => { const l = (/language-([\\w+#-]+)/.exec(el.className) || [])[1]; if (l && !get(l)) { console.warn("Could not find the language '" + l + "'"); return; } log.push(l || 'auto'); el.classList.add('hljs'); } }; })();`;
const PACK = name => `hljs.registerLanguage('${name}', () => ({ name: '${name}', aliases: ${name === 'dos' ? "['bat','cmd']" : "['ps1','pwsh','ps']"} }));`;

const { page, ok, model, done } = await start();
const E = (fn, arg) => page.evaluate(fn, arg);
const warns = []; page.on('console', m => { if (m.type() === 'warning' && /Could not find the language/.test(m.text())) warns.push(m.text()); });

ok(await E(() => document.compatMode) === 'CSS1Compat', 'the page runs in standards mode (it has a doctype), so KaTeX and layout behave');
const html = fs.readFileSync(process.env.JV_WEB, 'utf8');
ok(html.toLowerCase().startsWith('<!doctype html>') && !/\/\/# sourceMappingURL=/.test(html), 'it starts with a doctype, and no library points at a missing source map');
const apk = process.env.JV_APK && fs.existsSync(process.env.JV_APK) ? fs.readFileSync(process.env.JV_APK, 'utf8') : '';
ok(!apk || (apk.toLowerCase().startsWith('<!doctype html>') && !/<!doctype/i.test(apk.slice(10, 400))), 'the Android page starts with one doctype too, not two');

// highlight.js and its language packs, served locally
let packs = [];
await page.route('https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/languages/*.min.js', r => { const n = r.request().url().split('/').pop().replace('.min.js', ''); packs.push(n); return r.fulfill({ contentType: 'text/javascript', body: PACK(n) }); });
await E(HLJS => { (0, eval)(HLJS); }, HLJS);

model.chatReply = () => ({ content: 'Here:\n\n```powershell\nGet-ChildItem\n```\n\n```cmd\ndir /s\n```\n\n```ps1\nGet-Date\n```\n\n```javascript\nlet a = 1\n```\n\n```brainfk\n+++.\n```' });
await E(() => newSession());
await page.fill('#input', 'show me'); await E(() => document.querySelector('#btnSend').click());
await page.waitForFunction(() => !running && document.querySelectorAll('#chat pre code').length >= 5, null, { timeout: 15000 });
await page.waitForFunction(() => (window.__hl || []).length >= 4, null, { timeout: 5000 }).catch(() => {});
const r = await E(() => ({ hl: window.__hl, codes: [...document.querySelectorAll('#chat pre code')].slice(-5).map(c => c.className) }));
ok(['powershell', 'cmd', 'ps1', 'javascript'].every(l => r.hl.includes(l)), 'PowerShell, cmd and ps1 blocks are highlighted once their packs load, JavaScript at once: ' + JSON.stringify(r.hl));
ok(JSON.stringify([...packs].sort()) === '["dos","powershell"]', 'each language pack is fetched once: ' + JSON.stringify(packs));
ok(/nohighlight/.test(r.codes[4]) && !/language-brainfk/.test(r.codes[4]), 'an unknown language stays plain text: ' + r.codes[4]);
ok(!warns.length, 'and nothing warns in the console: ' + JSON.stringify(warns));

// offline: a pack that can't be fetched leaves the block plain, still without a warning
await page.unroute('https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/languages/*.min.js');
await E(HLJS => { (0, eval)(HLJS); }, HLJS);   // a fresh stand-in without the packs
model.chatReply = () => ({ content: '```bat\necho hi\n```' });
await page.fill('#input', 'again'); await E(() => document.querySelector('#btnSend').click());
await page.waitForFunction(() => !running, null, { timeout: 15000 }); await page.waitForTimeout(600);
ok(!warns.length && !(await E(() => window.__hl.includes('bat'))), 'offline, a batch block stays plain and quiet');
await done('console_cleanup_test');
