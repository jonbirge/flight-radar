// app.js - Web-specific entry point
// Shared modules (config, data, icons, radar) are loaded before this script.
// This file provides: window.flightAPI shim, settings panel, and init.

'use strict';

// ============================================================
// Settings (localStorage)
// ============================================================

const SETTINGS_STORAGE_KEY = 'flightRadar_settings';
const DEFAULT_SETTINGS = {
  fontSize: 12,
  theme: 'dark',
  darkColor: '#00cc44',
  lightColor: '#1a1a1a',
  openskyClientId: '',
  openskyClientSecret: '',
  savedView: null,
  colorByAltitude: true,
  thickTrailsByAltitude: false,
  showVelocityVector: false,
  trailLength: 120,
  airspaceEdges: true,
  airspace3D: false,
  showFixes: false,
  navaidsEnabled: false,
  radarEnabled: false,
  mapLayer: 'carto',
};

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (raw) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    }
  } catch (err) {
    console.error('[Settings] Load error:', err.message);
  }
  return { ...DEFAULT_SETTINGS };
}

function saveSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    console.log('[Settings] Saved to localStorage');
  } catch (err) {
    console.error('[Settings] Save error:', err.message);
  }
}

// ============================================================
// OpenSky API (browser fetch)
// ============================================================

const OPENSKY_BASE = 'https://opensky-network.org/api';

// Rate limiting state
let lastStatesCall = 0;
let lastTrackCall = 0;
const STATES_MIN_INTERVAL = 10000;
const TRACK_MIN_INTERVAL = 10000;

// OAuth2 token cache
let cachedToken = null;
let tokenExpiresAt = 0;

async function fetchTokenViaProxy(clientId, clientSecret) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const opts = { signal: controller.signal };
    if (clientId && clientSecret) {
      opts.method = 'POST';
      opts.headers = { 'Content-Type': 'application/json' };
      opts.body = JSON.stringify({ client_id: clientId, client_secret: clientSecret });
    }
    const resp = await fetch('cred.php', opts);
    clearTimeout(timeout);
    if (!resp.ok) throw new Error(`Token proxy failed: HTTP ${resp.status}`);
    return await resp.json();
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

async function getOpenSkyToken() {
  const now = Date.now();
  if (cachedToken && tokenExpiresAt > now + 60000) {
    return cachedToken;
  }

  // Only use server proxy if credentials are configured in settings
  const s = loadSettings();
  if (s.openskyClientId && s.openskyClientSecret) {
    try {
      const resp = await fetchTokenViaProxy(s.openskyClientId, s.openskyClientSecret);
      if (resp.access_token) {
        cachedToken = resp.access_token;
        tokenExpiresAt = now + ((resp.expires_in || 1500) * 1000);
        return cachedToken;
      }
    } catch (err) {
      // Token fetch failed, will fall back to anonymous
    }
  }

  // No credentials configured — anonymous access
  cachedToken = null;
  tokenExpiresAt = 0;
  return null;
}

async function apiGetStates(bounds) {
  const now = Date.now();
  if (now - lastStatesCall < STATES_MIN_INTERVAL) {
    return { error: 'Rate limited', retryIn: STATES_MIN_INTERVAL - (now - lastStatesCall) };
  }
  lastStatesCall = now;

  try {
    const { south, west, north, east } = bounds;
    const url = `${OPENSKY_BASE}/states/all?lamin=${south}&lomin=${west}&lamax=${north}&lomax=${east}`;

    const token = await getOpenSkyToken();
    const headers = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const resp = await fetch(url, { headers, signal: controller.signal });
    clearTimeout(timeout);

    if (resp.status === 429) {
      return { error: 'Rate limited by OpenSky API' };
    }
    if (!resp.ok) {
      return { error: `HTTP ${resp.status}` };
    }

    const data = await resp.json();
    return data;
  } catch (err) {
    return { error: err.message };
  }
}

async function apiGetTrack(icao24) {
  const now = Date.now();
  if (now - lastTrackCall < TRACK_MIN_INTERVAL) {
    return { error: 'Rate limited', retryIn: TRACK_MIN_INTERVAL - (now - lastTrackCall) };
  }
  lastTrackCall = now;

  try {
    const url = `${OPENSKY_BASE}/tracks/all?icao24=${icao24}&time=0`;

    const token = await getOpenSkyToken();
    const headers = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const resp = await fetch(url, { headers, signal: controller.signal });
    clearTimeout(timeout);

    if (!resp.ok) {
      return { error: `HTTP ${resp.status}` };
    }

    return await resp.json();
  } catch (err) {
    return { error: err.message };
  }
}

// ============================================================
// window.flightAPI shim (browser equivalent of Electron IPC)
// ============================================================

window.flightAPI = {
  getStates: (bounds) => apiGetStates(bounds),
  getTrack: (icao24) => apiGetTrack(icao24),
  getSettings: () => Promise.resolve(loadSettings()),
  saveSettings: (s) => { saveSettings(s); return Promise.resolve(true); },
  onOpenSettings: () => {},  // no-op

  // System theme detection
  getSystemTheme: () => Promise.resolve(
    window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  ),
  onSystemThemeChanged: (callback) => {
    window.matchMedia('(prefers-color-scheme: dark)')
      .addEventListener('change', (e) => callback(e.matches ? 'dark' : 'light'));
  },
};

