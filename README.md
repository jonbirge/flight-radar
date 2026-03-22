# Flight Radar

Real-time 3D flight tracker built with Electron + CesiumJS. Styled after FAA
radar center PVDs (Plan View Displays). Runs as both an Electron desktop app
and a standalone web app sharing a common `shared/` module layer.

## Quick Start

```bash
npm install      # copies CesiumJS runtime to vendor/, downloads fonts
npm run dev      # Vite dev server + Electron with HMR
npm run build    # production build → out/
npm start        # preview production build
```

## Project Structure

```
main.js                   # Electron main process (ESM, API calls, IPC, windows)
preload.js                # Context-isolated IPC bridge → window.flightAPI
settings-preload.js       # IPC bridge for settings window
electron.vite.config.mjs  # Vite config (main, preload, renderer builds)
src/
  entry.js                # Renderer entry — imports all shared modules + renderer.js
  index.html              # Electron renderer HTML (<script type="module">)
  renderer.js             # Electron renderer entry point
  settings-entry.js       # Settings window entry — imports defaults + settings
  settings.html/.js/.css  # Separate settings window
  help.html               # In-app help documentation
shared/
  defaults.js             # Default settings values
  config.js               # CONFIG object, color/theme utilities
  data.js                 # Airport DB, OpenSky state vector parsing
  icons.js                # Canvas-based aircraft icon generation
  settings.js             # Settings panel UI — HTML template, CSS, event wiring
  radar-core.js           # Cesium viewer init, theme engine (load first)
  radar-weather.js        # NEXRAD, GTG turbulence, PIREPs, SIGMETs, G-AIRMETs
  radar-markers.js        # Airport markers, airspace, waypoints, navaids
  radar-aircraft.js       # Aircraft entities, trails, polling loop
  radar-ui.js             # HUD, camera events, UI controls, 2D/3D morphing
  radar-flightplan.js     # Aircraft selection, FlightAware flight plan search
  radar-timeline.js       # Timeline scrubber for flight plan playback
  radar.js                # Shared init helpers (loaded last)
  styles.css              # All common CSS
out/                      # Build output (gitignored)
  main/index.js           # Bundled main process
  preload/                # Bundled preload scripts
  renderer/               # Bundled renderer (HTML, JS, CSS, static assets)
web/
  index.html              # Web renderer HTML
  app.js                  # Web entry point — flightAPI shim, settings wiring
  styles.css              # Settings modal shell CSS
  cred.php                # OpenSky OAuth2 token proxy
  awc-proxy.php           # FAA AWC API proxy
  flightaware-proxy.php   # FlightAware AeroAPI proxy
  creds.json.example      # Server credentials template
data/
  airports.json           # Airport database
  airspace.json           # Class B/C/D airspace boundaries
  waypoints.json          # Navigation fixes
scripts/
  copy-cesium.js          # postinstall: copies CesiumJS build to vendor/
  download-fonts.js       # postinstall: downloads Roboto Flex to shared/fonts/
  obfuscate-snap.js       # snap build: minifies/obfuscates JS before packaging
  download-airports.js    # data refresh scripts
  download-airspace.js
  download-waypoints.js
  promote-airports.js
```

## Architecture

**Electron main process** (`main.js`) owns all external API calls — OpenSky
Network (OAuth2), FlightAware AeroAPI, FAA AWC — avoiding CORS restrictions
and managing rate limiting centrally. It exposes results to the renderer via
a context-isolated IPC bridge (`preload.js`) as `window.flightAPI`.

**CesiumJS** renders the 3D/2D map. It is an npm devDependency; the
`postinstall` script copies `node_modules/cesium/Build/Cesium/` to `vendor/`
so it can be served as static files. No Cesium Ion token is required.

**Shared modules** (`shared/`) are ES modules bundled by Vite. Each module
exposes its API on `window` for cross-module access. Import order is defined in
`src/entry.js` — `radar-core.js` must be imported first, then the other
`radar-*.js` files in order, then `radar.js` last. The web version still loads
them via `<script>` tags (the window-globals pattern is compatible with both).

**`window.flightAPI`** is the platform abstraction layer. Both Electron
(`preload.js`) and web (`web/app.js`) expose the same five methods:
`getStates`, `getTrack`, `getSettings`, `saveSettings`, `onSettingsChanged`.
All shared code calls only this interface.

**Web version** (`web/`) replaces the IPC bridge with `fetch()` calls through
PHP proxy scripts and uses `localStorage` for settings persistence. The web
version is served as static files from a PHP-capable web host.

## Data Flow

```
Camera viewport → bounding box → OpenSky /states/all?lamin=&lomin=&lamax=&lomax=
                                         ↓
                           Parse state vectors (shared/data.js)
                                         ↓
                    Update Cesium entity positions + labels + trail polylines

Aircraft click → FlightAware AeroAPI → flight plan + route waypoints
                                              ↓
                            Route polyline + timeline scrubber

Weather toggle → Iowa State WMS (NEXRAD), NOAA (GOES IR), FAA AWC API (PIREPs/SIGMETs/GTG)
```

