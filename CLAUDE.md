# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install              # Install dependencies + copy CesiumJS runtime to vendor/
npm run dev              # Vite dev server + Electron with HMR
npm run build            # Production build → out/
npm start                # Preview production build (electron-vite preview)
npm run pack             # Build + electron-builder --dir (unpacked)
npm run dist             # Build + electron-builder (installer)
npm test                 # Run unit tests (Vitest)
npx vitest run test/config.test.js  # Run a single test file
```

**Testing/running:** When asked to test or run the app, always run `npm install` first (to ensure dependencies and postinstall assets are up to date), then `npm run dev` to launch the Electron dev server.

Build system: **electron-vite** (Vite-based Electron tooling). Config in `electron.vite.config.mjs`. Test config in `vitest.config.js`. Packaging via **electron-builder** (config in `package.json` `"build"` field). The build requires `vendor/cesium/` and `src/fonts/` which are created by postinstall — run `npm install` before first build. Postinstall also patches the Electron.app `Info.plist` on macOS so the menu bar shows "Flight Radar" instead of "Electron" during development.

## Architecture

Electron desktop application. All renderer code lives in `src/`.

### Renderer modules (`src/`)

ES modules that expose their API on `window` for cross-module access:

- **`src/defaults.js`**: Default settings values.
- **`src/config.js`**: `CONFIG` object, color utilities, altitude color functions, and zoom-based scaling.
- **`src/data.js`**: Airport database, OpenSky state vector parsing (`IDX`, `parseState`), and data block formatting.
- **`src/icons.js`**: Canvas-based aircraft icon generation.
- **`src/cloud.js`**: PocketBase cloud sync and Google OAuth.
- **`src/settings.js`**: Settings panel UI — generates the complete form HTML (including footer with Defaults/Done buttons), injects its own CSS, populates form state, and wires all events. Does not depend on Cesium.
- **`src/radar-core.js`**: State declarations, Cesium viewer initialization, theme engine (tile providers, map styling), and theme application (`resolveTheme`, `applyTheme`). Loaded first — all other `radar-*.js` files depend on this.
- **`src/radar-weather.js`**: Weather overlays — NEXRAD radar (filtered tiles), AWC turbulence forecast (GTG heatmap with Mercator reprojection), PIREPs, SIGMETs, and G-AIRMETs.
- **`src/radar-markers.js`**: Airport markers (large/medium/small), airspace boundaries (Class B/C/D with optional 3D extrusion), waypoints (fixes), and navaids (VOR/NDB/DME).
- **`src/radar-aircraft.js`**: Aircraft entity management — rendering pipeline, trail polylines, position extrapolation, poll interval management, view bounds computation, and the polling loop (`pollStates`, `startPolling`).
- **`src/radar-ui.js`**: HUD clock, camera change handler (LOD transitions, zoom-based resizing, interval adjustments), all UI control event listeners, 2D/3D morphing, and camera rotation.
- **`src/radar-flightplan.js`**: Aircraft selection (click handler, info panel), flight plan search (FlightAware integration), and route display (decoded waypoints, dashed polylines).
- **`src/radar-timeline.js`**: Flight plan timeline scrubber — position interpolation along route, weather filtering by time, airport weather forecasts.
- **`src/radar.js`**: Init helpers — `loadAndApplySettings`, `applySavedView`, `loadDataJSON`. Loaded last as the entry point.
- **`src/styles.css`**: All CSS — FAA phosphor-green aesthetic, CRT scanline overlay, HUD, controls, aircraft info panel, and light mode overrides.

### Electron layer

- **Main process** (`main.js`): ESM entry point. OpenSky Network API calls (OAuth2 client credentials), rate limiting, settings persistence (`settings.json` in userData dir), and window/menu management. Built to `out/main/index.js`.
- **Preload bridge** (`preload.js`): ESM context-isolated IPC bridge exposing `window.flightAPI`. Built to `out/preload/index.js`.
- **Renderer entry** (`src/entry.js`): Imports all modules in dependency order, CSS, then `renderer.js`. This is the `<script type="module">` entry point in `src/index.html`.
- **Renderer** (`src/renderer.js`): Electron-specific code — wires up settings button to IPC, listens for `onSettingsChanged`, and calls init helpers.
- **Settings window** (`src/settings.html`, `src/settings.css`, `src/settings-entry.js`, `src/settings-electron.js`, `settings-preload.js`): Separate Electron window. `src/settings-entry.js` imports defaults + settings + Electron settings code.
- **HTML** (`src/index.html`): Single `<script type="module" src="./entry.js">` plus Cesium script tag. Does not load `settings.js` (settings are in a separate window).

### Data files (`data/`)

Static JSON loaded at startup by `src/radar.js`: `airports.json`, `airspace.json`, `waypoints.json`.

### Key patterns

- **Vite build**: Modules are ES modules bundled by Vite via `electron-vite`. CesiumJS is an npm devDependency; a postinstall script copies `Build/Cesium/` to `vendor/cesium/`. A second postinstall script (`scripts/check-fonts.js`) verifies/downloads fonts to `src/fonts/`. The `vite-plugin-static-copy` copies vendor, data, and font files to the build output.
- **Font loading**: Fonts are bundled locally in `src/fonts/`. `src/index.html`, `src/settings.css`, and `src/help.css` each declare `@font-face` rules pointing to `./fonts/`. Do NOT put a `@font-face` in `src/styles.css` — it is imported by `entry.js` and the relative path would not resolve correctly.
- **Modules via window globals**: Each module is an ES module that exposes its top-level variables and functions on `window` (e.g., `window.CONFIG = CONFIG`). Import order is defined in `src/entry.js`: `defaults.js` → `config.js` → `data.js` → `icons.js` → `cloud.js` → `radar-core.js` → `radar-weather.js` → `radar-markers.js` → `radar-aircraft.js` → `radar-ui.js` → `radar-flightplan.js` → `radar-timeline.js` → `radar.js` → `renderer.js`. Cross-module access works via `window` properties resolved through the global scope chain.
- **Platform abstraction via `window.flightAPI`**: Electron uses a preload IPC bridge (`preload.js`) to expose API methods to the renderer.
- **Cesium without Ion**: Uses CartoDB dark_matter/light tiles, no Cesium Ion token needed.
- **Dev mode CORS**: `npm run dev` serves the renderer from `localhost:5173`, so direct API calls to `aviationweather.gov` are CORS-blocked. The dev server proxies `/awc-api` and `/vfrmap-tiles` to avoid this. Weather overlays work in both dev and production mode.
- **Theme system**: Single hex color (dark mode) → derives all CSS variables and Cesium entity colors. Light mode uses a separate fixed palette.
- **Weather overlays**: NEXRAD radar via Iowa State Mesonet WMS; turbulence data (PIREPs, SIGMETs, G-AIRMETs) and GTG forecast heatmap from FAA AWC API (`aviationweather.gov/api/data/`). GTG images are Mercator-projected and reprojected to geographic via canvas pixel manipulation.

## Making changes

- All feature code lives in `src/`. Electron-specific behavior (IPC, native menus) goes in `src/renderer.js` or `main.js`.
- **Help documentation is mandatory**: When adding or changing any user-facing feature, you **must** update `src/help.html` to document it. This includes new toggles, settings, UI controls, keyboard shortcuts, behavior changes, and any functionality the user can see or interact with. Do not consider a feature complete until the help documentation is updated.
- When adding a new persisted setting, update all three locations:
  1. `DEFAULT_SETTINGS` in `src/defaults.js`
  2. `CONFIG` defaults in `src/config.js`
  3. `loadAndApplySettings()` in `src/radar.js` — load the value, sync the UI element, and save on change in the event handler.
- **Settings panel**: All settings UI (HTML template, CSS, event wiring, footer buttons) lives in `src/settings.js`. The Electron settings wrapper (`src/settings-electron.js`) is a thin layer that only provides `onClose`, `onDefaults`, and `onChanged` callbacks. Do not add settings UI markup or styling in `settings-electron.js`.
- Optional UI elements (not present in all HTML files) must use null checks (e.g., `if (el) el.checked = ...`).
- **Settings slider changes**: When a slider is dragged in the settings panel, only update the specific parameter it controls — do not trigger a full `loadAndApplySettings` / `applyTheme` cycle, as this causes visual disruption and flashing. Use lightweight preview callbacks (`onFontSizePreview`, `onRotationSpeedPreview`, etc.) during drag, and only broadcast the full settings on slider release (`change` event). In Electron this uses dedicated IPC channels that bypass the heavy reload path.
- **Versioning**: Increment the version in `package.json` every time a change is made **on the `main` branch only**. Do not bump the version on feature branches — this avoids merge conflicts. Uses semantic versioning (MAJOR.MINOR.PATCH): bump the first digit for major features or breaking changes, the second digit for minor features, and the third digit for bug fixes.
- **Selected aircraft is ALWAYS visible**: The selected aircraft must always be shown regardless of any display settings (including the Aircraft toggle being off). Its full track history must always be rendered regardless of trail mode settings. When aircraft display is off, a periodic single-aircraft poll must keep the selected aircraft live with up-to-date position and track data. Never let display toggles, trail mode, or any other setting prevent the selected aircraft from being fully visible with its complete history trail.
