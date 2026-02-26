// Flight plan timeline scrubbing: slider UI, position interpolation, and weather filtering.
// The scrubber ONLY affects weather overlays (PIREPs, SIGMETs, G-AIRMETs, GTG forecast).
// Aircraft (selected and others) are left completely alone and update independently.
// Depends on radar-core.js, radar-weather.js, radar-flightplan.js.

'use strict';

// ============================================================
// Helpers
// ============================================================

// Compute cumulative great-circle distances between consecutive route points.
// Returns array of cumulative distances (length = points.length, first = 0).
function computeRouteDistances(points) {
  const dists = [0];
  for (let i = 1; i < points.length; i++) {
    const p1 = points[i - 1];
    const p2 = points[i];
    const c1 = Cesium.Cartographic.fromDegrees(p1.lon, p1.lat);
    const c2 = Cesium.Cartographic.fromDegrees(p2.lon, p2.lat);
    const geodesic = new Cesium.EllipsoidGeodesic(c1, c2);
    dists.push(dists[i - 1] + geodesic.surfaceDistance);
  }
  return dists;
}

// Interpolate position along route at a given fraction (0-1).
// Returns { lon, lat, alt } or null if route has fewer than 2 points.
function interpolateRoutePosition(fraction) {
  const pts = timelineRoutePoints;
  if (pts.length < 2) return null;
  const f = Math.max(0, Math.min(1, fraction));
  if (f <= 0) return { ...pts[0] };
  if (f >= 1) return { ...pts[pts.length - 1] };

  const dists = computeRouteDistances(pts);
  const totalDist = dists[dists.length - 1];
  if (totalDist === 0) return { ...pts[0] };

  const targetDist = f * totalDist;

  // Find the segment containing targetDist
  let segIdx = 0;
  for (let i = 1; i < dists.length; i++) {
    if (dists[i] >= targetDist) { segIdx = i - 1; break; }
  }

  const segStart = dists[segIdx];
  const segEnd = dists[segIdx + 1];
  const segLen = segEnd - segStart;
  const segFrac = segLen > 0 ? (targetDist - segStart) / segLen : 0;

  const p1 = pts[segIdx];
  const p2 = pts[segIdx + 1];
  return {
    lon: p1.lon + segFrac * (p2.lon - p1.lon),
    lat: p1.lat + segFrac * (p2.lat - p1.lat),
    alt: p1.alt + segFrac * (p2.alt - p1.alt),
  };
}

// Get departure and arrival timestamps from a flight object.
function getFlightTimes(flight) {
  const depStr = flight.actual_out || flight.estimated_out || flight.scheduled_out;
  const arrStr = flight.estimated_in || flight.scheduled_in;
  const dep = depStr ? new Date(depStr).getTime() : null;
  const arr = arrStr ? new Date(arrStr).getTime() : null;
  return { dep, arr };
}

// ============================================================
// Timeline UI
// ============================================================

let _timelineFlight = null;       // flight object the timeline is showing
let _timelineLive = true;         // true = live mode (weather updates normally), false = scrubbing
let _timelineLiveTimer = null;    // interval ID for auto-advancing slider in live mode

function showTimeline(flight) {
  const panel = document.getElementById('timeline-panel');
  if (!panel) return;

  const { dep, arr } = getFlightTimes(flight);
  if (!dep || !arr || arr <= dep) return;

  _timelineFlight = flight;

  // Set airport labels
  const origin = flight.origin;
  const dest = flight.destination;
  const originCode = origin ? (origin.code_iata || origin.code_icao || origin.code || '??') : '??';
  const destCode = dest ? (dest.code_iata || dest.code_icao || dest.code || '??') : '??';
  const originEl = document.getElementById('timeline-origin');
  const destEl = document.getElementById('timeline-dest');
  if (originEl) originEl.textContent = originCode;
  if (destEl) destEl.textContent = destCode;

  // Configure slider range (departure to arrival in ms)
  const slider = document.getElementById('timeline-slider');
  if (slider) {
    slider.min = String(dep);
    slider.max = String(arr);
    slider.step = '60000'; // 1-minute granularity
    // Start at current time if flight is in progress, otherwise at departure
    const now = Date.now();
    const initTime = (now >= dep && now <= arr) ? now : dep;
    slider.value = String(initTime);
    updateTimelineLabel(initTime, dep, arr);
  }

  panel.classList.remove('hidden');
  positionTimeline();

  // Start in live mode — weather overlays refresh normally
  enterLiveMode();

  // Preload all turbulence forecast images covering the flight's time span
  // so the slider can switch maps instantly without network fetches.
  preloadTurbForTimeline(dep, arr);
}

