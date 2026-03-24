// Aircraft entity management: rendering, trails, extrapolation, polling.
// Depends on radar-core.js (viewer, CONFIG, state variables).

// Returns true when aircraft polling/rendering should be active — either the
// Aircraft toggle is on, or an airport filter is showing filtered flights.
function aircraftActive() {
  return CONFIG.aircraftEnabled || !!airportFilterCallsigns;
}

// ==== Entity Cleanup & Toggling ============================================

// Destroy and re-create all aircraft entities to pick up new theme
function removeTrailEntities(ac) {
  for (const e of ac.trailEntities) viewer.entities.remove(e);
  ac.trailEntities = [];
  ac._trailHash = '';
  if (ac.extrapolationTrail) {
    viewer.entities.remove(ac.extrapolationTrail);
    ac.extrapolationTrail = null;
  }
}

function refreshAllEntities() {
  viewer.entities.suspendEvents();
  try {
    for (const [icao, ac] of aircraft) {
      if (ac.entity) { viewer.entities.remove(ac.entity); ac.entity = null; }
      ac._iconKey = '';
      ac._labelText = '';
      removeTrailEntities(ac);
    }
  } finally {
    viewer.entities.resumeEvents();
  }
  renderAircraft();
}

function toggleAircraft(show) {
  CONFIG.aircraftEnabled = show;
  if (!show) {
    // If an airport filter is active, keep polling for filtered flights —
    // just hide non-matching aircraft instead of wiping everything.
    if (airportFilterCallsigns) {
      applyAirportFilter();
      return;
    }

    // Cancel any in-progress chunked render so it doesn't create orphaned entities
    _renderGeneration++;

    // Reset poll guard so the next enable doesn't hang waiting for a stale lock
    _pollInFlight = false;

    // Determine which aircraft to keep: any selected or searched aircraft
    const keepIcao = selectedIcao || searchedIcao;

    // Remove all aircraft entities and trails from Cesium, but preserve
    // the selected/searched flight so it stays visible regardless of toggle
    viewer.entities.suspendEvents();
    try {
      for (const [icao, ac] of aircraft) {
        if (icao === keepIcao) continue;
        if (ac.entity) { viewer.entities.remove(ac.entity); ac.entity = null; }
        removeTrailEntities(ac);
      }
    } finally {
      viewer.entities.resumeEvents();
    }
    // Remove all except the kept aircraft from the Map
    for (const icao of [...aircraft.keys()]) {
      if (icao !== keepIcao) aircraft.delete(icao);
    }
    if (!keepIcao) hideAircraftInfo();
    document.getElementById('track-count').textContent = keepIcao ? '1' : '0';
    if (viewChangePollDebounce) { clearTimeout(viewChangePollDebounce); viewChangePollDebounce = null; }
    // Keep tick running for the selected aircraft, or stop everything
    if (keepIcao) {
      ensureTick();
    } else {
      stopTick();
    }
  } else {
    // Reset all poll guards and timestamps for a clean restart.
    // Any in-flight poll from the "selected only" period will complete
    // harmlessly in its finally block.
    _pollInFlight = false;
    _selectedPollInFlight = false;
    _lastBulkPollMs = 0;
    _lastSelectedPollApiMs = 0;
    lastSelectedPollMs = 0;
    // Suspend → resume: fully stop the tick timer (which may have been
    // running for selected-aircraft-only polling) so startPolling() can
    // do a clean restart with the correct interval and initial fetch.
    stopTick();
    startPolling();
  }
  const labelsToggle = document.getElementById('toggle-labels');
  if (labelsToggle) labelsToggle.disabled = !show;
}

// ==== Poll Interval Management =============================================

function setPollInterval(ms) {
  CONFIG.pollInterval = ms;
}

function setTickInterval(ms) {
  CONFIG.positionUpdateInterval = ms;
  if (!tickTimer) return;
  clearInterval(tickTimer);
  tickTimer = setInterval(tick, ms);
}

// Poll a small region around the selected aircraft's position, independent
// of the viewport.  Keeps the selected aircraft live with up-to-date data
// and full track history regardless of display toggle or camera position.
async function pollSelectedAircraft() {
  if (_selectedPollInFlight) return;
  if (!selectedIcao) return;
  const ac = aircraft.get(selectedIcao);
  if (!ac) return;
  const now = Date.now();
  if (now - _lastSelectedPollApiMs < RATE_LIMIT_MS) return;
  _selectedPollInFlight = true;
  _lastSelectedPollApiMs = now;
  const s = ac.state;
  const pad = 1;
  const bounds = {
    south: s.lat - pad, north: s.lat + pad,
    west: s.lon - pad, east: s.lon + pad,
  };
  try {
    console.log(`[Poll] Selected aircraft poll for ${selectedIcao}...`);
    const t0 = Date.now();
    const data = await window.flightAPI.getStates(bounds, 'selected');
    console.log(`[Poll] Selected poll IPC returned in ${Date.now() - t0}ms`);
    if (data.error) {
      if (data.retryIn) {
        // Main process rate limited us — allow retry after the specified delay
        _lastSelectedPollApiMs = Date.now() - RATE_LIMIT_MS + data.retryIn;
        console.log(`[Poll] Selected poll rate limited, retryIn=${data.retryIn}ms`);
      } else {
        console.warn('[Poll] Selected poll error:', data.error);
      }
    }
    if (!data.error && data.states) {
      const now = Date.now() / 1000;
      for (const raw of data.states) {
        const ns = parseState(raw);
        if (ns.icao24 !== selectedIcao) continue;
        if (ns.lon == null || ns.lat == null) continue;
        ac.state = ns;
        ac.lastServerUpdate = now;
        ac.extrapolatedPos = computeExtrapolatedPosition(ns, ns.timePosition || now, now);
        const alt = ns.altitude != null ? ns.altitude : (ac.lastKnownAlt || 0);
        if (ns.altitude != null) ac.lastKnownAlt = ns.altitude;
        const last = ac.history.length > 0 ? ac.history[ac.history.length - 1] : null;
        const moved = !last
          || Math.abs(ns.lon - last.lon) > 0.0005
          || Math.abs(ns.lat - last.lat) > 0.0005
          || Math.abs(alt - last.alt) > 30;
        if (moved) ac.history.push({ lon: ns.lon, lat: ns.lat, alt, time: now });
        const currentPos = ac.extrapolatedPos || Cesium.Cartesian3.fromDegrees(ns.lon, ns.lat, exAlt(alt));
        updateExtrapolationTrail(selectedIcao, ac, currentPos);
        break;
      }
      renderAircraft(new Set([selectedIcao]));
      showAircraftInfo(selectedIcao);
      updateLiveAltitudeFilter();
    }
  } catch (err) {
    console.warn('[Poll] Selected aircraft poll error:', err);
  } finally {
    _selectedPollInFlight = false;
  }
}

