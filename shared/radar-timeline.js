// Flight plan timeline scrubbing: slider UI, position interpolation, and weather filtering.
// The scrubber ONLY affects weather overlays (PIREPs, SIGMETs, G-AIRMETs, GTG forecast).
// Aircraft (selected and others) are left completely alone and update independently.
// Depends on radar-core.js, radar-weather.js, radar-flightplan.js.

// ============================================================
// Airport Weather
// ============================================================

// WMO weather interpretation code → representative emoji icon.
window.WMO_WEATHER_ICON = {
  0: '☀️', 1: '🌤️', 2: '⛅', 3: '☁️',
  45: '🌫️', 48: '🌫️',
  51: '🌦️', 53: '🌦️', 55: '🌧️',
  56: '🌨️', 57: '🌨️',
  61: '🌧️', 63: '🌧️', 65: '🌧️',
  66: '🌨️', 67: '🌨️',
  71: '🌨️', 73: '🌨️', 75: '❄️', 77: '🌨️',
  80: '🌦️', 81: '🌧️', 82: '⛈️',
  85: '🌨️', 86: '🌨️',
  95: '⛈️', 96: '⛈️', 99: '⛈️',
};

// Fetch the surface weather forecast at an airport for a given time and display it in the
// specified element. Uses the Open-Meteo free forecast API.
window._weatherAbortCtrl = null;

async function fetchAirportWeather(airport, timeMs, elId) {
  const el = document.getElementById(elId);
  if (!el) return;

  const coords = airport ? lookupAirportCoords(airport) : null;
  if (!coords || !timeMs) { el.textContent = ''; return; }

  el.textContent = '…';

  try {
    const date = new Date(timeMs);
    const dateStr = date.toISOString().slice(0, 10); // YYYY-MM-DD
    const url = 'https://api.open-meteo.com/v1/forecast' +
      `?latitude=${coords.lat.toFixed(4)}&longitude=${coords.lon.toFixed(4)}` +
      `&hourly=temperature_2m,weather_code&temperature_unit=fahrenheit&timezone=UTC&start_date=${dateStr}&end_date=${dateStr}`;

    const resp = await fetch(url, { signal: _weatherAbortCtrl.signal });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();

    const times = data.hourly.time; // ["YYYY-MM-DDTHH:00", ...]
    // Find the hourly slot closest to the target time (times are sorted, so stop when diff grows).
    let idx = 0;
    let minDiff = Math.abs(new Date(times[0] + 'Z').getTime() - timeMs);
    for (let i = 1; i < times.length; i++) {
      const diff = Math.abs(new Date(times[i] + 'Z').getTime() - timeMs);
      if (diff < minDiff) { minDiff = diff; idx = i; } else { break; }
    }

    const temp = data.hourly.temperature_2m[idx];
    const code = data.hourly.weather_code[idx];
    const icon = WMO_WEATHER_ICON[code] ?? '🌡️';
    el.textContent = temp != null ? `${icon} ${Math.round(temp)}°F` : icon;
  } catch (err) {
    if (err.name === 'AbortError') return; // superseded by a newer selection
    console.warn(`[Timeline] Weather fetch failed (${elId}):`, err.message);
    el.textContent = '';
  }
}

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
// Falls back to estimateArrivalTime() when FlightAware doesn't provide arrival data.
function getFlightTimes(flight) {
  const depStr = flight.actual_out || flight.estimated_out || flight.scheduled_out;
  const arrStr = flight.estimated_in || flight.scheduled_in
    || estimateArrivalTime(flight);
  const dep = depStr ? new Date(depStr).getTime() : null;
  const arr = arrStr ? new Date(arrStr).getTime() : null;
  return { dep, arr };
}

// ============================================================
// Timeline UI
// ============================================================

window._timelineFlight = null;       // flight object the timeline is showing
window._timelineLive = true;         // true = live mode (weather updates normally), false = scrubbing
window._timelineLiveTimer = null;    // interval ID for auto-advancing slider in live mode

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
  // After preloading, apply the turbulence color gradient to the slider.
  preloadTurbForTimeline(dep, arr, applySliderGradient);

  // Fetch surface weather forecasts at origin (departure time) and destination (arrival time).
  if (_weatherAbortCtrl) _weatherAbortCtrl.abort();
  _weatherAbortCtrl = new AbortController();
  fetchAirportWeather(flight.origin, dep, 'origin-weather');
  fetchAirportWeather(flight.destination, arr, 'dest-weather');

  // Fetch delay status and color the endpoint dots
  updateTimelineDelayDots(flight.origin, flight.destination);
}

