#!/usr/bin/env node
// Promote the primary airport of each Class C/D airspace to medium.
// Only the small airport nearest to each airspace centroid (within a tolerance)
// is promoted — satellite strips inside the boundary are left as small.
// Run after download-airports.js and download-airspace.js via `npm run pull-data`.

'use strict';

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const AIRPORTS_FILE = path.join(DATA_DIR, 'airports.json');
const AIRSPACE_FILE = path.join(DATA_DIR, 'airspace.json');

const MAX_DIST_NM = 2; // only promote if within 2 NM of centroid

const airports = JSON.parse(fs.readFileSync(AIRPORTS_FILE, 'utf8'));
const airspace = JSON.parse(fs.readFileSync(AIRSPACE_FILE, 'utf8'));

// Group Class C/D airspace entries by name+class, keeping the surface-level
// (lowest floor) polygon for each — that's the one centered on the airport.
const cdGroups = {};
for (const entry of airspace) {
  if (entry.cls !== 'C' && entry.cls !== 'D') continue;
  if (!entry.coords || entry.coords.length < 3) continue;
  const key = entry.name + '|' + entry.cls;
  if (!cdGroups[key] || entry.floor < cdGroups[key].floor) {
    cdGroups[key] = entry;
  }
}

function centroid(coords) {
  let lat = 0, lon = 0;
  for (const [lo, la] of coords) { lat += la; lon += lo; }
  return [lat / coords.length, lon / coords.length];
}

function distNm(lat1, lon1, lat2, lon2) {
  const R = 3440.065; // Earth radius in NM
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const smallAirports = airports.filter(a => a.type === 'S');

let promoted = 0;
for (const entry of Object.values(cdGroups)) {
  const [cLat, cLon] = centroid(entry.coords);

  // Find the nearest small airport to this airspace centroid
  let bestDist = Infinity, bestAp = null;
  for (const ap of smallAirports) {
    const d = distNm(cLat, cLon, ap.lat, ap.lon);
    if (d < bestDist) { bestDist = d; bestAp = ap; }
  }

  if (bestAp && bestDist <= MAX_DIST_NM) {
    bestAp.type = 'M';
    promoted++;
  }
}

fs.writeFileSync(AIRPORTS_FILE, JSON.stringify(airports), 'utf8');
console.log(`Promoted ${promoted} primary Class C/D airports to medium`);
