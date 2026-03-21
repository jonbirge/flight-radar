// Shared configuration, color utilities, and zoom-based scaling

import DEFAULT_SETTINGS from './defaults.js';

// ============================================================
// Configuration
// ============================================================

export const CONFIG = {
  // CONUS center
  startLon: -98.6,
  startLat: 39.8,
  startAlt: 6000000,

  pollInterval: 15000,
  positionUpdateInterval: 3000,
  trailMaxAge: DEFAULT_SETTINGS.trailLength,
  trailMode: DEFAULT_SETTINGS.trailMode,
  labelsEnabled: DEFAULT_SETTINGS.labelsEnabled,
  staleThreshold: 60,

  // Visual (dynamically updated by theme system)
  fontSize: DEFAULT_SETTINGS.fontSize,
  theme: 'light',
  themePref: DEFAULT_SETTINGS.theme,
  darkColor: DEFAULT_SETTINGS.darkColor,
  lightColor: DEFAULT_SETTINGS.lightColor,
  phosphor: '#ffffff',
  phosphorBright: '#ffffff',
  phosphorSelect: '#ffffff',
  phosphorDim: 'rgba(255, 255, 255, 0.35)',
  trailColor: [255, 255, 255],
  labelOutlineColor: null, // set after Cesium loads
  colorByAltitude: DEFAULT_SETTINGS.colorByAltitude,
  thickTrailsByAltitude: DEFAULT_SETTINGS.thickTrailsByAltitude,
  rotationSpeed: DEFAULT_SETTINGS.rotationSpeed,
  aircraftEnabled: DEFAULT_SETTINGS.aircraftEnabled,
  airportsEnabled: DEFAULT_SETTINGS.airportsEnabled,
  airspaceEnabled: DEFAULT_SETTINGS.airspaceEnabled,
  airspace3D: DEFAULT_SETTINGS.airspace3D,
  airspaceEdges: DEFAULT_SETTINGS.airspaceEdges,
  showSmallAirports: DEFAULT_SETTINGS.showSmallAirports,
  navaidsEnabled: DEFAULT_SETTINGS.navaidsEnabled,
  showFixes: DEFAULT_SETTINGS.showFixes,
  mapLayer: DEFAULT_SETTINGS.mapLayer,
  muteMapColors: DEFAULT_SETTINGS.muteMapColors,
  radarEnabled: DEFAULT_SETTINGS.radarEnabled,
  sigmetsEnabled: DEFAULT_SETTINGS.sigmetsEnabled,
  airmetsEnabled: DEFAULT_SETTINGS.airmetsEnabled,
  pirepsEnabled: DEFAULT_SETTINGS.pirepsEnabled,
  satelliteIREnabled: DEFAULT_SETTINGS.satelliteIREnabled,
  turbForecastEnabled: DEFAULT_SETTINGS.turbForecastEnabled,
  turb3D: DEFAULT_SETTINGS.turb3D,
  exaggerateAltitudes: DEFAULT_SETTINGS.exaggerateAltitudes,
  turbulenceLevel: DEFAULT_SETTINGS.turbulenceLevel,
  weatherOverlayOpacity: DEFAULT_SETTINGS.weatherOverlayOpacity,
  awcProxyUrl: null,
  vfrMapProxyUrl: null,
};

// ============================================================
// Altitude Helpers
// ============================================================

export function exAlt(meters) {
  return CONFIG.exaggerateAltitudes ? meters * 10 : meters;
}

// ============================================================
// Color Utilities
// ============================================================

export function hexToRgb(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return [r, g, b];
}

export function brighten(hex, factor = 1.3) {
  const [r, g, b] = hexToRgb(hex);
  const clamp = v => Math.min(255, Math.round(v * factor));
  return `#${clamp(r).toString(16).padStart(2,'0')}${clamp(g).toString(16).padStart(2,'0')}${clamp(b).toString(16).padStart(2,'0')}`;
}

