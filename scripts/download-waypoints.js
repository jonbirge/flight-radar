#!/usr/bin/env node
// Download FAA NASR FIX and NAV CSV data and generate waypoints.json.
// Run: npm run pull-data

'use strict';

const crypto = require('crypto');
const https = require('https');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT_DIR = path.join(__dirname, '..', 'data');
const OUT_FILE = path.join(OUT_DIR, 'waypoints.json');

const REQUEST_TIMEOUT = 30000;

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

// ---- NASR 28-day cycle date computation ----

// Known anchor: January 22, 2026 is an NASR effective date.
// Cycles repeat every 28 days.
const NASR_ANCHOR = new Date(Date.UTC(2026, 0, 22));
const CYCLE_DAYS = 28;

function getNASRCycleDate() {
  const now = new Date();
  const diffMs = now.getTime() - NASR_ANCHOR.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  const cycles = Math.floor(diffDays / CYCLE_DAYS);
  return new Date(NASR_ANCHOR.getTime() + cycles * CYCLE_DAYS * 24 * 60 * 60 * 1000);
}

function getPreviousCycleDate(date) {
  return new Date(date.getTime() - CYCLE_DAYS * 24 * 60 * 60 * 1000);
}

function formatNASRDate(date) {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${date.getUTCDate()}_${months[date.getUTCMonth()]}_${date.getUTCFullYear()}`;
}

function makeURL(dateStr, type) {
  return `https://nfdc.faa.gov/webContent/28DaySub/extra/${dateStr}_${type}_CSV.zip`;
}

// ---- HTTP fetch (returns Buffer) ----

function fetchBuffer(url, timeout = REQUEST_TIMEOUT) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchBuffer(res.headers.location, timeout).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(timeout, () => {
      req.destroy();
      reject(new Error(`Request timed out after ${timeout / 1000}s`));
    });
  });
}

// ---- Minimal ZIP extraction (no external dependencies) ----

function extractCSVFromZip(zipBuffer) {
  // Search for Local File Headers (signature 0x04034b50)
  // and extract the first CSV file found
  let offset = 0;
  while (offset < zipBuffer.length - 30) {
    if (zipBuffer.readUInt32LE(offset) !== 0x04034b50) {
      offset++;
      continue;
    }

    const compressionMethod = zipBuffer.readUInt16LE(offset + 8);
    const compressedSize = zipBuffer.readUInt32LE(offset + 18);
    const uncompressedSize = zipBuffer.readUInt32LE(offset + 22);
    const fileNameLen = zipBuffer.readUInt16LE(offset + 26);
    const extraLen = zipBuffer.readUInt16LE(offset + 28);
    const fileName = zipBuffer.toString('utf8', offset + 30, offset + 30 + fileNameLen);
    const dataStart = offset + 30 + fileNameLen + extraLen;

    if (fileName.toLowerCase().endsWith('.csv')) {
      console.log(`  Extracting: ${fileName} (${uncompressedSize} bytes)`);
      if (compressionMethod === 0) {
        // Stored (no compression)
        return zipBuffer.toString('utf8', dataStart, dataStart + uncompressedSize);
      } else if (compressionMethod === 8) {
        // Deflated
        const compressed = zipBuffer.slice(dataStart, dataStart + compressedSize);
        return zlib.inflateRawSync(compressed).toString('utf8');
      } else {
        throw new Error(`Unsupported compression method ${compressionMethod} in ${fileName}`);
      }
    }

    // Skip to next entry
    offset = dataStart + compressedSize;
  }
  throw new Error('No CSV file found in ZIP archive');
}

// ---- CSV parser (handles quoted fields) ----

