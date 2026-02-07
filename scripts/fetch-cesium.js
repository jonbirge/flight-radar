// scripts/fetch-cesium.js
// Downloads CesiumJS release and extracts to vendor/cesium/
// Run once: node scripts/fetch-cesium.js

const https = require('https');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const CESIUM_VERSION = '1.119';
const URL = `https://github.com/CesiumGS/cesium/releases/download/${CESIUM_VERSION}/Cesium-${CESIUM_VERSION}.zip`;
const VENDOR_DIR = path.join(__dirname, '..', 'vendor');
const ZIP_PATH = path.join(VENDOR_DIR, 'cesium.zip');
const OUT_DIR = path.join(VENDOR_DIR, 'cesium');

function download(url, dest) {
  return new Promise((resolve, reject) => {
    console.log(`Downloading Cesium ${CESIUM_VERSION}...`);
    const follow = (url) => {
      https.get(url, (res) => {
        if (res.statusCode === 302 || res.statusCode === 301) {
          return follow(res.headers.location);
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        const total = parseInt(res.headers['content-length'], 10) || 0;
        let downloaded = 0;
        const file = fs.createWriteStream(dest);
        res.on('data', (chunk) => {
          downloaded += chunk.length;
          if (total > 0) {
            const pct = ((downloaded / total) * 100).toFixed(0);
            process.stdout.write(`\r  ${(downloaded / 1e6).toFixed(1)} / ${(total / 1e6).toFixed(1)} MB (${pct}%)`);
          }
        });
        res.pipe(file);
        file.on('finish', () => { file.close(); console.log('\n  Download complete.'); resolve(); });
        file.on('error', reject);
      }).on('error', reject);
    };
    follow(url);
  });
}

async function main() {
  if (fs.existsSync(path.join(OUT_DIR, 'Build', 'Cesium', 'Cesium.js'))) {
    console.log('Cesium already present in vendor/cesium/. Delete it to re-download.');
    return;
  }

  fs.mkdirSync(VENDOR_DIR, { recursive: true });
  await download(URL, ZIP_PATH);

  console.log('Extracting...');
  fs.mkdirSync(OUT_DIR, { recursive: true });
  if (process.platform === 'win32') {
    execSync(
      `powershell -Command "Expand-Archive -Path '${ZIP_PATH}' -DestinationPath '${OUT_DIR}' -Force"`,
      { stdio: 'inherit' }
    );
  } else {
    execSync(`unzip -o "${ZIP_PATH}" -d "${OUT_DIR}"`, { stdio: 'inherit' });
  }
  fs.unlinkSync(ZIP_PATH);

  const cesiumJs = path.join(OUT_DIR, 'Build', 'Cesium', 'Cesium.js');
  if (fs.existsSync(cesiumJs)) {
    const sizeMB = (fs.statSync(cesiumJs).size / 1e6).toFixed(1);
    console.log(`Done. Cesium.js = ${sizeMB} MB`);
  } else {
    console.error('ERROR: Cesium.js not found. Check vendor/cesium/ contents.');
  }
}

main().catch(err => { console.error(err); process.exit(1); });
