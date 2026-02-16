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
const smallAirportEntities = [];  // Cesium entities for small airport markers
const airspaceEntities = [];     // Cesium entities for airspace polygons
const waypointEntities = [];     // Cesium entities for fix markers
const navaidEntities = [];       // Cesium entities for navaid markers
let cachedAirportData = null;     // Cached airport JSON for rebuilds
let cachedWaypointData = null;    // Cached waypoint JSON for rebuilds
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
let radarLayer = null;
let radarRefreshTimer = null;
let turbLayer = null;
let turbRefreshTimer = null;
let turbDataRefreshTimer = null;
const turbEntities = [];

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

function makeSectionalTiles() {
  return Cesium.ArcGisMapServerImageryProvider.fromUrl(
    'https://tiles.arcgis.com/tiles/ssFJjBXIUyZDrSYZ/arcgis/rest/services/VFR_Sectional/MapServer',
    { credit: new Cesium.Credit('FAA') }
  );
}

function makeTerminalTiles() {
  return Cesium.ArcGisMapServerImageryProvider.fromUrl(
    'https://tiles.arcgis.com/tiles/ssFJjBXIUyZDrSYZ/arcgis/rest/services/VFR_Terminal/MapServer',
    { credit: new Cesium.Credit('FAA') }
  );
}

function makeIfrLowTiles() {
  return Cesium.ArcGisMapServerImageryProvider.fromUrl(
    'https://tiles.arcgis.com/tiles/ssFJjBXIUyZDrSYZ/arcgis/rest/services/IFR_AreaLow/MapServer',
    { credit: new Cesium.Credit('FAA') }
  );
}

function makeIfrHighTiles() {
  return Cesium.ArcGisMapServerImageryProvider.fromUrl(
    'https://tiles.arcgis.com/tiles/ssFJjBXIUyZDrSYZ/arcgis/rest/services/IFR_High/MapServer',
    { credit: new Cesium.Credit('FAA') }
  );
}

async function makeMapTiles(layerId) {
  switch (layerId) {
    case 'sectional': return await makeSectionalTiles();
    case 'terminal':  return await makeTerminalTiles();
    case 'ifrLow':    return await makeIfrLowTiles();
    case 'ifrHigh':   return await makeIfrHighTiles();
    default:          return CONFIG.theme === 'dark' ? makeDarkTiles() : makeLightTiles();
  }
}

// ============================================================
// NEXRAD Weather Radar Overlay
// ============================================================

function makeRadarProvider() {
  console.log('[Radar] Loading NEXRAD WMS tiles from Iowa State Mesonet');
  return new Cesium.WebMapServiceImageryProvider({
    url: 'https://mesonet.agron.iastate.edu/cgi-bin/wms/nexrad/n0q.cgi?',
    layers: 'nexrad-n0q-900913',
    parameters: {
      transparent: true,
      format: 'image/png',
    },
    credit: new Cesium.Credit('Iowa State Mesonet'),
  });
}

function enableRadar() {
  if (radarLayer) return;
  const provider = makeRadarProvider();
  radarLayer = viewer.imageryLayers.addImageryProvider(provider);
  radarLayer.alpha = 0.6;
  CONFIG.radarEnabled = true;
  console.log('[Radar] NEXRAD overlay enabled');
  // Auto-refresh every 5 minutes
  if (radarRefreshTimer) clearInterval(radarRefreshTimer);
  radarRefreshTimer = setInterval(refreshRadar, 5 * 60 * 1000);
}

function disableRadar() {
  if (radarLayer) {
    viewer.imageryLayers.remove(radarLayer);
    radarLayer = null;
  }
  CONFIG.radarEnabled = false;
  if (radarRefreshTimer) {
    clearInterval(radarRefreshTimer);
    radarRefreshTimer = null;
  }
  console.log('[Radar] NEXRAD overlay disabled');
}

function refreshRadar() {
  if (!CONFIG.radarEnabled) return;
  if (radarLayer) {
    viewer.imageryLayers.remove(radarLayer);
    radarLayer = null;
  }
  const provider = makeRadarProvider();
  radarLayer = viewer.imageryLayers.addImageryProvider(provider);
  radarLayer.alpha = 0.6;
  console.log('[Radar] NEXRAD overlay refreshed');
}

// ============================================================
// AWC Turbulence Overlays
// ============================================================

// gfaak model: Mercator-projected image covering Alaska + CONUS.
// The image crosses the antimeridian (144.3°E → 39.5°W) which CesiumJS can't handle,
// and the pixels are in Mercator Y (not geographic latitude).
// Solution: fetch image → crop to Western hemisphere → reproject lat from Mercator to geographic.
const TURB_LON_WEST = -215.69104;
const TURB_LON_EAST = -39.508957;
const TURB_LAT_SOUTH = -0.196746;
const TURB_LAT_NORTH = 76.97271;
const TURB_CROP_LON = -180; // crop everything west of antimeridian

// Mercator Y helper
function geoLatToMercY(latDeg) {
  const latRad = latDeg * Math.PI / 180;
  return Math.log(Math.tan(Math.PI / 4 + latRad / 2));
}

async function makeTurbProvider(level) {
  const url = `https://aviationweather.gov/api/data/model?model=gfaak&level=${level}&type=gtg&_t=${Date.now()}`;
  console.log(`[Weather] Loading GTG image: level=${level}`);
  try {
    // Fetch as blob so canvas won't be tainted by cross-origin
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const blob = await resp.blob();
    const blobUrl = URL.createObjectURL(blob);

    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('Image load failed'));
      i.src = blobUrl;
    });

    // 1) Crop to Western hemisphere (-180° to east edge)
    const lonSpan = TURB_LON_EAST - TURB_LON_WEST;
    const cropX = Math.round((TURB_CROP_LON - TURB_LON_WEST) / lonSpan * img.width);
    const cropW = img.width - cropX;

    const srcCanvas = document.createElement('canvas');
    srcCanvas.width = cropW;
    srcCanvas.height = img.height;
    srcCanvas.getContext('2d').drawImage(img, cropX, 0, cropW, img.height, 0, 0, cropW, img.height);
    URL.revokeObjectURL(blobUrl);

    // 2) Reproject rows from Mercator Y to geographic latitude
    const srcCtx = srcCanvas.getContext('2d');
    const srcData = srcCtx.getImageData(0, 0, cropW, img.height);
    const outCanvas = document.createElement('canvas');
    outCanvas.width = cropW;
    outCanvas.height = img.height;
    const outData = outCanvas.getContext('2d').createImageData(cropW, img.height);

    const yMercSouth = geoLatToMercY(TURB_LAT_SOUTH);
    const yMercNorth = geoLatToMercY(TURB_LAT_NORTH);
    const rowBytes = cropW * 4;

    for (let row = 0; row < img.height; row++) {
      // Output row → geographic latitude (top row = north)
      const geoFrac = 1 - row / (img.height - 1); // 1 at top, 0 at bottom
      const lat = TURB_LAT_SOUTH + geoFrac * (TURB_LAT_NORTH - TURB_LAT_SOUTH);
      // Geographic lat → Mercator fraction → source row
      const mercY = geoLatToMercY(lat);
      const mercFrac = (mercY - yMercSouth) / (yMercNorth - yMercSouth);
      const srcRow = Math.min(img.height - 1, Math.max(0, Math.round((1 - mercFrac) * (img.height - 1))));
      outData.data.set(
        srcData.data.subarray(srcRow * rowBytes, srcRow * rowBytes + rowBytes),
        row * rowBytes
      );
    }
    outCanvas.getContext('2d').putImageData(outData, 0, 0);

    console.log(`[Weather] GTG image reprojected: ${cropW}x${img.height}`);
    return new Cesium.SingleTileImageryProvider({
      url: outCanvas.toDataURL('image/png'),
      rectangle: Cesium.Rectangle.fromDegrees(TURB_CROP_LON, TURB_LAT_SOUTH, TURB_LON_EAST, TURB_LAT_NORTH),
      credit: new Cesium.Credit('AWC'),
    });
  } catch (err) {
    console.warn('[Weather] Failed to load GTG image:', err.message);
    return null;
  }
}

