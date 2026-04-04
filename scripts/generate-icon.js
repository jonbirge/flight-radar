#!/usr/bin/env node
// Generates application icons for all desktop platforms (macOS, Windows, Linux)
// No external dependencies — uses only Node.js built-ins
//
// Outputs to assets/:
//   icon.png   — 1024x1024 PNG (Linux, source for all sizes)
//   icon.ico   — Windows ICO (256, 48, 32, 16)
//   icon.icns  — macOS ICNS (1024, 512, 256, 128)

const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

// ═══════ CRC32 (needed for PNG chunks) ═══════
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  crcTable[n] = c;
}
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

// ═══════ PNG Encoder ═══════
function encodePNG(w, h, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA

  const stride = 1 + w * 4;
  const raw = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    raw[y * stride] = 0; // filter: None
    rgba.copy(raw, y * stride + 1, y * w * 4, (y + 1) * w * 4);
  }
  const compressed = zlib.deflateSync(raw, { level: 9 });

  function chunk(type, data) {
    const t = Buffer.from(type, 'ascii');
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const crcBuf = Buffer.alloc(4); crcBuf.writeUInt32BE(crc32(Buffer.concat([t, data])));
    return Buffer.concat([len, t, data, crcBuf]);
  }
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', compressed), chunk('IEND', Buffer.alloc(0))]);
}

// ═══════ ICO Encoder (PNG-in-ICO for all sizes) ═══════
function encodeICO(pngBufs, sizes) {
  const hdr = Buffer.alloc(6);
  hdr.writeUInt16LE(1, 2); // type = ICO
  hdr.writeUInt16LE(pngBufs.length, 4);
  let off = 6 + pngBufs.length * 16;
  const dirs = pngBufs.map((png, i) => {
    const e = Buffer.alloc(16);
    e[0] = sizes[i] >= 256 ? 0 : sizes[i]; // 0 means 256
    e[1] = sizes[i] >= 256 ? 0 : sizes[i];
    e.writeUInt16LE(1, 4);  // planes
    e.writeUInt16LE(32, 6); // bpp
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(off, 12);
    off += png.length;
    return e;
  });
  return Buffer.concat([hdr, ...dirs, ...pngBufs]);
}

// ═══════ ICNS Encoder (PNG-in-ICNS for macOS) ═══════
// Modern ICNS uses tagged chunks containing PNG data
const ICNS_TYPES = {
  1024: 'ic10',  // 1024x1024 (512x512@2x)
  512:  'ic09',  // 512x512
  256:  'ic08',  // 256x256
  128:  'ic07',  // 128x128
};

function encodeICNS(pngBufs, sizes) {
  const chunks = [];
  for (let i = 0; i < sizes.length; i++) {
    const type = ICNS_TYPES[sizes[i]];
    if (!type) continue;
    const tag = Buffer.from(type, 'ascii');         // 4 bytes
    const len = Buffer.alloc(4);
    len.writeUInt32BE(8 + pngBufs[i].length);       // size includes tag + length + data
    chunks.push(Buffer.concat([tag, len, pngBufs[i]]));
  }
  const body = Buffer.concat(chunks);
  const header = Buffer.alloc(8);
  header.write('icns', 0, 4, 'ascii');
  header.writeUInt32BE(8 + body.length, 4);
  return Buffer.concat([header, body]);
}

// ═══════ Canvas with alpha compositing ═══════
class Canvas {
  constructor(size) { this.size = size; this.data = new Float64Array(size * size * 4); }

  // Porter-Duff src-over
  blend(x, y, r, g, b, a) {
    if (x < 0 || x >= this.size || y < 0 || y >= this.size) return;
    const i = (y * this.size + x) * 4;
    const da = this.data[i + 3], oa = a + da * (1 - a);
    if (oa > 0.001) {
      this.data[i]     = (r * a + this.data[i]     * da * (1 - a)) / oa;
      this.data[i + 1] = (g * a + this.data[i + 1] * da * (1 - a)) / oa;
      this.data[i + 2] = (b * a + this.data[i + 2] * da * (1 - a)) / oa;
      this.data[i + 3] = oa;
    }
  }