// Unified tick: extrapolate positions, check if any polls or track fetches are due.
function tick() {
  const now = Date.now();

  // 1. Always extrapolate aircraft positions between server polls
  extrapolatePositions();

  // Safety valve: force-reset in-flight guards if they've been stuck too long
  // (covers cases where the IPC call hangs or the Promise never resolves)
  if (_pollInFlight && now - _lastBulkPollMs > 30000) {
    console.warn('[Poll] Force-resetting _pollInFlight (stuck >30s)');
    _pollInFlight = false;
  }
  if (_selectedPollInFlight && now - _lastSelectedPollApiMs > 30000) {
    console.warn('[Poll] Force-resetting _selectedPollInFlight (stuck >30s)');
    _selectedPollInFlight = false;
  }

  // Skip all OpenSky polling while rate-limited
  if (now < rateLimitedUntil) {
    return;
  }

  // 2. Bulk poll when aircraft display is on (or airport filter active) and poll interval has elapsed
  if (aircraftActive()) {
    const elapsed = lastPollTime ? now - lastPollTime.getTime() : Infinity;
    if (elapsed >= CONFIG.pollInterval) {
      pollStates();
    }
  }

  // 3. Selected aircraft poll — always, regardless of display toggle or viewport.
  //    Skip if the most recent bulk poll already covered this aircraft's position.
  if (selectedIcao && now - lastSelectedPollMs >= SELECTED_POLL_INTERVAL) {
    lastSelectedPollMs = now;
    const ac = aircraft.get(selectedIcao);
    const coveredByBulk = aircraftActive() && ac && lastPollBounds
      && ac.state.lat >= lastPollBounds.south && ac.state.lat <= lastPollBounds.north
      && ac.state.lon >= lastPollBounds.west && ac.state.lon <= lastPollBounds.east;
    if (!coveredByBulk) {
      pollSelectedAircraft();
    }
  }

  // 4. Track queue processing
  if (trackFetchQueue.length > 0 && now - lastTrackFetchMs >= TRACK_FETCH_INTERVAL) {
    lastTrackFetchMs = now;
    fetchNextTrack();
  }
}

// Start the unified tick timer if it isn't already running.
function ensureTick() {
  if (tickTimer) return;
  const camHeight = viewer.camera.positionCartographic
    ? viewer.camera.positionCartographic.height
    : CONFIG.startAlt;
  const ms = computePositionUpdateInterval(camHeight);
  CONFIG.positionUpdateInterval = ms;
  tickTimer = setInterval(tick, ms);
}

function stopTick() {
  if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
}

// ==== View Bounds Computation ==============================================

function getViewBounds() {
  // computeViewRectangle doesn't work in 2D mode (returns undefined).
  // Use pickEllipsoid on screen corners as a reliable fallback.
  const rect = viewer.camera.computeViewRectangle();
  if (!rect) {
    const canvas = viewer.scene.canvas;
    const topLeft = viewer.camera.pickEllipsoid(
      new Cesium.Cartesian2(0, 0), Cesium.Ellipsoid.WGS84
    );
    const bottomRight = viewer.camera.pickEllipsoid(
      new Cesium.Cartesian2(canvas.clientWidth, canvas.clientHeight), Cesium.Ellipsoid.WGS84
    );
    if (topLeft && bottomRight) {
      const tl = Cesium.Cartographic.fromCartesian(topLeft);
      const br = Cesium.Cartographic.fromCartesian(bottomRight);
      const deg = Cesium.Math.toDegrees;
      return {
        south: Math.max(deg(br.latitude), -90),
        west: Math.max(deg(tl.longitude), -180),
        north: Math.min(deg(tl.latitude), 90),
        east: Math.min(deg(br.longitude), 180),
      };
    }
    // Final fallback: CONUS area
    return { south: 24, west: -125, north: 50, east: -66 };
  }
  const deg = Cesium.Math.toDegrees;
  const bounds = {
    south: Math.max(deg(rect.south), -90),
    west: Math.max(deg(rect.west), -180),
    north: Math.min(deg(rect.north), 90),
    east: Math.min(deg(rect.east), 180),
  };
  // When zoomed out far enough that the viewport spans more than 180° of
  // longitude (or nearly pole-to-pole in latitude), the bounding box wraps
  // past the visible hemisphere and causes the API to return flights from
  // the far side of the globe.  Fall back to CONUS in that case.
  const lonSpan = bounds.east - bounds.west;
  const latSpan = bounds.north - bounds.south;
  if (lonSpan > 180 || latSpan > 140) {
    return { south: 24, west: -125, north: 50, east: -66 };
  }
  return bounds;
}

// ==== Aircraft Entity Management ===========================================

