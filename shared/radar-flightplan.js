// Aircraft selection, info panel, flight plan search, and route display.
// Depends on radar-core.js, radar-aircraft.js.

'use strict';

// ============================================================
// Aircraft Selection (click to inspect)
// ============================================================

// Track window focus so the activation click (bringing window to front)
// doesn't accidentally deselect the current aircraft.
let focusTime = 0;
window.addEventListener('focus', () => { focusTime = Date.now(); });

const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
handler.setInputAction((click) => {
  // Ignore clicks within 300ms of the window regaining focus — these are
  // activation clicks that the user intended to bring the window to front,
  // not to deselect the current aircraft.
  if (Date.now() - focusTime < 300) return;
  const picked = viewer.scene.pick(click.position);
  if (Cesium.defined(picked) && picked.id && picked.id.id) {
    const id = picked.id.id;
    if (id.startsWith('ac-')) {
      showAircraftInfo(id.replace('ac-', ''));
    } else if (id.startsWith('turb-') && !selectedIcao) {
      // Only show turbulence info when no aircraft is selected —
      // the close button is the only way to deselect an aircraft.
      showTurbInfo(picked.id);
    }
  }
  // Clicking empty space or non-aircraft entities does NOT deselect;
  // the info panel close button is the only way to deselect.
}, Cesium.ScreenSpaceEventType.LEFT_CLICK);

// Format a duration in milliseconds as "Xh Ym".
function formatDuration(ms) {
  if (ms < 0) return '---';
  const totalMin = Math.round(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// Append route timing details to the info panel from the active flight plan.
function updateInfoPanelRoute(flight) {
  const details = document.getElementById('info-details');
  if (!details) return;

  const origin = flight.origin;
  const dest = flight.destination;
  const originCode = origin ? (origin.code_iata || origin.code_icao || '??') : '??';
  const destCode = dest ? (dest.code_iata || dest.code_icao || '??') : '??';

  const depStr = flight.actual_out || flight.estimated_out || flight.scheduled_out;
  const arrStr = flight.estimated_in || flight.scheduled_in;

  const now = Date.now();
  const depTime = depStr ? new Date(depStr) : null;
  const arrTime = arrStr ? new Date(arrStr) : null;

  const elapsed = depTime ? formatDuration(now - depTime.getTime()) : '---';
  const remaining = arrTime ? formatDuration(arrTime.getTime() - now) : '---';
  const eta = arrTime
    ? arrTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZoneName: 'short' })
    : '---';

  const filedAlt = flight.filed_altitude != null ? `FL${flight.filed_altitude}` : null;

  // Insert route rows right after the info-details opening, before ALT
  const routeHTML = `
    <div><span class="label">ROUTE</span><span>${originCode} → ${destCode}</span></div>
    ${filedAlt ? `<div><span class="label">FILED ALT</span><span>${filedAlt}</span></div>` : ''}
    <div><span class="label">ELAPSED</span><span>${elapsed}</span></div>
    <div><span class="label">REMAINING</span><span>${remaining}</span></div>
    <div><span class="label">ETA</span><span>${eta}</span></div>
  `;
  details.insertAdjacentHTML('afterbegin', routeHTML);
}

