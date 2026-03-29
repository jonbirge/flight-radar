#!/usr/bin/env node
// Download FAA airspace boundaries (Class B, C, D) and generate a JS database.
// Tries FAA ArcGIS service first (current data with altitudes), falls back to GitHub mirror.
// Run: npm run pull-data

'use strict';

const crypto = require('crypto');
const https = require('https');
const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, '..', 'data');
const OUT_FILE = path.join(OUT_DIR, 'airspace.json');

const CLASSES = new Set(['B', 'C', 'D']);
const REQUEST_TIMEOUT = 30000; // 30s

// FAA ArcGIS Feature Service (paginated queries filtered by class)
const FAA_BASE = 'https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/Class_Airspace/FeatureServer/0/query';
const BATCH_SIZE = 1000;

// Fallback: GitHub pre-processed GeoJSON (older data from 2014, but includes LOWALT/HIGHALT)
const GITHUB_URLS = {
  B: 'https://raw.githubusercontent.com/drnic/faa-airspace-data/master/class_b.geo.json',
  C: 'https://raw.githubusercontent.com/drnic/faa-airspace-data/master/class_c.geo.json',
  D: 'https://raw.githubusercontent.com/drnic/faa-airspace-data/master/class_d.geo.json',
};

function md5(filePath) {
  return crypto.createHash('md5').update(fs.readFileSync(filePath)).digest('hex');
}

function writeChecksum(filePath) {
  const hash = md5(filePath);
  fs.writeFileSync(filePath + '.md5', hash + '\n', 'utf8');
  return hash;
}

function verifyChecksum(filePath) {
  const md5File = filePath + '.md5';
  if (!fs.existsSync(md5File)) return null;
  const expected = fs.readFileSync(md5File, 'utf8').trim();
  const actual = md5(filePath);
  return actual === expected;
}

function fetch(url, timeout = REQUEST_TIMEOUT) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetch(res.headers.location, timeout).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(timeout, () => {
      req.destroy();
      reject(new Error(`Request timed out after ${timeout / 1000}s`));
    });
  });
}

// ---- FAA ArcGIS source ----

async function fetchFAAClass(cls) {
  const features = [];
  let offset = 0;

  while (true) {
    const params = new URLSearchParams({
      where: `CLASS='${cls}'`,
      outFields: 'NAME,CLASS,UPPER_VAL,UPPER_UOM,UPPER_CODE,LOWER_VAL,LOWER_UOM,LOWER_CODE,SECTOR',
      f: 'geojson',
      resultOffset: String(offset),
      resultRecordCount: String(BATCH_SIZE),
    });
    const url = `${FAA_BASE}?${params}`;
    console.log(`  Fetching Class ${cls} offset=${offset} ...`);
    const raw = await fetch(url);
    const data = JSON.parse(raw);

    if (!data.features || data.features.length === 0) break;
    features.push(...data.features);

    if (data.features.length < BATCH_SIZE) break;
    offset += BATCH_SIZE;
  }

  return features;
}

function parseFAAFeatures(features, cls) {
  const entries = [];
  for (const f of features) {
    const name = (f.properties.NAME || '').trim();
    const p = f.properties;
    const ceil = p.UPPER_VAL != null ? p.UPPER_VAL : null;
    const floor = p.LOWER_VAL != null ? p.LOWER_VAL : null;
    const ceilRef = p.UPPER_CODE || null;
    const floorRef = p.LOWER_CODE || null;
    const geom = f.geometry;
    if (!geom || !geom.coordinates) continue;

    if (geom.type === 'Polygon') {
      entries.push({ name, cls, ceil, floor, ceilRef, floorRef, coords: roundCoords(geom.coordinates[0]) });
    } else if (geom.type === 'MultiPolygon') {
      for (const poly of geom.coordinates) {
        entries.push({ name, cls, ceil, floor, ceilRef, floorRef, coords: roundCoords(poly[0]) });
      }
    }
  }
  return entries;
}

// ---- GitHub fallback source ----

async function fetchGitHubClass(cls) {
  const url = GITHUB_URLS[cls];
  console.log(`  Fetching Class ${cls} from GitHub ...`);
  const raw = await fetch(url);
  const data = JSON.parse(raw);
  return data.features || [];
}

function parseAltValue(val) {
  if (val == null || val === '') return null;
  const s = String(val).trim().toUpperCase();
  if (s === 'SFC') return 0;
  const n = parseInt(s, 10);
  return isNaN(n) ? null : n;
}

function parseGitHubFeatures(features, cls) {
  const entries = [];
  for (const f of features) {
    const p = f.properties;
    const name = (p.AIRSPACE || p.NAME || '').trim();
    const geom = f.geometry;
    if (!geom || !geom.coordinates) continue;

    // Parse LOWALT/HIGHALT fields (e.g. "SFC", "7000", "100")
    const floor = parseAltValue(p.LOWALT);
    const ceil = parseAltValue(p.HIGHALT);
    const floorRef = floor === 0 ? 'SFC' : (floor != null ? 'MSL' : null);
    const ceilRef = ceil != null ? 'MSL' : null;

    if (geom.type === 'Polygon') {
      entries.push({ name, cls, ceil, floor, ceilRef, floorRef, coords: roundCoords(geom.coordinates[0]) });
    } else if (geom.type === 'MultiPolygon') {
      for (const poly of geom.coordinates) {
        entries.push({ name, cls, ceil, floor, ceilRef, floorRef, coords: roundCoords(poly[0]) });
      }
    }
  }
  return entries;
}

