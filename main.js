// main.js - Electron main process
// Handles OpenSky Network API calls via IPC to avoid CORS issues

import { app, BrowserWindow, Menu, dialog, ipcMain, nativeTheme, shell } from 'electron'
import path from 'path'
import fs from 'fs'
import https from 'https'
import http from 'http'
import DEFAULT_SETTINGS from './shared/defaults.js'
import pkg from './package.json'

// --- Settings Persistence ---
const SETTINGS_FILE = path.join(app.getPath('userData'), 'settings.json');

function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const data = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
      return { ...DEFAULT_SETTINGS, ...data };
    }
  } catch (err) {
    console.error('[Settings] Load error:', err.message);
  }
  return { ...DEFAULT_SETTINGS };
}

function saveSettings(settings) {
  try {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf-8');
    console.log('[Settings] Saved to local file:', SETTINGS_FILE);
  } catch (err) {
    console.error('[Settings] Save error:', err.message);
  }
}

// IPC handlers for settings
ipcMain.handle('get-settings', () => loadSettings());
ipcMain.handle('save-settings', (event, settings) => {
  saveSettings(settings);
  // Notify renderer to sync settings to cloud (if logged in)
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('cloud-sync-settings', settings);
  }
  return true;
});

// --- System Theme ---

// Sync Electron's native theme (window frames, menus, CSS prefers-color-scheme)
// with the app's theme setting ('dark', 'light', or 'system').
function syncNativeTheme() {
  const settings = loadSettings();
  nativeTheme.themeSource = settings.theme || 'system';
}

ipcMain.handle('get-system-theme', () => nativeTheme.shouldUseDarkColors ? 'dark' : 'light');

nativeTheme.on('updated', () => {
  const theme = nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('system-theme-changed', theme);
  }
});

// --- OpenSky Network API ---
const OPENSKY_BASE = 'https://opensky-network.org/api';
const OPENSKY_TOKEN_URL = 'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token';

// Rate limiting state — separate trackers for bulk and selected-aircraft polls
// so a selected-aircraft poll doesn't block the first bulk poll when enabling
// "All aircraft" (and vice versa).
let lastBulkStatesCall = 0;
let lastSelectedStatesCall = 0;
const STATES_MIN_INTERVAL = 10000;  // 10s minimum between state requests (per type)

// OAuth2 token cache
let cachedToken = null;
let tokenExpiresAt = 0;

function httpGet(url, bearerToken) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const opts = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      timeout: 15000,
      headers: {},
    };
    if (bearerToken) {
      opts.headers['Authorization'] = `Bearer ${bearerToken}`;
    }
    let settled = false;
    const settle = (fn, val) => { if (!settled) { settled = true; fn(val); } };
    // Hard deadline: destroy the request and reject if it hasn't completed in 20s.
    // The socket-level timeout (15s) only fires on idle sockets — a slow server
    // sending data trickle-style could keep the socket alive indefinitely.
    const deadline = setTimeout(() => {
      settle(reject, new Error('Hard timeout (20s)'));
      try { req.destroy(); } catch (_) {}
    }, 20000);
    const client = url.startsWith('https') ? https : http;
    const req = client.get(opts, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        clearTimeout(deadline);
        if (res.statusCode === 200) {
          try {
            settle(resolve, JSON.parse(data));
          } catch (e) {
            settle(reject, new Error(`JSON parse error: ${e.message}`));
          }
        } else if (res.statusCode === 429) {
          settle(reject, new Error('Rate limited by OpenSky API'));
        } else {
          settle(reject, new Error(`HTTP ${res.statusCode}: ${data.substring(0, 200)}`));
        }
      });
    });
    req.on('error', (err) => { clearTimeout(deadline); settle(reject, err); });
    req.on('timeout', () => { clearTimeout(deadline); req.destroy(); settle(reject, new Error('Request timeout')); });
  });
}

