/**
 * Polling composable.
 * Manages bulk viewport polls, selected-aircraft polls, track fetch queue,
 * extrapolation ticks, and interval management based on camera height.
 *
 * Ported from shared/radar-aircraft.js (pollStates, pollSelectedAircraft,
 * fetchNextTrack, extrapolatePositions, startPolling, tick).
 */

import { ref, type Ref } from 'vue';
import {
  Viewer,
  Cartesian2,
  Cartesian3,
  Cartographic,
  Ellipsoid,
  Math as CesiumMath,
} from 'cesium';
import { useSettingsStore } from '@/stores/settings';
import { useAircraftStore } from '@/stores/aircraft';
import type { ViewBounds, RawStateVector } from '@/core/types';
import { parseState } from '@/core/opensky';
import { computePollInterval, computePositionUpdateInterval } from '@/core/scaling';
import {
  getStates,
  getTrack,
  getOpenSkyToken,
  type StatesResponse,
} from '@/services/opensky-api';

// ============================================================
// Constants
// ============================================================

const RATE_LIMIT_MS = 10_000;
const SELECTED_POLL_INTERVAL = 10_000;
const TRACK_FETCH_INTERVAL = 12_000;

// ============================================================
// Types
// ============================================================

export interface PollingReturn {
  /** Start the polling loop (call after viewer is ready) */
  startPolling: () => void;
  /** Stop all polling and timers */
  stopPolling: () => void;
  /** Ensure the tick timer is running */
  ensureTick: () => void;
  /** Stop the tick timer */
  stopTick: () => void;
  /** Set the bulk poll interval */
  setPollInterval: (ms: number) => void;
  /** Set the tick (extrapolation) interval */
  setTickInterval: (ms: number) => void;
  /** Trigger a viewport poll */
  pollStates: () => Promise<void>;
  /** Track fetch queue */
  trackFetchQueue: Ref<string[]>;
  /** Rate limited until timestamp */
  rateLimitedUntil: Ref<number>;
  /** Pause all timers (visibility change) */
  pauseAllTimers: () => void;
  /** Resume all timers (visibility change) */
  resumeAllTimers: () => void;
}

// ============================================================
// Composable
// ============================================================