  fillCircle(cx, cy, rad, r, g, b, a) {
    for (let y = Math.max(0, Math.floor(cy - rad - 1)); y <= Math.min(this.size - 1, Math.ceil(cy + rad + 1)); y++)
      for (let x = Math.max(0, Math.floor(cx - rad - 1)); x <= Math.min(this.size - 1, Math.ceil(cx + rad + 1)); x++) {
        const d = Math.hypot(x - cx, y - cy);
        if (d <= rad + 0.5) this.blend(x, y, r, g, b, a * Math.min(1, rad + 0.5 - d));
      }
  }

  strokeCircle(cx, cy, rad, r, g, b, a, thick) {
    const out = rad + thick / 2 + 1;
    for (let y = Math.max(0, Math.floor(cy - out)); y <= Math.min(this.size - 1, Math.ceil(cy + out)); y++)
      for (let x = Math.max(0, Math.floor(cx - out)); x <= Math.min(this.size - 1, Math.ceil(cx + out)); x++) {
        const ed = Math.abs(Math.hypot(x - cx, y - cy) - rad);
        if (ed <= thick / 2 + 0.5) this.blend(x, y, r, g, b, a * Math.min(1, thick / 2 + 0.5 - ed));
      }
  }

  drawLine(x0, y0, x1, y1, r, g, b, a, thick) {
    const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy);
    if (len < 0.001) return;
    const nx = -dy / len, ny = dx / len;
    for (let y = Math.max(0, Math.floor(Math.min(y0, y1) - thick - 1)); y <= Math.min(this.size - 1, Math.ceil(Math.max(y0, y1) + thick + 1)); y++)
      for (let x = Math.max(0, Math.floor(Math.min(x0, x1) - thick - 1)); x <= Math.min(this.size - 1, Math.ceil(Math.max(x0, x1) + thick + 1)); x++) {
        const t = ((x - x0) * dx + (y - y0) * dy) / (len * len);
        if (t < -1 / len || t > 1 + 1 / len) continue;
        const pd = Math.abs((x - x0) * nx + (y - y0) * ny);
        if (pd > thick / 2 + 0.5) continue;
        let cov = Math.min(1, thick / 2 + 0.5 - pd);
        if (t < 0) cov *= Math.max(0, 1 + t * len);
        if (t > 1) cov *= Math.max(0, 1 - (t - 1) * len);
        this.blend(x, y, r, g, b, a * Math.min(1, cov));
      }
  }

  drawLineGradient(x0, y0, x1, y1, colorFn, thick) {
    const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy);
    if (len < 0.001) return;
    const nx = -dy / len, ny = dx / len;
    const half = thick / 2;
    for (let y = Math.max(0, Math.floor(Math.min(y0, y1) - thick - 1)); y <= Math.min(this.size - 1, Math.ceil(Math.max(y0, y1) + thick + 1)); y++)
      for (let x = Math.max(0, Math.floor(Math.min(x0, x1) - thick - 1)); x <= Math.min(this.size - 1, Math.ceil(Math.max(x0, x1) + thick + 1)); x++) {
        const t = ((x - x0) * dx + (y - y0) * dy) / (len * len);
        if (t < -1 / len || t > 1 + 1 / len) continue;
        const sd = (x - x0) * nx + (y - y0) * ny;
        const pd = Math.abs(sd);
        if (pd > half + 0.5) continue;
        let cov = Math.min(1, half + 0.5 - pd);
        if (t < 0) cov *= Math.max(0, 1 + t * len);
        if (t > 1) cov *= Math.max(0, 1 - (t - 1) * len);
        const tc = Math.max(0, Math.min(1, t));
        const pc = Math.max(-1, Math.min(1, sd / half));
        const [r, g, b, a] = colorFn(tc, pc);
        this.blend(x, y, r, g, b, a * Math.min(1, cov));
      }
  }

  clipCircle(cx, cy, rad) {
    for (let y = 0; y < this.size; y++)
      for (let x = 0; x < this.size; x++) {
        const d = Math.hypot(x - cx, y - cy);
        const i = (y * this.size + x) * 4;
        if (d > rad + 0.5) this.data[i + 3] = 0;
        else if (d > rad - 0.5) this.data[i + 3] *= (rad + 0.5 - d);
      }
  }

  toBuffer() {
    const buf = Buffer.alloc(this.size * this.size * 4);
    for (let i = 0; i < this.size * this.size; i++) {
      buf[i * 4]     = Math.round(Math.min(1, Math.max(0, this.data[i * 4]))     * 255);
      buf[i * 4 + 1] = Math.round(Math.min(1, Math.max(0, this.data[i * 4 + 1])) * 255);
      buf[i * 4 + 2] = Math.round(Math.min(1, Math.max(0, this.data[i * 4 + 2])) * 255);
      buf[i * 4 + 3] = Math.round(Math.min(1, Math.max(0, this.data[i * 4 + 3])) * 255);
    }
    return buf;
  }
}

