// UI controls, HUD clock, camera change handler, rotation, and view morphing.
// Depends on radar core and radar aircraft modules.

import S from '../state.js';
import { RATE_LIMIT_MS } from '../state.js';
import { CONFIG, computeDisplaySize, computePollInterval, computePositionUpdateInterval } from '../config.js';
import { renderAircraft, resizeAircraftIcons, pollStates, setPollInterval, setTickInterval, toggleAircraft, getViewBounds, ensureTick, stopTick } from './aircraft.js';
import { stopTracking } from './flightplan.js';
import { enableRadar, disableRadar, enableSatelliteIR, disableSatelliteIR, enableSigmets, disableSigmets, enableAirmets, disableAirmets, enablePireps, disablePireps, enableTurbForecast, disableTurbForecast, computeTurbLevel, makeSatelliteIRProvider, makeTurbProvider, makeRadarProvider, pauseWeatherRefresh, resumeWeatherRefresh } from './weather.js';
import { makeMapTiles, makeBaseTiles, OVERLAY_LAYERS, styleMapLayer } from './core.js';
import { toggleAirspace3D } from './markers.js';
import { startLiveTimer, stopLiveTimer } from './timeline.js';

// ============================================================
// Diagnostics
// ============================================================

const DIAGNOSTICS = false;

// Hide diagnostic HUD fields (lat/lon/alt) when not in diagnostics mode
const hudDiagEl = document.getElementById('hud-diagnostics');
if (hudDiagEl) hudDiagEl.style.display = DIAGNOSTICS ? '' : 'none';

// ============================================================
// HUD Clock
// ============================================================

export function updateClock() {
  const now = new Date();
  const utc = now.toUTCString().slice(17, 25);
  document.getElementById('clock').textContent = `${utc}Z`;
}

export function startClock() {
  if (!S.clockTimer) S.clockTimer = setInterval(updateClock, 1000);
}

export function stopClock() {
  if (S.clockTimer) { clearInterval(S.clockTimer); S.clockTimer = null; }
}

startClock();
updateClock();

// ============================================================
// Camera Change Handler
// ============================================================

function boundsContain(outer, inner) {
  if (!outer || !inner) return false;
  return inner.south >= outer.south && inner.north <= outer.north
      && inner.west >= outer.west && inner.east <= outer.east;
}

function scheduleViewportPoll() {
  if (!CONFIG.aircraftEnabled || Date.now() < S.rateLimitedUntil) return;
  if (S.viewChangePollDebounce) clearTimeout(S.viewChangePollDebounce);
  // Wait at least until the rate limit window has passed
  const elapsed = S.lastPollTime ? Date.now() - S.lastPollTime.getTime() : Infinity;
  const delay = Math.max(1500, RATE_LIMIT_MS - elapsed + 500);
  S.viewChangePollDebounce = setTimeout(() => {
    S.viewChangePollDebounce = null;
    pollStates();
  }, delay);
}

S.viewer.camera.changed.addEventListener(() => {
  const carto = S.viewer.camera.positionCartographic;
  if (carto) {
    document.getElementById('center-lat').textContent =
      Cesium.Math.toDegrees(carto.latitude).toFixed(2);
    document.getElementById('center-lon').textContent =
      Cesium.Math.toDegrees(carto.longitude).toFixed(2);

    const h = carto.height;

    // Update camera altitude in HUD
    const altEl = document.getElementById('camera-alt');
    if (altEl) {
      if (h >= 1000) {
        altEl.textContent = Math.round(h / 1000).toLocaleString() + ' km';
      } else {
        altEl.textContent = Math.round(h) + ' m';
      }
    }

    // Re-render aircraft only when LOD tier changes (dot <-> arrow);
    // otherwise do a lightweight resize that only touches billboard
    // dimensions and label visibility, debounced to once per frame.
    const newIconSize = computeDisplaySize(h);
    const useDot = h > 2000000;
    if (useDot !== S.lastUseDot) {
      // LOD tier changed — full re-render; cancel any pending resize
      S.lastUseDot = useDot;
      S.lastIconSize = newIconSize;
      if (S._zoomResizeRAF) {
        cancelAnimationFrame(S._zoomResizeRAF);
        S._zoomResizeRAF = null;
      }
      renderAircraft();
    } else if (newIconSize !== S.lastIconSize) {
      // Only display size changed — schedule lightweight resize
      S.lastIconSize = newIconSize;
      if (!S._zoomResizeRAF) {
        S._zoomResizeRAF = requestAnimationFrame(() => {
          S._zoomResizeRAF = null;
          resizeAircraftIcons();
        });
      }
    }

    // Adjust poll interval only when zoom level changes significantly (>10%)
    if (S.lastPollHeight === null || Math.abs(h - S.lastPollHeight) / S.lastPollHeight > 0.1) {
      const newPollInterval = computePollInterval(h);
      if (newPollInterval !== CONFIG.pollInterval) {
        S.lastPollHeight = h;
        setPollInterval(newPollInterval);
      }
    }

    // Adjust position update interval based on zoom (smoother updates when zoomed in)
    if (S.lastPositionUpdateHeight === null || Math.abs(h - S.lastPositionUpdateHeight) / S.lastPositionUpdateHeight > 0.1) {
      const newPositionUpdateInterval = computePositionUpdateInterval(h);
      if (newPositionUpdateInterval !== CONFIG.positionUpdateInterval) {
        S.lastPositionUpdateHeight = h;
        setTickInterval(newPositionUpdateInterval);
      }
    }

    // Poll when viewport shows area we haven't fetched yet
    const currentBounds = getViewBounds();
    if (!boundsContain(S.lastPollBounds, currentBounds)) {
      scheduleViewportPoll();
    }
  }
});
S.viewer.camera.percentageChanged = 0.01;

