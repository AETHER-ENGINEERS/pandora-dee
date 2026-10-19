// Settings are split into tabs. A user clicks the tab that holds a field before using it; this makes a
// Playwright page do the same: before an action on a selector inside a hidden settings tab, open that tab.
export function autoTabs(page) {
  const reveal = async sel => {
    if (typeof sel !== 'string') return;
    try {
      await page.evaluate(s => {
        const el = document.querySelector(s), sec = el?.closest('#settings section[data-tab]');
        if (!sec || !sec.classList.contains('tab-off')) return;
        document.querySelector('#setTabs [data-tab="' + sec.dataset.tab + '"]')?.click();
      }, sel);
    } catch { /* page navigating or closed: let the real action report it */ }
  };
  for (const m of ['fill', 'click', 'tap', 'selectOption', 'check', 'uncheck', 'isChecked', 'textContent', 'innerText', 'inputValue', 'isVisible', 'isHidden', 'press', 'type', 'focus', 'dispatchEvent']) {
    const orig = page[m].bind(page);
    page[m] = async (sel, ...rest) => { await reveal(sel); return orig(sel, ...rest); };
  }
  return page;
}
