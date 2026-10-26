/* =====================================================================
   SCHEDULED BACKUP: upload the vault to a backup server on a schedule (and on demand), restore from it
   ===================================================================== */
// The server is server/jade-backup-server.py (a small REST API; see docs/backup-server.md). Uploads are PUT with a bearer
// token and an X-Sha256 header, so a damaged upload is refused. Backups are gzip-compressed. With "Encrypt", the gzip is
// encrypted on the phone (AES-GCM, key from a passphrase with PBKDF2) before it leaves, so the server never sees notes.
// Keys (API keys, SSH hosts) are only included when "Include API keys" is on, and then encryption is required.
const AB = { running: false };
const abCfg = () => ({ on: !!S.abOn, url: String(S.abUrl || '').trim().replace(/\/+$/, ''), token: String(S.abToken || ''), hours: Math.max(1, +S.abHours || 24), kind: S.abKind === 'config' ? 'config' : 'full', keys: !!S.abKeys, encrypt: !!S.abEncrypt || !!S.abKeys, pass: String(S.abPass || '') });
const abHex = u8 => [...new Uint8Array(u8)].map(b => b.toString(16).padStart(2, '0')).join('');
const abSha = async u8 => abHex(await crypto.subtle.digest('SHA-256', u8));
async function abGzip(u8) { const s = new Blob([u8]).stream().pipeThrough(new CompressionStream('gzip')); return new Uint8Array(await new Response(s).arrayBuffer()); }
async function abGunzip(u8) { const s = new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip')); return new Uint8Array(await new Response(s).arrayBuffer()); }
const AB_ITER = 210000;
async function abKey(pass, salt, iter) { const base = await crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveKey']); return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']); }
async function abEncrypt(u8, pass) {
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12)), key = await abKey(pass, salt, AB_ITER);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, u8));
  return enc.encode(JSON.stringify({ app: 'jade-vault-encrypted', v: 1, kdf: 'PBKDF2-SHA256', iter: AB_ITER, salt: b64enc(salt), iv: b64enc(iv), data: b64enc(ct) }));
}
async function abDecrypt(env, pass) {
  if (!pass) throw new Error('This backup is encrypted: a passphrase is needed.');
  try { const key = await abKey(pass, b64dec(env.salt), env.iter || AB_ITER); return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64dec(env.iv) }, key, b64dec(env.data))); }
  catch { throw new Error('Wrong passphrase, or the backup is damaged.'); }
}
// bytes of a backup file (plain JSON, gzip, or an encrypted envelope) -> the backup object
async function abDecode(u8, pass) {
  if (u8[0] === 0x1f && u8[1] === 0x8b) u8 = await abGunzip(u8);
  const data = JSON.parse(dec.decode(u8));
  if (data && data.app === 'jade-vault-encrypted') {
    const inner = await abDecrypt(data, pass);
    return JSON.parse(dec.decode(inner[0] === 0x1f && inner[1] === 0x8b ? await abGunzip(inner) : inner));
  }
  return data;
}
async function abReadBackup(file) {
  const u8 = new Uint8Array(await file.arrayBuffer()); let pass = '';
  if (!(u8[0] === 0x1f && u8[1] === 0x8b) && /"jade-vault-encrypted"/.test(dec.decode(u8.subarray(0, 200)))) pass = (typeof prompt === 'function' ? prompt('This backup is encrypted. Passphrase:') : '') || '';
  return abDecode(u8, pass);
}

