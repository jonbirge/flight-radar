/**
 * Zoom-based scaling functions for LOD, poll intervals, and display sizes.
 * Ported from shared/config.js lines 158-197.
 *
 * Pure functions — no side effects, no framework dependencies.
 */

/** Camera height (meters) at city-level zoom */
export const CITY_HEIGHT = 100_000;

/** Camera height (meters) at CONUS-level zoom */
export const CONUS_HEIGHT = 6_000_000;

/** Camera height threshold for LOD tier transition (dot ↔ arrow) */
export const DOT_THRESHOLD = 2_000_000;

/**
 * Logarithmic zoom fraction: 0 at city zoom, 1 at CONUS zoom.
 * Used to interpolate between near/far values for display properties.
 */
export function getZoomFraction(camHeight: number): number {
  if (camHeight <= CITY_HEIGHT) return 0;
  if (camHeight >= CONUS_HEIGHT) return 1;
  return (Math.log(camHeight) - Math.log(CITY_HEIGHT)) / (Math.log(CONUS_HEIGHT) - Math.log(CITY_HEIGHT));
}

/** Compute icon pixel size based on camera height and base size */
export function computeIconSize(camHeight: number, baseSize: number): number {
  const MIN_SIZE = 2;
  const t = getZoomFraction(camHeight);
  return Math.max(MIN_SIZE, Math.round(baseSize * (1 - t) + MIN_SIZE * t) + 1);
}

/** Billboard display size: 10px at city → 2px at CONUS */
export function computeDisplaySize(camHeight: number): number {
  const t = getZoomFraction(camHeight);
  return Math.round(10 - 8 * t);
}

/** Poll interval steps in seconds, indexed by zoom fraction */
const POLL_STEPS = [10, 20, 30, 60];

/** Compute polling interval in milliseconds based on camera height */
export function computePollInterval(camHeight: number): number {
  const t = getZoomFraction(camHeight);
  const idx = Math.min(POLL_STEPS.length - 1, Math.round(t * (POLL_STEPS.length - 1)));
  return POLL_STEPS[idx] * 1000;
}

/** Position extrapolation update interval: 200ms at city → 3000ms at CONUS */
export function computePositionUpdateInterval(camHeight: number): number {
  const t = getZoomFraction(camHeight);
  return Math.round(200 + (3000 - 200) * t);
}
