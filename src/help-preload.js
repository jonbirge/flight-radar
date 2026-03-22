// help-preload.js — context bridge for the help window
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('helpAPI', {
  getSettings: () => ipcRenderer.invoke('get-settings'),
  onSettingsChanged: (cb) => ipcRenderer.on('settings-changed', cb),
})
