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
  openskyClientId: '',
  openskyClientSecret: '',
  savedView: null,
  colorByAltitude: true,
  thickTrailsByAltitude: false,
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
const OPENSKY_TOKEN_URL = 'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token';

// Rate limiting state
let lastStatesCall = 0;
let lastTrackCall = 0;
const STATES_MIN_INTERVAL = 10000;
const TRACK_MIN_INTERVAL = 10000;

// Server-side token proxy
async function loadServerCredentials() {
  console.log('[OpenSky] Checking server token proxy (cred.php)...');
  try {
    const resp = await fetch('cred.php');
    if (!resp.ok) {
      console.warn(`[OpenSky] cred.php returned HTTP ${resp.status}`);
      return;
    }
    const data = await resp.json();
    if (data.error) {
      console.warn('[OpenSky] cred.php error:', data.error, data.detail || '');
      return;
    }
    if (data.access_token) {
      cachedToken = data.access_token;
      tokenExpiresAt = Date.now() + ((data.expires_in || 1500) * 1000);
      console.log(`[OpenSky] Token acquired via server proxy, expires in ${data.expires_in || 1500}s`);
    } else {
      console.warn('[OpenSky] cred.php response missing access_token:', JSON.stringify(data));
    }
  } catch (err) {
    console.warn('[OpenSky] cred.php fetch failed:', err.message);
  }
}

// OAuth2 token cache
let cachedToken = null;
let tokenExpiresAt = 0;

async function fetchTokenViaProxy() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const resp = await fetch('cred.php', { signal: controller.signal });
    clearTimeout(timeout);
    if (!resp.ok) throw new Error(`Token proxy failed: HTTP ${resp.status}`);
    return await resp.json();
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

async function fetchToken(clientId, clientSecret) {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const resp = await fetch(OPENSKY_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!resp.ok) throw new Error(`Token request failed: HTTP ${resp.status}`);
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

  // Priority 1: User-entered credentials (direct token fetch)
  const s = loadSettings();
  if (s.openskyClientId && s.openskyClientSecret) {
    console.log('[OpenSky] Attempting token fetch with user credentials...');
    try {
      const resp = await fetchToken(s.openskyClientId, s.openskyClientSecret);
      cachedToken = resp.access_token;
      tokenExpiresAt = now + ((resp.expires_in || 1500) * 1000);
      console.log(`[OpenSky] Token acquired (user credentials), expires in ${resp.expires_in || 1500}s`);
      return cachedToken;
    } catch (err) {
      console.error('[OpenSky] Token fetch failed (user credentials):', err.message);
    }
  } else {
    console.log('[OpenSky] No user credentials in localStorage');
  }

  // Priority 2: Server-side proxy (cred.php)
  console.log('[OpenSky] Attempting token fetch via server proxy (cred.php)...');
  try {
    const resp = await fetchTokenViaProxy();
    if (resp.access_token) {
      cachedToken = resp.access_token;
      tokenExpiresAt = now + ((resp.expires_in || 1500) * 1000);
      console.log(`[OpenSky] Token acquired (server proxy), expires in ${resp.expires_in || 1500}s`);
      return cachedToken;
    } else if (resp.error) {
      console.warn('[OpenSky] Server proxy error:', resp.error, resp.detail || '');
    } else {
      console.warn('[OpenSky] Server proxy returned no token:', JSON.stringify(resp));
    }
  } catch (err) {
    console.warn('[OpenSky] Server proxy unavailable:', err.message);
  }

  // Priority 3: Anonymous access
  console.log('[OpenSky] Falling back to anonymous access (no token)');
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
    console.log(`[OpenSky] Fetching states: ${south.toFixed(1)},${west.toFixed(1)} -> ${north.toFixed(1)},${east.toFixed(1)}`);

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
    const count = data.states ? data.states.length : 0;
    console.log(`[OpenSky] Got ${count} aircraft`);
    return data;
  } catch (err) {
    console.error('[OpenSky] States error:', err.message);
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
    console.log(`[OpenSky] Fetching track for ${icao24}`);

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
    console.error(`[OpenSky] Track error for ${icao24}:`, err.message);
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
    theme: CONFIG.theme,
    darkColor: CONFIG.darkColor,
    colorByAltitude: CONFIG.colorByAltitude,
    thickTrailsByAltitude: CONFIG.thickTrailsByAltitude,
    openskyClientId: CONFIG.openskyClientId || '',
    openskyClientSecret: CONFIG.openskyClientSecret || '',
  }),
  onChanged: (form) => {
    CONFIG.fontSize = form.fontSize;
    CONFIG.theme = form.theme;
    CONFIG.darkColor = form.darkColor;
    CONFIG.colorByAltitude = form.colorByAltitude;
    CONFIG.thickTrailsByAltitude = form.thickTrailsByAltitude;
    CONFIG.openskyClientId = form.openskyClientId;
    CONFIG.openskyClientSecret = form.openskyClientSecret;
    applyTheme();
    // Merge with existing settings to preserve savedView and other non-form fields
    const existing = loadSettings();
    saveSettings({ ...existing, ...form });
  },
});

function openSettings() {
  settingsPanel.populate({
    fontSize: CONFIG.fontSize,
    theme: CONFIG.theme,
    darkColor: CONFIG.darkColor,
    colorByAltitude: CONFIG.colorByAltitude,
    thickTrailsByAltitude: CONFIG.thickTrailsByAltitude,
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
  // Try to load server-side credentials from cred.php
  await loadServerCredentials();

  await loadAndApplySettings();
  applySavedView();
  startPolling();
}

init();
