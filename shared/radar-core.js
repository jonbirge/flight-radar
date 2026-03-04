// Shared radar core: state declarations, Cesium viewer init, and theme engine.
// Loaded first — all other radar-*.js files depend on this.

'use strict';

// ============================================================
// State
// ============================================================

const aircraft = new Map();       // icao24 -> aircraft state object
const trackFetchQueue = [];       // icao24s to fetch hi-res tracks for
const airportEntities = [];       // Cesium entities for airport markers
const smallAirportEntities = [];  // Cesium entities for small airport markers
const airspaceEntities = [];     // Cesium entities for airspace polygons
const waypointEntities = [];     // Cesium entities for fix markers
const navaidEntities = [];       // Cesium entities for navaid markers
let cachedAirportData = null;     // Cached airport JSON for rebuilds
let cachedWaypointData = null;    // Cached waypoint JSON for rebuilds
let tickTimer = null;              // unified timer for extrapolation + polling + track fetches
let clockTimer = null;             // HUD clock update interval
let viewer = null;
let is2D = false;
let selectedIcao = null;
let isRotating = false;
let isTracking = false;
let rotateHandler = null;
let frozenBounds = null;          // locked viewport bounds during rotation
let lastPollTime = null;
let rateLimitedUntil = 0;           // timestamp: suppress all polling until this time
let lastIconSize = -1;
let lastPollBounds = null;
let lastPollHeight = null;          // camera height at last poll interval adjustment
let lastPositionUpdateHeight = null; // camera height at last position update interval adjustment
let viewChangePollDebounce = null;
let lastUseDot = null;              // track LOD tier to detect dot↔arrow transitions
let _zoomResizeRAF = null;          // rAF token for debouncing lightweight zoom resizes
const RATE_LIMIT_MS = 10000;     // must match main process STATES_MIN_INTERVAL
const RENDER_CHUNK_SIZE = 80;    // aircraft per frame in chunked render
let _renderGeneration = 0;       // incremented to cancel stale chunked renders
let acDisplayCond = null;        // shared DistanceDisplayCondition for aircraft/PIREPs
let radarLayer = null;
let radarRefreshTimer = null;
let satelliteIRLayer = null;
let satelliteIRRefreshTimer = null;
let turbLayer = null;
let turbRefreshTimer = null;
let pirepRefreshTimer = null;
let sigmetRefreshTimer = null;
let airmetRefreshTimer = null;
const pirepEntities = [];
const sigmetEntities = [];
const airmetEntities = [];
const _scrubAirmetEntities = [];  // separate AIRMET entities for timeline scrubbing (all forecast hours)
const flightPlanEntities = [];  // Cesium entities for flight plan route
let activeFlightPlan = null;     // current flight plan data
let searchedFlightIdent = null;  // callsign of the searched flight (for visibility bypass)
let searchedIcao = null;         // ICAO24 of the matched live aircraft (for visibility bypass)
let selectedRouteFlight = null;  // picked flight from activeFlightPlan for info panel
let timelineTime = null;         // ms timestamp for timeline scrubbing (null = live/now mode)
let timelineEntity = null;       // Cesium entity showing aircraft position on timeline
const timelineRoutePoints = [];  // geographic route points [{lon, lat, alt}] for interpolation
let lastSelectedPollMs = 0;      // timestamp of last selected-aircraft poll
let lastTrackFetchMs = 0;        // timestamp of last track queue processing
let _pollInFlight = false;       // guard: true while pollStates() is running
let _selectedPollInFlight = false; // guard: true while pollSelectedAircraft() is running
let _lastBulkPollMs = 0;         // timestamp of last bulk poll API call
let _lastSelectedPollApiMs = 0;  // timestamp of last selected-aircraft API call
const SELECTED_POLL_INTERVAL = 10000; // poll selected aircraft every 10s
const TRACK_FETCH_INTERVAL = 12000;   // process track queue every 12s

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
  msaaSamples: 4,
  contextOptions: { webgl: { antialias: true } },
});

// FXAA post-process anti-aliasing (smooths polygon/polyline edges)
viewer.scene.postProcessStages.fxaa.enabled = true;

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

function makeDarkNoLabelsTiles() {
  return new Cesium.UrlTemplateImageryProvider({
    url: 'https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}.png',
    subdomains: ['a', 'b', 'c', 'd'],
    credit: new Cesium.Credit('CartoDB'),
    minimumLevel: 0, maximumLevel: 18,
  });
}

function makeLightNoLabelsTiles() {
  return new Cesium.UrlTemplateImageryProvider({
    url: 'https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}.png',
    subdomains: ['a', 'b', 'c', 'd'],
    credit: new Cesium.Credit('CartoDB'),
    minimumLevel: 0, maximumLevel: 18,
  });
}