export function withAlpha(hex, alpha) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function lighten(hex, amount = 0.5) {
  const [r, g, b] = hexToRgb(hex);
  const lr = Math.round(r + (255 - r) * amount);
  const lg = Math.round(g + (255 - g) * amount);
  const lb = Math.round(b + (255 - b) * amount);
  return `#${lr.toString(16).padStart(2,'0')}${lg.toString(16).padStart(2,'0')}${lb.toString(16).padStart(2,'0')}`;
}

export function setDarkColors(hex) {
  CONFIG.darkColor = hex;
  CONFIG.phosphor = hex;
  CONFIG.phosphorBright = brighten(hex, 1.4);
  CONFIG.phosphorSelect = lighten(CONFIG.phosphorBright, 0.5);
  CONFIG.phosphorDim = withAlpha(hex, 0.35);
  CONFIG.trailColor = hexToRgb(hex);
}

export function setLightColors(hex) {
  hex = hex || '#1a1a1a';
  CONFIG.lightColor = hex;
  CONFIG.phosphor = hex;
  const [r, g, b] = hexToRgb(hex);
  const dk = v => Math.round(v * 0.6);
  CONFIG.phosphorBright = `#${dk(r).toString(16).padStart(2,'0')}${dk(g).toString(16).padStart(2,'0')}${dk(b).toString(16).padStart(2,'0')}`;
  CONFIG.phosphorSelect = CONFIG.phosphorBright;
  CONFIG.phosphorDim = withAlpha(hex, 0.45);
  CONFIG.trailColor = [r, g, b];
  CONFIG.labelOutlineColor = Cesium.Color.WHITE;
}

export function hslToRgb(h, s, l) {
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

export function altitudeToRgb(altMeters) {
  const altFeet = (altMeters || 0) * 3.28084;
  const clamped = Math.max(0, Math.min(40000, altFeet));
  const hue = (clamped / 40000) * 300;
  if (CONFIG.theme === 'light') {
    return hslToRgb(hue, 0.55, 0.38);
  }
  return hslToRgb(hue, 1.0, 0.5);
}

export function altitudeToSelectedRgb(altMeters) {
  const rgb = altitudeToRgb(altMeters);
  if (CONFIG.theme === 'light') {
    return rgb.map(v => Math.round(v * 0.65));
  }
  return rgb.map(v => Math.round(v + (255 - v) * 0.4));
}

export function altitudeToTrailWidth(altMeters) {
  const altFeet = (altMeters || 0) * 3.28084;
  const clamped = Math.max(0, Math.min(40000, altFeet));
  return 1 + (clamped / 40000) * 5;
}

// ============================================================
// Zoom-Based Scaling
// ============================================================

export const CITY_HEIGHT = 100000;
export const CONUS_HEIGHT = 6000000;

export function getZoomFraction(camHeight) {
  if (camHeight <= CITY_HEIGHT) return 0;
  if (camHeight >= CONUS_HEIGHT) return 1;
  return (Math.log(camHeight) - Math.log(CITY_HEIGHT)) / (Math.log(CONUS_HEIGHT) - Math.log(CITY_HEIGHT));
}

export function computeIconSize(camHeight, baseSize) {
  const MIN_SIZE = 2;
  const t = getZoomFraction(camHeight);
  return Math.max(MIN_SIZE, Math.round(baseSize * (1 - t) + MIN_SIZE * t) + 1);
}

export function computeDisplaySize(camHeight) {
  const t = getZoomFraction(camHeight);
  return Math.round(10 - 8 * t);
}

const POLL_STEPS = [10, 20, 30, 60];

export function computePollInterval(camHeight) {
  const t = getZoomFraction(camHeight);
  const idx = Math.min(POLL_STEPS.length - 1, Math.round(t * (POLL_STEPS.length - 1)));
  return POLL_STEPS[idx] * 1000;
}

export function computePositionUpdateInterval(camHeight) {
  const t = getZoomFraction(camHeight);
  return Math.round(200 + (3000 - 200) * t);
}
