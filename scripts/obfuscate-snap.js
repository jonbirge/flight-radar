const fs = require('fs');
const path = require('path');
const { minify } = require('terser');
const JavaScriptObfuscator = require('javascript-obfuscator');

const root = path.resolve(process.argv[2] || '.');

const files = [
  'main.js',
  'preload.js',
  'settings-preload.js',
  'src/renderer.js',
  'src/settings.js',
  'web/app.js'
];

const directories = ['shared'];

for (const directory of directories) {
  const directoryPath = path.join(root, directory);
  if (!fs.existsSync(directoryPath)) continue;
  for (const file of fs.readdirSync(directoryPath)) {
    if (file.endsWith('.js')) files.push(path.join(directory, file));
  }
}

async function obfuscateFile(file) {
  const filePath = path.join(root, file);
  if (!fs.existsSync(filePath)) return;

  const source = fs.readFileSync(filePath, 'utf8');
  const minified = await minify(source, {
    compress: true,
    mangle: true,
    format: { comments: false }
  });

  if (!minified.code) throw new Error(`Unable to minify ${file}`);

  const obfuscated = JavaScriptObfuscator.obfuscate(minified.code, {
    compact: true,
    controlFlowFlattening: false,
    deadCodeInjection: false,
    identifierNamesGenerator: 'hexadecimal',
    renameGlobals: false,
    rotateStringArray: true,
    selfDefending: false,
    stringArray: true,
    stringArrayThreshold: 1
  });

  fs.writeFileSync(filePath, obfuscated.getObfuscatedCode(), 'utf8');
}

(async () => {
  for (const file of files) {
    await obfuscateFile(file);
  }
  console.log(`Obfuscated ${files.length} JavaScript files under ${root}`);
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
