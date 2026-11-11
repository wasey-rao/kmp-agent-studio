// Exposes the two native actions the web UI cannot do on its own.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('studioNative', {
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  openFolder: (dir) => ipcRenderer.invoke('open-folder', dir),
});
