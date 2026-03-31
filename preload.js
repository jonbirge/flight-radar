// preload.js - Context bridge between main and renderer
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('flightAPI', {
  // Fetch flight states within a geographic bounding box
  getStates: (bounds, type) => ipcRenderer.invoke('get-states', bounds, type),

  // Fetch flight states for specific ICAO24 addresses (no bounding box)
  getStatesByIcao: (icao24s, type) => ipcRenderer.invoke('get-states-by-icao', icao24s, type),

  // Fetch granular track/trajectory for a specific aircraft
  getTrack: (icao24) => ipcRenderer.invoke('get-track', icao24),

  // Fetch flight plan from FlightAware AeroAPI
  getFlightPlan: (ident) => ipcRenderer.invoke('get-flight-plan', ident),

  // Fetch decoded filed route with waypoint coordinates from FlightAware AeroAPI
  getFlightRoute: (faFlightId) => ipcRenderer.invoke('get-flight-route', faFlightId),

  // Fetch actual flown track from FlightAware AeroAPI
  getFlightTrack: (faFlightId) => ipcRenderer.invoke('get-flight-track', faFlightId),

  // Search flights by advanced query (origin, destination, date/time window)
  searchFlights: (advQuery) => ipcRenderer.invoke('search-flights', advQuery),

  // Fetch flights to/from an airport from FlightAware AeroAPI
  getAirportFlights: (airportCode) => ipcRenderer.invoke('get-airport-flights', airportCode),

  // Validate FlightAware API key via the no-cost /account/usage endpoint
  checkFlightAwareKey: () => ipcRenderer.invoke('check-flightaware-key'),

  // Fetch FAA system-wide airport delay data (NASSTATUS XML)
  getSystemDelays: () => ipcRenderer.invoke('get-system-delays'),

  // Settings
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),

  // Open the settings window from the renderer
  openSettings: () => ipcRenderer.invoke('open-settings-window'),

  // Listen for settings changes applied from the settings window
  onSettingsChanged: (callback) => ipcRenderer.on('settings-changed', (_, settings) => callback(settings)),

  // Listen for lightweight previews during slider drag
  onFontSizePreview: (callback) => ipcRenderer.on('font-size-preview', (_, size) => callback(size)),
  onRotationSpeedPreview: (callback) => ipcRenderer.on('rotation-speed-preview', (_, speed) => callback(speed)),
  onWeatherOpacityPreview: (callback) => ipcRenderer.on('weather-opacity-preview', (_, opacity) => callback(opacity)),
  onAltGainPreview: (callback) => ipcRenderer.on('alt-gain-preview', (_, factor) => callback(factor)),

  // System theme detection
  getSystemTheme: () => ipcRenderer.invoke('get-system-theme'),
  onSystemThemeChanged: (callback) => ipcRenderer.on('system-theme-changed', (_, theme) => callback(theme)),

  // Listen for cloud settings changes from the settings window
  onCloudSettingsChanged: (callback) => ipcRenderer.on('cloud-settings-changed', () => callback()),

  // Native context menu — returns selected item id or null if dismissed
  showContextMenu: (items) => ipcRenderer.invoke('show-context-menu', items),

  // Tile cache management
  clearTileCache: () => ipcRenderer.invoke('clear-tile-cache'),
})
