// renderer.js - CesiumJS flight radar display
// FAA radar center aesthetic with real-time OpenSky Network data

'use strict';

// ============================================================
// Configuration
// ============================================================

const CONFIG = {
  // Boston Logan Airport center
  startLon: -71.0096,
  startLat: 42.3656,
  startAlt: 500000,           // initial camera height in meters

  pollInterval: 15000,        // ms between state polls
  trailMaxAge: 300,           // seconds of trail to keep
  trailEnabled: true,
  labelsEnabled: true,
  granularTrails: true,       // fetch hi-res track data from API
  staleThreshold: 60,         // seconds before marking aircraft stale

  // Visual
  phosphor: '#00cc44',
  phosphorBright: '#33ff66',
  phosphorDim: 'rgba(0, 204, 68, 0.35)',
  trailColor: [0, 204, 68],  // RGB for trail polylines
};

// ============================================================
// State
// ============================================================

// Map of icao24 -> aircraft state object
const aircraft = new Map();
// Queue of icao24s to fetch hi-res tracks for
const trackFetchQueue = [];
let pollTimer = null;
let trackTimer = null;
let viewer = null;
let is2D = true;

// ============================================================
// Cesium Viewer Initialization
// ============================================================

// No Ion token needed — we use CartoDB tiles, but Cesium wants something non-null
Cesium.Ion.defaultAccessToken = 'not-used';

// Create dark basemap imagery provider (CartoDB dark_matter)
const darkTiles = new Cesium.UrlTemplateImageryProvider({
  url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
  subdomains: ['a', 'b', 'c', 'd'],
  credit: new Cesium.Credit('CartoDB'),
  minimumLevel: 0,
  maximumLevel: 18,
});

// CesiumJS 1.104+ replaced `imageryProvider` with `baseLayer`
viewer = new Cesium.Viewer('cesiumContainer', {
  baseLayer: new Cesium.ImageryLayer(darkTiles),
  baseLayerPicker: false,
  geocoder: false,
  homeButton: false,
  sceneModePicker: false,
  selectionIndicator: false,
  infoBox: false,
  timeline: false,
  animation: false,
  navigationHelpButton: false,
  fullscreenButton: false,
  vrButton: false,
  creditContainer: document.createElement('div'), // hide credits
  scene3DOnly: false,
  sceneMode: Cesium.SceneMode.SCENE2D,
  mapProjection: new Cesium.WebMercatorProjection(),
  orderIndependentTranslucency: false,
});

// With baseLayer set explicitly, no extra layers to remove

// Set dark background color for globe/space
viewer.scene.backgroundColor = Cesium.Color.fromCssColorString('#0a0a0a');
viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString('#0a0a0a');
viewer.scene.globe.showGroundAtmosphere = false;
viewer.scene.globe.enableLighting = false;
viewer.scene.skyAtmosphere && (viewer.scene.skyAtmosphere.show = false);
viewer.scene.fog.enabled = false;

// Fly to Boston Logan
viewer.camera.setView({
  destination: Cesium.Cartesian3.fromDegrees(CONFIG.startLon, CONFIG.startLat, CONFIG.startAlt),
});

// ============================================================
// Aircraft Symbol Generator
// ============================================================

// Create a canvas-based aircraft symbol (small chevron/arrow)
function createAircraftIcon(heading = 0, selected = false) {
  const size = 20;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  ctx.translate(size / 2, size / 2);
  ctx.rotate((heading * Math.PI) / 180);

  // Draw chevron pointing up (north)
  ctx.beginPath();
  ctx.moveTo(0, -7);     // nose
  ctx.lineTo(5, 5);      // right wing tip
  ctx.lineTo(0, 2);      // tail notch
  ctx.lineTo(-5, 5);     // left wing tip
  ctx.closePath();

  const color = selected ? CONFIG.phosphorBright : CONFIG.phosphor;
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 0.5;
  ctx.stroke();

  return canvas;
}

// ============================================================
// Data Block (label) generation
// ============================================================

function formatAltitude(meters) {
  if (meters == null) return '---';
  const feet = meters * 3.28084;
  if (feet >= 18000) return `FL${Math.round(feet / 100)}`;
  return `${Math.round(feet / 100)}`;
}

function formatSpeed(ms) {
  if (ms == null) return '---';
  return `${Math.round(ms * 1.94384)}`; // m/s to knots
}

function verticalIndicator(rate) {
  if (rate == null || Math.abs(rate) < 0.5) return ' ';
  return rate > 0 ? '↑' : '↓';
}

// ============================================================
// OpenSky State Parsing
// ============================================================

