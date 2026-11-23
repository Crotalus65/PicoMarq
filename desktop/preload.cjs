const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('desktop', {
  platform: process.platform,
  invoke: (command, args = {}) => ipcRenderer.invoke('scratch:invoke', command, args),
  // Synchronous on purpose: the items must be stored before the browser's own
  // context-menu request, sent right after this DOM handler returns.
  contextMenu: (extras) => { ipcRenderer.sendSync('scratch:context-menu', extras); },
  onCommand: (callback) => {
    const handler = (_event, command) => callback(command);
    ipcRenderer.on('scratch:command', handler);
    return () => ipcRenderer.removeListener('scratch:command', handler);
  },
  onSettingsChanged: (callback) => {
    const handler = (_event, settings) => callback(settings);
    ipcRenderer.on('scratch:settings', handler);
    return () => ipcRenderer.removeListener('scratch:settings', handler);
  },
});
