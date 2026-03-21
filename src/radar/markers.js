// Map markers: airports, airspace boundaries, waypoints, and navaids.

import S from '../state.js';
import { CONFIG, exAlt } from '../config.js';
import { createNavaidIcon } from '../icons.js';

// ============================================================
// Airport Markers
// ============================================================

export function getAirportColor() {
  if (CONFIG.theme === 'light') {
    return Cesium.Color.WHITE;
  }
  return Cesium.Color.fromCssColorString('#010101');
}

export function getAirportOutlineColor() {
  if (CONFIG.theme === 'light') {
    return Cesium.Color.BLACK;
  }
  return Cesium.Color.fromCssColorString('#333333');
}

function getAirportOutlineWidth() {
  return CONFIG.theme === 'light' ? 1 : 1;
}

export function getAirportLabelColor() {
  if (CONFIG.theme === 'light') {
    return Cesium.Color.fromCssColorString('rgba(80, 80, 80, 0.85)');
  }
  const rgb = CONFIG.trailColor;
  return Cesium.Color.fromBytes(rgb[0], rgb[1], rgb[2], 180);
}

export function initAirports(airports) {
  S.cachedAirportData = airports;
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

    const entity = S.viewer.entities.add({
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
    S.airportEntities.push(entity);
  }

  console.log(`[Airports] Created ${S.airportEntities.length} markers`);

  if (CONFIG.showSmallAirports) {
    initSmallAirports(airports);
  }
}

export function initSmallAirports(airports) {
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

    const entity = S.viewer.entities.add({
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
    S.smallAirportEntities.push(entity);
  }

  console.log(`[Airports] Created ${S.smallAirportEntities.length} small airport markers`);
}

export function removeSmallAirports() {
  for (const entity of S.smallAirportEntities) {
    S.viewer.entities.remove(entity);
  }
  S.smallAirportEntities.length = 0;
}

export function toggleAirports(show) {
  CONFIG.airportsEnabled = show;
  for (const entity of S.airportEntities) {
    entity.show = show;
  }
  for (const entity of S.smallAirportEntities) {
    entity.show = show;
  }
}

export function updateAirportColors() {
  const pointColor = getAirportColor();
  const pointOutlineColor = getAirportOutlineColor();
  const pointOutlineWidth = getAirportOutlineWidth();
  const labelColor = getAirportLabelColor();
  const outlineColor = CONFIG.theme === 'light' ? Cesium.Color.WHITE : Cesium.Color.BLACK;
  for (const entity of [...S.airportEntities, ...S.smallAirportEntities]) {
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

export const FT_TO_M = 0.3048;

export const AIRSPACE_COLORS = {
  B: { fill: new Cesium.Color(0.27, 0.51, 0.97, 0.15),  outline: new Cesium.Color(0.27, 0.51, 0.97, 1.0) },  // blue
  C: { fill: new Cesium.Color(1.0, 0.0, 1.0, 0.15),    outline: new Cesium.Color(1.0, 0.0, 1.0, 1.0) },     // magenta
  D: { fill: new Cesium.Color(0.53, 0.81, 0.98, 0.15), outline: new Cesium.Color(0.53, 0.81, 0.98, 1.0) },  // light blue
};

export function initAirspace(airspace) {
  if (airspace) S.airspaceData = airspace;
  if (!S.airspaceData) return;

  const use3D = CONFIG.airspace3D;

  for (const entry of S.airspaceData) {
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

    const entity = S.viewer.entities.add({
      polygon: polygonOpts,
      distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 800000),
      show: CONFIG.airspaceEnabled,
    });
    S.airspaceEntities.push(entity);
  }

  console.log(`[Airspace] Created ${S.airspaceEntities.length} ${use3D ? '3D volume' : 'flat boundary'} polygons`);
}

export function rebuildAirspace() {
  for (const entity of S.airspaceEntities) {
    S.viewer.entities.remove(entity);
  }
  S.airspaceEntities.length = 0;
  initAirspace();
}

export function toggleAirspace(show) {
  CONFIG.airspaceEnabled = show;
  for (const entity of S.airspaceEntities) {
    entity.show = show;
  }
}

export function toggleAirspace3D(use3D) {
  CONFIG.airspace3D = use3D;
  rebuildAirspace();
}

export function toggleAirspaceEdges(show) {
  CONFIG.airspaceEdges = show;
  rebuildAirspace();
}

// ============================================================
// Waypoints & Navaids
// ============================================================

export function getWaypointColor() {
  if (CONFIG.theme === 'light') {
    return Cesium.Color.fromCssColorString('rgba(120, 120, 120, 0.6)');
  }
  const rgb = CONFIG.trailColor;
  return Cesium.Color.fromBytes(rgb[0], rgb[1], rgb[2], 100);
}

export function getWaypointLabelColor() {
  if (CONFIG.theme === 'light') {
    return Cesium.Color.fromCssColorString('rgba(100, 100, 100, 0.75)');
  }
  const rgb = CONFIG.trailColor;
  return Cesium.Color.fromBytes(rgb[0], rgb[1], rgb[2], 150);
}

export function getNavaidColor(type) {
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

export function initNavaids(data) {
  if (data) S.cachedWaypointData = data;
  if (!S.cachedWaypointData) return;

  const navaids = S.cachedWaypointData.navaids || [];
  const outlineColor = CONFIG.theme === 'light' ? Cesium.Color.WHITE : Cesium.Color.BLACK;
  const navLabelRange = 150000; // labels within 150km

  for (const nav of navaids) {
    const color = getNavaidColor(nav.type);
    const cssColor = color.toCssColorString();
    const labelText = nav.id + ' ' + nav.type;

    const entity = S.viewer.entities.add({
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
    S.navaidEntities.push(entity);
  }

  console.log(`[Navaids] Created ${S.navaidEntities.length} navaid markers`);

  if (CONFIG.showFixes) {
    initFixes();
  }
}

export function initFixes() {
  if (!S.cachedWaypointData) return;
  const fixes = S.cachedWaypointData.fixes || [];

  const fixColor = getWaypointColor();
  const fixLabelColor = getWaypointLabelColor();
  const outlineColor = CONFIG.theme === 'light' ? Cesium.Color.WHITE : Cesium.Color.BLACK;
  const fixRange = 100000;     // visible within 100km
  const fixLabelRange = 50000; // labels within 50km

  for (const fix of fixes) {
    const entity = S.viewer.entities.add({
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
    S.waypointEntities.push(entity);
  }

  console.log(`[Navaids] Created ${S.waypointEntities.length} fix markers`);
}

export function removeFixes() {
  for (const entity of S.waypointEntities) S.viewer.entities.remove(entity);
  S.waypointEntities.length = 0;
}

export function removeNavaids() {
  removeFixes();
  for (const entity of S.navaidEntities) S.viewer.entities.remove(entity);
  S.navaidEntities.length = 0;
}

export function toggleNavaids(show) {
  CONFIG.navaidsEnabled = show;
  for (const entity of S.navaidEntities) entity.show = show;
  for (const entity of S.waypointEntities) entity.show = show;
}

export function updateWaypointColors() {
  const fixColor = getWaypointColor();
  const fixLabelColor = getWaypointLabelColor();
  const outlineColor = CONFIG.theme === 'light' ? Cesium.Color.WHITE : Cesium.Color.BLACK;
  for (const entity of S.waypointEntities) {
    entity.point.color = fixColor;
    entity.label.fillColor = fixLabelColor;
    entity.label.outlineColor = outlineColor;
  }
  // Rebuild navaids to update colors per type
  if (S.navaidEntities.length > 0 && S.cachedWaypointData) {
    const navaids = S.cachedWaypointData.navaids || [];
    for (let i = 0; i < S.navaidEntities.length && i < navaids.length; i++) {
      const color = getNavaidColor(navaids[i].type);
      const cssColor = color.toCssColorString();
      S.navaidEntities[i].billboard.image = createNavaidIcon(12, cssColor);
      S.navaidEntities[i].label.fillColor = color;
      S.navaidEntities[i].label.outlineColor = outlineColor;
    }
  }
}