function showAircraftInfo(icao) {
  const ac = aircraft.get(icao);
  if (!ac) return;

  const prevSelected = selectedIcao;
  selectedIcao = icao;

  const s = ac.state;
  const panel = document.getElementById('aircraft-info');
  panel.classList.remove('hidden');

  const infoButtons = document.getElementById('info-buttons');
  if (infoButtons) infoButtons.classList.remove('hidden');

  document.getElementById('info-callsign').textContent = s.callsign || icao;

  const feetAlt = s.altitude ? Math.round(s.altitude * 3.28084) : null;
  const knots = s.velocity ? Math.round(s.velocity * 1.94384) : null;
  const fpm = s.verticalRate ? Math.round(s.verticalRate * 196.85) : null;

  document.getElementById('info-details').innerHTML = `
    <div><span class="label">ALT</span><span data-field="alt">${feetAlt != null ? feetAlt.toLocaleString() + ' ft' : '---'}</span></div>
    <div><span class="label">GND SPD</span><span>${knots != null ? knots + ' kts' : '---'}</span></div>
    <div><span class="label">HDG</span><span>${s.heading != null ? Math.round(s.heading) + '°' : '---'}</span></div>
    <div><span class="label">VS</span><span>${fpm != null ? (fpm > 0 ? '+' : '') + fpm + ' fpm' : '---'}</span></div>
    <div><span class="label">LAT</span><span data-field="lat">${s.lat.toFixed(4)}</span></div>
    <div><span class="label">LON</span><span data-field="lon">${s.lon.toFixed(4)}</span></div>
    <div><span class="label">LAST POLL</span><span>${lastPollTime ? lastPollTime.toLocaleTimeString('en-US', { hour12: false }) : '---'}</span></div>
    <div><span class="label">ADS-B</span><span>${s.lastContact ? new Date(s.lastContact * 1000).toLocaleTimeString('en-US', { hour12: false }) : '---'}</span></div>
  `;

  // Re-apply persisted route info (ROUTE/ELAPSED/REMAINING/ETA) after innerHTML rebuild
  if (selectedRouteFlight) updateInfoPanelRoute(selectedRouteFlight);

  // Fetch full track history only on initial selection (not on every info refresh)
  if (prevSelected !== icao && !trackFetchQueue.includes(icao)) {
    trackFetchQueue.unshift(icao);
    fetchNextTrack();
  }

  // Stop tracking when selecting a different aircraft
  if (prevSelected !== icao) stopTracking();

  // Re-render to apply highlight to newly selected and dim previously selected
  if (prevSelected !== icao) {
    const toRefresh = new Set([icao]);
    if (prevSelected) toRefresh.add(prevSelected);
    viewer.entities.suspendEvents();
    try {
      for (const rid of toRefresh) {
        const rac = aircraft.get(rid);
        if (rac) {
          if (rac.entity) { viewer.entities.remove(rac.entity); rac.entity = null; }
          rac._iconKey = ''; rac._labelText = '';
          removeTrailEntities(rac);
        }
      }
    } finally {
      viewer.entities.resumeEvents();
    }
    renderAircraft(toRefresh);

    // Clear any previous flight plan route from a different aircraft
    if (prevSelected && prevSelected !== icao && flightPlanEntities.length > 0) {
      clearFlightPlanRoute();
    }

    // Unified treatment: enrich any newly selected aircraft with FlightAware
    // data (filed route, flown track) regardless of how it was selected.
    // Skip if this aircraft is already the searched flight (already enriched).
    const cs = (s.callsign || '').trim();
    if (cs && cs.toUpperCase() !== (searchedFlightIdent || '')) {
      enrichSelectedWithFlightAware(icao, cs);
    } else if (activeFlightPlan && activeFlightPlan.flights) {
      // Already have flight plan data from a prior search — show route timing
      const flight = pickBestFlight(activeFlightPlan.flights);
      if (flight) {
        selectedRouteFlight = flight;
        updateInfoPanelRoute(flight);
      }
    }
  }

  // Ensure the unified tick timer is running for extrapolation and polling
  ensureTick();
}

function showTurbInfo(entity) {
  const p = entity.properties;
  if (!p) return;
  const type = p.turbType ? p.turbType.getValue() : '?';
  const panel = document.getElementById('aircraft-info');
  panel.classList.remove('hidden');
  const infoButtons = document.getElementById('info-buttons');
  if (infoButtons) infoButtons.classList.add('hidden');

  // Deselect any aircraft
  if (selectedIcao) {
    const prevIcao = selectedIcao;
    selectedIcao = null;
    const toRefresh = new Set([prevIcao]);
    viewer.entities.suspendEvents();
    try {
      const rac = aircraft.get(prevIcao);
      if (rac) {
        if (rac.entity) { viewer.entities.remove(rac.entity); rac.entity = null; }
        rac._iconKey = ''; rac._labelText = '';
        removeTrailEntities(rac);
      }
    } finally {
      viewer.entities.resumeEvents();
    }
    renderAircraft(toRefresh);
  }

  if (type === 'PIREP') {
    document.getElementById('info-callsign').textContent = `PIREP — ${p.intensity.getValue()} TURB`;
    document.getElementById('info-details').innerHTML = `
      <div><span class="label">TYPE</span><span>Pilot Report</span></div>
      <div><span class="label">INTENSITY</span><span>${p.intensity.getValue()}</span></div>
      <div><span class="label">FL</span><span>${p.fltlvl.getValue()}</span></div>
      <div><span class="label">ACFT</span><span>${p.acType.getValue()}</span></div>
      <div><span class="label">TIME</span><span>${p.obsTime.getValue()}</span></div>
    `;
  } else if (type === 'SIGMET' || type === 'CONVECTIVE SIGMET') {
    const hazard = p.hazard.getValue();
    const label = type === 'CONVECTIVE SIGMET' ? 'CONVECTIVE SIGMET' : 'SIGMET — TURBULENCE';
    document.getElementById('info-callsign').textContent = label;
    const from = p.validFrom.getValue();
    const to = p.validTo.getValue();
    document.getElementById('info-details').innerHTML = `
      <div><span class="label">TYPE</span><span>${type}</span></div>
      <div><span class="label">HAZARD</span><span>${hazard}</span></div>
      <div><span class="label">SEVERITY</span><span>${p.severity.getValue()}</span></div>
      <div><span class="label">BASE</span><span>${p.base.getValue()}</span></div>
      <div><span class="label">TOP</span><span>${p.top.getValue()}</span></div>
      <div><span class="label">VALID</span><span>${from} — ${to}</span></div>
    `;
  } else if (type === 'G-AIRMET') {
    document.getElementById('info-callsign').textContent = `G-AIRMET — ${p.hazard.getValue()}`;
    document.getElementById('info-details').innerHTML = `
      <div><span class="label">TYPE</span><span>G-AIRMET</span></div>
      <div><span class="label">HAZARD</span><span>${p.hazard.getValue()}</span></div>
      <div><span class="label">SEVERITY</span><span>${p.severity.getValue()}</span></div>
      <div><span class="label">BASE</span><span>${p.base.getValue()}</span></div>
      <div><span class="label">TOP</span><span>FL${p.top.getValue()}</span></div>
      <div><span class="label">VALID</span><span>${p.validFrom.getValue()}</span></div>
    `;
  }
}