// OpenSky state vector indices
const IDX = {
  ICAO24: 0, CALLSIGN: 1, ORIGIN: 2, TIME_POS: 3, LAST_CONTACT: 4,
  LON: 5, LAT: 6, BARO_ALT: 7, ON_GROUND: 8, VELOCITY: 9,
  HEADING: 10, VERT_RATE: 11, SENSORS: 12, GEO_ALT: 13,
  SQUAWK: 14, SPI: 15, POS_SRC: 16
};

function parseState(s) {
  return {
    icao24: s[IDX.ICAO24],
    callsign: (s[IDX.CALLSIGN] || '').trim(),
    lon: s[IDX.LON],
    lat: s[IDX.LAT],
    altitude: s[IDX.BARO_ALT],
    geoAltitude: s[IDX.GEO_ALT],
    onGround: s[IDX.ON_GROUND],
    velocity: s[IDX.VELOCITY],
    heading: s[IDX.HEADING],
    verticalRate: s[IDX.VERT_RATE],
    squawk: s[IDX.SQUAWK],
    lastContact: s[IDX.LAST_CONTACT],
    origin: s[IDX.ORIGIN],
  };
}

// ============================================================
// View Bounds Computation
// ============================================================

function getViewBounds() {
  const rect = viewer.camera.computeViewRectangle();
  if (!rect) {
    // Fallback: large CONUS area
    return { south: 24, west: -125, north: 50, east: -66 };
  }
  const deg = Cesium.Math.toDegrees;
  return {
    south: Math.max(deg(rect.south), -90),
    west: Math.max(deg(rect.west), -180),
    north: Math.min(deg(rect.north), 90),
    east: Math.min(deg(rect.east), 180),
  };
}

// ============================================================
// Aircraft Entity Management
// ============================================================

function updateAircraft(states) {
  const now = Date.now() / 1000;
  const seen = new Set();

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
        trailEntity: null,
        history: [],         // accumulated from polling
        granularTrack: null,  // from /tracks API
        lastTrackFetch: 0,
      };
      aircraft.set(s.icao24, ac);
    }

    // Update state
    ac.state = s;

    // Append to history
    ac.history.push({
      lon: s.lon,
      lat: s.lat,
      alt: s.altitude || 0,
      time: now,
    });

    // Trim old history
    ac.history = ac.history.filter(p => now - p.time < CONFIG.trailMaxAge);

    // Queue for granular track fetch if enabled
    if (CONFIG.granularTrails && now - ac.lastTrackFetch > 120) {
      if (!trackFetchQueue.includes(s.icao24)) {
        trackFetchQueue.push(s.icao24);
      }
    }
  }

  // Remove stale aircraft
  for (const [icao, ac] of aircraft) {
    if (!seen.has(icao)) {
      const age = now - (ac.state.lastContact || 0);
      if (age > CONFIG.staleThreshold) {
        if (ac.entity) viewer.entities.remove(ac.entity);
        if (ac.trailEntity) viewer.entities.remove(ac.trailEntity);
        aircraft.delete(icao);
      }
    }
  }

  // Update visual entities
  renderAircraft();
}