function hideTimeline() {
  const panel = document.getElementById('timeline-panel');
  if (panel) panel.classList.add('hidden');
  stopLiveTimer();
  _timelineLive = true; // reset to live mode before cleanup
  resetTimelineToLive();
  resumeWeatherRefresh();
  clearTurbCache();
  clearSliderGradient();
  resetTimelineDelayDots();
  _timelineFlight = null;
  if (_weatherAbortCtrl) { _weatherAbortCtrl.abort(); _weatherAbortCtrl = null; }
  for (const id of ['origin-weather', 'dest-weather']) {
    const el = document.getElementById(id);
    if (el) el.textContent = '';
  }
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
  // Fetch all AIRMET forecast snapshots for scrubbing into separate array
  if (CONFIG.airmetsEnabled) fetchAirmetsForScrubbing();
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

  const label = document.getElementById('timeline-time');
  if (label) {
    const elapsed = formatDuration(now - dep);
    const remaining = formatDuration(arr - now);
    const utc = new Date(now).toISOString().slice(11, 16) + 'Z';
    label.textContent = `${elapsed} / ${remaining} rem \u00b7 ${utc}`;
  }
}

function formatDuration(ms) {
  const min = Math.round(Math.abs(ms) / 60000);
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function updateTimelineLabel(timeMs, depMs, arrMs) {
  const label = document.getElementById('timeline-time');
  if (!label) return;
  const total = arrMs - depMs;
  if (total <= 0) { label.textContent = '---'; return; }

  const elapsed = formatDuration(timeMs - depMs);
  const remaining = formatDuration(arrMs - timeMs);
  const utc = new Date(timeMs).toISOString().slice(11, 16) + 'Z';
  label.textContent = `${elapsed} / ${remaining} rem \u00b7 ${utc}`;
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

  updateOrCreateTimelineMarker(Cesium.Cartesian3.fromDegrees(pos.lon, pos.lat, exAlt(pos.alt)));
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
        font: labelFont(11, 700),
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
  // Compute altitude from interpolated route position for altitude filtering
  let altFL = null;
  if (_timelineFlight) {
    const { dep, arr } = getFlightTimes(_timelineFlight);
    if (dep && arr && arr > dep) {
      const fraction = (timeMs - dep) / (arr - dep);
      const pos = interpolateRoutePosition(fraction);
      if (pos && pos.alt > 0) {
        altFL = Math.round(pos.alt / 0.3048 / 100); // meters to FL
      }
    }
  }
  filterAllWeather(timeMs, altFL);
}

function restoreWeatherVisibility() {
  // Clear scrubbing AIRMET entities and restore live ones
  removeScrubAirmetEntities();
  // Show all weather entities, then re-apply altitude filter if a flight is selected
  filterAllWeather(null, getSelectedAircraftFL());
}

// ============================================================
// Scrubbing Bar Turbulence Gradient
// ============================================================

// Sample every 5 minutes along the route to build a CSS gradient for the slider.
window.TURB_GRADIENT_INTERVAL_MS = 5 * 60 * 1000;

// Build a CSS linear-gradient string representing the turbulence level along the
// entire route, sampled at 5-minute intervals.  Returns null if turbulence data
// is not available.
function computeSliderGradient(depMs, arrMs) {
  const total = arrMs - depMs;
  if (total <= 0) return null;

  const stops = [];
  for (let t = depMs; t < arrMs; t += TURB_GRADIENT_INTERVAL_MS) {
    const fraction = Math.max(0, Math.min(1, (t - depMs) / total));
    const pos = interpolateRoutePosition(fraction);
    if (!pos) continue;
    const color = getTurbPixelColor(pos.lon, pos.lat, Math.round(t / 1000));
    const pct = Math.round(fraction * 100);
    stops.push({ pct, color: color || 'var(--md-outline-variant)' });
  }

  // Always include the endpoint
  const lastPos = interpolateRoutePosition(1);
  if (lastPos) {
    const color = getTurbPixelColor(lastPos.lon, lastPos.lat, Math.round(arrMs / 1000));
    stops.push({ pct: 100, color: color || 'var(--md-outline-variant)' });
  }

  if (stops.length === 0) return null;
  return `linear-gradient(to right, ${stops.map(s => `${s.color} ${s.pct}%`).join(', ')})`;
}

// Apply a turbulence color gradient to the timeline slider track.
// Always applies when pixel data is available, regardless of whether the
// turbulence overlay map is shown.
function applySliderGradient() {
  if (!_timelineFlight) return;
  const slider = document.getElementById('timeline-slider');
  if (!slider) return;

  const { dep, arr } = getFlightTimes(_timelineFlight);
  if (!dep || !arr) return;

  const gradient = computeSliderGradient(dep, arr);
  if (gradient) {
    slider.style.background = gradient;
  } else {
    clearSliderGradient();
  }
}

// Reset the slider track to its default CSS color.
function clearSliderGradient() {
  const slider = document.getElementById('timeline-slider');
  if (slider) slider.style.background = '';
}

// ============================================================
// Timeline Delay Dots
// ============================================================

// Fetch delays for origin/destination and update the dot colors in the timeline bar.
async function updateTimelineDelayDots(origin, dest) {
  const originCode = origin && (origin.code_icao || origin.code || '');
  const destCode = dest && (dest.code_icao || dest.code || '');

  const [originMins, destMins] = await Promise.all([
    getAirportDelayMinutes(originCode),
    getAirportDelayMinutes(destCode),
  ]);

  const originDot = document.getElementById('timeline-dot-origin');
  const destDot = document.getElementById('timeline-dot-dest');

  if (originDot) {
    const color = originMins > 0 ? delayColor(originMins) : Cesium.Color.LIME;
    originDot.style.background = color.toCssColorString();
  }
  if (destDot) {
    const color = destMins > 0 ? delayColor(destMins) : Cesium.Color.LIME;
    destDot.style.background = color.toCssColorString();
  }
}

function resetTimelineDelayDots() {
  const originDot = document.getElementById('timeline-dot-origin');
  const destDot = document.getElementById('timeline-dot-dest');
  if (originDot) originDot.style.background = '';
  if (destDot) destDot.style.background = '';
}

// ============================================================
// Event Wiring
// ============================================================

window._tlSlider = document.getElementById('timeline-slider');
if (_tlSlider) {
  _tlSlider.addEventListener('input', onTimelineInput);

  // Double-click on slider returns to live mode
  _tlSlider.addEventListener('dblclick', () => {
    if (!_timelineFlight) return;
    enterLiveMode();
  });
}

// Live button toggles to live mode
window._tlLiveBtn = document.getElementById('timeline-live');
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

  const edgeRect = controls.getBoundingClientRect();
  const panelRect = panel.getBoundingClientRect();
  const gap = 20;

  // If the centered timeline overlaps the controls + toggle tab, shift it right
  if (panelRect.left < edgeRect.right + gap) {
    panel.style.left = (edgeRect.right + gap) + 'px';
    panel.style.transform = 'none';
  }
}