function hideAircraftInfo() {
  stopTracking();
  const prevIcao = selectedIcao;
  selectedIcao = null;
  document.getElementById('aircraft-info').classList.add('hidden');
  const infoButtons = document.getElementById('info-buttons');
  if (infoButtons) infoButtons.classList.add('hidden');
  if (prevIcao) {
    viewer.entities.suspendEvents();
    try {
      const rac = aircraft.get(prevIcao);
      if (rac) {
        if (rac.entity) { viewer.entities.remove(rac.entity); rac.entity = null; }
        rac._iconKey = ''; rac._labelText = '';
        removeTrailEntities(rac);
      }
    } finally {
      viewer.entities.resumeEvents();
    }
    // If aircraft toggle is off, remove the deselected aircraft entirely
    // (it was only kept because it was selected). Otherwise re-render normally.
    if (!CONFIG.aircraftEnabled) {
      aircraft.delete(prevIcao);
      document.getElementById('track-count').textContent = '0';
    } else {
      renderAircraft(new Set([prevIcao]));
    }
  }
  // Stop tick if nothing needs it (no selected aircraft, display off)
  if (!CONFIG.aircraftEnabled) stopTick();
}

document.getElementById('info-close').addEventListener('click', () => {
  clearFlightPlanRoute();
  hideAircraftInfo();
  const searchInput = document.getElementById('flight-search');
  if (searchInput) searchInput.value = '';
});

// ============================================================
// Flight Plan Search & Route Display
// ============================================================

// Enrich a selected aircraft with FlightAware data: fetch and display the filed
// route.  Called when any aircraft is newly selected (clicked or searched) so
// that all selected aircraft receive the same treatment.  Current position and
// trail history always come from OpenSky — FlightAware only provides the route.
async function enrichSelectedWithFlightAware(icao, callsign) {
  if (!window.flightAPI.getFlightPlan) return;

  try {
    const data = await window.flightAPI.getFlightPlan(callsign.trim());
    if (data.error || !data.flights || data.flights.length === 0) return;

    // Bail if user deselected or selected a different aircraft while we were fetching
    if (selectedIcao !== icao) return;

    const result = displayFlightPlanRoute(data);
    searchedIcao = icao;
    if (result && result.flight) {
      selectedRouteFlight = result.flight;
      updateInfoPanelRoute(result.flight);
    }

    console.log(`[FlightPlan] Enriched selected aircraft ${icao} (${callsign}) with FlightAware data`);
  } catch (err) {
    console.warn('[FlightPlan] Enrichment error:', err);
  }
}

// Pick the best flight from a FlightAware /flights response array.
// Priority: 1) en-route, 2) not yet arrived, 3) most recent past flight.
function pickBestFlight(flights) {
  const now = new Date();

  // Debug: log all candidates so we can see what AeroAPI returned
  for (const f of flights) {
    console.log(`[FlightPlan] Candidate: ${f.ident} | status=${f.status} | progress=${f.progress_percent}% | ` +
      `dep=${f.scheduled_out || '?'} | arr=${f.scheduled_in || '?'} | fa_id=${f.fa_flight_id}`);
  }

  // 1. Currently in the air
  const enRoute = flights.find(f => f.progress_percent != null && f.progress_percent > 0 && f.progress_percent < 100);
  if (enRoute) {
    console.log(`[FlightPlan] Picked en-route flight: ${enRoute.fa_flight_id}`);
    return enRoute;
  }

  // 2. Not yet arrived — arrival time is in the future (catches scheduled,
  //    delayed, and taxiing flights even if scheduled_out is already past)
  const notArrived = flights
    .filter(f => {
      const arr = f.scheduled_in || f.estimated_in;
      if (!arr) return false;
      // Already completed (progress 100%) — skip
      if (f.progress_percent != null && f.progress_percent >= 100) return false;
      return new Date(arr) > now;
    })
    .sort((a, b) => {
      // Earliest departure first
      const da = new Date(a.scheduled_out || a.estimated_out || a.scheduled_in);
      const db = new Date(b.scheduled_out || b.estimated_out || b.scheduled_in);
      return da - db;
    });
  if (notArrived.length > 0) {
    console.log(`[FlightPlan] Picked not-yet-arrived flight: ${notArrived[0].fa_flight_id} (${notArrived.length} candidates)`);
    return notArrived[0];
  }

  // 3. Fallback to most recent (first in the array — AeroAPI returns reverse-chronological)
  console.log(`[FlightPlan] Fallback to most recent flight: ${flights[0].fa_flight_id}`);
  return flights[0];
}

