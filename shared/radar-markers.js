// Map markers: airports, airspace boundaries, waypoints, and navaids.
// Depends on radar-core.js (viewer, CONFIG, state variables).

// ============================================================
// Airport Delay Functions (shared by markers, flight plan, timeline)
// ============================================================

// Compute a Cesium.Color for a delay duration in minutes.
// 0 min → null (no delay), ~15 min → orange, 30+ min → red.
function delayColor(delayMinutes) {
  if (!delayMinutes || delayMinutes <= 0) return null;
  const t = Math.min(delayMinutes / 45, 1);
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

// Parse FAA duration text like "2 hours and 57 minutes" or "15 minutes" → minutes
function parseDelayDuration(text) {
  if (!text) return 0;
  let mins = 0;
  const hourMatch = text.match(/(\d+)\s*hour/);
  const minMatch = text.match(/(\d+)\s*minute/);
  if (hourMatch) mins += parseInt(hourMatch[1], 10) * 60;
  if (minMatch) mins += parseInt(minMatch[1], 10);
  return mins;
}

// Build IATA→ICAO lookup from cached airport data
function buildIataToIcaoMap() {
  const map = new Map();
  if (!cachedAirportData) return map;
  for (const ap of cachedAirportData) {
    if (ap.iata && ap.icao) {
      map.set(ap.iata.toUpperCase(), ap.icao.toUpperCase());
    }
  }
  return map;
}

// Parse FAA NASSTATUS XML into the delay cache
function parseFAADelayXML(xmlString) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlString, 'application/xml');
  const delays = new Map(); // IATA → { minutes, type, reason, details[] }
  const iataToIcao = buildIataToIcaoMap();

  function addDelay(iata, entry) {
    iata = (iata || '').toUpperCase();
    if (!iata) return;
    const existing = delays.get(iata);
    if (!existing || entry.minutes > existing.minutes) {
      delays.set(iata, { ...entry, details: existing ? [...existing.details, ...entry.details] : entry.details });
    } else {
      existing.details.push(...entry.details);
    }
  }

  // Ground Stop Programs
  for (const prog of doc.querySelectorAll('Ground_Stop_List > Program')) {
    const iata = prog.querySelector('ARPT')?.textContent?.trim();
    const reason = prog.querySelector('Reason')?.textContent?.trim() || '';
    const endTime = prog.querySelector('End_Time')?.textContent?.trim() || '';
    addDelay(iata, {
      minutes: 60, // Ground stops are severe — use high value for coloring
      type: 'Ground Stop',
      reason,
      details: [{ type: 'Ground Stop', reason, endTime }],
    });
  }

  // Ground Delay Programs
  for (const gd of doc.querySelectorAll('Ground_Delay_List > Ground_Delay')) {
    const iata = gd.querySelector('ARPT')?.textContent?.trim();
    const reason = gd.querySelector('Reason')?.textContent?.trim() || '';
    const avg = gd.querySelector('Avg')?.textContent?.trim() || '';
    const max = gd.querySelector('Max')?.textContent?.trim() || '';
    const avgMins = parseDelayDuration(avg);
    const maxMins = parseDelayDuration(max);
    addDelay(iata, {
      minutes: avgMins || maxMins || 30,
      type: 'Ground Delay',
      reason,
      details: [{ type: 'Ground Delay', reason, avg, max, avgMins, maxMins }],
    });
  }

  // General Arrival/Departure Delays
  for (const d of doc.querySelectorAll('Arrival_Departure_Delay_List > Delay')) {
    const iata = d.querySelector('ARPT')?.textContent?.trim();
    const reason = d.querySelector('Reason')?.textContent?.trim() || '';
    const ad = d.querySelector('Arrival_Departure');
    const adType = ad?.getAttribute('Type') || '';
    const min = ad?.querySelector('Min')?.textContent?.trim() || '';
    const max = ad?.querySelector('Max')?.textContent?.trim() || '';
    const trend = ad?.querySelector('Trend')?.textContent?.trim() || '';
    const maxMins = parseDelayDuration(max);
    const minMins = parseDelayDuration(min);
    addDelay(iata, {
      minutes: maxMins || minMins || 15,
      type: `${adType} Delay`,
      reason,
      details: [{ type: `${adType} Delay`, reason, min, max, minMins, maxMins, trend }],
    });
  }

  // Airport Closures (skip NOTAMs that only restrict GA/non-sched traffic)
  for (const ap of doc.querySelectorAll('Airport_Closure_List > Airport')) {
    const iata = ap.querySelector('ARPT')?.textContent?.trim();
    const reason = ap.querySelector('Reason')?.textContent?.trim() || '';
    const start = ap.querySelector('Start')?.textContent?.trim() || '';
    const reopen = ap.querySelector('Reopen')?.textContent?.trim() || '';
    // Skip partial closures (NOTAMs restricting only non-sched/GA traffic)
    if (reason.includes('NON SKED') || reason.includes('NON-SKED')) continue;
    addDelay(iata, {
      minutes: 90, // Full closure is the most severe
      type: 'Closure',
      reason,
      details: [{ type: 'Closure', reason, start, reopen }],
    });
  }

  // Build final cache keyed by both IATA and ICAO
  airportDelayCache.clear();
  for (const [iata, info] of delays) {
    airportDelayCache.set(iata, info);
    const icao = iataToIcao.get(iata);
    if (icao) airportDelayCache.set(icao, info);
  }

  console.log(`[Delays] Parsed ${delays.size} airports with active delays`);
  return delays;
}

