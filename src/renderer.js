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

  // Visual (dynamically updated by theme system)
  fontSize: 11,
  theme: 'dark',              // 'dark' | 'light'
  darkColor: '#00cc44',       // user-selected dark mode color
  defaultAirport: 'BOS',     // IATA code for startup view
  phosphor: '#00cc44',
  phosphorBright: '#33ff66',
  phosphorSelect: '#99ffbb',
  phosphorDim: 'rgba(0, 204, 68, 0.35)',
  trailColor: [0, 204, 68],  // RGB for trail polylines
  labelOutlineColor: Cesium.Color.BLACK,
};

// ============================================================
// Color Utilities
// ============================================================

function hexToRgb(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return [r, g, b];
}

function brighten(hex, factor = 1.3) {
  const [r, g, b] = hexToRgb(hex);
  const clamp = v => Math.min(255, Math.round(v * factor));
  return `#${clamp(r).toString(16).padStart(2,'0')}${clamp(g).toString(16).padStart(2,'0')}${clamp(b).toString(16).padStart(2,'0')}`;
}

function withAlpha(hex, alpha) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function lighten(hex, amount = 0.5) {
  const [r, g, b] = hexToRgb(hex);
  const lr = Math.round(r + (255 - r) * amount);
  const lg = Math.round(g + (255 - g) * amount);
  const lb = Math.round(b + (255 - b) * amount);
  return `#${lr.toString(16).padStart(2,'0')}${lg.toString(16).padStart(2,'0')}${lb.toString(16).padStart(2,'0')}`;
}

// Derive all color properties from a single base hex color
function setDarkColors(hex) {
  CONFIG.darkColor = hex;
  CONFIG.phosphor = hex;
  CONFIG.phosphorBright = brighten(hex, 1.4);
  CONFIG.phosphorSelect = lighten(CONFIG.phosphorBright, 0.5);
  CONFIG.phosphorDim = withAlpha(hex, 0.35);
  CONFIG.trailColor = hexToRgb(hex);
}

// Light mode uses fixed black/dark-gray palette
function setLightColors() {
  CONFIG.phosphor = '#1a1a1a';
  CONFIG.phosphorBright = '#000000';
  CONFIG.phosphorSelect = '#000000';
  CONFIG.phosphorDim = 'rgba(0, 0, 0, 0.45)';
  CONFIG.trailColor = [40, 40, 40];
  CONFIG.labelOutlineColor = Cesium.Color.WHITE;
}

// ============================================================
// Airport Database (major US airports + select international)
// ============================================================

