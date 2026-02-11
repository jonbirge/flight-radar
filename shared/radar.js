// Shared radar engine: Cesium viewer, theme, aircraft management,
// trails, polling, camera handling, UI controls, and aircraft selection.
// Loaded by both Electron and web versions after config.js, data.js, icons.js.
// Requires window.flightAPI to be available before init() is called.

'use strict';

// ============================================================
// State
// ============================================================

const aircraft = new Map();       // icao24 -> aircraft state object
const trackFetchQueue = [];       // icao24s to fetch hi-res tracks for
const airportEntities = [];       // Cesium entities for airport markers
let pollTimer = null;
let trackTimer = null;
let viewer = null;
let is2D = false;
let selectedIcao = null;
let isRotating = false;
let rotateHandler = null;
let frozenBounds = null;          // locked viewport bounds during rotation
let lastPollTime = null;
let lastIconSize = -1;
let lastPollBounds = null;
let viewChangePollDebounce = null;
const RATE_LIMIT_MS = 10000;     // must match main process STATES_MIN_INTERVAL

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
  sceneMode: Cesium.SceneMode.SCENE3D,
  mapProjection: new Cesium.WebMercatorProjection(),
  orderIndependentTranslucency: false,
});

// Set dark background color for globe/space
viewer.scene.backgroundColor = Cesium.Color.fromCssColorString('#0a0a0a');
viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString('#0a0a0a');
viewer.scene.globe.showGroundAtmosphere = false;
viewer.scene.globe.enableLighting = false;
viewer.scene.skyAtmosphere && (viewer.scene.skyAtmosphere.show = false);
viewer.scene.fog.enabled = false;

// Initial view: look at default airport from angled perspective
viewer.camera.lookAt(
  Cesium.Cartesian3.fromDegrees(CONFIG.startLon, CONFIG.startLat, 0),
  new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-30), CONFIG.startAlt)
);
// Unlock camera from the lookAt target so the user can freely navigate
viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);

// ============================================================
// Theme Engine
// ============================================================

function makeDarkTiles() {
  return new Cesium.UrlTemplateImageryProvider({
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
    subdomains: ['a', 'b', 'c', 'd'],
    credit: new Cesium.Credit('CartoDB'),
    minimumLevel: 0, maximumLevel: 18,
  });
}

function makeLightTiles() {
  return new Cesium.UrlTemplateImageryProvider({
    url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
    subdomains: ['a', 'b', 'c', 'd'],
    credit: new Cesium.Credit('CartoDB'),
    minimumLevel: 0, maximumLevel: 18,
  });
}

function applyTheme() {
  const isDark = CONFIG.theme === 'dark';

  // Update color config
  if (isDark) {
    setDarkColors(CONFIG.darkColor);
    CONFIG.labelOutlineColor = Cesium.Color.BLACK;
  } else {
    setLightColors();
  }

  // Swap tile layer
  const layers = viewer.imageryLayers;
  layers.removeAll();
  layers.addImageryProvider(isDark ? makeDarkTiles() : makeLightTiles());

  // Globe & scene background
  const bgColor = isDark ? '#0a0a0a' : '#e8e8e8';
  viewer.scene.backgroundColor = Cesium.Color.fromCssColorString(bgColor);
  viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString(bgColor);

  // CSS body class for HUD/controls styling
  document.body.classList.toggle('theme-light', !isDark);

  // Update CSS custom properties for dynamic dark mode colors
  if (isDark) {
    const root = document.documentElement;
    root.style.setProperty('--phosphor', CONFIG.phosphor);
    root.style.setProperty('--phosphor-bright', CONFIG.phosphorBright);
    root.style.setProperty('--phosphor-dim', CONFIG.phosphorDim);
    root.style.setProperty('--phosphor-faint', withAlpha(CONFIG.darkColor, 0.15));
    root.style.setProperty('--border', withAlpha(CONFIG.darkColor, 0.3));
  } else {
    // Light mode CSS variables are handled by the theme-light class overrides
    const root = document.documentElement;
    root.style.removeProperty('--phosphor');
    root.style.removeProperty('--phosphor-bright');
    root.style.removeProperty('--phosphor-dim');
    root.style.removeProperty('--phosphor-faint');
    root.style.removeProperty('--border');
  }

  // Force re-render all aircraft entities with new colors/sizes
  refreshAllEntities();

  // Update airport marker colors to match theme
  updateAirportColors();
}

