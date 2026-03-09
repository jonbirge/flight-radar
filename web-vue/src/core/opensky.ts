/**
 * OpenSky Network state vector parsing.
 * Ported from shared/data.js lines 74-99.
 *
 * Pure functions — no side effects, no framework dependencies.
 */

import type { AircraftState, RawStateVector } from './types';

/** Indices into the OpenSky state vector array */
export const IDX = {
  ICAO24: 0,
  CALLSIGN: 1,
  ORIGIN: 2,
  TIME_POS: 3,
  LAST_CONTACT: 4,
  LON: 5,
  LAT: 6,
  BARO_ALT: 7,
  ON_GROUND: 8,
  VELOCITY: 9,
  HEADING: 10,
  VERT_RATE: 11,
  SENSORS: 12,
  GEO_ALT: 13,
  SQUAWK: 14,
  SPI: 15,
  POS_SRC: 16,
} as const;

/** Parse a raw OpenSky state vector array into a typed AircraftState object */
export function parseState(s: RawStateVector): AircraftState {
  return {
    icao24: s[IDX.ICAO24] as string,
    callsign: ((s[IDX.CALLSIGN] as string) || '').trim(),
    lon: s[IDX.LON] as number | null,
    lat: s[IDX.LAT] as number | null,
    altitude: s[IDX.BARO_ALT] as number | null,
    geoAltitude: s[IDX.GEO_ALT] as number | null,
    onGround: s[IDX.ON_GROUND] as boolean,
    velocity: s[IDX.VELOCITY] as number | null,
    heading: s[IDX.HEADING] as number | null,
    verticalRate: s[IDX.VERT_RATE] as number | null,
    squawk: s[IDX.SQUAWK] as string | null,
    timePosition: s[IDX.TIME_POS] as number | null,
    lastContact: s[IDX.LAST_CONTACT] as number | null,
    origin: s[IDX.ORIGIN] as string | null,
  };
}
