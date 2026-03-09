/**
 * Aircraft Pinia store.
 * Owns the aircraft Map, selectedIcao, searchedIcao, render generation counter.
 * Handles entity CRUD, trail management, chunked rendering.
 *
 * Ported from shared/radar-aircraft.js (entity/rendering parts).
 */

import { defineStore } from 'pinia';
import { ref, shallowRef, type Ref } from 'vue';
import {
  Viewer,
  Entity,
  Cartesian2,
  Cartesian3,
  Cartographic,
  Color,
  LabelGraphics,
  LabelStyle,
  HorizontalOrigin,
  VerticalOrigin,
  DistanceDisplayCondition,
  PolylineDashMaterialProperty,
  Math as CesiumMath,
} from 'cesium';
import { useSettingsStore } from '@/stores/settings';
import type { AircraftState, RawStateVector, ViewBounds } from '@/core/types';
import { parseState } from '@/core/opensky';
import { createDotIcon } from '@/core/icons';
import { formatAltitude, formatSpeed, verticalIndicator } from '@/core/formatting';
import {
  computeDisplaySize,
  getZoomFraction,
  DOT_THRESHOLD,
} from '@/core/scaling';
import {
  altitudeToRgb,
  altitudeToSelectedRgb,
  altitudeToTrailWidth,
  hexToRgb,
} from '@/core/colors';

// ============================================================
// Types
// ============================================================

/** Internal aircraft record — holds state, Cesium entities, and history */
export interface AircraftRecord {
  state: AircraftState;
  entity: Entity | null;
  trailEntities: Entity[];
  extrapolationTrail: Entity | null;
  history: TrailPoint[];
  granularTrack: GranularTrack | null;
  lastTrackFetch: number;
  lastKnownAlt: number;
  lastServerUpdate: number;
  extrapolatedPos: Cartesian3 | null;
  _trailHash: string;
  _iconKey: string;
  _labelText: string;
}

export interface TrailPoint {
  lon: number;
  lat: number;
  alt: number;
  time: number;
  granular?: boolean;
}

export interface GranularTrack {
  path: Array<[number, number, number, number | null, number | null, boolean]>;
  [key: string]: unknown;
}

// ============================================================
// Constants
// ============================================================

const RENDER_CHUNK_SIZE = 80;
const STALE_THRESHOLD = 300; // seconds

// ============================================================
// Store
// ============================================================

