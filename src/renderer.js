// renderer.js - Electron-specific entry point
// Shared modules are imported by entry.js before this script.
// window.flightAPI is provided by preload.js.

// ============================================================
// Electron-specific: Settings button opens IPC settings window
// ============================================================

document.getElementById('btn-settings').addEventListener('click', () => {
  window.flightAPI.openSettings();
});

// ============================================================
// Electron-specific: React to settings changes from external window
// ============================================================

window.flightAPI.onSettingsChanged(async () => {
  try {
    await loadAndApplySettings();
  } catch (err) {
    console.warn('[Settings] Could not reload:', err);
  }
});

// ============================================================
// Start
// ============================================================

async function init() {
  // In dev mode (Vite dev server), route AWC API calls through the proxy
  // to avoid CORS. In production (file:// protocol), calls go direct.
  if (location.protocol !== 'file:') {
    CONFIG.awcProxyUrl = '/awc-api';
  }
  await loadAndApplySettings();
  applySavedView();
  startPolling();
}

init();
