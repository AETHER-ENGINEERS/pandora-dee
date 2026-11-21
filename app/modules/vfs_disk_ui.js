/* ---------- vault storage: settings panel, flush on leaving, rescan on return ---------- */
function diskSync() {
  const el = $('#diskSection'); if (!el) return;
  el.hidden = !vfs.diskOn; if (el.hidden) return;
  let i = vfs.info || {}; try { i = DK.info(); vfs.info = i; } catch {}
  let files = 0, bytes = 0; for (const n of vfs.nodes.values()) if (!n.dir) { files++; bytes += fsize(n); }
  const gb = x => x > 1e9 ? (x / 1e9).toFixed(1) + ' GB' : (x / 1e6).toFixed(1) + ' MB';
  if (i.mode === 'desktop') {   // the desktop app: the vault is a folder the person picked on this computer
    const p = el.querySelector('p'); if (p) p.textContent = 'Every note and file is a real file in this folder on the computer, so bash, a file manager, MCP file tools and other apps all see the same files. Pandora only keeps the list of files in memory and reads a file when she needs it. Deleted files go to a trash folder beside it.';
    $('#diskStatus').innerHTML = `<div><span class="dot ok"></span>Your vault is this folder on the computer.</div><div class="text-dim break-all">${esc(i.root || '')}</div><div class="text-dim">${files} files · ${gb(bytes)} · ${gb(i.free || 0)} free on that drive</div>` + (i.warn ? `<div class="text-yl">${esc(i.warn)}</div>` : '');
    const b = $('#btnDiskShared'); b.hidden = typeof DISK.chooseFolder !== 'function'; b.textContent = 'Use another folder…';
    return;
  }
  $('#diskStatus').innerHTML = `<div><span class="dot ${i.mode === 'shared' ? 'ok' : ''}"></span>${i.mode === 'shared' ? 'Your vault is the JadeVault folder on shared storage.' : 'Your vault is in the app’s own storage folder.'}</div>`
    + `<div class="text-dim break-all">${esc(i.root || '')}</div><div class="text-dim">${files} files · ${gb(bytes)} · ${gb(i.free || 0)} free on the phone</div>`
    + (i.warn ? `<div class="text-yl">${esc(i.warn)}</div>` : '');
  const b = $('#btnDiskShared'); b.hidden = i.mode === 'shared';
  b.textContent = i.sharedOk ? 'Move my vault to the JadeVault folder now' : 'Use the JadeVault folder (asks for “all files access”)';
}
$('#btnDiskShared')?.addEventListener('click', () => {
  if (vfs.info?.mode === 'desktop') { vfs.flush(true); let r = ''; try { r = DISK.chooseFolder(); } catch (e) { r = 'ERR:' + e.message; } if (r === 'ok') toast('Opening the vault in the new folder…', 'ok'); else if (r !== 'same') toast('Could not change the folder: ' + esc(String(r).replace(/^ERR:/, '')), 'err'); return; }
  let r = ''; try { r = DISK.diskUseShared(); } catch (e) { r = 'ERR:' + e.message; }
  if (r === 'need-permission') toast('Turn on “Allow access to manage all files” for Jade, come back here, and tap this again.', 'info');
  else if (r === 'ok') { vfs.flush(true); toast('Vault moved to JadeVault. Reloading…', 'ok'); setTimeout(() => location.reload(), 600); }
  else toast('Could not move the vault: ' + esc(r.replace(/^ERR:/, '')), 'err');
});
$('#btnDiskRescan')?.addEventListener('click', () => { const c = vfs.rescan(true); toast(c ? `Picked up ${c} change${c > 1 ? 's' : ''} from the folder.` : 'The folder matches what Pandora has.', 'ok'); diskSync(); });
window.__diskSync = diskSync;
if (vfs.diskOn) {
  if (vfs.info?.mode === 'app' && !ls.get('diskHint')) { ls.set('diskHint', 1); setTimeout(() => toast('Your vault is saved as real files in the app folder. To put it in a JadeVault folder that other apps can open: Config → App → Vault storage.', 'info'), 5000); }
  addEventListener('pagehide', () => vfs.flush(true));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') vfs.flush(true); else vfs.rescan(); });
  addEventListener('focus', () => vfs.rescan());
}
Object.assign(window, { DNode, LRU, DK, fsize, diskSync, buildBackup, idb, toast, $, vfs });