async function addTurbLayer() {
  const provider = await makeTurbProvider(CONFIG.turbulenceLevel);
  if (!provider || CONFIG.turbulenceLevel === 'none') return;
  // Insert turbulence layer after base map but before radar
  if (radarLayer) {
    const radarIdx = viewer.imageryLayers.indexOf(radarLayer);
    turbLayer = viewer.imageryLayers.addImageryProvider(provider, radarIdx);
  } else {
    turbLayer = viewer.imageryLayers.addImageryProvider(provider);
  }
  turbLayer.alpha = 0.65;
}

function removeTurbLayer() {
  if (turbLayer) {
    viewer.imageryLayers.remove(turbLayer);
    turbLayer = null;
  }
}

function removeTurbEntities() {
  for (const entity of turbEntities) {
    viewer.entities.remove(entity);
  }
  turbEntities.length = 0;
}

const PIREP_COLORS = {
  NEG:   new Cesium.Color(0.2, 0.5, 1.0, 0.7),
  'SMT': new Cesium.Color(0.2, 0.5, 1.0, 0.7),
  LGT:   new Cesium.Color(0.0, 0.8, 0.0, 0.8),
  MOD:   new Cesium.Color(1.0, 0.6, 0.0, 0.9),
  SEV:   new Cesium.Color(1.0, 0.0, 0.0, 1.0),
  EXTRM: new Cesium.Color(1.0, 0.0, 1.0, 1.0),
};

function pirepColor(intensity) {
  if (!intensity) return PIREP_COLORS.LGT;
  const upper = intensity.toUpperCase().replace(/-/g, '');
  // Handle combined intensities like "MOD-SEV" → take the higher
  for (const key of ['EXTRM', 'SEV', 'MOD', 'LGT', 'NEG', 'SMT']) {
    if (upper.includes(key)) return PIREP_COLORS[key] || PIREP_COLORS.LGT;
  }
  return PIREP_COLORS.LGT;
}

function pirepSize(intensity) {
  if (!intensity) return 12;
  const upper = intensity.toUpperCase();
  if (upper.includes('SEV') || upper.includes('EXTRM')) return 20;
  if (upper.includes('MOD')) return 16;
  return 12;
}

