import { describe, it, expect } from 'vitest'

// Import defaults first, then data module
import '../src/defaults.js'
import '../src/data.js'

const {
  lookupAirport, parseState, formatAltitude, formatSpeed,
  verticalIndicator, IDX, AIRPORTS,
} = globalThis

describe('lookupAirport', () => {
  it('finds JFK', () => {
    const apt = lookupAirport('JFK')
    expect(apt).toBeDefined()
    expect(apt.name).toContain('Kennedy')
    expect(apt.lat).toBeCloseTo(40.64, 1)
  })

  it('is case-insensitive', () => {
    expect(lookupAirport('jfk')).toEqual(lookupAirport('JFK'))
  })

  it('trims whitespace', () => {
    expect(lookupAirport('  LAX  ')).toEqual(lookupAirport('LAX'))
  })

  it('returns null for unknown code', () => {
    expect(lookupAirport('ZZZ')).toBeNull()
  })

  it('returns null for null/undefined', () => {
    expect(lookupAirport(null)).toBeNull()
    expect(lookupAirport(undefined)).toBeNull()
  })
})

describe('AIRPORTS', () => {
  it('contains major US airports', () => {
    const codes = ['JFK', 'LAX', 'ORD', 'ATL', 'DEN', 'SFO', 'SEA', 'DFW']
    for (const code of codes) {
      expect(AIRPORTS[code]).toBeDefined()
      expect(typeof AIRPORTS[code].lat).toBe('number')
      expect(typeof AIRPORTS[code].lon).toBe('number')
    }
  })
})

describe('IDX', () => {
  it('has correct OpenSky state vector indices', () => {
    expect(IDX.ICAO24).toBe(0)
    expect(IDX.CALLSIGN).toBe(1)
    expect(IDX.LON).toBe(5)
    expect(IDX.LAT).toBe(6)
    expect(IDX.BARO_ALT).toBe(7)
    expect(IDX.HEADING).toBe(10)
  })
})

describe('parseState', () => {
  const mockState = [
    'abc123',     // 0: icao24
    '  UAL123  ', // 1: callsign
    'USA',        // 2: origin
    1700000000,   // 3: time_pos
    1700000005,   // 4: last_contact
    -118.41,      // 5: lon
    33.94,        // 6: lat
    10000,        // 7: baro_alt
    false,        // 8: on_ground
    250,          // 9: velocity
    270,          // 10: heading
    -5.0,         // 11: vert_rate
    null,         // 12: sensors
    10100,        // 13: geo_alt
    '1200',       // 14: squawk
    false,        // 15: spi
    0,            // 16: pos_src
  ]

  it('parses icao24', () => {
    expect(parseState(mockState).icao24).toBe('abc123')
  })

  it('trims callsign', () => {
    expect(parseState(mockState).callsign).toBe('UAL123')
  })

  it('parses coordinates', () => {
    const s = parseState(mockState)
    expect(s.lon).toBe(-118.41)
    expect(s.lat).toBe(33.94)
  })

  it('parses altitude', () => {
    expect(parseState(mockState).altitude).toBe(10000)
  })

  it('handles empty callsign', () => {
    const state = [...mockState]
    state[1] = null
    expect(parseState(state).callsign).toBe('')
  })
})

describe('formatAltitude', () => {
  it('returns flight level for >= 18000 feet', () => {
    // 18000 feet = 5486.4 meters
    expect(formatAltitude(5486.4)).toBe('FL180')
  })

  it('returns hundreds for < 18000 feet', () => {
    // 5000 feet = 1524 meters
    expect(formatAltitude(1524)).toBe('50')
  })

  it('returns --- for null', () => {
    expect(formatAltitude(null)).toBe('---')
  })

  it('returns --- for undefined', () => {
    expect(formatAltitude(undefined)).toBe('---')
  })

  it('returns FL350 for ~35000 feet', () => {
    // 35000 feet = 10668 meters
    expect(formatAltitude(10668)).toBe('FL350')
  })
})

describe('formatSpeed', () => {
  it('converts m/s to knots', () => {
    // 100 m/s = ~194 knots
    expect(formatSpeed(100)).toBe('194')
  })

  it('returns --- for null', () => {
    expect(formatSpeed(null)).toBe('---')
  })
})

describe('verticalIndicator', () => {
  it('returns up arrow for climbing', () => {
    expect(verticalIndicator(5.0)).toBe('↑')
  })

  it('returns down arrow for descending', () => {
    expect(verticalIndicator(-5.0)).toBe('↓')
  })

  it('returns space for level flight', () => {
    expect(verticalIndicator(0.3)).toBe(' ')
  })

  it('returns space for null', () => {
    expect(verticalIndicator(null)).toBe(' ')
  })
})