// Fetch all airport delays from FAA NASSTATUS and update cache + markers
async function fetchAllAirportDelays() {
  if (!CONFIG.airportDelaysEnabled) return;
  if (!window.flightAPI || !window.flightAPI.getSystemDelays) {
    console.warn('[Delays] getSystemDelays not available');
    return;
  }

  try {
    console.log('[Delays] Fetching FAA system-wide delays...');
    const result = await window.flightAPI.getSystemDelays();
    if (result.error) {
      console.warn('[Delays] FAA fetch error:', result.error);
      return;
    }
    if (!result.xml) {
      console.warn('[Delays] No XML data received');
      return;
    }
    parseFAADelayXML(result.xml);
    applyDelayColorsToAirports();
  } catch (err) {
    console.error('[Delays] Fetch error:', err);
  }
}

// Look up worst delay minutes for an airport from the cache.
// Accepts IATA or ICAO code. Returns 0 if no delays or setting disabled.
function getAirportDelayMinutes(code) {
  if (!CONFIG.airportDelaysEnabled || !code) return 0;
  const info = airportDelayCache.get(code.toUpperCase());
  return info ? info.minutes : 0;
}

// Look up full delay info for an airport from cache. Returns null if none.
function getAirportDelayInfo(code) {
  if (!CONFIG.airportDelaysEnabled || !code) return null;
  return airportDelayCache.get(code.toUpperCase()) || null;
}

// Apply delay colors to all airport marker entities
function applyDelayColorsToAirports() {
  if (!CONFIG.airportDelaysEnabled) return;
  const defaultColor = getAirportColor();
  for (const entity of airportEntities) {
    const icao = entity.properties?.icao?.getValue?.() || '';
    const iata = entity.properties?.iata?.getValue?.() || '';
    const mins = getAirportDelayMinutes(icao) || getAirportDelayMinutes(iata);
    const color = mins > 0 ? delayColor(mins) : defaultColor;
    entity.point.color = color;
  }
}

// Reset all airport marker colors to default (when delays disabled)
function resetAirportDelayColors() {
  const defaultColor = getAirportColor();
  for (const entity of airportEntities) {
    entity.point.color = defaultColor;
  }
}

// ============================================================
// Airport Markers
// ============================================================

function getAirportColor() {
  if (CONFIG.theme === 'light') {
    return Cesium.Color.WHITE;
  }
  return Cesium.Color.fromCssColorString('#010101');
}

function getAirportOutlineColor() {
  if (CONFIG.theme === 'light') {
    return Cesium.Color.fromCssColorString('#999999');
  }
  return Cesium.Color.fromCssColorString('#333333');
}

