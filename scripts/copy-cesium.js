// scripts/copy-cesium.js
// Copies the CesiumJS minified runtime from node_modules to vendor/cesium/.
// Runs automatically via postinstall after npm install.

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'node_modules', 'cesium', 'Build', 'Cesium');
const DEST = path.join(__dirname, '..', 'vendor', 'cesium', 'Build', 'Cesium');

if (!fs.existsSync(SRC)) {
  console.log('cesium not found in node_modules — skipping vendor copy.');
  process.exit(0);
}

console.log('Copying CesiumJS runtime to vendor/cesium/...');
fs.cpSync(SRC, DEST, { recursive: true });

const sizeMB = (fs.statSync(path.join(DEST, 'Cesium.js')).size / 1e6).toFixed(1);
console.log(`Done. vendor/cesium/Build/Cesium/Cesium.js = ${sizeMB} MB`);
