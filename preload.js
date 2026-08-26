// LEB2 scraper — step 6
// contextIsolation is on and nodeIntegration is off (see main.js), so the
// renderer only gets these two calls, never direct DB/Electron access.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('leb2', {
  getDashboard: () => ipcRenderer.invoke('dashboard:get'),
  runCycle: () => ipcRenderer.invoke('cycle:run'),
});