// Fly the camera to show the entire route from directly above (top-down view).
function flyToRouteOverview() {
  if (flightPlanEntities.length === 0) return;
  viewer.flyTo(flightPlanEntities, {
    duration: 1.5,
    offset: new Cesium.HeadingPitchRange(0, -Math.PI / 2, 0),
  });
}

function clearFlightPlanRoute() {
  viewer.entities.suspendEvents();
  try {
    for (const e of flightPlanEntities) viewer.entities.remove(e);
  } finally {
    viewer.entities.resumeEvents();
  }
  flightPlanEntities.length = 0;
  activeFlightPlan = null;
  selectedRouteFlight = null;
  searchedFlightIdent = null;
  searchedIcao = null;
  refreshTurbLevel();
}

// Look up airport coordinates from our local airport database by ICAO or IATA code.
// FlightAware's /flights endpoint returns airport objects with codes but no lat/lon.
function lookupAirportCoords(airportObj) {
  if (!airportObj || !cachedAirportData) return null;
  const icao = airportObj.code_icao || airportObj.code || '';
  const iata = airportObj.code_iata || '';
  const ap = cachedAirportData.find(a =>
    (icao && a.icao === icao) || (iata && a.iata === iata)
  );
  if (ap && ap.lat != null && ap.lon != null) {
    return { lat: ap.lat, lon: ap.lon };
  }
  // Fallback: FlightAware might include coordinates directly
  if (airportObj.latitude != null && airportObj.longitude != null) {
    return { lat: airportObj.latitude, lon: airportObj.longitude };
  }
  return null;
}

// Draw origin (green) and destination (red) airport markers for a flight plan.
function drawFlightPlanMarkers(origin, dest, originCoords, destCoords, waypointColor) {
  viewer.entities.suspendEvents();
  try {
    if (originCoords) {
      const originLabel = (origin && (origin.code_iata || origin.code_icao || origin.code)) || 'DEP';
      flightPlanEntities.push(viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(originCoords.lon, originCoords.lat),
        point: { pixelSize: 10, color: Cesium.Color.LIME, outlineColor: Cesium.Color.BLACK, outlineWidth: 1 },
        label: {
          text: originLabel,
          font: 'bold 13px Roboto Flex, sans-serif',
          fillColor: waypointColor,
          outlineColor: CONFIG.theme === 'light' ? Cesium.Color.WHITE : Cesium.Color.BLACK,
          outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          pixelOffset: new Cesium.Cartesian2(0, -8),
        },
      }));
    }
    if (destCoords) {
      const destLabel = (dest && (dest.code_iata || dest.code_icao || dest.code)) || 'ARR';
      flightPlanEntities.push(viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(destCoords.lon, destCoords.lat),
        point: { pixelSize: 10, color: Cesium.Color.RED, outlineColor: Cesium.Color.BLACK, outlineWidth: 1 },
        label: {
          text: destLabel,
          font: 'bold 13px Roboto Flex, sans-serif',
          fillColor: waypointColor,
          outlineColor: CONFIG.theme === 'light' ? Cesium.Color.WHITE : Cesium.Color.BLACK,
          outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          pixelOffset: new Cesium.Cartesian2(0, -8),
        },
      }));
    }
  } finally {
    viewer.entities.resumeEvents();
  }
}

