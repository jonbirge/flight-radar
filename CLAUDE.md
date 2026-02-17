# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install              # Install dependencies + copy CesiumJS runtime to vendor/
npm start                # Launch the app
npm run dev              # Launch with DevTools open
npm run pack             # Portable folder → out/flight-radar-win32-x64/FlightRadar.exe
npm run dist             # Squirrel installer → out/make/squirrel.windows/x64/Flight Radar Setup.exe
```

Build system: **electron-forge** (official Electron tooling). Config in `forge.config.js`.

There are no tests or linting configured.

## Architecture

Electron desktop app and web app sharing a common core via `shared/` modules.

### Shared modules (`shared/`)

All renderer logic common to both platforms lives here as plain JS loaded via `<script>` tags:

- **`shared/config.js`**: `CONFIG` object, color utilities, altitude color functions, and zoom-based scaling.
- **`shared/data.js`**: Airport database, OpenSky state vector parsing (`IDX`, `parseState`), and data block formatting.
- **`shared/icons.js`**: Canvas-based aircraft icon generation.
- **`shared/settings.js`**: Settings panel UI — form HTML template, populate, and event wiring. Does not depend on Cesium. Used by both Electron settings window and web inline modal.
- **`shared/radar.js`**: Core CesiumJS engine — viewer init, theme engine, aircraft entities, trails, polling, camera handlers, UI controls, aircraft selection, weather overlays (NEXRAD radar, AWC turbulence/SIGMETs/PIREPs/G-AIRMETs, GTG forecast), and shared init helpers (`loadAndApplySettings`, `applySavedView`, `startPolling`).
- **`shared/styles.css`**: All common CSS — FAA phosphor-green aesthetic, CRT scanline overlay, HUD, controls, aircraft info panel, and light mode overrides.

### Electron layer

- **Main process** (`main.js`): OpenSky Network API calls (OAuth2 client credentials), rate limiting, settings persistence (`settings.json` in userData dir), and window/menu management.
- **Preload bridge** (`preload.js`): Context-isolated IPC bridge exposing `window.flightAPI` with five methods: `getStates`, `getTrack`, `getSettings`, `saveSettings`, `onSettingsChanged`.
- **Renderer** (`src/renderer.js`): Thin Electron-specific entry point — wires up settings button to IPC, listens for `onSettingsChanged`, and calls shared `init()` helpers.
- **Settings window** (`src/settings.html`, `src/settings.css`, `src/settings.js`, `settings-preload.js`): Separate Electron window using `shared/settings.js` for the form.
- **HTML** (`src/index.html`): Loads shared modules then `renderer.js`. Does not load `shared/settings.js` (settings are in a separate window).

### Web layer (`web/`)

- **`web/app.js`**: Web-specific entry point — `window.flightAPI` shim (localStorage settings, OpenSky API via `fetch()`), settings panel wiring via `shared/settings.js`, and init.
- **`web/styles.css`**: Settings modal shell CSS and phosphor-themed overrides for the shared settings form.
- **`web/index.html`**: Loads shared modules including `shared/settings.js`, then `app.js`. Includes inline settings modal HTML.
- **`web/cred.php`**: Server-side OAuth2 token proxy.

### Data files (`data/`)

Static JSON loaded at startup by `shared/radar.js`: `airports.json`, `airspace.json`, `waypoints.json`.

### Key patterns

- **No build step**: Plain JS loaded directly via `<script>` tags. CesiumJS is an npm devDependency; a postinstall script copies `Build/Cesium/` to `vendor/cesium/`.
- **Shared modules via globals**: Script load order: `config.js` → `data.js` → `icons.js` → [`settings.js` web only] → `radar.js` → platform entry point.
- **Platform abstraction via `window.flightAPI`**: Both platforms expose the same API surface. Electron uses preload IPC; web uses a shim with `fetch()` and `localStorage`.
- **Cesium without Ion**: Uses CartoDB dark_matter/light tiles, no Cesium Ion token needed.
- **Theme system**: Single hex color (dark mode) → derives all CSS variables and Cesium entity colors. Light mode uses a separate fixed palette.
- **Weather overlays**: NEXRAD radar via Iowa State Mesonet WMS; turbulence data (PIREPs, SIGMETs, G-AIRMETs) and GTG forecast heatmap from FAA AWC API (`aviationweather.gov/api/data/`). GTG images are Mercator-projected and reprojected to geographic via canvas pixel manipulation.

## Making changes

- For shared functionality, edit the appropriate `shared/` module — changes apply to both platforms. For platform-specific behavior, edit `src/renderer.js` (Electron) or `web/app.js` (web).
- `src/index.html` and `web/index.html` share the same controls panel HTML and must be kept in sync.
- When adding a new user-facing feature, always update `src/help.html` to document it.
- When adding a new persisted setting, update all three locations:
  1. `DEFAULT_SETTINGS` in `main.js`
  2. `CONFIG` defaults in `shared/config.js`
  3. `loadAndApplySettings()` in `shared/radar.js` — load the value, sync the UI element, and save on change in the event handler.
- Optional UI elements (not present in all HTML files) must use null checks (e.g., `if (el) el.checked = ...`).
- **Versioning**: Increment the version in `package.json` every time a change is made. Bump the major number for meaningful new features; bump the minor number for bug fixes.