/* ---------- making and sending ---------- */
async function abMake(c) {
  const data = await buildBackup(c.kind, c.keys);
  let bytes = enc.encode(JSON.stringify(data)), ext = '.json';
  if (typeof CompressionStream === 'function') { bytes = await abGzip(bytes); ext = '.json.gz'; }
  if (c.encrypt) { if (!c.pass) throw new Error('Encryption is on but there is no passphrase (Settings → Backup).'); bytes = await abEncrypt(bytes, c.pass); ext = '.enc.json'; }
  const stamp = new Date().toISOString().replace(/\.\d+Z$/, 'Z').replace(/:/g, '-');
  return { name: `jade-vault-${c.kind}-${stamp}${ext}`, bytes, files: Object.keys(data.vault.files).length };
}
async function abCall(c, method, path, { body, headers, ms = 120000 } = {}) {
  if (!/^https?:\/\/[^/\s]+/i.test(c.url)) throw new Error('The server address must start with http:// or https:// (Settings → Backup).');
  if (!c.token) throw new Error('There is no token (Settings → Backup).');
  const ctrl = new AbortController(), t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(c.url + path, { method, body, headers: { Authorization: 'Bearer ' + c.token, ...(headers || {}) }, signal: ctrl.signal, credentials: 'omit' });
    if (!r.ok) { let m = ''; try { m = (await r.json()).error || ''; } catch {} throw new Error(`the server said ${r.status}${m ? ': ' + m : ''}`); }
    return r;
  } catch (e) { throw new Error(ctrl.signal.aborted ? `no answer from ${c.url} in ${ms / 1000}s` : /said \d+/.test(e.message) ? e.message : `could not reach ${c.url} (${e.message})`); }
  finally { clearTimeout(t); }
}
const abSetStatus = o => { ls.set('abStatus', { at: Date.now(), ...o }); abRenderStatus(); };
async function runAutoBackup({ manual = false } = {}) {
  if (AB.running) return { ok: false, msg: 'a backup is already running' };
  const c = abCfg(); AB.running = true; abSetStatus({ ok: null, msg: 'backing up…' });
  try {
    const m = await abMake(c); const sha = await abSha(m.bytes);
    const r = await abCall(c, 'PUT', '/backups/' + encodeURIComponent(m.name), { body: m.bytes, headers: { 'Content-Type': 'application/octet-stream', 'X-Sha256': sha } });
    const j = await r.json().catch(() => ({}));
    if (j.sha256 && j.sha256 !== sha) throw new Error('the server stored different bytes than were sent');
    ls.set('abLast', Date.now()); ls.set('abFails', 0); ls.set('abRetryAt', 0);
    const st = { ok: true, name: m.name, size: m.bytes.length, files: m.files, encrypted: c.encrypt, msg: `${fmtSize(m.bytes.length)} uploaded${c.encrypt ? ' (encrypted)' : ''}` };
    abSetStatus(st); if (manual) toast(`Backup uploaded: ${esc(m.name)}`, 'ok'); return st;
  } catch (e) {
    const n = (ls.get('abFails', 0) || 0) + 1; ls.set('abFails', n); ls.set('abRetryAt', Date.now() + Math.min(6 * 3600e3, 15 * 60e3 * 2 ** (n - 1)));
    abSetStatus({ ok: false, msg: e.message }); if (manual) toast('Backup failed: ' + esc(e.message), 'err'); return { ok: false, msg: e.message };
  } finally { AB.running = false; }
}
async function abList() {
  const r = await abCall(abCfg(), 'GET', '/backups', { ms: 30000 }); return (await r.json()).backups || [];
}
async function abRestore(name) {
  const c = abCfg(); const r = await abCall(c, 'GET', '/backups/' + encodeURIComponent(name));
  const u8 = new Uint8Array(await r.arrayBuffer()); const want = r.headers.get('X-Sha256');
  if (want && want !== await abSha(u8)) throw new Error('the download was damaged (checksum mismatch); nothing was restored');
  return importBackup(new File([u8], name));        // asks before replacing anything, and asks for the passphrase if it is encrypted
}
function abTick() {
  abRenderStatus(); const c = abCfg();
  if (!c.on || AB.running || running || (typeof compacting !== 'undefined' && compacting) || (typeof CU !== 'undefined' && CU.running)) return;
  const last = ls.get('abLast', 0); if (Date.now() < last + c.hours * 3600e3 || Date.now() < ls.get('abRetryAt', 0)) return;
  if (!c.url || !c.token) return;
  runAutoBackup();
}
setInterval(abTick, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) setTimeout(abTick, 4000); });