// Draw a flight plan route on the map. Picks the best flight from the response,
// draws origin/dest markers and the filed route polyline, and flies to it.
// Returns { flight, originCoords, destCoords } so callers can use them, or null.
function displayFlightPlanRoute(flightData) {
  clearFlightPlanRoute();
  activeFlightPlan = flightData;
  refreshTurbLevel();

  // Find the best flight from the response (prefer en-route, then next upcoming)
  const flights = flightData.flights || [];
  if (flights.length === 0) return null;

  const flight = pickBestFlight(flights);

  // Store the searched flight identifier for visibility bypass and aircraft matching
  searchedFlightIdent = (flight.ident || flight.ident_iata || '').trim().toUpperCase();

  console.log(`[FlightPlan] Selected flight:`, JSON.stringify({
    ident: flight.ident, fa_flight_id: flight.fa_flight_id,
    status: flight.status, progress: flight.progress_percent,
    last_position: flight.last_position,
    position_only: flight.position_only,
  }));

  const routeColor = CONFIG.theme === 'light'
    ? Cesium.Color.fromCssColorString('#1565C0').withAlpha(0.8)
    : Cesium.Color.fromCssColorString('#42A5F5').withAlpha(0.8);
  const waypointColor = CONFIG.theme === 'light'
    ? Cesium.Color.fromCssColorString('#1565C0')
    : Cesium.Color.fromCssColorString('#64B5F6');

  // Filed cruise altitude in meters (AeroAPI filed_altitude is in hundreds of feet)
  const cruiseAltMeters = flight.filed_altitude != null
    ? flight.filed_altitude * 100 * 0.3048
    : null;

  const origin = flight.origin;
  const dest = flight.destination;
  const originCoords = lookupAirportCoords(origin);
  const destCoords = lookupAirportCoords(dest);

  drawFlightPlanMarkers(origin, dest, originCoords, destCoords, waypointColor);

  // Fly to origin/dest markers immediately so the user sees something right away
  if (flightPlanEntities.length > 0) {
    flyToRouteOverview();
  }

  // Fetch decoded route from FlightAware /route endpoint (waypoints with real lat/lon).
  // Falls back to parsing the route string from the flights response if that fails.
  if (flight.fa_flight_id) {
    fetchAndDisplayFiledRoute(flight.fa_flight_id, flight, originCoords, destCoords, routeColor, waypointColor, cruiseAltMeters);
  } else if (originCoords && destCoords) {
    drawRouteFromString(flight.route, originCoords, destCoords, routeColor, waypointColor, cruiseAltMeters);
  }

  return { flight, originCoords, destCoords };
}

// Locate the searched aircraft on OpenSky.  First fetches the FlightAware
// actual track to get the aircraft's real current position (more accurate and
// timely than the flights endpoint's last_position).  Falls back to the
// origin→destination route corridor if no track is available.
async function findAndSelectViaOpenSky(flight, originCoords, destCoords) {
  // Step 1: Try FlightAware /track endpoint for real-time position
  if (flight.fa_flight_id && window.flightAPI.getFlightTrack) {
    try {
      console.log(`[FlightPlan] Fetching FlightAware track for ${flight.fa_flight_id}`);
      const trackData = await window.flightAPI.getFlightTrack(flight.fa_flight_id);
      if (!trackData.error && trackData.positions && trackData.positions.length > 0) {
        const lastTrackPos = trackData.positions[trackData.positions.length - 1];
        if (lastTrackPos.latitude != null && lastTrackPos.longitude != null) {
          console.log(`[FlightPlan] FlightAware track has ${trackData.positions.length} positions, ` +
            `latest: lat=${lastTrackPos.latitude.toFixed(2)}, lon=${lastTrackPos.longitude.toFixed(2)}`);
          await fetchSingleAircraftForSearch({ latitude: lastTrackPos.latitude, longitude: lastTrackPos.longitude });
          return;
        }
      } else {
        console.log(`[FlightPlan] FlightAware track: ${trackData.error || 'no positions'}`);
      }
    } catch (err) {
      console.warn(`[FlightPlan] FlightAware track fetch failed:`, err);
    }
  }

  // Step 2: Try flights endpoint last_position
  if (flight.last_position
      && flight.last_position.latitude != null && flight.last_position.longitude != null) {
    console.log(`[FlightPlan] Using flights last_position: ` +
      `lat=${flight.last_position.latitude.toFixed(2)}, lon=${flight.last_position.longitude.toFixed(2)}`);
    await fetchSingleAircraftForSearch(flight.last_position);
    return;
  }

  // Step 3: Fall back to route corridor between origin and destination
  if (originCoords && destCoords) {
    const midLat = (originCoords.lat + destCoords.lat) / 2;
    const midLon = (originCoords.lon + destCoords.lon) / 2;
    const latSpan = Math.abs(originCoords.lat - destCoords.lat) / 2 + 5;
    const lonSpan = Math.abs(originCoords.lon - destCoords.lon) / 2 + 5;
    console.log(`[FlightPlan] No track or last_position, querying OpenSky along route corridor: ` +
      `center=${midLat.toFixed(1)},${midLon.toFixed(1)} span=±${latSpan.toFixed(1)}lat,±${lonSpan.toFixed(1)}lon`);
    await fetchSingleAircraftForSearch({ latitude: midLat, longitude: midLon }, latSpan, lonSpan);
    return;
  }

  console.log(`[FlightPlan] No position data available — cannot query OpenSky`);
}

