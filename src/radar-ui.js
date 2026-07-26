// UI controls, HUD clock, camera change handler, rotation, and view morphing.
// Depends on radar-core.js and radar-aircraft.js.

// ============================================================
// Diagnostics
// ============================================================

window.DIAGNOSTICS = false;

// Hide diagnostic HUD fields (lat/lon/alt) when not in diagnostics mode
window.hudDiagEl = document.getElementById('hud-diagnostics');
if (hudDiagEl) hudDiagEl.style.display = DIAGNOSTICS ? '' : 'none';

// ============================================================
// HUD Clock
// ============================================================

function updateClock() {
  const now = new Date();
  const utc = now.toUTCString().slice(17, 25);
  document.getElementById('clock').textContent = `${utc}Z`;
}

function startClock() {
  if (!clockTimer) clockTimer = setInterval(updateClock, 1000);
}

function stopClock() {
  if (clockTimer) { clearInterval(clockTimer); clockTimer = null; }
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
  // Only schedule a bulk region poll when the aircraft toggle is actually on.
  // When aircraft display is off but priority/selected aircraft exist, those are
  // already polled by the tick timer via pollPriorityAircraft/pollSelectedAircraft
  // — a full region poll would fetch all aircraft in view, creating spurious trails.
  if (!CONFIG.aircraftEnabled || Date.now() < rateLimitedUntil) return;
  if (viewChangePollDebounce) clearTimeout(viewChangePollDebounce);
  // Wait at least until the rate limit window has passed
  const elapsed = lastPollTime ? Date.now() - lastPollTime.getTime() : Infinity;
  const delay = Math.max(1500, RATE_LIMIT_MS - elapsed + 500);
  viewChangePollDebounce = setTimeout(() => {
    viewChangePollDebounce = null;
    pollStates();
  }, delay);
}

viewer.camera.changed.addEventListener(() => {
  const carto = viewer.camera.positionCartographic;
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

    // Re-render aircraft only when LOD tier changes (dot ↔ arrow);
    // otherwise do a lightweight resize that only touches billboard
    // dimensions and label visibility, debounced to once per frame.
    const newIconSize = computeDisplaySize(h);
    const useDot = h > 2000000;
    if (useDot !== lastUseDot) {
      // LOD tier changed — full re-render; cancel any pending resize
      lastUseDot = useDot;
      lastIconSize = newIconSize;
      if (_zoomResizeRAF) {
        cancelAnimationFrame(_zoomResizeRAF);
        _zoomResizeRAF = null;
      }
      renderAircraft();
    } else if (newIconSize !== lastIconSize) {
      // Only display size changed — schedule lightweight resize
      lastIconSize = newIconSize;
      if (!_zoomResizeRAF) {
        _zoomResizeRAF = requestAnimationFrame(() => {
          _zoomResizeRAF = null;
          resizeAircraftIcons();
        });
      }
    }

    // Adjust poll interval only when zoom level changes significantly (>10%)
    if (lastPollHeight === null || Math.abs(h - lastPollHeight) / lastPollHeight > 0.1) {
      const newPollInterval = computePollInterval(h);
      if (newPollInterval !== CONFIG.pollInterval) {
        lastPollHeight = h;
        setPollInterval(newPollInterval);
      }
    }

    // Adjust position update interval based on zoom (smoother updates when zoomed in)
    if (lastPositionUpdateHeight === null || Math.abs(h - lastPositionUpdateHeight) / lastPositionUpdateHeight > 0.1) {
      const newPositionUpdateInterval = computePositionUpdateInterval(h);
      if (newPositionUpdateInterval !== CONFIG.positionUpdateInterval) {
        lastPositionUpdateHeight = h;
        setTickInterval(newPositionUpdateInterval);
      }
    }

    // Update label offsets when camera heading changes (skip if labels disabled and nothing selected)
    if (CONFIG.labelsEnabled || selectedIcao) {
      const camHeadingDeg = Cesium.Math.toDegrees(viewer.camera.heading);
      if (Math.abs(camHeadingDeg - _lastCameraHeading) > 0.5) {
        _lastCameraHeading = camHeadingDeg;
        if (!_labelOffsetRAF) {
          _labelOffsetRAF = requestAnimationFrame(() => {
            _labelOffsetRAF = null;
            updateLabelOffsets();
          });
        }
      }
    }

    // Poll when viewport shows area we haven't fetched yet
    const currentBounds = getViewBounds();
    if (!boundsContain(lastPollBounds, currentBounds)) {
      scheduleViewportPoll();
    }
  }
});
viewer.camera.percentageChanged = 0.01;

// ============================================================
// UI Controls
// ============================================================

