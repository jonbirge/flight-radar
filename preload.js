// preload.js - Context bridge between main and renderer
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('flightAPI', {
  // Fetch flight states within a geographic bounding box
  getStates: (bounds) => ipcRenderer.invoke('get-states', bounds),

  // Fetch granular track/trajectory for a specific aircraft
  getTrack: (icao24) => ipcRenderer.invoke('get-track', icao24),

  // Settings
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),

  // Open the settings window from the renderer
  openSettings: () => ipcRenderer.invoke('open-settings-window'),

  // Listen for settings changes applied from the settings window
  onSettingsChanged: (callback) => ipcRenderer.on('settings-changed', callback),

  // System theme detection
  getSystemTheme: () => ipcRenderer.invoke('get-system-theme'),
  onSystemThemeChanged: (callback) => ipcRenderer.on('system-theme-changed', (_, theme) => callback(theme)),
});
