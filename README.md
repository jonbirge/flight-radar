# Flight Radar

Real-time 3D flight tracker powered by CesiumJS and OpenSky Network. Styled
after FAA radar center PVDs (Plan View Displays) with live weather overlays,
aviation charts, and flight plan search. Available as an Electron desktop app
and a standalone web app sharing a common `shared/` module core.

## Quick Start

```bash
npm install      # installs deps, copies CesiumJS runtime to vendor/, downloads fonts
npm start        # launch Electron app
npm run dev      # launch with DevTools open
```

## Architecture

### Platform layers

| Layer | Entry point | Description |
|-------|-------------|-------------|
| Electron main | `main.js` | OpenSky OAuth2 calls, rate limiting, settings persistence, window management |
| Electron preload | `preload.js` | Context-isolated IPC bridge — exposes `window.flightAPI` to the renderer |
| Electron renderer | `src/renderer.js` | Thin wiring: connects settings button to IPC, calls shared `init()` |
| Web | `web/app.js` | `window.flightAPI` shim using `fetch()` + `localStorage`; settings modal wiring |

### Shared modules (`shared/`)

All renderer logic common to both platforms. Loaded as plain `<script>` tags in
load order:

| Module | Responsibility |
|--------|----------------|
| `config.js` | `CONFIG` object, color utilities, altitude color functions, zoom-based scaling |
| `data.js` | Airport DB, OpenSky state-vector parsing (`IDX`, `parseState`), data block formatting |
| `icons.js` | Canvas-based aircraft icon generation |
| `settings.js` | Settings panel — generates HTML, injects CSS, wires all events; used by both platforms |
| `radar-core.js` | State declarations, Cesium viewer init, theme engine (`resolveTheme`, `applyTheme`) |
| `radar-weather.js` | NEXRAD, GOES IR, GTG turbulence heatmap (Mercator reprojection), PIREPs, SIGMETs |
| `radar-markers.js` | Airport markers, airspace boundaries (Class B/C/D, optional 3D extrusion), fixes, navaids |
| `radar-aircraft.js` | Aircraft entity rendering, trail polylines, position extrapolation, polling loop |
| `radar-ui.js` | HUD clock, camera LOD transitions, all UI control event listeners, 2D/3D morphing |
| `radar-flightplan.js` | Aircraft selection, FlightAware flight search, route polyline display |
| `radar.js` | Shared init helpers — `loadAndApplySettings`, `applySavedView`, `loadDataJSON` |

### Platform abstraction

Both platforms expose the same `window.flightAPI` surface:

```js
flightAPI.getStates(bounds)       // fetch OpenSky state vectors
flightAPI.getTrack(icao24)        // fetch full track for one aircraft
flightAPI.getSettings()           // read persisted settings
flightAPI.saveSettings(settings)  // persist settings
flightAPI.onSettingsChanged(cb)   // register settings-change callback
```

Electron implements these via IPC (`preload.js`). The web version implements
them as `fetch()` calls through PHP proxy scripts.

### Data flow

```
Camera viewport → bounding box → OpenSky /states/all?lamin=&lomin=&lamax=&lomax=
                                  ↓
                           Parse state vectors → update entity positions + labels
                                  ↓
                           Accumulate history → render trail polylines

Flight search:
  Callsign → FlightAware AeroAPI → flight plan + route waypoints → route polyline + timeline

Weather overlays:
  NEXRAD (Iowa State WMS), GOES IR (NOAA), PIREPs/SIGMETs/AIRMETs/GTG (FAA AWC API)
```

### Static data files (`data/`)

Loaded once at startup by `shared/radar.js`:

- `airports.json` — airport database (large/medium/small with IATA/ICAO codes)
- `airspace.json` — Class B/C/D boundary polygons
- `waypoints.json` — navigation fix points and navaids

Refresh with:
```bash
npm run pull-data
```

## APIs & Credentials