async function fetchTurbulenceData() {
  const AWC_BASE = 'https://aviationweather.gov/api/data';
  console.log('[Weather] Fetching PIREPs, SIGMETs, G-AIRMETs...');
  try {
    const [pirepResp, sigmetResp, airmetResp] = await Promise.all([
      fetch(`${AWC_BASE}/pirep?format=geojson&type=turb&age=12&bbox=-180,-90,180,90`).catch((err) => { console.warn('[Weather] PIREP fetch failed:', err.message); return null; }),
      fetch(`${AWC_BASE}/sigmet?format=geojson`).catch((err) => { console.warn('[Weather] SIGMET fetch failed:', err.message); return null; }),
      fetch(`${AWC_BASE}/gairmet?format=geojson`).catch((err) => { console.warn('[Weather] G-AIRMET fetch failed:', err.message); return null; }),
    ]);

    // PIREPs — turbulence-related only
    if (pirepResp && pirepResp.ok) {
      const data = await pirepResp.json();
      console.log(`[Weather] PIREPs response: ${(data.features || []).length} total reports`);
      let pirepCount = 0;
      if (data.features) {
        for (const f of data.features) {
          const props = f.properties || {};
          const coords = f.geometry && f.geometry.coordinates;
          if (!coords || coords.length < 2) continue;
          const lon = coords[0], lat = coords[1];
          const alt = (props.fltlvl || 0) * 100 * 0.3048; // FL to meters
          const intensity = props.tbInt1 || 'LGT';
          const color = pirepColor(intensity);
          const size = pirepSize(intensity);

          const obsTime = props.obsTime ? new Date(props.obsTime).toUTCString().slice(17, 25) + 'Z' : '?';
          const entity = viewer.entities.add({
            id: `turb-pirep-${pirepCount}`,
            position: Cesium.Cartesian3.fromDegrees(lon, lat, alt),
            point: {
              pixelSize: size,
              color: color,
              outlineColor: Cesium.Color.BLACK,
              outlineWidth: 1,
              scaleByDistance: new Cesium.NearFarScalar(1e5, 1.0, 6e6, 0.3),
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
            properties: {
              turbType: 'PIREP',
              intensity: intensity,
              fltlvl: props.fltlvl || '?',
              acType: props.acType || '?',
              obsTime: obsTime,
              rawOb: props.rawOb || '',
            },
          });
          turbEntities.push(entity);
          pirepCount++;
        }
        console.log(`[Weather] Added ${pirepCount} turbulence PIREP entities`);
      }
    } else {
      console.warn(`[Weather] PIREPs response not ok: ${pirepResp ? pirepResp.status : 'null'}`);
    }

    // SIGMETs — turbulence, convective, and thunderstorm
    if (sigmetResp && sigmetResp.ok) {
      const data = await sigmetResp.json();
      const validHazards = ['TURB', 'CONVECTIVE', 'TS'];
      const sigmetFeatures = (data.features || []).filter(f => {
        const hazard = (f.properties || {}).hazard || '';
        return validHazards.includes(hazard);
      });
      console.log(`[Weather] SIGMETs response: ${(data.features || []).length} total, ${sigmetFeatures.length} turb/convective/TS`);
      if (sigmetFeatures.length > 0) {
        let count = 0;
        for (const f of sigmetFeatures) {
          const geom = f.geometry;
          if (!geom) continue;
          const sp = f.properties || {};
          const hazard = sp.hazard || 'TURB';
          // Color by hazard type: TURB=red, CONVECTIVE/TS=yellow
          const isConvective = hazard === 'CONVECTIVE' || hazard === 'TS';
          const fillColor = isConvective
            ? new Cesium.Color(1.0, 0.85, 0.0, 0.2)
            : new Cesium.Color(1.0, 0.0, 0.0, 0.2);
          const edgeColor = isConvective
            ? new Cesium.Color(1.0, 0.85, 0.0, 0.8)
            : new Cesium.Color(1.0, 0.0, 0.0, 0.8);
          const polygons = geom.type === 'Polygon' ? [geom.coordinates]
            : geom.type === 'MultiPolygon' ? geom.coordinates : [];
          for (const rings of polygons) {
            if (!rings || !rings[0] || rings[0].length < 3) continue;
            const positions = rings[0].map(c => Cesium.Cartesian3.fromDegrees(c[0], c[1]));
            const entity = viewer.entities.add({
              id: `turb-sigmet-${count}`,
              polygon: {
                hierarchy: new Cesium.PolygonHierarchy(positions),
                material: fillColor,
                outline: true,
                outlineColor: edgeColor,
                outlineWidth: 1,
                height: 0,
                classificationType: Cesium.ClassificationType.BOTH,
              },
              properties: {
                turbType: isConvective ? 'CONVECTIVE SIGMET' : 'SIGMET',
                hazard: hazard,
                severity: sp.severity || '?',
                base: sp.altitudeLow1 || sp.altLow || '?',
                top: sp.altitudeHi1 || sp.altHi || '?',
                validFrom: sp.validTimeFrom || '?',
                validTo: sp.validTimeTo || '?',
                rawText: sp.rawAirSigmet || sp.rawSigmet || '',
              },
            });
            turbEntities.push(entity);
            count++;
          }
        }
        console.log(`[Weather] Added ${count} SIGMET polygons`);
      }
    }

    // G-AIRMETs (fetch all, filter client-side for TURB-HI and TURB-LO)
    if (airmetResp && airmetResp.ok) {
      const data = await airmetResp.json();
      const turbFeatures = (data.features || []).filter(f => {
        const hazard = (f.properties || {}).hazard || '';
        return hazard === 'TURB-HI' || hazard === 'TURB-LO';
      });
      console.log(`[Weather] G-AIRMETs response: ${(data.features || []).length} total, ${turbFeatures.length} turbulence`);
      if (turbFeatures.length > 0) {
        let count = 0;
        for (const f of turbFeatures) {
          const geom = f.geometry;
          if (!geom) continue;
          const ap = f.properties || {};
          const polygons = geom.type === 'Polygon' ? [geom.coordinates]
            : geom.type === 'MultiPolygon' ? geom.coordinates : [];
          for (const rings of polygons) {
            if (!rings || !rings[0] || rings[0].length < 3) continue;
            const positions = rings[0].map(c => Cesium.Cartesian3.fromDegrees(c[0], c[1]));
            const entity = viewer.entities.add({
              id: `turb-airmet-${count}`,
              polygon: {
                hierarchy: new Cesium.PolygonHierarchy(positions),
                material: new Cesium.Color(1.0, 0.5, 0.0, 0.15),
                outline: true,
                outlineColor: new Cesium.Color(1.0, 0.5, 0.0, 0.7),
                outlineWidth: 1,
                height: 0,
                classificationType: Cesium.ClassificationType.BOTH,
              },
              properties: {
                turbType: 'G-AIRMET',
                hazard: ap.hazard || '?',
                severity: ap.severity || '?',
                base: ap.base || '?',
                top: ap.top || '?',
                validFrom: ap.validTime || '?',
                validTo: ap.validTimeTo || '?',
              },
            });
            turbEntities.push(entity);
            count++;
          }
        }
        console.log(`[Weather] Added ${count} G-AIRMET polygons`);
      }
    }
  } catch (err) {
    console.warn('[Weather] Error fetching data:', err);
  }
}

// TURB toggle: PIREPs, SIGMETs, G-AIRMETs (entities only)
function enableTurbulence() {
  CONFIG.turbulenceEnabled = true;
  console.log('[Weather] PIREPs/SIGMETs/G-AIRMETs enabled');
  fetchTurbulenceData();
  if (turbDataRefreshTimer) clearInterval(turbDataRefreshTimer);
  turbDataRefreshTimer = setInterval(() => {
    removeTurbEntities();
    fetchTurbulenceData();
  }, 5 * 60 * 1000);
}

function disableTurbulence() {
  removeTurbEntities();
  CONFIG.turbulenceEnabled = false;
  if (turbDataRefreshTimer) {
    clearInterval(turbDataRefreshTimer);
    turbDataRefreshTimer = null;
  }
  console.log('[Weather] PIREPs/SIGMETs/G-AIRMETs disabled');
}

// GTG forecast dropdown: heatmap imagery layer (independent of TURB toggle)
function enableTurbForecast() {
  if (turbLayer) return;
  addTurbLayer();
  console.log(`[Weather] GTG forecast enabled: ${CONFIG.turbulenceLevel}`);
  if (turbRefreshTimer) clearInterval(turbRefreshTimer);
  turbRefreshTimer = setInterval(refreshTurbForecast, 15 * 60 * 1000);
}

function disableTurbForecast() {
  removeTurbLayer();
  if (turbRefreshTimer) {
    clearInterval(turbRefreshTimer);
    turbRefreshTimer = null;
  }
  console.log('[Weather] GTG forecast disabled');
}

function refreshTurbForecast() {
  if (CONFIG.turbulenceLevel === 'none') return;
  removeTurbLayer();
  addTurbLayer();
  console.log('[Weather] GTG forecast refreshed');
}

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
  makeMapTiles(CONFIG.mapLayer).then(async (provider) => {
    layers.addImageryProvider(provider);
    // Layer order: base → turbulence forecast → radar
    if (CONFIG.turbulenceLevel !== 'none') {
      const turbProvider = await makeTurbProvider(CONFIG.turbulenceLevel);
      if (turbProvider) {
        turbLayer = layers.addImageryProvider(turbProvider);
        turbLayer.alpha = 0.65;
      }
    }
    if (CONFIG.radarEnabled) {
      radarLayer = layers.addImageryProvider(makeRadarProvider());
      radarLayer.alpha = 0.6;
    }
  });

  // Globe & scene background
  const bgColor = isDark ? '#0a0a0a' : '#e8e8e8';
  viewer.scene.backgroundColor = Cesium.Color.fromCssColorString(bgColor);
  viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString(bgColor);

  // CSS body class for HUD/controls styling
  document.body.classList.toggle('theme-light', !isDark);

  // Update CSS custom properties for dynamic dark mode colors
  if (isDark) {
    const root = document.documentElement;
    const [r, g, b] = hexToRgb(CONFIG.darkColor);
    root.style.setProperty('--phosphor', CONFIG.phosphor);
    root.style.setProperty('--phosphor-bright', CONFIG.phosphorBright);
    root.style.setProperty('--phosphor-dim', CONFIG.phosphorDim);
    root.style.setProperty('--phosphor-faint', withAlpha(CONFIG.darkColor, 0.15));
    root.style.setProperty('--border', withAlpha(CONFIG.darkColor, 0.3));
    root.style.setProperty('--panel-bg', `rgba(${Math.round(r * 0.05)}, ${Math.round(g * 0.05)}, ${Math.round(b * 0.05)}, 0.85)`);
  } else {
    // Light mode: set CSS variables from user-selected light color
    const root = document.documentElement;
    root.style.setProperty('--phosphor', CONFIG.phosphor);
    root.style.setProperty('--phosphor-bright', CONFIG.phosphorBright);
    root.style.setProperty('--phosphor-dim', CONFIG.phosphorDim);
    root.style.setProperty('--phosphor-faint', withAlpha(CONFIG.lightColor, 0.1));
    root.style.setProperty('--border', withAlpha(CONFIG.lightColor, 0.2));
    root.style.removeProperty('--panel-bg');
  }

  // Force re-render all aircraft entities with new colors/sizes
  clearIconCaches();
  refreshAllEntities();

  // Update airport marker colors to match theme
  updateAirportColors();

  // Update waypoint colors to match theme
  updateWaypointColors();
}

