// scripts/copy-cesium.js
// Copies the CesiumJS minified runtime from node_modules to vendor/cesium/.
// Runs automatically via postinstall after npm install.

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'node_modules', 'cesium', 'Build', 'Cesium');
const DEST = path.join(__dirname, '..', 'app', 'public', 'vendor', 'cesium', 'Build', 'Cesium');

if (!fs.existsSync(SRC)) {
  console.log('cesium not found in node_modules — skipping vendor copy.');
  process.exit(0);
}

console.log('Copying CesiumJS runtime to app/public/vendor/cesium/...');
fs.cpSync(SRC, DEST, { recursive: true });

const sizeMB = (fs.statSync(path.join(DEST, 'Cesium.js')).size / 1e6).toFixed(1);

// Record CesiumJS version in package.json so the About dialog can display it
// (devDependencies are stripped in the packaged app)
const cesiumPkg = path.join(__dirname, '..', 'node_modules', 'cesium', 'package.json');
const projPkg = path.join(__dirname, '..', 'package.json');
if (fs.existsSync(cesiumPkg)) {
  const cesiumVersion = JSON.parse(fs.readFileSync(cesiumPkg, 'utf-8')).version;
  const proj = JSON.parse(fs.readFileSync(projPkg, 'utf-8'));
  if (proj.cesiumVersion !== cesiumVersion) {
    proj.cesiumVersion = cesiumVersion;
    fs.writeFileSync(projPkg, JSON.stringify(proj, null, 2) + '\n', 'utf-8');
    console.log(`Recorded cesiumVersion: ${cesiumVersion} in package.json`);
  }
}

console.log(`Done. app/public/vendor/cesium/Build/Cesium/Cesium.js = ${sizeMB} MB`);
