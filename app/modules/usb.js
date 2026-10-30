/* =====================================================================
   USB: devices on the phone's USB port (OTG) or the computer's, for the page and for Pandora.
   - In the Android app the WebView has no WebUSB, so navigator.usb is provided here on top of Android's own USB API
     (UsbHost.java): getDevices, requestDevice (Android asks the user once per device), open, claim, control and
     bulk/interrupt transfers, connect/disconnect events. Ordinary WebUSB code runs unchanged.
   - In a browser it is the browser's own WebUSB (Chrome, Edge; desktop or Android Chrome, on https or localhost):
     only a person can pick a device there, so Pandora asks with a button.
   - The usb tool gives Pandora the same: list, request, open/close, claim/release, control and data transfers.
   ===================================================================== */
const USBX = { seq: 0, wait: new Map(), devs: new Map(), native: false };
window.__jusb = (id, r) => { const f = USBX.wait.get(id); if (f) { USBX.wait.delete(id); f(r); } };
function usbCall(op, args = {}) {
  return new Promise((resolve, reject) => {
    const id = ++USBX.seq;
    USBX.wait.set(id, (r) => {
      let j; try { j = JSON.parse(r); } catch { return reject(new Error('usb: unreadable answer')); }
      if (j && j.error && !j.status && j.granted == null) return reject(Object.assign(new Error(j.error), { name: 'NetworkError' }));
      resolve(j);
    });
    try { window.NetrunnerAndroid.usb(id, op, JSON.stringify(args)); } catch (e) { USBX.wait.delete(id); reject(e); }
  });
}
const usbB64 = (d) => {
  const u = d == null ? new Uint8Array(0) : d instanceof ArrayBuffer ? new Uint8Array(d) : ArrayBuffer.isView(d) ? new Uint8Array(d.buffer, d.byteOffset, d.byteLength) : new Uint8Array(d);
  let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s);
};
const usbDV = (b) => { const s = atob(b || ''); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return new DataView(u.buffer); };
const usbErr = (msg, name) => { try { return new DOMException(msg, name); } catch { return Object.assign(new Error(msg), { name }); } };