// Destroy and re-create all aircraft entities to pick up new theme
function removeTrailEntities(ac) {
  for (const e of ac.trailEntities) viewer.entities.remove(e);
  ac.trailEntities = [];
}

function refreshAllEntities() {
  for (const [icao, ac] of aircraft) {
    if (ac.entity) { viewer.entities.remove(ac.entity); ac.entity = null; }
    removeTrailEntities(ac);
  }
  renderAircraft();
}

// ============================================================
// Airport Markers
// ============================================================

function getAirportColor() {
  return Cesium.Color.WHITE;
}

function getAirportLabelColor() {
  if (CONFIG.theme === 'light') {
    return Cesium.Color.fromCssColorString('rgba(80, 80, 80, 0.85)');
  }
  const rgb = CONFIG.trailColor;
  return Cesium.Color.fromBytes(rgb[0], rgb[1], rgb[2], 180);
}

function initAirports() {
  if (typeof AIRPORT_DB === 'undefined') {
    console.log('[Airports] No AIRPORT_DB found — run: npm run download-data');
    return;
  }

  const pointColor = getAirportColor();
  const labelColor = getAirportLabelColor();

  for (const ap of AIRPORT_DB) {
    const isLarge = ap.type === 'L';
    const label = ap.iata || ap.icao;
    const labelRange = isLarge ? 800000 : 300000;

    // Scale dots down with distance: full size at 100km, 3px at CONUS (~6000km)
    const farScale = isLarge ? (3 / 10) : (3 / 6);
    const dotScale = new Cesium.NearFarScalar(1e5, 1.0, 6e6, farScale);

    const entity = viewer.entities.add({
      // Slight altitude keeps dots above the globe surface at oblique angles
      position: Cesium.Cartesian3.fromDegrees(ap.lon, ap.lat, 500),
      point: {
        pixelSize: isLarge ? 10 : 6,
        color: pointColor,
        outlineWidth: 0,
        scaleByDistance: dotScale,
      },
      label: {
        text: label,
        font: '14px Consolas, monospace',
        fillColor: labelColor,
        outlineColor: CONFIG.theme === 'light' ? Cesium.Color.WHITE : Cesium.Color.BLACK,
        outlineWidth: 2,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, 10),
        horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
        verticalOrigin: Cesium.VerticalOrigin.TOP,
        scale: 0.85,
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, labelRange),
      },
      show: CONFIG.airportsEnabled,
    });
    airportEntities.push(entity);
  }

  console.log(`[Airports] Created ${airportEntities.length} markers`);
}

function toggleAirports(show) {
  CONFIG.airportsEnabled = show;
  for (const entity of airportEntities) {
    entity.show = show;
  }
}

function updateAirportColors() {
  const pointColor = getAirportColor();
  const labelColor = getAirportLabelColor();
  const outlineColor = CONFIG.theme === 'light' ? Cesium.Color.WHITE : Cesium.Color.BLACK;
  for (const entity of airportEntities) {
    entity.point.color = pointColor;
    entity.label.fillColor = labelColor;
    entity.label.outlineColor = outlineColor;
  }
}

// ============================================================
// Poll Interval Management
// ============================================================

function setPollInterval(ms) {
  CONFIG.pollInterval = ms;
  const sel = document.getElementById('poll-interval');
  if (sel) sel.value = String(ms / 1000);
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(pollStates, CONFIG.pollInterval);
}

