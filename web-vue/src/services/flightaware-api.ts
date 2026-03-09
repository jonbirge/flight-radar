/**
 * FlightAware AeroAPI client.
 * Ported from web/app.js FlightAware section.
 *
 * All requests go through a PHP proxy (flightaware-proxy.php) to avoid
 * exposing the API key in browser code. In Capacitor, requests go direct
 * with the API key in the Authorization header.
 */

import { fetchJson, isCapacitor } from './api-client';

/** Build FlightAware endpoint URL (proxied or direct) */
function faUrl(endpoint: string, params: Record<string, string>, apiKey?: string): string {
  if (isCapacitor() && apiKey) {
    // Direct AeroAPI access in Capacitor (no CORS)
    const qs = new URLSearchParams(params).toString();
    return `https://aeroapi.flightaware.com/aeroapi/${endpoint}${qs ? '?' + qs : ''}`;
  }
  // Browser: use PHP proxy
  const qs = new URLSearchParams({ endpoint, ...params }).toString();
  return `flightaware-proxy.php?${qs}`;
}

/** Get request headers (Capacitor uses direct API key auth) */
function faHeaders(apiKey?: string): Record<string, string> {
  if (isCapacitor() && apiKey) {
    return { 'x-apikey': apiKey };
  }
  return {};
}

/** Flight plan search result from AeroAPI */
export interface FAFlightsResponse {
  flights?: Array<{
    fa_flight_id: string;
    ident: string;
    origin?: { code: string; name: string };
    destination?: { code: string; name: string };
    scheduled_out?: string;
    estimated_out?: string;
    actual_out?: string;
    scheduled_in?: string;
    estimated_in?: string;
    actual_in?: string;
    status?: string;
    route?: string;
    filed_altitude?: number;
    aircraft_type?: string;
  }>;
}

/**
 * Search for flights by ident (callsign or flight number).
 */
export async function getFlightPlan(
  ident: string,
  apiKey?: string,
): Promise<FAFlightsResponse | { error: string }> {
  const url = faUrl('flights', { ident }, apiKey);
  return fetchJson<FAFlightsResponse>(url, { headers: faHeaders(apiKey) });
}

/** Decoded flight route from AeroAPI */
export interface FARouteResponse {
  route?: Array<{
    name: string;
    type: string;
    latitude: number;
    longitude: number;
  }>;
}

/**
 * Get the decoded filed route with waypoint coordinates for a specific flight.
 */
export async function getFlightRoute(
  faFlightId: string,
  apiKey?: string,
): Promise<FARouteResponse | { error: string }> {
  const url = faUrl('flights/route', { fa_flight_id: faFlightId }, apiKey);
  return fetchJson<FARouteResponse>(url, { headers: faHeaders(apiKey) });
}

/** Actual flown track from AeroAPI */
export interface FATrackResponse {
  positions?: Array<{
    latitude: number;
    longitude: number;
    altitude: number;
    timestamp: string;
    groundspeed: number;
    heading: number;
  }>;
}

/**
 * Get the actual flown track for a specific flight.
 */
export async function getFlightTrack(
  faFlightId: string,
  apiKey?: string,
): Promise<FATrackResponse | { error: string }> {
  const url = faUrl('flights/track', { fa_flight_id: faFlightId }, apiKey);
  return fetchJson<FATrackResponse>(url, { headers: faHeaders(apiKey) });
}

/**
 * Search flights by advanced query (origin, destination, date/time window).
 */
export async function searchFlights(
  advQuery: string,
  apiKey?: string,
): Promise<FAFlightsResponse | { error: string }> {
  const url = faUrl('flights/search/advanced', { query: advQuery }, apiKey);
  return fetchJson<FAFlightsResponse>(url, { headers: faHeaders(apiKey) });
}
