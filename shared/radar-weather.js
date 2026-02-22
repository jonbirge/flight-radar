// Weather overlays: NEXRAD radar, AWC turbulence forecast, PIREPs, SIGMETs, G-AIRMETs.
// Depends on radar-core.js (viewer, CONFIG, state variables).

'use strict';

// ============================================================
// NEXRAD Weather Radar Overlay
// ============================================================

/**
 * Imagery provider wrapper that filters NEXRAD tiles to remove ground clutter.
 * Keeps only saturated weather colors (green/yellow/orange/red) and makes
 * everything else transparent.
 */
class FilteredRadarImageryProvider {
  constructor(innerProvider) {
    this._inner = innerProvider;
  }

  // --- Delegated read-only properties ---
  get rectangle()        { return this._inner.rectangle; }
  get tileWidth()        { return this._inner.tileWidth; }
  get tileHeight()       { return this._inner.tileHeight; }
  get maximumLevel()     { return this._inner.maximumLevel; }
  get minimumLevel()     { return this._inner.minimumLevel; }
  get tilingScheme()     { return this._inner.tilingScheme; }
  get tileDiscardPolicy(){ return this._inner.tileDiscardPolicy; }
  get errorEvent()       { return this._inner.errorEvent; }
  get credit()           { return this._inner.credit; }
  get proxy()            { return this._inner.proxy; }
  get ready()            { return this._inner.ready; }
  get readyPromise()     { return this._inner.readyPromise; }
  get hasAlphaChannel()  { return true; }

  getTileCredits(x, y, level) {
    return this._inner.getTileCredits(x, y, level);
  }

  pickFeatures(x, y, level, longitude, latitude) {
    return this._inner.pickFeatures(x, y, level, longitude, latitude);
  }

  requestImage(x, y, level, request) {
    const promise = this._inner.requestImage(x, y, level, request);
    if (!promise) return promise;

    return Promise.resolve(promise).then((image) => {
      if (!image) return image;
      return this._filterImage(image);
    });
  }

  /**
   * Filter a tile image, removing low-saturation / low-intensity pixels
   * that represent ground clutter rather than actual precipitation.
   */
  _filterImage(image) {
    const w = image.width || image.naturalWidth || 256;
    const h = image.height || image.naturalHeight || 256;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(image, 0, 0, w, h);

    const imageData = ctx.getImageData(0, 0, w, h);
    const d = imageData.data;

    for (let i = 0; i < d.length; i += 4) {
      const a = d[i + 3];
      if (a === 0) continue; // already transparent

      const r = d[i], g = d[i + 1], b = d[i + 2];

      // Convert to HSL
      const rn = r / 255, gn = g / 255, bn = b / 255;
      const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
      const l = (max + min) / 2;
      let s = 0;
      if (max !== min) {
        const delta = max - min;
        s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);
      }

      // Remove pixels that are too dark, too dim, or too desaturated.
      // These represent ground clutter and low-level noise in the NEXRAD data.
      // Keep only vivid weather colors: saturated greens, yellows, oranges, reds, magentas.
      if (s < 0.3 || l < 0.12 || l > 0.92) {
        d[i + 3] = 0; // make transparent
      }
    }

    ctx.putImageData(imageData, 0, 0);
    return createImageBitmap(canvas);
  }
}

function makeRadarProvider() {
  console.log('[Radar] Loading NEXRAD WMS tiles from Iowa State Mesonet (filtered)');
  const inner = new Cesium.WebMapServiceImageryProvider({
    url: 'https://mesonet.agron.iastate.edu/cgi-bin/wms/nexrad/n0q.cgi?',
    layers: 'nexrad-n0q-900913',
    parameters: {
      transparent: true,
      format: 'image/png',
    },
    credit: new Cesium.Credit('Iowa State Mesonet'),
  });
  return new FilteredRadarImageryProvider(inner);
}

function enableRadar() {
  if (radarLayer) return;
  const provider = makeRadarProvider();
  radarLayer = viewer.imageryLayers.addImageryProvider(provider);
  radarLayer.alpha = 0.5;
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
  radarLayer.alpha = 0.5;
  console.log('[Radar] NEXRAD overlay refreshed');
}

