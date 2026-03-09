/**
 * Camera composable.
 * Camera change handler, LOD transitions, 2D/3D morphing, rotation orbit,
 * view save/restore, and mobile detection.
 *
 * Ported from shared/radar-ui.js.
 */

import { ref, type Ref } from 'vue';
import {
  Viewer,
  Cartesian2,
  Cartesian3,
  Cartographic,
  BoundingSphere,
  HeadingPitchRange,
  Matrix4,
  Ellipsoid,
  SceneMode,
  Math as CesiumMath,
} from 'cesium';
import { useSettingsStore } from '@/stores/settings';
import { useAircraftStore } from '@/stores/aircraft';
import {
  computeDisplaySize,
  computePollInterval,
  computePositionUpdateInterval,
  DOT_THRESHOLD,
} from '@/core/scaling';
import { boundsContain } from '@/core/geo';
import type { ViewBounds, CameraPosition } from '@/core/types';

// ============================================================
// Types
// ============================================================

export interface CameraReturn {
  is2D: Ref<boolean>;
  isRotating: Ref<boolean>;
  isTracking: Ref<boolean>;

  /** Start listening to camera changes */
  startCameraHandler: () => void;
  /** Stop listening to camera changes */
  stopCameraHandler: () => void;

  /** Morph between 2D and 3D */
  morphAndPreserveView: (to3D: boolean) => void;
  /** Start auto-rotation */
  startRotation: () => void;
  /** Stop auto-rotation */
  stopRotation: () => void;
  /** Stop entity tracking */
  stopTracking: () => void;

  /** Fly to home/saved view */
  goHome: () => void;
  /** Save current view */
  saveView: () => void;
  /** Schedule a viewport poll */
  scheduleViewportPoll: () => void;
  /** Get current view bounds */
  getViewBounds: () => ViewBounds;

  /** Check if in mobile layout */
  isMobile: () => boolean;
}

// ============================================================
// Composable
// ============================================================

