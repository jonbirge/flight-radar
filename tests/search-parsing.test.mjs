// Unit tests for flight search natural language parsing.
// Run with: node --test tests/search-parsing.test.mjs

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

// --- Extracted module code for testing ---

// City name → primary airport IATA code mapping.
// Covers the largest US metro areas plus common international destinations.
const CITY_AIRPORTS = {
  'new york':      'JFK',  'nyc':           'JFK',
  'los angeles':   'LAX',  'la':            'LAX',
  'chicago':       'ORD',
  'dallas':        'DFW',
  'houston':       'IAH',
  'denver':        'DEN',
  'san francisco': 'SFO',  'sf':            'SFO',
  'seattle':       'SEA',
  'atlanta':       'ATL',
  'boston':         'BOS',
  'miami':         'MIA',
  'phoenix':       'PHX',
  'minneapolis':   'MSP',
  'detroit':       'DTW',
  'philadelphia':  'PHL',  'philly':        'PHL',
  'orlando':       'MCO',
  'charlotte':     'CLT',
  'las vegas':     'LAS',  'vegas':         'LAS',
  'portland':      'PDX',
  'san diego':     'SAN',
  'tampa':         'TPA',
  'salt lake city':'SLC',  'salt lake':     'SLC',
  'san antonio':   'SAT',
  'austin':        'AUS',
  'nashville':     'BNA',
  'san jose':      'SJC',
  'washington':    'DCA',  'dc':            'DCA',
  'baltimore':     'BWI',
  'fort lauderdale':'FLL', 'ft lauderdale': 'FLL',
  'pittsburgh':    'PIT',
  'st louis':      'STL',  'saint louis':   'STL',
  'indianapolis':  'IND',
  'cleveland':     'CLE',
  'kansas city':   'MCI',
  'columbus':      'CMH',
  'raleigh':       'RDU',
  'milwaukee':     'MKE',
  'new orleans':   'MSY',
  'honolulu':      'HNL',
  'anchorage':     'ANC',
  'london':        'LHR',
  'paris':         'CDG',
  'tokyo':         'NRT',
  'toronto':       'YYZ',
  'cancun':        'CUN',
};

// Sorted city names longest-first for greedy matching.
const CITY_NAMES_SORTED = Object.keys(CITY_AIRPORTS).sort((a, b) => b.length - a.length);

// Resolve a token (city name or airport code) to an IATA code.
// Returns null if unresolved.
function resolveCityOrCode(token) {
  if (!token) return null;
  const t = token.toLowerCase().trim();
  // Check city mapping first
  for (const city of CITY_NAMES_SORTED) {
    if (t === city) return CITY_AIRPORTS[city];
  }
  // If it looks like a 3-4 letter airport code, return uppercased
  if (/^[a-z]{3,4}$/.test(t)) return t.toUpperCase();
  return null;
}

// Replace city names in the query with their airport codes for simpler regex matching.
function substituteCityNames(query) {
  let q = query.toLowerCase().trim();
  for (const city of CITY_NAMES_SORTED) {
    // Use word-boundary-aware replacement (city names can contain spaces)
    const escaped = city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`\\b${escaped}\\b`, 'gi');
    if (re.test(q)) {
      q = q.replace(re, CITY_AIRPORTS[city]);
    }
  }
  return q;
}

const AIRLINE_CODES = {
  'united':     'UAL', 'ual':     'UAL',
  'american':   'AAL', 'aal':     'AAL',
  'delta':      'DAL', 'dal':     'DAL',
  'southwest':  'SWA', 'swa':     'SWA',
  'jetblue':    'JBU', 'jbu':     'JBU',
  'alaska':     'ASA', 'asa':     'ASA',
  'spirit':     'NKS', 'nks':     'NKS',
  'frontier':   'FFT', 'fft':     'FFT',
  'hawaiian':   'HAL', 'hal':     'HAL',
  'allegiant':  'AAY', 'aay':     'AAY',
  'sun country':'SCX', 'scx':     'SCX',
  'breeze':     'MXX', 'mxx':     'MXX',
};

function parseNaturalLanguage(query) {
  // Substitute city names before regex parsing
  const q = substituteCityNames(query);
  const result = { origin: null, destination: null, airline: null, start: null, end: null };

  // Extract origin airport (3–4 letter IATA/ICAO code)
  const originMatch = q.match(/(?:from\s+|departing\s+(?:from\s+)?|out\s+of\s+)([a-z]{3,4})\b/i);
  if (originMatch) result.origin = originMatch[1].toUpperCase();

  // Extract destination airport (3–4 letter IATA/ICAO code)
  const destMatch = q.match(/(?:\bto\s+|arriving\s+(?:at\s+|in\s+)?|bound\s+for\s+)([a-z]{3,4})\b/i);
  if (destMatch) result.destination = destMatch[1].toUpperCase();

  // Fallback: "BOS to LAX" pattern — origin code directly before "to <dest>"
  if (!result.origin && result.destination) {
    const implicitOrigin = q.match(/\b([a-z]{3,4})\s+to\s+[a-z]{3,4}\b/i);
    if (implicitOrigin) result.origin = implicitOrigin[1].toUpperCase();
  }

  // Extract airline — check for known names/codes in the original (un-substituted) query
  const qLower = query.toLowerCase().trim();
  for (const [name, icao] of Object.entries(AIRLINE_CODES)) {
    if (qLower.includes(name)) {
      result.airline = icao;
      break;
    }
  }

  return result;
}

