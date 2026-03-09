/**
 * Canvas-based aircraft and weather icon generation.
 * Ported from shared/icons.js.
 *
 * Uses canvas API but does NOT query the DOM or access global state.
 * All color/style parameters are passed explicitly (no CONFIG dependency).
 *
 * Icons are cached by key to avoid redundant canvas rendering and GPU texture issues.
 */

// ============================================================
// Caches
// ============================================================

const iconCache = {
  aircraft: new Map<string, string>(),
  dot: new Map<string, string>(),
  navaid: new Map<string, string>(),
  pirep: new Map<string, string>(),
};

/** Flush all icon caches (call on theme change) */
export function clearIconCaches(): void {
  iconCache.aircraft.clear();
  iconCache.dot.clear();
  iconCache.navaid.clear();
  iconCache.pirep.clear();
}

// ============================================================
// Aircraft Icon (chevron/arrow)
// ============================================================

/**
 * Create a canvas-based aircraft chevron icon.
 *
 * @param heading - aircraft heading in degrees (0-360)
 * @param color - CSS fill color
 * @returns data URL string
 */
export function createAircraftIcon(heading = 0, color: string): string {
  const roundedHeading = Math.round(heading / 5) * 5;
  const key = `${roundedHeading}:${color}`;
  const cached = iconCache.aircraft.get(key);
  if (cached) return cached;

  const size = 20;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  ctx.translate(size / 2, size / 2);
  ctx.rotate((roundedHeading * Math.PI) / 180);

  // Draw chevron pointing up (north)
  ctx.beginPath();
  ctx.moveTo(0, -7);     // nose
  ctx.lineTo(5, 5);      // right wing tip
  ctx.lineTo(0, 2);      // tail notch
  ctx.lineTo(-5, 5);     // left wing tip
  ctx.closePath();

  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 0.5;
  ctx.stroke();

  const dataUrl = canvas.toDataURL();
  if (iconCache.aircraft.size > 2000) iconCache.aircraft.clear();
  iconCache.aircraft.set(key, dataUrl);
  return dataUrl;
}

// ============================================================
// Dot Icon (zoomed-out LOD)
// ============================================================

/**
 * Create a dot icon for far-zoom LOD display. Rendered at 4x resolution.
 *
 * @param size - display size in pixels
 * @param color - CSS fill color
 * @returns data URL string
 */
export function createDotIcon(size: number, color: string): string {
  const key = `${size}:${color}`;
  const cached = iconCache.dot.get(key);
  if (cached) return cached;

  const scale = 4;
  const res = size * scale;
  const canvas = document.createElement('canvas');
  canvas.width = res;
  canvas.height = res;
  const ctx = canvas.getContext('2d')!;
  ctx.beginPath();
  ctx.arc(res / 2, res / 2, res / 2, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();

  const dataUrl = canvas.toDataURL();
  if (iconCache.dot.size > 500) iconCache.dot.clear();
  iconCache.dot.set(key, dataUrl);
  return dataUrl;
}

// ============================================================
// Navaid Icon (triangle)
// ============================================================

/**
 * Create a triangle icon for navaids (VOR, NDB, etc.). Rendered at 4x resolution.
 *
 * @param size - display size in pixels
 * @param cssColor - CSS fill color
 * @returns data URL string
 */
export function createNavaidIcon(size: number, cssColor: string): string {
  const key = `${size}:${cssColor}`;
  const cached = iconCache.navaid.get(key);
  if (cached) return cached;

  const scale = 4;
  const res = size * scale;
  const canvas = document.createElement('canvas');
  canvas.width = res;
  canvas.height = res;
  const ctx = canvas.getContext('2d')!;

  const cx = res / 2;
  const r = res / 2 - scale; // slight inset for clean edges

  // Equilateral triangle pointing up
  ctx.beginPath();
  ctx.moveTo(cx, cx - r);                                             // top
  ctx.lineTo(cx + r * Math.cos(Math.PI / 6), cx + r * Math.sin(Math.PI / 6));  // bottom-right
  ctx.lineTo(cx - r * Math.cos(Math.PI / 6), cx + r * Math.sin(Math.PI / 6));  // bottom-left
  ctx.closePath();

  ctx.fillStyle = cssColor;
  ctx.fill();

  const dataUrl = canvas.toDataURL();
  iconCache.navaid.set(key, dataUrl);
  return dataUrl;
}

// ============================================================
// PIREP Icon (turbulence bumps)
// ============================================================

/**
 * Create a PIREP turbulence icon using standard symbology.
 * NEG/SMT = open circle, LGT = 1 bump, MOD = 2 bumps, SEV = 3 bumps, EXTRM = 3 bumps + bar.
 * Rendered at 4x resolution.
 *
 * @param intensity - turbulence intensity string (e.g., "MOD", "SEV-EXTRM")
 * @param cssColor - CSS color for stroke/fill
 * @returns data URL string
 */
export function createPirepIcon(intensity: string, cssColor: string): string {
  const key = `${intensity}:${cssColor}`;
  const cached = iconCache.pirep.get(key);
  if (cached) return cached;

  const scale = 4;
  const size = 36;
  const res = size * scale;
  const canvas = document.createElement('canvas');
  canvas.width = res;
  canvas.height = res;
  const ctx = canvas.getContext('2d')!;

  ctx.strokeStyle = cssColor;
  ctx.fillStyle = cssColor;
  ctx.lineWidth = scale * 4.5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const cx = res / 2;
  const cy = res / 2;
  const upper = (intensity || '').toUpperCase().replace(/-/g, '');

  let bumps = 1; // default LGT
  if (upper.includes('EXTRM'))     bumps = 4; // 3 bumps + bar
  else if (upper.includes('SEV'))  bumps = 3;
  else if (upper.includes('MOD'))  bumps = 2;
  else if (upper.includes('NEG') || upper.includes('SMT')) bumps = 0;

  if (bumps === 0) {
    // NEG/Smooth: open circle
    const r = res * 0.3;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    // Draw bump pattern (carets stacked vertically)
    const count = Math.min(bumps, 3);
    const bumpW = res * 0.35;
    const bumpH = res * 0.18;
    const gap = scale * 4.5;
    const totalH = count * bumpH + (count - 1) * gap;
    const startY = cy - totalH / 2 + bumpH / 2;

    for (let i = 0; i < count; i++) {
      const y = startY + i * (bumpH + gap);
      ctx.beginPath();
      ctx.moveTo(cx - bumpW, y + bumpH / 2);
      ctx.lineTo(cx, y - bumpH / 2);
      ctx.lineTo(cx + bumpW, y + bumpH / 2);
      ctx.stroke();
    }

    // EXTRM: add horizontal bar below the bumps
    if (bumps === 4) {
      const barY = startY + count * (bumpH + gap);
      ctx.beginPath();
      ctx.moveTo(cx - bumpW, barY);
      ctx.lineTo(cx + bumpW, barY);
      ctx.stroke();
    }
  }

  const dataUrl = canvas.toDataURL();
  if (iconCache.pirep.size > 200) iconCache.pirep.clear();
  iconCache.pirep.set(key, dataUrl);
  return dataUrl;
}