// OAuth2 client credentials token fetch
function fetchToken(clientId, clientSecret) {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    }).toString();

    const opts = {
      hostname: 'auth.opensky-network.org',
      path: '/auth/realms/opensky-network/protocol/openid-connect/token',
      method: 'POST',
      timeout: 10000,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            const json = JSON.parse(data);
            resolve(json);
          } catch (e) {
            reject(new Error(`Token JSON parse error: ${e.message}`));
          }
        } else {
          reject(new Error(`Token request failed: HTTP ${res.statusCode}`));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Token request timeout')); });
    req.write(body);
    req.end();
  });
}

// Get a valid bearer token, refreshing if expired. Returns null for anonymous.
async function getOpenSkyToken() {
  const s = loadSettings();
  if (!s.openskyClientId || !s.openskyClientSecret) {
    return null;
  }

  const now = Date.now();
  // Refresh if token expires within 60 seconds
  if (cachedToken && tokenExpiresAt > now + 60000) {
    return cachedToken;
  }

  try {
    const resp = await fetchToken(s.openskyClientId, s.openskyClientSecret);
    cachedToken = resp.access_token;
    // expires_in is in seconds; default to 25 min if missing
    tokenExpiresAt = now + ((resp.expires_in || 1500) * 1000);
    return cachedToken;
  } catch (err) {
    console.error('[OpenSky] Token refresh failed:', err.message);
    // Fall back to anonymous
    cachedToken = null;
    tokenExpiresAt = 0;
    return null;
  }
}

// IPC handler: get flight states within a bounding box
ipcMain.handle('get-states', async (event, bounds, type) => {
  const now = Date.now();
  const lastCall = type === 'selected' ? lastSelectedStatesCall : lastBulkStatesCall;
  if (now - lastCall < STATES_MIN_INTERVAL) {
    const retryIn = STATES_MIN_INTERVAL - (now - lastCall);
    console.log(`[OpenSky] IPC rate limited (${type || 'bulk'}), retryIn=${retryIn}ms`);
    return { error: 'Rate limited', retryIn };
  }
  if (type === 'selected') {
    lastSelectedStatesCall = now;
  } else {
    lastBulkStatesCall = now;
  }

  try {
    const { south, west, north, east } = bounds;
    const url = `${OPENSKY_BASE}/states/all?lamin=${south}&lomin=${west}&lamax=${north}&lomax=${east}`;
    console.log('[OpenSky] Fetching states...');
    const t0 = Date.now();
    const token = await getOpenSkyToken();
    const data = await httpGet(url, token);
    const stateCount = data && data.states ? data.states.length : 0;
    console.log(`[OpenSky] Got ${stateCount} states in ${Date.now() - t0}ms`);
    return data;
  } catch (err) {
    console.error('[OpenSky] States error:', err.message);
    return { error: err.message };
  }
});

// IPC handler: get track/trajectory for a specific aircraft
ipcMain.handle('get-track', async (event, icao24) => {
  try {
    const url = `${OPENSKY_BASE}/tracks/all?icao24=${icao24}`;
    const token = await getOpenSkyToken();
    const data = await httpGet(url, token);
    return data;
  } catch (err) {
    console.error(`[OpenSky] Track error for ${icao24}:`, err.message);
    return { error: err.message };
  }
});

// --- FlightAware AeroAPI ---
const FA_AEROAPI_BASE = 'https://aeroapi.flightaware.com/aeroapi';

