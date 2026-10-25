// Roomy layout: a phone keeps one column; with room the app grows, Leaves and Chat go side by side, every
// divider drags, text size scales the page, and all of it survives a reload (and a lost localStorage).
import { start } from './_harness.mjs';
const { page, ok, done } = await start();
const E = (fn, arg) => page.evaluate(fn, arg);
const box = s => E(s => { const b = document.querySelector(s)?.getBoundingClientRect(); return b ? { x: b.x, y: b.y, w: b.width, h: b.height, r: b.right, b: b.bottom } : null; }, s);
const near = (a, b, tol = 3) => Math.abs(a - b) <= tol;
const drag = async (sel, dx, dy = 0) => {
  const b = await box(sel); const x = b.x + b.w / 2, y = b.y + b.h / 2;
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 4 }); await page.mouse.move(x + dx, y + dy, { steps: 4 });
  await page.mouse.up(); await page.waitForTimeout(150);
};
const overflowX = () => E(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
const reloaded = async () => {
  await page.waitForEvent('load', { timeout: 15000 }).catch(() => {});
  await page.waitForFunction(() => typeof flowRun === 'function' && typeof userShell !== 'undefined' && S.model && typeof Sched !== 'undefined', null, { timeout: 90000 });
  await page.waitForTimeout(1200);
};
const leaves = () => E(() => { setTab('files'); openFile('/Welcome.md', { mode: 'read' }); setNoteMode('split'); });

// ---------- a phone: one column, as before ----------
await E(() => setTab('chat')); await page.waitForTimeout(200);
let app = await box('#app');
ok(!(await E(() => document.body.classList.contains('wide'))) && near(app.w, 390) && !(await overflowX()), 'phone: one column the width of the screen, nothing wider: ' + JSON.stringify(app));
let st = await box('#jadeStage');
await drag('.ui-stage-h', 0, 90);
let st2 = await box('#jadeStage');
ok(near(st2.h, st.h + 90, 4) && near(await E(() => S.uiStageH), st.h + 90, 4), `phone: dragging the avatar's bottom edge changes her height (${Math.round(st.h)} → ${Math.round(st2.h)})`);
await leaves(); await page.waitForTimeout(300);
let ta = await box('#fileEd'), pv = await box('#notePrev');
ok(ta.b <= pv.y + 12 && near(ta.w, pv.w), 'phone: Split mode keeps the editor above the preview');
await drag('.ui-ed', 0, -80);
let ta2 = await box('#fileEd');
ok(ta2.h < ta.h - 50, `phone: the editor/preview divider drags (${Math.round(ta.h)} → ${Math.round(ta2.h)})`);

// ---------- a laptop: the app grows, panes go side by side ----------
await page.setViewportSize({ width: 1440, height: 900 }); await page.waitForTimeout(300);
await E(() => setTab('chat')); await page.waitForTimeout(300);
app = await box('#app'); st = await box('#jadeStage'); const log = await box('[data-panel="chat"] > :not(.jade-stage):not(.ui-handle)');
ok(await E(() => document.body.classList.contains('wide')) && near(app.w, 1280) && near(app.x, 80, 2) && !(await overflowX()), 'wide: the app grows to 1280 px and stays centred: ' + JSON.stringify(app));
ok(st.r <= log.x + 2 && near(st.h, (await box('[data-panel="chat"]')).h, 2), 'wide: Pandora stands beside the conversation, full height');
let h = await box('.ui-stage');
ok(near(h.x + h.w / 2, st.r, 2), 'wide: the avatar divider sits on her edge');
await leaves(); await page.waitForTimeout(300);
let tree = await box('[data-panel="files"]'), leaf = await box('[data-panel="file"]');
ok(tree && leaf && tree.w > 200 && near(tree.r, leaf.x, 2) && (await E(() => document.querySelectorAll('#tree [data-path]').length || document.querySelector('#tree').children.length)) > 0, 'wide: Leaves shows the list beside the open leaf: ' + JSON.stringify({ tree: tree?.w, leaf: leaf?.w }));
ta = await box('#fileEd'); pv = await box('#notePrev');
ok(ta.r <= pv.x + 12 && near(ta.y, pv.y, 2), 'wide: Split mode puts the editor beside the preview');
await E(() => setTab('files')); await page.waitForTimeout(200);
ok(!!(await box('[data-panel="file"]'))?.w, 'wide: going back to the list keeps the open leaf beside it');

// ---------- every divider drags ----------
await E(() => setTab('chat')); await page.waitForTimeout(200);
await drag('.ui-app-right', -100);
app = await box('#app');
ok(near(app.w, 1080) && near(app.x, 180, 2), 'the app’s right edge drags its width (both sides move, it stays centred): ' + Math.round(app.w));
await drag('.ui-app-left', -40);
app = await box('#app');
ok(near(app.w, 1160), 'the app’s left edge drags too: ' + Math.round(app.w));
st = await box('#jadeStage'); await drag('.ui-stage', 70); st2 = await box('#jadeStage');
ok(near(st2.w, st.w + 70), `the avatar divider drags (${Math.round(st.w)} → ${Math.round(st2.w)})`);
await leaves(); await page.waitForTimeout(300);
tree = await box('[data-panel="files"]'); await drag('.ui-tree', 60); let tree2 = await box('[data-panel="files"]');
ok(near(tree2.w, tree.w + 60), `the list divider drags (${Math.round(tree.w)} → ${Math.round(tree2.w)})`);
ta = await box('#fileEd'); await drag('.ui-ed', 100); ta2 = await box('#fileEd');
ok(near(ta2.w, ta.w + 100, 8), `the editor/preview divider drags (${Math.round(ta.w)} → ${Math.round(ta2.w)})`);
const kept = await E(() => ({ uiWidth: S.uiWidth, uiTreeW: S.uiTreeW, uiStageW: S.uiStageW, uiStageH: S.uiStageH, uiEdSplit: S.uiEdSplit }));
ok(kept.uiWidth === 1160 && kept.uiTreeW > 300 && kept.uiStageW > 380 && kept.uiEdSplit > 0.45, 'each drag is saved with the settings: ' + JSON.stringify(kept));
await E(() => document.querySelector('.ui-tree').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
ok(await E(() => !S.uiTreeW) && near((await box('[data-panel="files"]')).w, 340), 'double-clicking a divider resets it');

// ---------- text size ----------
await E(() => { const s = document.querySelector('#sUiScale'); s.value = '1.2'; s.dispatchEvent(new Event('change')); });
await page.waitForTimeout(300);
ok(await E(() => S.uiScale === 1.2 && document.documentElement.style.zoom === '1.2' && document.querySelectorAll('#sUiScale option').length === 7), 'Config → Text size scales the whole page (7 sizes, 85–150 %)');
ok(!(await overflowX()) && (await box('#app')).r <= 1440, 'a bigger text size never makes the page wider than the window');
tree = await box('[data-panel="files"]'); await drag('.ui-tree', 60); tree2 = await box('[data-panel="files"]');
ok(near(tree2.w, tree.w + 60, 4), `at 120 % a divider still follows the pointer exactly (${Math.round(tree.w)} → ${Math.round(tree2.w)} screen px)`);
const vvh = await E(() => parseFloat(document.documentElement.style.getPropertyValue('--vvh')));
ok(!vvh || near(vvh * 1.2, 900, 4), 'the visual-viewport height is divided by the zoom, so the app still fits the screen: ' + vvh);

// ---------- persistence ----------
const before = await E(() => ({ uiScale: S.uiScale, uiWidth: S.uiWidth, uiTreeW: S.uiTreeW, uiStageW: S.uiStageW, uiStageH: S.uiStageH, uiEdSplit: S.uiEdSplit }));
await page.reload(); await reloaded();
let after = await E(() => ({ uiScale: S.uiScale, uiWidth: S.uiWidth, uiTreeW: S.uiTreeW, uiStageW: S.uiStageW, uiStageH: S.uiStageH, uiEdSplit: S.uiEdSplit }));
ok(JSON.stringify(after) === JSON.stringify(before), 'a reload keeps the text size and every width and divider: ' + JSON.stringify(after));
ok(await E(() => document.documentElement.style.zoom === '1.2' && getComputedStyle(document.documentElement).getPropertyValue('--app-w').trim() === '1160px' && document.querySelector('#sUiScale').value === '1.2'), 'after the reload the layout is applied, not just remembered');
await E(() => { localStorage.removeItem('jvault:settings'); localStorage.removeItem('jvault:settingsAt'); });
await page.reload(); await reloaded();
after = await E(() => ({ uiScale: S.uiScale, uiWidth: S.uiWidth, uiTreeW: S.uiTreeW, uiStageW: S.uiStageW, uiStageH: S.uiStageH, uiEdSplit: S.uiEdSplit }));
ok(JSON.stringify(after) === JSON.stringify(before) && await E(() => document.documentElement.style.zoom === '1.2'), 'localStorage lost: the layout comes back from the IndexedDB copy: ' + JSON.stringify(after));

// ---------- reset ----------
await E(() => document.querySelector('#btnUiReset').click()); await page.waitForTimeout(200);
after = await E(() => ({ uiWidth: S.uiWidth, uiTreeW: S.uiTreeW, uiStageW: S.uiStageW, uiStageH: S.uiStageH, uiEdSplit: S.uiEdSplit, uiScale: S.uiScale, w: getComputedStyle(document.documentElement).getPropertyValue('--app-w').trim() }));
ok(!after.uiWidth && !after.uiTreeW && !after.uiStageW && !after.uiStageH && !after.uiEdSplit && after.uiScale === 1.2 && after.w === '1152px', 'Reset layout puts widths and dividers back and keeps the text size: ' + JSON.stringify(after));

// ---------- back to a phone ----------
await E(() => { S.uiScale = 1; layoutApply(); saveSettings(); });
await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(300);
await leaves(); await page.waitForTimeout(300);
ok(!(await E(() => document.body.classList.contains('wide'))) && (await E(() => document.querySelector('[data-panel="files"]').hidden)) && near((await box('#app')).w, 390) && !(await overflowX()), 'shrinking the window back to a phone returns to one column, one screen at a time');

// ---------- a fantasy companion: no pointer-following, no scanlines, unless switched on ----------
await E(() => setTab('chat')); await page.waitForTimeout(300);
const gaze = async () => { const g = {}; for (const [k, x] of [['left', 5], ['right', 385]]) { await page.mouse.move(x, 420, { steps: 3 }); await page.waitForTimeout(500); g[k] = await E(() => Jade.state.model?.internalModel.focusController.targetX ?? null); } return g; };
const look = () => E(() => ({ follow: S.jadeFollow, scan: S.scanlines, cls: document.body.classList.contains('scanlines'), overlay: getComputedStyle(document.body, '::after').backgroundImage }));
let lk = await look(), g = await gaze();
ok(lk.follow === false && lk.scan === false && !lk.cls && lk.overlay === 'none', 'by default: no scanlines over the screen: ' + JSON.stringify(lk));
ok(g.left !== null && Math.abs(g.left) <= 0.4 && Math.abs(g.right) <= 0.4, 'by default: her eyes do not follow the pointer: ' + JSON.stringify(g));
await E(() => openSettings()); await page.waitForTimeout(200);
ok(await E(() => !$('#sJadeFollow').checked && !$('#sScanlines').checked), 'Config shows both switches off');
await E(() => { $('#sJadeFollow').checked = true; $('#sScanlines').checked = true; $('#btnSave').click(); }); await page.waitForTimeout(600);
await E(() => setTab('chat')); lk = await look(); g = await gaze();
ok(lk.follow && lk.scan && lk.cls && /repeating-linear-gradient/.test(lk.overlay) && g.left < -0.5 && g.right > 0.5, 'switched on in Config: the scanlines come back and her eyes follow the pointer: ' + JSON.stringify({ ...lk, overlay: lk.overlay.slice(0, 26), g }));
await page.reload(); await reloaded();
ok(await E(() => S.jadeFollow && S.scanlines && document.body.classList.contains('scanlines')), 'both switches survive a reload');
ok(await E(() => !S.cyberGrid && !document.body.classList.contains('cybergrid') && getComputedStyle(document.querySelector('.jade-stage'), '::before').transform === 'none'), 'by default no cyber grid: she stands in a pool of light, not on a grid floor');

// ---------- the Appearance tab ----------
await E(() => { setTab('chat'); document.querySelector('#btnTheme').click(); }); await page.waitForTimeout(300);
const tabs = await E(() => ({ badge: document.querySelector('#btnTheme').textContent, on: document.querySelector('#setTabs [aria-selected=true]')?.dataset.tab, look: [...document.querySelectorAll('#settings section[data-tab=look]')].map(s => s.querySelector('.pane-h').textContent.trim()), cards: document.querySelectorAll('#jadeAppearancePicker [data-appearance-card]').length }));
ok(tabs.badge === 'Pandora' && tabs.on === 'look' && tabs.look.join('|') === "Pandora's colors|Atmosphere|Text & layout" && tabs.cards === 5, 'the badge says Pandora and opens Config → Appearance (colors, atmosphere, text & layout): ' + JSON.stringify(tabs));
await E(() => document.querySelector('#btnCloseSettings').click()); await page.waitForTimeout(200);

// ---------- layer colours reach the screen ----------
const tex = () => E(() => { const bt = Jade.state.appearanceTexture.baseTexture, gl = Object.values(bt._glTextures || {})[0]; return { dirty: bt.dirtyId, gl: gl?.dirtyId }; });
const t0 = await tex();
await E(() => { const m = document.querySelector('#jadeAppearanceHairMode'); m.value = 'spectrum'; m.dispatchEvent(new Event('change')); const c = document.querySelector('#jadeAppearanceHairColor'); c.value = '#ff2020'; c.dispatchEvent(new Event('change')); });
await page.waitForTimeout(400);
const t1 = await tex();
ok(t1.dirty > t0.dirty && t1.gl === t1.dirty && await E(() => S.jadeHairMode === 'spectrum' && S.jadeHairColor === '#ff2020'), 'a hair colour is uploaded to the texture she is drawn with (it used to stay on the canvas): ' + JSON.stringify({ t0, t1 }));

// ---------- strips of buttons drag to scroll ----------
await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(200);
await E(() => { let hub = '# Hub\n\n'; for (let i = 0; i < 1200; i++) { vfs.write(`/Many/Leaf ${i}.md`, `# Leaf ${i}\n\nsee [[Hub]]\n`, { mkdirs: true }); if (i < 950) hub += `[[Leaf ${i}]] `; } vfs.write('/Hub.md', hub); vfs.changed?.(); });
await E(() => { setTab('files'); openFile('/Hub.md', { mode: 'read' }); }); await page.waitForTimeout(800);
const foot = () => E(() => { const f = document.querySelector('#noteFoot'); return { sl: Math.round(f.scrollLeft), max: f.scrollWidth - f.clientWidth, cls: f.className, threads: document.querySelector('#btnLinks').textContent.trim() }; });
let f0 = await foot();
ok(f0.max > 0 && /can-drag/.test(f0.cls) && /more-r/.test(f0.cls), "a leaf with many threads: its footer runs past the edge and says so with a fade: " + JSON.stringify(f0));
let fb = await box('#noteFoot');
await E(() => { window.__del = 0; const d = document.querySelector('#btnFileDel'); d.__h = () => window.__del++; d.addEventListener('click', d.__h, true); });
const dragFrom = async (x, y, dx) => { await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + dx / 2, y, { steps: 4 }); await page.mouse.move(x + dx, y, { steps: 4 }); await page.mouse.up(); await page.waitForTimeout(150); };
await dragFrom(fb.x + fb.w - 30, fb.y + fb.h / 2, -200);
let f1 = await foot();
ok(f1.sl >= Math.min(100, f0.max) - 1 && /more-l/.test(f1.cls), 'a mouse drags the footer sideways: ' + JSON.stringify({ from: f0.sl, to: f1.sl }));
const del = await box('#btnFileDel');
// out and back, so the drag ends on Delete itself: the click that follows must not press it
await page.mouse.move(del.x + del.w / 2, del.y + del.h / 2); await page.mouse.down(); await page.mouse.move(del.x + del.w / 2 + 40, del.y + del.h / 2, { steps: 4 }); await page.mouse.move(del.x + del.w / 2, del.y + del.h / 2, { steps: 4 }); await page.mouse.up(); await page.waitForTimeout(150);
ok(await E(() => window.__del === 0 && vfs.isFile('/Hub.md')), 'a drag that starts on Delete moves the strip and does not delete');
await E(() => { document.querySelector('#noteFoot').scrollLeft = 0; }); await page.waitForTimeout(100);
await page.mouse.move(fb.x + 60, fb.y + fb.h / 2); await page.mouse.wheel(0, 150); await page.waitForTimeout(200);
ok((await foot()).sl > 50, 'the mouse wheel scrolls the strip sideways');
await E(() => document.querySelector('#btnLinks').click()); await page.waitForTimeout(200);
ok(await E(() => !document.querySelector('#linksPanel').hidden && document.querySelectorAll('#linksPanel .link-item').length > 900), 'a plain click still presses its button (Threads opens the list of threads)');
await E(() => { document.querySelector('#linksPanel').hidden = true; setNoteMode('split'); }); await page.waitForTimeout(200);
const tb = await box('#mdTools'), tbs0 = await E(() => document.querySelector('#mdTools').scrollLeft);
await E(() => { document.querySelector('#mdTools').style.maxWidth = '200px'; }); await page.waitForTimeout(100);
await dragFrom(tb.x + 150, tb.y + tb.h / 2, -120);
ok(await E(() => document.querySelector('#mdTools').scrollLeft) > tbs0 + 60, 'the formatting bar drags too');
await E(() => { document.querySelector('#mdTools').style.maxWidth = ''; document.querySelector('#btnFileDel').removeEventListener('click', document.querySelector('#btnFileDel').__h, true); });
await done();
