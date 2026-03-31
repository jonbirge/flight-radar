// Patch the Electron.app Info.plist during development so macOS shows
// "Flight Radar" in the menu bar instead of "Electron".
const fs = require('fs');
const path = require('path');

const plist = path.join(__dirname, '../node_modules/electron/dist/Electron.app/Contents/Info.plist');

try {
  let xml = fs.readFileSync(plist, 'utf-8');
  // Replace CFBundleDisplayName and CFBundleName values
  xml = xml.replace(
    /<key>CFBundleDisplayName<\/key>\s*<string>[^<]*<\/string>/,
    '<key>CFBundleDisplayName</key>\n\t<string>Flight Radar</string>'
  );
  xml = xml.replace(
    /<key>CFBundleName<\/key>\s*<string>[^<]*<\/string>/,
    '<key>CFBundleName</key>\n\t<string>Flight Radar</string>'
  );
  fs.writeFileSync(plist, xml, 'utf-8');
  console.log('[patch-electron-plist] Patched Electron.app Info.plist → "Flight Radar"');
} catch (err) {
  // Not fatal — only affects dev mode menu bar title on macOS
  console.warn('[patch-electron-plist] Skipped:', err.message);
}
