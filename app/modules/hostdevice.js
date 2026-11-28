/* ---------------- her device tools, for her loop on the home host (parity step 4) ----------------
   Served by the home host (host/bridge.js gives window.PandoraDesk.devices), this page tells the host which of her
   device tools this device has: the phone's own (phone, screen, senses, sentry, its browser and SSH client) in the
   Android app, USB where the browser has it, and models run on this device's own chip (litert, onnx). While her loop
   runs on the host, it calls them here (host/devices.cjs): each call runs in this page as her Atelier runs it, with
   its own checks and the person's own yes where it asks for one, and what happened goes back to her. Her Atelier's
   own settings (Config) still decide which of them she has at all. Anywhere else nothing changes. */
const HOST_DEVICE_TOOLS = ['phone', 'screen', 'senses', 'sentry', 'usb', 'browser', 'ssh', 'litert', 'onnx'];
const HOST_DEVICE_NATIVE = ['phone', 'screen', 'senses', 'sentry', 'browser', 'ssh']; // the Android app's own halves
/** The device tools this device really has now. */
function hostDeviceTools() {
  const native = !!window.NetrunnerAndroid;
  return (typeof activeTools === 'function' ? activeTools() : [])
    .filter((t) => t && t.function && HOST_DEVICE_TOOLS.includes(t.function.name))
    .filter((t) => (HOST_DEVICE_NATIVE.includes(t.function.name) ? native : t.function.name === 'usb' ? !!navigator.usb : true))
    .map((t) => ({ type: 'function', function: { name: t.function.name, description: t.function.description, parameters: t.function.parameters } }));
}
async function hostDeviceRun(name, args) {
  if (!hostDeviceTools().some((t) => t.function.name === name)) throw new Error(`${name} isn't on this device now`);
  const out = await runTool(name, args || {}, null);
  return typeof out === 'string' ? out : JSON.stringify(out);
}
if (window.PandoraDesk && window.PandoraDesk.state && window.PandoraDesk.devices) {
  setTimeout(() => { try { window.PandoraDesk.devices.serve({ list: hostDeviceTools, run: hostDeviceRun }); } catch (e) { console.warn('device tools for the host:', e); } }, 1500);
}
window.hostDeviceTools = hostDeviceTools; // (for tests: what this device offers)
