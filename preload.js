// preload.js - Context bridge between main and renderer
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('flightAPI', {
  // Fetch flight states within a geographic bounding box
  // bounds: { south, west, north, east } in degrees
  getStates: (bounds) => ipcRenderer.invoke('get-states', bounds),

  // Fetch granular track/trajectory for a specific aircraft
  // icao24: ICAO 24-bit transponder address (hex string)
  getTrack: (icao24) => ipcRenderer.invoke('get-track', icao24),
});