document.getElementById('toggle-aircraft').addEventListener('change', async (e) => {
  toggleAircraft(e.target.checked);
  const settings = await window.flightAPI.getSettings();
  settings.aircraftEnabled = CONFIG.aircraftEnabled;
  await window.flightAPI.saveSettings(settings);
});

window.airspace3DToggle = document.getElementById('toggle-airspace-3d');
if (airspace3DToggle) {
  airspace3DToggle.addEventListener('change', (e) => {
    toggleAirspace3D(e.target.checked);
  });
}

window.radarToggle = document.getElementById('toggle-radar');
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

window.satelliteIRToggle = document.getElementById('toggle-satellite-ir');
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

window.sigmetsToggle = document.getElementById('toggle-sigmets');
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

window.airmetsToggle = document.getElementById('toggle-airmets');
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

window.pirepsToggle = document.getElementById('toggle-pireps');
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

window.turbToggle = document.getElementById('toggle-turb-forecast');
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

window.mapLayerSelect = document.getElementById('map-layer');

async function applyMapLayerValue(value) {
  CONFIG.mapLayer = value;
  const layers = viewer.imageryLayers;
  layers.removeAll();
  radarLayer = null; // cleared by removeAll
  turbLayer = null;  // cleared by removeAll
  satelliteIRLayer = null; // cleared by removeAll
  const provider = await makeMapTiles(CONFIG.mapLayer);
  // FAA chart layers have limited zoom — add CartoDB base underneath
  if (OVERLAY_LAYERS.has(CONFIG.mapLayer)) {
    layers.addImageryProvider(makeBaseTiles());
  }
  const mapLayer = layers.addImageryProvider(provider);
  styleMapLayer(mapLayer, CONFIG.mapLayer);
  // Layer order: [base] → map → satellite IR → turbulence forecast → radar
  if (CONFIG.satelliteIREnabled) {
    satelliteIRLayer = layers.addImageryProvider(makeSatelliteIRProvider());
    satelliteIRLayer.alpha = CONFIG.weatherOverlayOpacity / 100;
  }
  if (CONFIG.turbulenceLevel !== 'none' && !CONFIG.turb3D) {
    const turbProvider = await makeTurbProvider(CONFIG.turbulenceLevel);
    if (turbProvider) {
      turbLayer = layers.addImageryProvider(turbProvider);
      turbLayer.alpha = CONFIG.weatherOverlayOpacity / 100;
    }
  }
  if (CONFIG.radarEnabled) {
    radarLayer = layers.addImageryProvider(makeRadarProvider());
    radarLayer.alpha = CONFIG.weatherOverlayOpacity / 100;
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

window.trailLengthEl = document.getElementById('trail-length');
if (trailLengthEl) {
  trailLengthEl.addEventListener('input', (e) => {
    const val = parseInt(e.target.value);
    document.getElementById('trail-value').textContent = `${Math.round(val / 60)}m`;
    CONFIG.trailMaxAge = val;
  });
}

// View presets
function goHome() {
  if (CONFIG.savedView) {
    const sv = CONFIG.savedView;
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(sv.lon, sv.lat, sv.height),
      orientation: { heading: sv.heading, pitch: sv.pitch, roll: 0 },
      duration: 1.5,
    });
  } else {
    const target = Cesium.Cartesian3.fromDegrees(CONFIG.startLon, CONFIG.startLat, 0);
    viewer.camera.flyToBoundingSphere(new Cesium.BoundingSphere(target, 0), {
      offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-30), CONFIG.startAlt),
      duration: 1.5,
    });
  }
}

async function saveView() {
  const carto = viewer.camera.positionCartographic;
  const savedView = {
    lon: Cesium.Math.toDegrees(carto.longitude),
    lat: Cesium.Math.toDegrees(carto.latitude),
    height: carto.height,
    heading: viewer.camera.heading,
    pitch: viewer.camera.pitch,
  };
  const settings = await window.flightAPI.getSettings();
  settings.savedView = savedView;
  await window.flightAPI.saveSettings(settings);
  CONFIG.savedView = savedView;
}