// ============================================================
// UI Controls
// ============================================================

document.getElementById('toggle-aircraft').addEventListener('change', async (e) => {
  toggleAircraft(e.target.checked);
  const settings = await window.flightAPI.getSettings();
  settings.aircraftEnabled = CONFIG.aircraftEnabled;
  await window.flightAPI.saveSettings(settings);
});

const airspace3DToggle = document.getElementById('toggle-airspace-3d');
if (airspace3DToggle) {
  airspace3DToggle.addEventListener('change', (e) => {
    toggleAirspace3D(e.target.checked);
  });
}

const radarToggle = document.getElementById('toggle-radar');
if (radarToggle) {
  radarToggle.addEventListener('change', async (e) => {
    if (e.target.checked) {
      enableRadar();
    } else {
      disableRadar();
    }
    const settings = await window.flightAPI.getSettings();
    settings.radarEnabled = CONFIG.radarEnabled;
    await window.flightAPI.saveSettings(settings);
  });
}

const satelliteIRToggle = document.getElementById('toggle-satellite-ir');
if (satelliteIRToggle) {
  satelliteIRToggle.addEventListener('change', async (e) => {
    if (e.target.checked) {
      enableSatelliteIR();
    } else {
      disableSatelliteIR();
    }
    const settings = await window.flightAPI.getSettings();
    settings.satelliteIREnabled = CONFIG.satelliteIREnabled;
    await window.flightAPI.saveSettings(settings);
  });
}

const sigmetsToggle = document.getElementById('toggle-sigmets');
if (sigmetsToggle) {
  sigmetsToggle.addEventListener('change', async (e) => {
    if (e.target.checked) {
      enableSigmets();
    } else {
      disableSigmets();
    }
    const settings = await window.flightAPI.getSettings();
    settings.sigmetsEnabled = CONFIG.sigmetsEnabled;
    await window.flightAPI.saveSettings(settings);
  });
}

const airmetsToggle = document.getElementById('toggle-airmets');
if (airmetsToggle) {
  airmetsToggle.addEventListener('change', async (e) => {
    if (e.target.checked) {
      enableAirmets();
    } else {
      disableAirmets();
    }
    const settings = await window.flightAPI.getSettings();
    settings.airmetsEnabled = CONFIG.airmetsEnabled;
    await window.flightAPI.saveSettings(settings);
  });
}

const pirepsToggle = document.getElementById('toggle-pireps');
if (pirepsToggle) {
  pirepsToggle.addEventListener('change', async (e) => {
    if (e.target.checked) {
      enablePireps();
    } else {
      disablePireps();
    }
    const settings = await window.flightAPI.getSettings();
    settings.pirepsEnabled = CONFIG.pirepsEnabled;
    await window.flightAPI.saveSettings(settings);
  });
}

const turbToggle = document.getElementById('toggle-turb-forecast');
if (turbToggle) {
  turbToggle.addEventListener('change', async (e) => {
    CONFIG.turbForecastEnabled = e.target.checked;
    if (e.target.checked) {
      CONFIG.turbulenceLevel = computeTurbLevel();
      disableTurbForecast();
      enableTurbForecast();
    } else {
      CONFIG.turbulenceLevel = 'none';
      disableTurbForecast();
    }
    const settings = await window.flightAPI.getSettings();
    settings.turbForecastEnabled = CONFIG.turbForecastEnabled;
    await window.flightAPI.saveSettings(settings);
  });
}

