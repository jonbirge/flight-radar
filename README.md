# Flight Radar — FAA Scope Display

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
  Track fetch queue → OpenSky /tracks/all?icao24=&time=0 → merge with polled history
```

## Setup

```bash
cd flight-radar
npm install
npm run setup    # downloads CesiumJS 1.119 to vendor/cesium/ (first time only)
npm start
```

For dev mode (opens DevTools):
```bash
npm run dev
```

To package for Windows x64:
```bash
npm run pack     # outputs to dist/FlightRadar-win32-x64/
```

## OpenSky Network API

No credentials are required for basic use (anonymous access). For higher rate
limits, create a free account at https://opensky-network.org, generate OAuth2
client credentials, and enter the Client ID and Secret in Preferences
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
| HOME | Fly to default airport (set in Preferences) |
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

## Preferences

Open via `Ctrl+,` (`Cmd+,` on macOS) or Edit > Preferences.

| Setting | Description |
|---------|-------------|
| Data block font size | 8–20px for callsign/altitude labels |
| Display mode | Dark or Light theme (swaps basemap tiles and entity colors) |
| Dark mode color | Preset swatches (green, cyan, amber, red, lavender, white) or custom color picker — derives all UI colors from a single hex value |
| Default airport | IATA code (35 major US airports built in) for HOME button and startup view |
| OpenSky credentials | OAuth2 Client ID & Secret for authenticated API access |

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
