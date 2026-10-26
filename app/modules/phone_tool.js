/* =====================================================================
   PHONE — alarms and timers, ringing, sounds and radio streams, volume, calls, texts, contacts, clipboard,
   launching apps, brightness, radio status, Bluetooth (scan, pair, connect), media keys, and casting to a Chromecast /
   Google TV. The Android halves are PhoneHost.java and CastHost.java.
   Placing a call or sending a text asks the user first (Config → Voice & senses turns that off).
   ===================================================================== */
const PH = { audio: new Set(), ctx: null, tones: new Set() };
const PH_PERMS = {
  call: ['android.permission.CALL_PHONE'], answer: ['android.permission.ANSWER_PHONE_CALLS'], hangup: ['android.permission.ANSWER_PHONE_CALLS'],
  call_state: ['android.permission.READ_PHONE_STATE'], call_log: ['android.permission.READ_CALL_LOG'], sms_send: ['android.permission.SEND_SMS'],
  sms_read: ['android.permission.READ_SMS'], contacts: ['android.permission.READ_CONTACTS'], radio: ['android.permission.READ_PHONE_STATE']
};
// Bluetooth permissions depend on the Android version: 12+ has its own "nearby devices" ones, older versions use location for scanning
function phoneSdk() { try { return +JSON.parse(NA().diskInfo()).sdk || 30; } catch { return 30; } }
function phoneNeeds(act) {
  if (PH_PERMS[act]) return PH_PERMS[act];
  if (act === 'bt_scan') return phoneSdk() >= 31 ? ['android.permission.BLUETOOTH_SCAN', 'android.permission.BLUETOOTH_CONNECT'] : ['android.permission.ACCESS_FINE_LOCATION'];
  if (/^(bluetooth|bt_pair|bt_unpair|bt_connect|bt_disconnect|bt_power)$/.test(act)) return phoneSdk() >= 31 ? ['android.permission.BLUETOOTH_CONNECT'] : null;
  return null;
}
// slow native work (Bluetooth scans, talking to a TV) runs off the page's thread and answers through window.__jcast
const PHA = { n: 0, wait: new Map() };
window.__jcast = (id, r) => { const w = PHA.wait.get(id); if (w) { PHA.wait.delete(id); clearTimeout(w.t); w.res(r); } };
function phoneAsync(op, args, ms = 45000) {
  return new Promise((res, rej) => {
    const id = ++PHA.n; const t = setTimeout(() => { PHA.wait.delete(id); rej(new Error(op + ' took too long')); }, ms);
    PHA.wait.set(id, { res, t });
    try { NA().cast(id, op, JSON.stringify(args)); } catch (e) { clearTimeout(t); PHA.wait.delete(id); rej(e); }
  });
}
const PH_ASYNC = /^(cast_|bt_scan$)/;
const PH_DAYS = { sun: 1, mon: 2, tue: 3, wed: 4, thu: 5, fri: 6, sat: 7 };
async function phoneEnsure(perms) {
  if (!naHas('requestPerms') || !perms?.length) return true;
  const st = naJson('permStatus', perms.join(',')); const need = perms.filter(p => !st[p]); if (!need.length) return true;
  return await new Promise(res => {
    const t = setTimeout(() => res(false), 120000);
    window.__jadePerms = s => { clearTimeout(t); res(need.every(p => s[p])); };
    try { NA().requestPerms(need.join(',')); } catch { clearTimeout(t); res(false); }
  });
}
// ask the user before something that costs money or speaks for them. Resolves true only if they say yes.
function phoneApprove(title, detail) {
  if (S.askRisky === false) return Promise.resolve(true);
  return new Promise(res => {
    const bg = document.createElement('div'); bg.setAttribute('role', 'alertdialog');
    bg.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.65);display:flex;align-items:center;justify-content:center;padding:16px';
    const box = document.createElement('div'); box.style.cssText = 'max-width:420px;width:100%;background:var(--bg2,#10231b);border:1px solid var(--bd,#2f6);border-radius:14px;padding:18px;color:var(--fg,#e8fff4);font:15px/1.4 system-ui,sans-serif;box-shadow:0 10px 40px rgba(0,0,0,.6)';
    box.innerHTML = `<div style="font-weight:700;margin-bottom:8px">${esc(title)}</div><div style="white-space:pre-wrap;word-break:break-word;margin-bottom:14px;opacity:.9">${esc(detail)}</div><div style="display:flex;gap:10px;justify-content:flex-end"><button class="btn btn-ghost" data-no>Don't</button><button class="btn" data-yes>Allow</button></div>`;
    bg.appendChild(box); document.body.appendChild(bg);
    const done = v => { clearTimeout(t); bg.remove(); res(v); };
    const t = setTimeout(() => done(false), 10 * 60 * 1000);
    box.querySelector('[data-yes]').onclick = () => done(true); box.querySelector('[data-no]').onclick = () => done(false);
    try { if (document.hidden && naHas('notify')) NA().notify('Pandora is asking', title); } catch {}
  });
}
const wAudioMime = p => ({ mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac', webm: 'audio/webm' })[(p.split('.').pop() || '').toLowerCase()] || 'audio/mpeg';
async function phoneSoundPlay(a) {
  let src, name;
  if (a.url) { src = String(a.url); if (!/^https?:\/\//i.test(src)) throw new Error('url must be http or https'); name = src; }
  else if (a.path) { const p = resolveFile(a.path, '/'); if (!p) throw new Error(`${a.path} is not in the vault`); src = URL.createObjectURL(new Blob([vfs.nodes.get(p).data], { type: wAudioMime(p) })); name = p; }
  else throw new Error('path (a vault audio file) or url (a stream or file) is required');
  const au = new Audio(); au.src = src; au.volume = Math.max(0, Math.min(1, a.volume == null ? 1 : +a.volume)); au.loop = !!a.loop; au.preload = 'auto';
  PH.audio.add(au);
  const ended = new Promise(res => { au.onended = () => { PH.audio.delete(au); res('ended'); }; au.onerror = () => { PH.audio.delete(au); res('error'); }; });
  try { await au.play(); } catch (e) { PH.audio.delete(au); throw new Error('could not play it: ' + (e.message || e)); }
  if (a.wait) { const r = await Promise.race([ended, wSleep(Math.min(120, +a.seconds || 60) * 1000).then(() => 'timeout')]); if (r !== 'ended') { au.pause(); PH.audio.delete(au); } return { ok: true, finished: r === 'ended', source: name }; }
  if (a.seconds) setTimeout(() => { au.pause(); PH.audio.delete(au); }, Math.min(3600, +a.seconds) * 1000);
  return { ok: true, playing: true, source: name, loop: !!a.loop, note: a.url ? 'a stream plays until sound_stop' : undefined };
}
async function phoneTone(a) {
  const AC = window.AudioContext || window.webkitAudioContext; PH.ctx = PH.ctx || new AC(); const ac = PH.ctx; if (ac.state === 'suspended') await ac.resume();
  let seq = Array.isArray(a.pattern) && a.pattern.length ? a.pattern : [{ hz: +a.hz || 880, ms: +a.ms || 300 }];
  seq = seq.slice(0, 60).map(x => (typeof x === 'number' ? { hz: x, ms: 200 } : { hz: +x.hz || 0, ms: Math.max(10, Math.min(5000, +x.ms || 200)) }));
  const total = seq.reduce((s, x) => s + x.ms, 0); if (total > 60000) throw new Error('tones are limited to 60 seconds in all');
  const gain = ac.createGain(); gain.gain.value = Math.max(0, Math.min(1, a.volume == null ? 0.5 : +a.volume)); gain.connect(ac.destination);
  let t = ac.currentTime + 0.02; const oscs = [];
  for (const x of seq) { if (x.hz > 0) { const o = ac.createOscillator(); o.type = ['sine', 'square', 'sawtooth', 'triangle'].includes(a.wave) ? a.wave : 'sine'; o.frequency.value = Math.max(20, Math.min(20000, x.hz)); o.connect(gain); o.start(t); o.stop(t + x.ms / 1000); oscs.push(o); } t += x.ms / 1000; }
  const handle = { stop() { oscs.forEach(o => { try { o.stop(); } catch {} }); PH.tones.delete(handle); } }; PH.tones.add(handle); setTimeout(() => PH.tones.delete(handle), total + 200);
  if (a.wait) await wSleep(total + 50);
  return { ok: true, ms: total, notes: seq.length };
}
function phoneSoundStop() { let n = 0; for (const au of [...PH.audio]) { try { au.pause(); } catch {} n++; } PH.audio.clear(); for (const t of [...PH.tones]) { t.stop(); n++; } return { ok: true, stopped: n }; }
function phoneDays(d) { return (Array.isArray(d) ? d : [d]).filter(Boolean).map(x => typeof x === 'number' ? x : PH_DAYS[String(x).slice(0, 3).toLowerCase()]).filter(Boolean); }
async function phoneTool(a) {
  sensesAllowed();
  const act = a.action; if (!act) throw new Error('action is required');
  // sounds are made here in the page
  if (act === 'sound_play' || act === 'radio_play') return JSON.stringify(await phoneSoundPlay(a));
  if (act === 'tone' || act === 'beep') return JSON.stringify(await phoneTone(a));
  if (act === 'sound_stop') return JSON.stringify(phoneSoundStop());
  if (!naHas('phone')) throw new Error('this needs the Android app');
  if (PH_ASYNC.test(act) && !naHas('cast')) throw new Error('this needs the newest Android app');
  if (act === 'cast_play' && a.path === undefined && !a.url) throw new Error('cast_play needs url (a direct media link) or path (a vault file)');
  const need = phoneNeeds(act); if (need && !(await phoneEnsure(need))) throw new Error('Android permission was not given: ' + need.map(p => p.split('.').pop()).join(', '));
  const args = { ...a }; delete args.action;
  if (act === 'alarm_set') args.days = phoneDays(a.days);
  if (act === 'call') { if (!(typeof sentryAllows === 'function' && sentryAllows('call', a.number)) && !(await phoneApprove('Pandora wants to call', `${a.name ? a.name + '\n' : ''}${a.number}`))) return JSON.stringify({ error: 'The user said no.' }); }
  if (act === 'sms_send') { if (!(typeof sentryAllows === 'function' && sentryAllows('sms_send', a.to)) && !(await phoneApprove('Pandora wants to send a text', `To: ${a.name ? a.name + ' ' : ''}${a.to}\n\n${a.text}`))) return JSON.stringify({ error: 'The user said no.' }); }
  const r = PH_ASYNC.test(act) ? await phoneAsync(act, args, act === 'bt_scan' ? 60000 : 60000) : NA().phone(act, JSON.stringify(args));
  try { const j = JSON.parse(r); if (j && j.error) throw new Error(j.error); return JSON.stringify(j, null, 1); } catch (e) { if (e instanceof SyntaxError) return r; throw e; }
}
WORLD_TOOL_DEFS.push({
  name: 'phone',
  description: "The phone. Actions: alarm_set (hour, minute, label, days; a real Clock alarm), timer_set, alarms_show, ring/ring_stop; sound_play (vault path or url, incl. radio streams; volume, loop, seconds, wait), tone (hz, ms, wave or pattern), sound_stop, volume; call, answer, hangup, speaker, call_state, call_log (she cannot hear or speak on calls); sms_send, sms_read, contacts (call and sms only when the user asked); clipboard_get/set, open_url (http, geo:, tel:, mailto:, sms:), apps, app_launch, brightness (-1 auto), keep_awake, radio (signal); bluetooth, bt_scan/pair/unpair/connect/disconnect (address or name), bt_power, bt_settings; media (play_pause, next, ...), now_playing; TV: cast_devices, cast_play (url or vault path; title, image, device, start, live), cast_pause/resume/stop/seek/volume/mute/status/close, cast_mirror. device is a name or IP, optional with one TV.",
  parameters: { type: 'object', properties: {
    action: { type: 'string', enum: ['alarm_set', 'timer_set', 'alarms_show', 'ring', 'ring_stop', 'sound_play', 'radio_play', 'tone', 'sound_stop', 'volume', 'call', 'answer', 'hangup', 'speaker', 'call_state', 'call_log', 'sms_send', 'sms_read', 'contacts', 'clipboard_get', 'clipboard_set', 'open_url', 'apps', 'app_launch', 'brightness', 'keep_awake', 'radio', 'bluetooth', 'bt_scan', 'bt_pair', 'bt_unpair', 'bt_connect', 'bt_disconnect', 'bt_power', 'bt_settings', 'media', 'now_playing', 'cast_devices', 'cast_play', 'cast_pause', 'cast_resume', 'cast_stop', 'cast_seek', 'cast_volume', 'cast_mute', 'cast_status', 'cast_close', 'cast_mirror'] },
    hour: { type: 'number' }, minute: { type: 'number' }, days: { type: 'array', items: { type: 'string' } }, label: { type: 'string' }, seconds: { type: 'number' },
    path: { type: 'string' }, url: { type: 'string' }, volume: { type: 'number' }, loop: { type: 'boolean' }, wait: { type: 'boolean' },
    hz: { type: 'number' }, ms: { type: 'number' }, wave: { type: 'string', enum: ['sine', 'square', 'sawtooth', 'triangle'] }, pattern: { type: 'array', items: { type: 'object' } },
    stream: { type: 'string', enum: ['media', 'ring', 'alarm', 'notification', 'voice_call', 'system'] }, level: { type: 'number' },
    number: { type: 'string' }, name: { type: 'string' }, on: { type: 'boolean' }, limit: { type: 'number' },
    to: { type: 'string' }, text: { type: 'string' }, box: { type: 'string', enum: ['inbox', 'sent'] }, from: { type: 'string' }, contains: { type: 'string' }, unread: { type: 'boolean' },
    query: { type: 'string' }, package: { type: 'string' }, address: { type: 'string' }, command: { type: 'string' }, device: { type: 'string' }, title: { type: 'string' }, image: { type: 'string' }, start: { type: 'number' }, live: { type: 'boolean' } },
    required: ['action'] }
});
Object.assign(window, { phoneTool, phoneApprove, phoneEnsure, phoneTone, phoneSoundPlay, phoneSoundStop, phoneAsync, PH });