// Destroy and re-create all aircraft entities to pick up new theme
function removeTrailEntities(ac) {
  for (const e of ac.trailEntities) viewer.entities.remove(e);
  ac.trailEntities = [];
  ac._trailHash = '';
}

function refreshAllEntities() {
  viewer.entities.suspendEvents();
  try {
    for (const [icao, ac] of aircraft) {
      if (ac.entity) { viewer.entities.remove(ac.entity); ac.entity = null; }
      removeTrailEntities(ac);
    }
  } finally {
    viewer.entities.resumeEvents();
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

function initAirports(airports) {
  cachedAirportData = airports;
  const pointColor = getAirportColor();
  const labelColor = getAirportLabelColor();

  for (const ap of airports) {
    if (ap.type === 'S') continue;  // Small airports handled separately
    const isLarge = ap.type === 'L';
    const label = ap.iata || ap.icao;
    const labelRange = isLarge ? 800000 : 300000;
    const dotSize = isLarge ? 10 : 6;

    // Scale dots down with distance: full size at 100km, 3px at CONUS (~6000km)
    const farScale = 3 / dotSize;
    const dotScale = new Cesium.NearFarScalar(1e5, 1.0, 6e6, farScale);

    const entity = viewer.entities.add({
      // Slight altitude keeps dots above the globe surface at oblique angles
      position: Cesium.Cartesian3.fromDegrees(ap.lon, ap.lat, 10),
      point: {
        pixelSize: dotSize,
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

  if (CONFIG.showSmallAirports) {
    initSmallAirports(airports);
  }
}

function initSmallAirports(airports) {
  const pointColor = getAirportColor();
  const labelColor = getAirportLabelColor();
  const smallRange = 200000; // Only visible within 200km

  for (const ap of airports) {
    if (ap.type !== 'S') continue;
    const label = ap.iata || ap.icao;
    const dotSize = 4;
    const farScale = 2 / dotSize;
    const dotScale = new Cesium.NearFarScalar(5e4, 1.0, 2e5, farScale);

    const entity = viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(ap.lon, ap.lat, 10),
      point: {
        pixelSize: dotSize,
        color: pointColor,
        outlineWidth: 0,
        scaleByDistance: dotScale,
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, smallRange),
      },
      label: {
        text: label,
        font: '12px Consolas, monospace',
        fillColor: labelColor,
        outlineColor: CONFIG.theme === 'light' ? Cesium.Color.WHITE : Cesium.Color.BLACK,
        outlineWidth: 2,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, 8),
        horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
        verticalOrigin: Cesium.VerticalOrigin.TOP,
        scale: 0.75,
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, smallRange),
      },
      show: CONFIG.airportsEnabled,
    });
    smallAirportEntities.push(entity);
  }

  console.log(`[Airports] Created ${smallAirportEntities.length} small airport markers`);
}

function removeSmallAirports() {
  for (const entity of smallAirportEntities) {
    viewer.entities.remove(entity);
  }
  smallAirportEntities.length = 0;
}

function toggleAirports(show) {
  CONFIG.airportsEnabled = show;
  for (const entity of airportEntities) {
    entity.show = show;
  }
  for (const entity of smallAirportEntities) {
    entity.show = show;
  }
}

function updateAirportColors() {
  const pointColor = getAirportColor();
  const labelColor = getAirportLabelColor();
  const outlineColor = CONFIG.theme === 'light' ? Cesium.Color.WHITE : Cesium.Color.BLACK;
  for (const entity of [...airportEntities, ...smallAirportEntities]) {
    entity.point.color = pointColor;
    entity.label.fillColor = labelColor;
    entity.label.outlineColor = outlineColor;
  }
}

// ============================================================
// Airspace Boundaries (Class B / C / D)
// ============================================================

const FT_TO_M = 0.3048;

const AIRSPACE_COLORS = {
  B: { fill: new Cesium.Color(0.27, 0.51, 0.97, 0.15),  outline: new Cesium.Color(0.27, 0.51, 0.97, 1.0) },  // blue
  C: { fill: new Cesium.Color(1.0, 0.0, 1.0, 0.15),    outline: new Cesium.Color(1.0, 0.0, 1.0, 1.0) },     // magenta
  D: { fill: new Cesium.Color(0.53, 0.81, 0.98, 0.15), outline: new Cesium.Color(0.53, 0.81, 0.98, 1.0) },  // light blue
};

let airspaceData = null; // cached for rebuild on 3D toggle

function initAirspace(airspace) {
  if (airspace) airspaceData = airspace;
  if (!airspaceData) return;

  const use3D = CONFIG.airspace3D;

  for (const entry of airspaceData) {
    const colors = AIRSPACE_COLORS[entry.cls];
    if (!colors || !entry.coords || entry.coords.length < 3) continue;

    const positions = entry.coords.map(([lon, lat]) => Cesium.Cartesian3.fromDegrees(lon, lat));

    // Compute floor/ceiling in meters for 3D extrusion
    const hasAltData = entry.ceil != null && entry.floor != null;
    const floorM = hasAltData ? entry.floor * FT_TO_M : 0;
    const ceilM = hasAltData ? entry.ceil * FT_TO_M : 0;

    const edgesOn = CONFIG.airspaceEdges;
    const polygonOpts = use3D && hasAltData
      ? {
          hierarchy: new Cesium.PolygonHierarchy(positions),
          material: colors.fill,
          outline: edgesOn,
          outlineColor: edgesOn ? colors.outline : undefined,
          outlineWidth: edgesOn ? 1 : undefined,
          height: floorM,
          extrudedHeight: ceilM,
        }
      : {
          hierarchy: new Cesium.PolygonHierarchy(positions),
          material: colors.fill,
          outline: edgesOn,
          outlineColor: edgesOn ? colors.outline : undefined,
          outlineWidth: edgesOn ? 1 : undefined,
          height: 0,
          classificationType: Cesium.ClassificationType.BOTH,
        };

    const entity = viewer.entities.add({
      polygon: polygonOpts,
      distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 800000),
      show: CONFIG.airspaceEnabled,
    });
    airspaceEntities.push(entity);
  }

  console.log(`[Airspace] Created ${airspaceEntities.length} ${use3D ? '3D volume' : 'flat boundary'} polygons`);
}