function updateAircraft(states) {
  const now = Date.now() / 1000;
  const seen = new Set();

  // Batch all entity changes (trail updates, stale removal) into a single scene update
  viewer.entities.suspendEvents();
  try {
    for (const raw of states) {
      const s = parseState(raw);
      if (s.lon == null || s.lat == null) continue;
      if (s.onGround) continue; // skip ground traffic for cleaner display

      seen.add(s.icao24);
      let ac = aircraft.get(s.icao24);

      if (!ac) {
        // New aircraft — create entity
        ac = {
          state: s,
          entity: null,
          trailEntities: [],
          extrapolationTrail: null, // temporary trail from last history point to extrapolated position
          history: [],         // accumulated from polling
          granularTrack: null,  // from /tracks API
          lastTrackFetch: 0,
          lastKnownAlt: s.altitude || 0,
          lastServerUpdate: now, // timestamp of last server data (for position extrapolation)
          extrapolatedPos: null, // current extrapolated position (for computing deltas)
          _trailHash: '',      // trail content fingerprint for dirty tracking
          _iconKey: '',        // billboard image fingerprint to skip redundant texture sets
          _labelText: '',      // label text fingerprint to skip redundant updates
        };
        aircraft.set(s.icao24, ac);
      }

      // Update state
      ac.state = s;
      ac.lastServerUpdate = now;
      // Immediately extrapolate to current time so renderAircraft() places the entity at
      // the correct position, not the stale TIME_POS position (which would cause a visible
      // snap-back followed by a forward jump on the next extrapolation tick).
      ac.extrapolatedPos = computeExtrapolatedPosition(s, s.timePosition || now, now);

      // Append to history — skip if position hasn't moved meaningfully
      const alt = s.altitude != null ? s.altitude : (ac.lastKnownAlt || 0);
      if (s.altitude != null) ac.lastKnownAlt = s.altitude;
      const last = ac.history.length > 0 ? ac.history[ac.history.length - 1] : null;
      const moved = !last
        || Math.abs(s.lon - last.lon) > 0.0005
        || Math.abs(s.lat - last.lat) > 0.0005
        || Math.abs(alt - last.alt) > 30;
      if (moved) {
        ac.history.push({ lon: s.lon, lat: s.lat, alt, time: now });
      }

      // Connect last history point to current position (extrapolated or raw server)
      const currentPos = ac.extrapolatedPos || Cesium.Cartesian3.fromDegrees(s.lon, s.lat, exAlt(alt));
      updateExtrapolationTrail(s.icao24, ac, currentPos);

      // Trim old history (keep all history for selected aircraft)
      if (s.icao24 !== selectedIcao) {
        ac.history = ac.history.filter(p => now - p.time < CONFIG.trailMaxAge);
      }

      // Clear granular track if all its points have aged out (skip for selected)
      if (s.icao24 !== selectedIcao && ac.granularTrack && ac.granularTrack.path) {
        const minTime = now - CONFIG.trailMaxAge;
        const hasValid = ac.granularTrack.path.some(wp => wp[0] >= minTime);
        if (!hasValid) ac.granularTrack = null;
      }

    }

    // Remove stale aircraft (but never remove the selected or searched flight)
    for (const [icao, ac] of aircraft) {
      if (!seen.has(icao) && icao !== searchedIcao && icao !== selectedIcao) {
        const age = now - (ac.state.lastContact || 0);
        if (age > CONFIG.staleThreshold) {
          if (ac.entity) viewer.entities.remove(ac.entity);
          removeTrailEntities(ac);
          aircraft.delete(icao);
        }
      }
    }
  } finally {
    viewer.entities.resumeEvents();
  }

  // Update visual entities
  renderAircraft();

  // If we have a searched flight ident but haven't matched it to a live aircraft yet,
  // try to find it now (it may have just appeared in the state data)
  if (searchedFlightIdent && !searchedIcao) {
    selectSearchedAircraft();
  }

  // Live-update the info panel if a selected aircraft still exists
  if (selectedIcao && aircraft.has(selectedIcao)) {
    showAircraftInfo(selectedIcao);
    updateLiveAltitudeFilter();
  } else if (selectedIcao && !aircraft.has(selectedIcao)) {
    clearFlightPlanRoute();
    hideAircraftInfo();
  }
}

// Update or create the temporary polyline connecting the last history point to the
// aircraft's current position.  Called after every position change (server update or
// extrapolation tick) so the trail never visually detaches from the icon.
function updateExtrapolationTrail(icao, ac, currentPos) {
  // Selected aircraft always get extrapolation trail regardless of trail mode
  if (CONFIG.trailMode !== 'history' && icao !== selectedIcao) return;
  const lastHistory = ac.history.length > 0 ? ac.history[ac.history.length - 1] : null;
  if (!lastHistory) return;

  const lastHistoryPos = Cesium.Cartesian3.fromDegrees(
    lastHistory.lon, lastHistory.lat, exAlt(lastHistory.alt)
  );
  const positions = [lastHistoryPos, currentPos];

  const isSelected = icao === selectedIcao;
  let trailWidth = isSelected ? 4 : 3;
  const camHeight = viewer.camera.positionCartographic
    ? viewer.camera.positionCartographic.height
    : CONFIG.startAlt;
  const zoomT = getZoomFraction(camHeight);
  trailWidth = Math.max(1, trailWidth * (1 - zoomT) + 1 * zoomT);

  const alt = ac.state.altitude || 0;
  let rgb;
  if (CONFIG.colorByAltitude) {
    rgb = isSelected ? altitudeToSelectedRgb(alt) : altitudeToRgb(alt);
  } else {
    rgb = isSelected ? hexToRgb(CONFIG.phosphorBright) : CONFIG.trailColor;
  }
  const mute = (!isSelected && CONFIG.theme === 'dark') ? 0.6 : 1;
  const material = Cesium.Color.fromBytes(
    Math.round(rgb[0] * mute), Math.round(rgb[1] * mute), Math.round(rgb[2] * mute), 255);

  if (ac.extrapolationTrail) {
    ac.extrapolationTrail.polyline.positions = positions;
    ac.extrapolationTrail.polyline.width = trailWidth;
    ac.extrapolationTrail.polyline.material = material;
  } else {
    ac.extrapolationTrail = viewer.entities.add({
      polyline: {
        positions: positions,
        width: trailWidth,
        material: material,
        clampToGround: false,
        distanceDisplayCondition: acDisplayCond,
      },
    });
  }
}