// Context menu — right-click on Cesium canvas
viewer.canvas.addEventListener('contextmenu', e => e.preventDefault());
window.contextMenuHandler = new Cesium.ScreenSpaceEventHandler(viewer.canvas);
contextMenuHandler.setInputAction(async (click) => {
  const items = [
    { id: 'home',      label: 'Go home'   },
    { id: 'save-view', label: 'Save view' },
  ];

  // Check if right-click is on an airport entity
  let clickedAirport = null;
  const picks = viewer.scene.drillPick(click.position);
  for (const picked of picks) {
    if (Cesium.defined(picked) && picked.id && picked.id.id && picked.id.id.startsWith('apt-')) {
      const props = picked.id.properties;
      clickedAirport = {
        lat: props.lat.getValue(),
        lon: props.lon.getValue(),
        name: props.iata.getValue() || props.icao.getValue(),
      };
      break;
    }
  }
  if (clickedAirport) {
    items.push({ id: 'zoom-airport', label: `Zoom to ${clickedAirport.name}` });
  }

  const action = await window.flightAPI.showContextMenu(items, click.position.x, click.position.y);
  if (action === 'home')      goHome();
  else if (action === 'save-view') saveView();
  else if (action === 'zoom-airport' && clickedAirport) {
    const target = Cesium.Cartesian3.fromDegrees(clickedAirport.lon, clickedAirport.lat, 0);
    viewer.camera.flyToBoundingSphere(new Cesium.BoundingSphere(target, 0), {
      offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-30), 80000),
      duration: 1.5,
    });
  }
}, Cesium.ScreenSpaceEventType.RIGHT_CLICK);

// North Up — rotate earth around the camera boresight so north faces up,
// keeping the viewed ground point stationary in the center of the screen.
document.getElementById('btn-north').addEventListener('click', () => {
  // Find where the camera boresight intersects the globe
  const ray = viewer.camera.getPickRay(new Cesium.Cartesian2(
    viewer.canvas.clientWidth / 2, viewer.canvas.clientHeight / 2
  ));
  const groundPoint = viewer.scene.globe.pick(ray, viewer.scene);
  if (!groundPoint) {
    // Fallback: if no ground intersection (e.g. looking at sky), just reset heading
    viewer.camera.flyTo({
      destination: viewer.camera.positionWC,
      orientation: { heading: 0, pitch: viewer.camera.pitch, roll: 0 },
      duration: 0.5,
    });
    return;
  }

  // Compute range and pitch relative to the ground point's local frame
  const range = Cesium.Cartesian3.distance(viewer.camera.position, groundPoint);
  const direction = Cesium.Cartesian3.subtract(
    viewer.camera.position, groundPoint, new Cesium.Cartesian3()
  );
  const dirNormalized = Cesium.Cartesian3.normalize(direction, new Cesium.Cartesian3());
  const targetNormal = Cesium.Ellipsoid.WGS84.geodeticSurfaceNormal(
    groundPoint, new Cesium.Cartesian3()
  );
  const pitch = -Math.asin(Cesium.Cartesian3.dot(dirNormalized, targetNormal));

  // Animate heading to 0 (north) while orbiting around the ground point
  const startHeading = viewer.camera.heading;
  const duration = 0.5; // seconds
  const startTime = Date.now();

  // Compute shortest rotation direction
  let delta = -startHeading; // target is 0
  if (delta > Math.PI) delta -= Cesium.Math.TWO_PI;
  if (delta < -Math.PI) delta += Cesium.Math.TWO_PI;

  function animateNorth() {
    const elapsed = (Date.now() - startTime) / 1000;
    const t = Math.min(elapsed / duration, 1);
    // Smooth ease-in-out
    const ease = t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t);
    const heading = startHeading + delta * ease;
    viewer.camera.lookAt(groundPoint, new Cesium.HeadingPitchRange(heading, pitch, range));
    if (t < 1) {
      requestAnimationFrame(animateNorth);
    } else {
      // Unlock the camera transform so user can navigate freely again
      viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
    }
  }
  animateNorth();
});

// CONUS button (Electron only — absent from web HTML, so guard with null check)
window.conusBtn = document.getElementById('btn-conus');
if (conusBtn) {
  conusBtn.addEventListener('click', () => {
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(-98.5, 39.5, 4860000),
      duration: 1.5,
    });
  });
}

// 2D/3D toggle — preserve camera view across morph
function morphAndPreserveView(to3D) {
  const carto = viewer.camera.positionCartographic;
  const lon = Cesium.Math.toDegrees(carto.longitude);
  const lat = Cesium.Math.toDegrees(carto.latitude);
  const height = carto.height;

  const onComplete = () => {
    viewer.scene.morphComplete.removeEventListener(onComplete);
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(lon, lat, height),
      duration: 0,
    });
  };
  viewer.scene.morphComplete.addEventListener(onComplete);

  if (to3D) {
    viewer.scene.morphTo3D(1.0);
    is2D = false;
    document.getElementById('btn-3d').classList.add('active');
    document.getElementById('btn-2d').classList.remove('active');
    document.getElementById('toggle-rotate').disabled = false;
  } else {
    // Stop rotation when switching to 2D
    if (isRotating) {
      isRotating = false;
      stopRotation();
      document.getElementById('toggle-rotate').checked = false;
    }
    viewer.scene.morphTo2D(1.0);
    is2D = true;
    document.getElementById('btn-2d').classList.add('active');
    document.getElementById('btn-3d').classList.remove('active');
    document.getElementById('toggle-rotate').disabled = true;
  }
}

