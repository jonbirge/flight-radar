// scripts/download-fonts.js
// Downloads Roboto Flex and JetBrains Mono woff2 fonts from Google Fonts to shared/fonts/.
// Runs automatically via postinstall after npm install.

const https = require('https');
const fs = require('fs');
const path = require('path');

const FONTS_DIR = path.join(__dirname, '..', 'shared', 'fonts');
// Modern Chrome UA to get woff2 format with unicode-range subsets
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';

const FONTS = [
  {
    name: 'Roboto Flex',
    file: 'roboto-flex.woff2',
    cssUrl: 'https://fonts.googleapis.com/css2?family=Roboto+Flex:opsz,wght@8..144,100..1000&display=swap',
    regex: /\/\* latin \*\/\s*@font-face\s*\{[^}]*src:\s*url\((https:\/\/[^)]+\.woff2)\)[^}]*unicode-range:\s*U\+0000-00FF/s,
  },
  {
    name: 'JetBrains Mono',
    file: 'jetbrains-mono.woff2',
    cssUrl: 'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@100..800&display=swap',
    regex: /\/\* latin \*\/\s*@font-face\s*\{[^}]*src:\s*url\((https:\/\/[^)]+\.woff2)\)[^}]*unicode-range:\s*U\+0000-00FF/s,
  },
];

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
  if (!fs.existsSync(FONTS_DIR)) {
    fs.mkdirSync(FONTS_DIR, { recursive: true });
  }

  for (const font of FONTS) {
    const fontPath = path.join(FONTS_DIR, font.file);

    if (fs.existsSync(fontPath)) {
      console.log(`${font.name} font already downloaded — skipping.`);
      continue;
    }

    console.log(`Downloading ${font.name} font from Google Fonts...`);

    try {
      const css = (await fetch(font.cssUrl)).toString();
      const match = css.match(font.regex);
      if (!match) {
        console.error(`Could not find latin woff2 URL for ${font.name}`);
        continue;
      }

      const data = await fetch(match[1]);
      fs.writeFileSync(fontPath, data);
      console.log(`  ${font.file} — ${(data.length / 1024).toFixed(0)} KB`);
    } catch (err) {
      console.error(`${font.name} download failed:`, err.message);
      console.error('The app will fall back to system fonts.');
    }
  }

  // Clean up old Roboto static font files
  for (const weight of ['400', '500', '600']) {
    const old = path.join(FONTS_DIR, `roboto-${weight}.woff2`);
    if (fs.existsSync(old)) fs.unlinkSync(old);
  }

  console.log('Done.');
})();
