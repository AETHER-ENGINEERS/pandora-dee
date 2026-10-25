/* =====================================================================
   DRAG TO SCROLL — strips of buttons that run past the edge (the formatting bar, the sigils, a leaf's
   footer, the Config tabs) move with a finger, and now with a mouse too: drag them, or turn the wheel.
   A soft fade marks the side with more. A drag never presses the button it started on.
   ===================================================================== */
const DRAG_STRIPS = '.qk, .tag-bar, #noteFoot, #setTabs';
function dragScrollEdges(el) {
  const more = el.scrollWidth - el.clientWidth > 2;
  el.classList.toggle('more-l', more && el.scrollLeft > 2);
  el.classList.toggle('more-r', more && el.scrollLeft < el.scrollWidth - el.clientWidth - 2);
  el.classList.toggle('can-drag', more);
}
function dragScroll(el) {
  if (el.__drag) return; el.__drag = true;
  let x0 = 0, s0 = 0, id = null, moved = false;
  el.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'mouse' || e.button !== 0 || el.scrollWidth <= el.clientWidth) return;
    x0 = e.clientX; s0 = el.scrollLeft; id = e.pointerId; moved = false;
  });
  el.addEventListener('pointermove', e => {
    if (e.pointerId !== id) return;
    const dx = e.clientX - x0;
    if (!moved && Math.abs(dx) < 6) return;
    if (!moved) { moved = true; el.classList.add('dragging'); try { el.setPointerCapture(id); } catch {} }
    el.scrollLeft = s0 - dx;
  });
  const end = e => {
    if (e.pointerId !== id) return; id = null; el.classList.remove('dragging');
    if (!moved) return;
    // the click that ends a drag is not a press
    const stop = ev => { ev.stopPropagation(); ev.preventDefault(); };
    el.addEventListener('click', stop, { capture: true, once: true });
    setTimeout(() => el.removeEventListener('click', stop, { capture: true }), 0);
  };
  el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
  // a mouse wheel turns sideways here, until the strip reaches its end
  el.addEventListener('wheel', e => {
    if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    const max = el.scrollWidth - el.clientWidth; if (max <= 0) return;
    const next = Math.max(0, Math.min(max, el.scrollLeft + e.deltaY));
    if (next === el.scrollLeft) return;
    e.preventDefault(); el.scrollLeft = next;
  }, { passive: false });
  el.addEventListener('scroll', () => dragScrollEdges(el), { passive: true });
  try { new ResizeObserver(() => dragScrollEdges(el)).observe(el); } catch {}
  try { new MutationObserver(() => dragScrollEdges(el)).observe(el, { childList: true, subtree: true, characterData: true }); } catch {}
  dragScrollEdges(el);
}
function dragScrollInit() { document.querySelectorAll(DRAG_STRIPS).forEach(dragScroll); }
