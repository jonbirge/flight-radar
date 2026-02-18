// Shared configuration, color utilities, and zoom-based scaling
// Loaded by both Electron and web versions

'use strict';

// ============================================================
// Configuration
// ============================================================

const CONFIG = {
  // CONUS center
  startLon: -98.6,
  startLat: 39.8,
  startAlt: 6000000,           // initial camera height in meters

  pollInterval: 15000,        // ms between state polls
  positionUpdateInterval: 1000, // ms between position extrapolation updates
  trailMaxAge: 120,           // seconds of trail to keep
  trailMode: 'history',       // 'none' | 'history' | 'velocity'
  labelsEnabled: true,
  staleThreshold: 60,         // seconds before marking aircraft stale

  // Visual (dynamically updated by theme system)
  fontSize: 11,
  theme: 'light',             // resolved theme: always 'dark' | 'light'
  themePref: 'system',          // user preference: 'dark' | 'light' | 'system'
  darkColor: '#ffffff',       // user-selected dark mode color
  lightColor: '#000000',      // user-selected light mode color
  phosphor: '#ffffff',
  phosphorBright: '#ffffff',
  phosphorSelect: '#ffffff',
  phosphorDim: 'rgba(255, 255, 255, 0.35)',
  trailColor: [255, 255, 255],  // RGB for trail polylines
  labelOutlineColor: Cesium.Color.BLACK,
  colorByAltitude: true,
  thickTrailsByAltitude: false,
  rotationSpeed: 6,             // degrees per second for camera rotation
  airportsEnabled: true,
  airspaceEnabled: true,
  airspace3D: false,
  airspaceEdges: false,
  showSmallAirports: false,
  navaidsEnabled: false,
  showFixes: false,
  mapLayer: 'carto',
  radarEnabled: false,
  turbulenceEnabled: false,
  turbulenceLevel: 'none',
  awcProxyUrl: null,  // set to e.g. 'awc-proxy.php' for web; null = direct AWC access
};

// ============================================================
// Color Utilities
// ============================================================

function hexToRgb(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return [r, g, b];
}

function brighten(hex, factor = 1.3) {
  const [r, g, b] = hexToRgb(hex);
  const clamp = v => Math.min(255, Math.round(v * factor));
  return `#${clamp(r).toString(16).padStart(2,'0')}${clamp(g).toString(16).padStart(2,'0')}${clamp(b).toString(16).padStart(2,'0')}`;
}

function withAlpha(hex, alpha) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function lighten(hex, amount = 0.5) {
  const [r, g, b] = hexToRgb(hex);
  const lr = Math.round(r + (255 - r) * amount);
  const lg = Math.round(g + (255 - g) * amount);
  const lb = Math.round(b + (255 - b) * amount);
  return `#${lr.toString(16).padStart(2,'0')}${lg.toString(16).padStart(2,'0')}${lb.toString(16).padStart(2,'0')}`;
}

// Derive all color properties from a single base hex color
function setDarkColors(hex) {
  CONFIG.darkColor = hex;
  CONFIG.phosphor = hex;
  CONFIG.phosphorBright = brighten(hex, 1.4);
  CONFIG.phosphorSelect = lighten(CONFIG.phosphorBright, 0.5);
  CONFIG.phosphorDim = withAlpha(hex, 0.35);
  CONFIG.trailColor = hexToRgb(hex);
}

// Light mode derives colors from user-selected light color
function setLightColors(hex) {
  hex = hex || '#1a1a1a';
  CONFIG.lightColor = hex;
  CONFIG.phosphor = hex;
  const [r, g, b] = hexToRgb(hex);
  // Darken for bright/select (increase contrast on light background)
  const dk = v => Math.round(v * 0.6);
  CONFIG.phosphorBright = `#${dk(r).toString(16).padStart(2,'0')}${dk(g).toString(16).padStart(2,'0')}${dk(b).toString(16).padStart(2,'0')}`;
  CONFIG.phosphorSelect = CONFIG.phosphorBright;
  CONFIG.phosphorDim = withAlpha(hex, 0.45);
  CONFIG.trailColor = [r, g, b];
  CONFIG.labelOutlineColor = Cesium.Color.WHITE;
}