function hideTimeline() {
  const panel = document.getElementById('timeline-panel');
  if (panel) panel.classList.add('hidden');
  stopLiveTimer();
  resetTimelineToLive();
  resumeWeatherRefresh();
  clearTurbCache();
  _timelineFlight = null;
}

function resetTimelineToLive() {
  if (timelineTime !== null) {
    timelineTime = null;
    restoreWeatherVisibility();
    resetTurbToLive();
  }
  // Remove timeline position marker
  if (timelineEntity) {
    viewer.entities.remove(timelineEntity);
    timelineEntity = null;
  }
}

// --- Live / Scrubbing mode management ---

function enterLiveMode() {
  _timelineLive = true;
  const btn = document.getElementById('timeline-live');
  if (btn) btn.classList.add('active');

  // Exit scrubbing: restore weather to normal live updates
  resetTimelineToLive();
  resumeWeatherRefresh();

  // Update the label and slider to current time
  updateLiveSliderPosition();

  // Start periodic timer to keep slider tracking current time
  startLiveTimer();
}

function enterScrubbingMode() {
  if (!_timelineLive) return; // already scrubbing
  _timelineLive = false;
  const btn = document.getElementById('timeline-live');
  if (btn) btn.classList.remove('active');
  stopLiveTimer();
  pauseWeatherRefresh();
}

function startLiveTimer() {
  stopLiveTimer();
  _timelineLiveTimer = setInterval(updateLiveSliderPosition, 15000); // every 15 seconds
}

function stopLiveTimer() {
  if (_timelineLiveTimer !== null) {
    clearInterval(_timelineLiveTimer);
    _timelineLiveTimer = null;
  }
}

function updateLiveSliderPosition() {
  if (!_timelineFlight || !_timelineLive) return;
  const { dep, arr } = getFlightTimes(_timelineFlight);
  if (!dep || !arr) return;

  const now = Math.min(Math.max(Date.now(), dep), arr);
  const slider = document.getElementById('timeline-slider');
  if (slider) slider.value = String(now);

  // Update label to show "LIVE · HH:MMZ"
  const label = document.getElementById('timeline-time');
  if (label) {
    const d = new Date(now);
    const utc = d.toISOString().slice(11, 16) + 'Z';
    label.textContent = `LIVE \u00b7 ${utc}`;
  }
}

function updateTimelineLabel(timeMs, depMs, arrMs) {
  const label = document.getElementById('timeline-time');
  if (!label) return;
  const elapsed = timeMs - depMs;
  const total = arrMs - depMs;
  if (total <= 0) { label.textContent = '---'; return; }
  const elapsedMin = Math.round(elapsed / 60000);
  const h = Math.floor(elapsedMin / 60);
  const m = elapsedMin % 60;
  const timeStr = h > 0 ? `${h}h ${m}m` : `${m}m`;

  // Show UTC time
  const d = new Date(timeMs);
  const utc = d.toISOString().slice(11, 16) + 'Z';
  label.textContent = `${timeStr} · ${utc}`;
}

// ============================================================
// Scrubbing Logic
// ============================================================

function onTimelineInput() {
  const slider = document.getElementById('timeline-slider');
  if (!slider || !_timelineFlight) return;

  // User is scrubbing — exit live mode
  enterScrubbingMode();

  const sliderTime = Number(slider.value);
  const { dep, arr } = getFlightTimes(_timelineFlight);
  if (!dep || !arr) return;

  updateTimelineLabel(sliderTime, dep, arr);

  // Enter scrubbing mode — the entire dep→arr range is treated uniformly.
  // Past, present, and future times along the filed flight plan are all equal.
  timelineTime = sliderTime;

  // Update timeline marker position along the flight plan route
  updateTimelinePosition(sliderTime, dep, arr);

  // Filter weather entities by timeline time
  filterWeatherByTime(sliderTime);

  // Update turbulence forecast for scrubbed time (instant from preloaded cache)
  updateTurbForTimelineTime(sliderTime);
}

// Always interpolate along the filed flight plan route (never uses aircraft history).
function updateTimelinePosition(sliderTime, depMs, arrMs) {
  const total = arrMs - depMs;
  if (total <= 0) return;

  const fraction = (sliderTime - depMs) / total;
  const pos = interpolateRoutePosition(fraction);
  if (!pos) return;

  updateOrCreateTimelineMarker(Cesium.Cartesian3.fromDegrees(pos.lon, pos.lat, pos.alt));
}

