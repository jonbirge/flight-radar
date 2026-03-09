/**
 * Data formatting utilities for display.
 * Ported from shared/data.js lines 105-121.
 *
 * Pure functions — no side effects, no framework dependencies.
 */

/** Format barometric altitude in meters to flight level or hundreds of feet */
export function formatAltitude(meters: number | null): string {
  if (meters == null) return '---';
  const feet = meters * 3.28084;
  if (feet >= 18000) return `FL${Math.round(feet / 100)}`;
  return `${Math.round(feet / 100)}`;
}

/** Format ground speed from m/s to knots (integer) */
export function formatSpeed(ms: number | null): string {
  if (ms == null) return '---';
  return `${Math.round(ms * 1.94384)}`;
}

/** Vertical rate indicator: ↑ for climbing, ↓ for descending, space for level */
export function verticalIndicator(rate: number | null): string {
  if (rate == null || Math.abs(rate) < 0.5) return ' ';
  return rate > 0 ? '↑' : '↓';
}

/** Format duration in seconds to HH:MM or MM:SS string */
export function formatDuration(seconds: number): string {
  if (seconds < 0) seconds = 0;
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (hours > 0) {
    return `${hours}h ${mins.toString().padStart(2, '0')}m`;
  }
  const secs = Math.floor(seconds % 60);
  return `${mins}m ${secs.toString().padStart(2, '0')}s`;
}

/** Convert meters to feet */
export function metersToFeet(meters: number): number {
  return meters * 3.28084;
}

/** Convert m/s to knots */
export function msToKnots(ms: number): number {
  return ms * 1.94384;
}
