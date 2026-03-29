// scripts/check-fonts.js
// Verifies that required font files exist in shared/fonts/ and are not corrupt.
// Fonts are checked into the repo — this just catches missing/corrupt files early.
// If any are missing or fail checksum, downloads them from Google Fonts as a fallback.

const crypto = require('crypto');
const https = require('https');
const fs = require('fs');
const path = require('path');

const FONTS_DIR = path.join(__dirname, '..', 'shared', 'fonts');
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
  if (!fs.existsSync(md5File)) return null; // no checksum on file
  const expected = fs.readFileSync(md5File, 'utf8').trim();
  const actual = md5(filePath);
  return actual === expected;
}

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

async function downloadFont(font) {
  console.log(`  Downloading ${font.name} from Google Fonts...`);
  const css = (await fetch(font.cssUrl)).toString();
  const match = css.match(font.regex);
  if (!match) throw new Error(`Could not find latin woff2 URL for ${font.name}`);
  const data = await fetch(match[1]);
  const p = path.join(FONTS_DIR, font.file);
  fs.writeFileSync(p, data);
  writeChecksum(p);
  console.log(`  ${font.file} — ${(data.length / 1024).toFixed(0)} KB (downloaded)`);
}

(async () => {
  if (!fs.existsSync(FONTS_DIR)) fs.mkdirSync(FONTS_DIR, { recursive: true });

  for (const font of FONTS) {
    const p = path.join(FONTS_DIR, font.file);

    if (fs.existsSync(p)) {
      const valid = verifyChecksum(p);
      if (valid === null) {
        // No checksum file yet — create one from the existing file
        const hash = writeChecksum(p);
        const kb = (fs.statSync(p).size / 1024).toFixed(0);
        console.log(`  ${font.file} — ${kb} KB (checksum recorded: ${hash})`);
      } else if (valid) {
        const kb = (fs.statSync(p).size / 1024).toFixed(0);
        console.log(`  ${font.file} — ${kb} KB (checksum OK)`);
      } else {
        console.warn(`  ${font.file} — CHECKSUM MISMATCH, re-downloading...`);
        try {
          await downloadFont(font);
        } catch (err) {
          console.error(`ERROR: failed to download ${font.name}: ${err.message}`);
          process.exit(1);
        }
      }
    } else {
      console.warn(`  Missing ${font.file} — attempting download...`);
      try {
        await downloadFont(font);
      } catch (err) {
        console.error(`ERROR: failed to download ${font.name}: ${err.message}`);
        process.exit(1);
      }
    }
  }

  console.log('All fonts present.');
})();