// ═══════ Draw the radar icon ═══════
function drawRadarIcon(size) {
  const c = new Canvas(size);
  const cx = (size - 1) / 2, cy = (size - 1) / 2;
  const s = size / 256; // scale factor relative to 256px

  // Compute outer ring width first so maxR accounts for it
  const ow = Math.max(1.5, 3.2 * s) * 3;
  const maxR = (size - 1) / 2 - ow / 2 - 1;

  // 1. Dark background disc
  c.fillCircle(cx, cy, maxR, 0.01, 0.05, 0.01, 1.0);

  // 2. Sweep glow — trailing wedge behind the sweep line
  const sweepDeg = 330; // clockwise from 12 o'clock
  const trailDeg = 110;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const dist = Math.hypot(x - cx, y - cy);
      if (dist > maxR - 1 || dist < 1) continue;
      let ang = Math.atan2(x - cx, -(y - cy)) * 180 / Math.PI;
      if (ang < 0) ang += 360;
      let behind = sweepDeg - ang;
      if (behind < 0) behind += 360;
      if (behind >= 0 && behind < trailDeg) {
        const t = 1 - behind / trailDeg;
        const glow = t * t * 0.45 * (1 - dist / maxR * 0.3);
        c.blend(x, y, 0, 0.75, 0.25, glow);
      }
    }

  // 3. Range rings (3 concentric) — 3x thicker
  const rw = Math.max(0.8, 1.4 * s) * 3;
  for (let i = 1; i <= 3; i++)
    c.strokeCircle(cx, cy, maxR * i / 4, 0, 0.38, 0.12, 0.45, rw);

  // 4. Crosshair lines — 3x thicker
  const lw = Math.max(0.6, 1.2 * s) * 3;
  c.drawLine(cx - maxR, cy, cx + maxR, cy, 0, 0.3, 0.1, 0.45, lw);
  c.drawLine(cx, cy - maxR, cx, cy + maxR, 0, 0.3, 0.1, 0.45, lw);

  // 5. Sweep line — solid bright, fully opaque
  const sw = Math.max(1, 2.5 * s) * 3.5;
  const sRad = sweepDeg * Math.PI / 180;
  c.drawLine(cx, cy, cx + maxR * Math.sin(sRad), cy - maxR * Math.cos(sRad), 0.15, 1.0, 0.4, 1.0, sw);

  // 6. Aircraft blips — 3x larger with multi-color gradient trails showing motion
  const br = Math.max(1.2, 3 * s) * 3;

  // Blip 1: cyan-to-green trail with bright head (near sweep line)
  {
    const headAng = 310, trailLen = 25, steps = 6;
    const dist = maxR * 0.55;
    for (let i = steps; i >= 0; i--) {
      const t = i / steps;
      const ang = (headAng - trailLen * t) * Math.PI / 180;
      const d = dist - t * maxR * 0.04;
      const px = cx + d * Math.sin(ang), py = cy - d * Math.cos(ang);
      const dotR = br * (1 - t * 0.5);
      const r = 0.0 + 0.15 * (1 - t);
      const g = 0.6 + 0.4 * (1 - t);
      const b = 0.8 * t + 0.35 * (1 - t);
      const a = 0.25 + 0.75 * (1 - t);
      c.fillCircle(px, py, dotR, r, g, b, a);
    }
  }

  // Blip 2: amber-to-yellow trail (further behind sweep)
  {
    const headAng = 285, trailLen = 20, steps = 5;
    const dist = maxR * 0.72;
    for (let i = steps; i >= 0; i--) {
      const t = i / steps;
      const ang = (headAng - trailLen * t) * Math.PI / 180;
      const d = dist + t * maxR * 0.02;
      const px = cx + d * Math.sin(ang), py = cy - d * Math.cos(ang);
      const dotR = br * 0.8 * (1 - t * 0.5);
      const r = 0.8 + 0.2 * (1 - t);
      const g = 0.5 + 0.4 * (1 - t);
      const b = 0.0;
      const a = 0.2 + 0.65 * (1 - t);
      c.fillCircle(px, py, dotR, r, g, b, a);
    }
  }

  // Blip 3: magenta-to-white trail (small, close to center)
  {
    const headAng = 320, trailLen = 18, steps = 4;
    const dist = maxR * 0.32;
    for (let i = steps; i >= 0; i--) {
      const t = i / steps;
      const ang = (headAng - trailLen * t) * Math.PI / 180;
      const d = dist - t * maxR * 0.02;
      const px = cx + d * Math.sin(ang), py = cy - d * Math.cos(ang);
      const dotR = br * 0.6 * (1 - t * 0.5);
      const r = 0.7 * t + 0.3 * (1 - t);
      const g = 0.3 * t + 0.95 * (1 - t);
      const b = 0.8 * t + 0.5 * (1 - t);
      const a = 0.2 + 0.7 * (1 - t);
      c.fillCircle(px, py, dotR, r, g, b, a);
    }
  }

  // Blip 4: red-to-orange trail (outer, behind sweep)
  {
    const headAng = 275, trailLen = 22, steps = 5;
    const dist = maxR * 0.48;
    for (let i = steps; i >= 0; i--) {
      const t = i / steps;
      const ang = (headAng - trailLen * t) * Math.PI / 180;
      const d = dist + t * maxR * 0.03;
      const px = cx + d * Math.sin(ang), py = cy - d * Math.cos(ang);
      const dotR = br * 0.7 * (1 - t * 0.5);
      const r = 1.0;
      const g = 0.2 + 0.4 * (1 - t);
      const b = 0.0;
      const a = 0.2 + 0.7 * (1 - t);
      c.fillCircle(px, py, dotR, r, g, b, a);
    }
  }

  // Blip 5: blue-to-white trail (far from sweep, faded)
  {
    const headAng = 250, trailLen = 18, steps = 4;
    const dist = maxR * 0.62;
    for (let i = steps; i >= 0; i--) {
      const t = i / steps;
      const ang = (headAng - trailLen * t) * Math.PI / 180;
      const d = dist - t * maxR * 0.02;
      const px = cx + d * Math.sin(ang), py = cy - d * Math.cos(ang);
      const dotR = br * 0.65 * (1 - t * 0.5);
      const r = 0.3 * (1 - t) + 0.2 * t;
      const g = 0.5 * (1 - t) + 0.3 * t;
      const b = 1.0 * t + 0.9 * (1 - t);
      const a = 0.15 + 0.55 * (1 - t);
      c.fillCircle(px, py, dotR, r, g, b, a);
    }
  }

  // Blip 6: green-to-lime trail (opposite side, near sweep leading edge)
  {
    const headAng = 335, trailLen = 15, steps = 4;
    const dist = maxR * 0.82;
    for (let i = steps; i >= 0; i--) {
      const t = i / steps;
      const ang = (headAng - trailLen * t) * Math.PI / 180;
      const d = dist - t * maxR * 0.01;
      const px = cx + d * Math.sin(ang), py = cy - d * Math.cos(ang);
      const dotR = br * 0.55 * (1 - t * 0.5);
      const r = 0.2 * (1 - t);
      const g = 1.0 * (1 - t) + 0.5 * t;
      const b = 0.1;
      const a = 0.2 + 0.8 * (1 - t);
      c.fillCircle(px, py, dotR, r, g, b, a);
    }
  }

  // 7. Outer ring (bold) — 3x thicker (ow computed above for maxR sizing)
  c.strokeCircle(cx, cy, maxR, 0, 0.8, 0.27, 0.9, ow);

  // 8. Center dot — 3x larger
  c.fillCircle(cx, cy, Math.max(1.2, 2 * s) * 3, 0, 0.8, 0.27, 0.85);

  // Clip to circular boundary
  c.clipCircle(cx, cy, maxR + ow / 2);

  return c;
}