// Compute extrapolated position from a state's observed position, heading, and velocity.
// Returns Cartesian3 or null if extrapolation isn't possible.
// Callers are responsible for staleness checks (extrapolatePositions guards on
// lastServerUpdate).  This function caps elapsed time at 5 minutes to prevent
// unreasonable positions from very old timePosition values.
function computeExtrapolatedPosition(s, baseTime, now) {
  if (s.heading == null || !s.velocity) return null;
  const elapsed = now - baseTime;
  if (elapsed < 0 || elapsed > 300) return null; // cap at 5 minutes

  const speed = s.velocity; // m/s
  const distance = speed * elapsed; // meters traveled since observed position

  // Great circle destination from observed (lon, lat)
  const headingRad = Cesium.Math.toRadians(s.heading);
  const lonRad = Cesium.Math.toRadians(s.lon);
  const latRad = Cesium.Math.toRadians(s.lat);
  const R = 6371000; // Earth radius in meters
  const angDist = distance / R;

  const newLat = Math.asin(
    Math.sin(latRad) * Math.cos(angDist) +
    Math.cos(latRad) * Math.sin(angDist) * Math.cos(headingRad)
  );
  const newLon = lonRad + Math.atan2(
    Math.sin(headingRad) * Math.sin(angDist) * Math.cos(latRad),
    Math.cos(angDist) - Math.sin(latRad) * Math.sin(newLat)
  );

  const alt = (s.altitude || 0) + (s.verticalRate || 0) * elapsed;
  return Cesium.Cartesian3.fromDegrees(
    Cesium.Math.toDegrees(newLon), Cesium.Math.toDegrees(newLat), exAlt(alt)
  );
}

// Lightweight info panel update during extrapolation — only touches ALT, LAT, LON
function updateInfoPanelInterim(newPos) {
  const details = document.getElementById('info-details');
  if (!details) return;
  const carto = Cesium.Cartographic.fromCartesian(newPos);
  const lat = Cesium.Math.toDegrees(carto.latitude);
  const lon = Cesium.Math.toDegrees(carto.longitude);
  const realHeight = carto.height / CONFIG.exaggerateAltitudes;
  const altFeet = Math.round(realHeight * 3.28084);
  const altEl = details.querySelector('[data-field="alt"]');
  const latEl = details.querySelector('[data-field="lat"]');
  const lonEl = details.querySelector('[data-field="lon"]');
  if (altEl) altEl.textContent = altFeet.toLocaleString() + ' ft';
  if (latEl) latEl.textContent = lat.toFixed(4);
  if (lonEl) lonEl.textContent = lon.toFixed(4);
}

// Extrapolate aircraft positions between server polls based on heading and velocity
function extrapolatePositions() {
  const now = Date.now() / 1000;
  let updated = false;

  for (const [icao, ac] of aircraft) {
    // Skip if no entity created yet or missing required data
    if (!ac.entity || ac.state.heading == null || !ac.state.velocity) continue;

    const s = ac.state;

    // Check staleness based on when we last received data from the server,
    // NOT when the aircraft last transmitted (s.timePosition), which can be
    // 10-30+ seconds behind real time and cause extrapolation to time out
    // well before the next poll arrives.
    if (now - ac.lastServerUpdate > CONFIG.staleThreshold) continue;

    const baseTime = s.timePosition || ac.lastServerUpdate;
    const newPos = computeExtrapolatedPosition(s, baseTime, now);
    if (!newPos) continue;

    const alt = s.altitude || 0;

    // Calculate delta from previous position (extrapolated or server) to new position
    const oldPos = ac.extrapolatedPos || ac.entity.position.getValue();
    const delta = Cesium.Cartesian3.subtract(newPos, oldPos, new Cesium.Cartesian3());

    // Apply delta to aircraft entity
    ac.entity.position = newPos;
    ac.extrapolatedPos = newPos.clone();

    // Handle trails based on mode.
    // Selected aircraft always use history-style trail regardless of trail mode.
    const isSelectedAc = icao === selectedIcao;
    if (!isSelectedAc && CONFIG.trailMode === 'velocity') {
      // Velocity vector mode: apply same delta to trail endpoints
      for (const trailEntity of ac.trailEntities) {
        if (trailEntity.polyline && trailEntity.polyline.positions) {
          const oldPositions = trailEntity.polyline.positions.getValue();
          if (oldPositions && oldPositions.length > 0) {
            const newPositions = oldPositions.map(pos =>
              Cesium.Cartesian3.add(pos, delta, new Cesium.Cartesian3())
            );
            trailEntity.polyline.positions = newPositions;
          }
        }
      }
    } else if (CONFIG.trailMode === 'history' || isSelectedAc) {
      // History trail mode: connect last history point to extrapolated position
      updateExtrapolationTrail(icao, ac, newPos);
    }

    // Live-update info panel for the selected aircraft during extrapolation
    if (isSelectedAc) {
      updateInfoPanelInterim(newPos);
    }

    updated = true;
  }

  // If any positions were updated, trigger a scene render
  if (updated && viewer.scene) {
    viewer.scene.requestRender();
  }
}

// Trail content fingerprint to avoid unnecessary entity rebuilds
function _computeTrailHash(ac, s, isSelected) {
  // Selected aircraft always use history-style trail hash regardless of global trail mode
  if (!isSelected && CONFIG.trailMode === 'none') return '';
  if (!isSelected && CONFIG.trailMode === 'velocity') {
    return `V:${(s.heading||0).toFixed(1)}:${(s.velocity||0).toFixed(0)}:${s.lon.toFixed(4)}:${s.lat.toFixed(4)}`;
  }
  const histLen = ac.history.length;
  const last = histLen > 0 ? ac.history[histLen - 1] : null;
  const granLen = ac.granularTrack && ac.granularTrack.path ? ac.granularTrack.path.length : 0;
  return last
    ? `T:${histLen}:${granLen}:${last.time.toFixed(0)}`
    : `T:0:${granLen}`;
}

// Compute the straight-line distance from camera to the geometric horizon.
// Entities beyond this distance are on the far side of the globe.
function computeHorizonDist(camHeight) {
  const R = 6371000; // Earth radius in meters
  return Math.sqrt(2 * R * camHeight + camHeight * camHeight) * 1.25;
}