document.getElementById('btn-2d').addEventListener('click', () => {
  if (!is2D) morphAndPreserveView(false);
});

document.getElementById('btn-3d').addEventListener('click', () => {
  if (is2D) morphAndPreserveView(true);
});

// Rotate toggle — orbit camera around the ground point we're looking at
function startRotation() {
  if (rotateHandler) return;
  frozenBounds = getViewBounds();
  // Determine the ground point, pitch, and range at the moment rotation starts
  const ray = viewer.camera.getPickRay(new Cesium.Cartesian2(
    viewer.canvas.clientWidth / 2, viewer.canvas.clientHeight / 2
  ));
  const groundPoint = viewer.scene.globe.pick(ray, viewer.scene);
  if (!groundPoint) return; // can't determine ground target

  const range = Cesium.Cartesian3.distance(viewer.camera.position, groundPoint);
  // Compute pitch relative to the target's local frame (not the camera's).
  const direction = Cesium.Cartesian3.subtract(viewer.camera.position, groundPoint, new Cesium.Cartesian3());
  const dirNormalized = Cesium.Cartesian3.normalize(direction, new Cesium.Cartesian3());
  const targetNormal = Cesium.Ellipsoid.WGS84.geodeticSurfaceNormal(groundPoint, new Cesium.Cartesian3());
  const pitch = -Math.asin(Cesium.Cartesian3.dot(dirNormalized, targetNormal));
  let currentHeading = viewer.camera.heading;
  let lastTime = Date.now();

  rotateHandler = () => {
    const now = Date.now();
    const dt = (now - lastTime) / 1000;
    lastTime = now;
    const rate = Cesium.Math.toRadians(CONFIG.rotationSpeed || 6);
    currentHeading = (currentHeading + rate * dt) % Cesium.Math.TWO_PI;
    viewer.camera.lookAt(
      groundPoint,
      new Cesium.HeadingPitchRange(currentHeading, pitch, range)
    );
  };
  viewer.clock.onTick.addEventListener(rotateHandler);
}

function stopRotation() {
  if (rotateHandler) {
    viewer.clock.onTick.removeEventListener(rotateHandler);
    rotateHandler = null;
    // Unlock camera so user can freely navigate again
    viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
  }
  frozenBounds = null;
}

document.getElementById('toggle-rotate').addEventListener('change', (e) => {
  if (is2D) { e.target.checked = false; return; }
  isRotating = e.target.checked;
  if (isRotating) {
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
function isMobile() { return window.matchMedia('(max-width: 767px)').matches; }

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

  // Swipe down → collapse; swipe up → expand (mobile bottom sheet)
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

  // Swipe up → collapse; swipe down → expand (mobile)
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
    if (!is2D) morphAndPreserveView(false);
    const rotateToggle = document.getElementById('toggle-rotate');
    if (rotateToggle) { rotateToggle.disabled = true; rotateToggle.checked = false; }
  }, 500);
}

// Handle dynamic switch to mobile (e.g., browser window resize or device rotation).
window.matchMedia('(max-width: 767px)').addEventListener('change', (e) => {
  if (e.matches && !is2D) morphAndPreserveView(false);
});

// ============================================================
// Visibility-based timer pause/resume (used by web layer)
// ============================================================

function pauseAllTimers() {
  stopTick();
  pauseWeatherRefresh();
  stopClock();
  if (typeof stopLiveTimer === 'function') stopLiveTimer();
  console.log('[Visibility] All timers paused');
}

function resumeAllTimers() {
  ensureTick();
  resumeWeatherRefresh();
  startClock();
  updateClock();
  if (typeof _timelineLive !== 'undefined' && _timelineLive
      && typeof startLiveTimer === 'function') {
    startLiveTimer();
  }
  // Trigger immediate data refresh since data is stale
  if (aircraftActive()) pollStates();
  console.log('[Visibility] All timers resumed');
}

// ============================================================
// Expose top-level functions on window for cross-module access
// ============================================================
window.updateClock = updateClock;
window.startClock = startClock;
window.stopClock = stopClock;
window.boundsContain = boundsContain;
window.scheduleViewportPoll = scheduleViewportPoll;
window.applyMapLayerValue = applyMapLayerValue;
window.goHome = goHome;
window.saveView = saveView;
window.morphAndPreserveView = morphAndPreserveView;
window.startRotation = startRotation;
window.stopRotation = stopRotation;
window.isMobile = isMobile;
window.pauseAllTimers = pauseAllTimers;
window.resumeAllTimers = resumeAllTimers;

export {}