// Query OpenSky around a position to find and select the searched aircraft.
// latPad/lonPad default to 10° for last_position searches; callers can pass
// larger values to cover the full origin→destination corridor.
async function fetchSingleAircraftForSearch(lastPos, latPad = 10, lonPad = 10) {
  const bounds = {
    south: Math.max(lastPos.latitude - latPad, -90),
    north: Math.min(lastPos.latitude + latPad, 90),
    west: Math.max(lastPos.longitude - lonPad, -180),
    east: Math.min(lastPos.longitude + lonPad, 180),
  };
  console.log(`[FlightPlan] OpenSky query: bounds=${bounds.south.toFixed(1)},${bounds.west.toFixed(1)} → ${bounds.north.toFixed(1)},${bounds.east.toFixed(1)}`);
  try {
    const data = await window.flightAPI.getStates(bounds);
    if (data.error) {
      console.warn(`[FlightPlan] OpenSky query error: ${data.error}`);
    } else if (!data.states || data.states.length === 0) {
      console.log(`[FlightPlan] OpenSky returned 0 aircraft in search area`);
    } else {
      console.log(`[FlightPlan] OpenSky returned ${data.states.length} aircraft in search area`);
      // Only add the matching aircraft — don't bulk-add everything from the poll
      const target = searchedFlightIdent;
      const now = Date.now() / 1000;
      let found = false;
      // Log all callsigns for debugging
      const callsigns = data.states
        .map(raw => { const s = parseState(raw); return (s.callsign || '').trim(); })
        .filter(cs => cs.length > 0);
      console.log(`[FlightPlan] Callsigns in area: ${callsigns.slice(0, 20).join(', ')}${callsigns.length > 20 ? ` ... (${callsigns.length} total)` : ''}`);
      for (const raw of data.states) {
        const s = parseState(raw);
        if (s.lon == null || s.lat == null) continue;
        const cs = (s.callsign || '').trim().toUpperCase();
        if (cs !== target) continue;
        found = true;
        console.log(`[FlightPlan] Matched! icao=${s.icao24}, callsign="${cs}", pos=${s.lat.toFixed(3)},${s.lon.toFixed(3)}, alt=${s.altitude}`);
        // Create an aircraft entry for the searched flight
        const ac = {
          state: s, entity: null, trailEntities: [],
          extrapolationTrail: null, history: [], granularTrack: null,
          lastTrackFetch: 0, lastKnownAlt: s.altitude || 0,
          lastServerUpdate: now, extrapolatedPos: null,
          _trailHash: '', _iconKey: '', _labelText: '',
        };
        ac.extrapolatedPos = computeExtrapolatedPosition(s, s.timePosition || now, now);
        ac.history.push({ lon: s.lon, lat: s.lat, alt: s.altitude || 0, time: now });
        aircraft.set(s.icao24, ac);
        renderAircraft(new Set([s.icao24]));
        break;
      }
      if (!found) {
        console.log(`[FlightPlan] Callsign "${target}" NOT found among ${data.states.length} OpenSky aircraft`);
      }
    }
  } catch (err) {
    console.warn('[FlightPlan] OpenSky query failed:', err);
  }
  selectSearchedAircraft();
}

// Find and select the matching live aircraft by callsign.
// Called after a flight plan search and also from updateAircraft() if the aircraft
// arrives after the search completes.  Returns true if found.
function selectSearchedAircraft() {
  if (!searchedFlightIdent) return false;
  for (const [icao, ac] of aircraft) {
    const cs = (ac.state.callsign || '').trim().toUpperCase();
    if (cs === searchedFlightIdent) {
      console.log(`[FlightPlan] Found live aircraft: icao=${icao}, callsign="${cs}"`);
      searchedIcao = icao;
      showAircraftInfo(icao);
      return true;
    }
  }
  console.log(`[FlightPlan] Callsign "${searchedFlightIdent}" not found in ${aircraft.size} loaded aircraft`);
  return false;
}

// Fetch the decoded filed route from FlightAware's /route endpoint and draw it
// as a dashed polyline with waypoint markers. Falls back to route string parsing.
// cruiseAltMeters is the filed cruise altitude in meters (null if unknown).
async function fetchAndDisplayFiledRoute(faFlightId, flight, originCoords, destCoords, routeColor, waypointColor, cruiseAltMeters) {
  // Try the /route endpoint first (returns decoded waypoints with lat/lon)
  if (window.flightAPI.getFlightRoute) {
    try {
      const data = await window.flightAPI.getFlightRoute(faFlightId);
      if (!data.error) {
        const fixes = data.fixes || [];
        const validFixes = fixes.filter(f => f.latitude != null && f.longitude != null);

        if (validFixes.length > 0) {
          const alt = cruiseAltMeters || 0;
          // Build the route positions: origin (ground) → fixes (cruise alt) → destination (ground)
          const routePositions = [];
          if (originCoords) {
            routePositions.push(Cesium.Cartesian3.fromDegrees(originCoords.lon, originCoords.lat, 0));
          }
          for (const fix of validFixes) {
            routePositions.push(Cesium.Cartesian3.fromDegrees(fix.longitude, fix.latitude, alt));
          }
          if (destCoords) {
            routePositions.push(Cesium.Cartesian3.fromDegrees(destCoords.lon, destCoords.lat, 0));
          }

          if (routePositions.length >= 2) {
            viewer.entities.suspendEvents();
            try {
              flightPlanEntities.push(viewer.entities.add({
                polyline: {
                  positions: routePositions,
                  width: 3,
                  material: new Cesium.PolylineDashMaterialProperty({
                    color: routeColor,
                    dashLength: 16,
                  }),
                  clampToGround: false,
                },
              }));

              for (const fix of validFixes) {
                flightPlanEntities.push(viewer.entities.add({
                  position: Cesium.Cartesian3.fromDegrees(fix.longitude, fix.latitude, 0),
                  point: { pixelSize: 4, color: waypointColor },
                }));
              }
            } finally {
              viewer.entities.resumeEvents();
            }
            console.log(`[FlightPlan] Displayed filed route with ${validFixes.length} waypoints from /route API at ${alt > 0 ? Math.round(alt * 3.28084).toLocaleString() + ' ft' : 'ground level'}`);
            flyToRouteOverview();
            return; // success — done
          }
        }
      } else {
        console.warn('[FlightPlan] /route endpoint error:', data.error);
      }
    } catch (err) {
      console.warn('[FlightPlan] /route fetch error:', err);
    }
  }

  // Fallback: parse the route string from the flights response using local waypoint DB
  drawRouteFromString(flight.route, originCoords, destCoords, routeColor, waypointColor, cruiseAltMeters);
}

