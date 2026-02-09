// renderer.js - Electron-specific entry point
// Shared modules (config, data, icons, radar) are loaded before this script.
// window.flightAPI is provided by preload.js.

'use strict';

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
  await loadAndApplySettings();
  applySavedView();
  startPolling();
}

init();
