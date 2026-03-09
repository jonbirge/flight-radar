/**
 * Flight Plan Pinia store.
 * Handles aircraft click selection, info panel state, FlightAware enrichment,
 * route polyline display, search history, and natural language query parsing.
 *
 * Ported from shared/radar-flightplan.js.
 */

import { defineStore } from 'pinia';
import { ref, shallowRef, type Ref } from 'vue';
import {
  Viewer,
  Entity,
  Cartesian3,
  Cartesian2,
  Color,
  HeadingPitchRange,
  PolylineDashMaterialProperty,
  LabelStyle,
  VerticalOrigin,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  Math as CesiumMath,
  defined as cesiumDefined,
} from 'cesium';
import { useSettingsStore } from '@/stores/settings';
import { useAircraftStore, type AircraftRecord } from '@/stores/aircraft';
import type { AircraftState, ViewBounds } from '@/core/types';
import { parseState } from '@/core/opensky';
import {
  getFlightPlan,
  getFlightRoute,
  getFlightTrack,
  searchFlights,
  type FAFlightsResponse,
} from '@/services/flightaware-api';
import { getStates, getOpenSkyToken } from '@/services/opensky-api';

// ============================================================
// Types
// ============================================================

export interface FlightPlanRoute {
  flight: FlightRecord;
  originCoords: { lat: number; lon: number } | null;
  destCoords: { lat: number; lon: number } | null;
}

export interface FlightRecord {
  fa_flight_id?: string;
  ident?: string;
  ident_iata?: string;
  origin?: AirportRef;
  destination?: AirportRef;
  route?: string;
  filed_altitude?: number | null;
  aircraft_type?: string;
  status?: string;
  progress_percent?: number | null;
  scheduled_out?: string;
  estimated_out?: string;
  actual_out?: string;
  actual_off?: string;
  scheduled_in?: string;
  estimated_in?: string;
  actual_in?: string;
  actual_on?: string;
  last_position?: {
    latitude?: number;
    longitude?: number;
    groundspeed?: number;
    altitude?: number;
  };
  position_only?: boolean;
}

export interface AirportRef {
  code?: string;
  code_iata?: string;
  code_icao?: string;
  name?: string;
  latitude?: number;
  longitude?: number;
}

export interface NLSearchParams {
  origin: string | null;
  destination: string | null;
  airline: string | null;
  start: string | null;
  end: string | null;
}

// ============================================================
// Constants
// ============================================================

const MAX_SEARCH_HISTORY = 10;
const DEFAULT_CRUISE_KNOTS = 450;
const MIN_PROGRESS_FOR_ESTIMATE = 5;

// Airline name → ICAO operator code mapping
const AIRLINE_CODES: Record<string, string> = {
  'united': 'UAL', 'ual': 'UAL',
  'american': 'AAL', 'aal': 'AAL',
  'delta': 'DAL', 'dal': 'DAL',
  'southwest': 'SWA', 'swa': 'SWA',
  'jetblue': 'JBU', 'jbu': 'JBU',
  'alaska': 'ASA', 'asa': 'ASA',
  'spirit': 'NKS', 'nks': 'NKS',
  'frontier': 'FFT', 'fft': 'FFT',
  'hawaiian': 'HAL', 'hal': 'HAL',
  'allegiant': 'AAY', 'aay': 'AAY',
  'sun country': 'SCX', 'scx': 'SCX',
  'breeze': 'MXX', 'mxx': 'MXX',
};

// ============================================================
// Store
// ============================================================

