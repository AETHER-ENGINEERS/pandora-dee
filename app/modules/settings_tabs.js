/* =====================================================================
   SETTINGS TABS — the Config panel is split into a few tabs, with a search box that looks
   through all of them. build.py tags every settings <section> with data-tab.
   ===================================================================== */
const SET_TABS = ['model', 'memory', 'tools', 'connect', 'look', 'app'];
let setTabNow = 'model';
function setSettingsTab(name) {
  if (!SET_TABS.includes(name)) name = 'model';
  setTabNow = name; try { ls.set('setTab', name); } catch {}
  const q = $('#setSearch'); if (q) q.value = '';
  $('#setNone').hidden = true;
  document.querySelectorAll('#settings section[data-tab]').forEach(s => s.classList.toggle('tab-off', s.dataset.tab !== name));
  document.querySelectorAll('#setTabs .set-tab').forEach(b => { const on = b.dataset.tab === name; b.setAttribute('aria-selected', String(on)); if (on) try { b.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch {} });
  const box = $('#settings .inner'); if (box) box.scrollTop = 0;
}
function filterSettings(text) {
  const q = String(text || '').trim().toLowerCase();
  if (!q) return setSettingsTab(setTabNow);
  let n = 0;
  document.querySelectorAll('#settings section[data-tab]').forEach(s => {
    const hit = s.textContent.toLowerCase().includes(q) || [...s.querySelectorAll('input[placeholder],textarea[placeholder]')].some(i => i.placeholder.toLowerCase().includes(q));
    s.classList.toggle('tab-off', !hit); if (hit) n++;
  });
  document.querySelectorAll('#setTabs .set-tab').forEach(b => b.setAttribute('aria-selected', 'false'));
  $('#setNone').hidden = n > 0;
}
// open the tab that holds an element, then scroll to it (slash commands and prompts that point at one setting)
function showSettingsSection(sel) {
  const el = document.querySelector(sel), sec = el?.closest('section[data-tab]');
  if (sec) setSettingsTab(sec.dataset.tab);
  try { el?.scrollIntoView({ block: 'start' }); } catch {}
}
function initSettingsTabs() { let t = 'model'; try { t = ls.get('setTab', 'model'); } catch {} setSettingsTab(t); }
document.querySelectorAll('#setTabs .set-tab').forEach(b => { b.onclick = () => setSettingsTab(b.dataset.tab); });
$('#setSearch').addEventListener('input', e => filterSettings(e.target.value));