// Parse the filed route string (space-separated waypoint names) and draw using
// local waypoint database lookups. Used as fallback when /route endpoint fails.
// cruiseAltMeters is the filed cruise altitude in meters (null if unknown).
function drawRouteFromString(routeStr, originCoords, destCoords, routeColor, waypointColor, cruiseAltMeters) {
  const alt = cruiseAltMeters || 0;
  const routeWaypoints = [];
  if (routeStr && cachedWaypointData && cachedWaypointData.length > 0) {
    // FlightAware route strings are space-separated: "MAPGP VICUC J65 RBL"
    const wpNames = routeStr.split(/\s+/).filter(w => w.length > 0);
    for (const wpName of wpNames) {
      const wp = cachedWaypointData.find(w => w.id === wpName || w.name === wpName);
      if (wp && wp.lon != null && wp.lat != null) {
        routeWaypoints.push({ name: wpName, lon: wp.lon, lat: wp.lat });
      }
    }
  }

  const routePositions = [];
  if (originCoords) routePositions.push(Cesium.Cartesian3.fromDegrees(originCoords.lon, originCoords.lat, 0));
  for (const wp of routeWaypoints) routePositions.push(Cesium.Cartesian3.fromDegrees(wp.lon, wp.lat, alt));
  if (destCoords) routePositions.push(Cesium.Cartesian3.fromDegrees(destCoords.lon, destCoords.lat, 0));

  if (routePositions.length < 2) return;

  viewer.entities.suspendEvents();
  try {
    flightPlanEntities.push(viewer.entities.add({
      polyline: {
        positions: routePositions,
        width: 3,
        material: new Cesium.PolylineDashMaterialProperty({
          color: routeColor,
          dashLength: 16,
        }),
        clampToGround: false,
      },
    }));
    for (const wp of routeWaypoints) {
      flightPlanEntities.push(viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(wp.lon, wp.lat, 0),
        point: { pixelSize: 4, color: waypointColor },
      }));
    }
  } finally {
    viewer.entities.resumeEvents();
  }
  console.log(`[FlightPlan] Displayed fallback route with ${routeWaypoints.length} waypoints from route string`);
  flyToRouteOverview();
}

function showFlightPlanInfo(flight) {
  const panel = document.getElementById('aircraft-info');
  panel.classList.remove('hidden');

  const ident = flight.ident || flight.ident_iata || '---';
  document.getElementById('info-callsign').textContent = ident;

  const origin = flight.origin;
  const dest = flight.destination;
  const originCode = origin ? (origin.code_iata || origin.code_icao || '??') : '??';
  const destCode = dest ? (dest.code_iata || dest.code_icao || '??') : '??';
  const acType = flight.aircraft_type || '---';
  const status = flight.status || '---';
  const progress = flight.progress_percent != null ? flight.progress_percent + '%' : '---';
  const alt = flight.last_position && flight.last_position.altitude != null
    ? (flight.last_position.altitude * 100).toLocaleString() + ' ft'  // AeroAPI altitude is in hundreds of feet
    : '---';
  const gs = flight.last_position && flight.last_position.groundspeed != null
    ? flight.last_position.groundspeed + ' kts'
    : '---';
  const filedAlt = flight.filed_altitude != null
    ? 'FL' + flight.filed_altitude
    : '---';
  const route = flight.route || '---';
  const depTime = flight.scheduled_out || flight.actual_out || '---';
  const arrTime = flight.scheduled_in || flight.estimated_in || '---';

  document.getElementById('info-details').innerHTML = `
    <div><span class="label">ROUTE</span><span>${originCode} → ${destCode}</span></div>
    <div><span class="label">ACFT TYPE</span><span>${acType}</span></div>
    <div><span class="label">STATUS</span><span>${status}</span></div>
    <div><span class="label">PROGRESS</span><span>${progress}</span></div>
    <div><span class="label">ALT</span><span>${alt}</span></div>
    <div><span class="label">FILED ALT</span><span>${filedAlt}</span></div>
    <div><span class="label">GND SPD</span><span>${gs}</span></div>
    <div><span class="label">DEPART</span><span>${depTime}</span></div>
    <div><span class="label">ARRIVE</span><span>${arrTime}</span></div>
    <div><span class="label">FILED</span><span style="font-size:11px;word-break:break-all">${route}</span></div>
  `;
}

