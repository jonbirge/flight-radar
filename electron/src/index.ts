import { app, BrowserWindow, Menu, dialog, ipcMain, nativeTheme } from 'electron';
import { setupCapacitorElectronPlugins } from '@capacitor-community/electron';
import { join } from 'path';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import https from 'https';
import http from 'http';
import electronServe from 'electron-serve';

const loadApp = electronServe({
  directory: join(app.getAppPath(), 'app'),
  scheme: 'capacitor-electron',
});

const SETTINGS_FILE = join(app.getPath('userData'), 'settings.json');
const DEFAULT_SETTINGS = require(join(app.getAppPath(), 'app', 'shared', 'defaults.js'));

function loadSettings() {
  try {
    if (existsSync(SETTINGS_FILE)) {
      const data = JSON.parse(readFileSync(SETTINGS_FILE, 'utf-8'));
      return { ...DEFAULT_SETTINGS, ...data };
    }
  } catch (err: any) {
    console.error('[Settings] Load error:', err.message);
  }
  return { ...DEFAULT_SETTINGS };
}

function saveSettings(settings: any) {
  try {
    writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf-8');
  } catch (err: any) {
    console.error('[Settings] Save error:', err.message);
  }
}

ipcMain.handle('get-settings', () => loadSettings());
ipcMain.handle('save-settings', (_event, settings) => {
  saveSettings(settings);
  return true;
});

function syncNativeTheme() {
  const settings = loadSettings();
  nativeTheme.themeSource = settings.theme || 'system';
}

ipcMain.handle('get-system-theme', () => nativeTheme.shouldUseDarkColors ? 'dark' : 'light');

let mainWindow: BrowserWindow;
let helpWindow: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;

nativeTheme.on('updated', () => {
  const theme = nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('system-theme-changed', theme);
  }
});

const OPENSKY_BASE = 'https://opensky-network.org/api';
const FA_AEROAPI_BASE = 'https://aeroapi.flightaware.com/aeroapi';

let lastStatesCall = 0;
const STATES_MIN_INTERVAL = 10000;

let cachedToken: string | null = null;
let tokenExpiresAt = 0;

function httpGet(url: string, bearerToken?: string | null): Promise<any> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const opts: any = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      timeout: 15000,
      headers: {},
    };
    if (bearerToken) opts.headers['Authorization'] = `Bearer ${bearerToken}`;

    let settled = false;
    const settle = (fn: any, val: any) => { if (!settled) { settled = true; fn(val); } };

    const client = url.startsWith('https') ? https : http;
    const req = client.get(opts, (res: any) => {
      let data = '';
      res.on('data', (chunk: Buffer) => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            settle(resolve, JSON.parse(data));
          } catch (e: any) {
            settle(reject, new Error(`JSON parse error: ${e.message}`));
          }
        } else if (res.statusCode === 429) {
          settle(reject, new Error('Rate limited by OpenSky API'));
        } else {
          settle(reject, new Error(`HTTP ${res.statusCode}: ${data.substring(0, 200)}`));
        }
      });
    });

    const deadline = setTimeout(() => {
      settle(reject, new Error('Hard timeout (20s)'));
      try { req.destroy(); } catch (_) {}
    }, 20000);

    req.on('error', (err: any) => { clearTimeout(deadline); settle(reject, err); });
    req.on('timeout', () => { clearTimeout(deadline); req.destroy(); settle(reject, new Error('Request timeout')); });
  });
}

