# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install              # Install dependencies + copy CesiumJS runtime to vendor/
npm start                # Launch the app
npm run dev              # Launch with DevTools open
npm run pack             # Portable folder → dist/win-unpacked/FlightRadar.exe
npm run dist             # NSIS installer → dist/Flight Radar Setup 1.0.0.exe
```

There are no tests or linting configured.

## Architecture

Electron desktop app and web app sharing a common core via `shared/` modules.

### Shared modules (`shared/`)

All renderer logic common to both platforms lives here as plain JS loaded via `<script>` tags:

- **`shared/config.js`**: `CONFIG` object, color utilities (`hexToRgb`, `brighten`, `withAlpha`, `lighten`, `setDarkColors`, `setLightColors`), altitude color functions, and zoom-based scaling.
- **`shared/data.js`**: Airport database (`AIRPORTS`, `lookupAirport`), OpenSky state vector parsing (`IDX`, `parseState`), and data block formatting (`formatAltitude`, `formatSpeed`, `verticalIndicator`).
- **`shared/icons.js`**: Canvas-based aircraft icon generation (`createAircraftIcon`, `createDotIcon`).
- **`shared/settings.js`**: Settings panel UI — `createSettingsFormHTML()` (HTML template), `populateSettingsForm()` (populate from settings object), `initSettingsPanel()` (wire up events with live-update behavior). Includes inline CSS for form layout. Does not depend on Cesium. Used by both Electron settings window and web inline modal.
- **`shared/radar.js`**: Core CesiumJS engine — viewer initialization, theme engine, aircraft entity management, trail rendering, polling loop, camera handlers, common UI controls (trails, labels, poll interval, trail length, view presets, 2D/3D, rotation), aircraft selection, and shared init helpers (`loadAndApplySettings`, `applySavedView`, `startPolling`).
- **`shared/styles.css`**: All common CSS — FAA phosphor-green aesthetic, CRT scanline overlay, HUD, controls, aircraft info panel, and light mode overrides.

### Electron layer

- **Main process** (`main.js`): OpenSky Network API calls (OAuth2 client credentials), rate limiting (10s minimum between calls), settings persistence (`settings.json` in userData dir), and window/menu management.
- **Preload bridge** (`preload.js`): Context-isolated IPC bridge exposing `window.flightAPI` with five methods: `getStates`, `getTrack`, `getSettings`, `saveSettings`, `onSettingsChanged`.
- **Renderer** (`src/renderer.js`): Thin Electron-specific entry point — wires up settings button to IPC, listens for `onSettingsChanged`, and calls shared `init()` helpers.
- **Settings window** (`src/settings.html`, `src/settings.css`, `src/settings.js`, `settings-preload.js`): Separate Electron window for app settings. Uses `shared/settings.js` for the form; `src/settings.js` is a thin wrapper. `src/settings.css` provides native OS styling with `prefers-color-scheme` dark/light mode.
- **HTML** (`src/index.html`): Loads shared modules then `renderer.js`. Includes CONUS button (Electron-only).

### Web layer (`web/`)

- **`web/app.js`**: Web-specific entry point — `window.flightAPI` shim (localStorage settings, OpenSky API via `fetch()`, OAuth2 token management with server proxy fallback), settings panel wiring via `shared/settings.js` with live updating, and `init()` with server credential loading.
- **`web/styles.css`**: Settings modal shell CSS and phosphor-themed overrides for the shared settings form (base styles come from `shared/styles.css`).
- **`web/index.html`**: Loads `shared/styles.css` + `web/styles.css`, shared JS modules, then `app.js`. Includes inline settings modal HTML. Omits CONUS button.
- **`web/cred.php`**: Server-side OAuth2 token proxy.

### Data flow

Camera viewport bounds are sent to the main process (Electron) or fetched directly (web) every 15s, querying OpenSky `/states/all` with bounding-box params. State vectors (16-field arrays) are parsed in `shared/data.js`, updating a `Map<icao24, AircraftObject>` that tracks entity state, Cesium entities (billboard + label + polyline), position history, and optional granular tracks fetched one-at-a-time from `/tracks/all`.

### Key patterns

- **No build step**: Plain JS loaded directly via `<script>` tags. CesiumJS is an npm devDependency; a postinstall script copies only `Build/Cesium/` (~20 MB runtime) to `vendor/cesium/`.
- **Shared modules via globals**: `shared/*.js` files define functions/constants on the global scope. Script load order: `config.js` → `data.js` → `icons.js` → `settings.js` → `radar.js` → platform-specific entry point. The Electron settings window loads only `settings.js` → `src/settings.js` (no Cesium/radar dependency).
- **Platform abstraction via `window.flightAPI`**: Both platforms expose the same API surface. Electron provides it via preload IPC; web provides it via a shim object with `fetch()` and `localStorage`.
- **Cesium without Ion**: Uses CartoDB dark_matter/light tiles, no Cesium Ion token needed.
- **Canvas aircraft icons**: Chevrons drawn and rotated on canvas per heading, used as Cesium billboards.
- **Theme system**: Single hex color (dark mode) → derives all CSS variables and Cesium entity colors. Light mode uses a separate fixed palette.
- **Rate limiting**: Main process (Electron) or client-side (web) enforces 10s minimums. Track fetch queue processes 1 aircraft per 12s.
- **FAA data block format**: Callsign on top, flight level + vertical indicator + groundspeed on bottom. Altitude in meters converted to feet/flight levels; speed in m/s converted to knots.
- **CONUS button**: Present in Electron only (absent from web HTML). `shared/radar.js` guards with a null check so it works on both platforms.

### UI structure

`src/index.html` (Electron) and `web/index.html` (web) share the same DOM structure for HUD, controls, and aircraft info panel. `shared/styles.css` handles the phosphor-green FAA aesthetic. Settings are handled via a separate Electron window (`src/settings.html`) or an inline modal (web). The shared `radar.js` manages all UI state and Cesium interaction; platform-specific entry points handle settings and initialization.

### Making changes

For shared functionality (renderer logic, styles, UI controls, data formatting), edit the appropriate `shared/` module — changes automatically apply to both platforms. For platform-specific behavior (API calls, settings persistence, auth), edit `src/renderer.js` (Electron) or `web/app.js` (web).

Both the Electron and web versions include the CONUS button. `shared/radar.js` guards with a null check so it works on both platforms.
