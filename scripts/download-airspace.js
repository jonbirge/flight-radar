#!/usr/bin/env node
// Download FAA airspace boundaries (Class B, C, D) and generate a JS database.
// Tries FAA ArcGIS service first, falls back to GitHub mirror if it times out.
// Run: npm run pull-data

'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, '..', 'data');
const OUT_FILE = path.join(OUT_DIR, 'airspace-db.js');

const CLASSES = ['B', 'C', 'D'];
const REQUEST_TIMEOUT = 20000; // 20s per request
const BATCH_SIZE = 200;

// FAA ArcGIS Feature Service
const FAA_BASE = 'https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/Class_Airspace/FeatureServer/0/query';

// Fallback: GitHub pre-processed GeoJSON (older data but instant downloads)
const GITHUB_URLS = {
  B: 'https://raw.githubusercontent.com/drnic/faa-airspace-data/master/class_b.geo.json',
  C: 'https://raw.githubusercontent.com/drnic/faa-airspace-data/master/class_c.geo.json',
  D: 'https://raw.githubusercontent.com/drnic/faa-airspace-data/master/class_d.geo.json',
};

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
    const ceilRef = p.UPPER_CODE || null;  // "MSL"
    const floorRef = p.LOWER_CODE || null; // "SFC" or "MSL"
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

function parseGitHubFeatures(features, cls) {
  const entries = [];
  for (const f of features) {
    // GitHub source uses AIRSPACE or NAME property
    const name = (f.properties.AIRSPACE || f.properties.NAME || '').trim();
    const geom = f.geometry;
    if (!geom || !geom.coordinates) continue;

    // GitHub fallback doesn't include altitude data
    if (geom.type === 'Polygon') {
      entries.push({ name, cls, ceil: null, floor: null, ceilRef: null, floorRef: null, coords: roundCoords(geom.coordinates[0]) });
    } else if (geom.type === 'MultiPolygon') {
      for (const poly of geom.coordinates) {
        entries.push({ name, cls, ceil: null, floor: null, ceilRef: null, floorRef: null, coords: roundCoords(poly[0]) });
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
  const allEntries = [];
  const counts = {};
  let source = 'FAA ArcGIS';

  // Try FAA ArcGIS first
  console.log('Trying FAA ArcGIS service ...');
  try {
    for (const cls of CLASSES) {
      const features = await fetchFAAClass(cls);
      counts[cls] = features.length;
      allEntries.push(...parseFAAFeatures(features, cls));
    }
  } catch (err) {
    console.warn(`\nFAA ArcGIS failed: ${err.message}`);
    console.log('Falling back to GitHub mirror (older data) ...\n');

    // Reset and try GitHub
    allEntries.length = 0;
    source = 'GitHub (drnic/faa-airspace-data)';

    for (const cls of CLASSES) {
      const features = await fetchGitHubClass(cls);
      counts[cls] = features.length;
      allEntries.push(...parseGitHubFeatures(features, cls));
    }
  }

  if (allEntries.length === 0) {
    console.error('No airspace data retrieved from any source.');
    process.exit(1);
  }

  // Sort by class then name for deterministic output
  allEntries.sort((a, b) => a.cls.localeCompare(b.cls) || a.name.localeCompare(b.name));

  // Write output
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  const jsLines = allEntries.map((e) => {
    const name = e.name.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const coordStr = JSON.stringify(e.coords);
    const ceil = e.ceil != null ? e.ceil : 'null';
    const floor = e.floor != null ? e.floor : 'null';
    const ceilRef = e.ceilRef ? `"${e.ceilRef}"` : 'null';
    const floorRef = e.floorRef ? `"${e.floorRef}"` : 'null';
    return `  {name:"${name}",cls:"${e.cls}",ceil:${ceil},floor:${floor},ceilRef:${ceilRef},floorRef:${floorRef},coords:${coordStr}}`;
  });

  const content = `// Auto-generated — do not edit. Run: npm run download-airspace\nvar AIRSPACE_DB = [\n${jsLines.join(',\n')}\n];\n`;
  fs.writeFileSync(OUT_FILE, content, 'utf8');

  console.log(`\nSource: ${source}`);
  console.log(`Class B: ${counts.B || 0}`);
  console.log(`Class C: ${counts.C || 0}`);
  console.log(`Class D: ${counts.D || 0}`);
  console.log(`Total entries: ${allEntries.length}`);
  console.log(`Wrote ${OUT_FILE}`);
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