function fetchToken(clientId: string, clientSecret: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    }).toString();

    const opts: any = {
      hostname: 'auth.opensky-network.org',
      path: '/auth/realms/opensky-network/protocol/openid-connect/token',
      method: 'POST',
      timeout: 10000,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(opts, (res: any) => {
      let data = '';
      res.on('data', (chunk: Buffer) => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          try { resolve(JSON.parse(data)); }
          catch (e: any) { reject(new Error(`Token JSON parse error: ${e.message}`)); }
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

async function getOpenSkyToken() {
  const s = loadSettings();
  if (!s.openskyClientId || !s.openskyClientSecret) return null;

  const now = Date.now();
  if (cachedToken && tokenExpiresAt > now + 60000) return cachedToken;

  try {
    const resp = await fetchToken(s.openskyClientId, s.openskyClientSecret);
    cachedToken = resp.access_token;
    tokenExpiresAt = now + ((resp.expires_in || 1500) * 1000);
    return cachedToken;
  } catch (err: any) {
    console.error('[OpenSky] Token refresh failed:', err.message);
    cachedToken = null;
    tokenExpiresAt = 0;
    return null;
  }
}

ipcMain.handle('get-states', async (_event, bounds) => {
  const now = Date.now();
  if (now - lastStatesCall < STATES_MIN_INTERVAL) {
    return { error: 'Rate limited', retryIn: STATES_MIN_INTERVAL - (now - lastStatesCall) };
  }
  lastStatesCall = now;

  try {
    const { south, west, north, east } = bounds;
    const url = `${OPENSKY_BASE}/states/all?lamin=${south}&lomin=${west}&lamax=${north}&lomax=${east}`;
    const token = await getOpenSkyToken();
    return await httpGet(url, token);
  } catch (err: any) {
    return { error: err.message };
  }
});

ipcMain.handle('get-track', async (_event, icao24) => {
  try {
    const url = `${OPENSKY_BASE}/tracks/all?icao24=${icao24}`;
    const token = await getOpenSkyToken();
    return await httpGet(url, token);
  } catch (err: any) {
    return { error: err.message };
  }
});

function httpGetFA(url: string, apiKey: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const opts: any = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      timeout: 15000,
      headers: {
        'x-apikey': apiKey,
        'Accept': 'application/json',
      },
    };
    const req = https.get(opts, (res: any) => {
      let data = '';
      res.on('data', (chunk: Buffer) => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          try { resolve(JSON.parse(data)); }
          catch (e: any) { reject(new Error(`JSON parse error: ${e.message}`)); }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data.substring(0, 200)}`));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
  });
}

ipcMain.handle('get-flight-plan', async (_event, ident) => {
  const apiKey = loadSettings().flightawareApiKey;
  if (!apiKey) return { error: 'FlightAware API key not configured' };
  try {
    const safeIdent = ident.replace(/[^a-zA-Z0-9]/g, '');
    return await httpGetFA(`${FA_AEROAPI_BASE}/flights/${safeIdent}`, apiKey);
  } catch (err: any) {
    return { error: err.message };
  }
});

ipcMain.handle('get-flight-route', async (_event, faFlightId) => {
  const apiKey = loadSettings().flightawareApiKey;
  if (!apiKey) return { error: 'FlightAware API key not configured' };
  try {
    const safeId = faFlightId.replace(/[^a-zA-Z0-9\-_]/g, '');
    return await httpGetFA(`${FA_AEROAPI_BASE}/flights/${safeId}/route`, apiKey);
  } catch (err: any) {
    return { error: err.message };
  }
});

ipcMain.handle('get-flight-track', async (_event, faFlightId) => {
  const apiKey = loadSettings().flightawareApiKey;
  if (!apiKey) return { error: 'FlightAware API key not configured' };
  try {
    const safeId = faFlightId.replace(/[^a-zA-Z0-9\-_]/g, '');
    return await httpGetFA(`${FA_AEROAPI_BASE}/flights/${safeId}/track`, apiKey);
  } catch (err: any) {
    return { error: err.message };
  }
});

ipcMain.handle('search-flights', async (_event, advQuery) => {
  const apiKey = loadSettings().flightawareApiKey;
  if (!apiKey) return { error: 'FlightAware API key not configured' };
  try {
    return await httpGetFA(`${FA_AEROAPI_BASE}/flights/search/advanced?query=${encodeURIComponent(advQuery)}`, apiKey);
  } catch (err: any) {
    return { error: err.message };
  }
});

function openHelpWindow() {
  if (helpWindow) { helpWindow.focus(); return; }
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
      preload: join(app.getAppPath(), 'build', 'src', 'help-preload.js'),
    },
  });
  helpWindow.setMenu(null);
  helpWindow.loadURL('capacitor-electron://-/help.html');
  helpWindow.once('ready-to-show', () => helpWindow?.show());
  helpWindow.on('closed', () => { helpWindow = null; });
}

function openSettingsWindow() {
  if (settingsWindow) { settingsWindow.focus(); return; }
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
      preload: join(app.getAppPath(), 'build', 'src', 'settings-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  settingsWindow.setMenu(null);
  settingsWindow.loadURL('capacitor-electron://-/settings.html');
  settingsWindow.once('ready-to-show', () => {
    settingsWindow?.webContents.executeJavaScript(
      '(() => { document.body.style.height = "auto"; document.body.style.overflow = "hidden"; return JSON.stringify({ width: document.body.scrollWidth, height: document.body.scrollHeight }); })()'
    ).then((json) => {
      if (!settingsWindow) return;
      const { width, height } = JSON.parse(json);
      settingsWindow.setContentSize(Math.max(width, 780), height);
      if (mainWindow && !mainWindow.isDestroyed()) {
        const [px, py] = mainWindow.getPosition();
        const [pw, ph] = mainWindow.getSize();
        const [sw, sh] = settingsWindow.getSize();
        settingsWindow.setPosition(Math.round(px + (pw - sw) / 2), Math.round(py + (ph - sh) / 2));
      }
      settingsWindow.show();
    }).catch(() => settingsWindow?.show());
  });
  settingsWindow.on('closed', () => { settingsWindow = null; });
}

ipcMain.handle('show-context-menu', (event, items) => {
  return new Promise((resolve) => {
    let resolved = false;
    const template = items.map((item: any) => ({
      label: item.label,
      click: () => { resolved = true; resolve(item.id); },
    }));
    const menu = Menu.buildFromTemplate(template);
    const win = BrowserWindow.fromWebContents(event.sender);
    menu.popup({ window: win ?? undefined, callback: () => { if (!resolved) resolve(null); } });
  });
});

ipcMain.handle('open-settings-window', () => {
  openSettingsWindow();
  return true;
});

ipcMain.handle('resize-settings', () => {
  if (!settingsWindow || settingsWindow.isDestroyed()) return;
  settingsWindow.webContents.executeJavaScript(
    '(() => { document.body.style.height = "auto"; document.body.style.overflow = "hidden"; return JSON.stringify({ width: document.body.scrollWidth, height: document.body.scrollHeight }); })()'
  ).then((json) => {
    if (!settingsWindow || settingsWindow.isDestroyed()) return;
    const { width, height } = JSON.parse(json);
    settingsWindow.setContentSize(Math.max(width, 780), height);
  }).catch(() => {});
});

ipcMain.handle('update-settings', (_event, settings) => {
  saveSettings(settings);
  syncNativeTheme();
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('settings-changed');
  if (helpWindow && !helpWindow.isDestroyed()) helpWindow.webContents.send('settings-changed');
  return true;
});

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
    try { unlinkSync(SETTINGS_FILE); } catch (_) {}
    cachedToken = null;
    tokenExpiresAt = 0;
    syncNativeTheme();
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('settings-changed');
    if (helpWindow && !helpWindow.isDestroyed()) helpWindow.webContents.send('settings-changed');
    return { reset: true };
  }
  return { reset: false };
});

ipcMain.on('close-settings-window', () => {
  if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.close();
});

function buildMenu() {
  const template: any[] = [
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
        { label: 'Settings...', accelerator: 'CmdOrCtrl+,', click: () => openSettingsWindow() },
      ],
    },
    { role: 'viewMenu' },
    {
      label: 'Help',
      submenu: [
        { label: 'Help Contents', accelerator: 'F1', click: () => openHelpWindow() },
        { type: 'separator' },
        {
          label: 'About 3D Flight Radar...',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'About 3D Flight Radar',
              message: '3D Flight Radar',
              detail: [
                `Version ${require(join(app.getAppPath(), 'package.json')).version}`,
                '',
                'Real-time flight tracking with data from',
                'OpenSky Network (ADS-B)',
                '',
                'Weather data from',
                'FAA Aviation Weather Center (AWC)',
                'Iowa State Mesonet (NEXRAD)',
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

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    backgroundColor: '#000000',
    title: '3D Flight Radar - FAA Scope',
    webPreferences: {
      preload: join(app.getAppPath(), 'build', 'src', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  loadApp(mainWindow);

  mainWindow.webContents.on('console-message', (_event, level, message) => {
    if (level <= 1) console.log(message);
    else console.warn(message);
  });
}

app.whenReady().then(() => {
  setupCapacitorElectronPlugins();
  syncNativeTheme();
  createWindow();
  buildMenu();
});

app.on('window-all-closed', () => app.quit());
