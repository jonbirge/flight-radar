// Central mutable state shared across all radar modules.
// All let/const state variables previously declared at the top of radar-core.js
// are now properties of this single exported object.

const state = {
  // Aircraft tracking
  aircraft: new Map(),          // icao24 -> aircraft state object
  trackFetchQueue: [],          // icao24s to fetch hi-res tracks for

  // Entity collections
  airportEntities: [],
  smallAirportEntities: [],
  airspaceEntities: [],
  waypointEntities: [],
  navaidEntities: [],
  pirepEntities: [],
  sigmetEntities: [],
  airmetEntities: [],
  _scrubAirmetEntities: [],     // separate AIRMET entities for timeline scrubbing
  turb3dEntities: [],
  flightPlanEntities: [],

  // Cached data
  cachedAirportData: null,
  cachedWaypointData: null,

  // Timers
  tickTimer: null,
  clockTimer: null,
  radarRefreshTimer: null,
  satelliteIRRefreshTimer: null,
  turbRefreshTimer: null,
  pirepRefreshTimer: null,
  sigmetRefreshTimer: null,
  airmetRefreshTimer: null,

  // Viewer
  viewer: null,
  is2D: false,

  // Selection
  selectedIcao: null,
  isRotating: false,
  isTracking: false,
  rotateHandler: null,
  frozenBounds: null,

  // Poll state
  lastPollTime: null,
  rateLimitedUntil: 0,
  lastIconSize: -1,
  lastPollBounds: null,
  lastPollHeight: null,
  lastPositionUpdateHeight: null,
  viewChangePollDebounce: null,
  lastUseDot: null,

  // Render state
  _zoomResizeRAF: null,
  _renderGeneration: 0,
  acDisplayCond: null,

  // Weather layers
  radarLayer: null,
  satelliteIRLayer: null,
  turbLayer: null,

  // Flight plan
  activeFlightPlan: null,
  searchedFlightIdent: null,
  searchedIcao: null,
  selectedRouteFlight: null,

  // Timeline
  timelineTime: null,
  timelineEntity: null,
  timelineRoutePoints: [],

  // Poll guards
  lastSelectedPollMs: 0,
  lastTrackFetchMs: 0,
  _pollInFlight: false,
  _selectedPollInFlight: false,
  _lastBulkPollMs: 0,
  _lastSelectedPollApiMs: 0,

  // Airspace data cache (for rebuild on 3D toggle)
  airspaceData: null,
};

// Constants (previously in radar-core.js)
export const RATE_LIMIT_MS = 10000;
export const RENDER_CHUNK_SIZE = 80;
export const SELECTED_POLL_INTERVAL = 10000;
export const TRACK_FETCH_INTERVAL = 12000;

export default state;
