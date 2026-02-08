// settings-preload.js - Context bridge for the settings window
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('settingsAPI', {
  getSettings: () => ipcRenderer.invoke('get-settings'),
  applySettings: (settings) => ipcRenderer.invoke('apply-settings', settings),
  cancel: () => ipcRenderer.send('close-settings-window'),
});
