// renderer.js - Electron-specific entry point
// Shared modules are imported by entry.js before this script.
// window.flightAPI is provided by preload.js.

// ============================================================
// Electron-specific: React to settings changes from external window
// ============================================================

window.flightAPI.onSettingsChanged(async (settings) => {
  try {
    await loadAndApplySettings(settings);
    // Re-probe FlightAware in case the user entered/changed an API key
    checkFlightAwareAvailability();
  } catch (err) {
    console.warn('[Settings] Could not reload:', err);
  }
});

// Lightweight slider previews — update CONFIG without full reload
window.flightAPI.onFontSizePreview((size) => {
  CONFIG.fontSize = size;
  updateLabelFontSize();
});
window.flightAPI.onRotationSpeedPreview((speed) => {
  CONFIG.rotationSpeed = speed;
});
window.flightAPI.onWeatherOpacityPreview((opacity) => {
  CONFIG.weatherOverlayOpacity = opacity;
  const alpha = opacity / 100;
  if (radarLayer) radarLayer.alpha = alpha;
  if (satelliteIRLayer) satelliteIRLayer.alpha = alpha;
  if (turbLayer) turbLayer.alpha = alpha;
});
window.flightAPI.onAltGainPreview((factor) => {
  CONFIG.exaggerateAltitudes = factor;
  renderAircraft();
  updateAirspaceAltitudes();
  if (CONFIG.turbForecastEnabled && CONFIG.turb3D) {
    disableTurbForecast();
    enableTurbForecast();
  }
  updateWeatherAltitudes();
});

// ============================================================
// Start
// ============================================================

// Listen for cloud settings changes from the settings window
if (window.flightAPI.onCloudSettingsChanged) {
  window.flightAPI.onCloudSettingsChanged(async () => {
    try {
      await loadAndApplySettings();
    } catch (err) {
      console.warn('[Cloud] Could not reload settings:', err);
    }
  });
}

async function init() {
  // In dev mode (Vite dev server), route AWC API calls through the proxy
  // to avoid CORS. In production (file:// protocol), calls go direct.
  if (location.protocol !== 'file:') {
    CONFIG.awcProxyUrl = '/awc-api';
    CONFIG.vfrMapProxyUrl = '/vfrmap-tiles';
  }
  // Initialize cloud sync (restores session from localStorage if exists)
  if (typeof initCloud === 'function') await initCloud();
  // If cloud-logged-in, sync credentials to local settings so the main
  // process can use them for API calls (main process reads from local file).
  if (typeof isCloudLoggedIn === 'function' && isCloudLoggedIn()) {
    try {
      const cloudSettings = await cloudLoadSettings();
      if (cloudSettings) {
        const local = await window.flightAPI.getSettings();
        let changed = false;
        for (const k of CREDENTIAL_KEYS) {
          if (cloudSettings[k] && cloudSettings[k] !== local[k]) {
            local[k] = cloudSettings[k];
            changed = true;
          }
        }
        if (changed) {
          await window.flightAPI.saveSettings(local);
          console.log('[Cloud] Synced credentials from PocketBase to local settings');
        }
      }
    } catch (err) {
      console.warn('[Cloud] Could not load credentials from PocketBase:', err.message);
    }
  }
  await loadAndApplySettings();
  applySavedView();
  // Probe FlightAware availability (hides search bar etc. if unavailable)
  checkFlightAwareAvailability();
  startPolling();
}

init();
