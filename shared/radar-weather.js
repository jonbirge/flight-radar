// Weather overlays: NEXRAD radar, GOES satellite IR, AWC turbulence forecast, PIREPs, SIGMETs, G-AIRMETs.
// Depends on radar-core.js (viewer, CONFIG, state variables).

// Maximum age of PIREPs to display (both live and scrubbing).
// In live mode, PIREPs older than this are discarded at fetch time.
// In scrubbing mode, PIREPs are visible from observation time until this duration after.
window.PIREP_MAX_AGE_MS = 3 * 60 * 60 * 1000; // 3 hours

// ============================================================
// GOES Satellite IR Overlay
// ============================================================

function makeSatelliteIRProvider() {
  console.log('[Satellite] Loading GOES IR WMS tiles from Iowa State Mesonet');
  return new Cesium.WebMapServiceImageryProvider({
    url: 'https://mesonet.agron.iastate.edu/cgi-bin/wms/goes/conus_ir.cgi',
    layers: 'conus_ir_4km',
    parameters: {
      transparent: true,
      format: 'image/png',
    },
    credit: new Cesium.Credit('NOAA GOES / Iowa State Mesonet'),
  });
}

function addSatelliteIRLayer() {
  const provider = makeSatelliteIRProvider();
  // Insert below turbulence and radar layers
  if (turbLayer) {
    const idx = viewer.imageryLayers.indexOf(turbLayer);
    satelliteIRLayer = viewer.imageryLayers.addImageryProvider(provider, idx);
  } else if (radarLayer) {
    const idx = viewer.imageryLayers.indexOf(radarLayer);
    satelliteIRLayer = viewer.imageryLayers.addImageryProvider(provider, idx);
  } else {
    satelliteIRLayer = viewer.imageryLayers.addImageryProvider(provider);
  }
  satelliteIRLayer.alpha = CONFIG.weatherOverlayOpacity / 100;
}

function enableSatelliteIR() {
  if (satelliteIRLayer) return;
  addSatelliteIRLayer();
  CONFIG.satelliteIREnabled = true;
  console.log('[Satellite] GOES IR overlay enabled');
  // Auto-refresh every 10 minutes
  if (satelliteIRRefreshTimer) clearInterval(satelliteIRRefreshTimer);
  satelliteIRRefreshTimer = setInterval(refreshSatelliteIR, 10 * 60 * 1000);
}

function disableSatelliteIR() {
  if (satelliteIRLayer) {
    viewer.imageryLayers.remove(satelliteIRLayer);
    satelliteIRLayer = null;
  }
  CONFIG.satelliteIREnabled = false;
  if (satelliteIRRefreshTimer) {
    clearInterval(satelliteIRRefreshTimer);
    satelliteIRRefreshTimer = null;
  }
  console.log('[Satellite] GOES IR overlay disabled');
}

function refreshSatelliteIR() {
  if (!CONFIG.satelliteIREnabled) return;
  if (satelliteIRLayer) {
    viewer.imageryLayers.remove(satelliteIRLayer);
    satelliteIRLayer = null;
  }
  addSatelliteIRLayer();
  console.log('[Satellite] GOES IR overlay refreshed');
}

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

    if (!CONFIG.radarThinning) {
      return createImageBitmap(canvas);
    }

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
      let s = 0, h = 0;
      if (max !== min) {
        const delta = max - min;
        s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);
        if (max === rn)      h = ((gn - bn) / delta + (gn < bn ? 6 : 0)) * 60;
        else if (max === gn) h = ((bn - rn) / delta + 2) * 60;
        else                 h = ((rn - gn) / delta + 4) * 60;
      }

      // Remove ground clutter (grey/dark/bright) and non-precipitation blues.
      // Fade gradually from transparent (blue/grey) to full opacity (green)
      // so the transition from blue→cyan→green isn't a hard edge.
      if (s < 0.3 || l < 0.12 || l > 0.92) {
        d[i + 3] = 0;
      } else if (h >= 180 && h <= 260) {
        // Pure blue range — fully transparent
        d[i + 3] = 0;
      } else if (h >= 120 && h < 180) {
        // Cyan-to-green transition zone (180→120): fade in gradually.
        // At h=180 (cyan): fully transparent. At h=120 (green): full alpha.
        const t = (180 - h) / 60; // 0 at cyan, 1 at green
        d[i + 3] = Math.round(a * t);
      } else if (h > 260 && h <= 300) {
        // Blue-to-magenta transition zone (260→300): fade in gradually.
        // At h=260: fully transparent. At h=300 (magenta): full alpha.
        const t = (h - 260) / 40; // 0 at blue edge, 1 at magenta
        d[i + 3] = Math.round(a * t);
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
  radarLayer.alpha = CONFIG.weatherOverlayOpacity / 100;
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
  radarLayer.alpha = CONFIG.weatherOverlayOpacity / 100;
  console.log('[Radar] NEXRAD overlay refreshed');
}

// ============================================================
// AWC URL helper — routes through proxy when configured (web), direct otherwise (Electron)
// ============================================================

function awcUrl(path) {
  if (CONFIG.awcProxyUrl) {
    if (CONFIG.awcProxyUrl.startsWith('/')) {
      // Path-based proxy (Vite dev server) — clean URL
      return `${CONFIG.awcProxyUrl}/${path}`;
    }
    // PHP proxy (web) — query-string format
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
window.TURB_LON_WEST = -215.69104;
window.TURB_LON_EAST = -39.508957;
window.TURB_LAT_SOUTH = -0.196746;
window.TURB_LAT_NORTH = 76.97271;
window.TURB_CROP_LON = -180; // crop everything west of antimeridian

// Mercator Y helper
function geoLatToMercY(latDeg) {
  const latRad = latDeg * Math.PI / 180;
  return Math.log(Math.tan(Math.PI / 4 + latRad / 2));
}

// Fetch a GTG turbulence image, crop, and reproject from Mercator to geographic.
// dateSecs: Unix timestamp in seconds for the forecast valid time (null = current).
// opts.keepTransparency: if true, don't fill transparent pixels with white (for 3D layers).
// Returns a data URL string (PNG) or null on failure.
async function fetchTurbImageDataUrl(level, dateSecs, opts) {
  const dateParam = dateSecs != null ? `&date=${dateSecs}` : '';
  const url = awcUrl(`model?model=gfaak&level=${level}&type=gtg${dateParam}&_t=${Date.now()}`);
  console.log(`[Weather] Loading GTG image: level=${level}${dateSecs != null ? `, date=${dateSecs}` : ''}`);
  try {
    // Fetch as blob so canvas won't be tainted by cross-origin
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    if (resp.status === 204) throw new Error('No content (HTTP 204)');
    const blob = await resp.blob();
    if (blob.size === 0) throw new Error('Empty response body');
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
    // Replace transparent pixels with white (lightest turbulence color)
    // unless keepTransparency is set (used for 3D altitude surfaces)
    if (opts?.keepTransparency) {
      // For 3D layers: make white-ish and blue-ish pixels fully transparent
      // so only moderate-to-severe turbulence colors (green/yellow/orange/red) remain
      const pixels = outData.data;
      for (let i = 0; i < pixels.length; i += 4) {
        const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
        // Near-white: all channels high (smooth/no turbulence)
        if (r > 200 && g > 200 && b > 200) {
          pixels[i + 3] = 0;
          continue;
        }
        // Blue-dominant: blue significantly exceeds red (light turbulence)
        if (b > 150 && b > r + 40) {
          pixels[i + 3] = 0;
        }
      }
    } else {
      const pixels = outData.data;
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i + 3] === 0) {
          pixels[i] = 255;     // R
          pixels[i + 1] = 255; // G
          pixels[i + 2] = 255; // B
          pixels[i + 3] = 255; // A
        }
      }
    }

    outCanvas.getContext('2d').putImageData(outData, 0, 0);

    console.log(`[Weather] GTG image reprojected: ${cropW}x${img.height}`);
    return outCanvas.toDataURL('image/png');
  } catch (err) {
    console.warn('[Weather] Failed to load GTG image:', err.message);
    return null;
  }
}

