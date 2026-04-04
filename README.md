# Flight Radar 3D

<img src="site/screenshots/hero.png" alt="Flight Radar 3D" width="100%">

Real-time 3D flight tracker built with Electron + CesiumJS.

## Quick Start

```bash
npm install      # copies CesiumJS runtime to vendor/, downloads fonts
npm run dev      # Vite dev server + Electron with HMR
npm run build    # production build → out/
npm start        # preview production build
```

## Architecture

**Electron main process** (`main.js`) owns all external API calls — OpenSky
Network (OAuth2), FlightAware AeroAPI, FAA AWC — avoiding CORS restrictions
and managing rate limiting centrally. It exposes results to the renderer via
a context-isolated IPC bridge (`preload.js`) as `window.flightAPI`.

**CesiumJS** renders the 3D/2D map. It is an npm devDependency; the
`postinstall` script copies `node_modules/cesium/Build/Cesium/` to `vendor/`
so it can be served as static files. No Cesium Ion token is required.

**Renderer modules** (`src/`) are ES modules bundled by Vite. Each module
exposes its API on `window` for cross-module access. Import order is defined in
`src/entry.js` — `radar-core.js` must be imported first, then the other
`radar-*.js` files in order, then `radar.js` last.

**`window.flightAPI`** is the API abstraction layer exposed by `preload.js`.
All renderer code calls only this interface for settings persistence and
external API access.

## Making Changes

### Adding a feature

Edit the appropriate module in `src/`. When adding a new feature, document it
in `src/help.html`.

### Adding a persisted setting

Update all three locations:

1. `DEFAULT_SETTINGS` in `src/defaults.js`
2. `CONFIG` defaults in `src/config.js`
3. `loadAndApplySettings()` in `src/radar.js` — load the value, sync the UI
   element, and save on change in the event handler

### Settings UI

All settings form HTML, CSS, and event wiring live in `src/settings.js`.
The Electron wrapper (`src/settings-electron.js`) provides only `onClose`,
`onDefaults`, and `onChanged` callbacks. Do not add settings markup or styling
in the wrapper.

### Versioning

Increment `version` in `package.json` on every change merged to `main`
(not on feature branches). Semantic versioning: major for breaking changes,
minor for new features, patch for bug fixes.

## APIs & Credentials

### OpenSky Network

Anonymous access works out of the box with lower rate limits. For higher
limits, create a free account at https://opensky-network.org and generate
OAuth2 client credentials. Enter them in Settings.

Rate limits enforced by the app:
- `/states/all`: 10-second minimum interval (default poll: 15s)
- `/tracks/all`: 10-second minimum interval

### FlightAware AeroAPI

Required for flight search and route display. Get a key at
https://www.flightaware.com/aeroapi/. Enter it in Settings.

## Packaging

### General

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

**Install from Snap Store:**

```bash
sudo snap install flight-radar
```

**Local snap build** (requires Snapcraft + LXD):

```bash
# One-time setup
sudo snap install snapcraft --classic
sudo snap install lxd && sudo lxd init --auto
sudo usermod -aG lxd $USER && newgrp lxd

# Build
snapcraft pack

# Install locally
sudo snap install flight-radar_*.snap --dangerous
```

## Screenshots

<img src="site/screenshots/flightplan.png" alt="Flight plan view" width="49%"> <img src="site/screenshots/search.png" alt="Search panel" width="49%">

<img src="site/screenshots/airmet.png" alt="AIRMET overlay" width="49%"> <img src="site/screenshots/charts.png" alt="Charts view" width="49%">
