// settings-preload.js - Context bridge for the settings window
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('settingsAPI', {
  getSettings: () => ipcRenderer.invoke('get-settings'),
  updateSettings: (settings) => ipcRenderer.invoke('update-settings', settings),
  updateSettingsQuiet: (settings) => ipcRenderer.invoke('update-settings-quiet', settings),
  resetSettings: () => ipcRenderer.invoke('reset-settings'),
  resizeToContent: () => ipcRenderer.invoke('resize-settings'),
  close: () => ipcRenderer.send('close-settings-window'),
  previewFontSize: (size) => ipcRenderer.send('preview-font-size', size),
  previewRotationSpeed: (speed) => ipcRenderer.send('preview-rotation-speed', speed),
  previewWeatherOpacity: (opacity) => ipcRenderer.send('preview-weather-opacity', opacity),
  previewAltGain: (factor) => ipcRenderer.send('preview-alt-gain', factor),
  cloudSettingsChanged: () => ipcRenderer.send('cloud-settings-changed'),
  getTileCacheStats: () => ipcRenderer.invoke('get-tile-cache-stats'),
  clearTileCache: () => ipcRenderer.invoke('clear-tile-cache'),
})