// Create a Cesium imagery provider from a pre-computed GTG data URL.
function createTurbProviderFromDataUrl(dataUrl) {
  return new Cesium.SingleTileImageryProvider({
    url: dataUrl,
    rectangle: Cesium.Rectangle.fromDegrees(TURB_CROP_LON, TURB_LAT_SOUTH, TURB_LON_EAST, TURB_LAT_NORTH),
    credit: new Cesium.Credit('AWC'),
  });
}

async function makeTurbProvider(level, dateSecs) {
  const dataUrl = await fetchTurbImageDataUrl(level, dateSecs);
  if (!dataUrl) return null;
  return createTurbProviderFromDataUrl(dataUrl);
}

async function addTurbLayer(dateSecs) {
  const primaryLevel = CONFIG.turbulenceLevel;
  if (primaryLevel === 'none') return;

  // Capture generation — if another add/remove happens while we await, bail out
  const gen = ++_turbAddGen;
  const oldLayer = turbLayer;

  // Build ordered list of levels to try: primary first, then nearest alternatives
  const levelsToTry = [primaryLevel];
  if (primaryLevel !== 'maxa') {
    const primaryNum = parseInt(primaryLevel, 10);
    const sorted = TURB_LEVELS
      .filter(l => l !== primaryNum)
      .sort((a, b) => Math.abs(a - primaryNum) - Math.abs(b - primaryNum));
    for (const l of sorted.slice(0, 4)) {
      levelsToTry.push(String(l));
    }
  }

  for (const level of levelsToTry) {
    const provider = await makeTurbProvider(level, dateSecs);
    // Check if superseded by a newer add/remove while we were fetching
    if (_turbAddGen !== gen) return;
    if (provider) {
      if (radarLayer) {
        const radarIdx = viewer.imageryLayers.indexOf(radarLayer);
        turbLayer = viewer.imageryLayers.addImageryProvider(provider, radarIdx);
      } else {
        turbLayer = viewer.imageryLayers.addImageryProvider(provider);
      }
      turbLayer.alpha = CONFIG.weatherOverlayOpacity / 100;
      // Remove old layer AFTER adding new one to avoid flash
      if (oldLayer) {
        viewer.imageryLayers.remove(oldLayer);
      }
      if (level !== primaryLevel) {
        console.log(`[Weather] GTG fallback: used level ${level} instead of ${primaryLevel}`);
      }
      return;
    }
  }
  console.warn('[Weather] GTG: all level attempts failed');
}

function removeTurbLayer() {
  _turbAddGen++; // Cancel any in-flight async addTurbLayer()
  if (turbLayer) {
    viewer.imageryLayers.remove(turbLayer);
    turbLayer = null;
  }
}

// ============================================================
// 3D Turbulence Altitude Surfaces
// ============================================================
// Fetches GTG images for all numeric flight levels and displays each as a
// semi-transparent rectangle entity at the appropriate altitude.

window._turb3dGen = 0; // generation counter to cancel stale async work

async function addTurb3DLayers(dateSecs) {
  const gen = ++_turb3dGen;
  const rectangle = Cesium.Rectangle.fromDegrees(TURB_CROP_LON, TURB_LAT_SOUTH, TURB_LON_EAST, TURB_LAT_NORTH);

  // Fetch all levels in parallel
  const results = await Promise.all(
    TURB_LEVELS.map(async (fl) => {
      const dataUrl = await fetchTurbImageDataUrl(String(fl), dateSecs, { keepTransparency: true });
      return { fl, dataUrl };
    })
  );

  if (_turb3dGen !== gen) return; // superseded

  for (const { fl, dataUrl } of results) {
    if (!dataUrl) continue;
    const altMeters = fl * 100 * 0.3048; // FL to feet to meters
    const entity = viewer.entities.add({
      rectangle: {
        coordinates: rectangle,
        material: new Cesium.ImageMaterialProperty({
          image: dataUrl,
          color: Cesium.Color.WHITE.withAlpha(0.10),
          transparent: true,
        }),
        height: exAlt(altMeters),
        heightReference: Cesium.HeightReference.NONE,
        outline: false,
        shadows: Cesium.ShadowMode.DISABLED,
      },
    });
    turb3dEntities.push(entity);
  }
  console.log(`[Weather] Added ${turb3dEntities.length} 3D turbulence altitude surfaces`);
}

