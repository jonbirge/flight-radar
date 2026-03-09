/**
 * OpenSky Network API client.
 * Ported from web/app.js OpenSky section.
 *
 * Handles OAuth2 token management, rate limiting, and state/track requests.
 */

import type { ViewBounds } from '@/core/types';
import { fetchWithTimeout } from './api-client';

const OPENSKY_BASE = 'https://opensky-network.org/api';

// Rate limiting state
let lastStatesCall = 0;
let lastTrackCall = 0;
const STATES_MIN_INTERVAL = 10_000;
const TRACK_MIN_INTERVAL = 10_000;

// OAuth2 token cache
let cachedToken: string | null = null;
let tokenExpiresAt = 0;

/**
 * Fetch an OAuth2 token via the PHP proxy.
 * If clientId/clientSecret are provided, sends them to the proxy;
 * otherwise gets the server's default credentials.
 */
async function fetchTokenViaProxy(
  clientId?: string,
  clientSecret?: string,
): Promise<{ access_token?: string; expires_in?: number }> {
  const opts: RequestInit = {};
  if (clientId && clientSecret) {
    opts.method = 'POST';
    opts.headers = { 'Content-Type': 'application/json' };
    opts.body = JSON.stringify({ client_id: clientId, client_secret: clientSecret });
  }
  const resp = await fetchWithTimeout('cred.php', opts, 10_000);
  if (!resp.ok) throw new Error(`Token proxy failed: HTTP ${resp.status}`);
  return await resp.json();
}

/**
 * Get a valid OpenSky OAuth2 token, refreshing if needed.
 *
 * @param clientId - OpenSky client ID from settings (optional)
 * @param clientSecret - OpenSky client secret from settings (optional)
 * @returns Bearer token string, or null for anonymous access
 */
export async function getOpenSkyToken(
  clientId?: string,
  clientSecret?: string,
): Promise<string | null> {
  const now = Date.now();
  if (cachedToken && tokenExpiresAt > now + 60_000) {
    return cachedToken;
  }

  if (clientId && clientSecret) {
    try {
      const resp = await fetchTokenViaProxy(clientId, clientSecret);
      if (resp.access_token) {
        cachedToken = resp.access_token;
        tokenExpiresAt = now + ((resp.expires_in || 1500) * 1000);
        return cachedToken;
      }
    } catch {
      // Token fetch failed, fall back to anonymous
    }
  }

  cachedToken = null;
  tokenExpiresAt = 0;
  return null;
}

/** Clear cached token (call on credential change) */
export function clearTokenCache(): void {
  cachedToken = null;
  tokenExpiresAt = 0;
}

/** OpenSky states API response */
export interface StatesResponse {
  time: number;
  states: Array<(string | number | boolean | null)[]> | null;
}

/**
 * Fetch aircraft state vectors within geographic bounds.
 * Implements client-side rate limiting (min 10s between calls).
 */
export async function getStates(
  bounds: ViewBounds,
  token?: string | null,
): Promise<StatesResponse | { error: string; retryIn?: number }> {
  const now = Date.now();
  if (now - lastStatesCall < STATES_MIN_INTERVAL) {
    return { error: 'Rate limited', retryIn: STATES_MIN_INTERVAL - (now - lastStatesCall) };
  }
  lastStatesCall = now;

  try {
    const { south, west, north, east } = bounds;
    const url = `${OPENSKY_BASE}/states/all?lamin=${south}&lomin=${west}&lamax=${north}&lomax=${east}`;

    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const resp = await fetchWithTimeout(url, { headers });

    if (resp.status === 429) {
      return { error: 'Rate limited by OpenSky API' };
    }
    if (!resp.ok) {
      return { error: `HTTP ${resp.status}` };
    }

    return await resp.json() as StatesResponse;
  } catch (err) {
    return { error: (err as Error).message };
  }
}

/** OpenSky track response */
export interface TrackResponse {
  icao24: string;
  callsign: string;
  path: Array<[number, number, number, number, number, boolean]>;
}

/**
 * Fetch track history for a specific aircraft.
 * Implements client-side rate limiting (min 10s between calls).
 */
export async function getTrack(
  icao24: string,
  token?: string | null,
): Promise<TrackResponse | { error: string; retryIn?: number }> {
  const now = Date.now();
  if (now - lastTrackCall < TRACK_MIN_INTERVAL) {
    return { error: 'Rate limited', retryIn: TRACK_MIN_INTERVAL - (now - lastTrackCall) };
  }
  lastTrackCall = now;

  try {
    const url = `${OPENSKY_BASE}/tracks/all?icao24=${icao24}`;

    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const resp = await fetchWithTimeout(url, { headers });

    if (!resp.ok) {
      return { error: `HTTP ${resp.status}` };
    }

    return await resp.json() as TrackResponse;
  } catch (err) {
    return { error: (err as Error).message };
  }
}
