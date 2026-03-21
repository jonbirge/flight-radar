import { defineConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';

// CesiumJS requires its Workers, Assets, Widgets, and ThirdParty directories
// to be available at runtime. We copy them to the build output and set the
// CESIUM_BASE_URL so Cesium can find them.
const cesiumSource = 'node_modules/cesium/Build/Cesium';

export default defineConfig({
  define: {
    // Tell Cesium where to find its static assets at runtime
    CESIUM_BASE_URL: JSON.stringify('/cesium'),
  },
  plugins: [
    viteStaticCopy({
      targets: [
        { src: `${cesiumSource}/Workers`, dest: 'cesium' },
        { src: `${cesiumSource}/ThirdParty`, dest: 'cesium' },
        { src: `${cesiumSource}/Assets`, dest: 'cesium' },
        { src: `${cesiumSource}/Widgets`, dest: 'cesium' },
      ],
    }),
  ],
  build: {
    outDir: 'dist',
    target: 'esnext',
    // Cesium uses dynamic imports and eval in workers — don't warn
    rollupOptions: {
      output: {
        manualChunks: {
          cesium: ['cesium'],
        },
      },
    },
  },
  server: {
    port: 3000,
    proxy: {
      // Dev proxies for CORS-restricted APIs
      '/api/opensky': {
        target: 'https://opensky-network.org',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/opensky/, '/api'),
      },
      '/api/flightaware': {
        target: 'https://aeroapi.flightaware.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/flightaware/, '/aeroapi'),
      },
      '/api/awc': {
        target: 'https://aviationweather.gov',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/awc/, '/api/data'),
      },
    },
  },
});