function removeTurb3DLayers() {
  _turb3dGen++;
  for (const entity of turb3dEntities) {
    viewer.entities.remove(entity);
  }
  turb3dEntities.length = 0;
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

window.PIREP_CSS_COLORS = {
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
  const pirepMaxAgeHours = Math.ceil(PIREP_MAX_AGE_MS / (60 * 60 * 1000));
  try {
    const resp = await fetch(awcUrl(`pirep?format=geojson&type=turb&age=${pirepMaxAgeHours}&bbox=15,-180,75,-50`)).catch((err) => { console.warn('[Weather] PIREP fetch failed:', err.message); return null; });
    if (resp && resp.ok) {
      const data = await resp.json();
      console.log(`[Weather] PIREPs response: ${(data.features || []).length} total reports`);
      let pirepCount = 0;
      const now = Date.now();
      if (data.features) {
        for (const f of data.features) {
          const props = f.properties || {};
          const coords = f.geometry && f.geometry.coordinates;
          if (!coords || coords.length < 2) continue;

          // Skip PIREPs older than the max age
          const obsTimeISO = props.obsTime || null;
          if (obsTimeISO) {
            const obsMs = new Date(obsTimeISO).getTime();
            if (!isNaN(obsMs) && now - obsMs > PIREP_MAX_AGE_MS) continue;
          }

          const lon = coords[0], lat = coords[1];
          const alt = (props.fltlvl || 0) * 100 * 0.3048; // FL to meters
          const intensity = props.tbInt1 || 'LGT';
          const cssColor = pirepCssColor(intensity);
          const icon = createPirepIcon(intensity, cssColor);

          const obsTime = props.obsTime ? new Date(props.obsTime).toUTCString().slice(17, 22) + 'Z' : '?';
          const camH = viewer.camera.positionCartographic ? viewer.camera.positionCartographic.height : 1e7;
          const pirepDisplayCond = acDisplayCond || new Cesium.DistanceDisplayCondition(0, computeHorizonDist(camH));
          const entity = viewer.entities.add({
            id: `turb-pirep-${pirepCount}`,
            position: Cesium.Cartesian3.fromDegrees(lon, lat, exAlt(alt)),
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
              obsTimeISO: obsTimeISO,
              rawOb: props.rawOb || '',
            },
          });
          pirepEntities.push(entity);
          pirepCount++;
        }
        console.log(`[Weather] Added ${pirepCount} turbulence PIREP entities`);
      }
      // If scrubbing, immediately filter new entities to the current timeline position
      if (timelineTime !== null && typeof filterWeatherByTime === 'function') {
        filterWeatherByTime(timelineTime);
      } else {
        updateLiveAltitudeFilter(true);
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
            ? new Cesium.Color(1.0, 0.85, 0.0, 0.12)
            : new Cesium.Color(1.0, 0.0, 0.0, 0.12);
          const edgeColor = isConvective
            ? new Cesium.Color(1.0, 0.85, 0.0, 0.6)
            : new Cesium.Color(1.0, 0.0, 0.0, 0.6);
          const polygons = geom.type === 'Polygon' ? [geom.coordinates]
            : geom.type === 'MultiPolygon' ? geom.coordinates : [];
          // Parse altitude bounds for 3D volume extrusion
          // SIGMET altitudes from AWC API are in feet (e.g. 45000), not flight levels
          const baseVal = sp.altitudeLow1 || sp.altLow || null;
          const topVal = sp.altitudeHi1 || sp.altHi || null;
          const baseFt = (baseVal != null && baseVal !== '?' && baseVal !== '') ? Number(baseVal) : null;
          const topFt = (topVal != null && topVal !== '?' && topVal !== '') ? Number(topVal) : null;
          const baseMeters = baseFt != null && !isNaN(baseFt) ? exAlt(baseFt * 0.3048) : 0;
          const topMeters = topFt != null && !isNaN(topFt) ? exAlt(topFt * 0.3048) : exAlt(60000 * 0.3048);
          for (const rings of polygons) {
            if (!rings || !rings[0] || rings[0].length < 3) continue;
            const positions = rings[0].map(c => Cesium.Cartesian3.fromDegrees(c[0], c[1]));
            const edgesOn = CONFIG.airspaceEdges;
            const entity = viewer.entities.add({
              id: `turb-sigmet-${count}`,
              polygon: {
                hierarchy: new Cesium.PolygonHierarchy(positions),
                material: fillColor,
                outline: edgesOn,
                outlineColor: edgesOn ? edgeColor : undefined,
                outlineWidth: edgesOn ? 1 : undefined,
                height: baseMeters,
                extrudedHeight: topMeters,
              },
              properties: {
                turbType: isConvective ? 'CONVECTIVE SIGMET' : 'SIGMET',
                hazard: hazard,
                severity: sp.severity || '?',
                base: baseVal || '?',
                top: topVal || '?',
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
      // If scrubbing, immediately filter new entities to the current timeline position
      if (timelineTime !== null && typeof filterWeatherByTime === 'function') {
        filterWeatherByTime(timelineTime);
      } else {
        updateLiveAltitudeFilter(true);
      }
    }
  } catch (err) {
    console.warn('[Weather] Error fetching SIGMETs:', err);
  }
}

// Internal helper: create AIRMET entities from fetched responses and push into the given array.
function _buildAirmetEntities(responses, targetArray, idPrefix) {
  let count = 0;
  for (const resp of responses) {
    if (!resp) continue;
    const turbFeatures = (resp.features || []).filter(f => {
      const hazard = (f.properties || {}).hazard || '';
      return hazard === 'TURB-HI' || hazard === 'TURB-LO';
    });
    for (const f of turbFeatures) {
      const geom = f.geometry;
      if (!geom) continue;
      const ap = f.properties || {};
      // G-AIRMETs are point-in-time snapshots, not intervals
      const validFrom = ap.validTime || null;
      const polygons = geom.type === 'Polygon' ? [geom.coordinates]
        : geom.type === 'MultiPolygon' ? geom.coordinates : [];
      // Parse altitude bounds for 3D volume extrusion
      const baseVal = ap.base || null;
      const topVal = ap.top || null;
      const baseFL = parseAltToFL(baseVal);
      const topFL = parseAltToFL(topVal);
      const baseMeters = baseFL != null ? exAlt(baseFL * 100 * 0.3048) : 0;
      const topMeters = topFL != null ? exAlt(topFL * 100 * 0.3048) : exAlt(60000 * 0.3048);
      for (const rings of polygons) {
        if (!rings || !rings[0] || rings[0].length < 3) continue;
        const positions = rings[0].map(c => Cesium.Cartesian3.fromDegrees(c[0], c[1]));
        const edgesOn = CONFIG.airspaceEdges;
        const entity = viewer.entities.add({
          id: `${idPrefix}-${count}`,
          polygon: {
            hierarchy: new Cesium.PolygonHierarchy(positions),
            material: new Cesium.Color(1.0, 0.5, 0.0, 0.10),
            outline: edgesOn,
            outlineColor: edgesOn ? new Cesium.Color(1.0, 0.5, 0.0, 0.7) : undefined,
            outlineWidth: edgesOn ? 1 : undefined,
            height: baseMeters,
            extrudedHeight: topMeters,
          },
          properties: {
            turbType: 'G-AIRMET',
            hazard: ap.hazard || '?',
            severity: ap.severity || '?',
            base: baseVal || '?',
            top: topVal || '?',
            validFrom: validFrom || '?',
          },
        });
        targetArray.push(entity);
        count++;
      }
    }
  }
  return count;
}

// Fetch G-AIRMET snapshots for hours 0 and 3, keep the one closest to now.
// G-AIRMETs are point-in-time snapshots issued every 6 hours; the fore=0 and
// fore=3 snapshots may both be in the past, so we pick whichever is nearest.
async function fetchAirmets() {
  console.log('[Weather] Fetching G-AIRMETs (live, hours 0 & 3)...');
  try {
    const [resp0, resp3] = await Promise.all([
      fetch(awcUrl('gairmet?format=geojson&fore=0'))
        .catch(err => { console.warn('[Weather] G-AIRMET fore=0 fetch failed:', err.message); return null; }),
      fetch(awcUrl('gairmet?format=geojson&fore=3'))
        .catch(err => { console.warn('[Weather] G-AIRMET fore=3 fetch failed:', err.message); return null; }),
    ]);
    const snapshots = [];
    for (const resp of [resp0, resp3]) {
      if (resp && resp.ok) snapshots.push(await resp.json());
    }
    if (snapshots.length === 0) return;
    // Pick the snapshot whose validTime is closest to now
    const now = Date.now();
    const best = snapshots.reduce((a, b) => {
      const aTime = _snapshotTime(a);
      const bTime = _snapshotTime(b);
      return Math.abs(aTime - now) <= Math.abs(bTime - now) ? a : b;
    });
    const count = _buildAirmetEntities([best], airmetEntities, 'turb-airmet');
    console.log(`[Weather] Added ${count} G-AIRMET polygons (nearest snapshot)`);
    // Apply altitude filter for new entities in live mode
    updateLiveAltitudeFilter(true);
  } catch (err) {
    console.warn('[Weather] Error fetching G-AIRMETs:', err);
  }
}

// Extract the validTime from the first feature in a G-AIRMET response as epoch ms.
function _snapshotTime(resp) {
  const features = resp && resp.features;
  if (features && features.length > 0) {
    const vt = (features[0].properties || {}).validTime;
    if (vt) { const ms = new Date(vt).getTime(); if (!isNaN(ms)) return ms; }
  }
  return 0;
}

// Fetch all G-AIRMET forecast snapshots (hours 0,3,6,9,12) into the scrubbing array.
// Called when entering timeline scrubbing mode so scrubbing has full time coverage.
// Live AIRMET entities are hidden while scrub entities are active.
async function fetchAirmetsForScrubbing() {
  console.log('[Weather] Fetching G-AIRMETs for scrubbing (hours 0,3,6,9,12)...');
  removeScrubAirmetEntities();
  try {
    const forecastHours = [0, 3, 6, 9, 12];
    const responses = await Promise.all(forecastHours.map(fh =>
      fetch(awcUrl(`gairmet?format=geojson&fore=${fh}`))
        .catch(err => { console.warn('[Weather] G-AIRMET scrub fetch failed:', err.message); return null; })
    ));
    const jsonResults = [];
    for (const resp of responses) {
      if (resp && resp.ok) jsonResults.push(await resp.json());
    }
    // Hide live AIRMET entities while scrub entities are shown
    for (const entity of airmetEntities) entity.show = false;
    const count = _buildAirmetEntities(jsonResults, _scrubAirmetEntities, 'turb-airmet-scrub');
    console.log(`[Weather] Added ${count} G-AIRMET scrub polygons across ${forecastHours.length} forecast snapshots`);
    // Immediately filter to current timeline position
    if (timelineTime !== null && typeof filterWeatherByTime === 'function') {
      filterWeatherByTime(timelineTime);
    } else {
      updateLiveAltitudeFilter(true);
    }
  } catch (err) {
    console.warn('[Weather] Error fetching G-AIRMETs for scrubbing:', err);
  }
}

// Remove scrubbing AIRMET entities and restore live AIRMET visibility.
function removeScrubAirmetEntities() {
  for (const entity of _scrubAirmetEntities) {
    viewer.entities.remove(entity);
  }
  _scrubAirmetEntities.length = 0;
  // Restore live AIRMET entity visibility
  for (const entity of airmetEntities) entity.show = true;
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
  removeScrubAirmetEntities();
  CONFIG.airmetsEnabled = false;
  if (airmetRefreshTimer) {
    clearInterval(airmetRefreshTimer);
    airmetRefreshTimer = null;
  }
  console.log('[Weather] AIRMETs disabled');
}

// ============================================================
// Altitude-Aware Weather Filtering
// ============================================================

// Altitude filter tolerance: weather is relevant within ±50 flight levels (5,000 ft).
window.ALT_FILTER_TOLERANCE_FL = 50;

// Parse various altitude representations to a flight level number (hundreds of feet).
// Handles: numeric values, "SFC"/"SURFACE" → 0, "FL350" → 350, "?" → null.
function parseAltToFL(value) {
  if (value == null || value === '?' || value === '') return null;
  if (typeof value === 'number') return value;
  const s = String(value).trim().toUpperCase();
  if (s === 'SFC' || s === 'SURFACE') return 0;
  if (s.startsWith('FL')) {
    const n = parseInt(s.substring(2), 10);
    return isNaN(n) ? null : n;
  }
  const n = parseInt(s, 10);
  return isNaN(n) ? null : n;
}

// Single function that determines if a weather entity is valid for a given time and altitude.
// timeMs: null = skip time check; altitudeFL: null = skip altitude check.
function isWeatherEntityVisible(entity, timeMs, altitudeFL) {
  const p = entity.properties;
  if (!p) return true;

  // --- Time check ---
  if (timeMs != null) {
    const type = p.turbType ? p.turbType.getValue() : null;
    if (type === 'PIREP') {
      const isoStr = p.obsTimeISO ? p.obsTimeISO.getValue() : null;
      if (isoStr) {
        const obsMs = new Date(isoStr).getTime();
        if (!isNaN(obsMs) && (obsMs > timeMs || timeMs - obsMs > PIREP_MAX_AGE_MS)) return false;
      }
    } else if (type === 'G-AIRMET') {
      // G-AIRMETs are point-in-time snapshots — handled by _filterNearestAirmetSnapshot
      // so skip per-entity time filtering here (let the snapshot filter decide)
    } else {
      const from = p.validFrom ? p.validFrom.getValue() : null;
      const to = p.validTo ? p.validTo.getValue() : null;
      if (from && to && from !== '?' && to !== '?') {
        const fromMs = new Date(from).getTime();
        const toMs = new Date(to).getTime();
        if (!isNaN(fromMs) && !isNaN(toMs) && (timeMs < fromMs || timeMs > toMs)) return false;
      }
    }
  }

  // --- Altitude check ---
  if (altitudeFL != null) {
    const type = p.turbType ? p.turbType.getValue() : null;
    if (type === 'PIREP') {
      const fl = p.fltlvl ? parseAltToFL(p.fltlvl.getValue()) : null;
      if (fl != null && Math.abs(fl - altitudeFL) > ALT_FILTER_TOLERANCE_FL) return false;
    } else if (type === 'SIGMET' || type === 'CONVECTIVE SIGMET' || type === 'G-AIRMET') {
      const baseFL = p.base ? parseAltToFL(p.base.getValue()) : null;
      const topFL = p.top ? parseAltToFL(p.top.getValue()) : null;
      if (baseFL != null || topFL != null) {
        if (baseFL != null && topFL != null) {
          if (altitudeFL < baseFL - ALT_FILTER_TOLERANCE_FL || altitudeFL > topFL + ALT_FILTER_TOLERANCE_FL) return false;
        } else if (topFL != null) {
          if (altitudeFL > topFL + ALT_FILTER_TOLERANCE_FL) return false;
        } else {
          if (altitudeFL < baseFL - ALT_FILTER_TOLERANCE_FL) return false;
        }
      }
    }
  }

  return true;
}

// Apply visibility filter to all weather entity arrays.
// timeMs: null = skip time check; altitudeFL: null = skip altitude check.
function filterAllWeather(timeMs, altitudeFL) {
  for (const entity of pirepEntities) {
    entity.show = isWeatherEntityVisible(entity, timeMs, altitudeFL);
  }
  for (const entity of sigmetEntities) {
    entity.show = isWeatherEntityVisible(entity, timeMs, altitudeFL);
  }
  const airmetArr = _scrubAirmetEntities.length > 0 ? _scrubAirmetEntities : airmetEntities;
  _filterNearestAirmetSnapshot(airmetArr, timeMs, altitudeFL);
}

// For G-AIRMET entities (point-in-time snapshots), show only entities from the
// snapshot whose validTime is closest to timeMs. Then apply altitude filtering.
function _filterNearestAirmetSnapshot(entities, timeMs, altitudeFL) {
  if (entities.length === 0) return;
  if (timeMs == null) {
    // No time constraint — show all, just apply altitude filter
    for (const e of entities) e.show = isWeatherEntityVisible(e, null, altitudeFL);
    return;
  }
  // Group entities by validFrom and find the nearest snapshot
  const byTime = new Map();
  for (const e of entities) {
    const vf = e.properties && e.properties.validFrom ? e.properties.validFrom.getValue() : null;
    if (!byTime.has(vf)) byTime.set(vf, []);
    byTime.get(vf).push(e);
  }
  let bestKey = null;
  let bestDist = Infinity;
  for (const key of byTime.keys()) {
    if (!key || key === '?') continue;
    const ms = new Date(key).getTime();
    if (isNaN(ms)) continue;
    const dist = Math.abs(ms - timeMs);
    if (dist < bestDist) { bestDist = dist; bestKey = key; }
  }
  for (const [key, ents] of byTime) {
    const isNearest = key === bestKey;
    for (const e of ents) {
      e.show = isNearest && isWeatherEntityVisible(e, null, altitudeFL);
    }
  }
}

// Get the selected aircraft's altitude as a flight level (hundreds of feet).
// Returns null if no selected aircraft or altitude unknown.
function getSelectedAircraftFL() {
  if (!selectedIcao) return null;
  const ac = aircraft.get(selectedIcao);
  if (!ac) return null;
  const altMeters = ac.lastKnownAlt || (ac.state && ac.state.altitude);
  if (!altMeters || altMeters <= 0) return null;
  return Math.round(altMeters / 0.3048 / 100);
}

// Apply altitude filter in live mode based on selected aircraft's current altitude.
// Called after aircraft poll updates, weather refreshes, and selection changes.
// force: if true, always re-filter (use after new weather entities are fetched).
window._lastLiveFilterFL = null;
function updateLiveAltitudeFilter(force) {
  // Don't interfere with scrubbing mode
  if (timelineTime !== null) return;

  const altFL = getSelectedAircraftFL();

  if (altFL == null) {
    // No selected aircraft or unknown altitude — show all weather
    if (_lastLiveFilterFL !== null) {
      _lastLiveFilterFL = null;
      filterAllWeather(null, null);
    }
    return;
  }

  // Only re-filter if altitude changed significantly (≥10 FL / 1,000 ft) or forced
  const altChanged = _lastLiveFilterFL == null || Math.abs(altFL - _lastLiveFilterFL) >= 10;
  if (!force && !altChanged) return;

  _lastLiveFilterFL = altFL;
  filterAllWeather(null, altFL);

  // Update turb forecast level only when altitude changed significantly
  if (altChanged) updateLiveTurbLevel(altFL);
}

// Snap a flight level to the nearest available GTG turbulence forecast level.
function computeTurbLevelForFL(fl) {
  let closest = TURB_LEVELS[0];
  let minDiff = Math.abs(fl - closest);
  for (const level of TURB_LEVELS) {
    const diff = Math.abs(fl - level);
    if (diff < minDiff) { minDiff = diff; closest = level; }
  }
  return String(closest);
}

// Update the turbulence forecast layer level based on live altitude.
function updateLiveTurbLevel(altFL) {
  if (!CONFIG.turbForecastEnabled) return;
  const newLevel = computeTurbLevelForFL(altFL);
  if (newLevel !== CONFIG.turbulenceLevel) {
    CONFIG.turbulenceLevel = newLevel;
    clearTurbCache();
    disableTurbForecast();
    enableTurbForecast();
    console.log(`[Weather] Turb level updated to ${newLevel} for live altitude FL${altFL}`);
  }
}

// ============================================================
// Pause / Resume Weather Refresh Timers (for timeline scrubbing)
// ============================================================

// Pause all weather refresh timers without touching CONFIG flags or entities/layers.
// Called when entering scrubbing mode so background refreshes don't add unfiltered data.
function pauseWeatherRefresh() {
  if (pirepRefreshTimer) { clearInterval(pirepRefreshTimer); pirepRefreshTimer = null; }
  if (sigmetRefreshTimer) { clearInterval(sigmetRefreshTimer); sigmetRefreshTimer = null; }
  if (airmetRefreshTimer) { clearInterval(airmetRefreshTimer); airmetRefreshTimer = null; }
  if (turbRefreshTimer) { clearInterval(turbRefreshTimer); turbRefreshTimer = null; }
  if (radarRefreshTimer) { clearInterval(radarRefreshTimer); radarRefreshTimer = null; }
  if (satelliteIRRefreshTimer) { clearInterval(satelliteIRRefreshTimer); satelliteIRRefreshTimer = null; }
  console.log('[Weather] Refresh timers paused');
}

// Restart refresh timers for any currently-enabled overlay.
// Called when returning to live mode or closing the timeline.
function resumeWeatherRefresh() {
  if (CONFIG.pirepsEnabled && !pirepRefreshTimer) {
    pirepRefreshTimer = setInterval(() => { removePirepEntities(); fetchPireps(); }, 5 * 60 * 1000);
  }
  if (CONFIG.sigmetsEnabled && !sigmetRefreshTimer) {
    sigmetRefreshTimer = setInterval(() => { removeSigmetEntities(); fetchSigmets(); }, 5 * 60 * 1000);
  }
  if (CONFIG.airmetsEnabled && !airmetRefreshTimer) {
    airmetRefreshTimer = setInterval(() => { removeAirmetEntities(); fetchAirmets(); }, 5 * 60 * 1000);
  }
  if (CONFIG.turbForecastEnabled && !turbRefreshTimer) {
    turbRefreshTimer = setInterval(refreshTurbForecast, 15 * 60 * 1000);
  }
  if (CONFIG.radarEnabled && !radarRefreshTimer) {
    radarRefreshTimer = setInterval(refreshRadar, 5 * 60 * 1000);
  }
  if (CONFIG.satelliteIREnabled && !satelliteIRRefreshTimer) {
    satelliteIRRefreshTimer = setInterval(refreshSatelliteIR, 10 * 60 * 1000);
  }
  console.log('[Weather] Refresh timers resumed');
}

// GTG forecast dropdown: heatmap imagery layer (independent of TURB toggle)
function enableTurbForecast() {
  if (CONFIG.turb3D) {
    if (turb3dEntities.length > 0) return;
    addTurb3DLayers();
  } else {
    if (turbLayer) return;
    addTurbLayer();
  }
  console.log(`[Weather] GTG forecast enabled: ${CONFIG.turbulenceLevel} (3D: ${CONFIG.turb3D})`);
  if (turbRefreshTimer) clearInterval(turbRefreshTimer);
  turbRefreshTimer = setInterval(refreshTurbForecast, 15 * 60 * 1000);
}

function disableTurbForecast() {
  removeTurbLayer();
  removeTurb3DLayers();
  if (turbRefreshTimer) {
    clearInterval(turbRefreshTimer);
    turbRefreshTimer = null;
  }
  console.log('[Weather] GTG forecast disabled');
}

function refreshTurbForecast() {
  if (CONFIG.turbulenceLevel === 'none') return;
  // During timeline scrubbing with preloaded cache, skip network refresh
  if (_turbTimelineDate != null && _turbImageCache.size > 0) return;
  // Respect timeline scrub position if active
  const dateSecs = _turbTimelineDate != null ? _turbTimelineDate : undefined;
  if (CONFIG.turb3D) {
    removeTurb3DLayers();
    addTurb3DLayers(dateSecs);
  } else {
    addTurbLayer(dateSecs);
  }
  console.log('[Weather] GTG forecast refreshed');
}

// Compute the best turbulence forecast level based on the active flight plan.
// If a flight plan with a filed altitude exists, snap to the nearest available FL.
// Otherwise default to 'maxa' (MAX HI).
// Only levels that the AWC GTG API actually serves (others return 204 No Content).
window.TURB_LEVELS = [180, 210, 240, 270, 300, 360, 420];

function computeTurbLevel() {
  if (activeFlightPlan) {
    const flights = activeFlightPlan.flights || [];
    const flight = flights.length > 0 ? pickBestFlight(flights) : null;
    if (flight && flight.filed_altitude != null) {
      return computeTurbLevelForFL(flight.filed_altitude);
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
    clearTurbCache(); // Invalidate cache — images are for the old altitude level
    disableTurbForecast();
    enableTurbForecast();
    console.log(`[Weather] Turb level auto-updated to ${newLevel}`);
  }
}

// ============================================================
// Timeline Turbulence Forecast Management
// ============================================================

// Preload interval: 1 hour in seconds.  Covers the flight's time span with
// one image per hour — at most ~19 images for an 18-hour flight (~1.6 MB).
window.TURB_PRELOAD_INTERVAL = 3600;

window._turbTimelineDate = null;  // current forecast date (Unix secs) being displayed (null = live)
window._turbAddGen = 0;           // generation counter — cancels in-flight async addTurbLayer() calls

// Update the turb forecast layer for a given scrubbed time.
// Finds the nearest preloaded timestamp and applies it from cache instantly.
function updateTurbForTimelineTime(timeMs) {
  if (!CONFIG.turbForecastEnabled) return;

  // Convert slider time to Unix seconds, snapped to the preload grid
  const dateSecs = Math.round(timeMs / 1000 / TURB_PRELOAD_INTERVAL) * TURB_PRELOAD_INTERVAL;

  // Already showing this time — skip
  if (dateSecs === _turbTimelineDate) return;

  // Find the nearest cached timestamp (handles grid misalignment)
  let bestDate = dateSecs;
  if (_turbImageCache.size > 0) {
    let minDiff = Infinity;
    for (const cachedDate of _turbImageCache.keys()) {
      const diff = Math.abs(dateSecs - cachedDate);
      if (diff < minDiff) { minDiff = diff; bestDate = cachedDate; }
    }
  }

  // Still showing the same cached image — skip
  if (bestDate === _turbTimelineDate) return;
  _turbTimelineDate = bestDate;

  console.log(`[Weather] Timeline: switching GTG to date=${bestDate}`);

  // Try preloaded cache first (instant)
  if (applyTurbFromCache(bestDate)) return;

  // Cache miss — fall back to network fetch (addTurbLayer handles old layer removal)
  addTurbLayer(bestDate);
}

// Restore turb forecast to live/current when leaving scrub mode.
function resetTurbToLive() {
  if (_turbTimelineDate != null) {
    console.log('[Weather] Timeline: restoring GTG to live');
    _turbTimelineDate = null;
    if (CONFIG.turbForecastEnabled) {
      if (CONFIG.turb3D) {
        removeTurb3DLayers();
        addTurb3DLayers();
      } else {
        addTurbLayer();
      }
    } else {
      removeTurbLayer();
      removeTurb3DLayers();
    }
  }
  _turbTimelineDate = null;
}

// ============================================================
// GTG Turbulence Image Cache for Timeline Scrubbing
// ============================================================

// Cache of pre-fetched and reprojected GTG images keyed by Unix timestamp.
// Stores data URL strings so fresh providers can be created instantly.
window._turbImageCache = new Map(); // Map<number, string> (dateSecs → dataURL)

// Decoded pixel data cache for scrubbing bar color sampling.
// Populated after preloading completes.
window._turbPixelCache = new Map(); // Map<number, ImageData> (dateSecs → ImageData)

// Decode a data URL into an ImageData object for pixel sampling.
async function decodeDataUrlToImageData(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      resolve(ctx.getImageData(0, 0, img.width, img.height));
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

// Sample the turbulence heatmap color (as a CSS rgb() string) at a geographic
// position and time.  Returns null if the location is outside the image bounds
// or falls on a transparent pixel (no significant turbulence).
function getTurbPixelColor(lon, lat, dateSecs) {
  if (_turbPixelCache.size === 0) return null;
  // Outside the geographic coverage of the GTG image
  if (lon < TURB_CROP_LON || lon > TURB_LON_EAST || lat < TURB_LAT_SOUTH || lat > TURB_LAT_NORTH) return null;

  // Find nearest cached time
  let bestDate = null;
  let minDiff = Infinity;
  for (const cachedDate of _turbPixelCache.keys()) {
    const diff = Math.abs(dateSecs - cachedDate);
    if (diff < minDiff) { minDiff = diff; bestDate = cachedDate; }
  }
  if (bestDate === null) return null;

  const imageData = _turbPixelCache.get(bestDate);
  if (!imageData) return null;

  // Map geographic coordinates to pixel coordinates
  const lonFrac = (lon - TURB_CROP_LON) / (TURB_LON_EAST - TURB_CROP_LON);
  const latFrac = (lat - TURB_LAT_SOUTH) / (TURB_LAT_NORTH - TURB_LAT_SOUTH);
  const px = Math.round(Math.max(0, Math.min(imageData.width - 1, lonFrac * (imageData.width - 1))));
  const py = Math.round(Math.max(0, Math.min(imageData.height - 1, (1 - latFrac) * (imageData.height - 1))));

  const idx = (py * imageData.width + px) * 4;
  const r = imageData.data[idx];
  const g = imageData.data[idx + 1];
  const b = imageData.data[idx + 2];
  const a = imageData.data[idx + 3];

  if (a < 10) return null; // Transparent = no significant turbulence
  return `rgb(${r},${g},${b})`;
}

// Preload all GTG turbulence images needed for a flight's time span.
// Called from showTimeline() in radar-timeline.js.
// Always runs regardless of CONFIG.turbForecastEnabled so the scrubbing bar
// gradient is always available.  Uses CONFIG.turbulenceLevel when the overlay is
// enabled, or auto-selects the best level via computeTurbLevel() otherwise.
// onComplete (optional): called once all images are preloaded and pixel data is decoded.
async function preloadTurbForTimeline(depMs, arrMs, onComplete) {
  // Determine the flight level to fetch — prefer the user's chosen level when
  // the overlay is enabled, otherwise auto-select from the filed altitude.
  const level = (CONFIG.turbForecastEnabled && CONFIG.turbulenceLevel !== 'none')
    ? CONFIG.turbulenceLevel
    : computeTurbLevel();
  if (level === 'none') return;

  clearTurbCache();

  // Compute timestamps at 1-hour intervals covering dep → arr
  const depSecs = Math.floor(depMs / 1000 / TURB_PRELOAD_INTERVAL) * TURB_PRELOAD_INTERVAL;
  const arrSecs = Math.ceil(arrMs / 1000 / TURB_PRELOAD_INTERVAL) * TURB_PRELOAD_INTERVAL;
  const timestamps = [];
  for (let t = depSecs; t <= arrSecs; t += TURB_PRELOAD_INTERVAL) {
    timestamps.push(t);
  }

  console.log(`[Weather] Preloading ${timestamps.length} GTG images (dep→arr) at level=${level}`);

  // Build fallback levels list (same logic as addTurbLayer)
  const levelsToTry = [level];
  if (level !== 'maxa') {
    const primaryNum = parseInt(level, 10);
    const sorted = TURB_LEVELS
      .filter(l => l !== primaryNum)
      .sort((a, b) => Math.abs(a - primaryNum) - Math.abs(b - primaryNum));
    for (const l of sorted.slice(0, 4)) {
      levelsToTry.push(String(l));
    }
  }

  // Fetch all images in parallel
  const promises = timestamps.map(async (dateSecs) => {
    for (const lvl of levelsToTry) {
      const dataUrl = await fetchTurbImageDataUrl(lvl, dateSecs);
      if (dataUrl) {
        _turbImageCache.set(dateSecs, dataUrl);
        return;
      }
    }
  });

  await Promise.all(promises);
  console.log(`[Weather] Preloaded ${_turbImageCache.size}/${timestamps.length} GTG images`);

  // Decode pixel data for scrubbing bar color gradient
  _turbPixelCache.clear();
  await Promise.all(
    Array.from(_turbImageCache.entries()).map(async ([dateSecs, dataUrl]) => {
      const imageData = await decodeDataUrlToImageData(dataUrl);
      if (imageData) _turbPixelCache.set(dateSecs, imageData);
    })
  );
  console.log(`[Weather] Pixel data decoded for ${_turbPixelCache.size} GTG images`);

  if (typeof onComplete === 'function') onComplete();
}

function clearTurbCache() {
  _turbImageCache.clear();
  _turbPixelCache.clear();
}

// Apply a cached GTG image to the viewer as an imagery layer (instant, no fetch).
// Returns true if cache hit, false if cache miss.
function applyTurbFromCache(dateSecs) {
  if (!CONFIG.turbForecastEnabled) return false;
  if (CONFIG.turb3D) return false; // 3D mode doesn't use cached flat imagery
  const dataUrl = _turbImageCache.get(dateSecs);
  if (!dataUrl) return false;

  const oldLayer = turbLayer;
  _turbAddGen++; // Cancel any in-flight async addTurbLayer()
  const provider = createTurbProviderFromDataUrl(dataUrl);
  if (radarLayer) {
    const radarIdx = viewer.imageryLayers.indexOf(radarLayer);
    turbLayer = viewer.imageryLayers.addImageryProvider(provider, radarIdx);
  } else {
    turbLayer = viewer.imageryLayers.addImageryProvider(provider);
  }
  turbLayer.alpha = CONFIG.weatherOverlayOpacity / 100;
  // Remove old layer AFTER adding new one to avoid flash
  if (oldLayer) {
    viewer.imageryLayers.remove(oldLayer);
  }
  return true;
}

window.FilteredRadarImageryProvider = FilteredRadarImageryProvider;
window.makeSatelliteIRProvider = makeSatelliteIRProvider;
window.addSatelliteIRLayer = addSatelliteIRLayer;
window.enableSatelliteIR = enableSatelliteIR;
window.disableSatelliteIR = disableSatelliteIR;
window.refreshSatelliteIR = refreshSatelliteIR;
window.makeRadarProvider = makeRadarProvider;
window.enableRadar = enableRadar;
window.disableRadar = disableRadar;
window.refreshRadar = refreshRadar;
window.awcUrl = awcUrl;
window.geoLatToMercY = geoLatToMercY;
window.fetchTurbImageDataUrl = fetchTurbImageDataUrl;
window.createTurbProviderFromDataUrl = createTurbProviderFromDataUrl;
window.makeTurbProvider = makeTurbProvider;
window.addTurbLayer = addTurbLayer;
window.removeTurbLayer = removeTurbLayer;
window.addTurb3DLayers = addTurb3DLayers;
window.removeTurb3DLayers = removeTurb3DLayers;
// Update all weather entity altitudes in place when exaggeration changes (no refetch).
function updateWeatherAltitudes() {
  // PIREPs — reposition using stored fltlvl
  for (const entity of pirepEntities) {
    const p = entity.properties;
    if (!p || !p.fltlvl) continue;
    const fl = parseAltToFL(p.fltlvl.getValue());
    if (fl == null) continue;
    const altMeters = fl * 100 * 0.3048;
    const carto = Cesium.Cartographic.fromCartesian(entity.position.getValue(Cesium.JulianDate.now()));
    entity.position = Cesium.Cartesian3.fromRadians(carto.longitude, carto.latitude, exAlt(altMeters));
  }
  // SIGMETs — update polygon height/extrudedHeight (values are in feet, not FL)
  for (const entity of sigmetEntities) {
    const p = entity.properties;
    if (!p) continue;
    const baseFt = p.base ? Number(p.base.getValue()) : NaN;
    const topFt = p.top ? Number(p.top.getValue()) : NaN;
    entity.polygon.height = !isNaN(baseFt) ? exAlt(baseFt * 0.3048) : 0;
    entity.polygon.extrudedHeight = !isNaN(topFt) ? exAlt(topFt * 0.3048) : exAlt(60000 * 0.3048);
  }
  // AIRMETs (live + scrub)
  const allAirmets = airmetEntities.concat(_scrubAirmetEntities);
  for (const entity of allAirmets) {
    const p = entity.properties;
    if (!p) continue;
    const baseFL = p.base ? parseAltToFL(p.base.getValue()) : null;
    const topFL = p.top ? parseAltToFL(p.top.getValue()) : null;
    entity.polygon.height = baseFL != null ? exAlt(baseFL * 100 * 0.3048) : 0;
    entity.polygon.extrudedHeight = topFL != null ? exAlt(topFL * 100 * 0.3048) : exAlt(60000 * 0.3048);
  }
}

// Toggle outline edges on SIGMET/AIRMET volume polygons to match CONFIG.airspaceEdges.
function updateWeatherEdges() {
  const edgesOn = CONFIG.airspaceEdges;
  for (const entity of sigmetEntities) {
    if (!entity.polygon) continue;
    entity.polygon.outline = edgesOn;
    if (edgesOn) {
      const p = entity.properties;
      const hazard = p && p.hazard ? p.hazard.getValue() : 'TURB';
      const isConvective = hazard === 'CONVECTIVE' || hazard === 'TS';
      entity.polygon.outlineColor = isConvective
        ? new Cesium.Color(1.0, 0.85, 0.0, 0.6)
        : new Cesium.Color(1.0, 0.0, 0.0, 0.6);
      entity.polygon.outlineWidth = 1;
    }
  }
  const allAirmets = airmetEntities.concat(_scrubAirmetEntities);
  for (const entity of allAirmets) {
    if (!entity.polygon) continue;
    entity.polygon.outline = edgesOn;
    if (edgesOn) {
      entity.polygon.outlineColor = new Cesium.Color(1.0, 0.5, 0.0, 0.7);
      entity.polygon.outlineWidth = 1;
    }
  }
}

window.updateWeatherEdges = updateWeatherEdges;
window.updateWeatherAltitudes = updateWeatherAltitudes;
window.removePirepEntities = removePirepEntities;
window.removeSigmetEntities = removeSigmetEntities;
window.removeAirmetEntities = removeAirmetEntities;
window.pirepCssColor = pirepCssColor;
window.fetchPireps = fetchPireps;
window.fetchSigmets = fetchSigmets;
window._buildAirmetEntities = _buildAirmetEntities;
window.fetchAirmets = fetchAirmets;
window.fetchAirmetsForScrubbing = fetchAirmetsForScrubbing;
window.removeScrubAirmetEntities = removeScrubAirmetEntities;
window.enablePireps = enablePireps;
window.disablePireps = disablePireps;
window.enableSigmets = enableSigmets;
window.disableSigmets = disableSigmets;
window.enableAirmets = enableAirmets;
window.disableAirmets = disableAirmets;
window.parseAltToFL = parseAltToFL;
window.isWeatherEntityVisible = isWeatherEntityVisible;
window.filterAllWeather = filterAllWeather;
window.getSelectedAircraftFL = getSelectedAircraftFL;
window.updateLiveAltitudeFilter = updateLiveAltitudeFilter;
window.computeTurbLevelForFL = computeTurbLevelForFL;
window.updateLiveTurbLevel = updateLiveTurbLevel;
window.pauseWeatherRefresh = pauseWeatherRefresh;
window.resumeWeatherRefresh = resumeWeatherRefresh;
window.enableTurbForecast = enableTurbForecast;
window.disableTurbForecast = disableTurbForecast;
window.refreshTurbForecast = refreshTurbForecast;
window.computeTurbLevel = computeTurbLevel;
window.refreshTurbLevel = refreshTurbLevel;
window.updateTurbForTimelineTime = updateTurbForTimelineTime;
window.resetTurbToLive = resetTurbToLive;
window.decodeDataUrlToImageData = decodeDataUrlToImageData;
window.getTurbPixelColor = getTurbPixelColor;
window.preloadTurbForTimeline = preloadTurbForTimeline;
window.clearTurbCache = clearTurbCache;
window.applyTurbFromCache = applyTurbFromCache;

export {};