class JadeUSBDevice {
  constructor(info) { this.opened = false; this._alt = {}; this._claimed = new Set(); this._set(info); }
  _set(i) {
    this._id = i.id; this.vendorId = i.vendorId; this.productId = i.productId;
    this.deviceClass = i.deviceClass; this.deviceSubclass = i.deviceSubclass; this.deviceProtocol = i.deviceProtocol;
    this.productName = i.productName || ''; this.manufacturerName = i.manufacturerName || ''; this.serialNumber = i.serialNumber || '';
    const [maj, min] = String(i.version || '0.0').split('.').map(x => +x || 0); this.deviceVersionMajor = maj; this.deviceVersionMinor = Math.floor(min / 10); this.deviceVersionSubminor = min % 10;
    this.usbVersionMajor = 2; this.usbVersionMinor = 0; this.usbVersionSubminor = 0;
    const byNum = new Map();
    for (const f of i.interfaces || []) { if (!byNum.has(f.number)) byNum.set(f.number, []); byNum.get(f.number).push(f); }
    const self = this;
    const interfaces = [...byNum].map(([n, alts]) => {
      const al = alts.map(f => ({ alternateSetting: f.alternate, interfaceClass: f.interfaceClass, interfaceSubclass: f.interfaceSubclass, interfaceProtocol: f.interfaceProtocol, interfaceName: f.name || '',
        endpoints: (f.endpoints || []).map(e => ({ endpointNumber: e.number, direction: e.direction, type: e.type, packetSize: e.packetSize })) }));
      return { interfaceNumber: n, alternates: al, get alternate() { return al.find(a => a.alternateSetting === (self._alt[n] || 0)) || al[0]; }, get claimed() { return self._claimed.has(n); } };
    });
    this.configuration = { configurationValue: 1, configurationName: '', interfaces };
    this.configurations = [this.configuration];
  }
  async open() { await usbCall('open', { device: this._id }); this.opened = true; }
  async close() { await usbCall('close', { device: this._id }); this.opened = false; this._claimed.clear(); }
  async forget() { try { await this.close(); } catch {} }
  async selectConfiguration(v) { if (v !== 1) throw usbErr('this device has one configuration (1)', 'NotFoundError'); }
  async claimInterface(n) { await usbCall('claim', { device: this._id, interface: n, alternate: this._alt[n] || 0 }); this._claimed.add(n); }
  async releaseInterface(n) { await usbCall('release', { device: this._id, interface: n }); this._claimed.delete(n); }
  async selectAlternateInterface(n, alt) { await usbCall('select_alt', { device: this._id, interface: n, alternate: alt }); this._alt[n] = alt; }
  async controlTransferIn(setup, length) {
    const r = await usbCall('control', { device: this._id, direction: 'in', requestType: setup.requestType, recipient: setup.recipient, request: setup.request, value: setup.value, index: setup.index, length });
    return { status: r.status || 'ok', data: r.data != null ? usbDV(r.data) : undefined };
  }
  async controlTransferOut(setup, data) {
    const r = await usbCall('control', { device: this._id, direction: 'out', requestType: setup.requestType, recipient: setup.recipient, request: setup.request, value: setup.value, index: setup.index, data: usbB64(data) });
    return { status: r.status || 'ok', bytesWritten: r.bytesWritten || 0 };
  }
  async transferIn(ep, length, timeout) { const r = await usbCall('transfer', { device: this._id, direction: 'in', endpoint: ep, length, timeout }); return { status: r.status || 'ok', data: r.data != null ? usbDV(r.data) : undefined }; }
  async transferOut(ep, data, timeout) { const r = await usbCall('transfer', { device: this._id, direction: 'out', endpoint: ep, data: usbB64(data), timeout }); return { status: r.status || 'ok', bytesWritten: r.bytesWritten || 0 }; }
  async clearHalt() {}
  async reset() { throw usbErr('reset is not available on Android', 'NotSupportedError'); }
  async isochronousTransferIn() { throw usbErr('isochronous transfers are not supported', 'NotSupportedError'); }
  async isochronousTransferOut() { throw usbErr('isochronous transfers are not supported', 'NotSupportedError'); }
}
const usbMatch = (d, f) => (f.vendorId == null || f.vendorId === d.vendorId) && (f.productId == null || f.productId === d.productId) && (f.serialNumber == null || f.serialNumber === d.serialNumber)
  && (f.classCode == null || [d.deviceClass, ...d.configuration.interfaces.flatMap(i => i.alternates.map(a => a.interfaceClass))].includes(f.classCode))
  && (f.subclassCode == null || [d.deviceSubclass, ...d.configuration.interfaces.flatMap(i => i.alternates.map(a => a.interfaceSubclass))].includes(f.subclassCode));