function makeEsriGrayTiles() {
  const variant = CONFIG.theme === 'dark' ? 'World_Dark_Gray_Base' : 'World_Light_Gray_Base';
  return new Cesium.UrlTemplateImageryProvider({
    url: `https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/${variant}/MapServer/tile/{z}/{y}/{x}`,
    credit: new Cesium.Credit('Esri'),
    minimumLevel: 0, maximumLevel: 16,
  });
}

function makeSatelliteTiles() {
  return new Cesium.UrlTemplateImageryProvider({
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    credit: new Cesium.Credit('Esri, Maxar, Earthstar Geographics'),
    minimumLevel: 0, maximumLevel: 19,
  });
}

function makeOsmTiles() {
  return new Cesium.OpenStreetMapImageryProvider({
    url: 'https://tile.openstreetmap.org/',
    credit: new Cesium.Credit('OpenStreetMap contributors'),
  });
}

function makeTopoTiles() {
  return new Cesium.UrlTemplateImageryProvider({
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    subdomains: ['a', 'b', 'c'],
    credit: new Cesium.Credit('OpenTopoMap, OpenStreetMap contributors'),
    minimumLevel: 0, maximumLevel: 17,
  });
}

function makeNightTiles() {
  return new Cesium.WebMapTileServiceImageryProvider({
    url: 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/wmts.cgi',
    layer: 'VIIRS_Black_Marble',
    style: 'default',
    format: 'image/png',
    tileMatrixSetID: 'GoogleMapsCompatible_Level8',
    maximumLevel: 8,
    credit: new Cesium.Credit('NASA EOSDIS GIBS'),
  });
}

// VFRMap.com chart tiles — date folder changes each FAA chart cycle
// Uses TMS (y-flipped); CesiumJS handles this via {reverseY}
const VFRMAP_DATE = '20251225';

function makeVfrMapTiles(chartType, maxZoom) {
  // Web version routes through PHP caching proxy to avoid CORS
  const url = CONFIG.vfrMapProxyUrl
    ? `${CONFIG.vfrMapProxyUrl}?date=${VFRMAP_DATE}&chart=${chartType}&z={z}&y={reverseY}&x={x}`
    : `https://vfrmap.com/${VFRMAP_DATE}/tiles/${chartType}/{z}/{reverseY}/{x}.jpg`;
  return new Cesium.UrlTemplateImageryProvider({
    url,
    credit: new Cesium.Credit('VFRMap.com'),
    minimumLevel: 1, maximumLevel: maxZoom,
  });
}

// Layers that have limited zoom and need a CartoDB base underneath
const OVERLAY_LAYERS = new Set(['vfrHybrid', 'vfrIfrLow', 'vfrIfrHigh']);

// Apply theme-appropriate brightness/saturation to map imagery layers.
// Dark mode always darkens (except layers that are already theme-matched).
// Light mode only mutes when the user has "Mute map colors" enabled.
const NO_STYLE_LAYERS = new Set(['carto', 'noLabels', 'esriGray']);

function styleMapLayer(layer, layerId) {
  const isDark = CONFIG.theme === 'dark';
  if (isDark) {
    if (NO_STYLE_LAYERS.has(layerId)) return;
    if (layerId === 'night') {
      layer.brightness = 0.7;
      return;
    }
    layer.brightness = 0.6;
    layer.saturation = 0.4;
    if (OVERLAY_LAYERS.has(layerId)) layer.alpha = 0.8;
  } else {
    if (!CONFIG.muteMapColors) return;
    if (NO_STYLE_LAYERS.has(layerId)) return;
    layer.brightness = 1.5;
    layer.saturation = 0.3;
  }
}

async function makeMapTiles(layerId) {
  switch (layerId) {
    case 'noLabels':   return CONFIG.theme === 'dark' ? makeDarkNoLabelsTiles() : makeLightNoLabelsTiles();
    case 'esriGray':   return makeEsriGrayTiles();
    case 'satellite':  return makeSatelliteTiles();
    case 'osm':        return makeOsmTiles();
    case 'topo':       return makeTopoTiles();
    case 'night':      return makeNightTiles();
    case 'vfrHybrid':  return makeVfrMapTiles('vfrc', 12);
    case 'vfrIfrLow':  return makeVfrMapTiles('ifrlc', 11);
    case 'vfrIfrHigh': return makeVfrMapTiles('ehc', 10);
    default:           return CONFIG.theme === 'dark' ? makeDarkTiles() : makeLightTiles();
  }
}

function makeBaseTiles() {
  return CONFIG.theme === 'dark' ? makeDarkTiles() : makeLightTiles();
}

// ============================================================
// Theme Application
// ============================================================

