/* ---------- vault storage: settings panel, flush on leaving, rescan on return ---------- */
function diskSync() {
  const el = $('#diskSection'); if (!el) return;
  el.hidden = !vfs.diskOn; if (el.hidden) return;
  let i = vfs.info || {}; try { i = DK.info(); vfs.info = i; } catch {}
  let files = 0, bytes = 0; for (const n of vfs.nodes.values()) if (!n.dir) { files++; bytes += fsize(n); }
  const gb = x => x > 1e9 ? (x / 1e9).toFixed(1) + ' GB' : (x / 1e6).toFixed(1) + ' MB';
  $('#diskStatus').innerHTML = `<div><span class="dot ${i.mode === 'shared' ? 'ok' : ''}"></span>${i.mode === 'shared' ? 'Your vault is the JadeVault folder on shared storage.' : 'Your vault is in the app’s own storage folder.'}</div>`
    + `<div class="text-dim break-all">${esc(i.root || '')}</div><div class="text-dim">${files} files · ${gb(bytes)} · ${gb(i.free || 0)} free on the phone</div>`
    + (i.warn ? `<div class="text-yl">${esc(i.warn)}</div>` : '');
  const b = $('#btnDiskShared'); b.hidden = i.mode === 'shared';
  b.textContent = i.sharedOk ? 'Move my vault to the JadeVault folder now' : 'Use the JadeVault folder (asks for “all files access”)';
}
$('#btnDiskShared')?.addEventListener('click', () => {
  let r = ''; try { r = DISK.diskUseShared(); } catch (e) { r = 'ERR:' + e.message; }
  if (r === 'need-permission') toast('Turn on “Allow access to manage all files” for Jade, come back here, and tap this again.', 'info');
  else if (r === 'ok') { vfs.flush(true); toast('Vault moved to JadeVault. Reloading…', 'ok'); setTimeout(() => location.reload(), 600); }
  else toast('Could not move the vault: ' + esc(r.replace(/^ERR:/, '')), 'err');
});
$('#btnDiskRescan')?.addEventListener('click', () => { const c = vfs.rescan(true); toast(c ? `Picked up ${c} change${c > 1 ? 's' : ''} from the folder.` : 'The folder matches what Jade has.', 'ok'); diskSync(); });
window.__diskSync = diskSync;
if (vfs.diskOn) {
  if (vfs.info?.mode === 'app' && !ls.get('diskHint')) { ls.set('diskHint', 1); setTimeout(() => toast('Your vault is saved as real files in the app folder. To put it in a JadeVault folder that other apps can open: Config → App → Vault storage.', 'info'), 5000); }
  addEventListener('pagehide', () => vfs.flush(true));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') vfs.flush(true); else vfs.rescan(); });
  addEventListener('focus', () => vfs.rescan());
}
Object.assign(window, { DNode, LRU, DK, fsize, diskSync, buildBackup, idb, toast, $, vfs });
