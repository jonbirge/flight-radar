'use strict';

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

const OPENSKY_BASE = 'https://opensky-network.org/api';
const OPENSKY_TOKEN_URL = 'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token';

let lastStatesCall = 0;
let lastTrackCall = 0;
const STATES_MIN_INTERVAL = 10000;
const TRACK_MIN_INTERVAL = 10000;

let cachedToken = null;
let tokenExpiresAt = 0;

const settingsChangedListeners = new Set();

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
    return true;
  } catch (err) {
    console.error('[Settings] Save error:', err.message);
    return false;
  }
}

async function loadServerCredentials() {
  console.log('[OpenSky] Checking server token proxy (cred.php)...');
  try {
    const resp = await fetch('cred.php');
    if (!resp.ok) return;
    const data = await resp.json();
    if (data.access_token) {
      cachedToken = data.access_token;
      tokenExpiresAt = Date.now() + ((data.expires_in || 1500) * 1000);
    }
  } catch (err) {
    console.warn('[OpenSky] cred.php fetch failed:', err.message);
  }
}

async function fetchTokenViaProxy() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const resp = await fetch('cred.php', { signal: controller.signal });
    clearTimeout(timeout);
    if (!resp.ok) throw new Error(`Token proxy failed: HTTP ${resp.status}`);
    return await resp.json();
  } finally {
    clearTimeout(timeout);
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
    if (!resp.ok) throw new Error(`Token request failed: HTTP ${resp.status}`);
    return await resp.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function getOpenSkyToken() {
  const now = Date.now();
  if (cachedToken && tokenExpiresAt > now + 60000) return cachedToken;

  const settings = loadSettings();
  if (settings.openskyClientId && settings.openskyClientSecret) {
    try {
      const resp = await fetchToken(settings.openskyClientId, settings.openskyClientSecret);
      cachedToken = resp.access_token;
      tokenExpiresAt = now + ((resp.expires_in || 1500) * 1000);
      return cachedToken;
    } catch (err) {
      console.warn('[OpenSky] Token fetch failed (user credentials):', err.message);
    }
  }

  try {
    const resp = await fetchTokenViaProxy();
    if (resp.access_token) {
      cachedToken = resp.access_token;
      tokenExpiresAt = now + ((resp.expires_in || 1500) * 1000);
      return cachedToken;
    }
  } catch (err) {
    console.warn('[OpenSky] Server proxy unavailable:', err.message);
  }

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
    const headers = token ? { Authorization: `Bearer ${token}` } : {};

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const resp = await fetch(url, { headers, signal: controller.signal });
    clearTimeout(timeout);

    if (resp.status === 429) return { error: 'Rate limited by OpenSky API' };
    if (!resp.ok) return { error: `HTTP ${resp.status}` };

    return await resp.json();
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
    const headers = token ? { Authorization: `Bearer ${token}` } : {};

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const resp = await fetch(url, { headers, signal: controller.signal });
    clearTimeout(timeout);

    if (!resp.ok) return { error: `HTTP ${resp.status}` };
    return await resp.json();
  } catch (err) {
    return { error: err.message };
  }
}

window.flightAPI = {
  getStates: apiGetStates,
  getTrack: apiGetTrack,
  getSettings: () => Promise.resolve(loadSettings()),
  saveSettings: (settings) => Promise.resolve(saveSettings(settings)),
  openSettings: () => {
    window.dispatchEvent(new CustomEvent('flightradar:open-settings'));
  },
  onSettingsChanged: (callback) => {
    settingsChangedListeners.add(callback);
  },
};

window.notifySettingsChanged = () => {
  for (const listener of settingsChangedListeners) listener();
};

loadServerCredentials();

await import('./settings-panel.js');
await import('../shared/renderer-core.js');
