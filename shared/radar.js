// Shared init helpers: settings loading, data loading, and startup.
// Loaded last — depends on all other radar-*.js modules.
// Requires window.flightAPI to be available before init() is called.

// ============================================================
// Shared Init Helpers
// ============================================================

// Load settings from the platform-specific settings API and apply them
async function loadDataJSON(path) {
  console.log(`[DataLoader] Fetching ${path}...`);
  try {
    const resp = await fetch(path);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    const size = Array.isArray(data) ? data.length : Object.keys(data).length;
    console.log(`[DataLoader] Loaded ${path} (${size} entries)`);
    return data;
  } catch (err) {
    console.warn('[DataLoader] Failed to load ' + path + ':', err);
    return null;
  }
}

async function loadAndApplySettings() {
  try {
    const saved = await window.flightAPI.getSettings();
    if (saved) {
      CONFIG.fontSize = saved.fontSize || DEFAULT_SETTINGS.fontSize;
      CONFIG.themePref = saved.theme || DEFAULT_SETTINGS.theme;
      CONFIG.darkColor = saved.darkColor || DEFAULT_SETTINGS.darkColor;
      CONFIG.lightColor = saved.lightColor || DEFAULT_SETTINGS.lightColor;
      CONFIG.colorByAltitude = saved.colorByAltitude !== undefined ? saved.colorByAltitude : DEFAULT_SETTINGS.colorByAltitude;
      CONFIG.thickTrailsByAltitude = saved.thickTrailsByAltitude || DEFAULT_SETTINGS.thickTrailsByAltitude;
      // Trail mode: new unified setting; fall back to legacy booleans
      if (saved.trailMode) {
        CONFIG.trailMode = saved.trailMode;
      } else if (saved.trailsEnabled === false) {
        CONFIG.trailMode = 'none';
      } else if (saved.showVelocityVector) {
        CONFIG.trailMode = 'velocity';
      } else {
        CONFIG.trailMode = DEFAULT_SETTINGS.trailMode;
      }
      CONFIG.trailMaxAge = saved.trailLength || DEFAULT_SETTINGS.trailLength;
      CONFIG.weatherOverlayOpacity = saved.weatherOverlayOpacity ?? DEFAULT_SETTINGS.weatherOverlayOpacity;
      CONFIG.rotationSpeed = saved.rotationSpeed || DEFAULT_SETTINGS.rotationSpeed;
      const prevEdges = CONFIG.airspaceEdges;
      CONFIG.airspaceEdges = saved.airspaceEdges !== undefined ? saved.airspaceEdges : DEFAULT_SETTINGS.airspaceEdges;
      const prev3D = CONFIG.airspace3D;
      CONFIG.airspace3D = saved.airspace3D || DEFAULT_SETTINGS.airspace3D;
      const prevSmallAirports = CONFIG.showSmallAirports;
      CONFIG.showSmallAirports = saved.showSmallAirports || DEFAULT_SETTINGS.showSmallAirports;
      CONFIG.mapLayer = saved.mapLayer || DEFAULT_SETTINGS.mapLayer;
      CONFIG.muteMapColors = saved.muteMapColors !== undefined ? saved.muteMapColors : DEFAULT_SETTINGS.muteMapColors;
      const prevNavaids = CONFIG.navaidsEnabled;
      CONFIG.navaidsEnabled = saved.navaidsEnabled || DEFAULT_SETTINGS.navaidsEnabled;
      const prevShowFixes = CONFIG.showFixes;
      CONFIG.showFixes = saved.showFixes || DEFAULT_SETTINGS.showFixes;
      CONFIG.openskyClientId = saved.openskyClientId || DEFAULT_SETTINGS.openskyClientId;
      CONFIG.openskyClientSecret = saved.openskyClientSecret || DEFAULT_SETTINGS.openskyClientSecret;
      CONFIG.aircraftEnabled = saved.aircraftEnabled !== undefined ? saved.aircraftEnabled : DEFAULT_SETTINGS.aircraftEnabled;
      CONFIG.labelsEnabled = saved.labelsEnabled !== undefined ? saved.labelsEnabled : DEFAULT_SETTINGS.labelsEnabled;
      const prevAirports = CONFIG.airportsEnabled;
      CONFIG.airportsEnabled = saved.airportsEnabled !== undefined ? saved.airportsEnabled : DEFAULT_SETTINGS.airportsEnabled;
      const prevAirspace = CONFIG.airspaceEnabled;
      CONFIG.airspaceEnabled = saved.airspaceEnabled !== undefined ? saved.airspaceEnabled : DEFAULT_SETTINGS.airspaceEnabled;
      CONFIG.radarEnabled = saved.radarEnabled || DEFAULT_SETTINGS.radarEnabled;
      CONFIG.sigmetsEnabled = saved.sigmetsEnabled || DEFAULT_SETTINGS.sigmetsEnabled;
      CONFIG.airmetsEnabled = saved.airmetsEnabled || DEFAULT_SETTINGS.airmetsEnabled;
      CONFIG.pirepsEnabled = saved.pirepsEnabled || DEFAULT_SETTINGS.pirepsEnabled;
      CONFIG.satelliteIREnabled = saved.satelliteIREnabled || DEFAULT_SETTINGS.satelliteIREnabled;
      const prevTurb3D = CONFIG.turb3D;
      CONFIG.turb3D = saved.turb3D || DEFAULT_SETTINGS.turb3D;
      const prevExAlt = CONFIG.exaggerateAltitudes;
      // Migrate old boolean setting: false → 1, true → 10
      if (saved.exaggerateAltitudes === true) {
        CONFIG.exaggerateAltitudes = 10;
      } else if (saved.exaggerateAltitudes === false || !saved.exaggerateAltitudes) {
        CONFIG.exaggerateAltitudes = DEFAULT_SETTINGS.exaggerateAltitudes;
      } else {
        CONFIG.exaggerateAltitudes = saved.exaggerateAltitudes;
      }
      // Migrate old turbulenceLevel setting to new checkbox model
      if (saved.turbForecastEnabled !== undefined) {
        CONFIG.turbForecastEnabled = saved.turbForecastEnabled;
      } else if (saved.turbulenceLevel && saved.turbulenceLevel !== 'none') {
        CONFIG.turbForecastEnabled = true;
      } else {
        CONFIG.turbForecastEnabled = DEFAULT_SETTINGS.turbForecastEnabled;
      }
      CONFIG.turbulenceLevel = CONFIG.turbForecastEnabled ? computeTurbLevel() : 'none';
      CONFIG.savedView = saved.savedView !== undefined ? saved.savedView : DEFAULT_SETTINGS.savedView;
      CONFIG.searchHistory = Array.isArray(saved.searchHistory) ? saved.searchHistory : DEFAULT_SETTINGS.searchHistory;
      await applyTheme(); // adds turb + radar layers on top if enabled
      // Apply weather overlay opacity to any existing layers
      const wxAlpha = CONFIG.weatherOverlayOpacity / 100;
      if (radarLayer) radarLayer.alpha = wxAlpha;
      if (satelliteIRLayer) satelliteIRLayer.alpha = wxAlpha;
      if (turbLayer) turbLayer.alpha = wxAlpha;
      if (!CONFIG.aircraftEnabled) toggleAircraft(false);
      // Sync main window checkboxes
      const aircraftToggle = document.getElementById('toggle-aircraft');
      if (aircraftToggle) aircraftToggle.checked = CONFIG.aircraftEnabled;
      const labelsToggle = document.getElementById('toggle-labels');
      if (labelsToggle) {
        labelsToggle.checked = CONFIG.labelsEnabled;
        labelsToggle.disabled = !CONFIG.aircraftEnabled;
      }
      const rToggle = document.getElementById('toggle-radar');
      if (rToggle) rToggle.checked = CONFIG.radarEnabled;
      // Start auto-refresh timer (applyTheme already adds the visual layer)
      if (CONFIG.radarEnabled) {
        if (radarRefreshTimer) clearInterval(radarRefreshTimer);
        radarRefreshTimer = setInterval(refreshRadar, 5 * 60 * 1000);
      }
      const irToggle = document.getElementById('toggle-satellite-ir');
      if (irToggle) irToggle.checked = CONFIG.satelliteIREnabled;
      if (CONFIG.satelliteIREnabled) {
        if (satelliteIRRefreshTimer) clearInterval(satelliteIRRefreshTimer);
        satelliteIRRefreshTimer = setInterval(refreshSatelliteIR, 10 * 60 * 1000);
      }
      // Weather hazard UI state and timers
      const sToggle = document.getElementById('toggle-sigmets');
      if (sToggle) sToggle.checked = CONFIG.sigmetsEnabled;
      const aToggle = document.getElementById('toggle-airmets');
      if (aToggle) aToggle.checked = CONFIG.airmetsEnabled;
      const pToggle = document.getElementById('toggle-pireps');
      if (pToggle) pToggle.checked = CONFIG.pirepsEnabled;
      const tToggle = document.getElementById('toggle-turb-forecast');
      if (tToggle) tToggle.checked = CONFIG.turbForecastEnabled;
      // GTG forecast: applyTheme already added the imagery layer if level !== 'none';
      // just start the refresh timer
      if (CONFIG.turbForecastEnabled) {
        if (turbRefreshTimer) clearInterval(turbRefreshTimer);
        turbRefreshTimer = setInterval(refreshTurbForecast, 15 * 60 * 1000);
      }
      // If 3D turbulence mode changed while forecast is active, rebuild layers
      if (prevTurb3D !== CONFIG.turb3D && CONFIG.turbForecastEnabled) {
        disableTurbForecast();
        enableTurbForecast();
      }
      // Individual weather hazard toggles
      if (CONFIG.sigmetsEnabled) {
        fetchSigmets();
        if (sigmetRefreshTimer) clearInterval(sigmetRefreshTimer);
        sigmetRefreshTimer = setInterval(() => {
          removeSigmetEntities();
          fetchSigmets();
        }, 5 * 60 * 1000);
      }
      if (CONFIG.airmetsEnabled) {
        fetchAirmets();
        if (airmetRefreshTimer) clearInterval(airmetRefreshTimer);
        airmetRefreshTimer = setInterval(() => {
          removeAirmetEntities();
          fetchAirmets();
        }, 5 * 60 * 1000);
      }
      if (CONFIG.pirepsEnabled) {
        fetchPireps();
        if (pirepRefreshTimer) clearInterval(pirepRefreshTimer);
        pirepRefreshTimer = setInterval(() => {
          removePirepEntities();
          fetchPireps();
        }, 5 * 60 * 1000);
      }
      const mapLayerSel = document.getElementById('map-layer');
      if (mapLayerSel) {
        const opt = mapLayerSel.querySelector(`.map-layer-option[data-value="${CONFIG.mapLayer}"]`);
        if (opt) {
          mapLayerSel.querySelectorAll('.map-layer-option').forEach(o => o.classList.remove('selected'));
          opt.classList.add('selected');
          const label = mapLayerSel.querySelector('.map-layer-label');
          if (label) label.textContent = opt.textContent;
        }
      }
      if ((prevEdges !== CONFIG.airspaceEdges || prev3D !== CONFIG.airspace3D || prevExAlt !== CONFIG.exaggerateAltitudes) && airspaceEntities.length > 0) {
        rebuildAirspace();
      }
      // Altitude exaggeration changed — rebuild 3D turb layers, PIREPs, and re-render aircraft
      if (prevExAlt !== CONFIG.exaggerateAltitudes) {
        renderAircraft();
        if (CONFIG.turbForecastEnabled && CONFIG.turb3D) {
          disableTurbForecast();
          enableTurbForecast();
        }
        updateWeatherAltitudes();
      }
      if (prevSmallAirports !== CONFIG.showSmallAirports && cachedAirportData) {
        if (CONFIG.showSmallAirports) {
          initSmallAirports(cachedAirportData);
        } else {
          removeSmallAirports();
        }
      }
      if (prevAirports !== CONFIG.airportsEnabled) {
        toggleAirports(CONFIG.airportsEnabled);
      }
      if (prevAirspace !== CONFIG.airspaceEnabled) {
        toggleAirspace(CONFIG.airspaceEnabled);
      }
      if (prevNavaids !== CONFIG.navaidsEnabled) {
        if (CONFIG.navaidsEnabled && navaidEntities.length === 0 && cachedWaypointData) {
          initNavaids();
        }
        toggleNavaids(CONFIG.navaidsEnabled);
      }
      if (prevShowFixes !== CONFIG.showFixes && cachedWaypointData) {
        if (CONFIG.showFixes) {
          initFixes();
        } else {
          removeFixes();
        }
      }
    }
  } catch (err) {
    console.warn('[Settings] Could not load:', err);
  }

  // Load data files
  const [airports, airspace, waypoints] = await Promise.all([
    loadDataJSON('../data/airports.json'),
    loadDataJSON('../data/airspace.json'),
    loadDataJSON('../data/waypoints.json'),
  ]);

  // Initialize airport markers (after theme is applied so colors are correct)
  // Note: small→medium promotion for airports inside Class B/C/D airspace is
  // handled at build time by scripts/promote-airports.js (run via npm run pull-data).
  if (airportEntities.length === 0 && airports) {
    initAirports(airports);
  }

  // Initialize airspace boundaries
  if (airspaceEntities.length === 0 && airspace) {
    initAirspace(airspace);
  }

  // Cache waypoint data (entities created on-demand when enabled)
  if (waypoints) {
    cachedWaypointData = waypoints;
    if (CONFIG.navaidsEnabled && navaidEntities.length === 0) {
      initNavaids();
    }
  }

  // Register system theme change listener (once)
  if (!loadAndApplySettings._systemThemeRegistered && window.flightAPI && window.flightAPI.onSystemThemeChanged) {
    loadAndApplySettings._systemThemeRegistered = true;
    window.flightAPI.onSystemThemeChanged(() => {
      if (CONFIG.themePref === 'system') applyTheme();
    });
  }
}

// Fly to saved view or default airport
function applySavedView() {
  if (CONFIG.savedView) {
    const sv = CONFIG.savedView;
    viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(sv.lon, sv.lat, sv.height),
      orientation: { heading: sv.heading, pitch: sv.pitch, roll: 0 },
    });
    console.log(`[FlightRadar] Starting — restored saved view (${sv.lat.toFixed(2)}, ${sv.lon.toFixed(2)})`);
  } else {
    const ap = lookupAirport('BOS');
    viewer.camera.lookAt(
      Cesium.Cartesian3.fromDegrees(ap.lon, ap.lat, 0),
      new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-30), CONFIG.startAlt)
    );
    viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
    console.log('[FlightRadar] Starting — centered on BOS (default)');
  }
}

// ============================================================
// Window exports for all top-level functions
// ============================================================
window.loadDataJSON = loadDataJSON;
window.loadAndApplySettings = loadAndApplySettings;
window.applySavedView = applySavedView;

export {}
