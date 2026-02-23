#!/usr/bin/env node
// Promote small airports inside Class B/C/D airspace polygons to medium.
// Run after download-airports.js and download-airspace.js via `npm run pull-data`.

'use strict';

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const AIRPORTS_FILE = path.join(DATA_DIR, 'airports.json');
const AIRSPACE_FILE = path.join(DATA_DIR, 'airspace.json');

const airports = JSON.parse(fs.readFileSync(AIRPORTS_FILE, 'utf8'));
const airspace = JSON.parse(fs.readFileSync(AIRSPACE_FILE, 'utf8'));

// Collect Class B/C/D polygons
const controlledPolygons = [];
for (const entry of airspace) {
  if ((entry.cls !== 'B' && entry.cls !== 'C' && entry.cls !== 'D') ||
      !entry.coords || entry.coords.length < 3) continue;
  controlledPolygons.push(entry.coords);
}

let promoted = 0;
for (const ap of airports) {
  if (ap.type !== 'S') continue;
  for (const poly of controlledPolygons) {
    // Ray-casting point-in-polygon test
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if (((yi > ap.lat) !== (yj > ap.lat)) &&
          (ap.lon < (xj - xi) * (ap.lat - yi) / (yj - yi) + xi)) {
        inside = !inside;
      }
    }
    if (inside) {
      ap.type = 'M';
      promoted++;
      break;
    }
  }
}

fs.writeFileSync(AIRPORTS_FILE, JSON.stringify(airports), 'utf8');
console.log(`Promoted ${promoted} small airports within controlled airspace to medium`);
