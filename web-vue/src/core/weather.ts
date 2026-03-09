/**
 * Weather domain logic — pure computation, no Cesium or DOM dependencies.
 * Ported from shared/radar-weather.js.
 *
 * This module contains:
 * - PIREP severity/color mapping
 * - GTG turbulence image reprojection (Mercator → geographic)
 * - NEXRAD tile pixel filtering (ground clutter removal)
 * - AWC API URL construction
 * - Weather data age filtering
 */

// ============================================================
// Constants
// ============================================================

/** Maximum age of PIREPs to display (3 hours) */
export const PIREP_MAX_AGE_MS = 3 * 60 * 60 * 1000;

/** GTG turbulence image geographic bounds (gfaak model) */
export const TURB_BOUNDS = {
  LON_WEST: -215.69104,
  LON_EAST: -39.508957,
  LAT_SOUTH: -0.196746,
  LAT_NORTH: 76.97271,
  CROP_LON: -180, // crop everything west of antimeridian
} as const;

/** Available GTG turbulence altitude levels */
export const TURB_LEVELS = [100, 140, 180, 210, 240, 270, 300, 330, 360, 390, 420, 450, 480, 510];

// ============================================================
// PIREP Colors
// ============================================================

/** CSS color mapping for PIREP turbulence intensity */
export const PIREP_CSS_COLORS: Record<string, string> = {
  NEG:   'rgba(51, 128, 255, 0.7)',
  SMT:   'rgba(51, 128, 255, 0.7)',
  LGT:   'rgba(0, 204, 0, 0.8)',
  MOD:   'rgba(255, 153, 0, 0.9)',
  SEV:   'rgba(255, 0, 0, 1.0)',
  EXTRM: 'rgba(255, 0, 255, 1.0)',
};

/** Map PIREP intensity string to CSS color */
export function pirepCssColor(intensity: string | null): string {
  if (!intensity) return PIREP_CSS_COLORS.LGT;
  const upper = intensity.toUpperCase().replace(/-/g, '');
  for (const key of ['EXTRM', 'SEV', 'MOD', 'LGT', 'NEG', 'SMT']) {
    if (upper.includes(key)) return PIREP_CSS_COLORS[key] || PIREP_CSS_COLORS.LGT;
  }
  return PIREP_CSS_COLORS.LGT;
}

/** Classify PIREP intensity string to bump count for icon rendering */
export function pirepIntensityToBumps(intensity: string | null): number {
  if (!intensity) return 1;
  const upper = intensity.toUpperCase().replace(/-/g, '');
  if (upper.includes('EXTRM'))     return 4; // 3 bumps + bar
  if (upper.includes('SEV'))       return 3;
  if (upper.includes('MOD'))       return 2;
  if (upper.includes('NEG') || upper.includes('SMT')) return 0;
  return 1; // default LGT
}

// ============================================================
// Mercator Reprojection
// ============================================================

/** Convert geographic latitude (degrees) to Mercator Y coordinate */
export function geoLatToMercY(latDeg: number): number {
  const latRad = (latDeg * Math.PI) / 180;
  return Math.log(Math.tan(Math.PI / 4 + latRad / 2));
}

/**
 * Compute the source row in a Mercator-projected image for a given
 * geographic latitude in the output image.
 *
 * @param lat - target geographic latitude (degrees)
 * @param imageHeight - total image height in pixels
 * @returns source row index (0 = top)
 */
export function mercatorSourceRow(lat: number, imageHeight: number): number {
  const yMercSouth = geoLatToMercY(TURB_BOUNDS.LAT_SOUTH);
  const yMercNorth = geoLatToMercY(TURB_BOUNDS.LAT_NORTH);
  const mercY = geoLatToMercY(lat);
  const mercFrac = (mercY - yMercSouth) / (yMercNorth - yMercSouth);
  return Math.min(imageHeight - 1, Math.max(0, Math.round((1 - mercFrac) * (imageHeight - 1))));
}

/**
 * Compute the crop X offset for a given image width, used to crop the
 * GTG image to Western hemisphere only.
 *
 * @param imageWidth - full image width in pixels
 * @returns pixel X offset to start cropping from
 */
export function turbCropX(imageWidth: number): number {
  const lonSpan = TURB_BOUNDS.LON_EAST - TURB_BOUNDS.LON_WEST;
  return Math.round(((TURB_BOUNDS.CROP_LON - TURB_BOUNDS.LON_WEST) / lonSpan) * imageWidth);
}

/**
 * Reproject a GTG turbulence image from Mercator to geographic projection.
 * Operates on raw RGBA pixel data.
 *
 * @param srcData - source RGBA pixel array (Mercator-projected, already cropped)
 * @param width - image width in pixels
 * @param height - image height in pixels
 * @returns new RGBA pixel array in geographic projection
 */