// ---- Shared helpers ----

// Douglas-Peucker line simplification (reduces dense arc approximations)
function perpendicularDistance(point, lineStart, lineEnd) {
  const dx = lineEnd[0] - lineStart[0];
  const dy = lineEnd[1] - lineStart[1];
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    const ex = point[0] - lineStart[0];
    const ey = point[1] - lineStart[1];
    return Math.sqrt(ex * ex + ey * ey);
  }
  const t = Math.max(0, Math.min(1, ((point[0] - lineStart[0]) * dx + (point[1] - lineStart[1]) * dy) / lenSq));
  const projX = lineStart[0] + t * dx;
  const projY = lineStart[1] + t * dy;
  const ex = point[0] - projX;
  const ey = point[1] - projY;
  return Math.sqrt(ex * ex + ey * ey);
}

function simplify(coords, epsilon) {
  if (coords.length <= 3) return coords;

  let maxDist = 0;
  let maxIdx = 0;
  const last = coords.length - 1;
  for (let i = 1; i < last; i++) {
    const d = perpendicularDistance(coords[i], coords[0], coords[last]);
    if (d > maxDist) { maxDist = d; maxIdx = i; }
  }

  if (maxDist > epsilon) {
    const left = simplify(coords.slice(0, maxIdx + 1), epsilon);
    const right = simplify(coords.slice(maxIdx), epsilon);
    return left.slice(0, -1).concat(right);
  }
  return [coords[0], coords[last]];
}

// Epsilon ~0.001 degrees ≈ ~100m — preserves shape while cutting 80%+ of points
const SIMPLIFY_EPSILON = 0.001;

function roundCoords(coords) {
  const simplified = simplify(coords, SIMPLIFY_EPSILON);
  return simplified.map(([lon, lat]) => [+lon.toFixed(4), +lat.toFixed(4)]);
}

async function main() {
  // Verify existing data if present
  if (fs.existsSync(OUT_FILE)) {
    const valid = verifyChecksum(OUT_FILE);
    if (valid === null) {
      const hash = writeChecksum(OUT_FILE);
      console.log(`Airspace data exists, checksum recorded: ${hash} — skipping download.`);
      return;
    } else if (valid) {
      console.log('Airspace data exists and checksum OK — skipping download.');
      return;
    } else {
      console.warn('Airspace data CHECKSUM MISMATCH — re-downloading...');
    }
  }

  let allEntries = [];
  const counts = {};
  let source;

  // // Try FAA ArcGIS first (current data with full altitude info)
  // console.log('Trying FAA ArcGIS service ...');
  // try {
  //   for (const cls of CLASSES) {
  //     const features = await fetchFAAClass(cls);
  //     const parsed = parseFAAFeatures(features, cls);
  //     counts[cls] = parsed.length;
  //     allEntries.push(...parsed);
  //   }
  //   source = 'FAA ArcGIS';
  // } catch (err) {
  //   console.warn(`\nFAA ArcGIS failed: ${err.message}`);
  //   console.log('Falling back to GitHub mirror (older data) ...\n');

    allEntries = [];
    source = 'GitHub (drnic/faa-airspace-data)';
    for (const cls of CLASSES) {
      const features = await fetchGitHubClass(cls);
      const parsed = parseGitHubFeatures(features, cls);
      counts[cls] = parsed.length;
      allEntries.push(...parsed);
    }
  // }

  if (allEntries.length === 0) {
    console.warn('WARNING: No airspace data retrieved from any source — keeping existing data.');
    return;
  }

  // Report altitude data availability
  const withAltitude = allEntries.filter(e => e.ceil != null && e.floor != null);
  const altPct = Math.round((withAltitude.length / allEntries.length) * 100);
  console.log(`\nAltitude data: ${withAltitude.length}/${allEntries.length} entries (${altPct}%)`);

  // Sort by class then name for deterministic output
  allEntries.sort((a, b) => a.cls.localeCompare(b.cls) || a.name.localeCompare(b.name));

  // Write output
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  const content = JSON.stringify(allEntries);
  fs.writeFileSync(OUT_FILE, content, 'utf8');
  writeChecksum(OUT_FILE);

  console.log(`\nSource: ${source}`);
  console.log(`Class B: ${counts.B || 0}`);
  console.log(`Class C: ${counts.C || 0}`);
  console.log(`Class D: ${counts.D || 0}`);
  console.log(`Total entries: ${allEntries.length}`);
  console.log(`Wrote ${OUT_FILE}`);
}

main().catch((err) => {
  console.warn(`WARNING: Airspace download failed: ${err.message} — keeping existing data.`);
});
