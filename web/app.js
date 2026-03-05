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
// airplanes.live API (browser fetch — no auth required)
// ============================================================

const AIRPLANES_LIVE_BASE = 'https://api.airplanes.live/v2';

// Rate limiting state
let lastStatesCall = 0;
let lastTrackCall = 0;
const STATES_MIN_INTERVAL = 1000;  // 1s minimum (API rate limit)
const TRACK_MIN_INTERVAL = 1000;

// Convert a bounding box to center point + radius in nautical miles.
// airplanes.live uses /v2/point/{lat}/{lon}/{radius} with max radius 250nm.
function boundsToPointRadius(bounds) {
  const centerLat = (bounds.south + bounds.north) / 2;
  const centerLon = (bounds.west + bounds.east) / 2;

  const latSpan = bounds.north - bounds.south;
  const lonSpan = bounds.east - bounds.west;
  const latNm = latSpan * 60 / 2;
  const lonNm = lonSpan * 60 * Math.cos(centerLat * Math.PI / 180) / 2;
  const radiusNm = Math.ceil(Math.sqrt(latNm * latNm + lonNm * lonNm));

  return { lat: centerLat, lon: centerLon, radius: radiusNm };
}

const MAX_API_RADIUS = 250;

function tileBounds(bounds) {
  const single = boundsToPointRadius(bounds);
  if (single.radius <= MAX_API_RADIUS) {
    return [{ lat: single.lat, lon: single.lon, radius: Math.min(single.radius, MAX_API_RADIUS) }];
  }
  const stepDeg = 350 / 60; // ~5.83°
  const tiles = [];
  for (let lat = bounds.south; lat < bounds.north + stepDeg; lat += stepDeg) {
    const tileLat = Math.min(lat + stepDeg / 2, bounds.north);
    for (let lon = bounds.west; lon < bounds.east + stepDeg; lon += stepDeg) {
      const tileLon = Math.min(lon + stepDeg / 2, bounds.east);
      tiles.push({ lat: tileLat, lon: tileLon, radius: MAX_API_RADIUS });
    }
  }
  return tiles;
}

async function apiGetStates(bounds) {
  const now = Date.now();
  if (now - lastStatesCall < STATES_MIN_INTERVAL) {
    return { error: 'Rate limited', retryIn: STATES_MIN_INTERVAL - (now - lastStatesCall) };
  }
  lastStatesCall = now;

  try {
    const tiles = tileBounds(bounds);

    const results = await Promise.all(tiles.map(async ({ lat, lon, radius }) => {
      const url = `${AIRPLANES_LIVE_BASE}/point/${lat.toFixed(4)}/${lon.toFixed(4)}/${radius}`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      try {
        const resp = await fetch(url, { signal: controller.signal });
        clearTimeout(timeout);
        if (!resp.ok) return { ac: [] };
        return await resp.json();
      } catch (_) {
        clearTimeout(timeout);
        return { ac: [] };
      }
    }));

    const seen = new Set();
    const merged = [];
    for (const data of results) {
      if (data && data.ac) {
        for (const ac of data.ac) {
          const hex = ac.hex || ac.icao24;
          if (hex && !seen.has(hex)) {
            seen.add(hex);
            merged.push(ac);
          }
        }
      }
    }

    return { ac: merged };
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
    const url = `${AIRPLANES_LIVE_BASE}/hex/${encodeURIComponent(icao24)}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

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
