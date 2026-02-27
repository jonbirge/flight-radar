// settings-preload.js - Context bridge for the settings window
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('settingsAPI', {
  getSettings: () => ipcRenderer.invoke('get-settings'),
  updateSettings: (settings) => ipcRenderer.invoke('update-settings', settings),
  resetSettings: () => ipcRenderer.invoke('reset-settings'),
  resizeToContent: () => ipcRenderer.invoke('resize-settings'),
  close: () => ipcRenderer.send('close-settings-window'),
});