// Render a single aircraft entity (billboard + trail). Called per-aircraft by renderAircraft.
function _renderOneAircraft(icao, ac, camHeight, useDot, showLabels) {
    const s = ac.state;
    // Use extrapolated position if available, otherwise compute from state
    const pos = ac.extrapolatedPos || Cesium.Cartesian3.fromDegrees(s.lon, s.lat, exAlt(s.altitude || 0));
    const isSelected = icao === selectedIcao;

    // Altitude-based color computation
    let altColor = null;
    let altCesiumColor = null;
    if (CONFIG.colorByAltitude) {
      const altRgb = isSelected ? altitudeToSelectedRgb(s.altitude) : altitudeToRgb(s.altitude);
      altColor = `rgb(${altRgb[0]},${altRgb[1]},${altRgb[2]})`;
      altCesiumColor = Cesium.Color.fromBytes(altRgb[0], altRgb[1], altRgb[2], 255);
    }

    // Always use dots in both 2D and 3D; billboard width/height
    // handles on-screen sizing via computeDisplaySize.
    const iconImage = createDotIcon(8, isSelected, altColor);
    const iconKey = `D:${isSelected}:${altColor || ''}`;
    const iconSize = computeDisplaySize(camHeight);
    const labelColor = altCesiumColor || (isSelected
      ? Cesium.Color.fromCssColorString(CONFIG.phosphorSelect)
      : Cesium.Color.fromCssColorString(CONFIG.phosphor));

    // --- Aircraft symbol (billboard) ---
    if (!ac.entity) {
      ac.entity = viewer.entities.add({
        id: `ac-${icao}`,
        position: pos,
        billboard: {
          image: iconImage,
          width: iconSize,
          height: iconSize,
          pixelOffset: new Cesium.Cartesian2(0, 0),
          eyeOffset: new Cesium.Cartesian3(0, 0, -100),
          distanceDisplayCondition: acDisplayCond,
        },
        label: (CONFIG.labelsEnabled || isSelected) ? (() => {
          const headingRad = Cesium.Math.toRadians(s.heading || 0);
          const labelDist = 24;
          const offsetX = Math.sin(headingRad) * labelDist;
          const offsetY = -Math.cos(headingRad) * labelDist;
          const hOrigin = offsetX >= 0 ? Cesium.HorizontalOrigin.LEFT : Cesium.HorizontalOrigin.RIGHT;
          return {
            text: `${s.callsign || icao}\n${formatAltitude(s.altitude)}${verticalIndicator(s.verticalRate)} ${formatSpeed(s.velocity)}`,
            font: labelFont(CONFIG.fontSize, 700),
            fillColor: labelColor,
            style: Cesium.LabelStyle.FILL,
            pixelOffset: new Cesium.Cartesian2(offsetX, offsetY),
            horizontalOrigin: hOrigin,
            verticalOrigin: Cesium.VerticalOrigin.CENTER,
            showBackground: false,
            scale: 1.0,
            show: isSelected || showLabels,
            distanceDisplayCondition: acDisplayCond,
          };
        })() : undefined,
        properties: { icao24: icao },
      });
      ac._iconKey = iconKey;
      ac._labelText = (CONFIG.labelsEnabled || isSelected)
        ? `${s.callsign || icao}\n${formatAltitude(s.altitude)}${verticalIndicator(s.verticalRate)} ${formatSpeed(s.velocity)}`
        : '';
      // Re-attach tracking after entity recreation (e.g. theme change, refreshAllEntities)
      if (isTracking && icao === selectedIcao) {
        viewer.trackedEntity = ac.entity;
      }
    } else {
      // Update position
      ac.entity.position = pos;

      // Skip billboard image assignment when icon hasn't changed
      // (avoids Cesium texture dirty-flagging / GPU re-upload)
      if (ac._iconKey !== iconKey) {
        ac._iconKey = iconKey;
        ac.entity.billboard.image = iconImage;
      }
      ac.entity.billboard.width = iconSize;
      ac.entity.billboard.height = iconSize;

      if (CONFIG.labelsEnabled || isSelected) {
        const headingRad = Cesium.Math.toRadians(s.heading || 0);
        const labelDist = 24;
        const offsetX = Math.sin(headingRad) * labelDist;
        const offsetY = -Math.cos(headingRad) * labelDist;
        const hOrigin = offsetX >= 0 ? Cesium.HorizontalOrigin.LEFT : Cesium.HorizontalOrigin.RIGHT;
        if (!ac.entity.label) {
          ac.entity.label = new Cesium.LabelGraphics({
            text: '',
            font: labelFont(CONFIG.fontSize, 700),
            fillColor: labelColor,
            style: Cesium.LabelStyle.FILL,
            pixelOffset: new Cesium.Cartesian2(offsetX, offsetY),
            horizontalOrigin: hOrigin,
            verticalOrigin: Cesium.VerticalOrigin.CENTER,
            distanceDisplayCondition: acDisplayCond,
          });
        }
        const labelText = `${s.callsign || icao}\n${formatAltitude(s.altitude)}${verticalIndicator(s.verticalRate)} ${formatSpeed(s.velocity)}`;
        if (ac._labelText !== labelText) {
          ac._labelText = labelText;
          ac.entity.label.text = labelText;
          ac.entity.label.fillColor = labelColor;
        }
        ac.entity.label.pixelOffset = new Cesium.Cartesian2(offsetX, offsetY);
        ac.entity.label.horizontalOrigin = hOrigin;
        ac.entity.label.show = isSelected || showLabels;
      } else if (ac.entity.label) {
        ac.entity.label.show = false;
      }
    }

    // --- Trail polyline ---
    // Skip trail rebuild when data hasn't changed (e.g., during camera pan/zoom)
    const _th = _computeTrailHash(ac, s, isSelected);
    if (ac._trailHash === _th) return;
    // Show trails if enabled OR if this aircraft is selected (selected aircraft always show history trail)
    if (CONFIG.trailMode !== 'none' || isSelected) {
      // Determine base trail width, then scale down with zoom
      let trailWidth;
      if (CONFIG.thickTrailsByAltitude) {
        trailWidth = altitudeToTrailWidth(s.altitude);
        if (isSelected) trailWidth = Math.min(trailWidth + 1, 8);
      } else {
        trailWidth = isSelected ? 4 : 3;
      }
      const zoomT = getZoomFraction(camHeight);
      trailWidth = Math.max(1, trailWidth * (1 - zoomT) + 1 * zoomT);

      // Selected aircraft always show history trail; others follow global setting
      if (!isSelected && CONFIG.trailMode === 'velocity' && s.heading != null && s.velocity != null) {
        // Velocity vector mode: single line behind aircraft proportional to speed
        removeTrailEntities(ac);

        const speed = s.velocity || 0; // m/s
        const lineLength = speed * 60; // scale factor: ~15km line at cruise speed
        if (lineLength > 100) {
          // Use displayed position (extrapolated or server) so trail stays attached to icon
          const acCarto = Cesium.Cartographic.fromCartesian(pos);
          const acLon = Cesium.Math.toDegrees(acCarto.longitude);
          const acLat = Cesium.Math.toDegrees(acCarto.latitude);

          // Compute endpoint behind the aircraft (heading + 180°)
          const behindDeg = (s.heading + 180) % 360;
          const behindRad = Cesium.Math.toRadians(behindDeg);
          const acLonRad = acCarto.longitude;
          const acLatRad = acCarto.latitude;
          const R = 6371000; // Earth radius in meters
          const angDist = lineLength / R;

          const endLat = Math.asin(
            Math.sin(acLatRad) * Math.cos(angDist) +
            Math.cos(acLatRad) * Math.sin(angDist) * Math.cos(behindRad)
          );
          const endLon = acLonRad + Math.atan2(
            Math.sin(behindRad) * Math.sin(angDist) * Math.cos(acLatRad),
            Math.cos(angDist) - Math.sin(acLatRad) * Math.sin(endLat)
          );

          // Use the actual entity altitude (from pos, which includes vertical rate
          // extrapolation) so the trail front matches the icon exactly.  Using raw
          // s.altitude would create a vertical ECEF offset for climbing/descending aircraft.
          const alt = acCarto.height;
          const endAlt = alt - exAlt((s.verticalRate || 0) * 60);
          const positions = [
            Cesium.Cartesian3.fromDegrees(acLon, acLat, alt),
            Cesium.Cartesian3.fromDegrees(Cesium.Math.toDegrees(endLon), Cesium.Math.toDegrees(endLat), endAlt),
          ];

          // Color logic matching existing trail colors (use real altitude, not exaggerated)
          const realAlt = alt / CONFIG.exaggerateAltitudes;
          let rgb;
          if (CONFIG.colorByAltitude) {
            rgb = isSelected ? altitudeToSelectedRgb(realAlt) : altitudeToRgb(realAlt);
          } else {
            rgb = isSelected ? hexToRgb(CONFIG.phosphorBright) : CONFIG.trailColor;
          }
          const mute = (!isSelected && CONFIG.theme === 'dark') ? 0.6 : 1;
          const material = Cesium.Color.fromBytes(
            Math.round(rgb[0] * mute), Math.round(rgb[1] * mute), Math.round(rgb[2] * mute), 255);

          ac.trailEntities.push(viewer.entities.add({
            polyline: {
              positions: positions,
              width: trailWidth,
              material: material,
              clampToGround: false,
              distanceDisplayCondition: acDisplayCond,
            },
          }));
        }
      } else {
        // Normal history trail mode
        const trailPoints = buildTrailPositions(ac, isSelected);

        // Always tear down previous trail entities so stale polylines
        // don't linger at old positions when data thins out.
        removeTrailEntities(ac);

        if (trailPoints.length >= 2) {
          if (CONFIG.colorByAltitude) {
            // Group trail points into runs by altitude color bucket
            const bucketOf = (alt) => Math.floor(((alt || 0) * 3.28084) / 1500);
            let runStart = 0;
            let currentBucket = bucketOf(trailPoints[0].alt);

            for (let i = 1; i <= trailPoints.length; i++) {
              const bucket = i < trailPoints.length ? bucketOf(trailPoints[i].alt) : -1;
              if (bucket !== currentBucket || i === trailPoints.length) {
                // End of run: runStart..i-1 (inclusive)
                const end = Math.min(i, trailPoints.length - 1);
                const runPoints = trailPoints.slice(runStart, end + 1);
                if (runPoints.length >= 2) {
                  const midAlt = ((currentBucket + 0.5) * 1500) / 3.28084; // bucket midpoint in meters
                  const rgb = isSelected ? altitudeToSelectedRgb(midAlt) : altitudeToRgb(midAlt);
                  // Mute trail colors in dark mode to avoid overly bright opaque trails
                  const mute = (!isSelected && CONFIG.theme === 'dark') ? 0.6 : 1;
                  const material = Cesium.Color.fromBytes(
                    Math.round(rgb[0] * mute), Math.round(rgb[1] * mute), Math.round(rgb[2] * mute), 255);
                  const positions = runPoints.map(p => Cesium.Cartesian3.fromDegrees(p.lon, p.lat, exAlt(p.alt)));
                  ac.trailEntities.push(viewer.entities.add({
                    polyline: {
                      positions: positions,
                      width: trailWidth,
                      material: material,
                      clampToGround: false,
                      distanceDisplayCondition: acDisplayCond,
                    },
                  }));
                }
                runStart = i;
                currentBucket = bucket;
              }
            }
          } else {
            // Single-color trail
            const trailRgb = isSelected ? hexToRgb(CONFIG.phosphorBright) : CONFIG.trailColor;
            // Mute trail colors in dark mode to avoid overly bright opaque trails
            const mute = (!isSelected && CONFIG.theme === 'dark') ? 0.6 : 1;
            const trailMaterial = Cesium.Color.fromBytes(
              Math.round(trailRgb[0] * mute), Math.round(trailRgb[1] * mute), Math.round(trailRgb[2] * mute), 255);
            const positions = trailPoints.map(p => Cesium.Cartesian3.fromDegrees(p.lon, p.lat, exAlt(p.alt)));
            ac.trailEntities.push(viewer.entities.add({
              polyline: {
                positions: positions,
                width: trailWidth,
                material: trailMaterial,
                clampToGround: false,
                distanceDisplayCondition: acDisplayCond,
              },
            }));
          }
        }
      }
    } else {
      removeTrailEntities(ac);
    }
    ac._trailHash = _th;

    // Airport filter: hide aircraft not in the filter set (selected aircraft always visible)
    if (airportFilterCallsigns && !isSelected) {
      const cs = (s.callsign || '').trim().toUpperCase();
      const visible = airportFilterCallsigns.has(cs);
      ac.entity.show = visible;
      if (ac.extrapolationTrail) ac.extrapolationTrail.show = visible;
      for (const trail of ac.trailEntities) trail.show = visible;
    }
}