// ============================================================
// View Bounds Computation
// ============================================================

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
        trailEntities: [],
        history: [],         // accumulated from polling
        granularTrack: null,  // from /tracks API
        lastTrackFetch: 0,
        lastKnownAlt: s.altitude || 0,
      };
      aircraft.set(s.icao24, ac);
    }

    // Update state
    ac.state = s;

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

    // Queue selected aircraft for periodic track refresh (every 30s)
    if (s.icao24 === selectedIcao && now - ac.lastTrackFetch > 30) {
      if (!trackFetchQueue.includes(s.icao24)) {
        trackFetchQueue.unshift(s.icao24);
      }
    }
  }

  // Remove stale aircraft
  for (const [icao, ac] of aircraft) {
    if (!seen.has(icao)) {
      const age = now - (ac.state.lastContact || 0);
      if (age > CONFIG.staleThreshold) {
        if (ac.entity) viewer.entities.remove(ac.entity);
        removeTrailEntities(ac);
        aircraft.delete(icao);
      }
    }
  }

  // Update visual entities
  renderAircraft();

  // Live-update the info panel if a selected aircraft still exists
  if (selectedIcao && aircraft.has(selectedIcao)) {
    showAircraftInfo(selectedIcao);
  } else if (selectedIcao && !aircraft.has(selectedIcao)) {
    hideAircraftInfo();
  }
}

function renderAircraft() {
  // LOD based on camera height
  const camHeight = viewer.camera.positionCartographic
    ? viewer.camera.positionCartographic.height
    : 0;
  const useDot = camHeight > 2000000;
  const showLabels = CONFIG.labelsEnabled && camHeight < 800000;

  for (const [icao, ac] of aircraft) {
    const s = ac.state;
    const pos = Cesium.Cartesian3.fromDegrees(s.lon, s.lat, (s.altitude || 0));
    const isSelected = icao === selectedIcao;

    // Altitude-based color computation
    let altColor = null;
    let altCesiumColor = null;
    if (CONFIG.colorByAltitude) {
      const altRgb = isSelected ? altitudeToSelectedRgb(s.altitude) : altitudeToRgb(s.altitude);
      altColor = `rgb(${altRgb[0]},${altRgb[1]},${altRgb[2]})`;
      altCesiumColor = Cesium.Color.fromBytes(altRgb[0], altRgb[1], altRgb[2], 255);
    }

    const use3dDot = !is2D && !useDot; // in 3D, use dots instead of arrows
    const baseSize = useDot ? 8 : (use3dDot ? 8 : 18);
    const scaledSize = computeIconSize(camHeight, baseSize);
    const iconImage = useDot
      ? createDotIcon(scaledSize, isSelected, altColor)
      : use3dDot
        ? createDotIcon(scaledSize, isSelected, altColor)
        : createAircraftIcon(s.heading || 0, isSelected, altColor);
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
        },
        label: (CONFIG.labelsEnabled || isSelected) ? {
          text: `${s.callsign || icao}\n${formatAltitude(s.altitude)}${verticalIndicator(s.verticalRate)} ${formatSpeed(s.velocity)}`,
          font: `${CONFIG.fontSize}px Consolas, monospace`,
          fillColor: labelColor,
          outlineColor: CONFIG.labelOutlineColor,
          outlineWidth: 2,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(14, -8),
          horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
          verticalOrigin: Cesium.VerticalOrigin.CENTER,
          showBackground: false,
          scale: 1.0,
          show: isSelected || showLabels,
        } : undefined,
        properties: { icao24: icao },
      });
    } else {
      // Update position and icon
      ac.entity.position = pos;
      ac.entity.billboard.image = iconImage;
      ac.entity.billboard.width = iconSize;
      ac.entity.billboard.height = iconSize;

      if (CONFIG.labelsEnabled || isSelected) {
        if (!ac.entity.label) {
          ac.entity.label = new Cesium.LabelGraphics({
            text: '',
            font: `${CONFIG.fontSize}px Consolas, monospace`,
            fillColor: labelColor,
            outlineColor: CONFIG.labelOutlineColor,
            outlineWidth: 2,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            pixelOffset: new Cesium.Cartesian2(14, -8),
            horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
            verticalOrigin: Cesium.VerticalOrigin.CENTER,
          });
        }
        ac.entity.label.text = `${s.callsign || icao}\n${formatAltitude(s.altitude)}${verticalIndicator(s.verticalRate)} ${formatSpeed(s.velocity)}`;
        ac.entity.label.fillColor = labelColor;
        ac.entity.label.show = isSelected || showLabels;
      } else if (ac.entity.label) {
        ac.entity.label.show = false;
      }
    }

    // --- Trail polyline ---
    if (CONFIG.trailEnabled) {
      const trailPoints = buildTrailPositions(ac, isSelected);

      if (trailPoints.length >= 2) {
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

        // Teardown previous trail entities
        removeTrailEntities(ac);

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
                const trailAlpha = isSelected ? 255 : 160;
                const material = Cesium.Color.fromBytes(rgb[0], rgb[1], rgb[2], trailAlpha);
                const positions = runPoints.map(p => Cesium.Cartesian3.fromDegrees(p.lon, p.lat, p.alt));
                ac.trailEntities.push(viewer.entities.add({
                  polyline: {
                    positions: positions,
                    width: trailWidth,
                    material: material,
                    clampToGround: false,
                  },
                }));
              }
              runStart = i;
              currentBucket = bucket;
            }
          }
        } else {
          // Single-color trail
          const trailAlpha = isSelected ? 255 : 160;
          const trailRgb = isSelected ? hexToRgb(CONFIG.phosphorBright) : CONFIG.trailColor;
          const trailMaterial = Cesium.Color.fromBytes(trailRgb[0], trailRgb[1], trailRgb[2], trailAlpha);
          const positions = trailPoints.map(p => Cesium.Cartesian3.fromDegrees(p.lon, p.lat, p.alt));
          ac.trailEntities.push(viewer.entities.add({
            polyline: {
              positions: positions,
              width: trailWidth,
              material: trailMaterial,
              clampToGround: false,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
          }));
        }
      }
    } else {
      removeTrailEntities(ac);
    }
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
  // Selected aircraft gets a much larger gap tolerance to preserve full history.
  const MAX_GAP = isSelected ? 600 : 90;
  let segmentStart = 0;
  for (let i = 1; i < points.length; i++) {
    if (points[i].time - points[i - 1].time > MAX_GAP) {
      segmentStart = i;
    }
  }
  if (segmentStart > 0) {
    points = points.slice(segmentStart);
  }

  return smoothTrailPositions(points);
}

