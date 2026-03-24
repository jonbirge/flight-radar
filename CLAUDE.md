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
```

**Testing/running:** When asked to test or run the app, always run `npm install` first (to ensure dependencies and postinstall assets are up to date), then `npm run dev` to launch the Electron dev server.

Build system: **electron-vite** (Vite-based Electron tooling). Config in `electron.vite.config.mjs`. Packaging via **electron-builder** (config in `package.json` `"build"` field). The build requires `vendor/cesium/` and `shared/fonts/` which are created by postinstall — run `npm install` before first build.

There are no tests or linting configured.

## Architecture

Electron desktop app and web app sharing a common core via `shared/` modules.

### Shared modules (`shared/`)

All renderer logic common to both platforms lives here as ES modules that expose their API on `window` for cross-module access:

- **`shared/config.js`**: `CONFIG` object, color utilities, altitude color functions, and zoom-based scaling.
- **`shared/data.js`**: Airport database, OpenSky state vector parsing (`IDX`, `parseState`), and data block formatting.
- **`shared/icons.js`**: Canvas-based aircraft icon generation.
- **`shared/settings.js`**: Settings panel UI — generates the complete form HTML (including footer with Defaults/Done buttons), injects its own CSS, populates form state, and wires all events. Platform JS passes `onClose` and `onDefaults` callbacks. Does not depend on Cesium. Used by both Electron settings window and web inline modal.
- **`shared/radar-core.js`**: State declarations, Cesium viewer initialization, theme engine (tile providers, map styling), and theme application (`resolveTheme`, `applyTheme`). Loaded first — all other `radar-*.js` files depend on this.
- **`shared/radar-weather.js`**: Weather overlays — NEXRAD radar (filtered tiles), AWC turbulence forecast (GTG heatmap with Mercator reprojection), PIREPs, SIGMETs, and G-AIRMETs.
- **`shared/radar-markers.js`**: Airport markers (large/medium/small), airspace boundaries (Class B/C/D with optional 3D extrusion), waypoints (fixes), and navaids (VOR/NDB/DME).
- **`shared/radar-aircraft.js`**: Aircraft entity management — rendering pipeline, trail polylines, position extrapolation, poll interval management, view bounds computation, and the polling loop (`pollStates`, `startPolling`).
- **`shared/radar-ui.js`**: HUD clock, camera change handler (LOD transitions, zoom-based resizing, interval adjustments), all UI control event listeners, 2D/3D morphing, and camera rotation.
- **`shared/radar-flightplan.js`**: Aircraft selection (click handler, info panel), flight plan search (FlightAware integration), and route display (decoded waypoints, dashed polylines).
- **`shared/radar-timeline.js`**: Flight plan timeline scrubber — position interpolation along route, weather filtering by time, airport weather forecasts.
- **`shared/radar.js`**: Shared init helpers — `loadAndApplySettings`, `applySavedView`, `loadDataJSON`. Loaded last as the entry point.
- **`shared/styles.css`**: All common CSS — FAA phosphor-green aesthetic, CRT scanline overlay, HUD, controls, aircraft info panel, and light mode overrides.

### Electron layer

- **Main process** (`main.js`): ESM entry point. OpenSky Network API calls (OAuth2 client credentials), rate limiting, settings persistence (`settings.json` in userData dir), and window/menu management. Built to `out/main/index.js`.
- **Preload bridge** (`preload.js`): ESM context-isolated IPC bridge exposing `window.flightAPI`. Built to `out/preload/index.js`.
- **Renderer entry** (`src/entry.js`): Imports all shared modules in dependency order, CSS, then `renderer.js`. This is the `<script type="module">` entry point in `src/index.html`.
- **Renderer** (`src/renderer.js`): Thin Electron-specific code — wires up settings button to IPC, listens for `onSettingsChanged`, and calls shared `init()` helpers.
- **Settings window** (`src/settings.html`, `src/settings.css`, `src/settings-entry.js`, `src/settings.js`, `settings-preload.js`): Separate Electron window. `src/settings-entry.js` imports shared defaults + settings + Electron settings code.
- **HTML** (`src/index.html`): Single `<script type="module" src="./entry.js">` plus Cesium script tag. Does not load `shared/settings.js` (settings are in a separate window).

### Web layer (`web/`)

- **`web/app.js`**: Web-specific entry point — `window.flightAPI` shim (localStorage settings, OpenSky API via `fetch()`), settings panel wiring via `shared/settings.js`, and init.
- **`web/styles.css`**: Settings modal shell CSS (overlay, panel, header, close button) and `--settings-*` variable mapping from M3 tokens. Form content is fully generated by `shared/settings.js`.
- **`web/index.html`**: Loads shared modules including `shared/settings.js`, then `app.js`. Includes inline settings modal HTML.
- **`web/cred.php`**: Server-side OAuth2 token proxy.

### Data files (`data/`)

Static JSON loaded at startup by `shared/radar.js`: `airports.json`, `airspace.json`, `waypoints.json`.

### Key patterns

- **Vite build**: Shared modules are ES modules bundled by Vite via `electron-vite`. CesiumJS is an npm devDependency; a postinstall script copies `Build/Cesium/` to `vendor/cesium/`. A second postinstall script (`scripts/download-fonts.js`) downloads Roboto Flex to `shared/fonts/` for Electron use. The `vite-plugin-static-copy` copies vendor, data, and font files to the build output.
- **Font loading differs by platform**: Electron loads Roboto Flex from `shared/fonts/roboto-flex.woff2` (downloaded at install time, gitignored). `src/index.html` and `src/settings.css` each declare a local `@font-face` for this. The web version (`web/index.html`) loads Roboto Flex from Google Fonts CDN instead. Do NOT put a `@font-face` in `shared/styles.css` — it would cause a 404 on web.
- **Shared modules via window globals**: Each shared module is an ES module that exposes its top-level variables and functions on `window` (e.g., `window.CONFIG = CONFIG`). Import order is defined in `src/entry.js`: `defaults.js` → `config.js` → `data.js` → `icons.js` → `radar-core.js` → `radar-weather.js` → `radar-markers.js` → `radar-aircraft.js` → `radar-ui.js` → `radar-flightplan.js` → `radar-timeline.js` → `radar.js` → platform entry point. Cross-module access works via `window` properties resolved through the global scope chain.
- **Platform abstraction via `window.flightAPI`**: Both platforms expose the same API surface. Electron uses preload IPC; web uses a shim with `fetch()` and `localStorage`.
- **Cesium without Ion**: Uses CartoDB dark_matter/light tiles, no Cesium Ion token needed.
- **Dev mode CORS**: `npm run dev` serves the renderer from `localhost:5173`, so direct API calls to `aviationweather.gov` are CORS-blocked. Weather overlays only work in production mode (`npm start`) or via the web PHP proxies. This is expected behavior.
- **Theme system**: Single hex color (dark mode) → derives all CSS variables and Cesium entity colors. Light mode uses a separate fixed palette.
- **Weather overlays**: NEXRAD radar via Iowa State Mesonet WMS; turbulence data (PIREPs, SIGMETs, G-AIRMETs) and GTG forecast heatmap from FAA AWC API (`aviationweather.gov/api/data/`). GTG images are Mercator-projected and reprojected to geographic via canvas pixel manipulation.

## Platform parity

The Electron and web versions must maintain feature and UI parity. Every feature implemented for one platform must also work on the other. The shared `shared/` modules are the mechanism for achieving this — new features belong there, not in platform-specific files.

**Accepted exceptions** (intentional, do not "fix" these):

- **Font loading**: Electron loads Roboto Flex from a local file (`shared/fonts/roboto-flex.woff2`); web loads it from Google Fonts CDN. Do not put a `@font-face` in `shared/styles.css`.
- **Settings container**: Electron opens settings in a separate native window (`src/settings.html`); web shows settings as an inline modal overlay. Both use the same `shared/settings.js` for the form content.
- **API proxies**: Browsers enforce CORS, so the web version routes all external API calls through PHP proxies (`cred.php`, `flightaware-proxy.php`, `awc-proxy.php`). Electron makes direct HTTPS calls from the main process. The `window.flightAPI` abstraction hides this difference from shared code.
- **Native UI**: Native context menu (`Menu`), native application menu bar, and the Help window are Electron-only. The web version uses a custom HTML context menu overlay; there is no help window or menu bar on web.
- **OpenSky credentials in settings**: The web settings form hides the OpenSky credentials section because credentials are handled server-side via `creds.json`. Electron shows the credentials fields so the user can enter their own.
- **Cache busting**: Asset URLs in `web/index.html` include `?v=VERSION` query strings. Electron does not need them (packaged binary, not browser-cached).

## Making changes

- For shared functionality, edit the appropriate `shared/` module — changes apply to both platforms. For platform-specific behavior, edit `src/renderer.js` (Electron) or `web/app.js` (web).
- `src/index.html` and `web/index.html` share the same controls panel HTML and must be kept in sync.
- **Help documentation is mandatory**: When adding or changing any user-facing feature, you **must** update `src/help.html` to document it. This includes new toggles, settings, UI controls, keyboard shortcuts, behavior changes, and any functionality the user can see or interact with. Do not consider a feature complete until the help documentation is updated.
- When adding a new persisted setting, update all three locations:
  1. `DEFAULT_SETTINGS` in `shared/defaults.js`
  2. `CONFIG` defaults in `shared/config.js`
  3. `loadAndApplySettings()` in `shared/radar.js` — load the value, sync the UI element, and save on change in the event handler.
- **Settings panel parity**: The settings panel must look and behave identically on Electron and web. All settings UI (HTML template, CSS, event wiring, footer buttons) lives in `shared/settings.js`. Platform layers (`src/settings.js`, `web/app.js`) are thin wrappers that only provide `onClose`, `onDefaults`, and `onChanged` callbacks. Do not add settings UI markup or styling in platform-specific files.
- Optional UI elements (not present in all HTML files) must use null checks (e.g., `if (el) el.checked = ...`).
- **Settings slider changes**: When a slider is dragged in the settings panel, only update the specific parameter it controls — do not trigger a full `loadAndApplySettings` / `applyTheme` cycle, as this causes visual disruption and flashing. Use lightweight preview callbacks (`onFontSizePreview`, `onRotationSpeedPreview`, etc.) during drag, and only broadcast the full settings on slider release (`change` event). In Electron this uses dedicated IPC channels that bypass the heavy reload path.
- **Versioning**: Increment the version in `package.json` every time a change is made **on the `main` branch only**. Do not bump the version on feature branches — this avoids merge conflicts. Uses semantic versioning (MAJOR.MINOR.PATCH): bump the first digit for major features or breaking changes, the second digit for minor features, and the third digit for bug fixes.
- **Cache busting**: When updating the version in `package.json`, also update the `?v=` query strings on all asset URLs in `web/index.html` to match the new version. (Only applies on `main`, since version bumps only happen there.)
- **Selected aircraft is ALWAYS visible**: The selected aircraft must always be shown regardless of any display settings (including the Aircraft toggle being off). Its full track history must always be rendered regardless of trail mode settings. When aircraft display is off, a periodic single-aircraft poll must keep the selected aircraft live with up-to-date position and track data. Never let display toggles, trail mode, or any other setting prevent the selected aircraft from being fully visible with its complete history trail.