// ============================================================
// Settings Panel (shared module with live updating)
// ============================================================

const settingsOverlay = document.getElementById('settings-overlay');
const settingsContainer = document.getElementById('settings-container');
settingsContainer.innerHTML = createSettingsFormHTML();

const settingsPanel = initSettingsPanel({
  container: settingsContainer,
  getSettings: () => Promise.resolve({
    fontSize: CONFIG.fontSize,
    theme: CONFIG.themePref,
    darkColor: CONFIG.darkColor,
    lightColor: CONFIG.lightColor,
    colorByAltitude: CONFIG.colorByAltitude,
    thickTrailsByAltitude: CONFIG.thickTrailsByAltitude,
    showVelocityVector: CONFIG.showVelocityVector,
    trailLength: CONFIG.trailMaxAge,
    airspaceEdges: CONFIG.airspaceEdges,
    airspace3D: CONFIG.airspace3D,
    showSmallAirports: CONFIG.showSmallAirports,
    showFixes: CONFIG.showFixes,
    rotationSpeed: CONFIG.rotationSpeed,
    openskyClientId: CONFIG.openskyClientId || '',
    openskyClientSecret: CONFIG.openskyClientSecret || '',
  }),
  onChanged: async (form) => {
    CONFIG.fontSize = form.fontSize;
    CONFIG.themePref = form.theme;
    CONFIG.darkColor = form.darkColor;
    CONFIG.lightColor = form.lightColor;
    CONFIG.colorByAltitude = form.colorByAltitude;
    CONFIG.thickTrailsByAltitude = form.thickTrailsByAltitude;
    CONFIG.showVelocityVector = form.showVelocityVector;
    CONFIG.trailMaxAge = form.trailLength;
    const edgesChanged = CONFIG.airspaceEdges !== form.airspaceEdges;
    CONFIG.airspaceEdges = form.airspaceEdges;
    const airspace3DChanged = CONFIG.airspace3D !== form.airspace3D;
    CONFIG.airspace3D = form.airspace3D;
    const smallAirportsChanged = CONFIG.showSmallAirports !== form.showSmallAirports;
    CONFIG.showSmallAirports = form.showSmallAirports;
    const showFixesChanged = CONFIG.showFixes !== form.showFixes;
    CONFIG.showFixes = form.showFixes;
    CONFIG.rotationSpeed = form.rotationSpeed;
    CONFIG.openskyClientId = form.openskyClientId;
    CONFIG.openskyClientSecret = form.openskyClientSecret;
    await applyTheme();
    if (edgesChanged) toggleAirspaceEdges(form.airspaceEdges);
    if (airspace3DChanged) toggleAirspace3D(form.airspace3D);
    if (smallAirportsChanged && cachedAirportData) {
      if (form.showSmallAirports) {
        initSmallAirports(cachedAirportData);
      } else {
        removeSmallAirports();
      }
    }
    if (showFixesChanged && cachedWaypointData) {
      if (form.showFixes) {
        initFixes();
      } else {
        removeFixes();
      }
    }
    // Merge with existing settings to preserve savedView and other non-form fields
    const existing = loadSettings();
    saveSettings({ ...existing, ...form });
  },
});

function openSettings() {
  settingsPanel.populate({
    fontSize: CONFIG.fontSize,
    theme: CONFIG.themePref,
    darkColor: CONFIG.darkColor,
    lightColor: CONFIG.lightColor,
    colorByAltitude: CONFIG.colorByAltitude,
    thickTrailsByAltitude: CONFIG.thickTrailsByAltitude,
    showVelocityVector: CONFIG.showVelocityVector,
    trailLength: CONFIG.trailMaxAge,
    airspaceEdges: CONFIG.airspaceEdges,
    airspace3D: CONFIG.airspace3D,
    showSmallAirports: CONFIG.showSmallAirports,
    showFixes: CONFIG.showFixes,
    rotationSpeed: CONFIG.rotationSpeed,
    openskyClientId: CONFIG.openskyClientId || '',
    openskyClientSecret: CONFIG.openskyClientSecret || '',
  });
  settingsOverlay.classList.remove('hidden');
}

function closeSettings() {
  settingsOverlay.classList.add('hidden');
}

document.getElementById('settings-close').addEventListener('click', closeSettings);
settingsOverlay.addEventListener('click', (e) => {
  if (e.target === settingsOverlay) closeSettings();
});
document.getElementById('btn-settings').addEventListener('click', () => openSettings());

// ============================================================
// Start
// ============================================================

async function init() {
  // Route AWC API calls through local caching proxy to avoid CORS
  CONFIG.awcProxyUrl = 'awc-proxy.php';
  await loadAndApplySettings();
  applySavedView();
  startPolling();
}

init();
