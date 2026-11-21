// Pandora Dee as a desktop app: the Atelier in its own window, with her vault as a real folder on the computer.
// The page is the same one the browser opens (dist/pandora-dee.html). Its vault code (app/modules/vfs_disk.js) runs on
// a folder whenever a disk bridge is there. The bridge's calls are synchronous (the vault code reads a file the
// moment something asks for it), and Electron's synchronous IPC answers them that way, as the Android app's bridge does.
//
//   npm start                 (from desktop/, after npm install and npm run page)
//   PANDORA_VAULT=<folder>    use this folder for the vault, without asking
//   PANDORA_PAGE=<file.html>  open this built page instead of the bundled one

'use strict';
const { app, BrowserWindow, ipcMain, protocol, dialog, Menu, shell, net } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createDiskHost } = require('./disk_host.cjs');

// one origin of her own, so the page's settings and chats (localStorage, IndexedDB) stay put between runs
protocol.registerSchemesAsPrivileged([{ scheme: 'atelier', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);

const configFile = () => path.join(app.getPath('userData'), 'atelier.json');
const readConfig = () => { try { return JSON.parse(fs.readFileSync(configFile(), 'utf8')); } catch { return {}; } };
const writeConfig = (patch) => { fs.mkdirSync(path.dirname(configFile()), { recursive: true }); fs.writeFileSync(configFile(), JSON.stringify({ ...readConfig(), ...patch }, null, 2)); };

function pageFile() {
  const tries = [process.env.PANDORA_PAGE, path.join(__dirname, 'app', 'pandora-dee.html'), path.join(__dirname, '..', 'dist', 'pandora-dee.html')].filter(Boolean);
  const f = tries.find((t) => fs.existsSync(t));
  if (!f) throw new Error('No built page found. Run "npm run page" in desktop/ (it copies ../dist/pandora-dee.html), or set PANDORA_PAGE.');
  return f;
}

/** The vault's folder: from PANDORA_VAULT, from last time, or asked for once (a new, empty folder is fine). */
function vaultFolder() {
  if (process.env.PANDORA_VAULT) return path.resolve(process.env.PANDORA_VAULT);
  const saved = readConfig().vault;
  if (saved && fs.existsSync(saved)) return saved;
  return chooseFolder(saved || path.join(app.getPath('documents'), 'Pandora Dee Atelier'));
}
function chooseFolder(suggest) {
  const r = dialog.showOpenDialogSync({ title: 'Choose the folder for her vault', defaultPath: suggest, buttonLabel: 'Use this folder', properties: ['openDirectory', 'createDirectory', 'promptToCreate'] });
  const dir = r?.[0] || suggest;
  writeConfig({ vault: dir });
  return dir;
}

let host = null;
function startBridge() {
  host = createDiskHost(vaultFolder());
  const CALLS = new Set(['info', 'scan', 'get', 'put', 'mkdir', 'del', 'move', 'touch', 'clear', 'useShared']);
  ipcMain.on('pd-disk', (e, name, args) => {
    // only the Atelier's own page may use the folder
    if (!String(e.senderFrame?.url || '').startsWith('atelier://app/')) { e.returnValue = 'ERR:not allowed'; return; }
    e.returnValue = CALLS.has(name) ? host.call(name, Array.isArray(args) ? args : []) : `ERR:${name}: unknown call`;
  });
  ipcMain.on('pd-desk', (e, what) => {
    if (!String(e.senderFrame?.url || '').startsWith('atelier://app/')) { e.returnValue = 'ERR:not allowed'; return; }
    if (what === 'openFolder') { void shell.openPath(host.root); e.returnValue = 'ok'; }
    else if (what === 'chooseFolder') { const before = host.root; const dir = chooseFolder(before); e.returnValue = dir === before ? 'same' : 'ok'; if (dir !== before) setTimeout(() => { app.relaunch(); app.exit(0); }, 300); }
    else e.returnValue = 'ERR:unknown';
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280, height: 860, title: 'Pandora Dee', backgroundColor: '#0b0912',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: true },
  });
  // links out of the Atelier open in the person's own browser
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) void shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('atelier://app/')) { e.preventDefault(); if (/^https?:/.test(url)) void shell.openExternal(url); } });
  void win.loadURL('atelier://app/index.html');
  return win;
}

function menu() {
  const tpl = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    { label: 'Vault', submenu: [
      { label: 'Open the vault folder', click: () => void shell.openPath(host.root) },
      { label: 'Open the trash folder', click: () => { fs.mkdirSync(host.trash, { recursive: true }); void shell.openPath(host.trash); } },
      { label: 'Use another folder…', click: () => { const before = host.root; if (chooseFolder(before) !== before) { app.relaunch(); app.exit(0); } } },
    ] },
    { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(tpl));
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { const w = BrowserWindow.getAllWindows()[0]; if (w) { if (w.isMinimized()) w.restore(); w.focus(); } });
  app.whenReady().then(() => {
    const page = pageFile();
    protocol.handle('atelier', (req) => {
      const u = new URL(req.url);
      if (u.host === 'app' && (u.pathname === '/' || u.pathname === '/index.html')) return net.fetch(pathToFileURL(page).toString());
      return new Response('Not found', { status: 404 });
    });
    startBridge();
    menu();
    createWindow();
    app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
