# Flight Radar — FAA Scope Display

Real-time US flight tracker using CesiumJS and OpenSky Network, styled after
FAA radar center PVDs (Plan View Displays).

## Architecture

- **Electron** main process handles all OpenSky API calls (avoids CORS, manages rate limiting)
- **CesiumJS** renders the map in 2D (default) or 3D mode with CartoDB dark basemap
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
npm start
```

For dev mode (opens DevTools):
```bash
npm run dev
```

## Rate Limits

OpenSky Network anonymous access:
- `/states/all`: 10-second minimum interval (app defaults to 15s)
- `/tracks/all`: 10-second minimum interval (app fetches 1 track per 12s)
- No API key required for basic use

For higher rate limits, create a free account at https://opensky-network.org
and add your credentials to the app in "Settings".

## Controls

| Control | Description |
|---------|-------------|
| TRAILS | Toggle flight trail polylines |
| DATA BLOCKS | Toggle callsign/altitude/speed labels |
| HI-RES TRAILS | Fetch granular waypoints from /tracks API |
| POLL INTERVAL | 10–60 seconds between state updates |
| TRAIL LENGTH | 1–10 minutes of trail history |
| CONUS | Snap to full CONUS view |
| 2D / 3D | Switch scene mode |
| Click aircraft | Show detailed info panel |

## Display Format

Data blocks follow FAA convention:
```
UAL1234        ← callsign
FL350↑ 425    ← flight level, vertical trend, groundspeed (kts)
```

## Notes

- Ground traffic is filtered out for display clarity
- Trail rendering merges polled positions with granular API track data
  for sub-polling-interval resolution
- Aircraft symbols are heading-oriented chevrons when in 2D mode
- CRT scanline overlay is pure CSS (can be removed in styles.css)
- No Cesium Ion token required — uses CartoDB dark_matter tiles
