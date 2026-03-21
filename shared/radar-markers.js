// Map markers: airports, airspace boundaries, waypoints, and navaids.
// Depends on radar-core.js (viewer, CONFIG, state variables).

'use strict';

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
    return Cesium.Color.BLACK;
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
        outlineColor: pointOutlineColor,
        outlineWidth: pointOutlineWidth,
        scaleByDistance: dotScale,
      },
      label: {
        text: label,
        font: '14px Roboto Flex, sans-serif',
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
  const pointOutlineColor = getAirportOutlineColor();
  const pointOutlineWidth = getAirportOutlineWidth();
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
        outlineColor: pointOutlineColor,
        outlineWidth: pointOutlineWidth,
        scaleByDistance: dotScale,
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, smallRange),
      },
      label: {
        text: label,
        font: '12px Roboto Flex, sans-serif',
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
  const pointOutlineColor = getAirportOutlineColor();
  const pointOutlineWidth = getAirportOutlineWidth();
  const labelColor = getAirportLabelColor();
  const outlineColor = CONFIG.theme === 'light' ? Cesium.Color.WHITE : Cesium.Color.BLACK;
  for (const entity of [...airportEntities, ...smallAirportEntities]) {
    entity.point.color = pointColor;
    entity.point.outlineColor = pointOutlineColor;
    entity.point.outlineWidth = pointOutlineWidth;
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
        font: '11px Roboto Flex, sans-serif',
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
        font: '10px Roboto Flex, sans-serif',
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
