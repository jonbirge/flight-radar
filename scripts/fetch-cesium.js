// scripts/fetch-cesium.js
// Downloads the CesiumJS Build/Cesium/ runtime (JS, Workers, Assets)
// from jsDelivr CDN. Run once: node scripts/fetch-cesium.js

const https = require('https');
const fs = require('fs');
const path = require('path');

const CESIUM_VERSION = '1.119';
const CDN_BASE = `https://cdn.jsdelivr.net/npm/cesium@${CESIUM_VERSION}`;
const API_URL = `https://data.jsdelivr.com/v1/packages/npm/cesium@${CESIUM_VERSION}.0`;
const VENDOR_DIR = path.join(__dirname, '..', 'vendor');
const OUT_DIR = path.join(VENDOR_DIR, 'cesium');
const CONCURRENCY = 15;

// Only download the minified runtime under Build/Cesium/
// (skips source, docs, specs, unminified build, etc.)
const INCLUDE_PREFIX = '/Build/Cesium/';

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const follow = (url) => {
      https.get(url, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          return follow(res.headers.location);
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        }
        resolve(res);
      }).on('error', reject);
    };
    follow(url);
  });
}

function fetchJSON(url) {
  return new Promise(async (resolve, reject) => {
    try {
      const res = await httpsGet(url);
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('Invalid JSON from API')); }
      });
      res.on('error', reject);
    } catch (e) { reject(e); }
  });
}

function downloadFile(url, dest) {
  return new Promise(async (resolve, reject) => {
    try {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      const res = await httpsGet(url);
      let bytes = 0;
      const file = fs.createWriteStream(dest);
      res.on('data', (chunk) => { bytes += chunk.length; });
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(bytes); });
      file.on('error', reject);
    } catch (e) { reject(e); }
  });
}

// Recursively flatten the jsDelivr tree into a list of file paths
function flattenTree(entries, prefix) {
  const files = [];
  for (const entry of entries) {
    const entryPath = prefix + '/' + entry.name;
    if (entry.type === 'directory' && entry.files) {
      files.push(...flattenTree(entry.files, entryPath));
    } else if (entry.type === 'file') {
      files.push({ path: entryPath, size: entry.size || 0 });
    }
  }
  return files;
}

// Run downloads with limited concurrency
async function downloadPool(items, concurrency, onProgress) {
  let idx = 0;
  let completed = 0;
  let totalBytes = 0;

  async function worker() {
    while (idx < items.length) {
      const item = items[idx++];
      const url = CDN_BASE + item.path;
      // Strip /Build/Cesium/ prefix -> save under vendor/cesium/Build/Cesium/
      const dest = path.join(OUT_DIR, item.path);
      try {
        const bytes = await downloadFile(url, dest);
        totalBytes += bytes;
      } catch (err) {
        console.error(`\n  FAILED: ${item.path} — ${err.message}`);
      }
      completed++;
      onProgress(completed, items.length, totalBytes);
    }
  }

  const workers = [];
  for (let i = 0; i < Math.min(concurrency, items.length); i++) {
    workers.push(worker());
  }
  await Promise.all(workers);
  return totalBytes;
}

async function main() {
  const cesiumJs = path.join(OUT_DIR, 'Build', 'Cesium', 'Cesium.js');
  if (fs.existsSync(cesiumJs)) {
    console.log('Cesium already present in vendor/cesium/. Delete it to re-download.');
    return;
  }

  console.log(`Fetching CesiumJS ${CESIUM_VERSION} file listing from jsDelivr...`);
  const pkg = await fetchJSON(API_URL);

  if (!pkg.files) {
    throw new Error('Unexpected API response — no files field');
  }

  const allFiles = flattenTree(pkg.files, '');
  const runtimeFiles = allFiles.filter(f => f.path.startsWith(INCLUDE_PREFIX));

  if (runtimeFiles.length === 0) {
    throw new Error('No files found under Build/Cesium/ — check API response');
  }

  const estimatedMB = runtimeFiles.reduce((s, f) => s + f.size, 0) / 1e6;
  console.log(`Downloading ${runtimeFiles.length} files (~${estimatedMB.toFixed(0)} MB)...`);

  const totalBytes = await downloadPool(runtimeFiles, CONCURRENCY, (done, total, bytes) => {
    process.stdout.write(`\r  ${done}/${total} files (${(bytes / 1e6).toFixed(1)} MB)`);
  });

  console.log(`\nDone. ${runtimeFiles.length} files, ${(totalBytes / 1e6).toFixed(1)} MB total.`);
}

main().catch(err => { console.error(err); process.exit(1); });
