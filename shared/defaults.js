// Canonical default settings shared by Electron and web platforms
// Loaded via <script> tag in browsers (exposes global DEFAULT_SETTINGS)
// and via require() in Node.js (main.js)

'use strict';

const DEFAULT_SETTINGS = {
  fontSize: 12,
  theme: 'system',
  darkColor: '#cccccc',
  lightColor: '#000000',
  darkColorPresets: null,
  lightColorPresets: null,
  colorByAltitude: true,
  trailMode: 'velocity',
  thickTrailsByAltitude: false,
  trailLength: 120,
  aircraftEnabled: false,
  labelsEnabled: true,
  airportsEnabled: false,
  airspaceEnabled: true,
  airspaceEdges: false,
  airspace3D: false,
  showSmallAirports: false,
  navaidsEnabled: false,
  showFixes: false,
  mapLayer: 'noLabels',
  muteMapColors: true,
  radarEnabled: false,
  sigmetsEnabled: false,
  airmetsEnabled: false,
  pirepsEnabled: false,
  satelliteIREnabled: false,
  turbForecastEnabled: false,
  turbulenceLevel: 'none',
  weatherOverlayOpacity: 25,
  rotationSpeed: 6,
  credentialsExpanded: false,
  flightawareApiKey: '',
  savedView: { lon: -98.5, lat: 39.5, height: 4860000, heading: 0, pitch: -1.5708 },
  searchHistory: [],
};

if (typeof module !== 'undefined' && module.exports) module.exports = DEFAULT_SETTINGS;