document.getElementById('toggle-labels').addEventListener('change', async (e) => {
  CONFIG.labelsEnabled = e.target.checked;
  renderAircraft();
  const settings = await window.flightAPI.getSettings();
  settings.labelsEnabled = CONFIG.labelsEnabled;
  await window.flightAPI.saveSettings(settings);
});

const mapLayerSelect = document.getElementById('map-layer');

export async function applyMapLayerValue(value) {
  CONFIG.mapLayer = value;
  const layers = S.viewer.imageryLayers;
  layers.removeAll();
  S.radarLayer = null; // cleared by removeAll
  S.turbLayer = null;  // cleared by removeAll
  S.satelliteIRLayer = null; // cleared by removeAll
  const provider = await makeMapTiles(CONFIG.mapLayer);
  // FAA chart layers have limited zoom — add CartoDB base underneath
  if (OVERLAY_LAYERS.has(CONFIG.mapLayer)) {
    layers.addImageryProvider(makeBaseTiles());
  }
  const mapLayer = layers.addImageryProvider(provider);
  styleMapLayer(mapLayer, CONFIG.mapLayer);
  // Layer order: [base] -> map -> satellite IR -> turbulence forecast -> radar
  if (CONFIG.satelliteIREnabled) {
    S.satelliteIRLayer = layers.addImageryProvider(makeSatelliteIRProvider());
    S.satelliteIRLayer.alpha = CONFIG.weatherOverlayOpacity / 100;
  }
  if (CONFIG.turbulenceLevel !== 'none' && !CONFIG.turb3D) {
    const turbProvider = await makeTurbProvider(CONFIG.turbulenceLevel);
    if (turbProvider) {
      S.turbLayer = layers.addImageryProvider(turbProvider);
      S.turbLayer.alpha = CONFIG.weatherOverlayOpacity / 100;
    }
  }
  if (CONFIG.radarEnabled) {
    S.radarLayer = layers.addImageryProvider(makeRadarProvider());
    S.radarLayer.alpha = CONFIG.weatherOverlayOpacity / 100;
  }
  // Persist the selection
  const settings = await window.flightAPI.getSettings();
  settings.mapLayer = CONFIG.mapLayer;
  await window.flightAPI.saveSettings(settings);
}

// Toggle dropdown open/closed
mapLayerSelect.querySelector('.map-layer-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  mapLayerSelect.classList.toggle('open');
});

// Close when clicking outside
document.addEventListener('click', () => mapLayerSelect.classList.remove('open'));

// Option selection
mapLayerSelect.querySelectorAll('.map-layer-option').forEach(opt => {
  opt.addEventListener('click', async () => {
    mapLayerSelect.classList.remove('open');
    mapLayerSelect.querySelectorAll('.map-layer-option').forEach(o => o.classList.remove('selected'));
    opt.classList.add('selected');
    mapLayerSelect.querySelector('.map-layer-label').textContent = opt.textContent;
    await applyMapLayerValue(opt.dataset.value);
  });
});

const trailLengthEl = document.getElementById('trail-length');
if (trailLengthEl) {
  trailLengthEl.addEventListener('input', (e) => {
    const val = parseInt(e.target.value);
    document.getElementById('trail-value').textContent = `${Math.round(val / 60)}m`;
    CONFIG.trailMaxAge = val;
  });
}

// View presets
export function goHome() {
  if (CONFIG.savedView) {
    const sv = CONFIG.savedView;
    S.viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(sv.lon, sv.lat, sv.height),
      orientation: { heading: sv.heading, pitch: sv.pitch, roll: 0 },
      duration: 1.5,
    });
  } else {
    const target = Cesium.Cartesian3.fromDegrees(CONFIG.startLon, CONFIG.startLat, 0);
    S.viewer.camera.flyToBoundingSphere(new Cesium.BoundingSphere(target, 0), {
      offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-30), CONFIG.startAlt),
      duration: 1.5,
    });
  }
}

export async function saveView() {
  const carto = S.viewer.camera.positionCartographic;
  const savedView = {
    lon: Cesium.Math.toDegrees(carto.longitude),
    lat: Cesium.Math.toDegrees(carto.latitude),
    height: carto.height,
    heading: S.viewer.camera.heading,
    pitch: S.viewer.camera.pitch,
  };
  const settings = await window.flightAPI.getSettings();
  settings.savedView = savedView;
  await window.flightAPI.saveSettings(settings);
  CONFIG.savedView = savedView;
}

