/* =====================================================================
   ROOMY LAYOUT — the Atelier uses the space it is given.
   A phone keeps the single column. With room to spare (a laptop, an iPad, a phone in landscape):
   - the app grows (up to 1280 px), and handles on its sides drag it to any width;
   - wide (880 px and up): Leaves shows the list beside the open leaf, and Chat puts the avatar
     beside the conversation, each with a divider you drag;
   - the editor's Split mode gets a divider (side by side when wide, stacked on a phone), and on a
     phone the avatar's height is dragged from its bottom edge.
   Text size (85–150 %) scales the whole interface. Everything is kept with the settings (localStorage,
   with its IndexedDB copy), so a reload never loses a layout. Double-click any handle to reset it.
   ===================================================================== */
const UI_SCALES = [0.85, 0.9, 1, 1.1, 1.2, 1.35, 1.5];
const UI = { wideAt: 880, autoMax: 1280, minW: 360 };
const uiZoom = () => { const z = +S.uiScale; return z >= 0.5 && z <= 2 ? z : 1; };
const uiClamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
// the viewport in CSS px of the zoomed page
const uiVw = () => innerWidth / uiZoom();

// wide, Leaves shows the list beside the open leaf. setTab hides every screen but one, and Tailwind's layered
// [hidden]{display:none!important} outranks any unlayered rule, so the second pane is un-hidden here instead
function layoutPanes() {
  const sc = document.body.dataset.screen, two = document.body.classList.contains('wide') && (sc === 'files' || sc === 'file');
  for (const n of ['files', 'file']) { const p = $(`[data-panel="${n}"]`); if (p) p.hidden = !(two || sc === n); }
  if (two && sc === 'file' && !layoutPanes.tree) { layoutPanes.tree = true; try { renderTree(); } catch {} }
  if (!two || sc === 'files') layoutPanes.tree = false;
}
function layoutApply() {
  const root = document.documentElement, z = uiZoom(), vw = uiVw();
  root.style.zoom = z === 1 ? '' : String(z);
  root.style.setProperty('--ui-zoom', String(z));
  const auto = vw >= 900 ? Math.min(UI.autoMax, vw - 48) : Math.min(560, vw);
  const w = +S.uiWidth > 0 ? uiClamp(+S.uiWidth, Math.min(UI.minW, vw), vw) : auto;
  root.style.setProperty('--app-w', Math.round(w) + 'px');
  const wide = w >= UI.wideAt;
  if (document.body.classList.contains('wide') !== wide) { document.body.classList.toggle('wide', wide); layoutPanes(); }
  document.body.classList.toggle('room', vw - w >= 24);   // space beside the app for its side handles
  root.style.setProperty('--tree-w', Math.round(uiClamp(+S.uiTreeW || 340, 220, w * 0.5)) + 'px');
  root.style.setProperty('--stage-w', Math.round(uiClamp(+S.uiStageW || 380, 220, w * 0.55)) + 'px');
  root.style.setProperty('--stage-h', S.uiStageH > 0 ? Math.round(uiClamp(+S.uiStageH, 120, 640)) + 'px' : 'clamp(150px,30vh,300px)');
  root.style.setProperty('--ed-split', String(uiClamp(+S.uiEdSplit || 0.45, 0.15, 0.85)));
}
// the avatar draws into a canvas sized to its box: tell it the box changed
const layoutResized = () => { clearTimeout(layoutResized.t); layoutResized.t = setTimeout(() => dispatchEvent(new Event('resize')), 60); };

