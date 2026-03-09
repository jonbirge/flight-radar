/**
 * Aviation Weather Center (AWC) API client.
 * Handles PIREP, SIGMET, G-AIRMET, and turbulence forecast fetching.
 *
 * Ported from shared/radar-weather.js fetch functions.
 * Routes through awc-proxy.php in browser, direct in Capacitor.
 */

import { buildAwcUrl, PIREP_MAX_AGE_MS } from '@/core/weather';
import { fetchWithTimeout, isCapacitor } from './api-client';

/** Determine the AWC proxy URL based on environment */
function getProxyUrl(): string | null {
  return isCapacitor() ? null : 'awc-proxy.php';
}

// ============================================================
// PIREPs
// ============================================================

/** GeoJSON feature from AWC PIREP API */
export interface PirepFeature {
  type: 'Feature';
  geometry: {
    type: 'Point';
    coordinates: [number, number]; // [lon, lat]
  };
  properties: {
    obsTime?: string;
    fltlvl?: number;
    tbInt1?: string;
    acType?: string;
    rawOb?: string;
  };
}

export interface PirepGeoJson {
  type: 'FeatureCollection';
  features: PirepFeature[];
}

/**
 * Fetch turbulence PIREPs from AWC.
 * Returns GeoJSON FeatureCollection or null on error.
 */
export async function fetchPireps(): Promise<PirepGeoJson | null> {
  const maxAgeHours = Math.ceil(PIREP_MAX_AGE_MS / (60 * 60 * 1000));
  const url = buildAwcUrl(
    `pirep?format=geojson&type=turb&age=${maxAgeHours}&bbox=15,-180,75,-50`,
    getProxyUrl(),
  );

  try {
    const resp = await fetchWithTimeout(url);
    if (!resp.ok) return null;
    return await resp.json() as PirepGeoJson;
  } catch {
    return null;
  }
}

// ============================================================
// SIGMETs
// ============================================================

export interface SigmetFeature {
  type: 'Feature';
  geometry: {
    type: 'Polygon' | 'MultiPolygon';
    coordinates: number[][][] | number[][][][];
  };
  properties: {
    hazard?: string;
    severity?: string;
    altitudeLow1?: string;
    altitudeHi1?: string;
    altLow?: string;
    altHi?: string;
    validTimeFrom?: string;
    validTimeTo?: string;
    rawSigmet?: string;
  };
}

export interface SigmetGeoJson {
  type: 'FeatureCollection';
  features: SigmetFeature[];
}

/**
 * Fetch SIGMETs from AWC.
 * Returns GeoJSON FeatureCollection or null on error.
 */
export async function fetchSigmets(): Promise<SigmetGeoJson | null> {
  const url = buildAwcUrl('sigmet?format=geojson', getProxyUrl());

  try {
    const resp = await fetchWithTimeout(url);
    if (!resp.ok) return null;
    return await resp.json() as SigmetGeoJson;
  } catch {
    return null;
  }
}

// ============================================================
// G-AIRMETs
// ============================================================

export interface AirmetFeature {
  type: 'Feature';
  geometry: {
    type: 'Polygon' | 'MultiPolygon';
    coordinates: number[][][] | number[][][][];
  };
  properties: {
    hazard?: string;
    severity?: string;
    altLow?: string;
    altHi?: string;
    validTime?: string;
    dueTo?: string;
  };
}

export interface AirmetGeoJson {
  type: 'FeatureCollection';
  features: AirmetFeature[];
}

/**
 * Fetch G-AIRMETs from AWC.
 * Returns GeoJSON FeatureCollection or null on error.
 */
export async function fetchAirmets(): Promise<AirmetGeoJson | null> {
  const url = buildAwcUrl('gairmet?format=geojson', getProxyUrl());

  try {
    const resp = await fetchWithTimeout(url);
    if (!resp.ok) return null;
    return await resp.json() as AirmetGeoJson;
  } catch {
    return null;
  }
}

// ============================================================
// GTG Turbulence Forecast Image
// ============================================================

/**
 * Fetch a GTG turbulence forecast image as a blob URL.
 * The image is Mercator-projected and needs reprojection by the caller.
 *
 * @param level - altitude level (e.g., "300" for FL300, or "maxa" for max altitude)
 * @param dateSecs - Unix timestamp in seconds for forecast valid time (null = current)
 * @returns blob URL string, or null on failure
 */
export async function fetchTurbImage(
  level: string,
  dateSecs: number | null = null,
): Promise<string | null> {
  const dateParam = dateSecs != null ? `&date=${dateSecs}` : '';
  const url = buildAwcUrl(
    `model?model=gfaak&level=${level}&type=gtg${dateParam}&_t=${Date.now()}`,
    getProxyUrl(),
  );

  try {
    const resp = await fetchWithTimeout(url);
    if (!resp.ok) return null;
    const blob = await resp.blob();
    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
}
