#!/usr/bin/env node
// Download OurAirports data and generate a filtered JS database.
// Run: npm run pull-data

'use strict';

const crypto = require('crypto');
const https = require('https');
const fs = require('fs');
const path = require('path');

const CSV_URL = 'https://davidmegginson.github.io/ourairports-data/airports.csv';
const OUT_DIR = path.join(__dirname, '..', 'data');
const OUT_FILE = path.join(OUT_DIR, 'airports.json');

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

function fetch(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetch(res.headers.location).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      res.on('error', reject);
    }).on('error', reject);
  });
}

// Minimal CSV parser — handles quoted fields with commas and escaped quotes
function parseCSVRow(line) {
  const fields = [];
  let i = 0;
  while (i <= line.length) {
    if (i === line.length) { fields.push(''); break; }
    if (line[i] === '"') {
      // Quoted field
      let val = '';
      i++; // skip opening quote
      while (i < line.length) {
        if (line[i] === '"') {
          if (i + 1 < line.length && line[i + 1] === '"') {
            val += '"';
            i += 2;
          } else {
            i++; // skip closing quote
            break;
          }
        } else {
          val += line[i];
          i++;
        }
      }
      fields.push(val);
      if (i < line.length && line[i] === ',') i++; // skip delimiter
    } else {
      // Unquoted field
      const next = line.indexOf(',', i);
      if (next === -1) {
        fields.push(line.slice(i));
        break;
      } else {
        fields.push(line.slice(i, next));
        i = next + 1;
      }
    }
  }
  return fields;
}

async function main() {
  // Verify existing data if present
  if (fs.existsSync(OUT_FILE)) {
    const valid = verifyChecksum(OUT_FILE);
    if (valid === null) {
      // No checksum file yet — record one and skip download
      const hash = writeChecksum(OUT_FILE);
      console.log(`Airport data exists, checksum recorded: ${hash} — skipping download.`);
      return;
    } else if (valid) {
      console.log('Airport data exists and checksum OK — skipping download.');
      return;
    } else {
      console.warn('Airport data CHECKSUM MISMATCH — re-downloading...');
    }
  }

  console.log('Downloading airports.csv ...');
  const csv = await fetch(CSV_URL);

  const lines = csv.split('\n');
  const header = parseCSVRow(lines[0]);
  const col = (name) => header.indexOf(name);

  const iType = col('type');
  const iName = col('name');
  const iLat = col('latitude_deg');
  const iLon = col('longitude_deg');
  const iIdent = col('ident');        // ICAO code
  const iIata = col('iata_code');

  if ([iType, iName, iLat, iLon, iIdent].some((i) => i === -1)) {
    throw new Error('CSV schema mismatch — expected columns: type, name, latitude_deg, longitude_deg, ident');
  }

  const airports = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const row = parseCSVRow(line);
    const type = row[iType];
    if (type !== 'large_airport' && type !== 'medium_airport' && type !== 'small_airport') continue;

    const lat = parseFloat(row[iLat]);
    const lon = parseFloat(row[iLon]);
    if (isNaN(lat) || isNaN(lon)) continue;

    const icao = row[iIdent] || '';
    const iata = (iIata !== -1 ? row[iIata] : '') || '';
    const name = row[iName] || '';
    const sizeCode = type === 'large_airport' ? 'L' : type === 'medium_airport' ? 'M' : 'S';

    airports.push({ icao, iata, name, lat: +lat.toFixed(4), lon: +lon.toFixed(4), type: sizeCode });
  }

  // Sort by ICAO for deterministic output
  airports.sort((a, b) => a.icao.localeCompare(b.icao));

  // Write output
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  const content = JSON.stringify(airports);
  fs.writeFileSync(OUT_FILE, content, 'utf8');
  // Note: checksum is written by promote-airports.js after it modifies this file
  console.log(`Wrote ${airports.length} airports to ${OUT_FILE}`);
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
