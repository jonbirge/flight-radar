# Flight Radar

Real-time 3D flight tracker with Material 3 Expressive design, powered by
CesiumJS and OpenSky Network. Styled after FAA radar center PVDs (Plan View
Displays) with live weather overlays, aviation charts, and flight plan search.

## Architecture

- **Electron** main process handles all OpenSky API calls (avoids CORS, manages rate limiting)
- **CesiumJS** renders the map in 3D (default) or 2D mode with multiple basemap options
- **OpenSky Network** provides free real-time ADS-B data with bounding-box queries
- **FlightAware AeroAPI** powers flight search, route display, and timeline scrubbing
- **FAA AWC API** provides weather overlays (NEXRAD, satellite IR, turbulence, SIGMETs, AIRMETs, PIREPs)
- IPC bridge (`preload.js`) connects renderer to API layer
- Shared `shared/` modules deliver feature parity between Electron and web platforms

## Data Flow

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

## Setup

```bash
cd flight-radar
npm install      # also copies CesiumJS runtime to vendor/ and downloads fonts
npm start
```

For dev mode (opens DevTools):
```bash
npm run dev
```

## Packaging & Distribution

The app uses **electron-forge** to create standalone distributions. The
packaged output includes Electron, the app code, and all dependencies — no
separate install is needed on the target machine.

```bash
npm run pack     # portable folder → out/flight-radar-win32-x64/FlightRadar.exe
npm run dist     # platform installer → out/make/squirrel.windows/x64/Flight Radar Setup.exe
```

Configured makers: Squirrel (Windows `.exe` installer) and deb (Linux `.deb` package).

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
snapcraft
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

## APIs & Credentials

### OpenSky Network

No credentials are required for basic use (anonymous access). For higher rate
limits, create a free account at https://opensky-network.org, generate OAuth2
client credentials, and enter the Client ID and Secret in Settings
(`Ctrl+,` / `Cmd+,`).

Rate limiting enforced by the app:
- `/states/all`: 10-second minimum interval (app defaults to 15s)
- `/tracks/all`: 10-second minimum interval

### FlightAware AeroAPI

Required for flight search, route display, and timeline features. Obtain an API
key from https://www.flightaware.com/aeroapi/ and enter it in Settings under
the Credentials section.

## Controls

### Toggles

| Control | Description |
|---------|-------------|
| Aircraft | Toggle all aircraft display on/off |
| Data blocks | Toggle callsign/altitude/speed labels |
| Auto rotate | Orbit camera around current view center (3D only) |
| IR | GOES satellite infrared cloud imagery overlay |
| Radar | NEXRAD composite reflectivity weather radar overlay |
| SIGMETs | Significant meteorological information polygons |
| AIRMETs | AIRMET turbulence area polygons |
| PIREPs | Pilot reports of turbulence (dots) |
| Turbulence | GTG graphical turbulence guidance forecast heatmap |

### Buttons

| Control | Description |
|---------|-------------|
| North up | Reset camera heading to north |
| CONUS | Snap to full CONUS view |
| 2D / 3D | Switch scene mode (3D default) |
| Settings | Open settings panel (`Ctrl+,` / `Cmd+,`) |

### Map Layer

A dropdown selector with multiple basemap options:
- **CartoDB** (default) — dark/light vector tiles
- **Satellite** — ESRI ArcGIS imagery
- **OpenStreetMap** — standard OSM tiles
- **Topographic** — GEBCO bathymetric/topographic
- **Night Lights** — NASA VIIRS nighttime imagery
- **FAA Sectional** — VFR sectional charts (web only)
- **FAA Terminal** — VFR terminal area charts (web only)
- **FAA IFR Low** — IFR enroute low altitude charts (web only)
- **FAA IFR High** — IFR enroute high altitude charts (web only)

### Flight Search

A text input (top-left) for searching flights by callsign (e.g., `UAL123`).
Results show EN ROUTE, UPCOMING, and PAST flights. Selecting a flight displays
the filed route, origin/destination airports, and activates the timeline
scrubber. Recent searches are accessible via a history button.

### Context Menu

Right-click the map to access:
- **Go home** — fly to saved view or startup position
- **Save view** — persist the current camera position

### Interactions

| Action | Description |
|--------|-------------|
| Click aircraft | Select aircraft, open info panel, fetch full track |
| Click PIREP dot | Show turbulence report details |

## Display Format

Data blocks follow FAA convention:
```
UAL1234       ← callsign (or ICAO24 hex if no callsign)
FL350↑ 425    ← flight level, vertical trend, groundspeed (kts)
```

## Selected Aircraft

Clicking an aircraft opens a detail panel showing altitude, ground speed,
heading, vertical speed, coordinates, last poll time, and ADS-B timestamp. The
selected aircraft is highlighted with a brighter icon and label, gets a thicker
trail, and retains its full trail history. The selected aircraft is always
visible regardless of display toggle state.

When a flight plan is active for the selected aircraft, the panel also shows
the route (origin → destination), filed altitude, elapsed time, remaining time,
and ETA.