## Making Changes

### Adding a feature

Most features belong in `shared/` so they work on both platforms. Platform-
specific behavior goes in `src/renderer.js` (Electron) or `web/app.js` (web).

The HTML control panels in `src/index.html` and `web/index.html` are kept in
sync manually — edit both when adding UI controls.

When adding a new feature, document it in `src/help.html`.

### Adding a persisted setting

Update all three locations:

1. `DEFAULT_SETTINGS` in `shared/defaults.js`
2. `CONFIG` defaults in `shared/config.js`
3. `loadAndApplySettings()` in `shared/radar.js` — load the value, sync the UI
   element, and save on change in the event handler

### Settings UI

All settings form HTML, CSS, and event wiring live in `shared/settings.js`.
Platform layers (`src/settings.js`, `web/app.js`) provide only `onClose`,
`onDefaults`, and `onChanged` callbacks. Do not add settings markup or styling
in platform-specific files.

### Versioning

Increment `version` in `package.json` on every change merged to `main`
(not on feature branches). Semantic versioning: major for breaking changes,
minor for new features, patch for bug fixes.

When bumping the version, also update the `?v=` query strings on all asset
URLs in `web/index.html` to match (cache busting for the web build).

### Data refresh

Static JSON files in `data/` are generated by scripts in `scripts/`:

```bash
npm run pull-data    # re-download airports, airspace, waypoints
```

## APIs & Credentials

### OpenSky Network

Anonymous access works out of the box with lower rate limits. For higher
limits, create a free account at https://opensky-network.org and generate
OAuth2 client credentials. Enter them in Settings (Electron) or `creds.json`
(web).

Rate limits enforced by the app:
- `/states/all`: 10-second minimum interval (default poll: 15s)
- `/tracks/all`: 10-second minimum interval

### FlightAware AeroAPI

Required for flight search and route display. Get a key at
https://www.flightaware.com/aeroapi/. Enter it in Settings (Electron) or
`creds.json` (web).

### Web proxy credentials

Copy `web/creds.json.example` to `web/creds.json` and fill in values:

```json
{
  "client_id": "opensky_client_id",
  "client_secret": "opensky_client_secret",
  "flightaware_api_key": "flightaware_aeroapi_key"
}
```

`creds.json` is gitignored. All fields are optional.

## Web Version — Local Development

Serve from the project root so `vendor/cesium/` is reachable:

```bash
npm install
npx serve .          # or: python -m http.server 8080
```

Open `http://localhost:8080/web/`. The PHP proxies won't work locally without
a PHP server; for local dev you can set OpenSky and FlightAware keys directly
in `localStorage` via the Settings panel.

See [web/README.md](web/README.md) for production deployment details.

## Packaging

```bash
npm run pack     # build + unpacked directory → dist/win-unpacked/
npm run dist     # build + installer → dist/Flight Radar Setup *.exe
```

Uses **electron-builder** with NSIS (Windows `.exe`) and deb (Linux `.deb`)
targets configured in the `"build"` field of `package.json`.

### Snap (Linux)

`snap/snapcraft.yaml` supports automated Snap Store builds via Snapcraft's
GitHub integration. The build runs `scripts/obfuscate-snap.js` to minify and
obfuscate JS before packaging.

Local snap build (requires Snapcraft + LXD):

```bash
sudo snap install snapcraft --classic
sudo snap install lxd && sudo lxd init --auto
sudo usermod -aG lxd $USER && newgrp lxd

snapcraft                                              # first build (slow — pulls core22 image)
snapcraft --use-lxd                                    # subsequent builds (faster)
sudo snap install flight-radar_*.snap --dangerous      # install locally
```

Useful snap commands:
```bash
snapcraft clean                    # wipe build state
snap logs flight-radar             # runtime logs
snap run --shell flight-radar      # shell inside snap confinement
```

## Key Patterns & Conventions

- **Vite build**: `electron-vite` bundles main, preload, and renderer. Output
  goes to `out/`. `vite-plugin-static-copy` copies Cesium, data, and fonts to
  the renderer output. The web version has no build step and still uses plain
  `<script>` tags.
- **Font loading**: Electron loads Roboto Flex from `shared/fonts/roboto-flex.woff2`
  (downloaded at install, gitignored). Web loads it from Google Fonts CDN.
  Do not put a `@font-face` in `shared/styles.css` — it causes a 404 on web.
- **Optional UI elements**: Use null checks (`if (el) el.checked = ...`) for
  elements not present in all HTML files.
- **Cesium entity colors**: Derived from a single theme hex color via
  `resolveTheme()` / `applyTheme()` in `shared/radar-core.js`.
- **GTG turbulence**: FAA AWC images are Mercator-projected and reprojected to
  geographic coordinates via canvas pixel manipulation in `radar-weather.js`.
- **Selected aircraft invariant**: The selected aircraft must always be visible
  regardless of display toggle state, and its full track history must always
  render regardless of trail mode settings.