export function reprojectMercatorToGeo(
  srcData: Uint8ClampedArray,
  width: number,
  height: number,
): Uint8ClampedArray {
  const outData = new Uint8ClampedArray(srcData.length);
  const rowBytes = width * 4;

  for (let row = 0; row < height; row++) {
    // Output row → geographic latitude (top row = north)
    const geoFrac = 1 - row / (height - 1);
    const lat = TURB_BOUNDS.LAT_SOUTH + geoFrac * (TURB_BOUNDS.LAT_NORTH - TURB_BOUNDS.LAT_SOUTH);
    const srcRow = mercatorSourceRow(lat, height);
    outData.set(
      srcData.subarray(srcRow * rowBytes, srcRow * rowBytes + rowBytes),
      row * rowBytes,
    );
  }

  return outData;
}

// ============================================================
// NEXRAD Tile Filtering
// ============================================================

/**
 * Filter NEXRAD radar tile pixel data to remove ground clutter.
 * Keeps only saturated weather colors (green/yellow/orange/red).
 * Modifies the data array in place.
 *
 * @param data - RGBA pixel data array (modified in place)
 */
export function filterRadarPixels(data: Uint8ClampedArray): void {
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a === 0) continue;

    const r = data[i], g = data[i + 1], b = data[i + 2];

    // Convert to HSL (only need S and L)
    const rn = r / 255, gn = g / 255, bn = b / 255;
    const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
    const l = (max + min) / 2;
    let s = 0;
    if (max !== min) {
      const delta = max - min;
      s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);
    }

    // Remove pixels that are too dark, too dim, or too desaturated
    if (s < 0.3 || l < 0.12 || l > 0.92) {
      data[i + 3] = 0; // make transparent
    }
  }
}

// ============================================================
// AWC URL Construction
// ============================================================

/**
 * Build an Aviation Weather Center API URL, routing through a proxy if configured.
 *
 * @param path - API path with optional query string (e.g., "pirep?format=geojson&type=turb")
 * @param proxyUrl - proxy URL (e.g., "awc-proxy.php"), or null for direct access
 */
export function buildAwcUrl(path: string, proxyUrl: string | null): string {
  if (proxyUrl) {
    const qIdx = path.indexOf('?');
    const endpoint = qIdx >= 0 ? path.substring(0, qIdx) : path;
    const params = qIdx >= 0 ? '&' + path.substring(qIdx + 1) : '';
    return `${proxyUrl}?endpoint=${endpoint}${params}`;
  }
  return `https://aviationweather.gov/api/data/${path}`;
}

// ============================================================
// Weather Data Filtering
// ============================================================

/** Check if a PIREP observation is within the display age window */
export function isPirepCurrent(obsTimeISO: string | null, nowMs: number): boolean {
  if (!obsTimeISO) return true; // If no timestamp, show it
  const obsMs = new Date(obsTimeISO).getTime();
  if (isNaN(obsMs)) return true;
  return (nowMs - obsMs) <= PIREP_MAX_AGE_MS;
}

/** Convert flight level to meters (e.g., FL350 = 350 * 100 * 0.3048) */
export function flightLevelToMeters(fltlvl: number): number {
  return fltlvl * 100 * 0.3048;
}

/**
 * Order turbulence levels by proximity to the primary level for fallback.
 *
 * @param primaryLevel - requested level (e.g., "300" or "maxa")
 * @returns ordered list of level strings to try
 */
export function orderTurbLevels(primaryLevel: string): string[] {
  const levels = [primaryLevel];
  if (primaryLevel === 'maxa') return levels;

  const primaryNum = parseInt(primaryLevel, 10);
  if (isNaN(primaryNum)) return levels;

  const sorted = TURB_LEVELS
    .filter(l => l !== primaryNum)
    .sort((a, b) => Math.abs(a - primaryNum) - Math.abs(b - primaryNum));

  for (const l of sorted.slice(0, 4)) {
    levels.push(String(l));
  }
  return levels;
}

/** SIGMET hazard types relevant to turbulence display */
export const SIGMET_HAZARDS = ['TURB', 'CONVECTIVE', 'TS'] as const;

/** Check if a SIGMET hazard type is one we display */
export function isTurbulenceSigmet(hazard: string): boolean {
  return (SIGMET_HAZARDS as readonly string[]).includes(hazard);
}

/** SIGMET fill/edge colors by hazard type (RGBA 0-1 values) */
export interface SigmetColors {
  fill: [number, number, number, number];
  edge: [number, number, number, number];
}

export function sigmetColors(hazard: string): SigmetColors {
  const isConvective = hazard === 'CONVECTIVE' || hazard === 'TS';
  return isConvective
    ? { fill: [1.0, 0.85, 0.0, 0.2], edge: [1.0, 0.85, 0.0, 0.8] }
    : { fill: [1.0, 0.0, 0.0, 0.2], edge: [1.0, 0.0, 0.0, 0.8] };
}