function renderAircraft() {
  for (const [icao, ac] of aircraft) {
    const s = ac.state;
    const pos = Cesium.Cartesian3.fromDegrees(s.lon, s.lat, (s.altitude || 0));

    // --- Aircraft symbol (billboard) ---
    if (!ac.entity) {
      ac.entity = viewer.entities.add({
        id: `ac-${icao}`,
        position: pos,
        billboard: {
          image: createAircraftIcon(s.heading || 0),
          width: 18,
          height: 18,
          pixelOffset: new Cesium.Cartesian2(0, 0),
          eyeOffset: new Cesium.Cartesian3(0, 0, -100),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: CONFIG.labelsEnabled ? {
          text: `${s.callsign || icao}\n${formatAltitude(s.altitude)}${verticalIndicator(s.verticalRate)} ${formatSpeed(s.velocity)}`,
          font: '11px Consolas, monospace',
          fillColor: Cesium.Color.fromCssColorString(CONFIG.phosphor),
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(14, -8),
          horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
          verticalOrigin: Cesium.VerticalOrigin.CENTER,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          showBackground: false,
          scale: 1.0,
        } : undefined,
        properties: { icao24: icao },
      });
    } else {
      // Update position and icon
      ac.entity.position = pos;
      ac.entity.billboard.image = createAircraftIcon(s.heading || 0);

      if (CONFIG.labelsEnabled) {
        if (!ac.entity.label) {
          ac.entity.label = new Cesium.LabelGraphics({
            text: '',
            font: '11px Consolas, monospace',
            fillColor: Cesium.Color.fromCssColorString(CONFIG.phosphor),
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 2,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            pixelOffset: new Cesium.Cartesian2(14, -8),
            horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
            verticalOrigin: Cesium.VerticalOrigin.CENTER,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          });
        }
        ac.entity.label.text = `${s.callsign || icao}\n${formatAltitude(s.altitude)}${verticalIndicator(s.verticalRate)} ${formatSpeed(s.velocity)}`;
      } else if (ac.entity.label) {
        ac.entity.label.show = false;
      }
    }

    // --- Trail polyline ---
    if (CONFIG.trailEnabled) {
      // Merge granular track + polled history for the best trail
      const trailPoints = buildTrailPositions(ac);

      if (trailPoints.length >= 2) {
        const positions = trailPoints.map(p =>
          Cesium.Cartesian3.fromDegrees(p.lon, p.lat, p.alt || 0)
        );

        if (!ac.trailEntity) {
          ac.trailEntity = viewer.entities.add({
            id: `trail-${icao}`,
            polyline: {
              positions: positions,
              width: 1.5,
              material: new Cesium.PolylineGlowMaterialProperty({
                glowPower: 0.15,
                color: Cesium.Color.fromBytes(
                  CONFIG.trailColor[0], CONFIG.trailColor[1], CONFIG.trailColor[2], 120
                ),
              }),
              clampToGround: false,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
          });
        } else {
          ac.trailEntity.polyline.positions = positions;
        }
      }
    } else if (ac.trailEntity) {
      viewer.entities.remove(ac.trailEntity);
      ac.trailEntity = null;
    }
  }
}

// Merge granular API track data with polled history
function buildTrailPositions(ac) {
  const now = Date.now() / 1000;
  const minTime = now - CONFIG.trailMaxAge;
  let points = [];

  // Add granular track points if available
  if (ac.granularTrack && ac.granularTrack.path) {
    for (const wp of ac.granularTrack.path) {
      // wp: [time, lat, lon, baro_alt, heading, on_ground]
      if (wp[0] >= minTime && wp[1] != null && wp[2] != null) {
        points.push({ lon: wp[2], lat: wp[1], alt: wp[3] || 0, time: wp[0] });
      }
    }
  }

  // Add polled history points
  for (const p of ac.history) {
    if (p.time >= minTime) {
      points.push(p);
    }
  }

  // Deduplicate by time (prefer granular data), sort chronologically
  const byTime = new Map();
  for (const p of points) {
    const key = Math.round(p.time);
    if (!byTime.has(key)) {
      byTime.set(key, p);
    }
  }

  return Array.from(byTime.values()).sort((a, b) => a.time - b.time);
}

// ============================================================
// Polling Loop
// ============================================================

async function pollStates() {
  const bounds = getViewBounds();
  const data = await window.flightAPI.getStates(bounds);

  if (data.error) {
    console.warn('[Poll] Error:', data.error);
    return;
  }

  if (data.states && data.states.length > 0) {
    updateAircraft(data.states);
  }

  // Update HUD
  document.getElementById('track-count').textContent = aircraft.size;
  const now = new Date();
  document.getElementById('last-update').textContent =
    now.toLocaleTimeString('en-US', { hour12: false });
}

async function fetchNextTrack() {
  if (!CONFIG.granularTrails || trackFetchQueue.length === 0) return;

  const icao24 = trackFetchQueue.shift();
  const ac = aircraft.get(icao24);
  if (!ac) return;

  const data = await window.flightAPI.getTrack(icao24);
  if (!data.error && data.path) {
    ac.granularTrack = data;
    ac.lastTrackFetch = Date.now() / 1000;
    console.log(`[Track] Got ${data.path.length} waypoints for ${icao24}`);
  }
}

function startPolling() {
  // Initial fetch
  pollStates();

  // Periodic state polling
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(pollStates, CONFIG.pollInterval);

  // Periodic track fetching (one aircraft per 12s to stay within rate limits)
  if (trackTimer) clearInterval(trackTimer);
  trackTimer = setInterval(fetchNextTrack, 12000);
}

// ============================================================
// HUD Clock
// ============================================================

function updateClock() {
  const now = new Date();
  const utc = now.toUTCString().slice(17, 25);
  document.getElementById('clock').textContent = `${utc}Z`;
}
setInterval(updateClock, 1000);
updateClock();

// Update center lat/lon display on camera move
viewer.camera.changed.addEventListener(() => {
  const carto = viewer.camera.positionCartographic;
  if (carto) {
    document.getElementById('center-lat').textContent =
      Cesium.Math.toDegrees(carto.latitude).toFixed(2);
    document.getElementById('center-lon').textContent =
      Cesium.Math.toDegrees(carto.longitude).toFixed(2);
  }
});
viewer.camera.percentageChanged = 0.01;

// ============================================================
// UI Controls
// ============================================================

document.getElementById('toggle-trails').addEventListener('change', (e) => {
  CONFIG.trailEnabled = e.target.checked;
});

document.getElementById('toggle-labels').addEventListener('change', (e) => {
  CONFIG.labelsEnabled = e.target.checked;
  for (const [, ac] of aircraft) {
    if (ac.entity && ac.entity.label) {
      ac.entity.label.show = e.target.checked;
    }
  }
});

document.getElementById('toggle-granular').addEventListener('change', (e) => {
  CONFIG.granularTrails = e.target.checked;
});

document.getElementById('poll-interval').addEventListener('input', (e) => {
  const val = parseInt(e.target.value);
  document.getElementById('poll-value').textContent = `${val}s`;
  CONFIG.pollInterval = val * 1000;
  // Restart polling with new interval
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(pollStates, CONFIG.pollInterval);
});

document.getElementById('trail-length').addEventListener('input', (e) => {
  const val = parseInt(e.target.value);
  document.getElementById('trail-value').textContent = `${Math.round(val / 60)}m`;
  CONFIG.trailMaxAge = val;
});

// View presets
document.getElementById('btn-boston').addEventListener('click', () => {
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(-71.0096, 42.3656, 500000),
    duration: 1.5,
  });
});

