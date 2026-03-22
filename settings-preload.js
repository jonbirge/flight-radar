// settings-preload.js - Context bridge for the settings window
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('settingsAPI', {
  getSettings: () => ipcRenderer.invoke('get-settings'),
  updateSettings: (settings) => ipcRenderer.invoke('update-settings', settings),
  resetSettings: () => ipcRenderer.invoke('reset-settings'),
  resizeToContent: () => ipcRenderer.invoke('resize-settings'),
  close: () => ipcRenderer.send('close-settings-window'),
})