export function usePolling(viewerRef: Ref<Viewer | null>): PollingReturn {
  const settingsStore = useSettingsStore();
  const aircraftStore = useAircraftStore();

  // ---- State ----
  const trackFetchQueue = ref<string[]>([]);
  const rateLimitedUntil = ref(0);

  let tickTimer: ReturnType<typeof setInterval> | null = null;
  let pollInterval = 30_000;
  let positionUpdateInterval = 1000;
  let lastPollHeight: number | null = null;
  let lastPositionUpdateHeight: number | null = null;
  let lastSelectedPollMs = 0;
  let lastTrackFetchMs = 0;
  let _pollInFlight = false;
  let _selectedPollInFlight = false;
  let _lastBulkPollMs = 0;
  let _lastSelectedPollApiMs = 0;

  // ---- View bounds computation ----

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

  function padBounds(bounds: ViewBounds, fraction: number): ViewBounds {
    const latPad = (bounds.north - bounds.south) * fraction / 2;
    const lonPad = (bounds.east - bounds.west) * fraction / 2;
    return {
      south: Math.max(bounds.south - latPad, -90),
      north: Math.min(bounds.north + latPad, 90),
      west: Math.max(bounds.west - lonPad, -180),
      east: Math.min(bounds.east + lonPad, 180),
    };
  }

  // ---- Bulk poll ----

  async function pollStates(): Promise<void> {
    if (_pollInFlight) return;
    const now = Date.now();
    if (now - _lastBulkPollMs < RATE_LIMIT_MS) return;
    _pollInFlight = true;
    _lastBulkPollMs = now;

    try {
      const viewBounds = getViewBounds();
      const bounds = padBounds(viewBounds, 0.5);

      const token = await getOpenSkyToken(
        settingsStore.settings.openskyClientId,
        settingsStore.settings.openskyClientSecret,
      );

      const data = await getStates(bounds, token);

      if ('error' in data) {
        if ('retryIn' in data && data.retryIn) {
          _lastBulkPollMs = now - RATE_LIMIT_MS + data.retryIn;
        } else if (/429/.test(data.error) || /rate.?limit/i.test(data.error)) {
          rateLimitedUntil.value = Date.now() + 60_000;
        }
        return;
      }

      if (!settingsStore.settings.aircraftEnabled) return;

      const stateCount = (data as StatesResponse).states?.length || 0;
      aircraftStore.lastPollTime = new Date();
      aircraftStore.lastPollBounds = bounds;

      if (stateCount > 0) {
        aircraftStore.updateAircraft((data as StatesResponse).states!);
      }
    } catch (err) {
      console.error('[Poll] pollStates exception:', err);
    } finally {
      _pollInFlight = false;
    }
  }

  // ---- Selected aircraft poll ----

  async function pollSelectedAircraft(): Promise<void> {
    if (_selectedPollInFlight) return;
    if (!aircraftStore.selectedIcao) return;
    const ac = aircraftStore.aircraft.get(aircraftStore.selectedIcao);
    if (!ac) return;
    const now = Date.now();
    if (now - _lastSelectedPollApiMs < RATE_LIMIT_MS) return;

    _selectedPollInFlight = true;
    _lastSelectedPollApiMs = now;

    const s = ac.state;
    if (s.lat == null || s.lon == null) {
      _selectedPollInFlight = false;
      return;
    }

    const pad = 1;
    const bounds: ViewBounds = {
      south: s.lat - pad, north: s.lat + pad,
      west: s.lon - pad, east: s.lon + pad,
    };

    try {
      const token = await getOpenSkyToken(
        settingsStore.settings.openskyClientId,
        settingsStore.settings.openskyClientSecret,
      );
      const data = await getStates(bounds, token);

      if ('error' in data) {
        if ('retryIn' in data && data.retryIn) {
          _lastSelectedPollApiMs = Date.now() - RATE_LIMIT_MS + data.retryIn;
        }
        return;
      }

      if ((data as StatesResponse).states) {
        const nowSec = Date.now() / 1000;
        for (const raw of (data as StatesResponse).states!) {
          const ns = parseState(raw);
          if (ns.icao24 !== aircraftStore.selectedIcao) continue;
          if (ns.lon == null || ns.lat == null) continue;

          ac.state = ns;
          ac.lastServerUpdate = nowSec;
          ac.extrapolatedPos = aircraftStore.computeExtrapolatedPosition(ns, ns.timePosition || nowSec, nowSec);

          const alt = ns.altitude != null ? ns.altitude : (ac.lastKnownAlt || 0);
          if (ns.altitude != null) ac.lastKnownAlt = ns.altitude;
          const last = ac.history.length > 0 ? ac.history[ac.history.length - 1] : null;
          const moved = !last
            || Math.abs(ns.lon - last.lon) > 0.0005
            || Math.abs(ns.lat - last.lat) > 0.0005
            || Math.abs(alt - last.alt) > 30;
          if (moved) ac.history.push({ lon: ns.lon, lat: ns.lat, alt, time: nowSec });

          const currentPos = ac.extrapolatedPos || Cartesian3.fromDegrees(ns.lon, ns.lat, alt);
          aircraftStore.updateExtrapolationTrail(aircraftStore.selectedIcao, ac, currentPos);
          break;
        }
        aircraftStore.renderAircraft(new Set([aircraftStore.selectedIcao]));
      }
    } catch (err) {
      console.warn('[Poll] Selected aircraft poll error:', err);
    } finally {
      _selectedPollInFlight = false;
    }
  }

  // ---- Track fetch queue ----

  async function fetchNextTrack(): Promise<void> {
    if (trackFetchQueue.value.length === 0) return;
    const icao24 = trackFetchQueue.value.shift()!;
    const ac = aircraftStore.aircraft.get(icao24);
    if (!ac) return;

    const token = await getOpenSkyToken(
      settingsStore.settings.openskyClientId,
      settingsStore.settings.openskyClientSecret,
    );
    const data = await getTrack(icao24, token);
    if (!('error' in data) && data.path) {
      ac.granularTrack = data as any;
      ac.lastTrackFetch = Date.now() / 1000;
      aircraftStore.renderAircraft();
    }
  }

  // ---- Unified tick ----

  function tick(): void {
    const now = Date.now();

    // 1. Always extrapolate positions
    aircraftStore.extrapolatePositions();

    // Safety valve: force-reset stuck guards
    if (_pollInFlight && now - _lastBulkPollMs > 30_000) {
      _pollInFlight = false;
    }
    if (_selectedPollInFlight && now - _lastSelectedPollApiMs > 30_000) {
      _selectedPollInFlight = false;
    }

    if (now < rateLimitedUntil.value) return;

    // 2. Bulk poll when aircraft display is on
    if (settingsStore.settings.aircraftEnabled) {
      const elapsed = aircraftStore.lastPollTime
        ? now - aircraftStore.lastPollTime.getTime()
        : Infinity;
      if (elapsed >= pollInterval) {
        pollStates();
      }
    }

    // 3. Selected aircraft poll — always, regardless of display toggle
    if (aircraftStore.selectedIcao && now - lastSelectedPollMs >= SELECTED_POLL_INTERVAL) {
      lastSelectedPollMs = now;
      const ac = aircraftStore.aircraft.get(aircraftStore.selectedIcao);
      const coveredByBulk = settingsStore.settings.aircraftEnabled
        && ac
        && aircraftStore.lastPollBounds
        && ac.state.lat != null
        && ac.state.lon != null
        && ac.state.lat >= aircraftStore.lastPollBounds.south
        && ac.state.lat <= aircraftStore.lastPollBounds.north
        && ac.state.lon >= aircraftStore.lastPollBounds.west
        && ac.state.lon <= aircraftStore.lastPollBounds.east;
      if (!coveredByBulk) {
        pollSelectedAircraft();
      }
    }

    // 4. Track queue processing
    if (trackFetchQueue.value.length > 0 && now - lastTrackFetchMs >= TRACK_FETCH_INTERVAL) {
      lastTrackFetchMs = now;
      fetchNextTrack();
    }
  }

  // ---- Timer management ----

  function ensureTick(): void {
    if (tickTimer) return;
    const v = viewerRef.value;
    const camHeight = v?.camera.positionCartographic
      ? v.camera.positionCartographic.height
      : 4860000;
    positionUpdateInterval = computePositionUpdateInterval(camHeight);
    tickTimer = setInterval(tick, positionUpdateInterval);
  }

  function stopTick(): void {
    if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
  }

  function setPollInterval(ms: number): void {
    pollInterval = ms;
  }

  function setTickInterval(ms: number): void {
    positionUpdateInterval = ms;
    if (!tickTimer) return;
    clearInterval(tickTimer);
    tickTimer = setInterval(tick, ms);
  }

  function startPolling(): void {
    if (!settingsStore.settings.aircraftEnabled) return;

    const v = viewerRef.value;
    const camHeight = v?.camera.positionCartographic
      ? v.camera.positionCartographic.height
      : 4860000;
    lastPollHeight = camHeight;
    lastPositionUpdateHeight = camHeight;
    const pollMs = computePollInterval(camHeight);
    const tickMs = computePositionUpdateInterval(camHeight);
    setPollInterval(pollMs);
    setTickInterval(tickMs);

    pollStates();
    ensureTick();
  }

  function stopPolling(): void {
    stopTick();
    _pollInFlight = false;
    _selectedPollInFlight = false;
  }

  function pauseAllTimers(): void {
    stopTick();
  }

  function resumeAllTimers(): void {
    ensureTick();
    if (settingsStore.settings.aircraftEnabled) pollStates();
  }

  return {
    startPolling,
    stopPolling,
    ensureTick,
    stopTick,
    setPollInterval,
    setTickInterval,
    pollStates,
    trackFetchQueue,
    rateLimitedUntil,
    pauseAllTimers,
    resumeAllTimers,
  };
}