// Reposition timeline when window resizes
window.addEventListener('resize', positionTimeline);

// Reposition timeline when controls panel finishes collapsing/expanding
window._tlControls = document.getElementById('controls');
if (_tlControls) {
  _tlControls.addEventListener('transitionend', positionTimeline);
}

// ============================================================
// Window exports for all top-level functions
// ============================================================
window.fetchAirportWeather = fetchAirportWeather;
window.computeRouteDistances = computeRouteDistances;
window.interpolateRoutePosition = interpolateRoutePosition;
window.getFlightTimes = getFlightTimes;
window.showTimeline = showTimeline;
window.hideTimeline = hideTimeline;
window.resetTimelineToLive = resetTimelineToLive;
window.enterLiveMode = enterLiveMode;
window.enterScrubbingMode = enterScrubbingMode;
window.startLiveTimer = startLiveTimer;
window.stopLiveTimer = stopLiveTimer;
window.updateLiveSliderPosition = updateLiveSliderPosition;
window.formatDuration = formatDuration;
window.updateTimelineLabel = updateTimelineLabel;
window.onTimelineInput = onTimelineInput;
window.updateTimelinePosition = updateTimelinePosition;
window.updateOrCreateTimelineMarker = updateOrCreateTimelineMarker;
window.filterWeatherByTime = filterWeatherByTime;
window.restoreWeatherVisibility = restoreWeatherVisibility;
window.computeSliderGradient = computeSliderGradient;
window.applySliderGradient = applySliderGradient;
window.clearSliderGradient = clearSliderGradient;
window.positionTimeline = positionTimeline;
window.updateTimelineDelayDots = updateTimelineDelayDots;
window.resetTimelineDelayDots = resetTimelineDelayDots;

export {}
