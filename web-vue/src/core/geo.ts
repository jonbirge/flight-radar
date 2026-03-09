/**
 * Geographic utility functions.
 * Ported from scattered locations in radar-ui.js and radar-aircraft.js.
 *
 * Pure functions — no side effects, no framework dependencies.
 */

import type { ViewBounds } from './types';

/** Check if inner bounds are fully contained within outer bounds */
export function boundsContain(outer: ViewBounds | null, inner: ViewBounds | null): boolean {
  if (!outer || !inner) return false;
  return inner.south >= outer.south && inner.north <= outer.north
      && inner.west >= outer.west && inner.east <= outer.east;
}

/**
 * Extrapolate a position forward in time based on velocity and heading.
 * Returns new [lat, lon] in degrees.
 *
 * @param lat - current latitude (degrees)
 * @param lon - current longitude (degrees)
 * @param velocity - ground speed (m/s)
 * @param heading - true heading (degrees clockwise from north)
 * @param dtSeconds - time delta to extrapolate (seconds)
 */
export function extrapolatePosition(
  lat: number,
  lon: number,
  velocity: number,
  heading: number,
  dtSeconds: number,
): { lat: number; lon: number } {
  // Distance in meters
  const dist = velocity * dtSeconds;
  // Convert heading to radians
  const hdgRad = (heading * Math.PI) / 180;
  // Approximate meters per degree at this latitude
  const metersPerDegLat = 111_320;
  const metersPerDegLon = 111_320 * Math.cos((lat * Math.PI) / 180);

  const dLat = (dist * Math.cos(hdgRad)) / metersPerDegLat;
  const dLon = metersPerDegLon > 0 ? (dist * Math.sin(hdgRad)) / metersPerDegLon : 0;

  return {
    lat: lat + dLat,
    lon: lon + dLon,
  };
}

/**
 * Haversine distance between two points in meters.
 */
export function haversineDistance(
  lat1: number, lon1: number,
  lat2: number, lon2: number,
): number {
  const R = 6_371_000; // Earth radius in meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