function renderAircraft(filterIcaos) {
  // LOD based on camera height
  const camHeight = viewer.camera.positionCartographic
    ? viewer.camera.positionCartographic.height
    : 0;
  const useDot = camHeight > 2000000;
  const showLabels = CONFIG.labelsEnabled && camHeight < 800000;
  acDisplayCond = new Cesium.DistanceDisplayCondition(0, computeHorizonDist(camHeight));

  // Collect the aircraft entries to render
  const entries = [];
  for (const [icao, ac] of aircraft) {
    if (filterIcaos && !filterIcaos.has(icao)) continue;
    entries.push([icao, ac]);
  }

  // Small batches (selection changes, single updates) render synchronously
  if (entries.length <= RENDER_CHUNK_SIZE) {
    viewer.entities.suspendEvents();
    try {
      for (const [icao, ac] of entries) {
        _renderOneAircraft(icao, ac, camHeight, useDot, showLabels);
      }
    } finally {
      viewer.entities.resumeEvents();
    }
    return;
  }

  // Large batches: chunk across animation frames to keep UI responsive
  const gen = ++_renderGeneration;
  let idx = 0;

  function renderChunk() {
    // Abort if a newer render has been requested or aircraft display was disabled
    if (gen !== _renderGeneration || !aircraftActive()) return;

    const end = Math.min(idx + RENDER_CHUNK_SIZE, entries.length);
    viewer.entities.suspendEvents();
    try {
      for (; idx < end; idx++) {
        _renderOneAircraft(entries[idx][0], entries[idx][1], camHeight, useDot, showLabels);
      }
    } finally {
      viewer.entities.resumeEvents();
    }

    if (idx < entries.length && gen === _renderGeneration) {
      requestAnimationFrame(renderChunk);
    }
  }

  requestAnimationFrame(renderChunk);
}

