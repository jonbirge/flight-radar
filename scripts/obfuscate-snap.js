const fs = require('fs');
const path = require('path');
const JavaScriptObfuscator = require('javascript-obfuscator');

const root = path.resolve(process.argv[2] || 'out');

function collectJsFiles(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Skip vendor directories (Cesium, etc.) — too large and not our code
      if (entry.name === 'vendor' || entry.name === 'node_modules') continue;
      results.push(...collectJsFiles(full));
    } else if (entry.name.endsWith('.js')) {
      results.push(full);
    }
  }
  return results;
}

async function obfuscateFile(filePath) {
  const source = fs.readFileSync(filePath, 'utf8');

  // Vite already minifies, so just obfuscate
  const obfuscated = JavaScriptObfuscator.obfuscate(source, {
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
  const files = collectJsFiles(root);
  for (const file of files) {
    await obfuscateFile(file);
  }
  console.log(`Obfuscated ${files.length} JavaScript files under ${root}`);
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