async function usbNativeList() {
  const list = await usbCall('list');
  const seen = new Set();
  for (const i of list) { seen.add(i.id); let d = USBX.devs.get(i.id); if (d) d._set(i); else USBX.devs.set(i.id, d = new JadeUSBDevice(i)); d._perm = !!i.permission; d.opened = !!i.opened; }
  for (const k of [...USBX.devs.keys()]) if (!seen.has(k)) USBX.devs.delete(k);
  return [...USBX.devs.values()];
}
function usbPicker(devs) {   // several devices match: let the person choose (as Chrome's own chooser does)
  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;inset:0;z-index:99998;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;padding:16px;font:14px system-ui,sans-serif';
    el.innerHTML = '<div style="background:#06100c;border:1px solid #1fe5a5;padding:16px;max-width:420px;width:100%;color:#dceee7"><b style="color:#1fe5a5">Connect a USB device</b><div id="usbList" style="margin:10px 0"></div><button id="usbCancel" style="padding:6px 14px;background:transparent;color:#9fb8ae;border:1px solid #2a3b35">Cancel</button></div>';
    const list = el.querySelector('#usbList');
    devs.forEach(d => { const b = document.createElement('button'); b.style.cssText = 'display:block;width:100%;text-align:left;margin:4px 0;padding:8px;background:#000;color:#dceee7;border:1px solid #2a3b35'; b.textContent = `${d.productName || 'USB device'} (${d.manufacturerName || ''} ${d.vendorId.toString(16).padStart(4, '0')}:${d.productId.toString(16).padStart(4, '0')})`; b.onclick = () => { el.remove(); resolve(d); }; list.appendChild(b); });
    el.querySelector('#usbCancel').onclick = () => { el.remove(); resolve(null); };
    document.body.appendChild(el);
  });
}
if (window.NetrunnerAndroid && typeof window.NetrunnerAndroid.usb === 'function') {
  USBX.native = true;
  const et = new EventTarget(); let poll = 0, known = new Set();
  const watch = () => {
    if (poll) return;
    poll = setInterval(async () => {
      try {
        const devs = await usbNativeList(); const now = new Set(devs.map(d => d._id));
        for (const d of devs) if (!known.has(d._id) && d._perm) et.dispatchEvent(Object.assign(new Event('connect'), { device: d }));
        for (const k of known) if (!now.has(k)) et.dispatchEvent(Object.assign(new Event('disconnect'), { device: { _id: k } }));
        known = new Set(devs.filter(d => d._perm).map(d => d._id));
      } catch {}
    }, 2000);
  };
  const usb = {
    async getDevices() { return (await usbNativeList()).filter(d => d._perm); },
    async requestDevice(opts = {}) {
      const filters = opts.filters || [];
      const all = (await usbNativeList()).filter(d => !filters.length || filters.some(f => usbMatch(d, f)));
      if (!all.length) throw usbErr('No device selected (no matching USB device is plugged in).', 'NotFoundError');
      const d = all.length === 1 ? all[0] : await usbPicker(all);
      if (!d) throw usbErr('No device selected.', 'NotFoundError');
      const r = await usbCall('permission', { device: d._id });
      if (!r.granted) throw usbErr('Permission to use the USB device was not given.', 'NotFoundError');
      await usbNativeList(); return d;
    },
    addEventListener(t, f, o) { et.addEventListener(t, f, o); watch(); },
    removeEventListener(t, f, o) { et.removeEventListener(t, f, o); },
    set onconnect(f) { if (this._oc) et.removeEventListener('connect', this._oc); this._oc = f; if (f) { et.addEventListener('connect', f); watch(); } },
    set ondisconnect(f) { if (this._od) et.removeEventListener('disconnect', this._od); this._od = f; if (f) { et.addEventListener('disconnect', f); watch(); } },
  };
  try { Object.defineProperty(navigator, 'usb', { value: usb, configurable: true }); } catch { try { navigator.usb = usb; } catch {} }
}

/* ---------- the usb tool ---------- */
const usbHex = (dv) => { const u = new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength); return [...u].map(b => b.toString(16).padStart(2, '0')).join(' '); };
const usbText = (dv) => { const u = new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength); return [...u].map(b => (b >= 32 && b < 127) || b === 10 || b === 13 || b === 9 ? String.fromCharCode(b) : '.').join(''); };
function usbBytes(a) {   // data for an out transfer: hex ("01 a0 ff"), text, or numbers
  if (a.text != null) return new TextEncoder().encode(String(a.text));
  if (Array.isArray(a.data)) return Uint8Array.from(a.data.map(x => +x & 0xff));
  const h = String(a.data ?? a.hex ?? '').replace(/0x/gi, '').replace(/[\s,:]/g, '');
  if (h && !/^[0-9a-f]*$/i.test(h)) throw new Error('data must be hex bytes like "01 a0 ff", an array of numbers, or use text');
  if (h.length % 2) throw new Error('hex data needs whole bytes (an even number of digits)');
  return Uint8Array.from(h.match(/../g) || [], x => parseInt(x, 16));
}
const usbName = d => `${d.productName || 'USB device'}${d.manufacturerName ? ' · ' + d.manufacturerName : ''}`;
const usbVP = d => d.vendorId.toString(16).padStart(4, '0') + ':' + d.productId.toString(16).padStart(4, '0');
const usbBrief = (d, i) => ({ device: d._id || usbVP(d), index: i, name: usbName(d), vendorProduct: usbVP(d), class: d.deviceClass, opened: d.opened, ...(d._perm === false ? { permission: false } : {}), serial: d.serialNumber || undefined,
  interfaces: d.configuration ? d.configuration.interfaces.map(f => ({ number: f.interfaceNumber, class: f.alternate.interfaceClass, subclass: f.alternate.interfaceSubclass, protocol: f.alternate.interfaceProtocol, alternates: f.alternates.length, claimed: f.claimed, endpoints: f.alternate.endpoints.map(e => `${e.endpointNumber} ${e.direction} ${e.type} ${e.packetSize}`) })) : [] });