// ============================================================
// AWC URL helper — routes through proxy when configured (web), direct otherwise (Electron)
// ============================================================

function awcUrl(path) {
  if (CONFIG.awcProxyUrl) {
    const qIdx = path.indexOf('?');
    const endpoint = qIdx >= 0 ? path.substring(0, qIdx) : path;
    const params = qIdx >= 0 ? '&' + path.substring(qIdx + 1) : '';
    return `${CONFIG.awcProxyUrl}?endpoint=${endpoint}${params}`;
  }
  return `https://aviationweather.gov/api/data/${path}`;
}

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
  const url = awcUrl(`model?model=gfaak&level=${level}&type=gtg&_t=${Date.now()}`);
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

function removePirepEntities() {
  for (const entity of pirepEntities) {
    viewer.entities.remove(entity);
  }
  pirepEntities.length = 0;
}

function removeSigmetEntities() {
  for (const entity of sigmetEntities) {
    viewer.entities.remove(entity);
  }
  sigmetEntities.length = 0;
}

function removeAirmetEntities() {
  for (const entity of airmetEntities) {
    viewer.entities.remove(entity);
  }
  airmetEntities.length = 0;
}

const PIREP_CSS_COLORS = {
  NEG:   'rgba(51, 128, 255, 0.7)',
  SMT:   'rgba(51, 128, 255, 0.7)',
  LGT:   'rgba(0, 204, 0, 0.8)',
  MOD:   'rgba(255, 153, 0, 0.9)',
  SEV:   'rgba(255, 0, 0, 1.0)',
  EXTRM: 'rgba(255, 0, 255, 1.0)',
};

function pirepCssColor(intensity) {
  if (!intensity) return PIREP_CSS_COLORS.LGT;
  const upper = intensity.toUpperCase().replace(/-/g, '');
  for (const key of ['EXTRM', 'SEV', 'MOD', 'LGT', 'NEG', 'SMT']) {
    if (upper.includes(key)) return PIREP_CSS_COLORS[key] || PIREP_CSS_COLORS.LGT;
  }
  return PIREP_CSS_COLORS.LGT;
}

async function fetchPireps() {
  console.log('[Weather] Fetching PIREPs...');
  try {
    const resp = await fetch(awcUrl('pirep?format=geojson&type=turb&age=12&bbox=15,-180,75,-50')).catch((err) => { console.warn('[Weather] PIREP fetch failed:', err.message); return null; });
    if (resp && resp.ok) {
      const data = await resp.json();
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
          const cssColor = pirepCssColor(intensity);
          const icon = createPirepIcon(intensity, cssColor);

          const obsTime = props.obsTime ? new Date(props.obsTime).toUTCString().slice(17, 25) + 'Z' : '?';
          const camH = viewer.camera.positionCartographic ? viewer.camera.positionCartographic.height : 1e7;
          const pirepDisplayCond = acDisplayCond || new Cesium.DistanceDisplayCondition(0, computeHorizonDist(camH));
          const entity = viewer.entities.add({
            id: `turb-pirep-${pirepCount}`,
            position: Cesium.Cartesian3.fromDegrees(lon, lat, alt),
            billboard: {
              image: icon,
              width: 36,
              height: 36,
              scaleByDistance: new Cesium.NearFarScalar(1e5, 1.0, 6e6, 0.3),
              distanceDisplayCondition: pirepDisplayCond,
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
          pirepEntities.push(entity);
          pirepCount++;
        }
        console.log(`[Weather] Added ${pirepCount} turbulence PIREP entities`);
      }
    } else {
      console.warn(`[Weather] PIREPs response not ok: ${resp ? resp.status : 'null'}`);
    }
  } catch (err) {
    console.warn('[Weather] Error fetching PIREPs:', err);
  }
}

async function fetchSigmets() {
  console.log('[Weather] Fetching SIGMETs...');
  try {
    const resp = await fetch(awcUrl('sigmet?format=geojson')).catch((err) => { console.warn('[Weather] SIGMET fetch failed:', err.message); return null; });
    if (resp && resp.ok) {
      const data = await resp.json();
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
            sigmetEntities.push(entity);
            count++;
          }
        }
        console.log(`[Weather] Added ${count} SIGMET polygons`);
      }
    }
  } catch (err) {
    console.warn('[Weather] Error fetching SIGMETs:', err);
  }
}