function getAirportOutlineWidth() {
  return CONFIG.theme === 'light' ? 1 : 1;
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
  const pointOutlineColor = getAirportOutlineColor();
  const pointOutlineWidth = getAirportOutlineWidth();
  const labelColor = getAirportLabelColor();

  for (const ap of airports) {
    if (ap.type === 'S') continue;
    const isLarge = ap.type === 'L';
    const label = ap.iata || ap.icao;
    const labelRange = isLarge ? 800000 : 300000;
    const dotSize = isLarge ? 10 : 6;

    // Scale dots down with distance: full size at 100km, 3px at CONUS (~6000km)
    const farScale = 3 / dotSize;
    const dotScale = new Cesium.NearFarScalar(1e5, 1.0, 6e6, farScale);

    const entity = viewer.entities.add({
      id: `apt-${ap.icao}`,
      // Slight altitude keeps dots above the globe surface at oblique angles
      position: Cesium.Cartesian3.fromDegrees(ap.lon, ap.lat, 10),
      point: {
        pixelSize: dotSize,
        color: pointColor,
        outlineColor: pointOutlineColor,
        outlineWidth: pointOutlineWidth,
        scaleByDistance: dotScale,
      },
      label: {
        text: label,
        font: labelFont(CONFIG.fontSize),
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
      properties: {
        icao: ap.icao,
        iata: ap.iata || '',
        name: ap.name || '',
        type: ap.type,
        lat: ap.lat,
        lon: ap.lon,
      },
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
  const pointOutlineColor = getAirportOutlineColor();
  const pointOutlineWidth = getAirportOutlineWidth();
  const labelColor = getAirportLabelColor();
  const outlineColor = CONFIG.theme === 'light' ? Cesium.Color.WHITE : Cesium.Color.BLACK;
  for (const entity of airportEntities) {
    entity.point.color = pointColor;
    entity.point.outlineColor = pointOutlineColor;
    entity.point.outlineWidth = pointOutlineWidth;
    entity.label.fillColor = labelColor;
    entity.label.outlineColor = outlineColor;
  }
  // Re-apply delay colors on top if enabled
  if (CONFIG.airportDelaysEnabled && airportDelayCache.size > 0) {
    applyDelayColorsToAirports();
  }
}

// ============================================================
// Airspace Boundaries (Class B / C / D)
// ============================================================

window.FT_TO_M = 0.3048;

window.AIRSPACE_COLORS = {
  B: { fill: new Cesium.Color(0.27, 0.51, 0.97, 0.15),  outline: new Cesium.Color(0.27, 0.51, 0.97, 1.0) },  // blue
  C: { fill: new Cesium.Color(1.0, 0.0, 1.0, 0.15),    outline: new Cesium.Color(1.0, 0.0, 1.0, 1.0) },     // magenta
  D: { fill: new Cesium.Color(0.53, 0.81, 0.98, 0.15), outline: new Cesium.Color(0.53, 0.81, 0.98, 1.0) },  // light blue
};

window.airspaceData = null; // cached for rebuild on 3D toggle

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
          height: exAlt(floorM),
          extrudedHeight: exAlt(ceilM),
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

// Lightweight altitude update for 3D airspace — adjusts height/extrudedHeight
// without destroying entities. No-op when airspace is 2D (flat).
function updateAirspaceAltitudes() {
  if (!CONFIG.airspace3D || !airspaceData) return;
  let i = 0;
  for (const entry of airspaceData) {
    const colors = AIRSPACE_COLORS[entry.cls];
    if (!colors || !entry.coords || entry.coords.length < 3) continue;
    if (i >= airspaceEntities.length) break;
    const entity = airspaceEntities[i];
    i++;
    const hasAltData = entry.ceil != null && entry.floor != null;
    if (hasAltData && entity.polygon) {
      entity.polygon.height = exAlt(entry.floor * FT_TO_M);
      entity.polygon.extrudedHeight = exAlt(entry.ceil * FT_TO_M);
    }
  }
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
  updateWeatherEdges();
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
        font: labelFont(11),
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
        font: labelFont(10),
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

window.delayColor = delayColor;
window.formatDelayMinutes = formatDelayMinutes;
window.parseDelayDuration = parseDelayDuration;
window.parseFAADelayXML = parseFAADelayXML;
window.fetchAllAirportDelays = fetchAllAirportDelays;
window.getAirportDelayMinutes = getAirportDelayMinutes;
window.getAirportDelayInfo = getAirportDelayInfo;
window.applyDelayColorsToAirports = applyDelayColorsToAirports;
window.resetAirportDelayColors = resetAirportDelayColors;
window.getAirportColor = getAirportColor;
window.getAirportOutlineColor = getAirportOutlineColor;
window.getAirportOutlineWidth = getAirportOutlineWidth;
window.getAirportLabelColor = getAirportLabelColor;
window.initAirports = initAirports;

window.toggleAirports = toggleAirports;
window.updateAirportColors = updateAirportColors;
window.initAirspace = initAirspace;
window.rebuildAirspace = rebuildAirspace;
window.updateAirspaceAltitudes = updateAirspaceAltitudes;
window.toggleAirspace = toggleAirspace;
window.toggleAirspace3D = toggleAirspace3D;
window.toggleAirspaceEdges = toggleAirspaceEdges;
window.getWaypointColor = getWaypointColor;
window.getWaypointLabelColor = getWaypointLabelColor;
window.getNavaidColor = getNavaidColor;
window.initNavaids = initNavaids;
window.initFixes = initFixes;
window.removeFixes = removeFixes;
window.removeNavaids = removeNavaids;
window.toggleNavaids = toggleNavaids;
window.updateWaypointColors = updateWaypointColors;

export {}
