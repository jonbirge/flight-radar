// scripts/fetch-cesium.js
// Downloads only the CesiumJS runtime files needed by this app.
// Run once: node scripts/fetch-cesium.js

const https = require('https');
const fs = require('fs');
const path = require('path');

const CESIUM_VERSION = '1.119';
const CDN_BASE = `https://cdn.jsdelivr.net/npm/cesium@${CESIUM_VERSION}/Build/Cesium`;
const VENDOR_DIR = path.join(__dirname, '..', 'vendor');
const OUT_DIR = path.join(VENDOR_DIR, 'cesium', 'Build', 'Cesium');

const FILES = [
  { remote: 'Cesium.js',           local: 'Cesium.js' },
  { remote: 'Widgets/widgets.css', local: path.join('Widgets', 'widgets.css') },
];

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const follow = (url) => {
      https.get(url, (res) => {
        if (res.statusCode === 302 || res.statusCode === 301) {
          return follow(res.headers.location);
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        }
        const total = parseInt(res.headers['content-length'], 10) || 0;
        let downloaded = 0;
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        const file = fs.createWriteStream(dest);
        res.on('data', (chunk) => {
          downloaded += chunk.length;
          if (total > 0) {
            const pct = ((downloaded / total) * 100).toFixed(0);
            process.stdout.write(`\r  ${(downloaded / 1e6).toFixed(1)} / ${(total / 1e6).toFixed(1)} MB (${pct}%)`);
          }
        });
        res.pipe(file);
        file.on('finish', () => { file.close(); resolve(downloaded); });
        file.on('error', reject);
      }).on('error', reject);
    };
    follow(url);
  });
}

async function main() {
  const cesiumJs = path.join(OUT_DIR, 'Cesium.js');
  if (fs.existsSync(cesiumJs)) {
    console.log('Cesium already present in vendor/cesium/. Delete it to re-download.');
    return;
  }

  console.log(`Downloading CesiumJS ${CESIUM_VERSION} runtime files...`);
  let totalBytes = 0;

  for (const { remote, local } of FILES) {
    const url = `${CDN_BASE}/${remote}`;
    const dest = path.join(OUT_DIR, local);
    process.stdout.write(`  ${remote}...`);
    const bytes = await download(url, dest);
    totalBytes += bytes;
    console.log(` ${(bytes / 1e6).toFixed(1)} MB`);
  }

  console.log(`Done. Total download: ${(totalBytes / 1e6).toFixed(1)} MB`);
}

main().catch(err => { console.error(err); process.exit(1); });
