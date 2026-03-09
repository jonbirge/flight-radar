/**
 * Color utilities for theme derivation and altitude-based coloring.
 * Ported from shared/config.js lines 63-156.
 *
 * IMPORTANT: These are pure functions with no framework or Cesium dependencies.
 * The original code mutated a global CONFIG object; here we return values instead.
 */

import type { DerivedColors } from './types';

/** Parse hex color string to [R, G, B] tuple (0-255 each) */
export function hexToRgb(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return [r, g, b];
}

/** Multiply RGB channels by a factor (clamp to 255) */
export function brighten(hex: string, factor = 1.3): string {
  const [r, g, b] = hexToRgb(hex);
  const clamp = (v: number) => Math.min(255, Math.round(v * factor));
  return `#${clamp(r).toString(16).padStart(2, '0')}${clamp(g).toString(16).padStart(2, '0')}${clamp(b).toString(16).padStart(2, '0')}`;
}

/** Return rgba() string from hex color + alpha */
export function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Lighten a hex color toward white by `amount` (0-1) */
export function lighten(hex: string, amount = 0.5): string {
  const [r, g, b] = hexToRgb(hex);
  const lr = Math.round(r + (255 - r) * amount);
  const lg = Math.round(g + (255 - g) * amount);
  const lb = Math.round(b + (255 - b) * amount);
  return `#${lr.toString(16).padStart(2, '0')}${lg.toString(16).padStart(2, '0')}${lb.toString(16).padStart(2, '0')}`;
}

/** HSL to RGB conversion. h in degrees, s and l in [0, 1]. */
export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = l - c / 2;
  let r1: number, g1: number, b1: number;
  if (h < 60)       { r1 = c; g1 = x; b1 = 0; }
  else if (h < 120) { r1 = x; g1 = c; b1 = 0; }
  else if (h < 180) { r1 = 0; g1 = c; b1 = x; }
  else if (h < 240) { r1 = 0; g1 = x; b1 = c; }
  else if (h < 300) { r1 = x; g1 = 0; b1 = c; }
  else              { r1 = c; g1 = 0; b1 = x; }
  return [Math.round((r1 + m) * 255), Math.round((g1 + m) * 255), Math.round((b1 + m) * 255)];
}

/**
 * Map barometric altitude to an RGB color.
 * Hue range: 0-300 (red→magenta) mapped from 0-40000 feet.
 *
 * Dark mode: vivid, glowing (s=100%, l=50%)
 * Light mode: muted, ink-like (s=55%, l=38%)
 */
export function altitudeToRgb(altMeters: number | null, theme: 'dark' | 'light'): [number, number, number] {
  const altFeet = (altMeters || 0) * 3.28084;
  const clamped = Math.max(0, Math.min(40000, altFeet));
  const hue = (clamped / 40000) * 300;
  if (theme === 'light') {
    return hslToRgb(hue, 0.55, 0.38);
  }
  return hslToRgb(hue, 1.0, 0.5);
}

/** Altitude color for selected (highlighted) aircraft */
export function altitudeToSelectedRgb(altMeters: number | null, theme: 'dark' | 'light'): [number, number, number] {
  const rgb = altitudeToRgb(altMeters, theme);
  if (theme === 'light') {
    return rgb.map(v => Math.round(v * 0.65)) as [number, number, number];
  }
  return rgb.map(v => Math.round(v + (255 - v) * 0.4)) as [number, number, number];
}

/** Map altitude to trail polyline width: 1px at ground → 6px at FL400 */
export function altitudeToTrailWidth(altMeters: number | null): number {
  const altFeet = (altMeters || 0) * 3.28084;
  const clamped = Math.max(0, Math.min(40000, altFeet));
  return 1 + (clamped / 40000) * 5;
}

/**
 * Derive all display colors from a single base hex color (dark mode).
 * Replaces the original setDarkColors() which mutated CONFIG.
 */
export function deriveDarkColors(hex: string): DerivedColors {
  return {
    phosphor: hex,
    phosphorBright: brighten(hex, 1.4),
    phosphorSelect: lighten(brighten(hex, 1.4), 0.5),
    phosphorDim: withAlpha(hex, 0.35),
    trailColor: hexToRgb(hex),
    labelOutlineMode: 'dark',
  };
}

/**
 * Derive all display colors from a single base hex color (light mode).
 * Replaces the original setLightColors() which mutated CONFIG.
 */
export function deriveLightColors(hex: string): DerivedColors {
  const safeHex = hex || '#1a1a1a';
  const [r, g, b] = hexToRgb(safeHex);
  const dk = (v: number) => Math.round(v * 0.6);
  const darkened = `#${dk(r).toString(16).padStart(2, '0')}${dk(g).toString(16).padStart(2, '0')}${dk(b).toString(16).padStart(2, '0')}`;
  return {
    phosphor: safeHex,
    phosphorBright: darkened,
    phosphorSelect: darkened,
    phosphorDim: withAlpha(safeHex, 0.45),
    trailColor: [r, g, b],
    labelOutlineMode: 'light',
  };
}