// Lightweight zoom handler: only update billboard display sizes and label
// visibility.  Avoids the full _renderOneAircraft loop (icon regeneration,
// trail hash computation, Cesium property churn) that causes zoom stutter.
function resizeAircraftIcons() {
  const camHeight = viewer.camera.positionCartographic
    ? viewer.camera.positionCartographic.height : 0;
  const iconSize = computeDisplaySize(camHeight);
  const showLabels = CONFIG.labelsEnabled && camHeight < 800000;
  acDisplayCond = new Cesium.DistanceDisplayCondition(0, computeHorizonDist(camHeight));

  viewer.entities.suspendEvents();
  try {
    for (const [icao, ac] of aircraft) {
      if (!ac.entity) continue;
      if (ac.entity.billboard) {
        ac.entity.billboard.width = iconSize;
        ac.entity.billboard.height = iconSize;
        ac.entity.billboard.distanceDisplayCondition = acDisplayCond;
      }
      if (ac.entity.label) {
        ac.entity.label.show = (icao === selectedIcao) || showLabels;
        ac.entity.label.distanceDisplayCondition = acDisplayCond;
      }
    }
    for (const entity of pirepEntities) {
      if (entity.billboard) {
        entity.billboard.distanceDisplayCondition = acDisplayCond;
      }
    }
  } finally {
    viewer.entities.resumeEvents();
  }
}

// Merge granular API track data with polled history
function smoothTrailPositions(points) {
  if (points.length < 3) return points;
  const smoothed = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const next = points[i + 1];
    smoothed.push({
      lon: prev.lon * 0.25 + curr.lon * 0.5 + next.lon * 0.25,
      lat: prev.lat * 0.25 + curr.lat * 0.5 + next.lat * 0.25,
      alt: curr.alt,
      time: curr.time,
      granular: curr.granular,
    });
  }
  smoothed.push(points[points.length - 1]);
  return smoothed;
}

function buildTrailPositions(ac, isSelected = false) {
  const now = Date.now() / 1000;
  const minTime = isSelected ? 0 : now - CONFIG.trailMaxAge;
  const lastKnownAlt = ac.lastKnownAlt || 0;

  // Collect granular track points (tagged as granular for priority)
  const granularPoints = [];
  if (ac.granularTrack && ac.granularTrack.path) {
    for (const wp of ac.granularTrack.path) {
      // wp: [time, lat, lon, baro_alt, heading, on_ground]
      if (wp[0] >= minTime && wp[1] != null && wp[2] != null) {
        granularPoints.push({
          lon: wp[2], lat: wp[1],
          alt: wp[3] != null ? wp[3] : lastKnownAlt,
          time: wp[0], granular: true,
        });
      }
    }
  }

  // Collect polled history points
  const polledPoints = [];
  for (const p of ac.history) {
    if (p.time >= minTime) {
      polledPoints.push({ ...p, granular: false });
    }
  }

  // Merge: for any time window where granular data exists, skip polled points
  // that fall within the granular time range (granular data is higher fidelity)
  let points;
  if (granularPoints.length > 0) {
    const gMin = granularPoints[0].time;
    const gMax = granularPoints[granularPoints.length - 1].time;
    // Keep polled points only outside the granular range
    const filteredPolled = polledPoints.filter(p => p.time < gMin || p.time > gMax);
    points = [...granularPoints, ...filteredPolled];
  } else {
    points = polledPoints;
  }

  // Sort chronologically
  points.sort((a, b) => a.time - b.time);

  // Remove points that create large time gaps — trim to most recent
  // contiguous segment to avoid jumps from stale positions.
  // Gap threshold must exceed the longest poll interval (60s) with margin
  // for network latency.  Selected aircraft gets a much larger tolerance.
  // Skip gap-trimming entirely when granular track data exists — those
  // waypoints are inherently sparse (every 15 min or at heading changes)
  // and gaps between them or between the granular tail and polled data
  // are expected and should not discard the flight history.
  const hasGranular = granularPoints.length > 0;
  if (!hasGranular) {
    const MAX_GAP = isSelected ? 600 : 180;
    let segmentStart = 0;
    for (let i = 1; i < points.length; i++) {
      if (points[i].time - points[i - 1].time > MAX_GAP) {
        segmentStart = i;
      }
    }
    if (segmentStart > 0) {
      points = points.slice(segmentStart);
    }
  }

  return smoothTrailPositions(points);
}

// ==== Polling Loop =========================================================

