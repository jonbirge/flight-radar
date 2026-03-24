// Canonical default settings shared by Electron and web platforms
// Loaded via <script> tag in browsers (exposes global DEFAULT_SETTINGS)
// and via require() in Node.js (main.js)

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
  turb3D: false,
  exaggerateAltitudes: 1,
  weatherOverlayOpacity: 25,
  radarThinning: true,
  rotationSpeed: 6,
  credentialsExpanded: false,
  openskyClientId: '',
  openskyClientSecret: '',
  flightawareApiKey: '',
  savedView: { lon: -98.5, lat: 39.5, height: 4860000, heading: 0, pitch: -1.5708 },
  searchHistory: [],
};

// Expose globally for shared modules in the renderer
if (typeof window !== 'undefined') window.DEFAULT_SETTINGS = DEFAULT_SETTINGS;

export default DEFAULT_SETTINGS;