/* ---------- Pandora's side: she can check and start a backup, never restore ---------- */
async function backupTool(args) {
  const a = String(args.action || 'status').toLowerCase(), c = abCfg();
  if (a === 'status') { const s = ls.get('abStatus', null), last = ls.get('abLast', 0); return `Scheduled backup: ${c.on ? 'on' : 'off'}, every ${c.hours} h, ${c.kind}${c.encrypt ? ', encrypted' : ''}${c.keys ? ', with keys' : ''} to ${c.url || '(no server set)'}. Last success: ${last ? new Date(last).toLocaleString() : 'never'}. Last attempt: ${s ? `${s.ok === false ? 'FAILED: ' : ''}${s.msg}` : 'none'}.`; }
  if (a === 'now') { const r = await runAutoBackup({ manual: false }); if (!r.ok) throw new Error(r.msg); return `Backup uploaded: ${r.name} (${r.msg}).`; }
  if (a === 'list') { const l = await abList(); return l.length ? l.map(b => `${b.name}  ${fmtSize(b.size)}  ${new Date(b.modified * 1000).toLocaleString()}`).join('\n') : 'The server has no backups yet.'; }
  throw new Error('unknown action ' + a + '. Use status, now or list. Restoring is something only the user can do (Settings → Backup).');
}
WORLD_TOOL_DEFS.push({
  name: 'backup',
  description: 'The scheduled vault backup to the user\'s backup server. status: when it last worked. now: back up right away. list: backups on the server. You cannot restore; only the user can.',
  parameters: { type: 'object', properties: { action: { type: 'string', enum: ['status', 'now', 'list'] } }, required: ['action'] },
});

/* ---------- settings ---------- */
function abRenderStatus() {
  const el = document.getElementById('abStatus'); if (!el) return; const c = abCfg(), s = ls.get('abStatus', null), last = ls.get('abLast', 0);
  el.textContent = !c.on ? (s ? `Off · last: ${s.msg}` : 'Off') : `${last ? 'Last good backup ' + clock(last) : 'No backup yet'} · ${s && s.ok === false ? 'last attempt failed: ' + s.msg : s ? s.msg : ''}${last ? ' · next ' + clock(Math.max(last + c.hours * 3600e3, ls.get('abRetryAt', 0))) : ''}`;
}
function abFillSettings() {
  const set = (id, v) => { const e = document.getElementById(id); if (e) e.value = v; }, chk = (id, v) => { const e = document.getElementById(id); if (e) e.checked = !!v; };
  chk('sAbOn', S.abOn); set('sAbUrl', S.abUrl || ''); set('sAbToken', S.abToken || ''); set('sAbHours', S.abHours ?? 24); set('sAbKind', S.abKind || 'full'); chk('sAbKeys', S.abKeys); chk('sAbEncrypt', S.abEncrypt || S.abKeys); set('sAbPass', S.abPass || '');
  abRenderStatus();
}
function abReadSettings() {
  const g = id => document.getElementById(id); if (!g('sAbOn')) return {};
  return { abOn: g('sAbOn').checked, abUrl: g('sAbUrl').value.trim().replace(/\/+$/, ''), abToken: g('sAbToken').value.trim(), abHours: Math.max(1, Math.min(720, parseInt(g('sAbHours').value) || 24)), abKind: g('sAbKind').value === 'config' ? 'config' : 'full', abKeys: g('sAbKeys').checked, abEncrypt: g('sAbEncrypt').checked || g('sAbKeys').checked, abPass: g('sAbPass').value };
}
const abWithForm = fn => async () => { Object.assign(S, abReadSettings()); try { await fn(); } catch (e) { toast(esc(e.message), 'err'); } };
document.addEventListener('click', e => {
  const id = e.target?.id;
  if (id === 'abNow') abWithForm(async () => { toast('Backing up…'); await runAutoBackup({ manual: true }); })();
  else if (id === 'abTest') abWithForm(async () => { const l = await abList(); toast(`Connected. The server holds ${l.length} backup${l.length === 1 ? '' : 's'}.`, 'ok'); })();
  else if (id === 'abPick') abWithForm(async () => {
    const l = await abList(), sel = document.getElementById('abSel'); if (!sel) return;
    sel.innerHTML = l.map(b => `<option value="${esc(b.name)}">${esc(b.name)} · ${fmtSize(b.size)} · ${new Date(b.modified * 1000).toLocaleString()}</option>`).join('') || '<option value="">no backups on the server</option>';
    document.getElementById('abRestoreRow').hidden = !l.length; if (!l.length) toast('The server has no backups yet.');
  })();
  else if (id === 'abRestore') abWithForm(async () => { const n = document.getElementById('abSel')?.value; if (!n) return; await abRestore(n); })();
});
document.addEventListener('change', e => { if (e.target?.id === 'sAbKeys' && e.target.checked) { const x = document.getElementById('sAbEncrypt'); if (x) x.checked = true; } });
Object.assign(window, { abMake, abDecode, abReadBackup, abEncrypt, abDecrypt, runAutoBackup, abList, abRestore, abTick, backupTool, abFillSettings, abReadSettings, abCfg, abGzip, abGunzip });
