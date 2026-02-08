# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install              # Install dependencies
npm run setup            # Download CesiumJS 1.119 to vendor/cesium/ (required first time)
npm start                # Launch the app
npm run dev              # Launch with DevTools open
npm run pack             # Package for Windows x64 → dist/FlightRadar-win32-x64/
```

There are no tests or linting configured.

## Architecture

Electron desktop app with three layers:

- **Main process** (`main.js`): OpenSky Network API calls (OAuth2 client credentials), rate limiting (10s minimum between calls), settings persistence (`settings.json` in userData dir), and window/menu management.
- **Preload bridge** (`preload.js`): Context-isolated IPC bridge exposing `window.flightAPI` with five methods: `getStates`, `getTrack`, `getSettings`, `saveSettings`, `onOpenSettings`.
- **Renderer** (`src/renderer.js`, ~950 lines): CesiumJS viewer, aircraft state management, trail rendering, UI controls, theme system, and settings modal. All in one file — no framework, no build step.

### Data flow

Camera viewport bounds are sent to the main process every 15s, which queries OpenSky `/states/all` with bounding-box params. State vectors (16-field arrays) are parsed in the renderer, updating a `Map<icao24, AircraftObject>` that tracks entity state, Cesium entities (billboard + label + polyline), position history, and optional granular tracks fetched one-at-a-time from `/tracks/all`.

### Key patterns

- **No build step**: Plain JS loaded directly. CesiumJS is vendored from a GitHub release via `scripts/fetch-cesium.js`.
- **Cesium without Ion**: Uses CartoDB dark_matter/light tiles, no Cesium Ion token needed.
- **Canvas aircraft icons**: Chevrons drawn and rotated on canvas per heading, used as Cesium billboards.
- **Theme system**: Single hex color (dark mode) → derives all CSS variables and Cesium entity colors. Light mode uses a separate fixed palette.
- **Rate limiting**: Main process enforces 10s minimums. Track fetch queue processes 1 aircraft per 12s.
- **FAA data block format**: Callsign on top, flight level + vertical indicator + groundspeed on bottom. Altitude in meters converted to feet/flight levels; speed in m/s converted to knots.

### UI structure

`src/index.html` contains the DOM structure including the settings modal. `src/styles.css` handles the phosphor-green FAA aesthetic with CRT scanline overlay (pure CSS). The renderer manages all UI state and Cesium interaction in a single `init()` entry point.

### Web version (`web/`)

This repo maintains parallel Electron and web implementations. Changes to shared functionality (renderer logic, styles, UI) should be applied to both `src/` (Electron) and `web/` (web) unless the change is platform-specific.

The web version intentionally omits the CONUS button (present in the Electron version) since zooming out to the full continental US scope is impractical for a public web deployment. This difference should be preserved.
