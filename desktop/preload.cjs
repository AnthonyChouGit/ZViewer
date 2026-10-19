const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('zviewerDesktop', {
  info: () => ipcRenderer.invoke('desktop-info'),
  command: (action, payload) => ipcRenderer.invoke('desktop-command', action, payload),
  window: action => ipcRenderer.invoke('window-action', action),
  openDocs: () => ipcRenderer.invoke('open-docs'),
  onNavigate: callback => { ipcRenderer.on('navigate', (_event, page) => callback(page)); },
  onUpdate: callback => { ipcRenderer.on('desktop-update', (_event, snapshot) => callback(snapshot)); }
});
