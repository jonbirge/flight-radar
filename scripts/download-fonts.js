// scripts/download-fonts.js
// Downloads Roboto Flex variable woff2 font from Google Fonts to shared/fonts/.
// Runs automatically via postinstall after npm install.

const https = require('https');
const fs = require('fs');
const path = require('path');

const FONTS_DIR = path.join(__dirname, '..', 'shared', 'fonts');
const FONT_FILE = 'roboto-flex.woff2';
const FONT_PATH = path.join(FONTS_DIR, FONT_FILE);
const CSS_URL = 'https://fonts.googleapis.com/css2?family=Roboto+Flex:opsz,wght@8..144,100..1000&display=swap';
// Modern Chrome UA to get woff2 format with unicode-range subsets
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';

// Check if font already exists
if (fs.existsSync(FONT_PATH)) {
  console.log('Roboto Flex font already downloaded — skipping.');
  process.exit(0);
}

if (!fs.existsSync(FONTS_DIR)) {
  fs.mkdirSync(FONTS_DIR, { recursive: true });
}

console.log('Downloading Roboto Flex font from Google Fonts...');

function fetch(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': USER_AGENT } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetch(res.headers.location).then(resolve, reject);
      }
      const chunks = [];
      res.on('data', d => chunks.push(d));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

(async () => {
  try {
    // Fetch CSS to discover actual font file URL
    const css = (await fetch(CSS_URL)).toString();

    // Find the latin subset URL (variable fonts have a weight range like "100 1000")
    const regex = /\/\* latin \*\/\s*@font-face\s*\{[^}]*src:\s*url\((https:\/\/[^)]+\.woff2)\)[^}]*unicode-range:\s*U\+0000-00FF/s;
    const match = css.match(regex);
    if (!match) {
      console.error('Could not find latin woff2 URL for Roboto Flex');
      process.exit(0);
    }

    const url = match[1];
    const data = await fetch(url);
    fs.writeFileSync(FONT_PATH, data);
    console.log(`  ${FONT_FILE} — ${(data.length / 1024).toFixed(0)} KB`);

    // Clean up old Roboto static font files
    for (const weight of ['400', '500', '600']) {
      const old = path.join(FONTS_DIR, `roboto-${weight}.woff2`);
      if (fs.existsSync(old)) fs.unlinkSync(old);
    }

    console.log('Done.');
  } catch (err) {
    console.error('Font download failed:', err.message);
    console.error('The app will fall back to system sans-serif fonts.');
    process.exit(0); // Don't fail the install
  }
})();
