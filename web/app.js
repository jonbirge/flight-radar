// app.js - Web-specific entry point
// Shared modules (config, data, icons, radar) are loaded before this script.
// This file provides: window.flightAPI shim, settings panel, and init.

'use strict';

// ============================================================
// Settings (localStorage)
// ============================================================

const SETTINGS_STORAGE_KEY = 'flightRadar_settings';
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
    if (!resp.ok) {
      const body = await resp.json().catch(() => ({}));
      const detail = body.detail ? ` — ${body.detail}` : '';
      throw new Error(`Token proxy failed: HTTP ${resp.status}${detail}`);
    }
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

  // Try server proxy — it will use server-side creds.json if no credentials are passed
  const s = loadSettings();
  const clientId = s.openskyClientId || null;
  const clientSecret = s.openskyClientSecret || null;

  try {
    const resp = await fetchTokenViaProxy(clientId, clientSecret);
    if (resp.access_token) {
      cachedToken = resp.access_token;
      tokenExpiresAt = now + ((resp.expires_in || 1500) * 1000);
      console.log('OpenSky: authenticated via token proxy');
      return cachedToken;
    }
  } catch (err) {
    console.warn('OpenSky: token proxy failed, falling back to anonymous', err.message);
  }

  // Token fetch failed — anonymous access
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
    const url = `${OPENSKY_BASE}/tracks/all?icao24=${icao24}`;

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
// FlightAware AeroAPI (via PHP proxy)
// ============================================================

async function apiGetFlightPlan(ident) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const url = `flightaware-proxy.php?endpoint=flights&ident=${encodeURIComponent(ident)}`;
    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!resp.ok) {
      return { error: `HTTP ${resp.status}` };
    }
    return await resp.json();
  } catch (err) {
    return { error: err.message };
  }
}

// Fetch decoded filed route with waypoint coordinates from FlightAware AeroAPI
async function apiGetFlightRoute(faFlightId) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const url = `flightaware-proxy.php?endpoint=flights/route&fa_flight_id=${encodeURIComponent(faFlightId)}`;
    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!resp.ok) {
      return { error: `HTTP ${resp.status}` };
    }
    return await resp.json();
  } catch (err) {
    return { error: err.message };
  }
}

// Fetch actual flown track for a specific flight from FlightAware AeroAPI
async function apiGetFlightTrack(faFlightId) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const url = `flightaware-proxy.php?endpoint=flights/track&fa_flight_id=${encodeURIComponent(faFlightId)}`;
    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!resp.ok) {
      return { error: `HTTP ${resp.status}` };
    }
    return await resp.json();
  } catch (err) {
    return { error: err.message };
  }
}

// Fetch flights to/from an airport from FlightAware AeroAPI
async function apiGetAirportFlights(airportCode) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const url = `flightaware-proxy.php?endpoint=airports/flights&airport=${encodeURIComponent(airportCode)}`;
    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!resp.ok) {
      return { error: `HTTP ${resp.status}` };
    }
    return await resp.json();
  } catch (err) {
    return { error: err.message };
  }
}

// Search flights by advanced query (origin, destination, date/time window)
async function apiSearchFlights(advQuery) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const url = `flightaware-proxy.php?endpoint=flights/search/advanced&query=${encodeURIComponent(advQuery)}`;
    const resp = await fetch(url, { signal: controller.signal });
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
  getFlightPlan: (ident) => apiGetFlightPlan(ident),
  getFlightRoute: (faFlightId) => apiGetFlightRoute(faFlightId),
  getFlightTrack: (faFlightId) => apiGetFlightTrack(faFlightId),
  searchFlights: (advQuery) => apiSearchFlights(advQuery),
  getAirportFlights: (airportCode) => apiGetAirportFlights(airportCode),
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

  // Web context menu — positions a div at (x, y), resolves with selected item id or null
  showContextMenu: (items, x, y) => {
    return new Promise((resolve) => {
      const menu = document.getElementById('context-menu');
      const list = document.getElementById('context-menu-list');
      list.innerHTML = '';

      let resolved = false;
      const done = (id) => {
        if (resolved) return;
        resolved = true;
        menu.classList.add('hidden');
        document.removeEventListener('click', dismiss, true);
        document.removeEventListener('contextmenu', dismiss, true);
        resolve(id);
      };

      items.forEach(item => {
        const li = document.createElement('li');
        li.textContent = item.label;
        li.addEventListener('click', () => done(item.id));
        list.appendChild(li);
      });

      // Keep menu within viewport
      const menuW = 180, menuH = items.length * 40 + 8;
      const left = (x + menuW > window.innerWidth)  ? x - menuW : x;
      const top  = (y + menuH > window.innerHeight) ? y - menuH : y;
      menu.style.left = left + 'px';
      menu.style.top  = top  + 'px';
      menu.classList.remove('hidden');

      const dismiss = (e) => { if (!menu.contains(e.target)) done(null); };
      setTimeout(() => {
        document.addEventListener('click', dismiss, true);
        document.addEventListener('contextmenu', dismiss, true);
      }, 0);
    });
  },
};

// ============================================================
// Settings Panel (shared module with live updating)
// ============================================================

const settingsOverlay = document.getElementById('settings-overlay');
const settingsContainer = document.getElementById('settings-container');
settingsContainer.innerHTML = createSettingsFormHTML();
// Hide OpenSky credentials in web mode (credentials are handled server-side)
const credSection = settingsContainer.querySelector('#cred-drop-zone');
if (credSection) credSection.closest('.settings-section').style.display = 'none';

const settingsPanel = initSettingsPanel({
  container: settingsContainer,
  getSettings: () => window.flightAPI.getSettings(),
  onChanged: async (form) => {
    // Merge with existing settings to preserve savedView and other non-form fields,
    // then let loadAndApplySettings handle all CONFIG updates and side effects
    // (same flow as Electron: save → reload)
    const existing = loadSettings();
    saveSettings({ ...existing, ...form });
    await loadAndApplySettings();
  },
  onClose: () => closeSettings(),
  onDefaults: () => {
    if (confirm('Reset all settings to defaults? This cannot be undone.')) {
      localStorage.removeItem(SETTINGS_STORAGE_KEY);
      location.reload();
    }
  },
});

async function openSettings() {
  const settings = await window.flightAPI.getSettings();
  settingsPanel.populate(settings);
  settingsOverlay.classList.add('visible');
}

function closeSettings() {
  settingsOverlay.classList.remove('visible');
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
  // Route VFRMap.com tile requests through local caching proxy to avoid CORS
  CONFIG.vfrMapProxyUrl = 'vfrmap-proxy.php';
  await loadAndApplySettings();
  applySavedView();
  startPolling();
}

init();

// ============================================================
// Pause/resume timers when browser tab loses/gains visibility
// ============================================================

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    pauseAllTimers();
  } else {
    resumeAllTimers();
  }
});
