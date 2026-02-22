# Flight Radar

Real-time US flight tracker using CesiumJS and OpenSky Network, styled after
FAA radar center PVDs (Plan View Displays).

## Architecture

- **Electron** main process handles all OpenSky API calls (avoids CORS, manages rate limiting)
- **CesiumJS** renders the map in 3D (default) or 2D mode with CartoDB basemap tiles
- **OpenSky Network** provides free real-time ADS-B data with bounding-box queries
- IPC bridge (`preload.js`) connects renderer to API layer

## Data Flow

```
Camera viewport → bounding box → OpenSky /states/all?lamin=&lomin=&lamax=&lomax=
                                  ↓
                           Parse state vectors → update entity positions + labels
                                  ↓
                           Accumulate history → render trail polylines

Optional hi-res trails:
  Track fetch queue → OpenSky /tracks/all?icao24= → merge with polled history
```

## Setup

```bash
cd flight-radar
npm install      # also copies CesiumJS runtime to vendor/
npm start
```

For dev mode (opens DevTools):
```bash
npm run dev
```

## Packaging & Distribution

The app uses `electron-builder` to create standalone distributions. The
packaged output includes Electron, the app code, and all dependencies — no
separate install is needed on the target machine. The build auto-detects your
OS — the same commands work on Windows, macOS, and Linux.

```bash
npm run pack     # portable folder in dist/
npm run dist     # platform installer (NSIS on Windows, DMG on macOS, AppImage on Linux)
```

### Snapcraft (Snap Store)

This repository includes `snap/snapcraft.yaml` so Snapcraft's GitHub build
integration can build a snap automatically on every push once the repository is
connected in the Snapcraft dashboard.

The snap build runs `scripts/obfuscate-snap.js` during `override-build`, which
minifies and obfuscates the app JavaScript before packaging.

#### Building and testing a snap locally

Install Snapcraft and its LXD backend (one-time setup):

```bash
sudo snap install snapcraft --classic
sudo snap install lxd
sudo lxd init --auto
sudo usermod -aG lxd $USER
newgrp lxd              # or log out and back in
```

Build the snap from the project root:

```bash
snapcraft                # builds flight-radar_1.2.0_amd64.snap
```

The first build pulls a core22 container image and installs build dependencies,
so it takes a while. Subsequent builds reuse the cached environment.

Install and run the snap locally:

```bash
sudo snap install flight-radar_*.snap --dangerous   # --dangerous allows unsigned local snaps
flight-radar                                         # launch the app
```

To iterate after making changes, rebuild and reinstall:

```bash
snapcraft --use-lxd       # rebuild (faster — reuses prior build state)
sudo snap install flight-radar_*.snap --dangerous
```

Useful troubleshooting commands:

```bash
snapcraft clean           # wipe build state and start fresh
snap logs flight-radar    # view runtime logs
snap run --shell flight-radar  # open a shell inside the snap's confinement
```

### Cross-platform notes

- You can package for any platform from any host OS — Electron Packager handles
  cross-compilation automatically.
- To target a different architecture (e.g. `arm64`), change the `--arch` flag.
- The `--ignore` pattern excludes `dist/`, `scripts/`, and `.git/` from the
  packaged output to reduce bundle size.

## OpenSky Network API

No credentials are required for basic use (anonymous access). For higher rate
limits, create a free account at https://opensky-network.org, generate OAuth2
client credentials, and enter the Client ID and Secret in Settings
(`Ctrl+,` / `Cmd+,`).

Rate limiting enforced by the app:
- `/states/all`: 10-second minimum interval (app defaults to 15s)
- `/tracks/all`: 10-second minimum interval (app fetches 1 track per 12s)

## Controls

| Control | Description |
|---------|-------------|
| TRAILS | Toggle flight trail polylines |
| DATA BLOCKS | Toggle callsign/altitude/speed labels |
| HI-RES TRAILS | Fetch granular waypoints from /tracks API |
| POLL INTERVAL | 5–60 seconds between state updates |
| TRAIL LENGTH | 1–10 minutes of trail history |
| HOME | Fly to default airport (set in Settings) |
| CONUS | Snap to full CONUS view |
| 2D / 3D | Switch scene mode (3D default) |
| ROTATE | Orbit camera around current view center (3D only) |
| Click aircraft | Select aircraft and show detail panel |

## Display Format

Data blocks follow FAA convention:
```
UAL1234       ← callsign
FL350↑ 425    ← flight level, vertical trend, groundspeed (kts)
```

## Selected Aircraft

Clicking an aircraft opens a detail panel showing ICAO24, squawk, origin
country, altitude, ground speed, heading, vertical speed, coordinates, trail
point count, last poll time, and ADS-B timestamp. The selected aircraft is
highlighted with a brighter icon and label, gets a thicker trail, retains its
full trail history, and receives priority hi-res track fetches (every 30s vs
120s for unselected aircraft).

## Settings

Open via `Ctrl+,` (`Cmd+,` on macOS) or Edit > Settings.

| Setting | Description |
|---------|-------------|
| Data block font size | 8–20px for callsign/altitude labels |
| Display mode | Dark or Light theme (swaps basemap tiles and entity colors) |
| Dark mode color | Preset swatches (green, cyan, amber, red, lavender, white) or custom color picker — derives all UI colors from a single hex value |
| Default airport | IATA code (35 major US airports built in) for HOME button and startup view |
| OpenSky credentials | OAuth2 Client ID & Secret for authenticated API access |

## Web Version

A standalone web version lives in `web/` and runs entirely in the browser — no Electron required. It replaces the Electron IPC bridge with direct `fetch()` calls to the OpenSky API and uses `localStorage` for settings persistence.

### Local Development

Serve from the project root so that `vendor/cesium/` is accessible:

```bash
npm install            # install deps + copy CesiumJS runtime
npx serve .            # or: python -m http.server 8080
```

Then open `http://localhost:8080/web/`.

### Deploying to a Host

The web version is fully static — just upload these paths to any static file host:

```
web/index.html
web/styles.css
web/app.js
vendor/cesium/Build/Cesium/   (Cesium.js + widgets.css only)
```

Your host's directory structure should mirror the repo:

```
/
├── web/
│   ├── index.html
│   ├── styles.css
│   └── app.js
└── vendor/
    └── cesium/
        └── Build/
            └── Cesium/
                ├── Cesium.js
                └── Widgets/widgets.css
```

Any static host works: **GitHub Pages**, **Netlify**, **Vercel**, **Cloudflare Pages**, **S3 + CloudFront**, or a simple Nginx/Apache server.

**CORS note:** The OpenSky API may block browser-origin requests. If you hit CORS errors, you can either:
1. Use a CORS proxy in front of the OpenSky API
2. Run behind a reverse proxy that adds CORS headers
3. Use anonymous access (no credentials) which may have different CORS behavior

## Notes

- Ground traffic is filtered out for display clarity
- Trail rendering merges polled positions with granular API track data
  for sub-polling-interval resolution
- Aircraft symbols are heading-oriented chevrons in 2D; dot icons in 3D
- LOD scaling: dots shrink at high altitudes, labels hide above ~500 km
- Camera starts at a 30-degree angle looking at the default airport
- CRT scanline overlay is pure CSS (can be removed in styles.css)
- No Cesium Ion token required — uses CartoDB dark_matter / light_all tiles
- HUD displays UTC clock, track count, last update time, and camera center coordinates