export const useAircraftStore = defineStore('aircraft', () => {
  const settingsStore = useSettingsStore();

  // ---- State ----
  const aircraft = ref<Map<string, AircraftRecord>>(new Map());
  const selectedIcao = ref<string | null>(null);
  const searchedIcao = ref<string | null>(null);
  const searchedFlightIdent = ref<string | null>(null);
  const lastPollTime = ref<Date | null>(null);
  const lastPollBounds = ref<ViewBounds | null>(null);

  // Render generation counter — incremented to cancel stale chunked renders
  let _renderGeneration = 0;

  // Shared DistanceDisplayCondition for aircraft/PIREPs
  let _acDisplayCond: DistanceDisplayCondition | null = null;

  // Viewer reference — set by the composable layer
  const _viewer = shallowRef<Viewer | null>(null);

  // ---- Viewer binding ----

  function setViewer(v: Viewer | null): void {
    _viewer.value = v;
  }

  // ---- Helper: compute horizon distance ----

  function computeHorizonDist(camHeight: number): number {
    const R = 6371000;
    return Math.sqrt(2 * R * camHeight + camHeight * camHeight) * 1.25;
  }

  // ---- Trail content fingerprint ----

  function _computeTrailHash(ac: AircraftRecord, s: AircraftState, isSelected: boolean): string {
    const trailMode = settingsStore.settings.trailMode;
    if (!isSelected && trailMode === 'none') return '';
    if (!isSelected && trailMode === 'velocity') {
      return `V:${(s.heading || 0).toFixed(1)}:${(s.velocity || 0).toFixed(0)}:${s.lon!.toFixed(4)}:${s.lat!.toFixed(4)}`;
    }
    const histLen = ac.history.length;
    const last = histLen > 0 ? ac.history[histLen - 1] : null;
    const granLen = ac.granularTrack?.path ? ac.granularTrack.path.length : 0;
    return last
      ? `T:${histLen}:${granLen}:${last.time.toFixed(0)}`
      : `T:0:${granLen}`;
  }

  // ---- Trail entity management ----

  function removeTrailEntities(ac: AircraftRecord): void {
    const v = _viewer.value;
    if (!v) return;
    for (const e of ac.trailEntities) v.entities.remove(e);
    ac.trailEntities = [];
    ac._trailHash = '';
    if (ac.extrapolationTrail) {
      v.entities.remove(ac.extrapolationTrail);
      ac.extrapolationTrail = null;
    }
  }

  // ---- Extrapolation trail (connects last history point to current position) ----

  function updateExtrapolationTrail(icao: string, ac: AircraftRecord, currentPos: Cartesian3): void {
    const v = _viewer.value;
    if (!v) return;
    const trailMode = settingsStore.settings.trailMode;
    const isSelected = icao === selectedIcao.value;
    // Selected aircraft always get extrapolation trail regardless of trail mode
    if (trailMode !== 'history' && !isSelected) return;
    const lastHistory = ac.history.length > 0 ? ac.history[ac.history.length - 1] : null;
    if (!lastHistory) return;

    const lastHistoryPos = Cartesian3.fromDegrees(lastHistory.lon, lastHistory.lat, lastHistory.alt);
    const positions = [lastHistoryPos, currentPos];

    let trailWidth = isSelected ? 4 : 3;
    const camHeight = v.camera.positionCartographic
      ? v.camera.positionCartographic.height
      : 4860000;
    const zoomT = getZoomFraction(camHeight);
    trailWidth = Math.max(1, trailWidth * (1 - zoomT) + 1 * zoomT);

    const alt = ac.state.altitude || 0;
    const theme = settingsStore.resolvedTheme;
    const colorByAltitude = settingsStore.settings.colorByAltitude;
    let rgb: [number, number, number];
    if (colorByAltitude) {
      rgb = isSelected ? altitudeToSelectedRgb(alt, theme) : altitudeToRgb(alt, theme);
    } else {
      rgb = isSelected
        ? hexToRgb(settingsStore.phosphorBright)
        : settingsStore.derivedColors.trailColor;
    }
    const mute = (!isSelected && theme === 'dark') ? 0.6 : 1;
    const material = Color.fromBytes(
      Math.round(rgb[0] * mute), Math.round(rgb[1] * mute), Math.round(rgb[2] * mute), 255);

    if (ac.extrapolationTrail) {
      ac.extrapolationTrail.polyline!.positions = positions as any;
      ac.extrapolationTrail.polyline!.width = trailWidth as any;
      ac.extrapolationTrail.polyline!.material = material as any;
    } else {
      ac.extrapolationTrail = v.entities.add({
        polyline: {
          positions,
          width: trailWidth,
          material,
          clampToGround: false,
          distanceDisplayCondition: _acDisplayCond ?? undefined,
        },
      });
    }
  }

  // ---- Compute extrapolated position ----

  function computeExtrapolatedPosition(
    s: AircraftState,
    baseTime: number,
    now: number,
  ): Cartesian3 | null {
    if (s.heading == null || !s.velocity || s.lon == null || s.lat == null) return null;
    const elapsed = now - baseTime;
    if (elapsed < 0 || elapsed > STALE_THRESHOLD) return null;

    const distance = s.velocity * elapsed;
    const headingRad = CesiumMath.toRadians(s.heading);
    const lonRad = CesiumMath.toRadians(s.lon);
    const latRad = CesiumMath.toRadians(s.lat);
    const R = 6371000;
    const angDist = distance / R;

    const newLat = Math.asin(
      Math.sin(latRad) * Math.cos(angDist) +
      Math.cos(latRad) * Math.sin(angDist) * Math.cos(headingRad),
    );
    const newLon = lonRad + Math.atan2(
      Math.sin(headingRad) * Math.sin(angDist) * Math.cos(latRad),
      Math.cos(angDist) - Math.sin(latRad) * Math.sin(newLat),
    );

    const alt = (s.altitude || 0) + (s.verticalRate || 0) * elapsed;
    return Cartesian3.fromDegrees(CesiumMath.toDegrees(newLon), CesiumMath.toDegrees(newLat), alt);
  }

  // ---- Smooth trail positions ----

  function smoothTrailPositions(points: TrailPoint[]): TrailPoint[] {
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

  // ---- Build trail positions (merge granular + polled history) ----

  function buildTrailPositions(ac: AircraftRecord, isSelected: boolean): TrailPoint[] {
    const now = Date.now() / 1000;
    const trailMaxAge = settingsStore.settings.trailLength;
    const minTime = isSelected ? 0 : now - trailMaxAge;
    const lastKnownAlt = ac.lastKnownAlt || 0;

    const granularPoints: TrailPoint[] = [];
    if (ac.granularTrack?.path) {
      for (const wp of ac.granularTrack.path) {
        if (wp[0] >= minTime && wp[1] != null && wp[2] != null) {
          granularPoints.push({
            lon: wp[2], lat: wp[1],
            alt: wp[3] != null ? wp[3] : lastKnownAlt,
            time: wp[0], granular: true,
          });
        }
      }
    }

    const polledPoints: TrailPoint[] = [];
    for (const p of ac.history) {
      if (p.time >= minTime) {
        polledPoints.push({ ...p, granular: false });
      }
    }

    let points: TrailPoint[];
    if (granularPoints.length > 0) {
      const gMin = granularPoints[0].time;
      const gMax = granularPoints[granularPoints.length - 1].time;
      const filteredPolled = polledPoints.filter(p => p.time < gMin || p.time > gMax);
      points = [...granularPoints, ...filteredPolled];
    } else {
      points = polledPoints;
    }

    points.sort((a, b) => a.time - b.time);

    // Gap trimming (skip when granular data exists)
    const hasGranular = granularPoints.length > 0;
    if (!hasGranular) {
      const MAX_GAP = isSelected ? 600 : 180;
      let segmentStart = 0;
      for (let i = 1; i < points.length; i++) {
        if (points[i].time - points[i - 1].time > MAX_GAP) {
          segmentStart = i;
        }
      }
      if (segmentStart > 0) {
        points = points.slice(segmentStart);
      }
    }

    return smoothTrailPositions(points);
  }

  // ---- Render a single aircraft entity ----

  function _renderOneAircraft(
    icao: string,
    ac: AircraftRecord,
    camHeight: number,
    _useDot: boolean,
    showLabels: boolean,
  ): void {
    const v = _viewer.value;
    if (!v) return;

    const s = ac.state;
    if (s.lon == null || s.lat == null) return;

    const pos = ac.extrapolatedPos || Cartesian3.fromDegrees(s.lon, s.lat, s.altitude || 0);
    const isSelected = icao === selectedIcao.value;
    const theme = settingsStore.resolvedTheme;
    const colorByAltitude = settingsStore.settings.colorByAltitude;
    const fontSize = settingsStore.settings.fontSize;

    // Altitude-based color
    let altColor: string | null = null;
    let altCesiumColor: Color | null = null;
    if (colorByAltitude) {
      const altRgb = isSelected ? altitudeToSelectedRgb(s.altitude, theme) : altitudeToRgb(s.altitude, theme);
      altColor = `rgb(${altRgb[0]},${altRgb[1]},${altRgb[2]})`;
      altCesiumColor = Color.fromBytes(altRgb[0], altRgb[1], altRgb[2], 255);
    }

    const iconImage = createDotIcon(8, altColor || (isSelected ? settingsStore.phosphorSelect : settingsStore.phosphor));
    const iconKey = `D:${isSelected}:${altColor || ''}`;
    const iconSize = computeDisplaySize(camHeight);
    const labelColor = altCesiumColor || (isSelected
      ? Color.fromCssColorString(settingsStore.phosphorSelect)
      : Color.fromCssColorString(settingsStore.phosphor));
    const labelOutlineColor = settingsStore.derivedColors.labelOutlineMode === 'dark'
      ? Color.BLACK
      : Color.WHITE;

    // --- Aircraft symbol (billboard) ---
    if (!ac.entity) {
      const labelOpts = (settingsStore.settings.labelsEnabled || isSelected) ? (() => {
        const headingRad = CesiumMath.toRadians(s.heading || 0);
        const labelDist = 24;
        const offsetX = Math.sin(headingRad) * labelDist;
        const offsetY = -Math.cos(headingRad) * labelDist;
        const hOrigin = offsetX >= 0 ? HorizontalOrigin.LEFT : HorizontalOrigin.RIGHT;
        return {
          text: `${s.callsign || icao}\n${formatAltitude(s.altitude)}${verticalIndicator(s.verticalRate)} ${formatSpeed(s.velocity)}`,
          font: `bold ${fontSize}px Roboto Flex, sans-serif`,
          fillColor: labelColor,
          outlineColor: labelOutlineColor,
          outlineWidth: 2,
          style: LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cartesian2(offsetX, offsetY),
          horizontalOrigin: hOrigin,
          verticalOrigin: VerticalOrigin.CENTER,
          showBackground: false,
          scale: 1.0,
          show: isSelected || showLabels,
          distanceDisplayCondition: _acDisplayCond ?? undefined,
        };
      })() : undefined;

      ac.entity = v.entities.add({
        id: `ac-${icao}`,
        position: pos,
        billboard: {
          image: iconImage,
          width: iconSize,
          height: iconSize,
          pixelOffset: new Cartesian2(0, 0),
          eyeOffset: new Cartesian3(0, 0, -100),
          distanceDisplayCondition: _acDisplayCond ?? undefined,
        },
        label: labelOpts,
        properties: { icao24: icao } as any,
      });
      ac._iconKey = iconKey;
      ac._labelText = labelOpts
        ? `${s.callsign || icao}\n${formatAltitude(s.altitude)}${verticalIndicator(s.verticalRate)} ${formatSpeed(s.velocity)}`
        : '';
    } else {
      // Update position
      ac.entity.position = pos as any;

      // Skip billboard image when icon hasn't changed
      if (ac._iconKey !== iconKey) {
        ac._iconKey = iconKey;
        ac.entity.billboard!.image = iconImage as any;
      }
      ac.entity.billboard!.width = iconSize as any;
      ac.entity.billboard!.height = iconSize as any;

      if (settingsStore.settings.labelsEnabled || isSelected) {
        const headingRad = CesiumMath.toRadians(s.heading || 0);
        const labelDist = 24;
        const offsetX = Math.sin(headingRad) * labelDist;
        const offsetY = -Math.cos(headingRad) * labelDist;
        const hOrigin = offsetX >= 0 ? HorizontalOrigin.LEFT : HorizontalOrigin.RIGHT;
        if (!ac.entity.label) {
          ac.entity.label = new LabelGraphics({
            text: '',
            font: `bold ${fontSize}px Roboto Flex, sans-serif`,
            fillColor: labelColor,
            outlineColor: labelOutlineColor,
            outlineWidth: 2,
            style: LabelStyle.FILL_AND_OUTLINE,
            pixelOffset: new Cartesian2(offsetX, offsetY),
            horizontalOrigin: hOrigin,
            verticalOrigin: VerticalOrigin.CENTER,
            distanceDisplayCondition: _acDisplayCond ?? undefined,
          });
        }
        const labelText = `${s.callsign || icao}\n${formatAltitude(s.altitude)}${verticalIndicator(s.verticalRate)} ${formatSpeed(s.velocity)}`;
        if (ac._labelText !== labelText) {
          ac._labelText = labelText;
          ac.entity.label.text = labelText as any;
          ac.entity.label.fillColor = labelColor as any;
        }
        ac.entity.label.pixelOffset = new Cartesian2(offsetX, offsetY) as any;
        ac.entity.label.horizontalOrigin = hOrigin as any;
        ac.entity.label.show = (isSelected || showLabels) as any;
      } else if (ac.entity.label) {
        ac.entity.label.show = false as any;
      }
    }

    // --- Trail polyline ---
    const _th = _computeTrailHash(ac, s, isSelected);
    if (ac._trailHash === _th) return;

    const trailMode = settingsStore.settings.trailMode;
    if (trailMode !== 'none' || isSelected) {
      let trailWidth: number;
      if (settingsStore.settings.thickTrailsByAltitude) {
        trailWidth = altitudeToTrailWidth(s.altitude);
        if (isSelected) trailWidth = Math.min(trailWidth + 1, 8);
      } else {
        trailWidth = isSelected ? 4 : 3;
      }
      const zoomT = getZoomFraction(camHeight);
      trailWidth = Math.max(1, trailWidth * (1 - zoomT) + 1 * zoomT);

      if (!isSelected && trailMode === 'velocity' && s.heading != null && s.velocity != null) {
        // Velocity vector mode
        removeTrailEntities(ac);
        const speed = s.velocity || 0;
        const lineLength = speed * 60;
        if (lineLength > 100) {
          const acCarto = Cartographic.fromCartesian(pos);
          const acLon = CesiumMath.toDegrees(acCarto.longitude);
          const acLat = CesiumMath.toDegrees(acCarto.latitude);
          const behindDeg = (s.heading! + 180) % 360;
          const behindRad = CesiumMath.toRadians(behindDeg);
          const R = 6371000;
          const angDist = lineLength / R;

          const endLat = Math.asin(
            Math.sin(acCarto.latitude) * Math.cos(angDist) +
            Math.cos(acCarto.latitude) * Math.sin(angDist) * Math.cos(behindRad),
          );
          const endLon = acCarto.longitude + Math.atan2(
            Math.sin(behindRad) * Math.sin(angDist) * Math.cos(acCarto.latitude),
            Math.cos(angDist) - Math.sin(acCarto.latitude) * Math.sin(endLat),
          );

          const alt = s.altitude || 0;
          const endAlt = alt - (s.verticalRate || 0) * 60;
          const positions = [
            Cartesian3.fromDegrees(acLon, acLat, alt),
            Cartesian3.fromDegrees(CesiumMath.toDegrees(endLon), CesiumMath.toDegrees(endLat), endAlt),
          ];

          let rgb: [number, number, number];
          if (colorByAltitude) {
            rgb = isSelected ? altitudeToSelectedRgb(alt, theme) : altitudeToRgb(alt, theme);
          } else {
            rgb = isSelected
              ? hexToRgb(settingsStore.phosphorBright)
              : settingsStore.derivedColors.trailColor;
          }
          const mute = (!isSelected && theme === 'dark') ? 0.6 : 1;
          const material = Color.fromBytes(
            Math.round(rgb[0] * mute), Math.round(rgb[1] * mute), Math.round(rgb[2] * mute), 255);

          ac.trailEntities.push(v.entities.add({
            polyline: {
              positions,
              width: trailWidth,
              material,
              clampToGround: false,
              distanceDisplayCondition: _acDisplayCond ?? undefined,
            },
          }));
        }
      } else {
        // History trail mode
        const trailPoints = buildTrailPositions(ac, isSelected);
        removeTrailEntities(ac);

        if (trailPoints.length >= 2) {
          if (colorByAltitude) {
            // Altitude-colored segments
            const bucketOf = (alt: number) => Math.floor(((alt || 0) * 3.28084) / 1500);
            let runStart = 0;
            let currentBucket = bucketOf(trailPoints[0].alt);

            for (let i = 1; i <= trailPoints.length; i++) {
              const bucket = i < trailPoints.length ? bucketOf(trailPoints[i].alt) : -1;
              if (bucket !== currentBucket || i === trailPoints.length) {
                const end = Math.min(i, trailPoints.length - 1);
                const runPoints = trailPoints.slice(runStart, end + 1);
                if (runPoints.length >= 2) {
                  const midAlt = ((currentBucket + 0.5) * 1500) / 3.28084;
                  const rgb = isSelected ? altitudeToSelectedRgb(midAlt, theme) : altitudeToRgb(midAlt, theme);
                  const mute = (!isSelected && theme === 'dark') ? 0.6 : 1;
                  const material = Color.fromBytes(
                    Math.round(rgb[0] * mute), Math.round(rgb[1] * mute), Math.round(rgb[2] * mute), 255);
                  const positions = runPoints.map(p => Cartesian3.fromDegrees(p.lon, p.lat, p.alt));
                  ac.trailEntities.push(v.entities.add({
                    polyline: {
                      positions,
                      width: trailWidth,
                      material,
                      clampToGround: false,
                      distanceDisplayCondition: _acDisplayCond ?? undefined,
                    },
                  }));
                }
                runStart = i;
                currentBucket = bucket;
              }
            }
          } else {
            // Single-color trail
            const trailRgb = isSelected
              ? hexToRgb(settingsStore.phosphorBright)
              : settingsStore.derivedColors.trailColor;
            const mute = (!isSelected && theme === 'dark') ? 0.6 : 1;
            const trailMaterial = Color.fromBytes(
              Math.round(trailRgb[0] * mute), Math.round(trailRgb[1] * mute), Math.round(trailRgb[2] * mute), 255);
            const positions = trailPoints.map(p => Cartesian3.fromDegrees(p.lon, p.lat, p.alt));
            ac.trailEntities.push(v.entities.add({
              polyline: {
                positions,
                width: trailWidth,
                material: trailMaterial,
                clampToGround: false,
                distanceDisplayCondition: _acDisplayCond ?? undefined,
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

  // ---- Render aircraft (chunked for large batches) ----

  function renderAircraft(filterIcaos?: Set<string>): void {
    const v = _viewer.value;
    if (!v) return;

    const camHeight = v.camera.positionCartographic
      ? v.camera.positionCartographic.height
      : 0;
    const useDot = camHeight > DOT_THRESHOLD;
    const showLabels = settingsStore.settings.labelsEnabled && camHeight < 800000;
    _acDisplayCond = new DistanceDisplayCondition(0, computeHorizonDist(camHeight));

    const entries: [string, AircraftRecord][] = [];
    for (const [icao, ac] of aircraft.value) {
      if (filterIcaos && !filterIcaos.has(icao)) continue;
      entries.push([icao, ac]);
    }

    // Small batches render synchronously
    if (entries.length <= RENDER_CHUNK_SIZE) {
      v.entities.suspendEvents();
      try {
        for (const [icao, ac] of entries) {
          _renderOneAircraft(icao, ac, camHeight, useDot, showLabels);
        }
      } finally {
        v.entities.resumeEvents();
      }
      return;
    }

    // Large batches: chunk across animation frames
    const gen = ++_renderGeneration;
    let idx = 0;

    function renderChunk(): void {
      if (gen !== _renderGeneration || !settingsStore.settings.aircraftEnabled) return;
      const end = Math.min(idx + RENDER_CHUNK_SIZE, entries.length);
      v!.entities.suspendEvents();
      try {
        for (; idx < end; idx++) {
          _renderOneAircraft(entries[idx][0], entries[idx][1], camHeight, useDot, showLabels);
        }
      } finally {
        v!.entities.resumeEvents();
      }
      if (idx < entries.length && gen === _renderGeneration) {
        requestAnimationFrame(renderChunk);
      }
    }

    requestAnimationFrame(renderChunk);
  }

  // ---- Resize aircraft icons (lightweight zoom handler) ----

  function resizeAircraftIcons(): void {
    const v = _viewer.value;
    if (!v) return;

    const camHeight = v.camera.positionCartographic
      ? v.camera.positionCartographic.height : 0;
    const iconSize = computeDisplaySize(camHeight);
    const showLabels = settingsStore.settings.labelsEnabled && camHeight < 800000;
    _acDisplayCond = new DistanceDisplayCondition(0, computeHorizonDist(camHeight));

    v.entities.suspendEvents();
    try {
      for (const [icao, ac] of aircraft.value) {
        if (!ac.entity) continue;
        if (ac.entity.billboard) {
          ac.entity.billboard.width = iconSize as any;
          ac.entity.billboard.height = iconSize as any;
          ac.entity.billboard.distanceDisplayCondition = _acDisplayCond as any;
        }
        if (ac.entity.label) {
          ac.entity.label.show = ((icao === selectedIcao.value) || showLabels) as any;
          ac.entity.label.distanceDisplayCondition = _acDisplayCond as any;
        }
      }
    } finally {
      v.entities.resumeEvents();
    }
  }

  // ---- Refresh all entities (theme change) ----

  function refreshAllEntities(): void {
    const v = _viewer.value;
    if (!v) return;

    v.entities.suspendEvents();
    try {
      for (const [_icao, ac] of aircraft.value) {
        if (ac.entity) { v.entities.remove(ac.entity); ac.entity = null; }
        ac._iconKey = '';
        ac._labelText = '';
        removeTrailEntities(ac);
      }
    } finally {
      v.entities.resumeEvents();
    }
    renderAircraft();
  }

  // ---- Toggle aircraft display ----

  function toggleAircraft(show: boolean): void {
    const v = _viewer.value;
    if (!v) return;

    if (!show) {
      _renderGeneration++;

      const keepIcao = selectedIcao.value || searchedIcao.value;

      v.entities.suspendEvents();
      try {
        for (const [icao, ac] of aircraft.value) {
          if (icao === keepIcao) continue;
          if (ac.entity) { v.entities.remove(ac.entity); ac.entity = null; }
          removeTrailEntities(ac);
        }
      } finally {
        v.entities.resumeEvents();
      }

      for (const icao of [...aircraft.value.keys()]) {
        if (icao !== keepIcao) aircraft.value.delete(icao);
      }
    }
  }

  // ---- Update aircraft from poll data ----

  function updateAircraft(states: RawStateVector[]): void {
    const v = _viewer.value;
    if (!v) return;

    const now = Date.now() / 1000;
    const seen = new Set<string>();
    const trailMaxAge = settingsStore.settings.trailLength;

    v.entities.suspendEvents();
    try {
      for (const raw of states) {
        const s = parseState(raw);
        if (s.lon == null || s.lat == null) continue;
        if (s.onGround) continue;

        seen.add(s.icao24);
        let ac = aircraft.value.get(s.icao24);

        if (!ac) {
          ac = {
            state: s,
            entity: null,
            trailEntities: [],
            extrapolationTrail: null,
            history: [],
            granularTrack: null,
            lastTrackFetch: 0,
            lastKnownAlt: s.altitude || 0,
            lastServerUpdate: now,
            extrapolatedPos: null,
            _trailHash: '',
            _iconKey: '',
            _labelText: '',
          };
          aircraft.value.set(s.icao24, ac);
        }

        ac.state = s;
        ac.lastServerUpdate = now;
        ac.extrapolatedPos = computeExtrapolatedPosition(s, s.timePosition || now, now);

        const alt = s.altitude != null ? s.altitude : (ac.lastKnownAlt || 0);
        if (s.altitude != null) ac.lastKnownAlt = s.altitude;
        const last = ac.history.length > 0 ? ac.history[ac.history.length - 1] : null;
        const moved = !last
          || Math.abs(s.lon! - last.lon) > 0.0005
          || Math.abs(s.lat! - last.lat) > 0.0005
          || Math.abs(alt - last.alt) > 30;
        if (moved) {
          ac.history.push({ lon: s.lon!, lat: s.lat!, alt, time: now });
        }

        const currentPos = ac.extrapolatedPos || Cartesian3.fromDegrees(s.lon!, s.lat!, alt);
        updateExtrapolationTrail(s.icao24, ac, currentPos);

        // Trim old history (keep all for selected)
        if (s.icao24 !== selectedIcao.value) {
          ac.history = ac.history.filter(p => now - p.time < trailMaxAge);
        }

        // Clear stale granular track (skip for selected)
        if (s.icao24 !== selectedIcao.value && ac.granularTrack?.path) {
          const minTime = now - trailMaxAge;
          const hasValid = ac.granularTrack.path.some(wp => wp[0] >= minTime);
          if (!hasValid) ac.granularTrack = null;
        }
      }

      // Remove stale aircraft
      for (const [icao, ac] of aircraft.value) {
        if (!seen.has(icao) && icao !== searchedIcao.value && icao !== selectedIcao.value) {
          const age = now - (ac.state.lastContact || 0);
          if (age > STALE_THRESHOLD) {
            if (ac.entity) v.entities.remove(ac.entity);
            removeTrailEntities(ac);
            aircraft.value.delete(icao);
          }
        }
      }
    } finally {
      v.entities.resumeEvents();
    }

    renderAircraft();
  }

  // ---- Extrapolate positions between server polls ----

  function extrapolatePositions(): void {
    const v = _viewer.value;
    if (!v) return;

    const now = Date.now() / 1000;
    let updated = false;
    const trailMode = settingsStore.settings.trailMode;

    for (const [icao, ac] of aircraft.value) {
      if (!ac.entity || ac.state.heading == null || !ac.state.velocity) continue;

      const s = ac.state;
      const baseTime = s.timePosition || ac.lastServerUpdate;
      const newPos = computeExtrapolatedPosition(s, baseTime, now);
      if (!newPos) continue;

      const oldPos = ac.extrapolatedPos || ac.entity.position!.getValue(v.clock.currentTime);
      if (!oldPos) continue;

      const delta = Cartesian3.subtract(newPos, oldPos, new Cartesian3());
      ac.entity.position = newPos as any;
      ac.extrapolatedPos = newPos.clone();

      const isSelectedAc = icao === selectedIcao.value;
      if (!isSelectedAc && trailMode === 'velocity') {
        for (const trailEntity of ac.trailEntities) {
          if (trailEntity.polyline?.positions) {
            const oldPositions = (trailEntity.polyline.positions as any).getValue(v.clock.currentTime);
            if (oldPositions && oldPositions.length > 0) {
              const newPositions = oldPositions.map((pos: Cartesian3) =>
                Cartesian3.add(pos, delta, new Cartesian3()),
              );
              trailEntity.polyline.positions = newPositions as any;
            }
          }
        }
      } else if (trailMode === 'history' || isSelectedAc) {
        updateExtrapolationTrail(icao, ac, newPos);
      }

      updated = true;
    }

    if (updated && v.scene) {
      v.scene.requestRender();
    }
  }

  // ---- Create aircraft record for a searched flight ----

  function createAircraftRecord(s: AircraftState): AircraftRecord {
    const now = Date.now() / 1000;
    const ac: AircraftRecord = {
      state: s,
      entity: null,
      trailEntities: [],
      extrapolationTrail: null,
      history: [],
      granularTrack: null,
      lastTrackFetch: 0,
      lastKnownAlt: s.altitude || 0,
      lastServerUpdate: now,
      extrapolatedPos: null,
      _trailHash: '',
      _iconKey: '',
      _labelText: '',
    };
    ac.extrapolatedPos = computeExtrapolatedPosition(s, s.timePosition || now, now);
    if (s.lon != null && s.lat != null) {
      ac.history.push({ lon: s.lon, lat: s.lat, alt: s.altitude || 0, time: now });
    }
    return ac;
  }

  return {
    // State
    aircraft,
    selectedIcao,
    searchedIcao,
    searchedFlightIdent,
    lastPollTime,
    lastPollBounds,

    // Viewer binding
    setViewer,

    // Entity management
    renderAircraft,
    resizeAircraftIcons,
    refreshAllEntities,
    toggleAircraft,
    removeTrailEntities,
    updateExtrapolationTrail,

    // Data management
    updateAircraft,
    extrapolatePositions,
    computeExtrapolatedPosition,
    createAircraftRecord,

    // Internal helpers exposed for composables
    computeHorizonDist,
  };
});