// Context menu — right-click on Cesium canvas
S.viewer.canvas.addEventListener('contextmenu', e => e.preventDefault());
const contextMenuHandler = new Cesium.ScreenSpaceEventHandler(S.viewer.canvas);
contextMenuHandler.setInputAction(async (click) => {
  const action = await window.flightAPI.showContextMenu([
    { id: 'home',      label: 'Go home'   },
    { id: 'save-view', label: 'Save view' },
  ], click.position.x, click.position.y);
  if (action === 'home')      goHome();
  else if (action === 'save-view') saveView();
}, Cesium.ScreenSpaceEventType.RIGHT_CLICK);

// North Up — rotate heading to 0 while keeping current position and pitch
document.getElementById('btn-north').addEventListener('click', () => {
  S.viewer.camera.flyTo({
    destination: S.viewer.camera.positionWC,
    orientation: { heading: 0, pitch: S.viewer.camera.pitch, roll: 0 },
    duration: 0.5,
  });
});

// CONUS button (Electron only — absent from web HTML, so guard with null check)
const conusBtn = document.getElementById('btn-conus');
if (conusBtn) {
  conusBtn.addEventListener('click', () => {
    S.viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(-98.5, 39.5, 4860000),
      duration: 1.5,
    });
  });
}

// 2D/3D toggle — preserve camera view across morph
export function morphAndPreserveView(to3D) {
  const carto = S.viewer.camera.positionCartographic;
  const lon = Cesium.Math.toDegrees(carto.longitude);
  const lat = Cesium.Math.toDegrees(carto.latitude);
  const height = carto.height;

  const onComplete = () => {
    S.viewer.scene.morphComplete.removeEventListener(onComplete);
    S.viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(lon, lat, height),
      duration: 0,
    });
  };
  S.viewer.scene.morphComplete.addEventListener(onComplete);

  if (to3D) {
    S.viewer.scene.morphTo3D(1.0);
    S.is2D = false;
    document.getElementById('btn-3d').classList.add('active');
    document.getElementById('btn-2d').classList.remove('active');
    document.getElementById('toggle-rotate').disabled = false;
  } else {
    // Stop rotation when switching to 2D
    if (S.isRotating) {
      S.isRotating = false;
      stopRotation();
      document.getElementById('toggle-rotate').checked = false;
    }
    S.viewer.scene.morphTo2D(1.0);
    S.is2D = true;
    document.getElementById('btn-2d').classList.add('active');
    document.getElementById('btn-3d').classList.remove('active');
    document.getElementById('toggle-rotate').disabled = true;
  }
}

document.getElementById('btn-2d').addEventListener('click', () => {
  if (!S.is2D) morphAndPreserveView(false);
});

document.getElementById('btn-3d').addEventListener('click', () => {
  if (S.is2D) morphAndPreserveView(true);
});

// Rotate toggle — orbit camera around the ground point we're looking at
export function startRotation() {
  if (S.rotateHandler) return;
  S.frozenBounds = getViewBounds();
  // Determine the ground point, pitch, and range at the moment rotation starts
  const ray = S.viewer.camera.getPickRay(new Cesium.Cartesian2(
    S.viewer.canvas.clientWidth / 2, S.viewer.canvas.clientHeight / 2
  ));
  const groundPoint = S.viewer.scene.globe.pick(ray, S.viewer.scene);
  if (!groundPoint) return; // can't determine ground target

  const range = Cesium.Cartesian3.distance(S.viewer.camera.position, groundPoint);
  // Compute pitch relative to the target's local frame (not the camera's).
  const direction = Cesium.Cartesian3.subtract(S.viewer.camera.position, groundPoint, new Cesium.Cartesian3());
  const dirNormalized = Cesium.Cartesian3.normalize(direction, new Cesium.Cartesian3());
  const targetNormal = Cesium.Ellipsoid.WGS84.geodeticSurfaceNormal(groundPoint, new Cesium.Cartesian3());
  const pitch = -Math.asin(Cesium.Cartesian3.dot(dirNormalized, targetNormal));
  let currentHeading = S.viewer.camera.heading;
  let lastTime = Date.now();

  S.rotateHandler = () => {
    const now = Date.now();
    const dt = (now - lastTime) / 1000;
    lastTime = now;
    const rate = Cesium.Math.toRadians(CONFIG.rotationSpeed || 6);
    currentHeading = (currentHeading + rate * dt) % Cesium.Math.TWO_PI;
    S.viewer.camera.lookAt(
      groundPoint,
      new Cesium.HeadingPitchRange(currentHeading, pitch, range)
    );
  };
  S.viewer.clock.onTick.addEventListener(S.rotateHandler);
}