async function usbDevices(all) {
  if (!navigator.usb) throw new Error('USB is not available here: in a browser it needs Chrome or Edge on an https (or localhost) page; in the Android app it needs a phone with USB host (OTG) support');
  if (USBX.native && all) return await usbNativeList();
  return await navigator.usb.getDevices();
}
async function usbFind(sel) {
  const devs = await usbDevices(false);
  if (!devs.length) throw new Error('no USB device has been allowed yet: use action "request" first');
  if (sel == null || sel === '') { if (devs.length === 1) return devs[0]; throw new Error('several devices: name one with device (' + devs.map(usbVP).join(', ') + ')'); }
  const s = String(sel).toLowerCase();
  const d = devs.find(d => d._id === sel) || devs.find(d => usbVP(d) === s) || (/^\d+$/.test(s) ? devs[+s] : null) || devs.find(d => usbName(d).toLowerCase().includes(s));
  if (!d) throw new Error(`no allowed USB device "${sel}" (have: ${devs.map(d => usbVP(d) + ' ' + usbName(d)).join('; ')})`);
  return d;
}
function usbAsk(filters) {   // browsers: only a tap can open Chrome's device chooser
  return new Promise((resolve, reject) => {
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;left:50%;bottom:90px;transform:translateX(-50%);z-index:99997;background:#06100c;border:1px solid #1fe5a5;padding:10px 14px;color:#dceee7;font:14px system-ui,sans-serif;display:flex;gap:10px;align-items:center';
    el.innerHTML = '<span>Pandora asks to use a USB device.</span><button id="usbAllow" style="padding:6px 12px;background:#1fe5a5;color:#000;border:0;font-weight:700">Allow a USB device</button><button id="usbNo" style="padding:6px 10px;background:transparent;color:#9fb8ae;border:1px solid #2a3b35">No</button>';
    document.body.appendChild(el);
    const t = setTimeout(() => { el.remove(); reject(new Error('nobody tapped "Allow a USB device" within 2 minutes')); }, 120000);
    el.querySelector('#usbNo').onclick = () => { clearTimeout(t); el.remove(); reject(new Error('the user declined')); };
    el.querySelector('#usbAllow').onclick = async () => { clearTimeout(t); el.remove(); try { resolve(await navigator.usb.requestDevice({ filters })); } catch (e) { reject(new Error(e.message || 'no device chosen')); } };
  });
}
async function usbTool(a) {
  const action = a.action || 'list';
  if (action === 'list') {
    const devs = await usbDevices(true);
    if (!devs.length) return USBX.native ? 'No USB device is plugged in (or the phone has no USB host support).' : 'No USB device has been allowed on this page yet: use action "request" (the user taps "Allow a USB device").';
    return JSON.stringify(devs.map(usbBrief), null, 1);
  }
  if (action === 'request') {
    const f = {}; if (a.vendorId != null) f.vendorId = typeof a.vendorId === 'string' ? parseInt(a.vendorId, 16) : +a.vendorId; if (a.productId != null) f.productId = typeof a.productId === 'string' ? parseInt(a.productId, 16) : +a.productId; if (a.classCode != null) f.classCode = +a.classCode;
    const filters = Object.keys(f).length ? [f] : [];
    if (!navigator.usb) await usbDevices();
    const d = USBX.native ? await navigator.usb.requestDevice({ filters }) : await usbAsk(filters);
    return 'allowed: ' + JSON.stringify(usbBrief(d, 0));
  }
  const d = await usbFind(a.device);
  const timeout = Math.min(60000, Math.max(100, +a.timeout || 5000));
  if (action === 'open') { if (!d.opened) await d.open(); if (d.configuration == null) await d.selectConfiguration(1); return 'opened ' + usbName(d); }
  if (action === 'close') { if (d.opened) await d.close(); return 'closed ' + usbName(d); }
  if (!d.opened) throw new Error('open the device first (action "open")');
  if (action === 'claim') { await d.claimInterface(+a.interface || 0); return `claimed interface ${+a.interface || 0}`; }
  if (action === 'release') { await d.releaseInterface(+a.interface || 0); return `released interface ${+a.interface || 0}`; }
  if (action === 'select_alt') { await d.selectAlternateInterface(+a.interface || 0, +a.alternate || 0); return `interface ${+a.interface || 0} uses alternate ${+a.alternate || 0}`; }
  const setup = { requestType: a.requestType || 'vendor', recipient: a.recipient || 'device', request: +a.request || 0, value: +a.value || 0, index: +a.index || 0 };
  const show = (r, extra = {}) => JSON.stringify({ status: r.status, ...(r.data ? { bytes: r.data.byteLength, hex: usbHex(r.data).slice(0, 3000), text: usbText(r.data).slice(0, 1000) } : {}), ...(r.bytesWritten != null ? { bytesWritten: r.bytesWritten } : {}), ...extra });
  const save = async (r) => { if (a.save && r.data) { const p = vfs.norm(String(a.save), '/'); vfs.write(p, new Uint8Array(r.data.buffer, r.data.byteOffset, r.data.byteLength).slice(), { mkdirs: true }); return { saved: p }; } return {}; };
  if (action === 'control_in') { const r = await d.controlTransferIn(setup, Math.min(65535, Math.max(0, +a.length || 64))); return show(r, await save(r)); }
  if (action === 'control_out') { const r = await d.controlTransferOut(setup, usbBytes(a)); return show(r); }
  if (action === 'transfer_in') { const r = USBX.native ? await d.transferIn(+a.endpoint, Math.max(1, +a.length || 64), timeout) : await d.transferIn(+a.endpoint, Math.max(1, +a.length || 64)); return show(r, await save(r)); }
  if (action === 'transfer_out') { const b = usbBytes(a); const r = USBX.native ? await d.transferOut(+a.endpoint, b, timeout) : await d.transferOut(+a.endpoint, b); return show(r); }
  throw new Error('unknown usb action ' + action);
}
const USB_TOOL_DEFS = [{ name: 'usb', description: 'USB devices plugged into this phone (USB OTG) or computer: Arduinos and other microcontrollers, serial adapters, sensors, keys, custom devices. list: what is connected (ids, names, vendor:product, interfaces and endpoints). request: ask the user to allow one (optionally vendorId/productId in hex, or classCode); needed once per device. open/close; claim/release an interface (and select_alt). control_in/control_out: control transfers (requestType standard|class|vendor, recipient device|interface|endpoint|other, request, value, index; length for in, data for out). transfer_in/transfer_out: bulk or interrupt transfers on an endpoint number (length for in; data for out). data is hex bytes ("01 a0 ff"), an array of numbers, or text; answers show hex and printable text, and save writes received bytes to a vault file. device: its id, vendor:product, index or part of its name (optional when only one is allowed).',
  parameters: { type: 'object', properties: { action: { type: 'string', enum: ['list', 'request', 'open', 'close', 'claim', 'release', 'select_alt', 'control_in', 'control_out', 'transfer_in', 'transfer_out'] }, device: { type: 'string' }, vendorId: { type: 'string', description: 'hex, e.g. 2341' }, productId: { type: 'string' }, classCode: { type: 'number' }, interface: { type: 'number' }, alternate: { type: 'number' }, endpoint: { type: 'number' }, requestType: { type: 'string', enum: ['standard', 'class', 'vendor'] }, recipient: { type: 'string', enum: ['device', 'interface', 'endpoint', 'other'] }, request: { type: 'number' }, value: { type: 'number' }, index: { type: 'number' }, length: { type: 'number' }, data: { description: 'hex string or array of byte values' }, text: { type: 'string' }, timeout: { type: 'number', description: 'ms (default 5000)' }, save: { type: 'string', description: 'vault path for received bytes' } }, required: ['action'] } }];
Object.assign(window, { usbTool, USB_TOOL_DEFS, JadeUSBDevice });
