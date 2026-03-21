// Shared aircraft icon generation
// Canvas-rendered symbols returned as data URLs for Cesium billboards

'use strict';

// Icon caches: store data URL strings to avoid redundant canvas rendering and GPU texture issues
const _iconCache = { aircraft: new Map(), dot: new Map(), navaid: new Map(), pirep: new Map() };

function clearIconCaches() {
  _iconCache.aircraft.clear();
  _iconCache.dot.clear();
  _iconCache.navaid.clear();
  _iconCache.pirep.clear();
}

// Create a canvas-based aircraft symbol (small chevron/arrow)
function createAircraftIcon(heading = 0, selected = false, colorOverride = null) {
  const color = colorOverride || (selected ? CONFIG.phosphorSelect : CONFIG.phosphor);
  const roundedHeading = Math.round(heading / 5) * 5;
  const key = `${roundedHeading}:${color}`;
  const cached = _iconCache.aircraft.get(key);
  if (cached) return cached;

  const size = 20;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

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
  if (_iconCache.aircraft.size > 2000) _iconCache.aircraft.clear();
  _iconCache.aircraft.set(key, dataUrl);
  return dataUrl;
}

// Create a triangle icon for navaids (VOR, NDB, etc.)
// Render at 4x resolution for crisp display
function createNavaidIcon(size, cssColor) {
  const key = `${size}:${cssColor}`;
  const cached = _iconCache.navaid.get(key);
  if (cached) return cached;

  const scale = 4;
  const res = size * scale;
  const canvas = document.createElement('canvas');
  canvas.width = res;
  canvas.height = res;
  const ctx = canvas.getContext('2d');

  const cx = res / 2;
  const r = res / 2 - scale; // slight inset for clean edges

  // Equilateral triangle pointing up
  ctx.beginPath();
  ctx.moveTo(cx, cx - r);                           // top
  ctx.lineTo(cx + r * Math.cos(Math.PI / 6), cx + r * Math.sin(Math.PI / 6));  // bottom-right
  ctx.lineTo(cx - r * Math.cos(Math.PI / 6), cx + r * Math.sin(Math.PI / 6));  // bottom-left
  ctx.closePath();

  ctx.fillStyle = cssColor;
  ctx.fill();
  const dataUrl = canvas.toDataURL();
  _iconCache.navaid.set(key, dataUrl);
  return dataUrl;
}

// Create a simple dot icon for zoomed-out LOD
// Render at 4x resolution for clean anti-aliased circles at small display sizes
function createDotIcon(size, bright = false, colorOverride = null) {
  const color = colorOverride || (bright ? CONFIG.phosphorSelect : CONFIG.phosphor);
  const key = `${size}:${color}`;
  const cached = _iconCache.dot.get(key);
  if (cached) return cached;

  const scale = 4;
  const res = size * scale;
  const canvas = document.createElement('canvas');
  canvas.width = res;
  canvas.height = res;
  const ctx = canvas.getContext('2d');
  ctx.beginPath();
  ctx.arc(res / 2, res / 2, res / 2, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  const dataUrl = canvas.toDataURL();
  if (_iconCache.dot.size > 500) _iconCache.dot.clear();
  _iconCache.dot.set(key, dataUrl);
  return dataUrl;
}

// Standard turbulence symbology for PIREPs
// NEG/SMT = open circle, LGT = 1 bump, MOD = 2 bumps, SEV = 3 bumps, EXTRM = 3 bumps + bar
function createPirepIcon(intensity, cssColor) {
  const key = `${intensity}:${cssColor}`;
  const cached = _iconCache.pirep.get(key);
  if (cached) return cached;

  const scale = 4;
  const size = 36;
  const res = size * scale;
  const canvas = document.createElement('canvas');
  canvas.width = res;
  canvas.height = res;
  const ctx = canvas.getContext('2d');

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
    const bumpW = res * 0.35;  // half-width of each bump
    const bumpH = res * 0.18;  // height of each bump
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
  if (_iconCache.pirep.size > 200) _iconCache.pirep.clear();
  _iconCache.pirep.set(key, dataUrl);
  return dataUrl;
}