export function stopRotation() {
  if (S.rotateHandler) {
    S.viewer.clock.onTick.removeEventListener(S.rotateHandler);
    S.rotateHandler = null;
    // Unlock camera so user can freely navigate again
    S.viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
  }
  S.frozenBounds = null;
}

document.getElementById('toggle-rotate').addEventListener('change', (e) => {
  if (S.is2D) { e.target.checked = false; return; }
  S.isRotating = e.target.checked;
  if (S.isRotating) {
    stopTracking();
    startRotation();
  } else {
    stopRotation();
  }
});

// ============================================================
// Collapsible Panels
// ============================================================

// Helper: are we in mobile layout?
export function isMobile() { return window.matchMedia('(max-width: 767px)').matches; }

// Controls panel — sheet-handle toggles collapse on both desktop and mobile.
// Desktop: slides the controls panel left.  Mobile: slides the bottom sheet down.
(function () {
  const controls = document.getElementById('controls');
  const sheet = document.getElementById('bottom-sheet');
  const handle = controls && controls.querySelector('.sheet-handle');
  if (handle) {
    handle.addEventListener('click', () => {
      if (isMobile() && sheet) sheet.classList.toggle('collapsed');
      else if (controls) controls.classList.toggle('collapsed');
    });
  }

  // Swipe down -> collapse; swipe up -> expand (mobile bottom sheet)
  if (sheet) {
    let _sy = 0, _sx = 0;
    sheet.addEventListener('touchstart', (e) => {
      _sy = e.touches[0].clientY;
      _sx = e.touches[0].clientX;
    }, { passive: true });
    sheet.addEventListener('touchend', (e) => {
      if (!isMobile()) return;
      const dy = e.changedTouches[0].clientY - _sy;
      const dx = e.changedTouches[0].clientX - _sx;
      if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 50) {
        if (dy > 0) sheet.classList.add('collapsed');
        else sheet.classList.remove('collapsed');
      }
    }, { passive: true });
  }
}());

// Aircraft info panel — sheet-handle toggles collapse on both desktop and mobile.
// Desktop: collapses content via max-height.  Mobile: slides the panel up.
(function () {
  const infoEl = document.getElementById('aircraft-info');
  if (!infoEl) return;

  const handle = infoEl.querySelector('.sheet-handle');
  if (handle) {
    handle.addEventListener('click', () => {
      if (isMobile()) infoEl.classList.toggle('mob-collapsed');
      else infoEl.classList.toggle('collapsed');
    });
  }

  // Swipe up -> collapse; swipe down -> expand (mobile)
  let _sy = 0, _sx = 0;
  infoEl.addEventListener('touchstart', (e) => {
    _sy = e.touches[0].clientY;
    _sx = e.touches[0].clientX;
  }, { passive: true });
  infoEl.addEventListener('touchend', (e) => {
    if (!isMobile()) return;
    const dy = e.changedTouches[0].clientY - _sy;
    const dx = e.changedTouches[0].clientX - _sx;
    if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 50) {
      if (dy < 0) infoEl.classList.add('mob-collapsed');
      else infoEl.classList.remove('mob-collapsed');
    }
  }, { passive: true });
}());

// On mobile: force 2D mode, disable rotation controls, and start with panels stowed.
if (isMobile()) {
  // Collapse the bottom sheet immediately (before user interaction)
  const bottomSheet = document.getElementById('bottom-sheet');
  if (bottomSheet) bottomSheet.classList.add('collapsed');
  setTimeout(() => {
    if (!S.is2D) morphAndPreserveView(false);
    const rotateToggle = document.getElementById('toggle-rotate');
    if (rotateToggle) { rotateToggle.disabled = true; rotateToggle.checked = false; }
  }, 500);
}

// Handle dynamic switch to mobile (e.g., browser window resize or device rotation).
window.matchMedia('(max-width: 767px)').addEventListener('change', (e) => {
  if (e.matches && !S.is2D) morphAndPreserveView(false);
});

// ============================================================
// Visibility-based timer pause/resume (used by web layer)
// ============================================================

export function pauseAllTimers() {
  stopTick();
  pauseWeatherRefresh();
  stopClock();
  stopLiveTimer();
  console.log('[Visibility] All timers paused');
}

export function resumeAllTimers() {
  ensureTick();
  resumeWeatherRefresh();
  startClock();
  updateClock();
  // startLiveTimer is safe to call unconditionally; the live timer's
  // tick callback checks _timelineLive internally and no-ops if scrubbing.
  startLiveTimer();
  // Trigger immediate data refresh since data is stale
  if (CONFIG.aircraftEnabled) pollStates();
  console.log('[Visibility] All timers resumed');
}