// ═══════ Bilinear downscale ═══════
function downscale(srcData, srcSize, dstSize) {
  const dst = Buffer.alloc(dstSize * dstSize * 4);
  const ratio = srcSize / dstSize;
  for (let y = 0; y < dstSize; y++)
    for (let x = 0; x < dstSize; x++) {
      const sx = (x + 0.5) * ratio - 0.5;
      const sy = (y + 0.5) * ratio - 0.5;
      const x0 = Math.max(0, Math.floor(sx)), y0 = Math.max(0, Math.floor(sy));
      const x1 = Math.min(srcSize - 1, x0 + 1), y1 = Math.min(srcSize - 1, y0 + 1);
      const fx = sx - x0, fy = sy - y0;
      const di = (y * dstSize + x) * 4;
      for (let c = 0; c < 4; c++) {
        const v00 = srcData[(y0 * srcSize + x0) * 4 + c];
        const v10 = srcData[(y0 * srcSize + x1) * 4 + c];
        const v01 = srcData[(y1 * srcSize + x0) * 4 + c];
        const v11 = srcData[(y1 * srcSize + x1) * 4 + c];
        dst[di + c] = Math.round(v00 * (1 - fx) * (1 - fy) + v10 * fx * (1 - fy) + v01 * (1 - fx) * fy + v11 * fx * fy);
      }
    }
  return dst;
}

