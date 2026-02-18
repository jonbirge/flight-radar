// main.js - Electron main process
// Handles OpenSky Network API calls via IPC to avoid CORS issues

const { app, BrowserWindow, Menu, dialog, ipcMain, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');

// --- Settings Persistence ---
const SETTINGS_FILE = path.join(app.getPath('userData'), 'settings.json');
const DEFAULT_SETTINGS = {
  fontSize: 12,
  theme: 'system',
  darkColor: '#ffffff',
  lightColor: '#000000',
  colorByAltitude: true,
  trailMode: 'history',
  thickTrailsByAltitude: false,
  trailLength: 120,
  labelsEnabled: true,
  airportsEnabled: true,
  airspaceEnabled: true,
  airspaceEdges: false,
  airspace3D: false,
  showSmallAirports: false,
  navaidsEnabled: false,
  showFixes: false,
  mapLayer: 'carto',
  radarEnabled: false,
  turbulenceEnabled: false,
  turbulenceLevel: 'none',
  rotationSpeed: 6,
  openskyClientId: '',
  openskyClientSecret: '',
  savedView: { lon: -98.5, lat: 39.5, height: 4860000, heading: 0, pitch: -1.5708 },
};

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
  } catch (err) {
    console.error('[Settings] Save error:', err.message);
  }
}

// IPC handlers for settings
ipcMain.handle('get-settings', () => loadSettings());
ipcMain.handle('save-settings', (event, settings) => {
  saveSettings(settings);
  return true;
});

// --- System Theme ---
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

// Rate limiting state
let lastStatesCall = 0;
const STATES_MIN_INTERVAL = 10000;  // 10s minimum between state requests

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
    const client = url.startsWith('https') ? https : http;
    const req = client.get(opts, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`JSON parse error: ${e.message}`));
          }
        } else if (res.statusCode === 429) {
          reject(new Error('Rate limited by OpenSky API'));
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data.substring(0, 200)}`));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
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
ipcMain.handle('get-states', async (event, bounds) => {
  const now = Date.now();
  if (now - lastStatesCall < STATES_MIN_INTERVAL) {
    return { error: 'Rate limited', retryIn: STATES_MIN_INTERVAL - (now - lastStatesCall) };
  }
  lastStatesCall = now;

  try {
    const { south, west, north, east } = bounds;
    const url = `${OPENSKY_BASE}/states/all?lamin=${south}&lomin=${west}&lamax=${north}&lomax=${east}`;
    const token = await getOpenSkyToken();
    const data = await httpGet(url, token);
    return data;
  } catch (err) {
    console.error('[OpenSky] States error:', err.message);
    return { error: err.message };
  }
});

// IPC handler: get track/trajectory for a specific aircraft
ipcMain.handle('get-track', async (event, icao24) => {
  try {
    const url = `${OPENSKY_BASE}/tracks/all?icao24=${icao24}&time=0`;
    const token = await getOpenSkyToken();
    const data = await httpGet(url, token);
    return data;
  } catch (err) {
    console.error(`[OpenSky] Track error for ${icao24}:`, err.message);
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
    width: 600,
    height: 700,
    minWidth: 400,
    minHeight: 300,
    resizable: true,
    parent: mainWindow,
    modal: false,
    show: false,
    backgroundColor: '#f0f0f0',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  helpWindow.setMenu(null);
  helpWindow.loadFile(path.join(__dirname, 'src', 'help.html'));
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
    width: 440,
    height: 540,
    useContentSize: true,
    resizable: false,
    parent: mainWindow,
    modal: false,
    show: false,
    backgroundColor: '#f0f0f0',
    webPreferences: {
      preload: path.join(__dirname, 'settings-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  settingsWindow.setMenu(null);
  settingsWindow.loadFile(path.join(__dirname, 'src', 'settings.html'));
  settingsWindow.once('ready-to-show', () => {
    // Auto-resize to fit content
    settingsWindow.webContents.executeJavaScript(
      '(() => { document.body.style.height = "auto"; document.body.style.overflow = "hidden"; return JSON.stringify({ width: document.body.scrollWidth, height: document.body.scrollHeight }); })()'
    ).then(json => {
      const { width, height } = JSON.parse(json);
      settingsWindow.setContentSize(Math.max(width, 440), height);
      settingsWindow.show();
    }).catch(() => settingsWindow.show());
  });
  settingsWindow.on('closed', () => { settingsWindow = null; });
}

// IPC: open settings window from renderer
ipcMain.handle('open-settings-window', () => {
  openSettingsWindow();
  return true;
});

// IPC: update settings live — save and notify renderer, but keep window open
ipcMain.handle('update-settings', (event, settings) => {
  saveSettings(settings);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('settings-changed');
  }
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
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('settings-changed');
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

// --- Window Creation ---
let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    backgroundColor: '#000000',
    title: '3D Flight Radar - FAA Scope',
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

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
            const cesiumVersion = require(path.join(__dirname, 'package.json')).cesiumVersion;
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'About 3D Flight Radar',
              message: '3D Flight Radar',
              detail: [
                `Version ${require(path.join(__dirname, 'package.json')).version}`,
                '',
                'Real-time flight tracking with data from',
                'OpenSky Network (ADS-B)',
                '',
                'Weather data from',
                'FAA Aviation Weather Center (AWC)',
                'Iowa State Mesonet (NEXRAD)',
                '',
                `Electron ${process.versions.electron}`,
                `CesiumJS ${cesiumVersion}`,
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
