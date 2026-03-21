// Main entry point — imports all modules and initializes the app
// Replaces both src/renderer.js (Electron) and web/app.js (web)

import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import './styles/main.css';
import './styles/settings.css';

// Make Cesium available globally for all modules
window.Cesium = Cesium;

import { setupFlightAPI, loadSettings, saveSettings, SETTINGS_STORAGE_KEY } from './api.js';
import { CONFIG } from './config.js';
import DEFAULT_SETTINGS from './defaults.js';
import { createSettingsFormHTML, initSettingsPanel } from './settings.js';
import { loadAndApplySettings, applySavedView } from './radar/init.js';
import { startPolling } from './radar/aircraft.js';
import { pauseAllTimers, resumeAllTimers } from './radar/ui.js';

// Import radar modules for their side effects (event listeners, viewer init)
import './radar/core.js';
import './radar/weather.js';
import './radar/markers.js';
import './radar/aircraft.js';
import './radar/ui.js';
import './radar/flightplan.js';
import './radar/timeline.js';

// ============================================================
// Set up API layer
// ============================================================

setupFlightAPI();

// ============================================================
// Settings Panel (inline modal)
// ============================================================

const settingsOverlay = document.getElementById('settings-overlay');
const settingsContainer = document.getElementById('settings-container');
settingsContainer.innerHTML = createSettingsFormHTML();

// Hide OpenSky credentials in web mode (credentials handled server-side)
const credSection = settingsContainer.querySelector('#cred-drop-zone');
if (credSection) credSection.closest('.settings-section').style.display = 'none';

const settingsPanel = initSettingsPanel({
  container: settingsContainer,
  getSettings: () => window.flightAPI.getSettings(),
  onChanged: async (form) => {
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
// Help Panel
// ============================================================

const helpOverlay = document.getElementById('help-overlay');
const helpContent = document.getElementById('help-content');

async function openHelp() {
  if (!helpContent.innerHTML) {
    try {
      const resp = await fetch('/help/help-content.html');
      if (resp.ok) {
        helpContent.innerHTML = await resp.text();
      } else {
        helpContent.innerHTML = '<p>Help content could not be loaded.</p>';
      }
    } catch (err) {
      helpContent.innerHTML = '<p>Help content could not be loaded.</p>';
    }
  }
  helpOverlay.classList.add('visible');
}

function closeHelp() {
  helpOverlay.classList.remove('visible');
}

document.getElementById('help-close').addEventListener('click', closeHelp);
helpOverlay.addEventListener('click', (e) => {
  if (e.target === helpOverlay) closeHelp();
});
const helpBtn = document.getElementById('btn-help');
if (helpBtn) helpBtn.addEventListener('click', () => openHelp());

// ============================================================
// Proxy configuration
// ============================================================

// Route AWC API calls through local caching proxy to avoid CORS
CONFIG.awcProxyUrl = 'awc-proxy.php';
// Route VFRMap.com tile requests through local caching proxy to avoid CORS
CONFIG.vfrMapProxyUrl = 'vfrmap-proxy.php';

// ============================================================
// Initialize
// ============================================================

async function init() {
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
