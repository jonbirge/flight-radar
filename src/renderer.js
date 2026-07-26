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

async function init() {
  // In dev mode (Vite dev server), route AWC API calls through the proxy
  // to avoid CORS. In production (file:// protocol), calls go direct.
  if (location.protocol !== 'file:') {
    CONFIG.awcProxyUrl = '/awc-api';
    CONFIG.vfrMapProxyUrl = '/vfrmap-tiles';
  }
  await loadAndApplySettings();
  applySavedView();
  // Probe FlightAware availability (hides search bar etc. if unavailable)
  checkFlightAwareAvailability();
  startPolling();
}

init();