function updateOrCreateTimelineMarker(position) {
  if (timelineEntity) {
    timelineEntity.position = position;
  } else {
    timelineEntity = viewer.entities.add({
      id: 'timeline-marker',
      position: position,
      point: {
        pixelSize: 14,
        color: Cesium.Color.CYAN,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
      },
      label: {
        text: 'T',
        font: 'bold 11px Roboto Flex, sans-serif',
        fillColor: Cesium.Color.BLACK,
        style: Cesium.LabelStyle.FILL,
        verticalOrigin: Cesium.VerticalOrigin.CENTER,
        horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
        pixelOffset: new Cesium.Cartesian2(0, 0),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
  }
}

// ============================================================
// Weather Filtering by Time
// ============================================================

function filterWeatherByTime(timeMs) {
  // Filter PIREPs: hide if observation time is more than 1 hour before slider time
  // or if observation time is after slider time (report hasn't happened yet)
  const pirepMaxAge = 60 * 60 * 1000; // 1 hour in ms
  for (const entity of pirepEntities) {
    const p = entity.properties;
    if (!p || !p.obsTimeISO) { entity.show = true; continue; }
    const isoStr = p.obsTimeISO.getValue();
    if (!isoStr) { entity.show = true; continue; }
    const obsMs = new Date(isoStr).getTime();
    if (isNaN(obsMs)) { entity.show = true; continue; }
    // Hide PIREPs that haven't been reported yet or are too old for the slider time
    entity.show = (obsMs <= timeMs) && (timeMs - obsMs <= pirepMaxAge);
  }

  // Filter SIGMETs: hide if slider time is outside validTimeFrom - validTimeTo
  for (const entity of sigmetEntities) {
    const p = entity.properties;
    if (!p) { entity.show = true; continue; }
    const from = p.validFrom ? p.validFrom.getValue() : null;
    const to = p.validTo ? p.validTo.getValue() : null;
    if (!from || !to || from === '?' || to === '?') { entity.show = true; continue; }
    const fromMs = new Date(from).getTime();
    const toMs = new Date(to).getTime();
    entity.show = !isNaN(fromMs) && !isNaN(toMs) ? (timeMs >= fromMs && timeMs <= toMs) : true;
  }

  // Filter AIRMETs: hide if slider time is outside validTime - validTimeTo
  for (const entity of airmetEntities) {
    const p = entity.properties;
    if (!p) { entity.show = true; continue; }
    const from = p.validFrom ? p.validFrom.getValue() : null;
    const to = p.validTo ? p.validTo.getValue() : null;
    if (!from || !to || from === '?' || to === '?') { entity.show = true; continue; }
    const fromMs = new Date(from).getTime();
    const toMs = new Date(to).getTime();
    entity.show = !isNaN(fromMs) && !isNaN(toMs) ? (timeMs >= fromMs && timeMs <= toMs) : true;
  }
}

function restoreWeatherVisibility() {
  for (const entity of pirepEntities) entity.show = true;
  for (const entity of sigmetEntities) entity.show = true;
  // AIRMETs may contain multi-snapshot data from scrubbing (hours 0,3,6,9,12).
  // Clear and re-fetch so only the current snapshot (hour 0) is shown.
  removeAirmetEntities();
  if (CONFIG.airmetsEnabled) fetchAirmets();
}

// ============================================================
// Event Wiring
// ============================================================

const _tlSlider = document.getElementById('timeline-slider');
if (_tlSlider) {
  _tlSlider.addEventListener('input', onTimelineInput);

  // Double-click on slider returns to live mode
  _tlSlider.addEventListener('dblclick', () => {
    if (!_timelineFlight) return;
    enterLiveMode();
  });
}

// Live button toggles to live mode
const _tlLiveBtn = document.getElementById('timeline-live');
if (_tlLiveBtn) {
  _tlLiveBtn.addEventListener('click', () => {
    if (!_timelineFlight) return;
    enterLiveMode();
  });
}

// ============================================================
// Timeline Panel Positioning (avoid overlapping controls)
// ============================================================

function positionTimeline() {
  const panel = document.getElementById('timeline-panel');
  const controls = document.getElementById('controls');
  if (!panel || panel.classList.contains('hidden')) return;

  // Reset to centered default so we can measure the natural position
  panel.style.left = '';
  panel.style.transform = '';

  // If controls panel is collapsed or absent, centering is fine
  if (!controls || controls.classList.contains('collapsed')) return;

  // Use the toggle tab's right edge if present, otherwise the controls panel's
  const toggle = document.getElementById('controls-toggle');
  const edgeRect = (toggle || controls).getBoundingClientRect();
  const panelRect = panel.getBoundingClientRect();
  const gap = 12;

  // If the centered timeline overlaps the controls + toggle tab, shift it right
  if (panelRect.left < edgeRect.right + gap) {
    panel.style.left = (edgeRect.right + gap) + 'px';
    panel.style.transform = 'none';
  }
}

// Reposition timeline when window resizes
window.addEventListener('resize', positionTimeline);

// Reposition timeline when controls panel finishes collapsing/expanding
const _tlControls = document.getElementById('controls');
if (_tlControls) {
  _tlControls.addEventListener('transitionend', positionTimeline);
}