const AIRPORTS = {
  // Northeast
  BOS: { name: 'Boston Logan International',        lat: 42.3656, lon: -71.0096 },
  JFK: { name: 'John F. Kennedy International',     lat: 40.6413, lon: -73.7781 },
  LGA: { name: 'LaGuardia',                         lat: 40.7769, lon: -73.8740 },
  EWR: { name: 'Newark Liberty International',      lat: 40.6895, lon: -74.1745 },
  PHL: { name: 'Philadelphia International',        lat: 39.8721, lon: -75.2411 },
  DCA: { name: 'Ronald Reagan Washington National', lat: 38.8512, lon: -77.0402 },
  IAD: { name: 'Washington Dulles International',   lat: 38.9531, lon: -77.4565 },
  BWI: { name: 'Baltimore/Washington International',lat: 39.1754, lon: -76.6684 },
  PVD: { name: 'T.F. Green International',          lat: 41.7241, lon: -71.4283 },
  BDL: { name: 'Bradley International',             lat: 41.9389, lon: -72.6832 },
  // Southeast
  ATL: { name: 'Hartsfield-Jackson Atlanta',        lat: 33.6407, lon: -84.4277 },
  MIA: { name: 'Miami International',               lat: 25.7959, lon: -80.2870 },
  FLL: { name: 'Fort Lauderdale-Hollywood',         lat: 26.0742, lon: -80.1506 },
  MCO: { name: 'Orlando International',             lat: 28.4312, lon: -81.3081 },
  TPA: { name: 'Tampa International',               lat: 27.9756, lon: -82.5333 },
  CLT: { name: 'Charlotte Douglas International',   lat: 35.2140, lon: -80.9431 },
  RDU: { name: 'Raleigh-Durham International',      lat: 35.8776, lon: -78.7875 },
  BNA: { name: 'Nashville International',           lat: 36.1263, lon: -86.6774 },
  // Midwest
  ORD: { name: "O'Hare International",              lat: 41.9742, lon: -87.9073 },
  MDW: { name: 'Chicago Midway',                    lat: 41.7868, lon: -87.7522 },
  DTW: { name: 'Detroit Metropolitan',              lat: 42.2124, lon: -83.3534 },
  MSP: { name: 'Minneapolis-Saint Paul',            lat: 44.8848, lon: -93.2223 },
  STL: { name: 'St. Louis Lambert International',   lat: 38.7487, lon: -90.3700 },
  CVG: { name: 'Cincinnati/Northern Kentucky',      lat: 39.0488, lon: -84.6678 },
  CLE: { name: 'Cleveland Hopkins International',   lat: 41.4117, lon: -81.8498 },
  MKE: { name: 'Milwaukee Mitchell International',  lat: 42.9472, lon: -87.8966 },
  IND: { name: 'Indianapolis International',        lat: 39.7173, lon: -86.2944 },
  // South/Central
  DFW: { name: 'Dallas/Fort Worth International',   lat: 32.8998, lon: -97.0403 },
  IAH: { name: 'George Bush Intercontinental',      lat: 29.9902, lon: -95.3368 },
  HOU: { name: 'William P. Hobby',                  lat: 29.6454, lon: -95.2789 },
  AUS: { name: 'Austin-Bergstrom International',    lat: 30.1975, lon: -97.6664 },
  MSY: { name: 'Louis Armstrong New Orleans',       lat: 29.9934, lon: -90.2580 },
  MEM: { name: 'Memphis International',             lat: 35.0424, lon: -89.9767 },
  // West
  LAX: { name: 'Los Angeles International',         lat: 33.9416, lon: -118.4085 },
  SFO: { name: 'San Francisco International',       lat: 37.6213, lon: -122.3790 },
  SJC: { name: 'San Jose International',            lat: 37.3639, lon: -121.9289 },
  OAK: { name: 'Oakland International',             lat: 37.7213, lon: -122.2208 },
  SEA: { name: 'Seattle-Tacoma International',      lat: 47.4502, lon: -122.3088 },
  PDX: { name: 'Portland International',            lat: 45.5898, lon: -122.5951 },
  DEN: { name: 'Denver International',              lat: 39.8561, lon: -104.6737 },
  PHX: { name: 'Phoenix Sky Harbor',                lat: 33.4373, lon: -112.0078 },
  LAS: { name: 'Harry Reid International',          lat: 36.0840, lon: -115.1537 },
  SLC: { name: 'Salt Lake City International',      lat: 40.7899, lon: -111.9791 },
  SAN: { name: 'San Diego International',           lat: 32.7338, lon: -117.1933 },
  SNA: { name: 'John Wayne Airport',                lat: 33.6757, lon: -117.8678 },
  // Hawaii / Alaska
  HNL: { name: 'Daniel K. Inouye International',   lat: 21.3187, lon: -157.9225 },
  ANC: { name: 'Ted Stevens Anchorage',             lat: 61.1743, lon: -149.9982 },
};

function lookupAirport(code) {
  return AIRPORTS[(code || '').toUpperCase().trim()] || null;
}

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
let is2D = false;
let selectedIcao = null;
let isRotating = false;
let rotateHandler = null;
let lastPollTime = null;

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

// With baseLayer set explicitly, no extra layers to remove

// Set dark background color for globe/space
viewer.scene.backgroundColor = Cesium.Color.fromCssColorString('#0a0a0a');
viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString('#0a0a0a');
viewer.scene.globe.showGroundAtmosphere = false;
viewer.scene.globe.enableLighting = false;
viewer.scene.skyAtmosphere && (viewer.scene.skyAtmosphere.show = false);
viewer.scene.fog.enabled = false;

// Initial view: look at default airport from 45-degree angle
viewer.camera.lookAt(
  Cesium.Cartesian3.fromDegrees(CONFIG.startLon, CONFIG.startLat, 0),
  new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-30), CONFIG.startAlt)
);
// Unlock camera from the lookAt target so the user can freely navigate
viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);

// ============================================================
// Theme Engine
// ============================================================

// Tile providers
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
}

