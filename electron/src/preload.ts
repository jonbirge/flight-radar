require('./rt/electron-rt');

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('flightAPI', {
  getStates: (bounds: any) => ipcRenderer.invoke('get-states', bounds),
  getTrack: (icao24: string) => ipcRenderer.invoke('get-track', icao24),
  getFlightPlan: (ident: string) => ipcRenderer.invoke('get-flight-plan', ident),
  getFlightRoute: (faFlightId: string) => ipcRenderer.invoke('get-flight-route', faFlightId),
  getFlightTrack: (faFlightId: string) => ipcRenderer.invoke('get-flight-track', faFlightId),
  searchFlights: (advQuery: string) => ipcRenderer.invoke('search-flights', advQuery),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings: any) => ipcRenderer.invoke('save-settings', settings),
  openSettings: () => ipcRenderer.invoke('open-settings-window'),
  onSettingsChanged: (callback: any) => ipcRenderer.on('settings-changed', callback),
  getSystemTheme: () => ipcRenderer.invoke('get-system-theme'),
  onSystemThemeChanged: (callback: any) => ipcRenderer.on('system-theme-changed', (_: any, theme: string) => callback(theme)),
  showContextMenu: (items: any) => ipcRenderer.invoke('show-context-menu', items),
});

contextBridge.exposeInMainWorld('settingsAPI', {
  getSettings: () => ipcRenderer.invoke('get-settings'),
  updateSettings: (settings: any) => ipcRenderer.invoke('update-settings', settings),
  resetSettings: () => ipcRenderer.invoke('reset-settings'),
  resizeToContent: () => ipcRenderer.invoke('resize-settings'),
  close: () => ipcRenderer.send('close-settings-window'),
});

contextBridge.exposeInMainWorld('helpAPI', {
  getSettings: () => ipcRenderer.invoke('get-settings'),
  onSettingsChanged: (cb: any) => ipcRenderer.on('settings-changed', cb),
});