async function searchFlightPlan(ident) {
  if (!ident || ident.trim().length === 0) return;

  const searchInput = document.getElementById('flight-search');
  const searchBtn = document.getElementById('btn-flight-search');
  if (searchBtn) searchBtn.disabled = true;
  if (searchInput) searchInput.disabled = true;

  try {
    if (!window.flightAPI.getFlightPlan) {
      console.warn('[FlightPlan] getFlightPlan not available on this platform');
      return;
    }

    const data = await window.flightAPI.getFlightPlan(ident.trim());
    if (data.error) {
      console.warn(`[FlightPlan] Error: ${data.error}`);
      alert(`Flight search failed: ${data.error}`);
      return;
    }

    if (!data.flights || data.flights.length === 0) {
      alert(`No flights found for "${ident.trim()}"`);
      return;
    }

    console.log(`[FlightPlan] Found ${data.flights.length} flight(s) for ${ident}`);
    const result = displayFlightPlanRoute(data);

    // Try to find and select the matching live aircraft on OpenSky
    if (result) {
      console.log(`[FlightPlan] Looking for live aircraft with callsign "${searchedFlightIdent}"`);
      if (!selectSearchedAircraft()) {
        findAndSelectViaOpenSky(result.flight, result.originCoords, result.destCoords);
      }
    }
  } catch (err) {
    console.error('[FlightPlan] Search error:', err);
    alert('Flight search failed. Check console for details.');
  } finally {
    if (searchBtn) searchBtn.disabled = false;
    if (searchInput) searchInput.disabled = false;
  }
}

// Wire up flight search UI
const flightSearchInput = document.getElementById('flight-search');
const flightSearchBtn = document.getElementById('btn-flight-search');

if (flightSearchBtn) {
  flightSearchBtn.addEventListener('click', () => {
    const val = flightSearchInput ? flightSearchInput.value : '';
    searchFlightPlan(val);
  });
}

if (flightSearchInput) {
  flightSearchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      searchFlightPlan(flightSearchInput.value);
    }
  });
}

function stopTracking() {
  if (!isTracking) return;
  isTracking = false;
  viewer.trackedEntity = undefined;
  const btn = document.getElementById('btn-track');
  if (btn) btn.classList.remove('active');
}

const trackBtn = document.getElementById('btn-track');
if (trackBtn) {
  trackBtn.addEventListener('click', () => {
    if (!selectedIcao) return;
    const ac = aircraft.get(selectedIcao);
    if (!ac || !ac.entity) return;

    if (isTracking) {
      stopTracking();
      return;
    }

    // Stop auto-rotate if active
    if (isRotating) {
      stopRotation();
      const rotateToggle = document.getElementById('toggle-rotate');
      if (rotateToggle) rotateToggle.checked = false;
      isRotating = false;
    }

    isTracking = true;
    trackBtn.classList.add('active');

    const heading = viewer.camera.heading;
    const range = 200000;
    const pitchRad = Cesium.Math.toRadians(35);
    const hDist = range * Math.cos(pitchRad);

    // Set viewFrom so Cesium's EntityView uses our desired offset when
    // tracking initializes (prevents it from overriding flyTo with a
    // default close-up zoom).
    ac.entity.viewFrom = new Cesium.Cartesian3(
      -hDist * Math.sin(heading),
      -hDist * Math.cos(heading),
      range * Math.sin(pitchRad),
    );

    viewer.flyTo(ac.entity, {
      duration: 1.5,
      offset: new Cesium.HeadingPitchRange(heading, -pitchRad, range),
    }).then(() => {
      if (isTracking && selectedIcao) {
        const currentAc = aircraft.get(selectedIcao);
        if (currentAc && currentAc.entity) {
          viewer.trackedEntity = currentAc.entity;
        }
      }
    });
  });
}

const showRouteBtn = document.getElementById('btn-show-route');
if (showRouteBtn) {
  showRouteBtn.addEventListener('click', () => {
    stopTracking();
    if (flightPlanEntities.length > 0) {
      flyToRouteOverview();
    } else if (selectedIcao) {
      const ac = aircraft.get(selectedIcao);
      if (ac && ac.trailEntities && ac.trailEntities.length > 0) {
        viewer.flyTo(ac.trailEntities, {
          duration: 1.5,
          offset: new Cesium.HeadingPitchRange(0, -Math.PI / 2, 0),
        });
      }
    }
  });
}