export const useFlightPlanStore = defineStore('flightplan', () => {
  const settingsStore = useSettingsStore();
  const aircraftStore = useAircraftStore();

  // ---- State ----
  const flightPlanEntities = ref<Entity[]>([]);
  const activeFlightPlan = ref<FAFlightsResponse | null>(null);
  const selectedRouteFlight = ref<FlightRecord | null>(null);
  const timelineRoutePoints = ref<Array<{ lon: number; lat: number; alt: number }>>([]);
  const isSearching = ref(false);
  const searchError = ref<string | null>(null);

  // Info panel state (reactive for Vue components)
  const infoPanelVisible = ref(false);
  const infoPanelData = ref<{
    callsign: string;
    details: Record<string, string>;
    isFlightPlan: boolean;
  } | null>(null);

  // Flight results for multi-result display
  const flightResults = ref<FlightRecord[]>([]);
  const flightResultsVisible = ref(false);

  const _viewer = shallowRef<Viewer | null>(null);
  let _clickHandler: ScreenSpaceEventHandler | null = null;

  // Cached airport data for coordinate lookups
  let _cachedAirportData: Array<{ icao: string; iata?: string; lat: number; lon: number }> | null = null;
  let _cachedWaypointData: Array<{ id: string; name?: string; lat: number; lon: number }> | null = null;

  // ---- Viewer binding ----

  function setViewer(v: Viewer | null): void {
    _viewer.value = v;
    if (v) {
      setupClickHandler(v);
    }
  }

  function setAirportData(data: Array<{ icao: string; iata?: string; lat: number; lon: number }>): void {
    _cachedAirportData = data;
  }

  function setWaypointData(data: Array<{ id: string; name?: string; lat: number; lon: number }>): void {
    _cachedWaypointData = data;
  }

  // ---- Click handler ----

  function setupClickHandler(v: Viewer): void {
    if (_clickHandler) _clickHandler.destroy();
    let focusTime = 0;
    window.addEventListener('focus', () => { focusTime = Date.now(); });

    _clickHandler = new ScreenSpaceEventHandler(v.scene.canvas);
    _clickHandler.setInputAction((click: { position: Cartesian2 }) => {
      if (Date.now() - focusTime < 300) return;
      const picked = v.scene.pick(click.position);
      if (cesiumDefined(picked) && picked.id && picked.id.id) {
        const id = picked.id.id as string;
        if (id.startsWith('ac-')) {
          selectAircraft(id.replace('ac-', ''));
        }
      }
    }, ScreenSpaceEventType.LEFT_CLICK);
  }

  // ---- Aircraft selection ----

  function selectAircraft(icao: string): void {
    const ac = aircraftStore.aircraft.get(icao);
    if (!ac) return;

    const prevSelected = aircraftStore.selectedIcao;
    aircraftStore.selectedIcao = icao;

    const s = ac.state;
    updateInfoPanel(icao, s);

    // Re-render to apply highlight
    if (prevSelected !== icao) {
      const toRefresh = new Set([icao]);
      if (prevSelected) toRefresh.add(prevSelected);

      const v = _viewer.value;
      if (v) {
        v.entities.suspendEvents();
        try {
          for (const rid of toRefresh) {
            const rac = aircraftStore.aircraft.get(rid);
            if (rac) {
              if (rac.entity) { v.entities.remove(rac.entity); rac.entity = null; }
              rac._iconKey = ''; rac._labelText = '';
              aircraftStore.removeTrailEntities(rac);
            }
          }
        } finally {
          v.entities.resumeEvents();
        }
        aircraftStore.renderAircraft(toRefresh);
      }

      // Clear previous flight plan route
      if (prevSelected && prevSelected !== icao && flightPlanEntities.value.length > 0) {
        clearFlightPlanRoute();
      }

      // Enrich with FlightAware data
      const cs = (s.callsign || '').trim();
      if (cs && cs.toUpperCase() !== (aircraftStore.searchedFlightIdent || '')) {
        enrichSelectedWithFlightAware(icao, cs);
      }
    }
  }

  function deselectAircraft(): void {
    const v = _viewer.value;
    const prevIcao = aircraftStore.selectedIcao;
    aircraftStore.selectedIcao = null;
    infoPanelVisible.value = false;
    infoPanelData.value = null;

    if (prevIcao && v) {
      v.entities.suspendEvents();
      try {
        const rac = aircraftStore.aircraft.get(prevIcao);
        if (rac) {
          if (rac.entity) { v.entities.remove(rac.entity); rac.entity = null; }
          rac._iconKey = ''; rac._labelText = '';
          aircraftStore.removeTrailEntities(rac);
        }
      } finally {
        v.entities.resumeEvents();
      }

      if (!settingsStore.settings.aircraftEnabled) {
        aircraftStore.aircraft.delete(prevIcao);
      } else {
        aircraftStore.renderAircraft(new Set([prevIcao]));
      }
    }
  }

  // ---- Info panel updates ----

  function updateInfoPanel(icao: string, s: AircraftState): void {
    const feetAlt = s.altitude ? Math.round(s.altitude * 3.28084) : null;
    const knots = s.velocity ? Math.round(s.velocity * 1.94384) : null;
    const fpm = s.verticalRate ? Math.round(s.verticalRate * 196.85) : null;

    infoPanelVisible.value = true;
    infoPanelData.value = {
      callsign: s.callsign || icao,
      details: {
        ALT: feetAlt != null ? feetAlt.toLocaleString() + ' ft' : '---',
        'GND SPD': knots != null ? knots + ' kts' : '---',
        HDG: s.heading != null ? Math.round(s.heading) + '°' : '---',
        VS: fpm != null ? (fpm > 0 ? '+' : '') + fpm + ' fpm' : '---',
        LAT: s.lat != null ? s.lat.toFixed(4) : '---',
        LON: s.lon != null ? s.lon.toFixed(4) : '---',
        'LAST POLL': aircraftStore.lastPollTime
          ? aircraftStore.lastPollTime.toLocaleTimeString('en-US', { hour12: false })
          : '---',
        'ADS-B': s.lastContact
          ? new Date(s.lastContact * 1000).toLocaleTimeString('en-US', { hour12: false })
          : '---',
      },
      isFlightPlan: false,
    };

    if (selectedRouteFlight.value) {
      addRouteTiming(selectedRouteFlight.value);
    }
  }

  function addRouteTiming(flight: FlightRecord): void {
    if (!infoPanelData.value) return;

    const origin = flight.origin;
    const dest = flight.destination;
    const originCode = origin ? (origin.code_iata || origin.code_icao || '??') : '??';
    const destCode = dest ? (dest.code_iata || dest.code_icao || '??') : '??';

    const depStr = flight.actual_out || flight.estimated_out || flight.scheduled_out;
    const arrStr = flight.estimated_in || flight.scheduled_in || estimateArrivalTime(flight);

    const now = Date.now();
    const depTime = depStr ? new Date(depStr) : null;
    const arrTime = arrStr ? new Date(arrStr) : null;

    const elapsed = depTime ? formatDurationMs(now - depTime.getTime()) : '---';
    const remaining = arrTime ? formatDurationMs(arrTime.getTime() - now) : '---';
    const eta = arrTime
      ? arrTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZoneName: 'short' })
      : '---';

    const filedAlt = flight.filed_altitude != null ? `FL${flight.filed_altitude}` : null;

    // Prepend route details
    const routeDetails: Record<string, string> = {
      ROUTE: `${originCode} → ${destCode}`,
    };
    if (filedAlt) routeDetails['FILED ALT'] = filedAlt;
    routeDetails['ELAPSED'] = elapsed;
    routeDetails['REMAINING'] = remaining;
    routeDetails['ETA'] = eta;

    infoPanelData.value.details = { ...routeDetails, ...infoPanelData.value.details };
  }

  // ---- FlightAware enrichment ----

  async function enrichSelectedWithFlightAware(icao: string, callsign: string): Promise<void> {
    try {
      const apiKey = settingsStore.settings.flightawareApiKey;
      const data = await getFlightPlan(callsign.trim(), apiKey || undefined);
      if ('error' in data || !data.flights || data.flights.length === 0) return;

      // Bail if user deselected during fetch
      if (aircraftStore.selectedIcao !== icao) return;

      const result = displayFlightPlanRoute(data);
      aircraftStore.searchedIcao = icao;
      if (result?.flight) {
        selectedRouteFlight.value = result.flight as FlightRecord;
        if (infoPanelData.value) {
          addRouteTiming(result.flight as FlightRecord);
        }
      }
    } catch (err) {
      console.warn('[FlightPlan] Enrichment error:', err);
    }
  }

  // ---- Flight plan route display ----

  function clearFlightPlanRoute(): void {
    const v = _viewer.value;
    if (v) {
      v.entities.suspendEvents();
      try {
        for (const e of flightPlanEntities.value) v.entities.remove(e);
      } finally {
        v.entities.resumeEvents();
      }
    }
    flightPlanEntities.value = [];
    timelineRoutePoints.value = [];
    activeFlightPlan.value = null;
    selectedRouteFlight.value = null;
    aircraftStore.searchedFlightIdent = null;
    aircraftStore.searchedIcao = null;
  }

  function displayFlightPlanRoute(
    flightData: FAFlightsResponse,
    preSelectedFlight?: FlightRecord,
  ): FlightPlanRoute | null {
    clearFlightPlanRoute();
    activeFlightPlan.value = flightData;

    const flights = flightData.flights || [];
    if (flights.length === 0) return null;

    const flight = (preSelectedFlight || pickBestFlight(flights as FlightRecord[])) as FlightRecord;
    aircraftStore.searchedFlightIdent = (flight.ident || flight.ident_iata || '').trim().toUpperCase();

    const theme = settingsStore.resolvedTheme;
    const routeColor = theme === 'light'
      ? Color.fromCssColorString('#1565C0').withAlpha(0.8)
      : Color.fromCssColorString('#42A5F5').withAlpha(0.8);
    const waypointColor = theme === 'light'
      ? Color.fromCssColorString('#1565C0')
      : Color.fromCssColorString('#64B5F6');

    const cruiseAltMeters = flight.filed_altitude != null
      ? flight.filed_altitude * 100 * 0.3048
      : null;

    const originCoords = lookupAirportCoords(flight.origin);
    const destCoords = lookupAirportCoords(flight.destination);

    drawFlightPlanMarkers(flight.origin, flight.destination, originCoords, destCoords, waypointColor);

    if (flightPlanEntities.value.length > 0) {
      flyToRouteOverview();
    }

    // Fetch decoded route
    if (flight.fa_flight_id) {
      fetchAndDisplayFiledRoute(flight.fa_flight_id, flight, originCoords, destCoords, routeColor, waypointColor, cruiseAltMeters);
    } else if (originCoords && destCoords) {
      drawRouteFromString(flight.route, originCoords, destCoords, routeColor, waypointColor, cruiseAltMeters);
    }

    return { flight, originCoords, destCoords };
  }

  // ---- Route drawing helpers ----

  function drawFlightPlanMarkers(
    origin: AirportRef | undefined,
    dest: AirportRef | undefined,
    originCoords: { lat: number; lon: number } | null,
    destCoords: { lat: number; lon: number } | null,
    waypointColor: Color,
  ): void {
    const v = _viewer.value;
    if (!v) return;
    const theme = settingsStore.resolvedTheme;
    const outlineColor = theme === 'light' ? Color.WHITE : Color.BLACK;

    v.entities.suspendEvents();
    try {
      if (originCoords) {
        const label = (origin && (origin.code_iata || origin.code_icao || origin.code)) || 'DEP';
        flightPlanEntities.value.push(v.entities.add({
          position: Cartesian3.fromDegrees(originCoords.lon, originCoords.lat),
          point: { pixelSize: 10, color: Color.LIME, outlineColor: Color.BLACK, outlineWidth: 1 },
          label: {
            text: label,
            font: 'bold 13px Roboto Flex, sans-serif',
            fillColor: waypointColor,
            outlineColor,
            outlineWidth: 3,
            style: LabelStyle.FILL_AND_OUTLINE,
            verticalOrigin: VerticalOrigin.BOTTOM,
            pixelOffset: new Cartesian2(0, -8),
          },
        }));
      }
      if (destCoords) {
        const label = (dest && (dest.code_iata || dest.code_icao || dest.code)) || 'ARR';
        flightPlanEntities.value.push(v.entities.add({
          position: Cartesian3.fromDegrees(destCoords.lon, destCoords.lat),
          point: { pixelSize: 10, color: Color.RED, outlineColor: Color.BLACK, outlineWidth: 1 },
          label: {
            text: label,
            font: 'bold 13px Roboto Flex, sans-serif',
            fillColor: waypointColor,
            outlineColor,
            outlineWidth: 3,
            style: LabelStyle.FILL_AND_OUTLINE,
            verticalOrigin: VerticalOrigin.BOTTOM,
            pixelOffset: new Cartesian2(0, -8),
          },
        }));
      }
    } finally {
      v.entities.resumeEvents();
    }
  }

  async function fetchAndDisplayFiledRoute(
    faFlightId: string,
    flight: FlightRecord,
    originCoords: { lat: number; lon: number } | null,
    destCoords: { lat: number; lon: number } | null,
    routeColor: Color,
    waypointColor: Color,
    cruiseAltMeters: number | null,
  ): Promise<void> {
    const v = _viewer.value;
    if (!v) return;
    const apiKey = settingsStore.settings.flightawareApiKey;

    try {
      const data = await getFlightRoute(faFlightId, apiKey || undefined);
      if (!('error' in data)) {
        const fixes = (data as any).fixes || (data as any).route || [];
        const validFixes = fixes.filter((f: any) => f.latitude != null && f.longitude != null);

        if (validFixes.length > 0) {
          const alt = cruiseAltMeters || 0;
          const routePositions: Cartesian3[] = [];
          timelineRoutePoints.value = [];

          if (originCoords) {
            routePositions.push(Cartesian3.fromDegrees(originCoords.lon, originCoords.lat, 0));
            timelineRoutePoints.value.push({ lon: originCoords.lon, lat: originCoords.lat, alt: 0 });
          }
          for (const fix of validFixes) {
            routePositions.push(Cartesian3.fromDegrees(fix.longitude, fix.latitude, alt));
            timelineRoutePoints.value.push({ lon: fix.longitude, lat: fix.latitude, alt });
          }
          if (destCoords) {
            routePositions.push(Cartesian3.fromDegrees(destCoords.lon, destCoords.lat, 0));
            timelineRoutePoints.value.push({ lon: destCoords.lon, lat: destCoords.lat, alt: 0 });
          }

          if (routePositions.length >= 2) {
            v.entities.suspendEvents();
            try {
              flightPlanEntities.value.push(v.entities.add({
                polyline: {
                  positions: routePositions,
                  width: 3,
                  material: new PolylineDashMaterialProperty({ color: routeColor, dashLength: 16 }),
                  clampToGround: false,
                },
              }));
              for (const fix of validFixes) {
                flightPlanEntities.value.push(v.entities.add({
                  position: Cartesian3.fromDegrees(fix.longitude, fix.latitude, 0),
                  point: { pixelSize: 4, color: waypointColor },
                }));
              }
            } finally {
              v.entities.resumeEvents();
            }
            flyToRouteOverview();
            return;
          }
        }
      }
    } catch (err) {
      console.warn('[FlightPlan] /route fetch error:', err);
    }

    // Fallback: parse route string
    drawRouteFromString(flight.route, originCoords, destCoords, routeColor, waypointColor, cruiseAltMeters);
  }

  function drawRouteFromString(
    routeStr: string | undefined,
    originCoords: { lat: number; lon: number } | null,
    destCoords: { lat: number; lon: number } | null,
    routeColor: Color,
    waypointColor: Color,
    cruiseAltMeters: number | null,
  ): void {
    const v = _viewer.value;
    if (!v) return;

    const alt = cruiseAltMeters || 0;
    const routeWaypoints: Array<{ name: string; lon: number; lat: number }> = [];
    if (routeStr && _cachedWaypointData && _cachedWaypointData.length > 0) {
      const wpNames = routeStr.split(/\s+/).filter(w => w.length > 0);
      for (const wpName of wpNames) {
        const wp = _cachedWaypointData.find(w => w.id === wpName || w.name === wpName);
        if (wp && wp.lon != null && wp.lat != null) {
          routeWaypoints.push({ name: wpName, lon: wp.lon, lat: wp.lat });
        }
      }
    }

    const routePositions: Cartesian3[] = [];
    timelineRoutePoints.value = [];
    if (originCoords) {
      routePositions.push(Cartesian3.fromDegrees(originCoords.lon, originCoords.lat, 0));
      timelineRoutePoints.value.push({ lon: originCoords.lon, lat: originCoords.lat, alt: 0 });
    }
    for (const wp of routeWaypoints) {
      routePositions.push(Cartesian3.fromDegrees(wp.lon, wp.lat, alt));
      timelineRoutePoints.value.push({ lon: wp.lon, lat: wp.lat, alt });
    }
    if (destCoords) {
      routePositions.push(Cartesian3.fromDegrees(destCoords.lon, destCoords.lat, 0));
      timelineRoutePoints.value.push({ lon: destCoords.lon, lat: destCoords.lat, alt: 0 });
    }

    if (routePositions.length < 2) return;

    v.entities.suspendEvents();
    try {
      flightPlanEntities.value.push(v.entities.add({
        polyline: {
          positions: routePositions,
          width: 3,
          material: new PolylineDashMaterialProperty({ color: routeColor, dashLength: 16 }),
          clampToGround: false,
        },
      }));
      for (const wp of routeWaypoints) {
        flightPlanEntities.value.push(v.entities.add({
          position: Cartesian3.fromDegrees(wp.lon, wp.lat, 0),
          point: { pixelSize: 4, color: waypointColor },
        }));
      }
    } finally {
      v.entities.resumeEvents();
    }
    flyToRouteOverview();
  }

  function flyToRouteOverview(): void {
    const v = _viewer.value;
    if (!v || flightPlanEntities.value.length === 0) return;
    v.flyTo(flightPlanEntities.value, {
      duration: 1.5,
      offset: new HeadingPitchRange(0, -Math.PI / 2, 0),
    });
  }

  // ---- Airport coordinate lookup ----

  function lookupAirportCoords(airportObj?: AirportRef): { lat: number; lon: number } | null {
    if (!airportObj || !_cachedAirportData) return null;
    const icao = airportObj.code_icao || airportObj.code || '';
    const iata = airportObj.code_iata || '';
    const ap = _cachedAirportData.find(a =>
      (icao && a.icao === icao) || (iata && a.iata === iata),
    );
    if (ap && ap.lat != null && ap.lon != null) {
      return { lat: ap.lat, lon: ap.lon };
    }
    if (airportObj.latitude != null && airportObj.longitude != null) {
      return { lat: airportObj.latitude, lon: airportObj.longitude };
    }
    return null;
  }

  // ---- Flight picking ----

  function pickBestFlight(flights: FlightRecord[]): FlightRecord {
    // 1. En-route
    const enRoute = flights.find(f => {
      if (f.progress_percent != null) return f.progress_percent > 0 && f.progress_percent < 100;
      return !!(f.actual_off && !f.actual_on);
    });
    if (enRoute) return enRoute;

    // 2. Upcoming
    const upcoming = flights
      .filter(f => {
        if (f.progress_percent != null) return f.progress_percent === 0;
        return !f.actual_off && !f.actual_on;
      })
      .sort((a, b) => {
        const da = new Date(a.scheduled_out || a.estimated_out || a.actual_off || '0').getTime();
        const db = new Date(b.scheduled_out || b.estimated_out || b.actual_off || '0').getTime();
        return da - db;
      });
    if (upcoming.length > 0) return upcoming[0];

    // 3. Not yet arrived
    const now = new Date();
    const notArrived = flights
      .filter(f => {
        const arr = f.scheduled_in || f.estimated_in || f.actual_on;
        if (!arr) return false;
        if (f.progress_percent != null && f.progress_percent >= 100) return false;
        return new Date(arr) > now;
      })
      .sort((a, b) => {
        const da = new Date(a.scheduled_out || a.estimated_out || a.actual_off || a.scheduled_in || '0').getTime();
        const db = new Date(b.scheduled_out || b.estimated_out || b.actual_off || b.scheduled_in || '0').getTime();
        return da - db;
      });
    if (notArrived.length > 0) return notArrived[0];

    // 4. Fallback
    return flights[0];
  }

  // ---- Search ----

  async function searchFlightPlan(ident: string): Promise<void> {
    if (!ident || ident.trim().length === 0) return;

    if (isNaturalLanguageQuery(ident)) {
      await searchFlightsByNL(ident.trim());
      return;
    }

    isSearching.value = true;
    searchError.value = null;

    try {
      const apiKey = settingsStore.settings.flightawareApiKey;
      const data = await getFlightPlan(ident.trim(), apiKey || undefined);
      if ('error' in data) {
        searchError.value = data.error;
        return;
      }

      if (!data.flights || data.flights.length === 0) {
        searchError.value = `No flights found for "${ident.trim()}"`;
        return;
      }

      addSearchHistory(ident.trim().toUpperCase());

      if (data.flights.length === 1) {
        const result = displayFlightPlanRoute(data);
        if (result) await searchForLiveAircraft(result);
      } else {
        flightResults.value = data.flights as FlightRecord[];
        flightResultsVisible.value = true;
      }
    } catch (err) {
      searchError.value = 'Flight search failed';
      console.error('[FlightPlan] Search error:', err);
    } finally {
      isSearching.value = false;
    }
  }

  async function searchForLiveAircraft(result: FlightPlanRoute): Promise<void> {
    const f = result.flight;
    const isScheduled = f.status === 'Scheduled'
      || (f.progress_percent != null && f.progress_percent === 0)
      || (!f.actual_off && !f.actual_on && f.progress_percent == null);

    if (isScheduled) {
      showFlightPlanInfo(f);
      return;
    }

    if (!selectSearchedAircraft()) {
      await findAndSelectViaOpenSky(f, result.originCoords, result.destCoords);
      if (!aircraftStore.selectedIcao) {
        showFlightPlanInfo(f);
      }
    }
  }

  function selectSearchedAircraft(): boolean {
    if (!aircraftStore.searchedFlightIdent) return false;
    for (const [icao, ac] of aircraftStore.aircraft) {
      const cs = (ac.state.callsign || '').trim().toUpperCase();
      if (cs === aircraftStore.searchedFlightIdent) {
        aircraftStore.searchedIcao = icao;
        selectAircraft(icao);
        return true;
      }
    }
    return false;
  }

  async function findAndSelectViaOpenSky(
    flight: FlightRecord,
    originCoords: { lat: number; lon: number } | null,
    destCoords: { lat: number; lon: number } | null,
  ): Promise<void> {
    // Try FlightAware track for position
    if (flight.fa_flight_id) {
      try {
        const apiKey = settingsStore.settings.flightawareApiKey;
        const trackData = await getFlightTrack(flight.fa_flight_id, apiKey || undefined);
        if (!('error' in trackData) && trackData.positions && trackData.positions.length > 0) {
          const lastPos = trackData.positions[trackData.positions.length - 1];
          if (lastPos.latitude != null && lastPos.longitude != null) {
            await fetchSingleAircraftForSearch({ latitude: lastPos.latitude, longitude: lastPos.longitude });
            return;
          }
        }
      } catch (err) {
        console.warn('[FlightPlan] Track fetch failed:', err);
      }
    }

    // Try last_position
    if (flight.last_position?.latitude != null && flight.last_position?.longitude != null) {
      await fetchSingleAircraftForSearch(flight.last_position);
      return;
    }

    // Route corridor fallback
    if (originCoords && destCoords) {
      const midLat = (originCoords.lat + destCoords.lat) / 2;
      const midLon = (originCoords.lon + destCoords.lon) / 2;
      const latSpan = Math.abs(originCoords.lat - destCoords.lat) / 2 + 5;
      const lonSpan = Math.abs(originCoords.lon - destCoords.lon) / 2 + 5;
      await fetchSingleAircraftForSearch({ latitude: midLat, longitude: midLon }, latSpan, lonSpan);
    }
  }

  async function fetchSingleAircraftForSearch(
    lastPos: { latitude: number; longitude: number },
    latPad = 10,
    lonPad = 10,
  ): Promise<void> {
    const bounds: ViewBounds = {
      south: Math.max(lastPos.latitude - latPad, -90),
      north: Math.min(lastPos.latitude + latPad, 90),
      west: Math.max(lastPos.longitude - lonPad, -180),
      east: Math.min(lastPos.longitude + lonPad, 180),
    };

    try {
      const token = await getOpenSkyToken(
        settingsStore.settings.openskyClientId,
        settingsStore.settings.openskyClientSecret,
      );
      const data = await getStates(bounds, token);
      if ('error' in data || !data.states) return;

      const target = aircraftStore.searchedFlightIdent;
      const now = Date.now() / 1000;

      for (const raw of data.states) {
        const s = parseState(raw);
        if (s.lon == null || s.lat == null) continue;
        const cs = (s.callsign || '').trim().toUpperCase();
        if (cs !== target) continue;

        const ac = aircraftStore.createAircraftRecord(s);
        aircraftStore.aircraft.set(s.icao24, ac);
        aircraftStore.renderAircraft(new Set([s.icao24]));
        break;
      }
    } catch (err) {
      console.warn('[FlightPlan] OpenSky query failed:', err);
    }
    selectSearchedAircraft();
  }

  // ---- Flight plan info display ----

  function showFlightPlanInfo(flight: FlightRecord): void {
    selectedRouteFlight.value = flight;
    const ident = flight.ident || flight.ident_iata || '---';

    const origin = flight.origin;
    const dest = flight.destination;
    const originCode = origin ? (origin.code_iata || origin.code_icao || '??') : '??';
    const destCode = dest ? (dest.code_iata || dest.code_icao || '??') : '??';

    const details: Record<string, string> = {
      ROUTE: `${originCode} → ${destCode}`,
      'ACFT TYPE': flight.aircraft_type || '---',
      STATUS: flight.status || '---',
      PROGRESS: flight.progress_percent != null ? flight.progress_percent + '%' : '---',
    };

    if (flight.filed_altitude != null) {
      details['FILED ALT'] = 'FL' + flight.filed_altitude;
    }

    if (flight.last_position?.groundspeed != null) {
      details['GND SPD'] = flight.last_position.groundspeed + ' kts';
    }

    const depStr = flight.actual_out || flight.scheduled_out;
    const arrStr = flight.estimated_in || flight.scheduled_in || estimateArrivalTime(flight);
    const fmtOpts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false };
    details['DEPART'] = depStr ? new Date(depStr).toLocaleString('en-US', fmtOpts) : '---';
    details['ARRIVE'] = arrStr ? new Date(arrStr).toLocaleString('en-US', fmtOpts) : '---';

    infoPanelVisible.value = true;
    infoPanelData.value = {
      callsign: ident,
      details,
      isFlightPlan: true,
    };
  }

  // ---- NL search ----

  function isNaturalLanguageQuery(query: string): boolean {
    if (!query) return false;
    if (query.includes(' ')) return true;
    return /\b(from|to|departing|arriving|flights?|between|today|tomorrow|yesterday|morning|afternoon|evening)\b/i.test(query);
  }

  function parseNaturalLanguage(query: string): NLSearchParams {
    const q = query.toLowerCase().trim();
    const result: NLSearchParams = { origin: null, destination: null, airline: null, start: null, end: null };

    const originMatch = q.match(/(?:from\s+|departing\s+(?:from\s+)?|out\s+of\s+)([a-z]{3,4})\b/);
    if (originMatch) result.origin = originMatch[1].toUpperCase();

    const destMatch = q.match(/(?:\bto\s+|arriving\s+(?:at\s+|in\s+)?|bound\s+for\s+)([a-z]{3,4})\b/);
    if (destMatch) result.destination = destMatch[1].toUpperCase();

    if (!result.origin && result.destination) {
      const implicitOrigin = q.match(/\b([a-z]{3,4})\s+to\s+[a-z]{3,4}\b/);
      if (implicitOrigin) result.origin = implicitOrigin[1].toUpperCase();
    }

    for (const [name, icao] of Object.entries(AIRLINE_CODES)) {
      if (q.includes(name)) {
        result.airline = icao;
        break;
      }
    }

    // Time window
    const now = new Date();
    const localMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const hasExplicitTime = /\b(today|tomorrow|yesterday|morning|afternoon|evening)\b/.test(q)
      || /between\s+\d/.test(q);

    if (hasExplicitTime) {
      let targetDate = localMidnight;
      if (/\btomorrow\b/.test(q)) {
        targetDate = new Date(localMidnight.getTime() + 86400000);
      } else if (/\byesterday\b/.test(q)) {
        targetDate = new Date(localMidnight.getTime() - 86400000);
      }

      if (/\bmorning\b/.test(q)) {
        result.start = new Date(targetDate.getTime() + 6 * 3600000).toISOString();
        result.end = new Date(targetDate.getTime() + 12 * 3600000).toISOString();
      } else if (/\bafternoon\b/.test(q)) {
        result.start = new Date(targetDate.getTime() + 12 * 3600000).toISOString();
        result.end = new Date(targetDate.getTime() + 18 * 3600000).toISOString();
      } else if (/\bevening\b/.test(q)) {
        result.start = new Date(targetDate.getTime() + 18 * 3600000).toISOString();
        result.end = new Date(targetDate.getTime() + 24 * 3600000).toISOString();
      } else {
        result.start = targetDate.toISOString();
        result.end = new Date(targetDate.getTime() + 86400000).toISOString();
      }
    } else {
      result.start = new Date(now.getTime() - 6 * 3600000).toISOString();
      result.end = new Date(now.getTime() + 12 * 3600000).toISOString();
    }

    return result;
  }

  function resolveToIcao(code: string): string {
    if (!code || !_cachedAirportData) return code;
    const upper = code.toUpperCase();
    const ap = _cachedAirportData.find(a =>
      (a.iata && a.iata === upper) || (a.icao && a.icao === upper),
    );
    return ap ? ap.icao : upper;
  }

  function buildAdvancedQuery(params: NLSearchParams): string {
    const parts: string[] = [];
    if (params.origin) parts.push(`{= orig ${resolveToIcao(params.origin)}}`);
    if (params.destination) parts.push(`{= dest ${resolveToIcao(params.destination)}}`);
    if (params.airline) parts.push(`{match ident ${params.airline}*}`);
    if (params.start) parts.push(`{> ogtd ${Math.floor(new Date(params.start).getTime() / 1000)}}`);
    if (params.end) parts.push(`{< ogtd ${Math.floor(new Date(params.end).getTime() / 1000)}}`);
    parts.push('{!= status X}');
    return parts.join(' ');
  }

  async function searchFlightsByNL(query: string): Promise<void> {
    const params = parseNaturalLanguage(query);
    if (!params.origin && !params.destination && !params.airline) {
      searchError.value = 'Could not parse search. Try "flights from SFO to LAX today" or a flight number like UAL123.';
      return;
    }

    isSearching.value = true;
    searchError.value = null;

    try {
      const advQuery = buildAdvancedQuery(params);
      const apiKey = settingsStore.settings.flightawareApiKey;
      const data = await searchFlights(advQuery, apiKey || undefined);
      if ('error' in data) {
        searchError.value = data.error;
        return;
      }

      const flights = data.flights || [];
      if (flights.length === 0) {
        searchError.value = `No flights found for "${query}"`;
        return;
      }

      addSearchHistory(query.trim());

      if (flights.length === 1) {
        const result = displayFlightPlanRoute(data);
        if (result) await searchForLiveAircraft(result);
      } else {
        flightResults.value = flights as FlightRecord[];
        flightResultsVisible.value = true;
      }
    } catch (err) {
      searchError.value = 'Flight search failed';
      console.error('[FlightPlan] NL search error:', err);
    } finally {
      isSearching.value = false;
    }
  }

  // ---- Search history ----

  function addSearchHistory(ident: string): void {
    if (!ident) return;
    let history = [...(settingsStore.settings.searchHistory || [])];
    history = history.filter(h => h !== ident);
    history.unshift(ident);
    if (history.length > MAX_SEARCH_HISTORY) history = history.slice(0, MAX_SEARCH_HISTORY);
    settingsStore.update('searchHistory', history);
  }

  // ---- Utility ----

  function estimateArrivalTime(flight: FlightRecord): string | null {
    const depStr = flight.actual_out || flight.estimated_out || flight.scheduled_out;
    if (!depStr) return null;
    const depMs = new Date(depStr).getTime();
    if (isNaN(depMs)) return null;

    const now = Date.now();
    const progress = flight.progress_percent;
    if (progress != null && progress >= MIN_PROGRESS_FOR_ESTIMATE && progress < 100) {
      const elapsedMs = now - depMs;
      if (elapsedMs > 0) {
        return new Date(depMs + elapsedMs / (progress / 100)).toISOString();
      }
    }

    const originCoords = lookupAirportCoords(flight.origin);
    const destCoords = lookupAirportCoords(flight.destination);
    if (originCoords && destCoords) {
      const dLat = ((destCoords.lat - originCoords.lat) * Math.PI) / 180;
      const dLon = ((destCoords.lon - originCoords.lon) * Math.PI) / 180;
      const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(originCoords.lat * Math.PI / 180) *
        Math.cos(destCoords.lat * Math.PI / 180) *
        Math.sin(dLon / 2) ** 2;
      const distM = 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      const distNm = distM / 1852;

      const gs = (flight.last_position?.groundspeed && flight.last_position.groundspeed > 0)
        ? flight.last_position.groundspeed
        : DEFAULT_CRUISE_KNOTS;
      const flightTimeMs = (distNm / gs) * 3600000;
      return new Date(depMs + flightTimeMs).toISOString();
    }

    return null;
  }

  function formatDurationMs(ms: number): string {
    if (ms < 0) return '---';
    const totalMin = Math.round(ms / 60000);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  // ---- Cleanup ----

  function destroy(): void {
    if (_clickHandler) {
      _clickHandler.destroy();
      _clickHandler = null;
    }
    clearFlightPlanRoute();
  }

  return {
    // State
    flightPlanEntities,
    activeFlightPlan,
    selectedRouteFlight,
    timelineRoutePoints,
    isSearching,
    searchError,
    infoPanelVisible,
    infoPanelData,
    flightResults,
    flightResultsVisible,

    // Setup
    setViewer,
    setAirportData,
    setWaypointData,

    // Selection
    selectAircraft,
    deselectAircraft,
    selectSearchedAircraft,

    // Flight plan
    searchFlightPlan,
    clearFlightPlanRoute,
    displayFlightPlanRoute,
    flyToRouteOverview,

    // Utilities
    pickBestFlight,
    isNaturalLanguageQuery,
    parseNaturalLanguage,
    buildAdvancedQuery,

    // Cleanup
    destroy,
  };
});