// Destroy and re-create all aircraft entities to pick up new theme
function refreshAllEntities() {
  for (const [icao, ac] of aircraft) {
    if (ac.entity) { viewer.entities.remove(ac.entity); ac.entity = null; }
    if (ac.trailEntity) { viewer.entities.remove(ac.trailEntity); ac.trailEntity = null; }
  }
  renderAircraft();
}

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

  const color = selected ? CONFIG.phosphorSelect : CONFIG.phosphor;
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 0.5;
  ctx.stroke();

  return canvas;
}

// Create a simple dot icon for zoomed-out LOD
// Render at 4x resolution for clean anti-aliased circles at small display sizes
function createDotIcon(size, bright = false) {
  const scale = 4;
  const res = size * scale;
  const canvas = document.createElement('canvas');
  canvas.width = res;
  canvas.height = res;
  const ctx = canvas.getContext('2d');
  ctx.beginPath();
  ctx.arc(res / 2, res / 2, res / 2, 0, Math.PI * 2);
  ctx.fillStyle = bright ? CONFIG.phosphorSelect : CONFIG.phosphor;
  ctx.fill();
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

    // Queue for granular track fetch if enabled
    // Selected aircraft refreshes every 30s; others every 120s
    const trackInterval = (s.icao24 === selectedIcao) ? 30 : 120;
    if (CONFIG.granularTrails && now - ac.lastTrackFetch > trackInterval) {
      if (!trackFetchQueue.includes(s.icao24)) {
        if (s.icao24 === selectedIcao) {
          trackFetchQueue.unshift(s.icao24); // priority for selected
        } else {
          trackFetchQueue.push(s.icao24);
        }
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
  const showLabels = CONFIG.labelsEnabled && camHeight < 500000;
  // Dot size: 8px at 2000km, linearly down to 3px at 10000km+
  const dotSize = useDot
    ? Math.round(Math.max(3, 8 - (camHeight - 2000000) / (10000000 - 2000000) * 5))
    : 0;

  for (const [icao, ac] of aircraft) {
    const s = ac.state;
    const pos = Cesium.Cartesian3.fromDegrees(s.lon, s.lat, (s.altitude || 0));
    const isSelected = icao === selectedIcao;

    const use3dDot = !is2D && !useDot; // in 3D, use dots instead of arrows
    const iconImage = useDot
      ? createDotIcon(dotSize, isSelected)
      : use3dDot
        ? createDotIcon(8, isSelected)
        : createAircraftIcon(s.heading || 0, isSelected);
    const iconSize = useDot ? dotSize : use3dDot ? 8 : 18;
    const labelColor = isSelected
      ? Cesium.Color.fromCssColorString(CONFIG.phosphorSelect)
      : Cesium.Color.fromCssColorString(CONFIG.phosphor);

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
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
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
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
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
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
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
      // Merge granular track + polled history for the best trail
      const trailPoints = buildTrailPositions(ac, isSelected);

      if (trailPoints.length >= 2) {
        const positions = trailPoints.map(p =>
          Cesium.Cartesian3.fromDegrees(p.lon, p.lat, p.alt)
        );

        const trailAlpha = isSelected ? 255 : 160;
        const trailRgb = isSelected ? hexToRgb(CONFIG.phosphorBright) : CONFIG.trailColor;
        const trailMaterial = Cesium.Color.fromBytes(trailRgb[0], trailRgb[1], trailRgb[2], trailAlpha);

        if (!ac.trailEntity) {
          ac.trailEntity = viewer.entities.add({
            id: `trail-${icao}`,
            polyline: {
              positions: positions,
              width: isSelected ? 4 : 3,
              material: trailMaterial,
              clampToGround: false,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
          });
        } else {
          ac.trailEntity.polyline.positions = positions;
          ac.trailEntity.polyline.width = isSelected ? 4 : 3;
          ac.trailEntity.polyline.material = trailMaterial;
        }
      }
    } else if (ac.trailEntity) {
      viewer.entities.remove(ac.trailEntity);
      ac.trailEntity = null;
    }
  }
}

// Merge granular API track data with polled history
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

  return points;
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
  lastPollTime = new Date();
  document.getElementById('track-count').textContent = aircraft.size;
  document.getElementById('last-update').textContent =
    lastPollTime.toLocaleTimeString('en-US', { hour12: false });
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

// Update center lat/lon display and LOD on camera move
let lastLodLevel = -1;
viewer.camera.changed.addEventListener(() => {
  const carto = viewer.camera.positionCartographic;
  if (carto) {
    document.getElementById('center-lat').textContent =
      Cesium.Math.toDegrees(carto.latitude).toFixed(2);
    document.getElementById('center-lon').textContent =
      Cesium.Math.toDegrees(carto.longitude).toFixed(2);

    // Re-render aircraft when LOD level changes
    const h = carto.height;
    const lodLevel = h > 2000000 ? 2 : h > 500000 ? 1 : 0;
    if (lodLevel !== lastLodLevel) {
      lastLodLevel = lodLevel;
      renderAircraft();
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

document.getElementById('poll-interval').addEventListener('change', (e) => {
  const val = parseInt(e.target.value);
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

document.getElementById('btn-conus').addEventListener('click', () => {
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(-98.5, 39.5, 6000000),
    duration: 1.5,
  });
});

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
  const RATE = Cesium.Math.toRadians(3); // degrees per second

  // Determine the ground point, pitch, and range at the moment rotation starts
  const ray = viewer.camera.getPickRay(new Cesium.Cartesian2(
    viewer.canvas.clientWidth / 2, viewer.canvas.clientHeight / 2
  ));
  const groundPoint = viewer.scene.globe.pick(ray, viewer.scene);
  if (!groundPoint) return; // can't determine ground target

  const cameraPos = viewer.camera.positionCartographic;
  const targetCarto = Cesium.Cartographic.fromCartesian(groundPoint);
  const range = Cesium.Cartesian3.distance(viewer.camera.position, groundPoint);
  const pitch = viewer.camera.pitch;
  let currentHeading = viewer.camera.heading;
  let lastTime = Date.now();

  rotateHandler = () => {
    const now = Date.now();
    const dt = (now - lastTime) / 1000;
    lastTime = now;
    currentHeading = (currentHeading + RATE * dt) % Cesium.Math.TWO_PI;
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

  // Immediately request granular track for selected aircraft
  if (CONFIG.granularTrails && !trackFetchQueue.includes(icao)) {
    trackFetchQueue.unshift(icao); // priority
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
// Settings Panel
// ============================================================

const settingsOverlay = document.getElementById('settings-overlay');
const fontSizeSlider = document.getElementById('set-fontsize');
const fontSizeVal = document.getElementById('set-fontsize-val');
const fontPreview = document.getElementById('fontsize-preview');
const btnThemeDark = document.getElementById('set-theme-dark');
const btnThemeLight = document.getElementById('set-theme-light');
const darkColorSection = document.getElementById('dark-color-section');
const colorSwatches = document.querySelectorAll('.color-swatch');
const customColorInput = document.getElementById('set-custom-color');
const airportInput = document.getElementById('set-airport');
const airportName = document.getElementById('airport-name');
const openskyClientIdInput = document.getElementById('set-opensky-client-id');
const openskyClientSecretInput = document.getElementById('set-opensky-client-secret');

// Temporary state while the settings panel is open
let pendingSettings = {};

function openSettings() {
  pendingSettings = {
    fontSize: CONFIG.fontSize,
    theme: CONFIG.theme,
    darkColor: CONFIG.darkColor,
    defaultAirport: CONFIG.defaultAirport,
    openskyClientId: CONFIG.openskyClientId || '',
    openskyClientSecret: CONFIG.openskyClientSecret || '',
  };
  syncSettingsUI();
  settingsOverlay.classList.remove('hidden');
}

function closeSettings() {
  settingsOverlay.classList.add('hidden');
}

function syncSettingsUI() {
  fontSizeSlider.value = pendingSettings.fontSize;
  fontSizeVal.textContent = `${pendingSettings.fontSize}px`;
  fontPreview.style.fontSize = `${pendingSettings.fontSize}px`;

  btnThemeDark.classList.toggle('active', pendingSettings.theme === 'dark');
  btnThemeLight.classList.toggle('active', pendingSettings.theme === 'light');
  darkColorSection.style.display = pendingSettings.theme === 'dark' ? '' : 'none';

  colorSwatches.forEach(sw => {
    sw.classList.toggle('active', sw.dataset.color === pendingSettings.darkColor);
  });
  customColorInput.value = pendingSettings.darkColor;

  airportInput.value = pendingSettings.defaultAirport;
  updateAirportName(pendingSettings.defaultAirport);

  openskyClientIdInput.value = pendingSettings.openskyClientId;
  openskyClientSecretInput.value = pendingSettings.openskyClientSecret;
}

function updateAirportName(code) {
  const ap = lookupAirport(code);
  airportName.textContent = ap ? ap.name : (code.length >= 3 ? 'Unknown airport' : '');
}

// Font size slider
fontSizeSlider.addEventListener('input', (e) => {
  pendingSettings.fontSize = parseInt(e.target.value);
  fontSizeVal.textContent = `${pendingSettings.fontSize}px`;
  fontPreview.style.fontSize = `${pendingSettings.fontSize}px`;
});

// Theme toggle
btnThemeDark.addEventListener('click', () => {
  pendingSettings.theme = 'dark';
  syncSettingsUI();
});
btnThemeLight.addEventListener('click', () => {
  pendingSettings.theme = 'light';
  syncSettingsUI();
});

// Color swatches
colorSwatches.forEach(sw => {
  sw.addEventListener('click', () => {
    pendingSettings.darkColor = sw.dataset.color;
    syncSettingsUI();
  });
});

// Custom color picker
customColorInput.addEventListener('input', (e) => {
  pendingSettings.darkColor = e.target.value;
  colorSwatches.forEach(sw => sw.classList.remove('active'));
});

// Airport input
airportInput.addEventListener('input', (e) => {
  const code = e.target.value.toUpperCase().trim();
  pendingSettings.defaultAirport = code;
  updateAirportName(code);
});

// OpenSky credentials
openskyClientIdInput.addEventListener('input', (e) => {
  pendingSettings.openskyClientId = e.target.value.trim();
});
openskyClientSecretInput.addEventListener('input', (e) => {
  pendingSettings.openskyClientSecret = e.target.value;
});

// Apply
document.getElementById('settings-apply').addEventListener('click', async () => {
  CONFIG.fontSize = pendingSettings.fontSize;
  CONFIG.theme = pendingSettings.theme;
  CONFIG.darkColor = pendingSettings.darkColor;
  CONFIG.defaultAirport = pendingSettings.defaultAirport;
  CONFIG.openskyClientId = pendingSettings.openskyClientId;
  CONFIG.openskyClientSecret = pendingSettings.openskyClientSecret;
  applyTheme();
  closeSettings();
  await window.flightAPI.saveSettings({
    fontSize: CONFIG.fontSize,
    theme: CONFIG.theme,
    darkColor: CONFIG.darkColor,
    defaultAirport: CONFIG.defaultAirport,
    openskyClientId: CONFIG.openskyClientId,
    openskyClientSecret: CONFIG.openskyClientSecret,
  });
});

// Cancel
document.getElementById('settings-cancel').addEventListener('click', closeSettings);
document.getElementById('settings-close').addEventListener('click', closeSettings);

// Close on overlay click (outside panel)
settingsOverlay.addEventListener('click', (e) => {
  if (e.target === settingsOverlay) closeSettings();
});

// Listen for menu-triggered open
window.flightAPI.onOpenSettings(() => openSettings());

// ============================================================
// Start
// ============================================================

async function init() {
  // Load persisted settings
  try {
    const saved = await window.flightAPI.getSettings();
    if (saved) {
      CONFIG.fontSize = saved.fontSize || 11;
      CONFIG.theme = saved.theme || 'dark';
      CONFIG.darkColor = saved.darkColor || '#00cc44';
      CONFIG.defaultAirport = saved.defaultAirport || 'BOS';
      CONFIG.openskyClientId = saved.openskyClientId || '';
      CONFIG.openskyClientSecret = saved.openskyClientSecret || '';
      CONFIG.savedView = saved.savedView || null;
      applyTheme();
    }
  } catch (err) {
    console.warn('[Settings] Could not load:', err);
  }

  // Fly to saved view or default airport
  if (CONFIG.savedView) {
    const sv = CONFIG.savedView;
    viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(sv.lon, sv.lat, sv.height),
      orientation: { heading: sv.heading, pitch: sv.pitch, roll: 0 },
    });
    console.log(`[FlightRadar] Starting — restored saved view (${sv.lat.toFixed(2)}, ${sv.lon.toFixed(2)})`);
  } else {
    const ap = lookupAirport(CONFIG.defaultAirport);
    if (ap) {
      viewer.camera.lookAt(
        Cesium.Cartesian3.fromDegrees(ap.lon, ap.lat, 0),
        new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-30), CONFIG.startAlt)
      );
      viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
      console.log(`[FlightRadar] Starting — centered on ${CONFIG.defaultAirport} (${ap.name})`);
    } else {
      console.log('[FlightRadar] Starting — centered on BOS (default)');
    }
  }

  startPolling();
}

init();