// ============================================================
// Polling Loop
// ============================================================

async function pollStates() {
  const bounds = frozenBounds || getViewBounds();
  const data = await window.flightAPI.getStates(bounds);
  const warningEl = document.getElementById('throttle-warning');

  if (data.error) {
    // Silently ignore our own client-side rate limiting (has retryIn field)
    if (!data.retryIn) {
      console.warn('[Poll] Error:', data.error);
      if (/429/.test(data.error) || /rate.?limit/i.test(data.error)) {
        warningEl.classList.remove('hidden');
      }
    }
    return;
  }

  warningEl.classList.add('hidden');

  if (data.states && data.states.length > 0) {
    updateAircraft(data.states);
  }

  // Update HUD
  lastPollTime = new Date();
  lastPollBounds = bounds;
  document.getElementById('track-count').textContent = aircraft.size;
  document.getElementById('last-update').textContent =
    lastPollTime.toLocaleTimeString('en-US', { hour12: false });
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
  // Set initial poll interval based on current zoom level
  const camHeight = viewer.camera.positionCartographic
    ? viewer.camera.positionCartographic.height
    : CONFIG.startAlt;
  setPollInterval(computePollInterval(camHeight));

  // Initial fetch
  pollStates();

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

// ============================================================
// Camera Change Handler
// ============================================================

function boundsContain(outer, inner) {
  if (!outer || !inner) return false;
  return inner.south >= outer.south && inner.north <= outer.north
      && inner.west >= outer.west && inner.east <= outer.east;
}

function scheduleViewportPoll() {
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

    // Re-render aircraft when icon size changes (continuous LOD)
    const newIconSize = computeDisplaySize(h);
    if (newIconSize !== lastIconSize) {
      lastIconSize = newIconSize;
      renderAircraft();
    }

    // Adjust poll interval based on zoom level
    const newPollInterval = computePollInterval(h);
    if (newPollInterval !== CONFIG.pollInterval) {
      setPollInterval(newPollInterval);
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

document.getElementById('toggle-trails').addEventListener('change', (e) => {
  CONFIG.trailEnabled = e.target.checked;
  renderAircraft();
});

document.getElementById('toggle-airports').addEventListener('change', (e) => {
  toggleAirports(e.target.checked);
});

document.getElementById('toggle-labels').addEventListener('change', (e) => {
  CONFIG.labelsEnabled = e.target.checked;
  for (const [, ac] of aircraft) {
    if (ac.entity && ac.entity.label) {
      ac.entity.label.show = e.target.checked;
    }
  }
});

document.getElementById('poll-interval').addEventListener('change', (e) => {
  setPollInterval(parseInt(e.target.value) * 1000);
});

document.getElementById('trail-length').addEventListener('input', (e) => {
  const val = parseInt(e.target.value);
  document.getElementById('trail-value').textContent = `${Math.round(val / 60)}m`;
  CONFIG.trailMaxAge = val;
});

// View presets
document.getElementById('btn-home').addEventListener('click', () => {
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
});

document.getElementById('btn-save-view').addEventListener('click', async () => {
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
  // Update CONFIG so HOME button uses the new saved view immediately
  CONFIG.savedView = savedView;
  // Brief visual feedback
  const btn = document.getElementById('btn-save-view');
  btn.classList.add('active');
  setTimeout(() => btn.classList.remove('active'), 600);
});

// CONUS button (Electron only — absent from web HTML, so guard with null check)
const conusBtn = document.getElementById('btn-conus');
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
    document.getElementById('btn-rotate').disabled = false;
  } else {
    // Stop rotation when switching to 2D
    if (isRotating) {
      isRotating = false;
      stopRotation();
      document.getElementById('btn-rotate').classList.remove('active');
    }
    viewer.scene.morphTo2D(1.0);
    is2D = true;
    document.getElementById('btn-2d').classList.add('active');
    document.getElementById('btn-3d').classList.remove('active');
    document.getElementById('btn-rotate').disabled = true;
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

document.getElementById('btn-rotate').addEventListener('click', () => {
  if (is2D) return; // rotation only works in 3D
  isRotating = !isRotating;
  document.getElementById('btn-rotate').classList.toggle('active', isRotating);
  if (isRotating) {
    startRotation();
  } else {
    stopRotation();
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

  const prevSelected = selectedIcao;
  selectedIcao = icao;

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
    <div><span class="label">LAST POLL</span><span>${lastPollTime ? lastPollTime.toLocaleTimeString('en-US', { hour12: false }) : '---'}</span></div>
    <div><span class="label">ADS-B</span><span>${s.lastContact ? new Date(s.lastContact * 1000).toLocaleTimeString('en-US', { hour12: false }) : '---'}</span></div>
  `;

  // Immediately fetch track history for selected aircraft
  if (!trackFetchQueue.includes(icao)) {
    trackFetchQueue.unshift(icao);
    fetchNextTrack();
  }

  // Re-render to apply highlight to newly selected and dim previously selected
  if (prevSelected !== icao) {
    refreshAllEntities();
  }
}

function hideAircraftInfo() {
  const hadSelection = selectedIcao !== null;
  selectedIcao = null;
  document.getElementById('aircraft-info').classList.add('hidden');
  if (hadSelection) {
    refreshAllEntities();
  }
}

document.getElementById('info-close').addEventListener('click', hideAircraftInfo);

// ============================================================
// Shared Init Helpers
// ============================================================

// Load settings from the platform-specific settings API and apply them
async function loadAndApplySettings() {
  try {
    const saved = await window.flightAPI.getSettings();
    if (saved) {
      CONFIG.fontSize = saved.fontSize || 11;
      CONFIG.theme = saved.theme || 'dark';
      CONFIG.darkColor = saved.darkColor || '#00cc44';
      CONFIG.colorByAltitude = saved.colorByAltitude !== undefined ? saved.colorByAltitude : true;
      CONFIG.thickTrailsByAltitude = saved.thickTrailsByAltitude || false;
      CONFIG.rotationSpeed = saved.rotationSpeed || 3;
      CONFIG.openskyClientId = saved.openskyClientId || '';
      CONFIG.openskyClientSecret = saved.openskyClientSecret || '';
      CONFIG.savedView = saved.savedView || null;
      applyTheme();
    }
  } catch (err) {
    console.warn('[Settings] Could not load:', err);
  }

  // Initialize airport markers (after theme is applied so colors are correct)
  if (airportEntities.length === 0) {
    initAirports();
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
