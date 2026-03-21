const { defineConfig } = require('vite');

module.exports = defineConfig({
  root: 'app',
  publicDir: 'public',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
});
