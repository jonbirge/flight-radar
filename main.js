// main.js - Electron main process
// Handles OpenSky Network API calls via IPC to avoid CORS issues

const { app, BrowserWindow, Menu, dialog, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');

// --- Settings Persistence ---
const SETTINGS_FILE = path.join(app.getPath('userData'), 'settings.json');
const DEFAULT_SETTINGS = {
  fontSize: 12,
  theme: 'dark',           // 'dark' | 'light'
  darkColor: '#00cc44',    // phosphor color for dark mode
  openskyClientId: '',     // OpenSky API client ID (blank = anonymous)
  openskyClientSecret: '', // OpenSky API client secret
  savedView: null,         // saved camera view {lon, lat, height, heading, pitch}
  colorByAltitude: true,
  thickTrailsByAltitude: false,
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
    console.log('[Settings] Saved to', SETTINGS_FILE);
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
    console.log('[OpenSky] Refreshing OAuth2 token...');
    const resp = await fetchToken(s.openskyClientId, s.openskyClientSecret);
    cachedToken = resp.access_token;
    // expires_in is in seconds; default to 25 min if missing
    tokenExpiresAt = now + ((resp.expires_in || 1500) * 1000);
    console.log(`[OpenSky] Token acquired, expires in ${resp.expires_in || 1500}s`);
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
    console.log(`[OpenSky] Fetching states: ${south.toFixed(1)},${west.toFixed(1)} -> ${north.toFixed(1)},${east.toFixed(1)}`);
    const token = await getOpenSkyToken();
    const data = await httpGet(url, token);
    const count = data.states ? data.states.length : 0;
    console.log(`[OpenSky] Got ${count} aircraft`);
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
    console.log(`[OpenSky] Fetching track for ${icao24}`);
    const token = await getOpenSkyToken();
    const data = await httpGet(url, token);
    return data;
  } catch (err) {
    console.error(`[OpenSky] Track error for ${icao24}:`, err.message);
    return { error: err.message };
  }
});

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
      'JSON.stringify({ width: document.body.scrollWidth, height: document.body.scrollHeight })'
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
    title: 'Flight Radar - FAA Scope',
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

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
          label: 'About Flight Radar...',
          click: () => {
            const cesiumVersion = require(path.join(__dirname, 'package.json')).cesiumVersion;
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'About Flight Radar',
              message: 'Flight Radar',
              detail: [
                'Version 0.2',
                '',
                'Real-time flight tracking with data from',
                'OpenSky Network (ADS-B)',
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