async function fetchAirmets() {
  console.log('[Weather] Fetching G-AIRMETs...');
  try {
    const resp = await fetch(awcUrl('gairmet?format=geojson')).catch((err) => { console.warn('[Weather] G-AIRMET fetch failed:', err.message); return null; });
    if (resp && resp.ok) {
      const data = await resp.json();
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
            airmetEntities.push(entity);
            count++;
          }
        }
        console.log(`[Weather] Added ${count} G-AIRMET polygons`);
      }
    }
  } catch (err) {
    console.warn('[Weather] Error fetching G-AIRMETs:', err);
  }
}

function enablePireps() {
  CONFIG.pirepsEnabled = true;
  console.log('[Weather] PIREPs enabled');
  fetchPireps();
  if (pirepRefreshTimer) clearInterval(pirepRefreshTimer);
  pirepRefreshTimer = setInterval(() => {
    removePirepEntities();
    fetchPireps();
  }, 5 * 60 * 1000);
}

function disablePireps() {
  removePirepEntities();
  CONFIG.pirepsEnabled = false;
  if (pirepRefreshTimer) {
    clearInterval(pirepRefreshTimer);
    pirepRefreshTimer = null;
  }
  console.log('[Weather] PIREPs disabled');
}

function enableSigmets() {
  CONFIG.sigmetsEnabled = true;
  console.log('[Weather] SIGMETs enabled');
  fetchSigmets();
  if (sigmetRefreshTimer) clearInterval(sigmetRefreshTimer);
  sigmetRefreshTimer = setInterval(() => {
    removeSigmetEntities();
    fetchSigmets();
  }, 5 * 60 * 1000);
}

function disableSigmets() {
  removeSigmetEntities();
  CONFIG.sigmetsEnabled = false;
  if (sigmetRefreshTimer) {
    clearInterval(sigmetRefreshTimer);
    sigmetRefreshTimer = null;
  }
  console.log('[Weather] SIGMETs disabled');
}

function enableAirmets() {
  CONFIG.airmetsEnabled = true;
  console.log('[Weather] AIRMETs enabled');
  fetchAirmets();
  if (airmetRefreshTimer) clearInterval(airmetRefreshTimer);
  airmetRefreshTimer = setInterval(() => {
    removeAirmetEntities();
    fetchAirmets();
  }, 5 * 60 * 1000);
}

function disableAirmets() {
  removeAirmetEntities();
  CONFIG.airmetsEnabled = false;
  if (airmetRefreshTimer) {
    clearInterval(airmetRefreshTimer);
    airmetRefreshTimer = null;
  }
  console.log('[Weather] AIRMETs disabled');
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

// Compute the best turbulence forecast level based on the active flight plan.
// If a flight plan with a filed altitude exists, snap to the nearest available FL.
// Otherwise default to 'maxa' (MAX HI).
const TURB_LEVELS = [100, 130, 160, 180, 210, 240, 270, 300, 330, 360, 390, 420, 450];

function computeTurbLevel() {
  if (activeFlightPlan) {
    const flights = activeFlightPlan.flights || [];
    const flight = flights.length > 0 ? pickBestFlight(flights) : null;
    if (flight && flight.filed_altitude != null) {
      const fl = flight.filed_altitude; // already in hundreds of feet
      let closest = TURB_LEVELS[0];
      let minDiff = Math.abs(fl - closest);
      for (const level of TURB_LEVELS) {
        const diff = Math.abs(fl - level);
        if (diff < minDiff) { minDiff = diff; closest = level; }
      }
      return String(closest);
    }
  }
  return 'maxa';
}

// Recompute and refresh the turb forecast layer if the checkbox is enabled.
// Called when flight plan data changes (loaded, cleared, enriched).
function refreshTurbLevel() {
  if (!CONFIG.turbForecastEnabled) return;
  const newLevel = computeTurbLevel();
  if (newLevel !== CONFIG.turbulenceLevel) {
    CONFIG.turbulenceLevel = newLevel;
    disableTurbForecast();
    enableTurbForecast();
    console.log(`[Weather] Turb level auto-updated to ${newLevel}`);
  }
}
