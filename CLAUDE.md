# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install              # Install dependencies + download fonts
npm run dev              # Vite dev server at localhost:3000
npm run build            # Production build → dist/
npm run preview          # Preview production build
npm run pull-data        # Update airports, airspace, waypoints JSON
```

Build system: **Vite** with **Capacitor** for cross-platform support. Config in `vite.config.js` and `capacitor.config.ts`.

There are no tests or linting configured.

## Architecture

Capacitor-based web app (PWA) built with Vite. Plain JavaScript with ES modules — no UI framework. CesiumJS for 3D mapping. All code lives in `src/` as ES modules with `import`/`export`.

### Source modules (`src/`)

- **`src/main.js`**: Entry point — imports all modules, sets up `window.flightAPI`, initializes settings modal, help panel, and starts the app.
- **`src/state.js`**: Central mutable state object shared across all radar modules. All shared state (viewer, aircraft map, timers, entity arrays, etc.) is a property of the default-exported `state` object. Constants like `RATE_LIMIT_MS` are named exports.
- **`src/defaults.js`**: `DEFAULT_SETTINGS` object — canonical default settings.
- **`src/config.js`**: `CONFIG` object, color utilities (`hexToRgb`, `brighten`, `withAlpha`, `setDarkColors`, `setLightColors`), altitude color functions, and zoom-based scaling.
- **`src/data.js`**: Airport database (`AIRPORTS`), OpenSky state vector parsing (`IDX`, `parseState`), and data block formatting.
- **`src/icons.js`**: Canvas-based aircraft icon generation with caching.
- **`src/settings.js`**: Settings panel UI — generates the complete form HTML (including footer with Defaults/Done buttons), injects its own CSS, populates form state, and wires all events. Does not depend on Cesium.
- **`src/api.js`**: `window.flightAPI` implementation — localStorage settings, OpenSky API via `fetch()`, FlightAware API via PHP proxies, system theme detection, and context menu.

### Radar modules (`src/radar/`)

- **`src/radar/core.js`**: Cesium viewer initialization, theme engine (tile providers, map styling), and theme application (`resolveTheme`, `applyTheme`).
- **`src/radar/weather.js`**: Weather overlays — NEXRAD radar, GOES IR satellite, AWC turbulence forecast (GTG heatmap with Mercator reprojection), PIREPs, SIGMETs, and G-AIRMETs.
- **`src/radar/markers.js`**: Airport markers (large/medium/small), airspace boundaries (Class B/C/D with optional 3D extrusion), waypoints (fixes), and navaids (VOR/NDB/DME).
- **`src/radar/aircraft.js`**: Aircraft entity management — rendering pipeline, trail polylines, position extrapolation, poll interval management, view bounds computation, and the polling loop.
- **`src/radar/ui.js`**: HUD clock, camera change handler (LOD transitions, zoom-based resizing, interval adjustments), all UI control event listeners, 2D/3D morphing, and camera rotation.
- **`src/radar/flightplan.js`**: Aircraft selection (click handler, info panel), flight plan search (FlightAware integration), and route display (decoded waypoints, dashed polylines).
- **`src/radar/timeline.js`**: Flight plan timeline scrubber, position interpolation along routes, weather filtering by time.
- **`src/radar/init.js`**: Init helpers — `loadAndApplySettings`, `applySavedView`, `loadDataJSON`.

### Styles (`src/styles/`)

- **`src/styles/main.css`**: All common CSS — FAA phosphor-green aesthetic, CRT scanline overlay, HUD, controls, aircraft info panel, and light mode overrides.
- **`src/styles/settings.css`**: Context menu, settings modal shell, and help panel overlay CSS with M3 tokens.

### Static assets (`public/`)

- **`public/data/`**: Static JSON loaded at startup — `airports.json`, `airspace.json`, `waypoints.json`.
- **`public/fonts/`**: Roboto Flex woff2 (downloaded at install time, gitignored).
- **`public/icons/`**: App icons for PWA manifest.
- **`public/help/`**: Help content HTML loaded into the in-app help panel.
- **`public/manifest.json`**: PWA manifest for installable desktop/mobile app.

### Server (`server/`)

PHP proxies for production web deployment (CORS workaround):
- `cred.php` — OpenSky OAuth2 token proxy
- `flightaware-proxy.php` — FlightAware AeroAPI proxy
- `awc-proxy.php` — FAA Aviation Weather Center proxy with caching
- `vfrmap-proxy.php` — VFR map tile proxy

### Data files (`data/`)

Source data JSON files (also copied to `public/data/` for serving): `airports.json`, `airspace.json`, `waypoints.json`.

### Key patterns

- **ES modules with Vite**: All source files use `import`/`export`. Vite handles bundling, dev server with HMR, and production builds.
- **Shared state via `state.js`**: Mutable state is centralized in a single exported object (`import S from '../state.js'`). Modules access state as `S.viewer`, `S.aircraft`, etc. This replaces the old global scope sharing pattern.
- **CesiumJS via Vite**: Cesium is an npm dependency. `vite-plugin-static-copy` copies Cesium's Workers, Assets, and Widgets to the build output. `CESIUM_BASE_URL` is defined in `vite.config.js`. Cesium's CSS is imported in `main.js`.
- **Platform abstraction via `window.flightAPI`**: All external API calls go through `window.flightAPI`, set up by `src/api.js`. Uses `fetch()` with PHP proxies for CORS-restricted APIs in production. In development, Vite's dev server proxy handles CORS.
- **Cesium without Ion**: Uses CartoDB dark_matter/light tiles, no Cesium Ion token needed.
- **Theme system**: Single hex color (dark mode) → derives all CSS variables and Cesium entity colors. Light mode uses a separate fixed palette.
- **Weather overlays**: NEXRAD radar via Iowa State Mesonet WMS; turbulence data (PIREPs, SIGMETs, G-AIRMETs) and GTG forecast heatmap from FAA AWC API. GTG images are Mercator-projected and reprojected to geographic via canvas pixel manipulation.
- **PWA**: The app includes a manifest and can be installed as a standalone desktop or mobile app via the browser.
- **Capacitor**: Configured for future native mobile targets (iOS/Android). Desktop delivery is via PWA.

## Making changes

- All application code lives in `src/`. Edit the appropriate module — there are no platform-specific files to keep in sync.
- The single `index.html` at the project root is the Vite entry point. It contains all UI markup (controls, search, info panel, settings modal, help modal).
- When adding a new user-facing feature, update `public/help/help-content.html` to document it.
- When adding a new persisted setting, update three locations:
  1. `DEFAULT_SETTINGS` in `src/defaults.js`
  2. `CONFIG` defaults in `src/config.js`
  3. `loadAndApplySettings()` in `src/radar/init.js` — load the value, sync the UI element, and save on change in the event handler.
- **Settings panel**: All settings UI (HTML template, CSS, event wiring, footer buttons) lives in `src/settings.js`. The main entry point (`src/main.js`) provides `onClose`, `onDefaults`, and `onChanged` callbacks. Do not add settings UI markup or styling elsewhere.
- Optional UI elements (not present in all contexts) must use null checks (e.g., `if (el) el.checked = ...`).
- **Versioning**: Increment the version in `package.json` every time a change is made **on the `main` branch only**. Do not bump the version on feature branches — this avoids merge conflicts. Uses semantic versioning (MAJOR.MINOR.PATCH).
- **Selected aircraft is ALWAYS visible**: The selected aircraft must always be shown regardless of any display settings (including the Aircraft toggle being off). Its full track history must always be rendered regardless of trail mode settings. When aircraft display is off, a periodic single-aircraft poll must keep the selected aircraft live with up-to-date position and track data.
