// Aircraft selection, info panel, flight plan search, and route display.
// Depends on radar-core.js, radar-aircraft.js.

// ============================================================
// FlightAware Availability Detection
// ============================================================

// Update FlightAware availability flag and toggle dependent UI.
// Called after every FlightAware API response to reactively show/hide features.
function setFlightAwareAvailable(available) {
  const changed = flightAwareAvailable !== available;
  window.flightAwareAvailable = available;
  if (!changed) return;
  const wrap = document.getElementById('flight-search-wrap');
  if (wrap) wrap.style.display = available ? '' : 'none';
  console.log(`[FlightAware] API ${available ? 'available' : 'unavailable'}`);
}

// Probe FlightAware API to determine initial availability.
// Uses a lightweight airport delays call; result also updates the flag.
async function checkFlightAwareAvailability() {
  if (!window.flightAPI || !window.flightAPI.getAirportDelays) {
    setFlightAwareAvailable(false);
    return;
  }
  try {
    const data = await window.flightAPI.getAirportDelays('KJFK');
    setFlightAwareAvailable(!data.error);
  } catch {
    setFlightAwareAvailable(false);
  }
}

function fmtZulu(iso) {
  if (!iso || iso === '?') return '?';
  return iso.replace('T', ' ').replace(/:\d{2}(\.\d+)?Z$/, 'Z');
}

// ============================================================
// Aircraft Selection (click to inspect)
// ============================================================

// Track window focus so the activation click (bringing window to front)
// doesn't accidentally deselect the current aircraft.
window.focusTime = 0;
window.addEventListener('focus', () => { focusTime = Date.now(); });