// ═══════ Main ═══════
const outDir = path.join(__dirname, '..', 'assets');
fs.mkdirSync(outDir, { recursive: true });

// Render master icon at 1024x1024 (macOS retina needs this)
console.log('Generating application icons...');
const masterSize = 1024;
const canvas = drawRadarIcon(masterSize);
const masterBuf = canvas.toBuffer();

// Generate PNGs at all needed sizes
const allSizes = [1024, 512, 256, 128, 48, 32, 16];
const pngBySize = {};
for (const sz of allSizes) {
  const rgba = sz === masterSize ? masterBuf : downscale(masterBuf, masterSize, sz);
  pngBySize[sz] = encodePNG(sz, sz, rgba);
}

// icon.png — 1024x1024 master (Linux, and source-of-truth)
fs.writeFileSync(path.join(outDir, 'icon.png'), pngBySize[1024]);
console.log('  icon.png (1024x1024)');

// icon.ico — Windows (256, 48, 32, 16)
const icoSizes = [256, 48, 32, 16];
fs.writeFileSync(path.join(outDir, 'icon.ico'), encodeICO(icoSizes.map(s => pngBySize[s]), icoSizes));
console.log('  icon.ico (256, 48, 32, 16)');

// icon.icns — macOS (1024, 512, 256, 128)
const icnsSizes = [1024, 512, 256, 128];
fs.writeFileSync(path.join(outDir, 'icon.icns'), encodeICNS(icnsSizes.map(s => pngBySize[s]), icnsSizes));
console.log('  icon.icns (1024, 512, 256, 128)');

// favicon.png — site favicon (256x256)
const siteDir = path.join(__dirname, '..', 'site');
fs.mkdirSync(siteDir, { recursive: true });
fs.writeFileSync(path.join(siteDir, 'favicon.png'), pngBySize[256]);
console.log('  site/favicon.png (256x256)');

console.log('Done!');