### OpenSky Network

Anonymous access works out of the box. For higher rate limits, generate OAuth2
client credentials at https://opensky-network.org and enter them in the
Electron Settings panel or in `web/creds.json`.

Rate limits enforced by the app:
- `/states/all`: 10-second minimum interval (app default: 15s)
- `/tracks/all`: 10-second minimum interval

### FlightAware AeroAPI

Required for flight search, route display, and timeline scrubbing. Obtain an
API key at https://www.flightaware.com/aeroapi/ and add it to Settings or
`web/creds.json`.

## Making Changes

See [`CLAUDE.md`](CLAUDE.md) for detailed guidance. Key rules:

- **Shared code** goes in `shared/` — changes automatically apply to both platforms.
- **Platform-specific** behavior goes in `src/renderer.js` (Electron) or `web/app.js` (web).
- `src/index.html` and `web/index.html` share the same controls panel HTML — keep them in sync.
- When adding a persisted setting, update `DEFAULT_SETTINGS` in `main.js`, `CONFIG` in `shared/config.js`, and `loadAndApplySettings()` in `shared/radar.js`.
- All settings UI (HTML, CSS, event wiring) lives in `shared/settings.js` — do not add settings markup in platform files.
- Bump the version in `package.json` (and `?v=` cache-bust strings in `web/index.html`) on every change merged to `main`.
- Document new user-facing features in `src/help.html`.

## Packaging & Distribution

Uses **electron-forge**. Packaged output is fully self-contained.

```bash
npm run pack     # portable folder → out/flight-radar-win32-x64/FlightRadar.exe
npm run dist     # installer → out/make/squirrel.windows/x64/Flight Radar Setup.exe
```

Configured makers: Squirrel (Windows `.exe`) and deb (Linux `.deb`).

### Snapcraft

`snap/snapcraft.yaml` enables automatic snap builds via Snapcraft's GitHub
integration. The snap build runs `scripts/obfuscate-snap.js` to minify and
obfuscate JS before packaging.

Local snap build:

```bash
# One-time setup
sudo snap install snapcraft --classic
sudo snap install lxd
sudo lxd init --auto
sudo usermod -aG lxd $USER && newgrp lxd   # or log out and back in

snapcraft                                            # build (first run pulls core22 image)
sudo snap install flight-radar_*.snap --dangerous    # install locally
flight-radar                                         # run

# Iterate
snapcraft --use-lxd
sudo snap install flight-radar_*.snap --dangerous

# Troubleshoot
snapcraft clean
snap logs flight-radar
snap run --shell flight-radar
```

## Web Version

A standalone browser app in `web/` — no Electron required. Uses `fetch()` and
`localStorage` instead of IPC.

See [`web/README.md`](web/README.md) for full deployment details.

### Local development

```bash
npm install            # install deps + copy CesiumJS runtime to vendor/
npx serve .            # or: python -m http.server 8080
# open http://localhost:8080/web/
```

### Server-side proxies (required for deployment)

| File | Purpose |
|------|---------|
| `web/cred.php` | OpenSky OAuth2 token proxy (reads `web/creds.json`) |
| `web/awc-proxy.php` | FAA Aviation Weather Center API proxy |
| `web/flightaware-proxy.php` | FlightAware AeroAPI proxy |

Copy `web/creds.json.example` to `web/creds.json` and fill in credentials.
`creds.json` is git-ignored — never commit it.

### Platform differences

| Feature | Electron | Web |
|---------|----------|-----|
| Settings container | Separate native window | Inline modal overlay |
| Context menu | Native OS menu | Custom HTML overlay |
| FAA chart layers | — | Sectional, Terminal, IFR Low/High |
| Help window / menu bar | ✓ | — |
| API calls | Direct HTTPS (main process) | PHP proxies (CORS workaround) |
| Font loading | Local `shared/fonts/roboto-flex.woff2` | Google Fonts CDN |