function rebuildAirspace() {
  for (const entity of airspaceEntities) {
    viewer.entities.remove(entity);
  }
  airspaceEntities.length = 0;
  initAirspace();
}

function toggleAirspace(show) {
  CONFIG.airspaceEnabled = show;
  for (const entity of airspaceEntities) {
    entity.show = show;
  }
}

function toggleAirspace3D(use3D) {
  CONFIG.airspace3D = use3D;
  rebuildAirspace();
}

function toggleAirspaceEdges(show) {
  CONFIG.airspaceEdges = show;
  rebuildAirspace();
}

// ============================================================
// Waypoints & Navaids
// ============================================================

function getWaypointColor() {
  if (CONFIG.theme === 'light') {
    return Cesium.Color.fromCssColorString('rgba(120, 120, 120, 0.6)');
  }
  const rgb = CONFIG.trailColor;
  return Cesium.Color.fromBytes(rgb[0], rgb[1], rgb[2], 100);
}

function getWaypointLabelColor() {
  if (CONFIG.theme === 'light') {
    return Cesium.Color.fromCssColorString('rgba(100, 100, 100, 0.75)');
  }
  const rgb = CONFIG.trailColor;
  return Cesium.Color.fromBytes(rgb[0], rgb[1], rgb[2], 150);
}

function getNavaidColor(type) {
  if (CONFIG.theme === 'light') {
    switch (type) {
      case 'VOR': case 'VORTAC': case 'VOR/DME':
        return Cesium.Color.fromCssColorString('rgba(50, 80, 180, 0.8)');
      case 'NDB': case 'NDB/DME':
        return Cesium.Color.fromCssColorString('rgba(160, 50, 50, 0.8)');
      case 'DME': case 'TACAN':
        return Cesium.Color.fromCssColorString('rgba(50, 130, 50, 0.8)');
      default:
        return Cesium.Color.fromCssColorString('rgba(100, 100, 100, 0.8)');
    }
  }
  switch (type) {
    case 'VOR': case 'VORTAC': case 'VOR/DME':
      return new Cesium.Color(0.4, 0.6, 1.0, 0.9);
    case 'NDB': case 'NDB/DME':
      return new Cesium.Color(1.0, 0.4, 0.4, 0.9);
    case 'DME': case 'TACAN':
      return new Cesium.Color(0.4, 1.0, 0.5, 0.9);
    default:
      return new Cesium.Color(0.7, 0.7, 0.7, 0.9);
  }
}

function initNavaids(data) {
  if (data) cachedWaypointData = data;
  if (!cachedWaypointData) return;

  const navaids = cachedWaypointData.navaids || [];
  const outlineColor = CONFIG.theme === 'light' ? Cesium.Color.WHITE : Cesium.Color.BLACK;
  const navLabelRange = 150000; // labels within 150km

  for (const nav of navaids) {
    const color = getNavaidColor(nav.type);
    const cssColor = color.toCssColorString();
    const labelText = nav.id + ' ' + nav.type;

    const entity = viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(nav.lon, nav.lat, 10),
      billboard: {
        image: createNavaidIcon(12, cssColor),
        width: 12,
        height: 12,
        scaleByDistance: new Cesium.NearFarScalar(5e4, 1.0, 5e6, 0.4),
      },
      label: {
        text: labelText,
        font: '11px Consolas, monospace',
        fillColor: color,
        outlineColor: outlineColor,
        outlineWidth: 2,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, 8),
        horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
        verticalOrigin: Cesium.VerticalOrigin.TOP,
        scale: 0.8,
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, navLabelRange),
      },
      show: CONFIG.navaidsEnabled,
    });
    navaidEntities.push(entity);
  }

  console.log(`[Navaids] Created ${navaidEntities.length} navaid markers`);

  if (CONFIG.showFixes) {
    initFixes();
  }
}

function initFixes() {
  if (!cachedWaypointData) return;
  const fixes = cachedWaypointData.fixes || [];

  const fixColor = getWaypointColor();
  const fixLabelColor = getWaypointLabelColor();
  const outlineColor = CONFIG.theme === 'light' ? Cesium.Color.WHITE : Cesium.Color.BLACK;
  const fixRange = 100000;     // visible within 100km
  const fixLabelRange = 50000; // labels within 50km

  for (const fix of fixes) {
    const entity = viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(fix.lon, fix.lat, 10),
      point: {
        pixelSize: 3,
        color: fixColor,
        outlineWidth: 0,
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, fixRange),
        scaleByDistance: new Cesium.NearFarScalar(2e4, 1.0, 1e5, 0.5),
      },
      label: {
        text: fix.id,
        font: '10px Consolas, monospace',
        fillColor: fixLabelColor,
        outlineColor: outlineColor,
        outlineWidth: 1,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, 6),
        horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
        verticalOrigin: Cesium.VerticalOrigin.TOP,
        scale: 0.7,
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, fixLabelRange),
      },
      show: CONFIG.navaidsEnabled,
    });
    waypointEntities.push(entity);
  }

  console.log(`[Navaids] Created ${waypointEntities.length} fix markers`);
}

function removeFixes() {
  for (const entity of waypointEntities) viewer.entities.remove(entity);
  waypointEntities.length = 0;
}