## Timeline Scrubber

When a flight plan is loaded, a timeline slider appears at the bottom of the
screen spanning departure to arrival. Dragging the slider scrubs through the
flight plan:

- A cyan marker shows the estimated position along the filed route
- The current time display updates to the scrubbed UTC time
- Weather overlays filter to show only data valid at the scrubbed time
- Other aircraft are hidden if more than 5 minutes from the scrubbed time
- A **Live** button returns to real-time mode

## Weather Overlays

| Overlay | Source | Refresh |
|---------|--------|---------|
| NEXRAD radar | Iowa State Mesonet WMS | 5 minutes |
| GOES satellite IR | NOAA EOSDIS | 10 minutes |
| PIREPs | FAA AWC API | 3-hour age window |
| SIGMETs | FAA AWC API | 5 minutes |
| G-AIRMETs | FAA AWC API | 5 minutes |
| GTG turbulence forecast | FAA AWC API | 15 minutes |

GTG forecast images use Mercator projection and are reprojected to geographic
coordinates via canvas pixel manipulation. The forecast is altitude-aware,
using the selected aircraft's filed altitude when available.

Weather overlay opacity is adjustable in Settings (10–100%).

## Aviation Data Overlays

Loaded from static JSON files in `data/` at startup:

- **Airport markers**: Large, medium, and small airports with IATA/ICAO labels; zoom-dependent visibility and sizing
- **Airspace boundaries**: Class B (blue), C (magenta), D (light blue) with optional 3D extrusion showing floor/ceiling
- **Waypoints (fixes)**: Navigation fix points with labels
- **Navaids**: VOR (blue), NDB (red), DME (green) with color-coded type labels

All aviation data layers are individually toggleable in Settings.

## Settings

Open via `Ctrl+,` (`Cmd+,` on macOS), Edit > Settings menu, or the Settings button.

| Category | Setting | Description |
|----------|---------|-------------|
| Display | Theme | Dark, Light, or System (follows OS preference) |
| Display | Dark mode color | Preset swatches or custom color picker — derives all UI colors from a single hex value |
| Display | Light mode color | Preset swatches or custom color picker for light mode |
| Display | Mute map colors | Desaturate basemap tiles |
| Display | Data block font size | 8–20px for callsign/altitude labels |
| Aircraft | Trail mode | None, History (time-based trails), or Velocity (speed-based trails) |
| Aircraft | Trail length | 60–600 seconds of trail history |
| Aircraft | Color by altitude | Color aircraft and trails by altitude (red=low → magenta=high) |
| Aircraft | Trail thickness by altitude | Vary trail width by altitude (1–6px) |
| Aviation | Airports | Toggle airport markers |
| Aviation | Small airports | Include small airports |
| Aviation | Airspace | Toggle Class B/C/D boundaries |
| Aviation | Airspace edges | Show airspace outline strokes |
| Aviation | 3D airspace | Extrude airspace volumes floor-to-ceiling |
| Aviation | Navaids | Toggle VOR/NDB/DME markers |
| Aviation | Fixes | Toggle navigation fix waypoints |
| Camera | Rotation speed | 1–20°/s for auto-rotate |
| Weather | Overlay opacity | 10–100% for weather layer transparency |
| Credentials | OpenSky Client ID & Secret | OAuth2 credentials for authenticated API access |
| Credentials | FlightAware API key | AeroAPI key for flight search and route display |

## Web Version

A standalone web version lives in `web/` and runs entirely in the browser — no
Electron required. It replaces the Electron IPC bridge with direct `fetch()`
calls routed through PHP proxy scripts and uses `localStorage` for settings.

See [web/README.md](web/README.md) for deployment details.

### Local Development

Serve from the project root so that `vendor/cesium/` is accessible:

```bash
npm install            # install deps + copy CesiumJS runtime
npx serve .            # or: python -m http.server 8080
```

Then open `http://localhost:8080/web/`.

### Server-side Proxies

The web version requires three PHP proxy scripts to handle CORS:

- **`cred.php`** — OpenSky OAuth2 token proxy (reads `creds.json`)
- **`awc-proxy.php`** — FAA Aviation Weather Center API proxy
- **`flightaware-proxy.php`** — FlightAware AeroAPI proxy

Server credentials are configured in `creds.json` (see `creds.json.example`).

### Platform Differences

- **FAA chart layers** (Sectional, Terminal, IFR Low, IFR High) are available on web only
- **Settings**: Electron opens a separate native window; web uses an inline modal overlay
- **Context menu**: Electron uses a native OS menu; web uses a custom HTML overlay
- **Help window** and **native menu bar** are Electron-only

## Notes

- Ground traffic is filtered out for display clarity
- Aircraft symbols are heading-oriented chevrons in 2D; dot icons in 3D
- LOD scaling: icons shrink at high altitudes, labels hide above ~500 km
- CRT scanline overlay is pure CSS (can be removed in styles.css)
- No Cesium Ion token required
- HUD displays UTC clock, track count, last update time, and camera center coordinates
- Material 3 Expressive design language for settings UI