function parseCSVRow(line) {
  const fields = [];
  let i = 0;
  while (i <= line.length) {
    if (i === line.length) { fields.push(''); break; }
    if (line[i] === '"') {
      let val = '';
      i++;
      while (i < line.length) {
        if (line[i] === '"') {
          if (i + 1 < line.length && line[i + 1] === '"') {
            val += '"';
            i += 2;
          } else {
            i++;
            break;
          }
        } else {
          val += line[i];
          i++;
        }
      }
      fields.push(val);
      if (i < line.length && line[i] === ',') i++;
    } else {
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

// ---- Column finder (flexible matching) ----

function findColumn(header, ...candidates) {
  for (const name of candidates) {
    const idx = header.findIndex(h => h.trim().toUpperCase() === name.toUpperCase());
    if (idx !== -1) return idx;
  }
  return -1;
}

// ---- DMS to decimal conversion ----

function dmsToDecimal(deg, min, sec, hemisphere) {
  const d = parseFloat(deg) + parseFloat(min) / 60 + parseFloat(sec) / 3600;
  return (hemisphere === 'S' || hemisphere === 'W') ? -d : d;
}

// ---- Parse FIX CSV ----

function parseFixes(csv) {
  const lines = csv.split('\n');
  const header = parseCSVRow(lines[0]);

  // Try multiple possible column names
  const iId = findColumn(header, 'FIX_ID', 'NAS_ID', 'NAS_IDENTIFIER', 'IDENT', 'ID');
  const iNasId = findColumn(header, 'NAS_IDENTIFIER', 'NAS_ID');
  const iLatDec = findColumn(header, 'LAT_DECIMAL', 'LATITUDE_DECIMAL', 'LATITUDE');
  const iLonDec = findColumn(header, 'LONG_DECIMAL', 'LONGITUDE_DECIMAL', 'LONGITUDE');
  const iLatDeg = findColumn(header, 'LAT_DEG', 'LATITUDE_DEG');
  const iLatMin = findColumn(header, 'LAT_MIN', 'LATITUDE_MIN');
  const iLatSec = findColumn(header, 'LAT_SEC', 'LATITUDE_SEC');
  const iLatHem = findColumn(header, 'LAT_HEMIS', 'LAT_HEMISPHERE', 'LATITUDE_HEMISPHERE', 'LAT_DIR');
  const iLonDeg = findColumn(header, 'LONG_DEG', 'LONGITUDE_DEG');
  const iLonMin = findColumn(header, 'LONG_MIN', 'LONGITUDE_MIN');
  const iLonSec = findColumn(header, 'LONG_SEC', 'LONGITUDE_SEC');
  const iLonHem = findColumn(header, 'LONG_HEMIS', 'LONG_HEMISPHERE', 'LONGITUDE_HEMISPHERE', 'LONG_DIR');
  const iUse = findColumn(header, 'FIX_USE', 'USE_CODE', 'CATEGORY', 'TYPE');
  const iPub = findColumn(header, 'PUBLISH', 'PUBLICATION', 'PUB_STATUS', 'CHARTING');

  const hasDecCoords = iLatDec !== -1 && iLonDec !== -1;
  const hasDmsCoords = iLatDeg !== -1 && iLatMin !== -1 && iLatSec !== -1 && iLatHem !== -1
                    && iLonDeg !== -1 && iLonMin !== -1 && iLonSec !== -1 && iLonHem !== -1;

  if (iId === -1 && iNasId === -1) {
    console.error('  Available columns:', header.join(', '));
    throw new Error('FIX CSV: cannot find identifier column');
  }
  if (!hasDecCoords && !hasDmsCoords) {
    console.error('  Available columns:', header.join(', '));
    throw new Error('FIX CSV: cannot find coordinate columns');
  }

  const idCol = iNasId !== -1 ? iNasId : iId;
  console.log(`  Using columns: ID=${header[idCol]}, lat=${hasDecCoords ? header[iLatDec] : 'DMS'}, lon=${hasDecCoords ? header[iLonDec] : 'DMS'}`);

  const fixes = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const row = parseCSVRow(line);

    // Skip unpublished fixes
    if (iPub !== -1) {
      const pub = (row[iPub] || '').trim().toUpperCase();
      if (pub === 'N') continue;
    }

    const id = (row[idCol] || '').trim();
    if (!id) continue;

    let lat, lon;
    if (hasDecCoords) {
      lat = parseFloat(row[iLatDec]);
      lon = parseFloat(row[iLonDec]);
    } else {
      lat = dmsToDecimal(row[iLatDeg], row[iLatMin], row[iLatSec], row[iLatHem]);
      lon = dmsToDecimal(row[iLonDeg], row[iLonMin], row[iLonSec], row[iLonHem]);
    }

    if (isNaN(lat) || isNaN(lon)) continue;

    // Filter to CONUS area roughly (-130 to -60 lon, 24 to 50 lat) plus Alaska/Hawaii
    // Keep all US fixes (no geographic filter — let distanceDisplayCondition handle visibility)

    const use = iUse !== -1 ? (row[iUse] || '').trim() : '';

    fixes.push({
      id,
      lat: +lat.toFixed(4),
      lon: +lon.toFixed(4),
      ...(use && { use }),
    });
  }

  return fixes;
}

// ---- Parse NAV CSV ----

function parseNavaids(csv) {
  const lines = csv.split('\n');
  const header = parseCSVRow(lines[0]);

  const iId = findColumn(header, 'NAV_ID', 'FAC_ID', 'OFFICIAL_FAC_ID', 'IDENT', 'ID');
  const iType = findColumn(header, 'NAV_TYPE', 'FAC_TYPE', 'TYPE', 'NAVAID_TYPE');
  const iName = findColumn(header, 'NAME', 'FAC_NAME', 'FACILITY_NAME');
  const iLatDec = findColumn(header, 'LAT_DECIMAL', 'LATITUDE_DECIMAL', 'LATITUDE');
  const iLonDec = findColumn(header, 'LONG_DECIMAL', 'LONGITUDE_DECIMAL', 'LONGITUDE');
  const iLatDeg = findColumn(header, 'LAT_DEG', 'LATITUDE_DEG');
  const iLatMin = findColumn(header, 'LAT_MIN', 'LATITUDE_MIN');
  const iLatSec = findColumn(header, 'LAT_SEC', 'LATITUDE_SEC');
  const iLatHem = findColumn(header, 'LAT_HEMIS', 'LAT_HEMISPHERE', 'LATITUDE_HEMISPHERE', 'LAT_DIR');
  const iLonDeg = findColumn(header, 'LONG_DEG', 'LONGITUDE_DEG');
  const iLonMin = findColumn(header, 'LONG_MIN', 'LONGITUDE_MIN');
  const iLonSec = findColumn(header, 'LONG_SEC', 'LONGITUDE_SEC');
  const iLonHem = findColumn(header, 'LONG_HEMIS', 'LONG_HEMISPHERE', 'LONGITUDE_HEMISPHERE', 'LONG_DIR');
  const iStatus = findColumn(header, 'NAV_STATUS', 'STATUS', 'STATUS_CODE', 'OPERATING_STATUS');

  const hasDecCoords = iLatDec !== -1 && iLonDec !== -1;
  const hasDmsCoords = iLatDeg !== -1 && iLatMin !== -1 && iLatSec !== -1 && iLatHem !== -1
                    && iLonDeg !== -1 && iLonMin !== -1 && iLonSec !== -1 && iLonHem !== -1;

  if (iId === -1) {
    console.error('  Available columns:', header.join(', '));
    throw new Error('NAV CSV: cannot find facility ID column');
  }
  if (iType === -1) {
    console.error('  Available columns:', header.join(', '));
    throw new Error('NAV CSV: cannot find facility type column');
  }
  if (!hasDecCoords && !hasDmsCoords) {
    console.error('  Available columns:', header.join(', '));
    throw new Error('NAV CSV: cannot find coordinate columns');
  }

  console.log(`  Using columns: ID=${header[iId]}, type=${header[iType]}, lat=${hasDecCoords ? header[iLatDec] : 'DMS'}, lon=${hasDecCoords ? header[iLonDec] : 'DMS'}`);

  const VALID_TYPES = new Set(['VOR', 'VORTAC', 'VOR/DME', 'NDB', 'NDB/DME', 'DME', 'TACAN']);
  const navaids = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const row = parseCSVRow(line);

    const type = (row[iType] || '').trim().toUpperCase();
    if (!VALID_TYPES.has(type)) continue;

    // Skip decommissioned navaids
    if (iStatus !== -1) {
      const status = (row[iStatus] || '').trim().toUpperCase();
      if (status === 'DECOMMISSIONED' || status === 'DECOMM' || status === 'D') continue;
    }

    const id = (row[iId] || '').trim();
    if (!id) continue;

    let lat, lon;
    if (hasDecCoords) {
      lat = parseFloat(row[iLatDec]);
      lon = parseFloat(row[iLonDec]);
    } else {
      lat = dmsToDecimal(row[iLatDeg], row[iLatMin], row[iLatSec], row[iLatHem]);
      lon = dmsToDecimal(row[iLonDeg], row[iLonMin], row[iLonSec], row[iLonHem]);
    }

    if (isNaN(lat) || isNaN(lon)) continue;

    const name = iName !== -1 ? (row[iName] || '').trim() : '';

    navaids.push({
      id,
      type,
      ...(name && { name }),
      lat: +lat.toFixed(4),
      lon: +lon.toFixed(4),
    });
  }

  return navaids;
}

// ---- Download with cycle date fallback ----

async function downloadWithFallback(type) {
  const currentCycle = getNASRCycleDate();
  const previousCycle = getPreviousCycleDate(currentCycle);
  const dates = [formatNASRDate(currentCycle), formatNASRDate(previousCycle)];

  for (const dateStr of dates) {
    const url = makeURL(dateStr, type);
    console.log(`  Trying ${url} ...`);
    try {
      const buf = await fetchBuffer(url);
      console.log(`  Downloaded ${(buf.length / 1024 / 1024).toFixed(1)} MB`);
      return buf;
    } catch (err) {
      console.warn(`  Failed: ${err.message}`);
    }
  }

  throw new Error(`Could not download ${type} data from any NASR cycle date`);
}

// ---- Main ----

async function main() {
  // Verify existing data if present
  if (fs.existsSync(OUT_FILE)) {
    const valid = verifyChecksum(OUT_FILE);
    if (valid === null) {
      const hash = writeChecksum(OUT_FILE);
      console.log(`Waypoint data exists, checksum recorded: ${hash} — skipping download.`);
      return;
    } else if (valid) {
      console.log('Waypoint data exists and checksum OK — skipping download.');
      return;
    } else {
      console.warn('Waypoint data CHECKSUM MISMATCH — re-downloading...');
    }
  }

  console.log('Downloading FAA NASR FIX data ...');
  const fixZip = await downloadWithFallback('FIX');
  console.log('Extracting FIX CSV ...');
  const fixCSV = extractCSVFromZip(fixZip);
  console.log('Parsing fixes ...');
  const fixes = parseFixes(fixCSV);

  console.log(`\nDownloading FAA NASR NAV data ...`);
  const navZip = await downloadWithFallback('NAV');
  console.log('Extracting NAV CSV ...');
  const navCSV = extractCSVFromZip(navZip);
  console.log('Parsing navaids ...');
  const navaids = parseNavaids(navCSV);

  // Sort by identifier for deterministic output
  fixes.sort((a, b) => a.id.localeCompare(b.id));
  navaids.sort((a, b) => a.id.localeCompare(b.id));

  // Write output
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  const content = JSON.stringify({ fixes, navaids });
  fs.writeFileSync(OUT_FILE, content, 'utf8');
  writeChecksum(OUT_FILE);

  console.log(`\nFixes: ${fixes.length}`);
  console.log(`Navaids: ${navaids.length}`);
  console.log(`Wrote ${OUT_FILE}`);
}

main().catch((err) => {
  console.warn(`WARNING: Waypoint download failed: ${err.message} — keeping existing data.`);
});