async function resolveTheme() {
  if (CONFIG.themePref !== 'system') return CONFIG.themePref;
  if (window.flightAPI && window.flightAPI.getSystemTheme) {
    try { return await window.flightAPI.getSystemTheme(); } catch (_) {}
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

async function applyTheme() {
  CONFIG.theme = await resolveTheme();
  const isDark = CONFIG.theme === 'dark';

  // Update color config
  if (isDark) {
    setDarkColors(CONFIG.darkColor);
    CONFIG.labelOutlineColor = Cesium.Color.BLACK;
  } else {
    setLightColors(CONFIG.lightColor);
  }

  // Swap tile layer
  const layers = viewer.imageryLayers;
  layers.removeAll();
  radarLayer = null; // cleared by removeAll
  turbLayer = null;  // cleared by removeAll
  satelliteIRLayer = null; // cleared by removeAll
  makeMapTiles(CONFIG.mapLayer).then(async (provider) => {
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
    if (CONFIG.turbulenceLevel !== 'none') {
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
  });

  // Globe & scene background
  const bgColor = isDark ? '#121212' : '#f7f7f7';
  viewer.scene.backgroundColor = Cesium.Color.fromCssColorString(bgColor);
  viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString(bgColor);

  // CSS body class for HUD/controls styling
  document.body.classList.toggle('theme-light', !isDark);

  // Update CSS custom properties (M3 color roles)
  const root = document.documentElement;
  if (isDark) {
    const [r, g, b] = hexToRgb(CONFIG.darkColor);
    // M3-compliant surface containers: neutral base tone + subtle primary tint
    const tint = 0.07;
    const scR = Math.round(20 + r * tint);
    const scG = Math.round(20 + g * tint);
    const scB = Math.round(20 + b * tint);
    const shR = Math.round(36 + r * tint);
    const shG = Math.round(36 + g * tint);
    const shB = Math.round(36 + b * tint);
    root.style.setProperty('--md-primary', CONFIG.phosphor);
    root.style.setProperty('--md-on-primary', '#ffffff');
    root.style.setProperty('--md-primary-container', withAlpha(CONFIG.darkColor, 0.15));
    root.style.setProperty('--md-on-primary-container', CONFIG.phosphor);
    root.style.setProperty('--md-surface', '#121212');
    root.style.setProperty('--md-surface-container', `rgba(${scR}, ${scG}, ${scB}, 0.78)`);
    root.style.setProperty('--md-surface-container-solid', `rgb(${scR}, ${scG}, ${scB})`);
    root.style.setProperty('--md-surface-container-highest', `rgba(${shR}, ${shG}, ${shB}, 0.28)`);
    root.style.setProperty('--md-on-surface', CONFIG.phosphorBright);
    root.style.setProperty('--md-on-surface-variant', CONFIG.phosphorDim);
    root.style.setProperty('--md-on-surface-disabled', withAlpha(CONFIG.darkColor, 0.2));
    root.style.setProperty('--md-outline', withAlpha(CONFIG.darkColor, 0.3));
    root.style.setProperty('--md-outline-variant', withAlpha(CONFIG.darkColor, 0.12));
  } else {
    // Compute on-primary based on luminance: black text on light primary, white on dark
    const [lr, lg, lb] = hexToRgb(CONFIG.lightColor);
    const lum = (0.299 * lr + 0.587 * lg + 0.114 * lb) / 255;
    root.style.setProperty('--md-primary', CONFIG.phosphor);
    root.style.setProperty('--md-on-primary', lum > 0.5 ? '#000000' : '#ffffff');
    root.style.setProperty('--md-primary-container', withAlpha(CONFIG.lightColor, 0.18));
    root.style.setProperty('--md-on-primary-container', CONFIG.phosphor);
    root.style.setProperty('--md-surface', '#f7f7f7');
    root.style.setProperty('--md-surface-container', 'rgba(240, 240, 240, 0.78)');
    root.style.setProperty('--md-surface-container-solid', 'rgb(240, 240, 240)');
    root.style.setProperty('--md-surface-container-highest', withAlpha(CONFIG.lightColor, 0.08));
    root.style.setProperty('--md-on-surface', CONFIG.phosphorBright);
    root.style.setProperty('--md-on-surface-variant', CONFIG.phosphorDim);
    root.style.setProperty('--md-on-surface-disabled', withAlpha(CONFIG.lightColor, 0.15));
    root.style.setProperty('--md-outline', withAlpha(CONFIG.lightColor, 0.2));
    root.style.setProperty('--md-outline-variant', withAlpha(CONFIG.lightColor, 0.1));
  }

  // Force re-render all aircraft entities with new colors/sizes
  clearIconCaches();
  refreshAllEntities();

  // Update airport marker colors to match theme
  updateAirportColors();

  // Update waypoint colors to match theme
  updateWaypointColors();
}