// HSL to RGB helper (h in degrees, s and l in 0-1)
function hslToRgb(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = l - c / 2;
  let r1, g1, b1;
  if (h < 60)       { r1 = c; g1 = x; b1 = 0; }
  else if (h < 120) { r1 = x; g1 = c; b1 = 0; }
  else if (h < 180) { r1 = 0; g1 = c; b1 = x; }
  else if (h < 240) { r1 = 0; g1 = x; b1 = c; }
  else if (h < 300) { r1 = x; g1 = 0; b1 = c; }
  else              { r1 = c; g1 = 0; b1 = x; }
  return [Math.round((r1 + m) * 255), Math.round((g1 + m) * 255), Math.round((b1 + m) * 255)];
}

// Altitude-to-color: hue 0-300 (red→magenta)
// Dark mode:  s=100%, l=50% — vivid, glowing on dark background
// Light mode: s=55%,  l=38% — muted, ink-like on white background
function altitudeToRgb(altMeters) {
  const altFeet = (altMeters || 0) * 3.28084;
  const clamped = Math.max(0, Math.min(40000, altFeet));
  const hue = (clamped / 40000) * 300;
  if (CONFIG.theme === 'light') {
    return hslToRgb(hue, 0.55, 0.38);
  }
  return hslToRgb(hue, 1.0, 0.5);
}

function altitudeToSelectedRgb(altMeters) {
  const rgb = altitudeToRgb(altMeters);
  if (CONFIG.theme === 'light') {
    // Darken for selection on white background (more contrast)
    return rgb.map(v => Math.round(v * 0.65));
  }
  // Lighten for selection on dark background
  return rgb.map(v => Math.round(v + (255 - v) * 0.4));
}

function altitudeToTrailWidth(altMeters) {
  const altFeet = (altMeters || 0) * 3.28084;
  const clamped = Math.max(0, Math.min(40000, altFeet));
  return 1 + (clamped / 40000) * 5; // 1px at ground, 6px at FL400
}

// ============================================================
// Zoom-Based Scaling
// ============================================================

const CITY_HEIGHT = 100000;     // ~100km camera height = city scale
const CONUS_HEIGHT = 6000000;   // ~6000km camera height = CONUS scale

function getZoomFraction(camHeight) {
  // Returns 0 at city zoom, 1 at CONUS zoom (logarithmic)
  if (camHeight <= CITY_HEIGHT) return 0;
  if (camHeight >= CONUS_HEIGHT) return 1;
  return (Math.log(camHeight) - Math.log(CITY_HEIGHT)) / (Math.log(CONUS_HEIGHT) - Math.log(CITY_HEIGHT));
}

function computeIconSize(camHeight, baseSize) {
  const MIN_SIZE = 2;
  const t = getZoomFraction(camHeight);
  return Math.max(MIN_SIZE, Math.round(baseSize * (1 - t) + MIN_SIZE * t) + 1);
}

// Display size for billboards: 2px at CONUS, 5px at city, linear transition
function computeDisplaySize(camHeight) {
  const t = getZoomFraction(camHeight);
  return Math.round(10 - 8 * t);
}

const POLL_STEPS = [10, 20, 30, 60]; // seconds

function computePollInterval(camHeight) {
  const t = getZoomFraction(camHeight);
  // Map 0..1 to index in POLL_STEPS (0=city→10s, 1=CONUS→60s)
  const idx = Math.min(POLL_STEPS.length - 1, Math.round(t * (POLL_STEPS.length - 1)));
  return POLL_STEPS[idx] * 1000;
}

function computePositionUpdateInterval(camHeight) {
  const t = getZoomFraction(camHeight);
  // Linear interpolation: 200ms at city (t=0), 1000ms at CONUS (t=1)
  return Math.round(200 + (1000 - 200) * t);
}
