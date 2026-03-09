import { describe, it, expect } from 'vitest';
import { parseState, IDX } from '@/core/opensky';

describe('parseState', () => {
  // Fixture: real OpenSky API state vector format
  const sampleVector = [
    'abc123',       // ICAO24
    'UAL123  ',     // CALLSIGN (padded with spaces)
    'United States', // ORIGIN
    1709900000,     // TIME_POS
    1709900001,     // LAST_CONTACT
    -73.7781,       // LON
    40.6413,        // LAT
    10668.0,        // BARO_ALT (meters, ~FL350)
    false,          // ON_GROUND
    230.5,          // VELOCITY (m/s)
    90.0,           // HEADING
    -2.5,           // VERT_RATE
    null,           // SENSORS
    10700.0,        // GEO_ALT
    '1200',         // SQUAWK
    false,          // SPI
    0,              // POS_SRC
  ];

  it('extracts icao24', () => {
    expect(parseState(sampleVector).icao24).toBe('abc123');
  });

  it('trims callsign whitespace', () => {
    expect(parseState(sampleVector).callsign).toBe('UAL123');
  });

  it('extracts coordinates', () => {
    const state = parseState(sampleVector);
    expect(state.lon).toBe(-73.7781);
    expect(state.lat).toBe(40.6413);
  });

  it('extracts altitude', () => {
    expect(parseState(sampleVector).altitude).toBe(10668.0);
  });

  it('extracts onGround boolean', () => {
    expect(parseState(sampleVector).onGround).toBe(false);
  });

  it('extracts velocity', () => {
    expect(parseState(sampleVector).velocity).toBe(230.5);
  });

  it('extracts heading', () => {
    expect(parseState(sampleVector).heading).toBe(90.0);
  });

  it('extracts verticalRate', () => {
    expect(parseState(sampleVector).verticalRate).toBe(-2.5);
  });

  it('extracts squawk', () => {
    expect(parseState(sampleVector).squawk).toBe('1200');
  });

  it('handles null callsign gracefully', () => {
    const nullCallsign = [...sampleVector];
    nullCallsign[IDX.CALLSIGN] = null;
    expect(parseState(nullCallsign).callsign).toBe('');
  });

  it('handles missing position (null lat/lon)', () => {
    const noPos = [...sampleVector];
    noPos[IDX.LAT] = null;
    noPos[IDX.LON] = null;
    const state = parseState(noPos);
    expect(state.lat).toBeNull();
    expect(state.lon).toBeNull();
  });
});