document.getElementById('btn-conus').addEventListener('click', () => {
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(-98.5, 39.5, 6000000),
    duration: 1.5,
  });
});

// 2D/3D toggle
document.getElementById('btn-2d').addEventListener('click', () => {
  if (!is2D) {
    viewer.scene.morphTo2D(1.0);
    is2D = true;
    document.getElementById('btn-2d').classList.add('active');
    document.getElementById('btn-3d').classList.remove('active');
  }
});

document.getElementById('btn-3d').addEventListener('click', () => {
  if (is2D) {
    viewer.scene.morphTo3D(1.0);
    is2D = false;
    document.getElementById('btn-3d').classList.add('active');
    document.getElementById('btn-2d').classList.remove('active');
  }
});

// ============================================================
// Aircraft Selection (click to inspect)
// ============================================================

const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
handler.setInputAction((click) => {
  const picked = viewer.scene.pick(click.position);
  if (Cesium.defined(picked) && picked.id && picked.id.id && picked.id.id.startsWith('ac-')) {
    const icao = picked.id.id.replace('ac-', '');
    showAircraftInfo(icao);
  } else {
    hideAircraftInfo();
  }
}, Cesium.ScreenSpaceEventType.LEFT_CLICK);

function showAircraftInfo(icao) {
  const ac = aircraft.get(icao);
  if (!ac) return;
  const s = ac.state;
  const panel = document.getElementById('aircraft-info');
  panel.classList.remove('hidden');

  document.getElementById('info-callsign').textContent = s.callsign || icao;

  const feetAlt = s.altitude ? Math.round(s.altitude * 3.28084) : null;
  const knots = s.velocity ? Math.round(s.velocity * 1.94384) : null;
  const fpm = s.verticalRate ? Math.round(s.verticalRate * 196.85) : null;

  document.getElementById('info-details').innerHTML = `
    <div><span class="label">ICAO24</span><span>${icao.toUpperCase()}</span></div>
    <div><span class="label">SQUAWK</span><span>${s.squawk || '----'}</span></div>
    <div><span class="label">ORIGIN</span><span>${s.origin || '??'}</span></div>
    <div><span class="label">ALT</span><span>${feetAlt != null ? feetAlt.toLocaleString() + ' ft' : '---'}</span></div>
    <div><span class="label">GND SPD</span><span>${knots != null ? knots + ' kts' : '---'}</span></div>
    <div><span class="label">HDG</span><span>${s.heading != null ? Math.round(s.heading) + '°' : '---'}</span></div>
    <div><span class="label">VS</span><span>${fpm != null ? (fpm > 0 ? '+' : '') + fpm + ' fpm' : '---'}</span></div>
    <div><span class="label">LAT</span><span>${s.lat.toFixed(4)}</span></div>
    <div><span class="label">LON</span><span>${s.lon.toFixed(4)}</span></div>
    <div><span class="label">TRAIL PTS</span><span>${ac.history.length}${ac.granularTrack ? '+' + (ac.granularTrack.path || []).length : ''}</span></div>
  `;

  // Immediately request granular track for selected aircraft
  if (CONFIG.granularTrails && !trackFetchQueue.includes(icao)) {
    trackFetchQueue.unshift(icao); // priority
  }
}

function hideAircraftInfo() {
  document.getElementById('aircraft-info').classList.add('hidden');
}

document.getElementById('info-close').addEventListener('click', hideAircraftInfo);

// ============================================================
// Start
// ============================================================

console.log('[FlightRadar] Starting — centered on BOS');
startPolling();