// --- Tests ---

describe('CITY_AIRPORTS mapping', () => {
  it('contains expected cities', () => {
    assert.equal(CITY_AIRPORTS['boston'], 'BOS');
    assert.equal(CITY_AIRPORTS['denver'], 'DEN');
    assert.equal(CITY_AIRPORTS['new york'], 'JFK');
    assert.equal(CITY_AIRPORTS['los angeles'], 'LAX');
    assert.equal(CITY_AIRPORTS['chicago'], 'ORD');
  });

  it('contains short aliases', () => {
    assert.equal(CITY_AIRPORTS['nyc'], 'JFK');
    assert.equal(CITY_AIRPORTS['la'], 'LAX');
    assert.equal(CITY_AIRPORTS['sf'], 'SFO');
    assert.equal(CITY_AIRPORTS['dc'], 'DCA');
    assert.equal(CITY_AIRPORTS['vegas'], 'LAS');
    assert.equal(CITY_AIRPORTS['philly'], 'PHL');
  });
});

describe('substituteCityNames', () => {
  it('replaces single city name', () => {
    const result = substituteCityNames('from Boston');
    assert.match(result, /from\s+BOS/i);
  });

  it('replaces multi-word city names', () => {
    const result = substituteCityNames('from New York to Los Angeles');
    assert.match(result, /from\s+JFK\s+to\s+LAX/i);
  });

  it('leaves airport codes unchanged', () => {
    const result = substituteCityNames('from SFO to LAX');
    assert.match(result, /from\s+sfo\s+to\s+lax/i);
  });

  it('replaces city aliases', () => {
    const result = substituteCityNames('NYC to Vegas');
    assert.match(result, /JFK\s+to\s+LAS/i);
  });

  it('handles mixed city names and codes', () => {
    const result = substituteCityNames('Boston to LAX');
    assert.match(result, /BOS\s+to\s+lax/i);
  });

  it('handles case insensitivity', () => {
    const result = substituteCityNames('BOSTON to DENVER');
    assert.match(result, /BOS\s+to\s+DEN/i);
  });
});

describe('parseNaturalLanguage with city names', () => {
  it('parses "Boston to LAX"', () => {
    const r = parseNaturalLanguage('Boston to LAX');
    assert.equal(r.origin, 'BOS');
    assert.equal(r.destination, 'LAX');
  });

  it('parses "from Denver to Miami"', () => {
    const r = parseNaturalLanguage('from Denver to Miami');
    assert.equal(r.origin, 'DEN');
    assert.equal(r.destination, 'MIA');
  });

  it('parses "New York to Los Angeles"', () => {
    const r = parseNaturalLanguage('New York to Los Angeles');
    assert.equal(r.origin, 'JFK');
    assert.equal(r.destination, 'LAX');
  });

  it('parses city name mixed with airport code', () => {
    const r = parseNaturalLanguage('Boston to LAX');
    assert.equal(r.origin, 'BOS');
    assert.equal(r.destination, 'LAX');
  });

  it('parses "flights from Chicago to Atlanta"', () => {
    const r = parseNaturalLanguage('flights from Chicago to Atlanta');
    assert.equal(r.origin, 'ORD');
    assert.equal(r.destination, 'ATL');
  });

  it('parses destination-only with city name', () => {
    const r = parseNaturalLanguage('to Boston');
    assert.equal(r.origin, null);
    assert.equal(r.destination, 'BOS');
  });

  it('parses origin-only with city name', () => {
    const r = parseNaturalLanguage('from Seattle');
    assert.equal(r.origin, 'SEA');
    assert.equal(r.destination, null);
  });

  it('parses city aliases', () => {
    const r = parseNaturalLanguage('NYC to Vegas');
    assert.equal(r.origin, 'JFK');
    assert.equal(r.destination, 'LAS');
  });

  it('parses "SF to DC"', () => {
    const r = parseNaturalLanguage('SF to DC');
    assert.equal(r.origin, 'SFO');
    assert.equal(r.destination, 'DCA');
  });

  it('preserves airline extraction with city names', () => {
    const r = parseNaturalLanguage('united from Boston to Chicago');
    assert.equal(r.origin, 'BOS');
    assert.equal(r.destination, 'ORD');
    assert.equal(r.airline, 'UAL');
  });

  it('handles plain airport codes (no regression)', () => {
    const r = parseNaturalLanguage('BOS to LAX');
    assert.equal(r.origin, 'BOS');
    assert.equal(r.destination, 'LAX');
  });

  it('handles "from SFO to LAX" (no regression)', () => {
    const r = parseNaturalLanguage('from SFO to LAX');
    assert.equal(r.origin, 'SFO');
    assert.equal(r.destination, 'LAX');
  });

  it('handles "delta from ATL" (no regression)', () => {
    const r = parseNaturalLanguage('delta from ATL');
    assert.equal(r.origin, 'ATL');
    assert.equal(r.airline, 'DAL');
  });

  it('handles "to JFK" destination-only (no regression)', () => {
    const r = parseNaturalLanguage('to JFK');
    assert.equal(r.origin, null);
    assert.equal(r.destination, 'JFK');
  });
});
