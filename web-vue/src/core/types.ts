/**
 * Core domain types for Flight Radar.
 * Framework-independent — no Vue, Cesium, or DOM dependencies.
 */

// ============================================================
// Aircraft
// ============================================================

/** Parsed OpenSky state vector for a single aircraft */
export interface AircraftState {
  icao24: string;
  callsign: string;
  lon: number | null;
  lat: number | null;
  altitude: number | null;      // barometric altitude in meters
  geoAltitude: number | null;   // geometric altitude in meters
  onGround: boolean;
  velocity: number | null;      // ground speed in m/s
  heading: number | null;       // degrees clockwise from north
  verticalRate: number | null;  // m/s, positive = climbing
  squawk: string | null;
  timePosition: number | null;  // unix timestamp of last position update
  lastContact: number | null;   // unix timestamp of last contact
  origin: string | null;        // origin country
}

/** Raw OpenSky API state vector (array of mixed types) */
export type RawStateVector = (string | number | boolean | null)[];

// ============================================================
// Airports
// ============================================================

export interface Airport {
  name: string;
  lat: number;
  lon: number;
}

export type AirportDict = Record<string, Airport>;

// ============================================================
// Geographic
// ============================================================

export interface ViewBounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

export interface CameraPosition {
  lon: number;
  lat: number;
  height: number;
  heading: number;
  pitch: number;
}

// ============================================================
// Weather
// ============================================================

export interface PIREP {
  id: string;
  lat: number;
  lon: number;
  altitude: number;            // feet
  turbulenceIntensity: string; // 'NEG' | 'LGT' | 'MOD' | 'SEV' | 'EXTRM'
  icingIntensity: string;
  observationTime: number;     // unix timestamp
  rawText: string;
  reportType: string;          // 'PIREP' | 'UA' | 'UUA'
}

export interface SIGMET {
  id: string;
  hazard: string;
  severity: string;
  validTimeFrom: number;
  validTimeTo: number;
  coordinates: Array<{ lat: number; lon: number }>;
  rawText: string;
  altitudeLow: number | null;  // feet
  altitudeHigh: number | null; // feet
}

export interface AIRMET {
  id: string;
  hazard: string;
  severity: string;
  validTimeFrom: number;
  validTimeTo: number;
  coordinates: Array<{ lat: number; lon: number }>;
  rawText: string;
  altitudeLow: number | null;
  altitudeHigh: number | null;
}

export type TurbulenceLevel = 'none' | 'low' | 'medium' | 'high';

// ============================================================
// Flight Plan
// ============================================================

export interface RoutePoint {
  lat: number;
  lon: number;
  name: string;
  type: string;  // 'airport' | 'waypoint' | 'navaid' | 'coord'
}

export interface FlightPlan {
  faFlightId: string;
  ident: string;
  origin: string;
  destination: string;
  route: string;              // raw route string
  routePoints: RoutePoint[];
  filedAltitude: number | null;
  departureTime: number | null;
  arrivalTime: number | null;
  estimatedArrivalTime: number | null;
  aircraftType: string;
  status: string;
}

export interface FlightSearchResult {
  faFlightId: string;
  ident: string;
  origin: { code: string; name: string };
  destination: { code: string; name: string };
  departureTime: number | null;
  arrivalTime: number | null;
  status: string;
}

// ============================================================
// Settings
// ============================================================

export interface Settings {
  fontSize: number;
  theme: 'system' | 'dark' | 'light';
  darkColor: string;
  lightColor: string;
  darkColorPresets: string[] | null;
  lightColorPresets: string[] | null;
  colorByAltitude: boolean;
  trailMode: 'none' | 'history' | 'velocity';
  thickTrailsByAltitude: boolean;
  trailLength: number;
  aircraftEnabled: boolean;
  labelsEnabled: boolean;
  airportsEnabled: boolean;
  airspaceEnabled: boolean;
  airspaceEdges: boolean;
  airspace3D: boolean;
  showSmallAirports: boolean;
  navaidsEnabled: boolean;
  showFixes: boolean;
  mapLayer: string;
  muteMapColors: boolean;
  radarEnabled: boolean;
  sigmetsEnabled: boolean;
  airmetsEnabled: boolean;
  pirepsEnabled: boolean;
  satelliteIREnabled: boolean;
  turbForecastEnabled: boolean;
  turbulenceLevel: string;
  weatherOverlayOpacity: number;
  rotationSpeed: number;
  credentialsExpanded: boolean;
  openskyClientId: string;
  openskyClientSecret: string;
  flightawareApiKey: string;
  savedView: CameraPosition;
  searchHistory: string[];
}

// ============================================================
// Derived Colors (computed from theme + base color)
// ============================================================

export interface DerivedColors {
  phosphor: string;
  phosphorBright: string;
  phosphorSelect: string;
  phosphorDim: string;
  trailColor: [number, number, number];
  labelOutlineMode: 'dark' | 'light';  // instead of Cesium.Color
}
