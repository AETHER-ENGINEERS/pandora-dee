/* ---------------- her things on the home host (parity step 1) ----------------
   Served by the home host (host/bridge.js gives window.PandoraDesk.state), the page keeps her chats, branches,
   schedules, settings and the rest on the host: one copy for every device, so every device sees the same her. What
   belongs to one device (which chat is open, a draft, her own API keys, this device's model addresses) stays here.
   Anywhere else (the desktop app, a plain browser, the APK) nothing changes: the browser's own storage, as before. */
const HOST_STATE = (window.PandoraDesk && window.PandoraDesk.state) || null;
if (HOST_STATE) {
  const localLs = { get: ls.get, set: ls.set };
  ls.get = (k, d) => HOST_STATE.lsGet(k, d, localLs);
  ls.set = (k, v) => HOST_STATE.lsSet(k, v, localLs);
  const localDb = { get: idb.get, set: idb.set, del: idb.del };
  idb.get = (k) => (HOST_STATE.dbLocal(k) ? localDb.get(k) : HOST_STATE.dbGet(k));
  idb.set = (k, v) => (HOST_STATE.dbLocal(k) ? localDb.set(k, v) : HOST_STATE.dbSet(k, v));
  idb.del = (k) => (HOST_STATE.dbLocal(k) ? localDb.del(k) : HOST_STATE.dbDel(k));
  // another device wrote while this one did: the host merged the lists, and this page takes the merged one
  HOST_STATE.onMerged((key, value) => {
    try {
      if (key === 'sessions') { sessions = value; renderSessions(); }
      if (key === 'schedules') { Sched.list = value; renderSchedules(); }
    } catch {}
  });
  // what another device changes, as it happens
  HOST_STATE.onChange(async (e) => {
    try {
      if (e.kind === 'db' && e.key === 'sessions') { await loadSessions(); renderSessions(); }
      else if (e.kind === 'db' && e.key === 'schedules') { Sched.list = (await idb.get('schedules')) || []; renderSchedules(); }
      else if (e.kind === 'db' && cur && e.key === 'session:' + cur.id && !e.deleted) toast('This chat was continued on another device: open it again to see.', 'info');
      else if (e.kind === 'ls' && e.key === 'settings') toast('Her settings were changed on another device: they apply here after a reload.', 'info');
    } catch {}
  });
  HOST_STATE.onError((msg) => { try { toast(esc(msg), 'err'); } catch {} });
}

