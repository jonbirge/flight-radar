# Flight Radar

Real-time 3D flight tracker built with **Capacitor + Electron + Vite + CesiumJS**.
The desktop app runs through Capacitor's Electron platform and serves a plain-
JavaScript app bundle built by Vite.

## Quick Start

```bash
npm install
npm start
```

## Desktop Development

```bash
npm run dev                # run Vite dev server for app/ sources
npm run build              # build app/ into dist/
npm run cap:sync           # build + sync dist/ into electron/app/
npm start                  # sync + launch Capacitor Electron desktop app
```

## Desktop Packaging

```bash
npm run pack               # portable desktop package
npm run dist               # distributable installer artifacts
```

These commands use the Capacitor Electron platform project under `electron/`.

## Project Structure

```text
app/
  index.html               # desktop renderer HTML entry
  renderer.js              # desktop renderer bootstrap
  settings.html/.js/.css   # settings window UI
  help.html/.css           # help window UI
  data/                    # static JSON loaded at startup
  shared/                  # shared radar modules (plain JS globals)
  vendor/cesium/           # Cesium runtime copied on postinstall

scripts/
  copy-cesium.js           # copies Cesium runtime into app/vendor
  download-fonts.js        # downloads Roboto Flex into app/shared/fonts
  download-airports.js     # refreshes airports.json
  download-airspace.js     # refreshes airspace.json
  download-waypoints.js    # refreshes waypoints.json
  promote-airports.js      # promotes primary C/D airports

electron/
  src/index.ts             # Capacitor Electron main process + IPC handlers
  src/preload.ts           # preload bridges (flightAPI/settingsAPI/helpAPI)
  src/rt/                  # Capacitor electron runtime shims

capacitor.config.ts        # root Capacitor config (webDir=dist)
vite.config.js             # Vite build config (root=app)
```

## Architecture Notes

- The renderer remains plain JavaScript loaded via `<script>` tags.
- Shared runtime logic lives in `app/shared/` and is reused by the desktop app.
- Desktop-only APIs are exposed as `window.flightAPI` through Electron preload.
- Settings are persisted in `settings.json` under Electron userData.
- External API calls (OpenSky, FlightAware) are handled in the Electron main process.

## Data Refresh

```bash
npm run pull-data
```

This regenerates JSON datasets in `app/data/`.

## Testing

There is currently **no automated test suite** configured in this repository.
For validation:

1. Build the app (`npm run build`)
2. Sync Capacitor desktop assets (`npm run cap:sync`)
3. Launch desktop app (`npm start`)
4. Package desktop artifacts (`npm run pack`)

## Credentials

OpenSky and FlightAware credentials are configured in the in-app Settings window.
Anonymous OpenSky access works without credentials but has lower rate limits.