// a drag handle: onMove gets the pointer's travel in CSS px since the drag started; onReset on double-click.
// Under zoom, engines differ on whether pointer and box positions are zoomed; they always agree with each other,
// so the factor is measured from the app's box (its CSS width is known) rather than assumed
function layoutHandle(el, { axis = 'x', onStart, onMove, onEnd, onReset }) {
  el.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    e.preventDefault(); el.setPointerCapture(e.pointerId); el.classList.add('dragging'); document.body.classList.add('ui-dragging');
    const aw = $('#app').getBoundingClientRect().width, cw = layoutPx('--app-w'), z = aw > 0 && cw > 0 ? aw / cw : uiZoom(), x0 = e.clientX, y0 = e.clientY, ctx = onStart?.() ?? null;
    const move = ev => onMove((axis === 'x' ? ev.clientX - x0 : ev.clientY - y0) / z, ctx);
    const up = () => { el.removeEventListener('pointermove', move); el.classList.remove('dragging'); document.body.classList.remove('ui-dragging'); onEnd?.(); saveSettings(); layoutResized(); };
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up, { once: true }); el.addEventListener('pointercancel', up, { once: true });
  });
  el.addEventListener('dblclick', () => { onReset(); layoutApply(); saveSettings(); layoutResized(); });
}
const layoutPx = name => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)) || 0;
function layoutHandles() {
  const app = $('#app'), screens = $('.m-screens'), chat = $('[data-panel="chat"]'), body = $('#noteBody');
  const mk = (cls, label, parent) => { const h = document.createElement('div'); h.className = 'ui-handle ' + cls; h.setAttribute('role', 'separator'); h.setAttribute('aria-label', label + ' (drag; double-click resets)'); h.title = label + ' · double-click resets'; parent.appendChild(h); return h; };
  // the app's width, from either side (it stays centred, so each side moves by half)
  for (const side of ['left', 'right']) {
    layoutHandle(mk('ui-app-' + side, 'App width', app), {
      onStart: () => layoutPx('--app-w'), onMove: (d, w0) => { S.uiWidth = Math.round(uiClamp(w0 + (side === 'right' ? 2 : -2) * d, UI.minW, uiVw())); layoutApply(); },
      onReset: () => { S.uiWidth = 0; } });
  }
  layoutHandle(mk('ui-tree', 'Leaf list width', screens), {
    onStart: () => layoutPx('--tree-w'), onMove: (d, w0) => { S.uiTreeW = Math.round(w0 + d); layoutApply(); }, onReset: () => { S.uiTreeW = 0; } });
  if (chat) layoutHandle(mk('ui-stage', 'Avatar width', chat), {
    onStart: () => layoutPx('--stage-w'), onMove: (d, w0) => { S.uiStageW = Math.round(w0 + d); layoutApply(); }, onReset: () => { S.uiStageW = 0; } });
  const stage = $('#jadeStage');
  if (stage) layoutHandle(mk('ui-stage-h', 'Avatar height', stage), { axis: 'y',
    onStart: () => stage.getBoundingClientRect().height / uiZoom(), onMove: (d, h0) => { S.uiStageH = Math.round(h0 + d); layoutApply(); }, onReset: () => { S.uiStageH = 0; } });
  if (body) {
    const ed = mk('ui-ed', 'Editor and preview', body); body.insertBefore(ed, $('#notePrev'));
    layoutHandle(ed, { axis: 'x',
      onStart: () => body.getBoundingClientRect(), onMove: () => {}, onReset: () => { S.uiEdSplit = 0; } });
    // the split follows the pointer itself (a fraction of the editor box), across or down depending on the layout
    ed.addEventListener('pointermove', e => {
      if (!ed.classList.contains('dragging')) return;
      const r = body.getBoundingClientRect(), across = getComputedStyle(body).flexDirection === 'row';
      S.uiEdSplit = Math.round(uiClamp(across ? (e.clientX - r.left) / r.width : (e.clientY - r.top) / r.height, 0.15, 0.85) * 100) / 100; layoutApply();
    });
  }
}
// Config → App → Text & layout
function layoutSettings() {
  const sel = $('#sUiScale'); if (!sel) return;
  sel.innerHTML = UI_SCALES.map(v => `<option value="${v}">${Math.round(v * 100)}%</option>`).join('');
  sel.value = String(UI_SCALES.includes(uiZoom()) ? uiZoom() : 1);
  sel.onchange = () => { S.uiScale = +sel.value; layoutApply(); saveSettings(); layoutResized(); };
  const reset = $('#btnUiReset');
  if (reset) reset.onclick = () => { Object.assign(S, { uiWidth: 0, uiTreeW: 0, uiStageW: 0, uiStageH: 0, uiEdSplit: 0 }); layoutApply(); saveSettings(); layoutResized(); toast('Layout reset: widths and dividers are back to their defaults', 'ok'); };
}
function layoutInit() {
  layoutApply(); layoutHandles(); layoutSettings();
  addEventListener('resize', () => { if (!document.body.classList.contains('ui-dragging')) layoutApply(); });
}
