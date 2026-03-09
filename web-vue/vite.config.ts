import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import cesium from 'vite-plugin-cesium';
import { resolve } from 'path';

export default defineConfig({
  plugins: [
    vue(),
    cesium(),
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  server: {
    proxy: {
      // Forward API proxy requests to PHP backend during development
      '/cred.php': 'http://localhost:8080',
      '/awc-proxy.php': 'http://localhost:8080',
      '/flightaware-proxy.php': 'http://localhost:8080',
      '/vfrmap-proxy.php': 'http://localhost:8080',
    },
  },
  build: {
    // Output to dist/ for Capacitor's webDir
    outDir: 'dist',
    sourcemap: true,
  },
});
