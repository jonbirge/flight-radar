import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { viteStaticCopy } from 'vite-plugin-static-copy'

const __dirname = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/main',
      rollupOptions: {
        input: resolve(__dirname, 'main.js'),
        output: {
          entryFileNames: 'index.js'
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/preload',
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'preload.js'),
          settings: resolve(__dirname, 'settings-preload.js'),
          help: resolve(__dirname, 'src/help-preload.js')
        }
      }
    }
  },
  renderer: {
    root: '.',
    server: {
      proxy: {
        // Proxy AWC API calls to avoid CORS in dev mode
        '/awc-api': {
          target: 'https://aviationweather.gov',
          changeOrigin: true,
          secure: true,
          rewrite: (path) => path.replace(/^\/awc-api/, '/api/data')
        }
      }
    },
    build: {
      outDir: 'out/renderer',
      rollupOptions: {
        input: {
          main: resolve(__dirname, 'src/index.html'),
          settings: resolve(__dirname, 'src/settings.html')
        }
      }
    },
    plugins: [
      // Copy static assets that the HTML references via relative paths.
      // In dev mode Vite serves them from the project root; in production
      // they need to live alongside the built HTML.
      viteStaticCopy({
        targets: [
          {
            src: 'vendor/cesium/Build/Cesium/Cesium.js',
            dest: 'vendor/cesium/Build/Cesium'
          },
          {
            src: 'vendor/cesium/Build/Cesium/Widgets',
            dest: 'vendor/cesium/Build/Cesium'
          },
          {
            src: 'vendor/cesium/Build/Cesium/Workers',
            dest: 'vendor/cesium/Build/Cesium'
          },
          {
            src: 'vendor/cesium/Build/Cesium/Assets',
            dest: 'vendor/cesium/Build/Cesium'
          },
          {
            src: 'vendor/cesium/Build/Cesium/ThirdParty',
            dest: 'vendor/cesium/Build/Cesium'
          },
          {
            src: 'data',
            dest: '.'
          },
          {
            src: 'shared/fonts',
            dest: 'shared'
          }
        ]
      })
    ]
  }
})