function removeNavaids() {
  removeFixes();
  for (const entity of navaidEntities) viewer.entities.remove(entity);
  navaidEntities.length = 0;
}

function toggleNavaids(show) {
  CONFIG.navaidsEnabled = show;
  for (const entity of navaidEntities) entity.show = show;
  for (const entity of waypointEntities) entity.show = show;
}

function updateWaypointColors() {
  const fixColor = getWaypointColor();
  const fixLabelColor = getWaypointLabelColor();
  const outlineColor = CONFIG.theme === 'light' ? Cesium.Color.WHITE : Cesium.Color.BLACK;
  for (const entity of waypointEntities) {
    entity.point.color = fixColor;
    entity.label.fillColor = fixLabelColor;
    entity.label.outlineColor = outlineColor;
  }
  // Rebuild navaids to update colors per type
  if (navaidEntities.length > 0 && cachedWaypointData) {
    const navaids = cachedWaypointData.navaids || [];
    for (let i = 0; i < navaidEntities.length && i < navaids.length; i++) {
      const color = getNavaidColor(navaids[i].type);
      const cssColor = color.toCssColorString();
      navaidEntities[i].billboard.image = createNavaidIcon(12, cssColor);
      navaidEntities[i].label.fillColor = color;
      navaidEntities[i].label.outlineColor = outlineColor;
    }
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
        _trailHash: '',      // trail content fingerprint for dirty tracking
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

  // Remove stale aircraft (batched to avoid per-entity scene recalc)
  viewer.entities.suspendEvents();
  try {
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
  } finally {
    viewer.entities.resumeEvents();
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

// Trail content fingerprint to avoid unnecessary entity rebuilds
function _computeTrailHash(ac, s) {
  if (!CONFIG.trailEnabled) return '';
  if (CONFIG.showVelocityVector) {
    return `V:${(s.heading||0).toFixed(1)}:${(s.velocity||0).toFixed(0)}:${s.lon.toFixed(4)}:${s.lat.toFixed(4)}`;
  }
  const histLen = ac.history.length;
  const last = histLen > 0 ? ac.history[histLen - 1] : null;
  const granLen = ac.granularTrack && ac.granularTrack.path ? ac.granularTrack.path.length : 0;
  return last
    ? `T:${histLen}:${granLen}:${last.time.toFixed(0)}`
    : `T:0:${granLen}`;
}

function renderAircraft(filterIcaos) {
  // LOD based on camera height
  const camHeight = viewer.camera.positionCartographic
    ? viewer.camera.positionCartographic.height
    : 0;
  const useDot = camHeight > 2000000;
  const showLabels = CONFIG.labelsEnabled && camHeight < 800000;

  viewer.entities.suspendEvents();
  try {
  for (const [icao, ac] of aircraft) {
    if (filterIcaos && !filterIcaos.has(icao)) continue;
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
    // Skip trail rebuild when data hasn't changed (e.g., during camera pan/zoom)
    const _th = _computeTrailHash(ac, s);
    if (ac._trailHash === _th) continue;
    if (CONFIG.trailEnabled) {
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

      if (CONFIG.showVelocityVector && s.heading != null && s.velocity != null) {
        // Velocity vector mode: single line behind aircraft proportional to speed
        removeTrailEntities(ac);

        const speed = s.velocity || 0; // m/s
        const lineLength = speed * 60; // scale factor: ~15km line at cruise speed
        if (lineLength > 100) {
          // Compute endpoint behind the aircraft (heading + 180°)
          const behindDeg = (s.heading + 180) % 360;
          const behindRad = Cesium.Math.toRadians(behindDeg);
          const acLonRad = Cesium.Math.toRadians(s.lon);
          const acLatRad = Cesium.Math.toRadians(s.lat);
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

          const alt = s.altitude || 0;
          const positions = [
            Cesium.Cartesian3.fromDegrees(s.lon, s.lat, alt),
            Cesium.Cartesian3.fromDegrees(Cesium.Math.toDegrees(endLon), Cesium.Math.toDegrees(endLat), alt),
          ];

          // Color logic matching existing trail colors
          let rgb;
          if (CONFIG.colorByAltitude) {
            rgb = isSelected ? altitudeToSelectedRgb(alt) : altitudeToRgb(alt);
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
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
          }));
        }
      } else {
        // Normal history trail mode
        const trailPoints = buildTrailPositions(ac, isSelected);

        if (trailPoints.length >= 2) {
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
                  // Mute trail colors in dark mode to avoid overly bright opaque trails
                  const mute = (!isSelected && CONFIG.theme === 'dark') ? 0.6 : 1;
                  const material = Cesium.Color.fromBytes(
                    Math.round(rgb[0] * mute), Math.round(rgb[1] * mute), Math.round(rgb[2] * mute), 255);
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
            const trailRgb = isSelected ? hexToRgb(CONFIG.phosphorBright) : CONFIG.trailColor;
            // Mute trail colors in dark mode to avoid overly bright opaque trails
            const mute = (!isSelected && CONFIG.theme === 'dark') ? 0.6 : 1;
            const trailMaterial = Cesium.Color.fromBytes(
              Math.round(trailRgb[0] * mute), Math.round(trailRgb[1] * mute), Math.round(trailRgb[2] * mute), 255);
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
      }
    } else {
      removeTrailEntities(ac);
    }
    ac._trailHash = _th;
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
  const viewBounds = frozenBounds || getViewBounds();
  // Fetch aircraft from a 50% larger region so small pans don't re-poll
  const bounds = padBounds(viewBounds, 0.5);
  console.log(`[OpenSky] Polling states: ${bounds.south.toFixed(1)},${bounds.west.toFixed(1)} → ${bounds.north.toFixed(1)},${bounds.east.toFixed(1)}`);
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

  const stateCount = data.states ? data.states.length : 0;
  console.log(`[OpenSky] Got ${stateCount} aircraft`);
  if (stateCount > 0) {
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

document.getElementById('toggle-trails').addEventListener('change', async (e) => {
  CONFIG.trailEnabled = e.target.checked;
  renderAircraft();
  const settings = await window.flightAPI.getSettings();
  settings.trailsEnabled = CONFIG.trailEnabled;
  await window.flightAPI.saveSettings(settings);
});

document.getElementById('toggle-airports').addEventListener('change', async (e) => {
  toggleAirports(e.target.checked);
  const settings = await window.flightAPI.getSettings();
  settings.airportsEnabled = CONFIG.airportsEnabled;
  await window.flightAPI.saveSettings(settings);
});

document.getElementById('toggle-airspace').addEventListener('change', async (e) => {
  toggleAirspace(e.target.checked);
  const settings = await window.flightAPI.getSettings();
  settings.airspaceEnabled = CONFIG.airspaceEnabled;
  await window.flightAPI.saveSettings(settings);
});

const airspace3DToggle = document.getElementById('toggle-airspace-3d');
if (airspace3DToggle) {
  airspace3DToggle.addEventListener('change', (e) => {
    toggleAirspace3D(e.target.checked);
  });
}

const navaidToggle = document.getElementById('toggle-navaids');
if (navaidToggle) {
  navaidToggle.addEventListener('change', async (e) => {
    const show = e.target.checked;
    if (show && navaidEntities.length === 0 && cachedWaypointData) {
      initNavaids();
    }
    toggleNavaids(show);
    const settings = await window.flightAPI.getSettings();
    settings.navaidsEnabled = CONFIG.navaidsEnabled;
    await window.flightAPI.saveSettings(settings);
  });
}

const radarToggle = document.getElementById('toggle-radar');
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

const turbToggle = document.getElementById('toggle-turbulence');
if (turbToggle) {
  turbToggle.addEventListener('change', async (e) => {
    if (e.target.checked) {
      enableTurbulence();
    } else {
      disableTurbulence();
    }
    const settings = await window.flightAPI.getSettings();
    settings.turbulenceEnabled = CONFIG.turbulenceEnabled;
    await window.flightAPI.saveSettings(settings);
  });
}

const turbLevelSel = document.getElementById('turb-level');
if (turbLevelSel) {
  turbLevelSel.addEventListener('change', async (e) => {
    CONFIG.turbulenceLevel = e.target.value;
    if (e.target.value === 'none') {
      disableTurbForecast();
    } else {
      // Remove existing layer and add new one at selected level
      disableTurbForecast();
      enableTurbForecast();
    }
    const settings = await window.flightAPI.getSettings();
    settings.turbulenceLevel = CONFIG.turbulenceLevel;
    await window.flightAPI.saveSettings(settings);
  });
}

document.getElementById('toggle-labels').addEventListener('change', async (e) => {
  CONFIG.labelsEnabled = e.target.checked;
  for (const [icao, ac] of aircraft) {
    if (ac.entity && ac.entity.label) {
      ac.entity.label.show = e.target.checked || icao === selectedIcao;
    }
  }
  const settings = await window.flightAPI.getSettings();
  settings.labelsEnabled = CONFIG.labelsEnabled;
  await window.flightAPI.saveSettings(settings);
});

document.getElementById('poll-interval').addEventListener('change', (e) => {
  setPollInterval(parseInt(e.target.value) * 1000);
});

document.getElementById('map-layer').addEventListener('change', async (e) => {
  CONFIG.mapLayer = e.target.value;
  const layers = viewer.imageryLayers;
  layers.removeAll();
  radarLayer = null; // cleared by removeAll
  turbLayer = null;  // cleared by removeAll
  const provider = await makeMapTiles(CONFIG.mapLayer);
  layers.addImageryProvider(provider);
  // Layer order: base → turbulence forecast → radar
  if (CONFIG.turbulenceLevel !== 'none') {
    const turbProvider = await makeTurbProvider(CONFIG.turbulenceLevel);
    if (turbProvider) {
      turbLayer = layers.addImageryProvider(turbProvider);
      turbLayer.alpha = 0.65;
    }
  }
  if (CONFIG.radarEnabled) {
    radarLayer = layers.addImageryProvider(makeRadarProvider());
    radarLayer.alpha = 0.6;
  }
  // Persist the selection
  const settings = await window.flightAPI.getSettings();
  settings.mapLayer = CONFIG.mapLayer;
  await window.flightAPI.saveSettings(settings);
});

const trailLengthEl = document.getElementById('trail-length');
if (trailLengthEl) {
  trailLengthEl.addEventListener('input', (e) => {
    const val = parseInt(e.target.value);
    document.getElementById('trail-value').textContent = `${Math.round(val / 60)}m`;
    CONFIG.trailMaxAge = val;
  });
}

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
    } else if (id.startsWith('turb-')) {
      showTurbInfo(picked.id);
    } else {
      hideAircraftInfo();
    }
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
    const toRefresh = new Set([icao]);
    if (prevSelected) toRefresh.add(prevSelected);
    viewer.entities.suspendEvents();
    try {
      for (const rid of toRefresh) {
        const rac = aircraft.get(rid);
        if (rac) {
          if (rac.entity) { viewer.entities.remove(rac.entity); rac.entity = null; }
          removeTrailEntities(rac);
        }
      }
    } finally {
      viewer.entities.resumeEvents();
    }
    renderAircraft(toRefresh);
  }
}

function showTurbInfo(entity) {
  const p = entity.properties;
  if (!p) return;
  const type = p.turbType ? p.turbType.getValue() : '?';
  const panel = document.getElementById('aircraft-info');
  panel.classList.remove('hidden');

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
      <div><span class="label">RAW</span><span style="font-size:0.85em;word-break:break-all">${p.rawOb.getValue()}</span></div>
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
      ${p.rawText.getValue() ? `<div><span class="label">RAW</span><span style="font-size:0.85em;word-break:break-all">${p.rawText.getValue()}</span></div>` : ''}
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
  const prevIcao = selectedIcao;
  selectedIcao = null;
  document.getElementById('aircraft-info').classList.add('hidden');
  if (prevIcao) {
    const toRefresh = new Set([prevIcao]);
    viewer.entities.suspendEvents();
    try {
      const rac = aircraft.get(prevIcao);
      if (rac) {
        if (rac.entity) { viewer.entities.remove(rac.entity); rac.entity = null; }
        removeTrailEntities(rac);
      }
    } finally {
      viewer.entities.resumeEvents();
    }
    renderAircraft(toRefresh);
  }
}

document.getElementById('info-close').addEventListener('click', hideAircraftInfo);

// ============================================================
// Shared Init Helpers
// ============================================================

// Load settings from the platform-specific settings API and apply them
async function loadDataJSON(path) {
  console.log(`[DataLoader] Fetching ${path}...`);
  try {
    const resp = await fetch(path);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    const size = Array.isArray(data) ? data.length : Object.keys(data).length;
    console.log(`[DataLoader] Loaded ${path} (${size} entries)`);
    return data;
  } catch (err) {
    console.warn('[DataLoader] Failed to load ' + path + ':', err);
    return null;
  }
}

async function loadAndApplySettings() {
  try {
    const saved = await window.flightAPI.getSettings();
    if (saved) {
      CONFIG.fontSize = saved.fontSize || 11;
      CONFIG.themePref = saved.theme || 'dark';
      CONFIG.darkColor = saved.darkColor || '#00cc44';
      CONFIG.lightColor = saved.lightColor || '#1a1a1a';
      CONFIG.colorByAltitude = saved.colorByAltitude !== undefined ? saved.colorByAltitude : true;
      CONFIG.thickTrailsByAltitude = saved.thickTrailsByAltitude || false;
      CONFIG.showVelocityVector = saved.showVelocityVector || false;
      CONFIG.trailMaxAge = saved.trailLength || 120;
      CONFIG.rotationSpeed = saved.rotationSpeed || 3;
      const prevEdges = CONFIG.airspaceEdges;
      CONFIG.airspaceEdges = saved.airspaceEdges !== undefined ? saved.airspaceEdges : true;
      const prev3D = CONFIG.airspace3D;
      CONFIG.airspace3D = saved.airspace3D || false;
      const prevSmallAirports = CONFIG.showSmallAirports;
      CONFIG.showSmallAirports = saved.showSmallAirports || false;
      CONFIG.mapLayer = saved.mapLayer || 'carto';
      const prevNavaids = CONFIG.navaidsEnabled;
      CONFIG.navaidsEnabled = saved.navaidsEnabled || false;
      const prevShowFixes = CONFIG.showFixes;
      CONFIG.showFixes = saved.showFixes || false;
      CONFIG.openskyClientId = saved.openskyClientId || '';
      CONFIG.openskyClientSecret = saved.openskyClientSecret || '';
      CONFIG.trailEnabled = saved.trailsEnabled !== undefined ? saved.trailsEnabled : true;
      CONFIG.labelsEnabled = saved.labelsEnabled !== undefined ? saved.labelsEnabled : true;
      CONFIG.airportsEnabled = saved.airportsEnabled !== undefined ? saved.airportsEnabled : true;
      CONFIG.airspaceEnabled = saved.airspaceEnabled !== undefined ? saved.airspaceEnabled : true;
      CONFIG.radarEnabled = saved.radarEnabled || false;
      CONFIG.turbulenceEnabled = saved.turbulenceEnabled || false;
      CONFIG.turbulenceLevel = saved.turbulenceLevel || 'none';
      CONFIG.savedView = saved.savedView || null;
      await applyTheme(); // adds turb + radar layers on top if enabled
      // Sync main window checkboxes
      const trailsToggle = document.getElementById('toggle-trails');
      if (trailsToggle) trailsToggle.checked = CONFIG.trailEnabled;
      const labelsToggle = document.getElementById('toggle-labels');
      if (labelsToggle) labelsToggle.checked = CONFIG.labelsEnabled;
      const airportsToggle = document.getElementById('toggle-airports');
      if (airportsToggle) airportsToggle.checked = CONFIG.airportsEnabled;
      const airspaceToggle = document.getElementById('toggle-airspace');
      if (airspaceToggle) airspaceToggle.checked = CONFIG.airspaceEnabled;
      const nToggle2 = document.getElementById('toggle-navaids');
      if (nToggle2) nToggle2.checked = CONFIG.navaidsEnabled;
      const rToggle = document.getElementById('toggle-radar');
      if (rToggle) rToggle.checked = CONFIG.radarEnabled;
      // Start auto-refresh timer (applyTheme already adds the visual layer)
      if (CONFIG.radarEnabled) {
        if (radarRefreshTimer) clearInterval(radarRefreshTimer);
        radarRefreshTimer = setInterval(refreshRadar, 5 * 60 * 1000);
      }
      // Turbulence UI state and timers
      const tToggle = document.getElementById('toggle-turbulence');
      if (tToggle) tToggle.checked = CONFIG.turbulenceEnabled;
      const tLevel = document.getElementById('turb-level');
      if (tLevel) tLevel.value = CONFIG.turbulenceLevel;
      // GTG forecast: applyTheme already added the imagery layer if level !== 'none';
      // just start the refresh timer
      if (CONFIG.turbulenceLevel !== 'none') {
        if (turbRefreshTimer) clearInterval(turbRefreshTimer);
        turbRefreshTimer = setInterval(refreshTurbForecast, 15 * 60 * 1000);
      }
      // TURB toggle: PIREPs/SIGMETs/G-AIRMETs (entities)
      if (CONFIG.turbulenceEnabled) {
        fetchTurbulenceData();
        if (turbDataRefreshTimer) clearInterval(turbDataRefreshTimer);
        turbDataRefreshTimer = setInterval(() => {
          removeTurbEntities();
          fetchTurbulenceData();
        }, 5 * 60 * 1000);
      }
      const mapLayerSel = document.getElementById('map-layer');
      if (mapLayerSel) mapLayerSel.value = CONFIG.mapLayer;
      if ((prevEdges !== CONFIG.airspaceEdges || prev3D !== CONFIG.airspace3D) && airspaceEntities.length > 0) {
        rebuildAirspace();
      }
      if (prevSmallAirports !== CONFIG.showSmallAirports && cachedAirportData) {
        if (CONFIG.showSmallAirports) {
          initSmallAirports(cachedAirportData);
        } else {
          removeSmallAirports();
        }
      }
      if (prevNavaids !== CONFIG.navaidsEnabled) {
        if (CONFIG.navaidsEnabled && navaidEntities.length === 0 && cachedWaypointData) {
          initNavaids();
        }
        toggleNavaids(CONFIG.navaidsEnabled);
        const nToggle = document.getElementById('toggle-navaids');
        if (nToggle) nToggle.checked = CONFIG.navaidsEnabled;
      }
      if (prevShowFixes !== CONFIG.showFixes && cachedWaypointData) {
        if (CONFIG.showFixes) {
          initFixes();
        } else {
          removeFixes();
        }
      }
    }
  } catch (err) {
    console.warn('[Settings] Could not load:', err);
  }

  // Load data files
  const [airports, airspace, waypoints] = await Promise.all([
    loadDataJSON('../data/airports.json'),
    loadDataJSON('../data/airspace.json'),
    loadDataJSON('../data/waypoints.json'),
  ]);

  // Initialize airport markers (after theme is applied so colors are correct)
  if (airportEntities.length === 0 && airports) {
    initAirports(airports);
  }

  // Initialize airspace boundaries
  if (airspaceEntities.length === 0 && airspace) {
    initAirspace(airspace);
  }

  // Cache waypoint data (entities created on-demand when enabled)
  if (waypoints) {
    cachedWaypointData = waypoints;
    if (CONFIG.navaidsEnabled && navaidEntities.length === 0) {
      initNavaids();
    }
  }

  // Register system theme change listener (once)
  if (!loadAndApplySettings._systemThemeRegistered && window.flightAPI && window.flightAPI.onSystemThemeChanged) {
    loadAndApplySettings._systemThemeRegistered = true;
    window.flightAPI.onSystemThemeChanged(() => {
      if (CONFIG.themePref === 'system') applyTheme();
    });
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
