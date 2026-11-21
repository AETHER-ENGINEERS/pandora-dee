// The Atelier page's bridge to her vault folder (desktop/disk_host.cjs, through main.cjs). Same calls and answers as
// the Android app's bridge, so app/modules/vfs_disk.js runs unchanged: each returns a string, a value or "ERR:message".
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const disk = (name) => (...args) => ipcRenderer.sendSync('pd-disk', name, args);
contextBridge.exposeInMainWorld('PandoraDesk', {
  app: 'pandora-dee-desktop',
  diskInfo: disk('info'),
  diskScan: disk('scan'),
  diskGet: disk('get'),
  diskPut: disk('put'),
  diskMkdir: disk('mkdir'),
  diskDel: disk('del'),
  diskMove: disk('move'),
  diskTouch: disk('touch'),
  diskClear: disk('clear'),
  diskUseShared: disk('useShared'),
  openFolder: () => ipcRenderer.sendSync('pd-desk', 'openFolder'),
  chooseFolder: () => ipcRenderer.sendSync('pd-desk', 'chooseFolder'),
});