function httpGetFA(url, apiKey) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const opts = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      timeout: 15000,
      headers: {
        'x-apikey': apiKey,
        'Accept': 'application/json',
      },
    };
    const req = https.get(opts, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`JSON parse error: ${e.message}`));
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data.substring(0, 200)}`));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
  });
}

// IPC handler: get flight plan from FlightAware
ipcMain.handle('get-flight-plan', async (event, ident) => {
  const s = loadSettings();
  const apiKey = s.flightawareApiKey;
  if (!apiKey) {
    return { error: 'FlightAware API key not configured' };
  }

  try {
    const safeIdent = ident.replace(/[^a-zA-Z0-9]/g, '');
    const url = `${FA_AEROAPI_BASE}/flights/${safeIdent}`;
    const data = await httpGetFA(url, apiKey);
    return data;
  } catch (err) {
    console.error(`[FlightAware] Flight plan error for ${ident}:`, err.message);
    return { error: err.message };
  }
});

// IPC handler: get decoded filed route with waypoint coordinates from FlightAware
ipcMain.handle('get-flight-route', async (event, faFlightId) => {
  const s = loadSettings();
  const apiKey = s.flightawareApiKey;
  if (!apiKey) {
    return { error: 'FlightAware API key not configured' };
  }

  try {
    const safeId = faFlightId.replace(/[^a-zA-Z0-9\-_]/g, '');
    const url = `${FA_AEROAPI_BASE}/flights/${safeId}/route`;
    const data = await httpGetFA(url, apiKey);
    return data;
  } catch (err) {
    console.error(`[FlightAware] Route error for ${faFlightId}:`, err.message);
    return { error: err.message };
  }
});

// IPC handler: get actual flown track from FlightAware
ipcMain.handle('get-flight-track', async (event, faFlightId) => {
  const s = loadSettings();
  const apiKey = s.flightawareApiKey;
  if (!apiKey) {
    return { error: 'FlightAware API key not configured' };
  }

  try {
    // fa_flight_id contains alphanumeric, hyphens, and underscores
    const safeId = faFlightId.replace(/[^a-zA-Z0-9\-_]/g, '');
    const url = `${FA_AEROAPI_BASE}/flights/${safeId}/track`;
    const data = await httpGetFA(url, apiKey);
    return data;
  } catch (err) {
    console.error(`[FlightAware] Track error for ${faFlightId}:`, err.message);
    return { error: err.message };
  }
});

// IPC handler: search flights via advanced query (origin, destination, date/time window)
ipcMain.handle('search-flights', async (event, advQuery) => {
  const s = loadSettings();
  const apiKey = s.flightawareApiKey;
  if (!apiKey) {
    return { error: 'FlightAware API key not configured' };
  }

  try {
    const url = `${FA_AEROAPI_BASE}/flights/search/advanced?query=${encodeURIComponent(advQuery)}`;
    const data = await httpGetFA(url, apiKey);
    return data;
  } catch (err) {
    console.error('[FlightAware] NL search error:', err.message);
    return { error: err.message };
  }
});

// IPC handler: get airport flights from FlightAware
// Makes two parallel calls to /airports/{id}/flights/arrivals and /departures
// to get both en-route inbound and recently departed outbound flights.
ipcMain.handle('get-airport-flights', async (event, airportCode) => {
  const s = loadSettings();
  const apiKey = s.flightawareApiKey;
  if (!apiKey) {
    return { error: 'FlightAware API key not configured' };
  }

  try {
    const safeCode = airportCode.replace(/[^a-zA-Z0-9]/g, '');
    const data = await httpGetFA(`${FA_AEROAPI_BASE}/airports/${safeCode}/flights`, apiKey);
    // Log all response keys and array sizes for debugging
    for (const key of Object.keys(data)) {
      if (Array.isArray(data[key])) {
        console.log(`[FlightAware] ${safeCode} response: ${key} = ${data[key].length} flights`);
      }
    }
    return data;
  } catch (err) {
    console.error(`[FlightAware] Airport flights error for ${airportCode}:`, err.message);
    return { error: err.message };
  }
});

// --- Help Window ---
let helpWindow = null;

function openHelpWindow() {
  if (helpWindow) {
    helpWindow.focus();
    return;
  }
  helpWindow = new BrowserWindow({
    width: 840,
    height: 700,
    minWidth: 560,
    minHeight: 300,
    resizable: true,
    parent: mainWindow,
    modal: false,
    show: false,
    backgroundColor: '#f0f0f0',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, '../preload/help.js'),
    },
  });
  helpWindow.setMenu(null);
  if (process.env.ELECTRON_RENDERER_URL) {
    helpWindow.loadURL(process.env.ELECTRON_RENDERER_URL + '/src/help.html');
  } else {
    helpWindow.loadFile(path.join(__dirname, '../renderer/src/help.html'));
  }
  helpWindow.once('ready-to-show', () => helpWindow.show());
  helpWindow.on('closed', () => { helpWindow = null; });
}

// --- Settings Window ---
let settingsWindow = null;

function openSettingsWindow() {
  if (settingsWindow) {
    settingsWindow.focus();
    return;
  }
  settingsWindow = new BrowserWindow({
    width: 780,
    height: 500,
    useContentSize: true,
    resizable: false,
    parent: mainWindow,
    modal: false,
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#2d2d2d' : '#f0f0f0',
    webPreferences: {
      preload: path.join(__dirname, '../preload/settings.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  settingsWindow.setMenu(null);
  // Allow OAuth popups for PocketBase cloud sync (Google sign-in).
  // The OAuth flow opens a popup that navigates through Google → PocketBase → back,
  // so allow all HTTPS popups from the settings window.
  settingsWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 600,
          height: 700,
          autoHideMenuBar: true,
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
          },
        },
      };
    }
    return { action: 'deny' };
  });
  // Forward settings window console output to terminal for debugging
  settingsWindow.webContents.on('console-message', (event, level, message) => {
    if (level <= 1) console.log('[Settings]', message);
    else console.warn('[Settings]', message);
  });
  if (process.env.ELECTRON_RENDERER_URL) {
    settingsWindow.loadURL(process.env.ELECTRON_RENDERER_URL + '/src/settings.html');
  } else {
    settingsWindow.loadFile(path.join(__dirname, '../renderer/src/settings.html'));
  }
  settingsWindow.once('ready-to-show', () => {
    // Auto-resize to fit content
    settingsWindow.webContents.executeJavaScript(
      '(() => { document.body.style.height = "auto"; document.body.style.overflow = "hidden"; return JSON.stringify({ width: document.body.scrollWidth, height: document.body.scrollHeight }); })()'
    ).then(json => {
      const { width, height } = JSON.parse(json);
      settingsWindow.setContentSize(Math.max(width, 780), height);
      // Center on parent window
      if (mainWindow && !mainWindow.isDestroyed()) {
        const [px, py] = mainWindow.getPosition();
        const [pw, ph] = mainWindow.getSize();
        const [sw, sh] = settingsWindow.getSize();
        settingsWindow.setPosition(
          Math.round(px + (pw - sw) / 2),
          Math.round(py + (ph - sh) / 2),
        );
      }
      settingsWindow.show();
    }).catch(() => settingsWindow.show());
  });
  settingsWindow.on('closed', () => { settingsWindow = null; });
}

// IPC: show native context menu — resolves with the selected item id, or null if dismissed
ipcMain.handle('show-context-menu', (event, items) => {
  return new Promise((resolve) => {
    let resolved = false;
    const template = items.map(item => ({
      label: item.label,
      click: () => { resolved = true; resolve(item.id); },
    }));
    const menu = Menu.buildFromTemplate(template);
    const win = BrowserWindow.fromWebContents(event.sender);
    menu.popup({ window: win, callback: () => { if (!resolved) resolve(null); } });
  });
});

// IPC: open settings window from renderer
ipcMain.handle('open-settings-window', () => {
  openSettingsWindow();
  return true;
});

// IPC: resize settings window to fit content
ipcMain.handle('resize-settings', () => {
  if (!settingsWindow || settingsWindow.isDestroyed()) return;
  settingsWindow.webContents.executeJavaScript(
    '(() => { document.body.style.height = "auto"; document.body.style.overflow = "hidden"; return JSON.stringify({ width: document.body.scrollWidth, height: document.body.scrollHeight }); })()'
  ).then(json => {
    if (!settingsWindow || settingsWindow.isDestroyed()) return;
    const { width, height } = JSON.parse(json);
    settingsWindow.setContentSize(Math.max(width, 780), height);
  }).catch(() => {});
});

// IPC: update settings live — save and notify renderer, but keep window open
ipcMain.handle('update-settings', (event, settings) => {
  saveSettings(settings);
  syncNativeTheme();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('settings-changed', settings);
  }
  if (helpWindow && !helpWindow.isDestroyed()) {
    helpWindow.webContents.send('settings-changed', settings);
  }
  return true;
});

// IPC: save settings without notifying renderer (used after slider preview)
ipcMain.handle('update-settings-quiet', (event, settings) => {
  saveSettings(settings);
  return true;
});

// IPC: reset all settings to defaults
ipcMain.handle('reset-settings', async () => {
  const parent = settingsWindow && !settingsWindow.isDestroyed() ? settingsWindow : mainWindow;
  const { response } = await dialog.showMessageBox(parent, {
    type: 'warning',
    title: 'Reset to Defaults',
    message: 'Reset all settings to defaults?',
    detail: 'This will restore all preferences, view position, and credentials to their original values. This cannot be undone.',
    buttons: ['Reset', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
  });
  if (response === 0) {
    try { fs.unlinkSync(SETTINGS_FILE); } catch (_) {}
    cachedToken = null;
    tokenExpiresAt = 0;
    syncNativeTheme();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('settings-changed');
    }
    if (helpWindow && !helpWindow.isDestroyed()) {
      helpWindow.webContents.send('settings-changed');
    }
    return { reset: true };
  }
  return { reset: false };
});

// IPC: close settings window (Done)
ipcMain.on('close-settings-window', () => {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.close();
  }
});

// IPC: lightweight previews — forward to renderer without full settings reload
ipcMain.on('preview-font-size', (event, size) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('font-size-preview', size);
  }
});
ipcMain.on('preview-rotation-speed', (event, speed) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('rotation-speed-preview', speed);
  }
});
ipcMain.on('preview-weather-opacity', (event, opacity) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('weather-opacity-preview', opacity);
  }
});
ipcMain.on('preview-alt-gain', (event, factor) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('alt-gain-preview', factor);
  }
});

// IPC: forward cloud settings changes from settings window to renderer
ipcMain.on('cloud-settings-changed', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('cloud-settings-changed');
  }
});

// --- Window Creation ---
let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    backgroundColor: '#000000',
    title: '3D Flight Radar - FAA Scope',
    icon: path.join(__dirname, '../assets/icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    }
  });

  // In dev mode, load from Vite dev server; in prod, load built file
  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL + '/src/index.html');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/src/index.html'));
  }

  // Allow OAuth popups for PocketBase cloud sync (Google sign-in)
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 600,
          height: 700,
          autoHideMenuBar: true,
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
          },
        },
      };
    }
    return { action: 'deny' };
  });

  // Forward renderer console output to terminal
  mainWindow.webContents.on('console-message', (event, level, message) => {
    if (level <= 1) console.log(message);
    else console.warn(message);
  });

  // Open DevTools in dev mode
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }
}

app.whenReady().then(() => {
  syncNativeTheme();
  createWindow();
  buildMenu();
});
app.on('window-all-closed', () => app.quit());

// --- Application Menu ---
function buildMenu() {
  const template = [
    { role: 'fileMenu' },
    {
      role: 'editMenu',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { type: 'separator' },
        {
          label: 'Settings...',
          accelerator: 'CmdOrCtrl+,',
          click: () => openSettingsWindow(),
        },
      ],
    },
    { role: 'viewMenu' },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Help Contents',
          accelerator: 'F1',
          click: () => openHelpWindow(),
        },
        { type: 'separator' },
        {
          label: 'About 3D Flight Radar...',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'About 3D Flight Radar',
              message: '3D Flight Radar',
              detail: [
                `Version ${pkg.version}`,
                '',
                'Real-time flight tracking with data from',
                'OpenSky Network (ADS-B)',
                '',
                'Weather data from',
                'FAA Aviation Weather Center (AWC)',
                'Iowa State Mesonet (NEXRAD)',
                '',
                `Electron ${process.versions.electron}`,
                `CesiumJS ${pkg.cesiumVersion}`,
              ].join('\n'),
              buttons: ['OK'],
            });
          },
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
