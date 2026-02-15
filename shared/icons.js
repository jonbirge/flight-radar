// Shared aircraft icon generation
// Canvas-based symbols used as Cesium billboards

'use strict';

// Create a canvas-based aircraft symbol (small chevron/arrow)
function createAircraftIcon(heading = 0, selected = false, colorOverride = null) {
  const size = 20;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  ctx.translate(size / 2, size / 2);
  ctx.rotate((heading * Math.PI) / 180);

  // Draw chevron pointing up (north)
  ctx.beginPath();
  ctx.moveTo(0, -7);     // nose
  ctx.lineTo(5, 5);      // right wing tip
  ctx.lineTo(0, 2);      // tail notch
  ctx.lineTo(-5, 5);     // left wing tip
  ctx.closePath();

  const color = colorOverride || (selected ? CONFIG.phosphorSelect : CONFIG.phosphor);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 0.5;
  ctx.stroke();

  return canvas;
}

// Create a triangle icon for navaids (VOR, NDB, etc.)
// Render at 4x resolution for crisp display
function createNavaidIcon(size, cssColor) {
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
  return canvas;
}

// Create a simple dot icon for zoomed-out LOD
// Render at 4x resolution for clean anti-aliased circles at small display sizes
function createDotIcon(size, bright = false, colorOverride = null) {
  const scale = 4;
  const res = size * scale;
  const canvas = document.createElement('canvas');
  canvas.width = res;
  canvas.height = res;
  const ctx = canvas.getContext('2d');
  ctx.beginPath();
  ctx.arc(res / 2, res / 2, res / 2, 0, Math.PI * 2);
  ctx.fillStyle = colorOverride || (bright ? CONFIG.phosphorSelect : CONFIG.phosphor);
  ctx.fill();
  return canvas;
}