export function useCamera(
  viewerRef: Ref<Viewer | null>,
  polling: {
    setPollInterval: (ms: number) => void;
    setTickInterval: (ms: number) => void;
    pollStates: () => Promise<void>;
    rateLimitedUntil: Ref<number>;
  },
): CameraReturn {
  const settingsStore = useSettingsStore();
  const aircraftStore = useAircraftStore();

  // ---- State ----
  const is2D = ref(false);
  const isRotating = ref(false);
  const isTracking = ref(false);

  let rotateHandler: (() => void) | null = null;
  let frozenBounds: ViewBounds | null = null;
  let lastIconSize = -1;
  let lastPollBounds: ViewBounds | null = null;
  let lastPollHeight: number | null = null;
  let lastPositionUpdateHeight: number | null = null;
  let viewChangePollDebounce: ReturnType<typeof setTimeout> | null = null;
  let lastUseDot: boolean | null = null;
  let _zoomResizeRAF: number | null = null;
  let _cameraListenerRemover: (() => void) | null = null;

  // ---- Helpers ----

  function isMobile(): boolean {
    return window.matchMedia('(max-width: 767px)').matches;
  }

  // ---- View bounds ----

  function getViewBounds(): ViewBounds {
    const v = viewerRef.value;
    if (!v) return { south: 24, west: -125, north: 50, east: -66 };

    const rect = v.camera.computeViewRectangle();
    if (!rect) {
      const canvas = v.scene.canvas;
      const topLeft = v.camera.pickEllipsoid(
        new Cartesian2(0, 0), Ellipsoid.WGS84,
      );
      const bottomRight = v.camera.pickEllipsoid(
        new Cartesian2(canvas.clientWidth, canvas.clientHeight), Ellipsoid.WGS84,
      );
      if (topLeft && bottomRight) {
        const tl = Cartographic.fromCartesian(topLeft);
        const br = Cartographic.fromCartesian(bottomRight);
        const deg = CesiumMath.toDegrees;
        return {
          south: Math.max(deg(br.latitude), -90),
          west: Math.max(deg(tl.longitude), -180),
          north: Math.min(deg(tl.latitude), 90),
          east: Math.min(deg(br.longitude), 180),
        };
      }
      return { south: 24, west: -125, north: 50, east: -66 };
    }
    const deg = CesiumMath.toDegrees;
    const bounds: ViewBounds = {
      south: Math.max(deg(rect.south), -90),
      west: Math.max(deg(rect.west), -180),
      north: Math.min(deg(rect.north), 90),
      east: Math.min(deg(rect.east), 180),
    };
    const lonSpan = bounds.east - bounds.west;
    const latSpan = bounds.north - bounds.south;
    if (lonSpan > 180 || latSpan > 140) {
      return { south: 24, west: -125, north: 50, east: -66 };
    }
    return bounds;
  }

  // ---- Viewport poll scheduling ----

  function scheduleViewportPoll(): void {
    if (!settingsStore.settings.aircraftEnabled || Date.now() < polling.rateLimitedUntil.value) return;
    if (viewChangePollDebounce) clearTimeout(viewChangePollDebounce);
    const elapsed = aircraftStore.lastPollTime
      ? Date.now() - aircraftStore.lastPollTime.getTime()
      : Infinity;
    const delay = Math.max(1500, 10_000 - elapsed + 500);
    viewChangePollDebounce = setTimeout(() => {
      viewChangePollDebounce = null;
      polling.pollStates();
    }, delay);
  }

  // ---- Camera change handler ----

  function startCameraHandler(): void {
    const v = viewerRef.value;
    if (!v) return;

    const handler = (): void => {
      const carto = v.camera.positionCartographic;
      if (!carto) return;

      const h = carto.height;

      // LOD tier change (dot ↔ arrow)
      const newIconSize = computeDisplaySize(h);
      const useDot = h > DOT_THRESHOLD;
      if (useDot !== lastUseDot) {
        lastUseDot = useDot;
        lastIconSize = newIconSize;
        if (_zoomResizeRAF) {
          cancelAnimationFrame(_zoomResizeRAF);
          _zoomResizeRAF = null;
        }
        aircraftStore.renderAircraft();
      } else if (newIconSize !== lastIconSize) {
        lastIconSize = newIconSize;
        if (!_zoomResizeRAF) {
          _zoomResizeRAF = requestAnimationFrame(() => {
            _zoomResizeRAF = null;
            aircraftStore.resizeAircraftIcons();
          });
        }
      }

      // Adjust poll interval (>10% zoom change)
      if (lastPollHeight === null || Math.abs(h - lastPollHeight) / lastPollHeight > 0.1) {
        const newPollInterval = computePollInterval(h);
        lastPollHeight = h;
        polling.setPollInterval(newPollInterval);
      }

      // Adjust position update interval
      if (lastPositionUpdateHeight === null || Math.abs(h - lastPositionUpdateHeight) / lastPositionUpdateHeight > 0.1) {
        const newPositionUpdateInterval = computePositionUpdateInterval(h);
        lastPositionUpdateHeight = h;
        polling.setTickInterval(newPositionUpdateInterval);
      }

      // Poll when viewport shows unfetched area
      const currentBounds = getViewBounds();
      if (!boundsContain(lastPollBounds, currentBounds)) {
        scheduleViewportPoll();
      }
      lastPollBounds = currentBounds;
    };

    v.camera.changed.addEventListener(handler);
    v.camera.percentageChanged = 0.01;

    _cameraListenerRemover = () => {
      v.camera.changed.removeEventListener(handler);
    };
  }

  function stopCameraHandler(): void {
    if (_cameraListenerRemover) {
      _cameraListenerRemover();
      _cameraListenerRemover = null;
    }
    if (_zoomResizeRAF) {
      cancelAnimationFrame(_zoomResizeRAF);
      _zoomResizeRAF = null;
    }
    if (viewChangePollDebounce) {
      clearTimeout(viewChangePollDebounce);
      viewChangePollDebounce = null;
    }
  }

  // ---- 2D/3D morphing ----

  function morphAndPreserveView(to3D: boolean): void {
    const v = viewerRef.value;
    if (!v) return;

    const carto = v.camera.positionCartographic;
    const lon = CesiumMath.toDegrees(carto.longitude);
    const lat = CesiumMath.toDegrees(carto.latitude);
    const height = carto.height;

    const onComplete = (): void => {
      v.scene.morphComplete.removeEventListener(onComplete);
      v.camera.flyTo({
        destination: Cartesian3.fromDegrees(lon, lat, height),
        duration: 0,
      });
    };
    v.scene.morphComplete.addEventListener(onComplete);

    if (to3D) {
      v.scene.morphTo3D(1.0);
      is2D.value = false;
    } else {
      if (isRotating.value) {
        isRotating.value = false;
        stopRotation();
      }
      v.scene.morphTo2D(1.0);
      is2D.value = true;
    }
  }

  // ---- Rotation ----

  function startRotation(): void {
    const v = viewerRef.value;
    if (!v || rotateHandler) return;

    frozenBounds = getViewBounds();

    const ray = v.camera.getPickRay(new Cartesian2(
      v.canvas.clientWidth / 2, v.canvas.clientHeight / 2,
    ));
    if (!ray) return;
    const groundPoint = v.scene.globe.pick(ray, v.scene);
    if (!groundPoint) return;

    const range = Cartesian3.distance(v.camera.position, groundPoint);
    const direction = Cartesian3.subtract(v.camera.position, groundPoint, new Cartesian3());
    const dirNormalized = Cartesian3.normalize(direction, new Cartesian3());
    const targetNormal = Ellipsoid.WGS84.geodeticSurfaceNormal(groundPoint, new Cartesian3());
    const pitch = -Math.asin(Cartesian3.dot(dirNormalized, targetNormal));
    let currentHeading = v.camera.heading;
    let lastTime = Date.now();

    rotateHandler = (): void => {
      const now = Date.now();
      const dt = (now - lastTime) / 1000;
      lastTime = now;
      const rate = CesiumMath.toRadians(settingsStore.settings.rotationSpeed || 6);
      currentHeading = (currentHeading + rate * dt) % CesiumMath.TWO_PI;
      v.camera.lookAt(
        groundPoint,
        new HeadingPitchRange(currentHeading, pitch, range),
      );
    };
    v.clock.onTick.addEventListener(rotateHandler);
  }

  function stopRotation(): void {
    const v = viewerRef.value;
    if (rotateHandler && v) {
      v.clock.onTick.removeEventListener(rotateHandler);
      rotateHandler = null;
      v.camera.lookAtTransform(Matrix4.IDENTITY);
    }
    frozenBounds = null;
  }

  // ---- Tracking ----

  function stopTracking(): void {
    const v = viewerRef.value;
    if (!isTracking.value) return;
    isTracking.value = false;
    if (v) v.trackedEntity = undefined;
  }

  // ---- View presets ----

  function goHome(): void {
    const v = viewerRef.value;
    if (!v) return;

    const sv = settingsStore.settings.savedView;
    if (sv) {
      v.camera.flyTo({
        destination: Cartesian3.fromDegrees(sv.lon, sv.lat, sv.height),
        orientation: { heading: sv.heading, pitch: sv.pitch, roll: 0 },
        duration: 1.5,
      });
    }
  }

  function saveView(): void {
    const v = viewerRef.value;
    if (!v) return;

    const carto = v.camera.positionCartographic;
    const savedView: CameraPosition = {
      lon: CesiumMath.toDegrees(carto.longitude),
      lat: CesiumMath.toDegrees(carto.latitude),
      height: carto.height,
      heading: v.camera.heading,
      pitch: v.camera.pitch,
    };
    settingsStore.update('savedView', savedView);
  }

  return {
    is2D,
    isRotating,
    isTracking,
    startCameraHandler,
    stopCameraHandler,
    morphAndPreserveView,
    startRotation,
    stopRotation,
    stopTracking,
    goHome,
    saveView,
    scheduleViewportPoll,
    getViewBounds,
    isMobile,
  };
}
