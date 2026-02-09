// Shared data: airport database, OpenSky state parsing, formatting utilities
// Loaded by both Electron and web versions

'use strict';

// ============================================================
// Airport Database (major US airports + select international)
// ============================================================

const AIRPORTS = {
  // Northeast
  BOS: { name: 'Boston Logan International',        lat: 42.3656, lon: -71.0096 },
  JFK: { name: 'John F. Kennedy International',     lat: 40.6413, lon: -73.7781 },
  LGA: { name: 'LaGuardia',                         lat: 40.7769, lon: -73.8740 },
  EWR: { name: 'Newark Liberty International',      lat: 40.6895, lon: -74.1745 },
  PHL: { name: 'Philadelphia International',        lat: 39.8721, lon: -75.2411 },
  DCA: { name: 'Ronald Reagan Washington National', lat: 38.8512, lon: -77.0402 },
  IAD: { name: 'Washington Dulles International',   lat: 38.9531, lon: -77.4565 },
  BWI: { name: 'Baltimore/Washington International',lat: 39.1754, lon: -76.6684 },
  PVD: { name: 'T.F. Green International',          lat: 41.7241, lon: -71.4283 },
  BDL: { name: 'Bradley International',             lat: 41.9389, lon: -72.6832 },
  // Southeast
  ATL: { name: 'Hartsfield-Jackson Atlanta',        lat: 33.6407, lon: -84.4277 },
  MIA: { name: 'Miami International',               lat: 25.7959, lon: -80.2870 },
  FLL: { name: 'Fort Lauderdale-Hollywood',         lat: 26.0742, lon: -80.1506 },
  MCO: { name: 'Orlando International',             lat: 28.4312, lon: -81.3081 },
  TPA: { name: 'Tampa International',               lat: 27.9756, lon: -82.5333 },
  CLT: { name: 'Charlotte Douglas International',   lat: 35.2140, lon: -80.9431 },
  RDU: { name: 'Raleigh-Durham International',      lat: 35.8776, lon: -78.7875 },
  BNA: { name: 'Nashville International',           lat: 36.1263, lon: -86.6774 },
  // Midwest
  ORD: { name: "O'Hare International",              lat: 41.9742, lon: -87.9073 },
  MDW: { name: 'Chicago Midway',                    lat: 41.7868, lon: -87.7522 },
  DTW: { name: 'Detroit Metropolitan',              lat: 42.2124, lon: -83.3534 },
  MSP: { name: 'Minneapolis-Saint Paul',            lat: 44.8848, lon: -93.2223 },
  STL: { name: 'St. Louis Lambert International',   lat: 38.7487, lon: -90.3700 },
  CVG: { name: 'Cincinnati/Northern Kentucky',      lat: 39.0488, lon: -84.6678 },
  CLE: { name: 'Cleveland Hopkins International',   lat: 41.4117, lon: -81.8498 },
  MKE: { name: 'Milwaukee Mitchell International',  lat: 42.9472, lon: -87.8966 },
  IND: { name: 'Indianapolis International',        lat: 39.7173, lon: -86.2944 },
  // South/Central
  DFW: { name: 'Dallas/Fort Worth International',   lat: 32.8998, lon: -97.0403 },
  IAH: { name: 'George Bush Intercontinental',      lat: 29.9902, lon: -95.3368 },
  HOU: { name: 'William P. Hobby',                  lat: 29.6454, lon: -95.2789 },
  AUS: { name: 'Austin-Bergstrom International',    lat: 30.1975, lon: -97.6664 },
  MSY: { name: 'Louis Armstrong New Orleans',       lat: 29.9934, lon: -90.2580 },
  MEM: { name: 'Memphis International',             lat: 35.0424, lon: -89.9767 },
  // West
  LAX: { name: 'Los Angeles International',         lat: 33.9416, lon: -118.4085 },
  SFO: { name: 'San Francisco International',       lat: 37.6213, lon: -122.3790 },
  SJC: { name: 'San Jose International',            lat: 37.3639, lon: -121.9289 },
  OAK: { name: 'Oakland International',             lat: 37.7213, lon: -122.2208 },
  SEA: { name: 'Seattle-Tacoma International',      lat: 47.4502, lon: -122.3088 },
  PDX: { name: 'Portland International',            lat: 45.5898, lon: -122.5951 },
  DEN: { name: 'Denver International',              lat: 39.8561, lon: -104.6737 },
  PHX: { name: 'Phoenix Sky Harbor',                lat: 33.4373, lon: -112.0078 },
  LAS: { name: 'Harry Reid International',          lat: 36.0840, lon: -115.1537 },
  SLC: { name: 'Salt Lake City International',      lat: 40.7899, lon: -111.9791 },
  SAN: { name: 'San Diego International',           lat: 32.7338, lon: -117.1933 },
  SNA: { name: 'John Wayne Airport',                lat: 33.6757, lon: -117.8678 },
  // Hawaii / Alaska
  HNL: { name: 'Daniel K. Inouye International',   lat: 21.3187, lon: -157.9225 },
  ANC: { name: 'Ted Stevens Anchorage',             lat: 61.1743, lon: -149.9982 },
};

function lookupAirport(code) {
  return AIRPORTS[(code || '').toUpperCase().trim()] || null;
}

// ============================================================
// OpenSky State Parsing
// ============================================================

// OpenSky state vector indices
const IDX = {
  ICAO24: 0, CALLSIGN: 1, ORIGIN: 2, TIME_POS: 3, LAST_CONTACT: 4,
  LON: 5, LAT: 6, BARO_ALT: 7, ON_GROUND: 8, VELOCITY: 9,
  HEADING: 10, VERT_RATE: 11, SENSORS: 12, GEO_ALT: 13,
  SQUAWK: 14, SPI: 15, POS_SRC: 16
};

function parseState(s) {
  return {
    icao24: s[IDX.ICAO24],
    callsign: (s[IDX.CALLSIGN] || '').trim(),
    lon: s[IDX.LON],
    lat: s[IDX.LAT],
    altitude: s[IDX.BARO_ALT],
    geoAltitude: s[IDX.GEO_ALT],
    onGround: s[IDX.ON_GROUND],
    velocity: s[IDX.VELOCITY],
    heading: s[IDX.HEADING],
    verticalRate: s[IDX.VERT_RATE],
    squawk: s[IDX.SQUAWK],
    lastContact: s[IDX.LAST_CONTACT],
    origin: s[IDX.ORIGIN],
  };
}

// ============================================================
// Data Block (label) formatting
// ============================================================

function formatAltitude(meters) {
  if (meters == null) return '---';
  const feet = meters * 3.28084;
  if (feet >= 18000) return `FL${Math.round(feet / 100)}`;
  return `${Math.round(feet / 100)}`;
}

function formatSpeed(ms) {
  if (ms == null) return '---';
  return `${Math.round(ms * 1.94384)}`; // m/s to knots
}

function verticalIndicator(rate) {
  if (rate == null || Math.abs(rate) < 0.5) return ' ';
  return rate > 0 ? '↑' : '↓';
}