window.handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
handler.setInputAction((click) => {
  // Ignore clicks within 300ms of the window regaining focus — these are
  // activation clicks that the user intended to bring the window to front,
  // not to deselect the current aircraft.
  if (Date.now() - focusTime < 300) return;
  const picks = viewer.scene.drillPick(click.position);
  for (const picked of picks) {
    if (!Cesium.defined(picked) || !picked.id || !picked.id.id) continue;
    const id = picked.id.id;
    if (id.startsWith('ac-')) {
      showAircraftInfo(id.replace('ac-', ''));
      break;
    } else if (id.startsWith('apt-')) {
      showAirportInfo(picked.id);
      break;
    } else if (id.startsWith('turb-') && !selectedIcao) {
      // Only show turbulence info when no aircraft is selected —
      // the close button is the only way to deselect an aircraft.
      showTurbInfo(picked.id);
      break;
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

// Estimate arrival time when FlightAware doesn't provide estimated_in or scheduled_in.
// Uses (in priority order):
//   1. Progress % + departure time → extrapolate total flight time
//   2. Great-circle distance between origin/dest + ground speed → compute flight time
//   3. Great-circle distance + default cruise speed (450 kts) as last resort
// Returns an ISO date string or null if estimation is not possible.
// DEFAULT_CRUISE_KNOTS is a conservative average ground speed for commercial jets.
window.DEFAULT_CRUISE_KNOTS = 450;
// Minimum progress percentage required for reliable extrapolation.
window.MIN_PROGRESS_FOR_ESTIMATE = 5;

function estimateArrivalTime(flight) {
  const depStr = flight.actual_out || flight.estimated_out || flight.scheduled_out;
  if (!depStr) return null;
  const depMs = new Date(depStr).getTime();
  if (isNaN(depMs)) return null;

  const now = Date.now();

  // Strategy 1: extrapolate from progress percentage
  const progress = flight.progress_percent;
  if (progress != null && progress >= MIN_PROGRESS_FOR_ESTIMATE && progress < 100) {
    const elapsedMs = now - depMs;
    if (elapsedMs > 0) {
      const totalMs = elapsedMs / (progress / 100);
      const estArr = new Date(depMs + totalMs).toISOString();
      console.log(`[FlightPlan] Estimated arrival from ${progress}% progress: ${estArr}`);
      return estArr;
    }
  }

  // Strategy 2/3: distance-based estimation
  const originCoords = lookupAirportCoords(flight.origin);
  const destCoords = lookupAirportCoords(flight.destination);
  if (originCoords && destCoords) {
    // Compute great-circle distance in nautical miles
    const c1 = Cesium.Cartographic.fromDegrees(originCoords.lon, originCoords.lat);
    const c2 = Cesium.Cartographic.fromDegrees(destCoords.lon, destCoords.lat);
    const geodesic = new Cesium.EllipsoidGeodesic(c1, c2);
    const distNm = geodesic.surfaceDistance / 1852; // meters to nautical miles

    // Use ground speed from last_position if available, otherwise default cruise speed
    const gs = (flight.last_position && flight.last_position.groundspeed > 0)
      ? flight.last_position.groundspeed
      : DEFAULT_CRUISE_KNOTS;
    const flightTimeMs = (distNm / gs) * 3600000; // hours to ms
    const estArr = new Date(depMs + flightTimeMs).toISOString();
    console.log(`[FlightPlan] Estimated arrival from distance (${Math.round(distNm)} nm @ ${gs} kts): ${estArr}`);
    return estArr;
  }

  return null;
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
  const arrStr = flight.estimated_in || flight.scheduled_in || estimateArrivalTime(flight);
  const isEstimated = !(flight.estimated_in || flight.scheduled_in) && arrStr;

  const now = Date.now();
  const depTime = depStr ? new Date(depStr) : null;
  const arrTime = arrStr ? new Date(arrStr) : null;

  const elapsed = depTime ? formatDuration(now - depTime.getTime()) : '---';
  const remaining = arrTime ? formatDuration(arrTime.getTime() - now) : '---';
  const eta = arrTime
    ? arrTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZoneName: 'short' })
    : '---';
  const etaLabel = isEstimated ? 'ETA (EST)' : 'ETA';

  const filedAlt = flight.filed_altitude != null ? `FL${flight.filed_altitude}` : null;

  // Insert route rows right after the info-details opening, before ALT
  const routeHTML = `
    <div><span class="label">ROUTE</span><span>${originCode} → ${destCode}</span></div>
    ${filedAlt ? `<div><span class="label">FILED ALT</span><span>${filedAlt}</span></div>` : ''}
    <div><span class="label">ELAPSED</span><span>${elapsed}</span></div>
    <div><span class="label">REMAINING</span><span>${remaining}</span></div>
    <div><span class="label">${etaLabel}</span><span>${eta}</span></div>
  `;
  details.insertAdjacentHTML('afterbegin', routeHTML);
}

function showAircraftInfo(icao) {
  const ac = aircraft.get(icao);
  if (!ac) return;

  // Clear airport filter when selecting an aircraft
  if (selectedAirport) clearAirportFilter();

  const prevSelected = selectedIcao;
  selectedIcao = icao;

  // Add to priority list so it gets dedicated ICAO24-based polling
  priorityIcaos.add(icao);

  const s = ac.state;
  const panel = document.getElementById('aircraft-info');
  const wasHidden = panel.classList.contains('hidden');
  panel.classList.remove('hidden');
  if (wasHidden) {
    panel.classList.remove('collapsed');
    // On mobile default to stowed (mob-collapsed) so user can choose to expand
    if (isMobile()) panel.classList.add('mob-collapsed');
    else panel.classList.remove('mob-collapsed');
  }

  const infoButtons = document.getElementById('info-buttons');
  if (infoButtons) infoButtons.classList.remove('hidden');
  const trackBtn = document.getElementById('btn-track');
  if (trackBtn) { trackBtn.classList.remove('hidden'); trackBtn.disabled = false; }

  document.getElementById('info-callsign').textContent = s.callsign || icao;

  const feetAlt = s.altitude ? Math.round(s.altitude * 3.28084) : null;
  const knots = s.velocity ? Math.round(s.velocity * 1.94384) : null;
  const fpm = s.verticalRate ? Math.round(s.verticalRate * 196.85) : null;

  document.getElementById('info-details').innerHTML = `
    <div><span class="label">ALT</span><span data-field="alt">${feetAlt != null ? feetAlt.toLocaleString() + ' ft' : '---'}</span></div>
    <div><span class="label">GND SPD</span><span>${knots != null ? knots + ' kts' : '---'}</span></div>
    <div><span class="label">HDG</span><span>${s.heading != null ? Math.round(s.heading) + '°' : '---'}</span></div>
    <div><span class="label">VS</span><span>${fpm != null ? (fpm > 0 ? '+' : '') + fpm + ' fpm' : '---'}</span></div>
    <div><span class="label">POS</span><span><span data-field="lat">${s.lat.toFixed(4)}</span>/<span data-field="lon">${s.lon.toFixed(4)}</span></span></div>
    <div><span class="label">LAST POLL</span><span>${lastPollTime ? lastPollTime.toLocaleTimeString('en-US', { hour12: false }) : '---'}</span></div>
    <div><span class="label">ADS-B</span><span>${s.lastContact ? new Date(s.lastContact * 1000).toLocaleTimeString('en-US', { hour12: false }) : '---'}</span></div>
  `;

  // Re-apply persisted route info (ROUTE/ELAPSED/REMAINING/ETA) after innerHTML rebuild
  if (selectedRouteFlight) updateInfoPanelRoute(selectedRouteFlight);

  // Fetch full track history only on initial selection (not on every info refresh)
  if (prevSelected !== icao && !trackFetchQueue.includes(icao)) {
    // Set pending zoom before both async calls; cleared if a flight plan is found
    pendingHistoryZoom = icao;
    trackFetchQueue.unshift(icao);
    fetchNextTrack();
  }

  // Stop tracking when selecting a different aircraft
  if (prevSelected !== icao) {
    stopTracking();
    // Apply altitude-based weather filter for newly selected aircraft
    updateLiveAltitudeFilter(true);
  }

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

// ============================================================
// Airport Selection & Flight Filtering
// ============================================================

function showAirportInfo(entity) {
  const p = entity.properties;
  if (!p) return;
  const icao = p.icao ? p.icao.getValue() : '';
  const iata = p.iata ? p.iata.getValue() : '';
  const name = p.name ? p.name.getValue() : '';
  const type = p.type ? p.type.getValue() : '';
  const lat = p.lat ? p.lat.getValue() : 0;
  const lon = p.lon ? p.lon.getValue() : 0;

  // Clear any previous airport filter
  clearAirportFilter();

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

  // Clear any flight plan route
  clearFlightPlanRoute();

  // Store selected airport
  selectedAirport = { icao, iata, name, type, lat, lon };

  // Highlight the selected airport entity — green by default, updated by delay fetch
  if (entity.point) {
    entity._origPointColor = entity.point.color.getValue(Cesium.JulianDate.now());
    entity._origPointSize = entity.point.pixelSize.getValue(Cesium.JulianDate.now());
    entity.point.color = Cesium.Color.LIME;
    entity.point.outlineColor = Cesium.Color.BLACK;
    entity.point.outlineWidth = 2;
    entity.point.pixelSize = entity._origPointSize * 1.5;
  }
  // Store reference so delay fetch can update the color
  selectedAirport._entity = entity;

  // Show info panel
  const typeLabel = type === 'L' ? 'Large' : type === 'M' ? 'Medium' : 'Small';
  const codeDisplay = iata ? `${icao} / ${iata}` : icao;
  const panel = document.getElementById('aircraft-info');
  const wasHidden = panel.classList.contains('hidden');
  panel.classList.remove('hidden');
  panel.classList.remove('collapsed');
  if (wasHidden) {
    if (isMobile()) panel.classList.add('mob-collapsed');
    else panel.classList.remove('mob-collapsed');
  }
  const infoButtons = document.getElementById('info-buttons');
  if (infoButtons) infoButtons.classList.add('hidden');

  document.getElementById('info-callsign').textContent = codeDisplay;
  document.getElementById('info-details').innerHTML = `
    <div><span class="label">AIRPORT</span><span>${name || icao}</span></div>
    <div><span class="label">TYPE</span><span>${typeLabel}</span></div>
    ${flightAwareAvailable ? '<div class="airport-flights-status"><span class="label">FLIGHTS</span><span>Loading...</span></div>' : ''}
    ${flightAwareAvailable ? '<div class="airport-delay-status"><span class="label">DELAYS</span><span>Loading...</span></div>' : ''}
  `;

  // Fetch flights and delays from FlightAware (skipped if unavailable)
  fetchAirportFlights(icao);
  fetchAirportDelays(icao);
}

// Compute great-circle distance in km between two lat/lon points.
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}


async function fetchAirportFlights(icao) {
  if (!window.flightAPI.getAirportFlights || !flightAwareAvailable) {
    return;
  }

  try {
    console.log(`[Airport] Fetching arrivals & departures for ${icao}...`);

    // Combined /airports/{id}/flights returns four arrays:
    // arrivals (recently landed), departures (recently departed),
    // scheduled_arrivals (scheduled/en-route inbound), scheduled_departures.
    const data = await window.flightAPI.getAirportFlights(icao);

    // Bail if user closed the airport panel or selected a different airport
    if (!selectedAirport || selectedAirport.icao !== icao) return;

    if (data.error) {
      console.warn(`[Airport] Flights error: ${data.error}`);
      setFlightAwareAvailable(false);
      updateAirportFlightsStatus(data.error);
      return;
    }
    setFlightAwareAvailable(true);

    // Filter to en-route only (progress > 0 and < 100, or departed but not arrived)
    const enRouteFilter = f => {
      if (f.progress_percent != null) return f.progress_percent > 0 && f.progress_percent < 100;
      return f.actual_off && !f.actual_on;
    };

    // En-route inbound flights may be in arrivals OR scheduled_arrivals.
    // En-route outbound flights may be in departures OR scheduled_departures.
    const allInbound = [...(data.arrivals || []), ...(data.scheduled_arrivals || [])];
    const allOutbound = [...(data.departures || []), ...(data.scheduled_departures || [])];
    // Deduplicate by fa_flight_id
    const dedup = (flights) => {
      const seen = new Set();
      return flights.filter(f => {
        const id = f.fa_flight_id || f.ident;
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      });
    };

    let arrivals = dedup(allInbound).filter(enRouteFilter);
    let departures = dedup(allOutbound).filter(enRouteFilter);

    console.log(`[Airport] ${icao} raw: arrivals=${(data.arrivals||[]).length}, scheduled_arrivals=${(data.scheduled_arrivals||[]).length}, departures=${(data.departures||[]).length}, scheduled_departures=${(data.scheduled_departures||[]).length}`);
    console.log(`[Airport] ${icao} en-route after filter: ${arrivals.length} inbound, ${departures.length} outbound`);

    // Sort by proximity to the airport — closest flights first.
    // Arrivals: closest to landing (nearest to airport).
    // Departures: most recently took off (also nearest to airport).
    const aptLat = selectedAirport.lat;
    const aptLon = selectedAirport.lon;

    const distanceFromAirport = (f) => {
      if (f.last_position && f.last_position.latitude != null && f.last_position.longitude != null) {
        return haversineKm(aptLat, aptLon, f.last_position.latitude, f.last_position.longitude);
      }
      return Infinity;
    };

    arrivals.sort((a, b) => distanceFromAirport(a) - distanceFromAirport(b));
    departures.sort((a, b) => distanceFromAirport(a) - distanceFromAirport(b));

    airportFlightsData = { arrivals, departures };

    // Build callsign set
    const callsigns = new Set();
    for (const f of arrivals) {
      const cs = (f.ident || '').trim().toUpperCase();
      if (cs) callsigns.add(cs);
    }
    for (const f of departures) {
      const cs = (f.ident || '').trim().toUpperCase();
      if (cs) callsigns.add(cs);
    }

    console.log(`[Airport] ${icao}: ${arrivals.length} arriving, ${departures.length} departing, ${callsigns.size} unique callsigns`);

    // Update info panel
    const details = document.getElementById('info-details');
    if (details && selectedAirport && selectedAirport.icao === icao) {
      const statusEl = details.querySelector('.airport-flights-status');
      if (statusEl) {
        statusEl.innerHTML = `<span class="label">EN ROUTE</span><span>${arrivals.length} arriving, ${departures.length} departing</span>`;
      }
    }

    // Apply filter and populate priority ICAO24 list
    if (callsigns.size > 0) {
      airportFilterCallsigns = callsigns;
      priorityIcaos.clear();

      // Scan existing aircraft Map for immediate callsign→ICAO24 matches
      for (const [existingIcao, ac] of aircraft) {
        const cs = (ac.state.callsign || '').trim().toUpperCase();
        if (cs && callsigns.has(cs)) {
          priorityIcaos.add(existingIcao);
        }
      }

      // Discovery poll: fetch a region around the airport to find more ICAO24s
      // for airport flights not already in the aircraft Map
      if (priorityIcaos.size < callsigns.size && selectedAirport) {
        const apLat = selectedAirport.lat;
        const apLon = selectedAirport.lon;
        const pad = 8; // ~500nm radius around airport
        const discoveryBounds = {
          south: Math.max(apLat - pad, -90), north: Math.min(apLat + pad, 90),
          west: Math.max(apLon - pad, -180), east: Math.min(apLon + pad, 180),
        };
        try {
          const dData = await window.flightAPI.getStates(discoveryBounds, 'bulk');
          // Bail if user closed the airport panel during discovery
          if (!selectedAirport || selectedAirport.icao !== icao) return;
          if (!dData.error && dData.states) {
            const nowS = Date.now() / 1000;
            viewer.entities.suspendEvents();
            try {
              for (const raw of dData.states) {
                const s = parseState(raw);
                if (s.lon == null || s.lat == null || s.onGround) continue;
                const cs = (s.callsign || '').trim().toUpperCase();
                if (cs && callsigns.has(cs)) {
                  priorityIcaos.add(s.icao24);
                  // Create aircraft entry if it doesn't exist
                  let ac = aircraft.get(s.icao24);
                  if (!ac) {
                    ac = {
                      state: s, entity: null, trailEntities: [], extrapolationTrail: null,
                      history: [], granularTrack: null, lastTrackFetch: 0,
                      lastKnownAlt: s.altitude || 0, lastServerUpdate: nowS,
                      extrapolatedPos: null, _trailHash: '', _iconKey: '', _labelText: '',
                    };
                    aircraft.set(s.icao24, ac);
                  } else {
                    ac.state = s;
                    ac.lastServerUpdate = nowS;
                  }
                  const alt = s.altitude != null ? s.altitude : (ac.lastKnownAlt || 0);
                  if (s.altitude != null) ac.lastKnownAlt = s.altitude;
                  ac.history.push({ lon: s.lon, lat: s.lat, alt, time: nowS });
                }
              }
            } finally {
              viewer.entities.resumeEvents();
            }
          }
        } catch (e) {
          console.warn('[Airport] Discovery poll error:', e);
        }
      }

      console.log(`[Airport] Discovered ${priorityIcaos.size}/${callsigns.size} priority ICAO24s`);

      // Update HUD
      lastPollTime = new Date();
      document.getElementById('track-count').textContent = priorityIcaos.size;
      document.getElementById('last-update').textContent =
        lastPollTime.toLocaleTimeString('en-US', { hour12: false });

      // Render discovered priority aircraft and hide non-priority
      renderAircraft();
      if (CONFIG.aircraftEnabled) {
        applyAirportFilter();
      }

      // Start tick for ongoing priority polling
      startPolling();
    } else {
      updateAirportFlightsStatus('No en-route flights found');
    }
  } catch (err) {
    console.error('[Airport] Fetch error:', err);
    if (selectedAirport && selectedAirport.icao === icao) {
      updateAirportFlightsStatus('Failed to load flights');
    }
  }
}

function updateAirportFlightsStatus(msg) {
  const details = document.getElementById('info-details');
  if (!details) return;
  const statusEl = details.querySelector('.airport-flights-status');
  if (statusEl) {
    statusEl.innerHTML = `<span class="label">FLIGHTS</span><span>${msg}</span>`;
  }
}

// Compute a Cesium.Color for a delay duration in minutes.
// 0 min → dark (no delay), ~15 min → orange, 30+ min → red.
function delayColor(delayMinutes) {
  if (!delayMinutes || delayMinutes <= 0) return null; // no delay
  const t = Math.min(delayMinutes / 45, 1); // 0..1 over 0..45 min
  // Interpolate: orange (#FF9800) at t=0 → red (#D32F2F) at t=1
  const r = Math.round(255 - t * (255 - 211));
  const g = Math.round(152 - t * (152 - 47));
  const b = Math.round(0 + t * (47 - 0));
  return Cesium.Color.fromBytes(r, g, b);
}

// Format delay duration for display
function formatDelayMinutes(mins) {
  if (mins == null) return '';
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

// Fetch and display airport delays in the info panel.
// Returns the delay data for reuse (e.g., by flight plan marker coloring).
async function fetchAirportDelays(icao) {
  if (!window.flightAPI.getAirportDelays || !flightAwareAvailable) {
    console.log(`[Airport] Skipping delay fetch for ${icao} (API ${!window.flightAPI.getAirportDelays ? 'missing' : 'unavailable'})`);
    return null;
  }

  try {
    console.log(`[Airport] Fetching delays for ${icao}...`);
    const data = await window.flightAPI.getAirportDelays(icao);

    // Bail if user closed or switched airport
    if (!selectedAirport || selectedAirport.icao !== icao) return null;

    if (data.error) {
      console.warn(`[Airport] Delays error: ${data.error}`);
      setFlightAwareAvailable(false);
      // Remove the loading row on error
      const loadingRow = document.querySelector('.airport-delay-status');
      if (loadingRow) loadingRow.remove();
      return null;
    }
    setFlightAwareAvailable(true);

    const delays = data.delays || [];
    console.log(`[Airport] Delays for ${icao}: ${delays.length} reason(s)`, delays);
    const details = document.getElementById('info-details');
    if (!details) return delays;

    // Remove the loading row
    const loadingRow = details.querySelector('.airport-delay-status');
    if (loadingRow) loadingRow.remove();

    if (delays.length === 0) {
      // Show "No delays" row
      const row = document.createElement('div');
      row.className = 'airport-delay-row';
      row.innerHTML = `<span class="label">DELAYS</span><span style="color: var(--md-on-surface-variant)">None</span>`;
      details.appendChild(row);
    } else {
      for (const d of delays) {
        const avg = d.delay_secs != null ? Math.round(d.delay_secs / 60) : null;
        const reason = d.reason || '';
        const color = avg != null && avg > 0 ? delayColor(avg) : null;
        const cssColor = color ? color.toCssColorString() : 'var(--md-on-surface-variant)';

        const row = document.createElement('div');
        row.className = 'airport-delay-row';
        let html = `<span class="label">DELAY</span>`;
        const parts = [];
        if (avg != null) parts.push(`<span style="color:${cssColor};font-weight:600">${formatDelayMinutes(avg)}</span>`);
        if (reason) parts.push(reason);
        html += `<span>${parts.join(' — ')}</span>`;
        row.innerHTML = html;
        details.appendChild(row);
      }
    }

    // Update the selected airport marker color based on worst delay
    if (selectedAirport && selectedAirport._entity && selectedAirport._entity.point) {
      let worstMins = 0;
      for (const d of delays) {
        if (d.delay_secs != null) worstMins = Math.max(worstMins, d.delay_secs / 60);
      }
      worstMins = Math.round(worstMins);
      const markerColor = worstMins > 0 ? delayColor(worstMins) : Cesium.Color.LIME;
      selectedAirport._entity.point.color = markerColor;
    }

    return delays;
  } catch (err) {
    console.error('[Airport] Delays fetch error:', err);
    // Remove the loading row on error
    const loadingRow = document.querySelector('.airport-delay-status');
    if (loadingRow) loadingRow.remove();
    return null;
  }
}

// Fetch delays for a single airport code.  Returns the worst delay in minutes, or 0.
async function getAirportDelayMinutes(airportCode) {
  if (!airportCode || !window.flightAPI.getAirportDelays || !flightAwareAvailable) return 0;
  try {
    const data = await window.flightAPI.getAirportDelays(airportCode);
    if (data.error) { setFlightAwareAvailable(false); return 0; }
    setFlightAwareAvailable(true);
    if (!data.delays || data.delays.length === 0) return 0;
    let worst = 0;
    for (const d of data.delays) {
      if (d.delay_secs != null) worst = Math.max(worst, d.delay_secs / 60);
    }
    return Math.round(worst);
  } catch {
    return 0;
  }
}

function applyAirportFilter() {
  if (priorityIcaos.size === 0) return;
  viewer.entities.suspendEvents();
  try {
    for (const [icao, ac] of aircraft) {
      if (!ac.entity) continue;
      const isSelected = icao === selectedIcao;
      if (isSelected) continue; // selected aircraft always visible
      const visible = priorityIcaos.has(icao);
      ac.entity.show = visible;
      if (ac.extrapolationTrail) ac.extrapolationTrail.show = visible;
      for (const trail of ac.trailEntities) trail.show = visible;
    }
  } finally {
    viewer.entities.resumeEvents();
  }
}

function clearAirportFilter() {
  // Restore highlighted airport entity to its original style
  if (selectedAirport) {
    const aptId = `apt-${selectedAirport.icao}`;
    const aptEntity = viewer.entities.getById(aptId);
    if (aptEntity && aptEntity.point && aptEntity._origPointColor) {
      aptEntity.point.color = aptEntity._origPointColor;
      aptEntity.point.pixelSize = aptEntity._origPointSize;
      aptEntity.point.outlineColor = getAirportOutlineColor();
      aptEntity.point.outlineWidth = getAirportOutlineWidth();
      delete aptEntity._origPointColor;
      delete aptEntity._origPointSize;
    }
  }

  const hadFilter = airportFilterCallsigns !== null;
  const hadPriority = priorityIcaos.size > 0;
  const wasAircraftOff = !CONFIG.aircraftEnabled;
  selectedAirport = null;
  airportFilterCallsigns = null;
  airportFlightsData = null;

  // Clear priority list but keep selected/searched aircraft
  const keepSelected = selectedIcao;
  const keepSearched = searchedIcao;
  priorityIcaos.clear();
  if (keepSelected) priorityIcaos.add(keepSelected);
  if (keepSearched) priorityIcaos.add(keepSearched);

  // If aircraft toggle is off, clean up the filtered/priority aircraft (restore "off" state)
  if ((hadFilter || hadPriority) && wasAircraftOff) {
    _renderGeneration++;
    _pollInFlight = false;
    const keepIcao = selectedIcao || searchedIcao;
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
    for (const icao of [...aircraft.keys()]) {
      if (icao !== keepIcao) aircraft.delete(icao);
    }
    document.getElementById('track-count').textContent = keepIcao ? '1' : '0';
    if (viewChangePollDebounce) { clearTimeout(viewChangePollDebounce); viewChangePollDebounce = null; }
    if (keepIcao) {
      ensureTick();
    } else {
      stopTick();
    }
  } else if (hadFilter || hadPriority) {
    // Re-show all aircraft if a filter/priority was active and aircraft toggle is on
    viewer.entities.suspendEvents();
    try {
      for (const [, ac] of aircraft) {
        if (!ac.entity) continue;
        ac.entity.show = true;
        if (ac.extrapolationTrail) ac.extrapolationTrail.show = true;
        for (const trail of ac.trailEntities) trail.show = true;
      }
    } finally {
      viewer.entities.resumeEvents();
    }
  }
}

function showTurbInfo(entity) {
  const p = entity.properties;
  if (!p) return;
  const type = p.turbType ? p.turbType.getValue() : '?';
  const panel = document.getElementById('aircraft-info');
  const wasHidden = panel.classList.contains('hidden');
  panel.classList.remove('hidden');
  panel.classList.remove('collapsed');
  if (wasHidden) {
    if (isMobile()) panel.classList.add('mob-collapsed');
    else panel.classList.remove('mob-collapsed');
  }
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
    document.getElementById('info-callsign').textContent = 'PIREP';
    document.getElementById('info-details').innerHTML = `
      <div><span class="label">TYPE</span><span>TURB</span></div>
      <div><span class="label">INTENSITY</span><span>${p.intensity.getValue()}</span></div>
      <div><span class="label">FL</span><span>${p.fltlvl.getValue()}</span></div>
      <div><span class="label">ACFT</span><span>${p.acType.getValue()}</span></div>
      <div><span class="label">TIME</span><span>${p.obsTime.getValue()}</span></div>
    `;
  } else if (type === 'SIGMET' || type === 'CONVECTIVE SIGMET') {
    const hazard = p.hazard.getValue();
    document.getElementById('info-callsign').textContent = 'SIGMET';
    const from = p.validFrom.getValue();
    const to = p.validTo.getValue();
    document.getElementById('info-details').innerHTML = `
      <div><span class="label">HAZARD</span><span>${hazard}</span></div>
      <div><span class="label">SEVERITY</span><span>${p.severity.getValue()}</span></div>
      <div><span class="label">BASE</span><span>${p.base.getValue()}</span></div>
      <div><span class="label">TOP</span><span>${p.top.getValue()}</span></div>
      <div><span class="label">FROM</span><span>${fmtZulu(from)}</span></div>
      <div><span class="label">TO</span><span>${fmtZulu(to)}</span></div>
    `;
  } else if (type === 'G-AIRMET') {
    document.getElementById('info-callsign').textContent = 'AIRMET';
    document.getElementById('info-details').innerHTML = `
      <div><span class="label">HAZARD</span><span>${p.hazard.getValue()}</span></div>
      <div><span class="label">SEVERITY</span><span>${p.severity.getValue()}</span></div>
      <div><span class="label">BASE</span><span>${p.base.getValue()}</span></div>
      <div><span class="label">TOP</span><span>FL${p.top.getValue()}</span></div>
      <div><span class="label">VALID</span><span>${fmtZulu(p.validFrom.getValue())}</span></div>
    `;
  }
}

function hideAircraftInfo() {
  stopTracking();
  pendingHistoryZoom = null;
  const prevIcao = selectedIcao;
  selectedIcao = null;

  // Remove deselected aircraft from priority list (unless airport filter keeps it)
  if (prevIcao) {
    if (!airportFilterCallsigns) {
      priorityIcaos.delete(prevIcao);
    }
  }

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
    // If aircraft toggle is off (and no priority/filter), remove the deselected
    // aircraft entirely (it was only kept because it was selected). Otherwise re-render.
    if (!aircraftActive()) {
      aircraft.delete(prevIcao);
      document.getElementById('track-count').textContent = '0';
    } else {
      renderAircraft(new Set([prevIcao]));
    }
  }
  // Stop tick if nothing needs it (no selected aircraft, display off)
  if (!aircraftActive()) stopTick();
  // Clear altitude-based weather filter (no aircraft selected → show all)
  updateLiveAltitudeFilter();
}

document.getElementById('info-close').addEventListener('click', () => {
  if (selectedAirport) {
    clearAirportFilter();
  }
  clearFlightPlanRoute();
  hideAircraftInfo();
  hideFlightResults();
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
  if (!window.flightAPI.getFlightPlan || !flightAwareAvailable) {
    return;
  }

  try {
    const data = await window.flightAPI.getFlightPlan(callsign.trim());
    if (data.error) { setFlightAwareAvailable(false); return; }
    setFlightAwareAvailable(true);
    if (!data.flights || data.flights.length === 0) return;
    // Flight plan found — cancel any pending history zoom
    pendingHistoryZoom = null;

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
    console.log(`[FlightPlan] Candidate: ${f.ident} | status=${f.status || '?'} | progress=${f.progress_percent ?? '?'}% | ` +
      `dep=${f.scheduled_out || f.actual_off || '?'} | arr=${f.scheduled_in || f.actual_on || '?'} | fa_id=${f.fa_flight_id}`);
  }

  // 1. Currently in the air — has departed but not arrived, or has a recent position
  const enRoute = flights.find(f => {
    if (f.progress_percent != null) return f.progress_percent > 0 && f.progress_percent < 100;
    return f.actual_off && !f.actual_on;
  });
  if (enRoute) {
    console.log(`[FlightPlan] Picked en-route flight: ${enRoute.fa_flight_id}`);
    return enRoute;
  }

  // 2. Not yet departed — upcoming/filed/scheduled
  const upcoming = flights
    .filter(f => {
      if (f.progress_percent != null) return f.progress_percent === 0;
      return !f.actual_off && !f.actual_on;
    })
    .sort((a, b) => {
      const da = new Date(a.scheduled_out || a.estimated_out || a.actual_off || 0);
      const db = new Date(b.scheduled_out || b.estimated_out || b.actual_off || 0);
      return da - db;
    });
  if (upcoming.length > 0) {
    console.log(`[FlightPlan] Picked upcoming flight: ${upcoming[0].fa_flight_id} (${upcoming.length} candidates)`);
    return upcoming[0];
  }

  // 3. Not yet arrived — arrival time is in the future (catches scheduled,
  //    delayed, and taxiing flights even if scheduled_out is already past)
  const notArrived = flights
    .filter(f => {
      const arr = f.scheduled_in || f.estimated_in || f.actual_on;
      if (!arr) return false;
      if (f.progress_percent != null && f.progress_percent >= 100) return false;
      return new Date(arr) > now;
    })
    .sort((a, b) => {
      const da = new Date(a.scheduled_out || a.estimated_out || a.actual_off || a.scheduled_in);
      const db = new Date(b.scheduled_out || b.estimated_out || b.actual_off || b.scheduled_in);
      return da - db;
    });
  if (notArrived.length > 0) {
    console.log(`[FlightPlan] Picked not-yet-arrived flight: ${notArrived[0].fa_flight_id} (${notArrived.length} candidates)`);
    return notArrived[0];
  }

  // 4. Fallback to most recent (first in the array — AeroAPI returns reverse-chronological)
  console.log(`[FlightPlan] Fallback to most recent flight: ${flights[0].fa_flight_id}`);
  return flights[0];
}

// Fly the camera to show the aircraft's track history from above.
// Computes a bounding rectangle from all history + granular track points,
// adds 10% margin, and flies to that view. Falls back to the aircraft entity.
function flyToTrackHistory(icao) {
  const ac = aircraft.get(icao);
  if (!ac) return;

  // Collect all known positions (polled history + granular track)
  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
  let count = 0;

  for (const p of ac.history) {
    if (p.lat != null && p.lon != null) {
      minLat = Math.min(minLat, p.lat); maxLat = Math.max(maxLat, p.lat);
      minLon = Math.min(minLon, p.lon); maxLon = Math.max(maxLon, p.lon);
      count++;
    }
  }
  if (ac.granularTrack && ac.granularTrack.path) {
    for (const wp of ac.granularTrack.path) {
      // wp: [time, lat, lon, baro_alt, heading, on_ground]
      if (wp[1] != null && wp[2] != null) {
        minLat = Math.min(minLat, wp[1]); maxLat = Math.max(maxLat, wp[1]);
        minLon = Math.min(minLon, wp[2]); maxLon = Math.max(maxLon, wp[2]);
        count++;
      }
    }
  }
  // Include current position
  if (ac.state && ac.state.lat != null && ac.state.lon != null) {
    minLat = Math.min(minLat, ac.state.lat); maxLat = Math.max(maxLat, ac.state.lat);
    minLon = Math.min(minLon, ac.state.lon); maxLon = Math.max(maxLon, ac.state.lon);
    count++;
  }

  if (count >= 2) {
    // Add 10% margin
    const latPad = (maxLat - minLat) * 0.1 || 0.5;
    const lonPad = (maxLon - minLon) * 0.1 || 0.5;
    const rect = Cesium.Rectangle.fromDegrees(
      minLon - lonPad, minLat - latPad,
      maxLon + lonPad, maxLat + latPad
    );
    viewer.camera.flyTo({
      destination: rect,
      duration: 1.5,
      orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
    });
  } else if (ac.entity) {
    viewer.flyTo(ac.entity, {
      duration: 1.5,
      offset: new Cesium.HeadingPitchRange(0, -Math.PI / 2, 50000),
    });
  }
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
  if (typeof hideTimeline === 'function') hideTimeline();
  viewer.entities.suspendEvents();
  try {
    for (const e of flightPlanEntities) viewer.entities.remove(e);
  } finally {
    viewer.entities.resumeEvents();
  }
  flightPlanEntities.length = 0;
  timelineRoutePoints.length = 0;
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
// originDelayColor/destDelayColor override the default point colors when delays exist.
function drawFlightPlanMarkers(origin, dest, originCoords, destCoords, waypointColor, originDelayColor, destDelayColor) {
  const defaultOriginColor = Cesium.Color.LIME;
  const defaultDestColor = Cesium.Color.LIME;
  // Use black when no delay, or the delay color if present
  const originPointColor = originDelayColor || defaultOriginColor;
  const destPointColor = destDelayColor || defaultDestColor;

  viewer.entities.suspendEvents();
  try {
    if (originCoords) {
      const originLabel = (origin && (origin.code_iata || origin.code_icao || origin.code)) || 'DEP';
      flightPlanEntities.push(viewer.entities.add({
        id: '_fp_origin',
        position: Cesium.Cartesian3.fromDegrees(originCoords.lon, originCoords.lat),
        point: { pixelSize: 10, color: originPointColor, outlineColor: Cesium.Color.BLACK, outlineWidth: 1 },
        label: {
          text: originLabel,
          font: labelFont(13, 700),
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
        id: '_fp_dest',
        position: Cesium.Cartesian3.fromDegrees(destCoords.lon, destCoords.lat),
        point: { pixelSize: 10, color: destPointColor, outlineColor: Cesium.Color.BLACK, outlineWidth: 1 },
        label: {
          text: destLabel,
          font: labelFont(13, 700),
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

// Fetch delays for origin/destination airports and update the flight plan marker
// point colors: black for no delays, orange→red gradient based on delay severity.
async function updateFlightPlanDelayColors(origin, dest) {
  const originCode = origin && (origin.code_icao || origin.code || '');
  const destCode = dest && (dest.code_icao || dest.code || '');
  if (!originCode && !destCode) return;

  // Fetch both in parallel
  const [originMins, destMins] = await Promise.all([
    getAirportDelayMinutes(originCode),
    getAirportDelayMinutes(destCode),
  ]);

  // Update existing entities by id
  const originEntity = viewer.entities.getById('_fp_origin');
  const destEntity = viewer.entities.getById('_fp_dest');

  if (originEntity && originEntity.point) {
    const color = originMins > 0 ? delayColor(originMins) : Cesium.Color.LIME;
    originEntity.point.color = color;
  }
  if (destEntity && destEntity.point) {
    const color = destMins > 0 ? delayColor(destMins) : Cesium.Color.LIME;
    destEntity.point.color = color;
    if (destMins > 0) destEntity.point.outlineColor = Cesium.Color.BLACK;
  }
}

// Draw a flight plan route on the map. Picks the best flight from the response,
// draws origin/dest markers and the filed route polyline, and flies to it.
// Returns { flight, originCoords, destCoords } so callers can use them, or null.
function displayFlightPlanRoute(flightData, preSelectedFlight = null) {
  clearFlightPlanRoute();
  activeFlightPlan = flightData;
  refreshTurbLevel();

  // Find the best flight from the response (prefer en-route, then next upcoming)
  const flights = flightData.flights || [];
  if (flights.length === 0) return null;

  const flight = preSelectedFlight || pickBestFlight(flights);

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

  // Fetch delays for origin/dest and update marker colors asynchronously
  updateFlightPlanDelayColors(origin, dest);

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

  // Show the timeline scrubbing UI if available
  if (typeof showTimeline === 'function') showTimeline(flight);

  return { flight, originCoords, destCoords };
}

// Locate the searched aircraft on OpenSky.  First fetches the FlightAware
// actual track to get the aircraft's real current position (more accurate and
// timely than the flights endpoint's last_position).  Falls back to the
// origin→destination route corridor if no track is available.
async function findAndSelectViaOpenSky(flight, originCoords, destCoords) {
  // Step 1: Try FlightAware /track endpoint for real-time position
  if (flight.fa_flight_id && window.flightAPI.getFlightTrack && flightAwareAvailable) {
    try {
      console.log(`[FlightPlan] Fetching FlightAware track for ${flight.fa_flight_id}`);
      const trackData = await window.flightAPI.getFlightTrack(flight.fa_flight_id);
      if (trackData.error) setFlightAwareAvailable(false);
      else setFlightAwareAvailable(true);
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
  // Mark both renderer-side rate limiters so pollStates/pollSelectedAircraft
  // know the main process was just called and don't immediately collide.
  _lastBulkPollMs = Date.now();
  _lastSelectedPollApiMs = Date.now();
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
  if (window.flightAPI.getFlightRoute && flightAwareAvailable) {
    try {
      const data = await window.flightAPI.getFlightRoute(faFlightId);
      if (data.error) { setFlightAwareAvailable(false); }
      else { setFlightAwareAvailable(true); }
      if (!data.error) {
        const fixes = data.fixes || [];
        const validFixes = fixes.filter(f => f.latitude != null && f.longitude != null);

        if (validFixes.length > 0) {
          const alt = cruiseAltMeters || 0;
          // Build the route positions: origin (ground) → fixes (cruise alt) → destination (ground)
          const routePositions = [];
          timelineRoutePoints.length = 0;
          if (originCoords) {
            routePositions.push(Cesium.Cartesian3.fromDegrees(originCoords.lon, originCoords.lat, 0));
            timelineRoutePoints.push({ lon: originCoords.lon, lat: originCoords.lat, alt: 0 });
          }
          for (const fix of validFixes) {
            routePositions.push(Cesium.Cartesian3.fromDegrees(fix.longitude, fix.latitude, exAlt(alt)));
            timelineRoutePoints.push({ lon: fix.longitude, lat: fix.latitude, alt });
          }
          if (destCoords) {
            routePositions.push(Cesium.Cartesian3.fromDegrees(destCoords.lon, destCoords.lat, 0));
            timelineRoutePoints.push({ lon: destCoords.lon, lat: destCoords.lat, alt: 0 });
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
  timelineRoutePoints.length = 0;
  if (originCoords) {
    routePositions.push(Cesium.Cartesian3.fromDegrees(originCoords.lon, originCoords.lat, 0));
    timelineRoutePoints.push({ lon: originCoords.lon, lat: originCoords.lat, alt: 0 });
  }
  for (const wp of routeWaypoints) {
    routePositions.push(Cesium.Cartesian3.fromDegrees(wp.lon, wp.lat, alt));
    timelineRoutePoints.push({ lon: wp.lon, lat: wp.lat, alt });
  }
  if (destCoords) {
    routePositions.push(Cesium.Cartesian3.fromDegrees(destCoords.lon, destCoords.lat, 0));
    timelineRoutePoints.push({ lon: destCoords.lon, lat: destCoords.lat, alt: 0 });
  }

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
  const wasHidden = panel.classList.contains('hidden');
  panel.classList.remove('hidden');
  panel.classList.remove('collapsed');
  if (wasHidden) {
    if (isMobile()) panel.classList.add('mob-collapsed');
    else panel.classList.remove('mob-collapsed');
  }
  const infoButtons = document.getElementById('info-buttons');
  if (infoButtons) infoButtons.classList.remove('hidden');
  const trackBtn = document.getElementById('btn-track');
  if (trackBtn) { trackBtn.classList.remove('hidden'); trackBtn.disabled = true; }

  // Store route flight for potential later use if aircraft appears
  selectedRouteFlight = flight;

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
  const depStr = flight.actual_out || flight.scheduled_out;
  const arrStr = flight.estimated_in || flight.scheduled_in || estimateArrivalTime(flight);
  const isEstimated = !(flight.estimated_in || flight.scheduled_in) && arrStr;
  const fmtOpts = { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false };
  const depTime = depStr ? new Date(depStr).toLocaleString('en-US', fmtOpts) : '---';
  const arrTime = arrStr ? new Date(arrStr).toLocaleString('en-US', fmtOpts) : '---';
  const arrLabel = isEstimated ? 'ARRIVE (EST)' : 'ARRIVE';

  document.getElementById('info-details').innerHTML = `
    <div><span class="label">ROUTE</span><span>${originCode} → ${destCode}</span></div>
    <div><span class="label">ACFT TYPE</span><span>${acType}</span></div>
    <div><span class="label">STATUS</span><span>${status}</span></div>
    <div><span class="label">PROGRESS</span><span>${progress}</span></div>
    <div><span class="label">ALT</span><span>${alt}</span></div>
    <div><span class="label">FILED ALT</span><span>${filedAlt}</span></div>
    <div><span class="label">GND SPD</span><span>${gs}</span></div>
    <div><span class="label">DEPART</span><span>${depTime}</span></div>
    <div><span class="label">${arrLabel}</span><span>${arrTime}</span></div>
  `;
}

// Show a dropdown panel of flight results below the search box.
// Displays all en-route and upcoming flights and the one most recent past flight.
function showFlightResults(flights, flightData) {
  const panel = document.getElementById('flight-results');
  if (!panel) return;

  const now = new Date();

  // Categorize each flight — supports both /flights/{ident} and /flights/search/advanced responses
  const categorized = flights.map(f => {
    let category;
    if (f.progress_percent != null) {
      // Standard response with progress_percent
      const isEnRoute = f.progress_percent > 0 && f.progress_percent < 100;
      const isCompleted = f.progress_percent >= 100;
      category = isEnRoute ? 'enroute' : (isCompleted ? 'past' : 'upcoming');
    } else {
      // Advanced search response — determine status from actual_off/actual_on
      if (f.actual_off && !f.actual_on) {
        category = 'enroute';
      } else if (f.actual_on) {
        category = 'past';
      } else {
        category = 'upcoming';
      }
    }
    return { flight: f, category };
  });

  // Sort: en-route first, then upcoming (earliest dep first), then past (most recent first, max 3)
  const enRoute = categorized.filter(c => c.category === 'enroute');
  const upcoming = categorized
    .filter(c => c.category === 'upcoming')
    .sort((a, b) => {
      const da = new Date(a.flight.scheduled_out || a.flight.estimated_out || a.flight.actual_off || 0);
      const db = new Date(b.flight.scheduled_out || b.flight.estimated_out || b.flight.actual_off || 0);
      return da - db;
    });
  const past = categorized
    .filter(c => c.category === 'past')
    .sort((a, b) => {
      const da = new Date(b.flight.scheduled_out || b.flight.estimated_out || b.flight.actual_off || 0);
      const db = new Date(a.flight.scheduled_out || a.flight.estimated_out || a.flight.actual_off || 0);
      return da - db;
    })
    .slice(0, 3);

  const ordered = [...enRoute, ...upcoming, ...past];

  panel.innerHTML = '';
  for (const { flight: f, category } of ordered) {
    const depStr = f.actual_out || f.scheduled_out || f.actual_off;
    const depDate = depStr ? new Date(depStr) : null;
    const depDateStr = depDate
      ? depDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      : '---';
    const depTimeStr = depDate
      ? depDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
      : '---';

    const originCode = f.origin ? (f.origin.code_iata || f.origin.code_icao || f.origin.code || '??') : '??';
    const destCode = f.destination ? (f.destination.code_iata || f.destination.code_icao || f.destination.code || '??') : '??';
    const identStr = f.ident_iata || f.ident || '';

    let badgeLabel, badgeClass;
    if (category === 'enroute') { badgeLabel = 'EN ROUTE'; badgeClass = 'badge-enroute'; }
    else if (category === 'upcoming') { badgeLabel = 'UPCOMING'; badgeClass = 'badge-upcoming'; }
    else { badgeLabel = 'PAST'; badgeClass = 'badge-past'; }

    const item = document.createElement('div');
    item.className = 'flight-result-item';
    item.innerHTML = `
      <span class="flight-result-badge ${badgeClass}">${badgeLabel}</span>
      <span class="flight-result-ident">${identStr}</span>
      <span class="flight-result-route">${originCode} → ${destCode}</span>
      <span class="flight-result-time">${depDateStr} ${depTimeStr}</span>
    `;
    item.addEventListener('click', () => {
      hideFlightResults();
      selectFlightFromResults(f, flightData);
    });
    panel.appendChild(item);
  }

  panel.classList.remove('hidden');
}

function hideFlightResults() {
  const panel = document.getElementById('flight-results');
  if (panel) panel.classList.add('hidden');
}

// Try to find a live aircraft for the given flight plan result.
// Skips the OpenSky API entirely for scheduled flights (not yet airborne).
async function searchForLiveAircraft(result) {
  const f = result.flight;
  const isScheduled = f.status === 'Scheduled'
    || (f.progress_percent != null && f.progress_percent === 0)
    || (!f.actual_off && !f.actual_on && f.progress_percent == null);

  if (isScheduled) {
    console.log(`[FlightPlan] Flight is scheduled — skipping OpenSky lookup`);
    showFlightPlanInfo(f);
    return;
  }

  console.log(`[FlightPlan] Looking for live aircraft with callsign "${searchedFlightIdent}"`);
  if (!selectSearchedAircraft()) {
    await findAndSelectViaOpenSky(result.flight, result.originCoords, result.destCoords);
    // No live aircraft found — show flight plan info panel instead
    if (!selectedIcao) {
      showFlightPlanInfo(result.flight);
    }
  }
}

// Called when the user selects a specific flight from the results panel.
// If the flight came from an advanced search (sparse data), re-fetches full
// flight details via /flights/{ident} before displaying.
async function selectFlightFromResults(flight, flightData) {
  // Add the selected flight's ident to search history so the user can
  // return to it directly without repeating the original search.
  const ident = (flight.ident || '').trim().toUpperCase();
  if (ident) addSearchHistory(ident);

  // Advanced search results lack fields like scheduled_out, filed_altitude, route, etc.
  // Detect this and fetch full data using the flight ident.
  if (flight.scheduled_out == null && flight.ident && window.flightAPI.getFlightPlan) {
    console.log(`[FlightPlan] Re-fetching full data for ${flight.ident}`);
    try {
      const fullData = await window.flightAPI.getFlightPlan(flight.ident);
      if (fullData && fullData.flights && fullData.flights.length > 0) {
        // Find the matching flight by fa_flight_id, or fall back to best match
        const match = fullData.flights.find(f => f.fa_flight_id === flight.fa_flight_id)
          || pickBestFlight(fullData.flights);
        const result = displayFlightPlanRoute(fullData, match);
        if (result) await searchForLiveAircraft(result);
        return;
      }
    } catch (err) {
      console.warn('[FlightPlan] Re-fetch failed, using sparse data:', err.message);
    }
  }

  const result = displayFlightPlanRoute(flightData, flight);
  if (result) {
    await searchForLiveAircraft(result);
  }
}

// ============================================================
// Natural Language Query Parsing
// ============================================================

// Returns true if the query looks like a natural language search
// rather than a plain flight identifier like "UAL123".
function isNaturalLanguageQuery(query) {
  if (!query) return false;
  if (query.includes(' ')) return true;
  return /\b(from|to|departing|arriving|flights?|between|today|tomorrow|yesterday|morning|afternoon|evening)\b/i.test(query);
}

// Common US airline name/abbreviation → ICAO operator code mapping.
window.AIRLINE_CODES = {
  'united':     'UAL', 'ual':     'UAL',
  'american':   'AAL', 'aal':     'AAL',
  'delta':      'DAL', 'dal':     'DAL',
  'southwest':  'SWA', 'swa':     'SWA',
  'jetblue':    'JBU', 'jbu':     'JBU',
  'alaska':     'ASA', 'asa':     'ASA',
  'spirit':     'NKS', 'nks':     'NKS',
  'frontier':   'FFT', 'fft':     'FFT',
  'hawaiian':   'HAL', 'hal':     'HAL',
  'allegiant':  'AAY', 'aay':     'AAY',
  'sun country':'SCX', 'scx':     'SCX',
  'breeze':     'MXX', 'mxx':     'MXX',
};

// Parse a natural language flight search query.
// Returns { origin, destination, airline, start, end } (values may be null).
function parseNaturalLanguage(query) {
  const q = query.toLowerCase().trim();
  const result = { origin: null, destination: null, airline: null, start: null, end: null };

  // Extract origin airport (3–4 letter IATA/ICAO code)
  const originMatch = q.match(/(?:from\s+|departing\s+(?:from\s+)?|out\s+of\s+)([a-z]{3,4})\b/);
  if (originMatch) result.origin = originMatch[1].toUpperCase();

  // Extract destination airport (3–4 letter IATA/ICAO code)
  const destMatch = q.match(/(?:\bto\s+|arriving\s+(?:at\s+|in\s+)?|bound\s+for\s+)([a-z]{3,4})\b/);
  if (destMatch) result.destination = destMatch[1].toUpperCase();

  // Fallback: "BOS to LAX" pattern — origin code directly before "to <dest>"
  if (!result.origin && result.destination) {
    const implicitOrigin = q.match(/\b([a-z]{3,4})\s+to\s+[a-z]{3,4}\b/);
    if (implicitOrigin) result.origin = implicitOrigin[1].toUpperCase();
  }

  // Extract airline — check for known names/codes in the query
  for (const [name, icao] of Object.entries(AIRLINE_CODES)) {
    if (q.includes(name)) {
      result.airline = icao;
      break;
    }
  }

  // Determine time window
  const now = new Date();
  const localMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const hasExplicitTime = /\b(today|tomorrow|yesterday|morning|afternoon|evening)\b/.test(q)
    || /between\s+\d/.test(q);

  if (hasExplicitTime) {
    // User specified a day/time — use calendar-day-based window
    let targetDate = localMidnight;
    if (/\btomorrow\b/.test(q)) {
      targetDate = new Date(localMidnight.getTime() + 86400000);
    } else if (/\byesterday\b/.test(q)) {
      targetDate = new Date(localMidnight.getTime() - 86400000);
    }

    const betweenMatch = q.match(/between\s+(\d{1,2}(?::\d{2})?)\s*(am|pm)?\s+and\s+(\d{1,2}(?::\d{2})?)\s*(am|pm)?/);
    if (betweenMatch) {
      const startH = parseHourStr(betweenMatch[1], betweenMatch[2]);
      const endH   = parseHourStr(betweenMatch[3], betweenMatch[4]);
      result.start = new Date(targetDate.getTime() + startH * 3600000).toISOString();
      result.end   = new Date(targetDate.getTime() + endH   * 3600000).toISOString();
    } else if (/\bmorning\b/.test(q)) {
      result.start = new Date(targetDate.getTime() +  6 * 3600000).toISOString(); // 06:00
      result.end   = new Date(targetDate.getTime() + 12 * 3600000).toISOString(); // 12:00
    } else if (/\bafternoon\b/.test(q)) {
      result.start = new Date(targetDate.getTime() + 12 * 3600000).toISOString(); // 12:00
      result.end   = new Date(targetDate.getTime() + 18 * 3600000).toISOString(); // 18:00
    } else if (/\bevening\b/.test(q)) {
      result.start = new Date(targetDate.getTime() + 18 * 3600000).toISOString(); // 18:00
      result.end   = new Date(targetDate.getTime() + 24 * 3600000).toISOString(); // 00:00 next day
    } else {
      // "today" / "tomorrow" / "yesterday" without time-of-day — full day
      result.start = targetDate.toISOString();
      result.end   = new Date(targetDate.getTime() + 86400000).toISOString();
    }
  } else {
    // No explicit time — rolling window: 6 hours ago to 12 hours from now
    result.start = new Date(now.getTime() -  6 * 3600000).toISOString();
    result.end   = new Date(now.getTime() + 12 * 3600000).toISOString();
  }

  return result;
}

// Parse a time string like "8", "8:30" with optional am/pm into fractional hours (0–24).
function parseHourStr(timeStr, ampm) {
  const parts = timeStr.split(':');
  let hour = parseInt(parts[0], 10);
  const min = parts.length > 1 ? parseInt(parts[1], 10) / 60 : 0;
  if (ampm === 'pm' && hour < 12) hour += 12;
  if (ampm === 'am' && hour === 12) hour = 0;
  return hour + min;
}

// Resolve a user-entered airport code (IATA or ICAO) to its ICAO code
// using the local airport database. Returns the original code if no match found.
function resolveToIcao(code) {
  if (!code || !cachedAirportData) return code;
  const upper = code.toUpperCase();
  const ap = cachedAirportData.find(a =>
    (a.iata && a.iata === upper) || (a.icao && a.icao === upper)
  );
  return ap ? ap.icao : upper;
}

// Build a FlightAware advanced search query from parsed NL parameters.
// Uses {operator key value} syntax for /flights/search/advanced endpoint.
// Time filtering uses the ogtd (original time of departure) field with UNIX epoch seconds.
function buildAdvancedQuery(params) {
  const parts = [];
  if (params.origin)      parts.push(`{= orig ${resolveToIcao(params.origin)}}`);
  if (params.destination) parts.push(`{= dest ${resolveToIcao(params.destination)}}`);
  if (params.airline)     parts.push(`{match ident ${params.airline}*}`);
  if (params.start)       parts.push(`{> ogtd ${Math.floor(new Date(params.start).getTime() / 1000)}}`);
  if (params.end)         parts.push(`{< ogtd ${Math.floor(new Date(params.end).getTime() / 1000)}}`);
  // Exclude cancelled flights
  parts.push('{!= status X}');
  return parts.join(' ');
}

// Handle a natural language flight search query by calling the FlightAware
// /flights/search/advanced endpoint with a query built from the parsed params.
async function searchFlightsByNL(query) {
  if (!window.flightAPI.searchFlights || !flightAwareAvailable) {
    console.warn('[FlightPlan] searchFlights not available');
    return;
  }

  const params = parseNaturalLanguage(query);
  if (!params.origin && !params.destination && !params.airline) {
    alert('Could not parse search. Try "flights from SFO to LAX today" or a flight number like UAL123.');
    return;
  }

  const searchInput = document.getElementById('flight-search');
  const searchBtn = document.getElementById('btn-flight-search');
  if (searchBtn) searchBtn.disabled = true;
  if (searchInput) searchInput.disabled = true;

  try {
    const advQuery = buildAdvancedQuery(params);
    console.log(`[FlightPlan] NL search: "${query}" → parsed:`, JSON.stringify(params));
    console.log(`[FlightPlan] NL search: "${query}" → advanced: "${advQuery}"`);
    const data = await window.flightAPI.searchFlights(advQuery);
    if (data.error) {
      console.warn(`[FlightPlan] NL search error: ${data.error}`);
      setFlightAwareAvailable(false);
      alert(`Flight search failed: ${data.error}`);
      return;
    }
    setFlightAwareAvailable(true);

    const flights = data.flights || [];
    if (flights.length === 0) {
      alert(`No flights found for "${query}"`);
      return;
    }

    console.log(`[FlightPlan] NL search found ${flights.length} flight(s)`);
    // Debug: log all returned flights with status details
    flights.forEach((f, i) => {
      const ident = f.ident_iata || f.ident || '???';
      const status = f.status || '—';
      const progress = f.progress_percent != null ? `${f.progress_percent}%` : 'null';
      const actualOff = f.actual_off || 'null';
      const actualOn = f.actual_on || 'null';
      const schedOut = f.scheduled_out || 'null';
      let cat;
      if (f.progress_percent != null) {
        const isEnRoute = f.progress_percent > 0 && f.progress_percent < 100;
        const isCompleted = f.progress_percent >= 100;
        cat = isEnRoute ? 'EN ROUTE' : (isCompleted ? 'PAST' : 'UPCOMING');
      } else {
        cat = (f.actual_off && !f.actual_on) ? 'EN ROUTE' : (f.actual_on ? 'PAST' : 'UPCOMING');
      }
      console.log(`[FlightPlan]   #${i + 1} ${ident} | category=${cat} | status="${status}" | progress=${progress} | sched_out=${schedOut} | actual_off=${actualOff} | actual_on=${actualOn}`);
    });
    addSearchHistory(query.trim());

    if (flights.length === 1) {
      await selectFlightFromResults(flights[0], data);
    } else {
      showFlightResults(flights, data);
    }
  } catch (err) {
    console.error('[FlightPlan] NL search error:', err);
    alert('Flight search failed. Check console for details.');
  } finally {
    if (searchBtn) searchBtn.disabled = false;
    if (searchInput) searchInput.disabled = false;
  }
}

async function searchFlightPlan(ident) {
  if (!ident || ident.trim().length === 0) return;

  // Route natural language queries to the dedicated NL search handler
  if (isNaturalLanguageQuery(ident)) {
    await searchFlightsByNL(ident.trim());
    return;
  }

  const searchInput = document.getElementById('flight-search');
  const searchBtn = document.getElementById('btn-flight-search');
  if (searchBtn) searchBtn.disabled = true;
  if (searchInput) searchInput.disabled = true;

  try {
    if (!window.flightAPI.getFlightPlan || !flightAwareAvailable) {
      console.warn('[FlightPlan] FlightAware API not available');
      return;
    }

    const data = await window.flightAPI.getFlightPlan(ident.trim());
    if (data.error) {
      console.warn(`[FlightPlan] Error: ${data.error}`);
      setFlightAwareAvailable(false);
      alert(`Flight search failed: ${data.error}`);
      return;
    }
    setFlightAwareAvailable(true);

    if (!data.flights || data.flights.length === 0) {
      alert(`No flights found for "${ident.trim()}"`);
      return;
    }

    console.log(`[FlightPlan] Found ${data.flights.length} flight(s) for ${ident}`);

    // Save successful search to history
    addSearchHistory(ident.trim().toUpperCase());

    // If only one result, select it immediately; otherwise let the user pick.
    if (data.flights.length === 1) {
      const result = displayFlightPlanRoute(data);
      if (result) {
        await searchForLiveAircraft(result);
      }
    } else {
      showFlightResults(data.flights, data);
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
window.flightSearchInput = document.getElementById('flight-search');
window.flightSearchBtn = document.getElementById('btn-flight-search');

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

// Hide flight results when clicking outside the search area
document.addEventListener('click', (e) => {
  const wrap = document.getElementById('flight-search-wrap');
  if (wrap && !wrap.contains(e.target)) {
    hideFlightResults();
  }
});

// ============================================================
// Search History
// ============================================================

window.MAX_SEARCH_HISTORY = 15;

async function addSearchHistory(ident) {
  if (!ident || !window.flightAPI) return;
  try {
    const saved = await window.flightAPI.getSettings();
    let history = Array.isArray(saved.searchHistory) ? saved.searchHistory : [];
    // Remove duplicate if present, then prepend
    history = history.filter(h => h !== ident);
    history.unshift(ident);
    // Keep only the most recent entries
    if (history.length > MAX_SEARCH_HISTORY) history = history.slice(0, MAX_SEARCH_HISTORY);
    saved.searchHistory = history;
    await window.flightAPI.saveSettings(saved);
    console.log(`[FlightPlan] Search history updated: ${history.join(', ')}`);
  } catch (err) {
    console.warn('[FlightPlan] Could not save search history:', err);
  }
}

async function showSearchHistory() {
  const panel = document.getElementById('flight-results');
  if (!panel || !window.flightAPI) return;

  try {
    const saved = await window.flightAPI.getSettings();
    const history = Array.isArray(saved.searchHistory) ? saved.searchHistory : [];

    panel.innerHTML = '';

    if (history.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'search-history-empty';
      empty.textContent = 'No recent searches';
      panel.appendChild(empty);
    } else {
      for (const ident of history) {
        const item = document.createElement('div');
        item.className = 'search-history-item';
        item.innerHTML = `
          <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M13 3a9 9 0 0 0-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7a6.97 6.97 0 0 1-4.95-2.05l-1.41 1.41A8.97 8.97 0 0 0 13 21a9 9 0 0 0 0-18zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z"/></svg>
          <span class="search-history-ident">${ident}</span>
        `;
        item.addEventListener('click', () => {
          hideFlightResults();
          if (flightSearchInput) flightSearchInput.value = ident;
          searchFlightPlan(ident);
        });
        panel.appendChild(item);
      }
    }

    panel.classList.remove('hidden');
  } catch (err) {
    console.warn('[FlightPlan] Could not load search history:', err);
  }
}

// Wire up search history button
window.searchHistoryBtn = document.getElementById('btn-search-history');
if (searchHistoryBtn) {
  searchHistoryBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const panel = document.getElementById('flight-results');
    if (panel && !panel.classList.contains('hidden')) {
      hideFlightResults();
    } else {
      showSearchHistory();
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

window.trackBtn = document.getElementById('btn-track');
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

window.showRouteBtn = document.getElementById('btn-show-route');
if (showRouteBtn) {
  showRouteBtn.addEventListener('click', () => {
    stopTracking();
    if (flightPlanEntities.length > 0) {
      flyToRouteOverview();
    } else if (selectedIcao) {
      flyToTrackHistory(selectedIcao);
    }
  });
}

window.formatDuration = formatDuration;
window.estimateArrivalTime = estimateArrivalTime;
window.updateInfoPanelRoute = updateInfoPanelRoute;
window.showAircraftInfo = showAircraftInfo;
window.showTurbInfo = showTurbInfo;
window.hideAircraftInfo = hideAircraftInfo;
window.enrichSelectedWithFlightAware = enrichSelectedWithFlightAware;
window.pickBestFlight = pickBestFlight;
window.flyToTrackHistory = flyToTrackHistory;
window.flyToRouteOverview = flyToRouteOverview;
window.clearFlightPlanRoute = clearFlightPlanRoute;
window.lookupAirportCoords = lookupAirportCoords;
window.drawFlightPlanMarkers = drawFlightPlanMarkers;
window.displayFlightPlanRoute = displayFlightPlanRoute;
window.findAndSelectViaOpenSky = findAndSelectViaOpenSky;
window.fetchSingleAircraftForSearch = fetchSingleAircraftForSearch;
window.selectSearchedAircraft = selectSearchedAircraft;
window.fetchAndDisplayFiledRoute = fetchAndDisplayFiledRoute;
window.drawRouteFromString = drawRouteFromString;
window.showFlightPlanInfo = showFlightPlanInfo;
window.showFlightResults = showFlightResults;
window.hideFlightResults = hideFlightResults;
window.searchForLiveAircraft = searchForLiveAircraft;
window.selectFlightFromResults = selectFlightFromResults;
window.isNaturalLanguageQuery = isNaturalLanguageQuery;
window.parseNaturalLanguage = parseNaturalLanguage;
window.parseHourStr = parseHourStr;
window.resolveToIcao = resolveToIcao;
window.buildAdvancedQuery = buildAdvancedQuery;
window.searchFlightsByNL = searchFlightsByNL;
window.searchFlightPlan = searchFlightPlan;
window.addSearchHistory = addSearchHistory;
window.showSearchHistory = showSearchHistory;
window.stopTracking = stopTracking;
window.showAirportInfo = showAirportInfo;
window.fetchAirportFlights = fetchAirportFlights;
window.fetchAirportDelays = fetchAirportDelays;
window.getAirportDelayMinutes = getAirportDelayMinutes;
window.delayColor = delayColor;
window.haversineKm = haversineKm;
window.applyAirportFilter = applyAirportFilter;
window.clearAirportFilter = clearAirportFilter;
window.setFlightAwareAvailable = setFlightAwareAvailable;
window.checkFlightAwareAvailability = checkFlightAwareAvailability;

export {}
