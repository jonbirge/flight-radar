// Shared configuration, color utilities, and zoom-based scaling
// Loaded by both Electron and web versions

'use strict';

// ============================================================
// Configuration
// ============================================================

const CONFIG = {
  // Boston Logan Airport center
  startLon: -71.0096,
  startLat: 42.3656,
  startAlt: 500000,           // initial camera height in meters

  pollInterval: 15000,        // ms between state polls
  trailMaxAge: 300,           // seconds of trail to keep
  trailEnabled: true,
  labelsEnabled: true,
  staleThreshold: 60,         // seconds before marking aircraft stale

  // Visual (dynamically updated by theme system)
  fontSize: 11,
  theme: 'light',             // 'dark' | 'light'
  darkColor: '#00cc44',       // user-selected dark mode color
  phosphor: '#00cc44',
  phosphorBright: '#33ff66',
  phosphorSelect: '#99ffbb',
  phosphorDim: 'rgba(0, 204, 68, 0.35)',
  trailColor: [0, 204, 68],  // RGB for trail polylines
  labelOutlineColor: Cesium.Color.BLACK,
  colorByAltitude: true,
  thickTrailsByAltitude: false,
  rotationSpeed: 6,             // degrees per second for camera rotation
  airportsEnabled: true,
  airspaceEnabled: true,
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

// Light mode uses fixed black/dark-gray palette
function setLightColors() {
  CONFIG.phosphor = '#1a1a1a';
  CONFIG.phosphorBright = '#000000';
  CONFIG.phosphorSelect = '#000000';
  CONFIG.phosphorDim = 'rgba(0, 0, 0, 0.45)';
  CONFIG.trailColor = [40, 40, 40];
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
  const clamped = Math.max(0, Math.min(45000, altFeet));
  const hue = (clamped / 45000) * 300;
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
  const clamped = Math.max(0, Math.min(45000, altFeet));
  return 1 + (clamped / 45000) * 5; // 1px at ground, 6px at FL450
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
  return Math.round(5 - 3 * t);
}

const POLL_STEPS = [10, 20, 30, 60]; // seconds

function computePollInterval(camHeight) {
  const t = getZoomFraction(camHeight);
  // Map 0..1 to index in POLL_STEPS (0=city→10s, 1=CONUS→60s)
  const idx = Math.min(POLL_STEPS.length - 1, Math.round(t * (POLL_STEPS.length - 1)));
  return POLL_STEPS[idx] * 1000;
}