// Expand bounds by a fraction (0.5 = 50% larger in each direction)
function padBounds(bounds, fraction) {
  const latPad = (bounds.north - bounds.south) * fraction / 2;
  const lonPad = (bounds.east - bounds.west) * fraction / 2;
  return {
    south: Math.max(bounds.south - latPad, -90),
    north: Math.min(bounds.north + latPad, 90),
    west: Math.max(bounds.west - lonPad, -180),
    east: Math.min(bounds.east + lonPad, 180),
  };
}

async function pollStates() {
  if (_pollInFlight) {
    console.log('[Poll] Skipped: _pollInFlight');
    return;
  }
  const now = Date.now();
  if (now - _lastBulkPollMs < RATE_LIMIT_MS) {
    console.log(`[Poll] Skipped: rate limit (${Math.round((RATE_LIMIT_MS - (now - _lastBulkPollMs)) / 1000)}s remaining)`);
    return;
  }
  _pollInFlight = true;
  _lastBulkPollMs = now;
  try {
    const viewBounds = frozenBounds || getViewBounds();
    // Fetch aircraft from a 50% larger region so small pans don't re-poll
    const bounds = padBounds(viewBounds, 0.5);
    console.log(`[OpenSky] Polling states: ${bounds.south.toFixed(1)},${bounds.west.toFixed(1)} → ${bounds.north.toFixed(1)},${bounds.east.toFixed(1)}`);
    const t0 = Date.now();
    const data = await window.flightAPI.getStates(bounds, 'bulk');
    console.log(`[OpenSky] IPC returned in ${Date.now() - t0}ms`);
    const warningEl = document.getElementById('throttle-warning');

    if (data.error) {
      if (data.retryIn) {
        // Main process rate limited us — allow retry after the specified delay
        // instead of being blocked for the full RATE_LIMIT_MS window.
        console.log(`[Poll] Main process rate limited, retryIn=${data.retryIn}ms`);
        _lastBulkPollMs = now - RATE_LIMIT_MS + data.retryIn;
      } else {
        console.warn('[Poll] Error:', data.error);
        if (/429/.test(data.error) || /rate.?limit/i.test(data.error)) {
          rateLimitedUntil = Date.now() + 60000;
          console.warn('[Poll] Rate limited — pausing all polling for 60s');
          warningEl.classList.remove('hidden');
          setTimeout(() => warningEl.classList.add('hidden'), 60000);
        }
      }
      return;
    }

    warningEl.classList.add('hidden');

    // If aircraft display was disabled while the poll was in-flight, discard
    // the results to avoid creating orphaned entities in Cesium.
    if (!aircraftActive()) {
      console.log('[Poll] Discarding results: aircraft disabled during poll');
      return;
    }

    const stateCount = data.states ? data.states.length : 0;
    console.log(`[OpenSky] Got ${stateCount} aircraft`);

    // Update HUD immediately so the user sees fresh data before heavy processing
    lastPollTime = new Date();
    lastPollBounds = bounds;
    document.getElementById('track-count').textContent = stateCount;
    document.getElementById('last-update').textContent =
      lastPollTime.toLocaleTimeString('en-US', { hour12: false });

    if (stateCount > 0) {
      updateAircraft(data.states);
    }
  } catch (err) {
    console.error('[Poll] pollStates exception:', err);
  } finally {
    _pollInFlight = false;
  }
}

async function fetchNextTrack() {
  if (trackFetchQueue.length === 0) return;

  const icao24 = trackFetchQueue.shift();
  const ac = aircraft.get(icao24);
  if (!ac) return;

  const data = await window.flightAPI.getTrack(icao24);
  if (!data.error && data.path) {
    ac.granularTrack = data;
    ac.lastTrackFetch = Date.now() / 1000;
    console.log(`[Track] Got ${data.path.length} waypoints for ${icao24}`);
    renderAircraft();
  }
}

function startPolling() {
  if (!aircraftActive()) {
    console.log('[Poll] startPolling: aircraft disabled, skipping');
    return;
  }
  // Set initial poll interval based on current zoom level
  const camHeight = viewer.camera.positionCartographic
    ? viewer.camera.positionCartographic.height
    : CONFIG.startAlt;
  lastPollHeight = camHeight;
  lastPositionUpdateHeight = camHeight;
  const pollMs = computePollInterval(camHeight);
  const tickMs = computePositionUpdateInterval(camHeight);
  setPollInterval(pollMs);
  setTickInterval(tickMs);
  console.log(`[Poll] startPolling: camHeight=${Math.round(camHeight)}m, pollInterval=${pollMs}ms, tickInterval=${tickMs}ms`);

  // Initial fetch
  pollStates();

  ensureTick();
}

// Lightweight font-size-only update — used during slider drag to avoid full reload
function updateLabelFontSize() {
  const font = labelFont(CONFIG.fontSize, 700);
  for (const [, ac] of aircraft) {
    if (ac.entity && ac.entity.label) {
      ac.entity.label.font = font;
    }
  }
}

// Expose all top-level functions as globals
window.aircraftActive = aircraftActive;
window.removeTrailEntities = removeTrailEntities;
window.refreshAllEntities = refreshAllEntities;
window.toggleAircraft = toggleAircraft;
window.setPollInterval = setPollInterval;
window.setTickInterval = setTickInterval;
window.pollSelectedAircraft = pollSelectedAircraft;
window.tick = tick;
window.ensureTick = ensureTick;
window.stopTick = stopTick;
window.getViewBounds = getViewBounds;
window.updateAircraft = updateAircraft;
window.updateExtrapolationTrail = updateExtrapolationTrail;
window.computeExtrapolatedPosition = computeExtrapolatedPosition;
window.updateInfoPanelInterim = updateInfoPanelInterim;
window.extrapolatePositions = extrapolatePositions;
window._computeTrailHash = _computeTrailHash;
window.computeHorizonDist = computeHorizonDist;
window._renderOneAircraft = _renderOneAircraft;
window.renderAircraft = renderAircraft;
window.resizeAircraftIcons = resizeAircraftIcons;
window.updateLabelFontSize = updateLabelFontSize;
window.smoothTrailPositions = smoothTrailPositions;
window.buildTrailPositions = buildTrailPositions;
window.padBounds = padBounds;
window.pollStates = pollStates;
window.fetchNextTrack = fetchNextTrack;
window.startPolling = startPolling;

export {}
