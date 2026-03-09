# Migration Notes: Vue 3 + TypeScript Refactor

## Overview

This directory (`web-vue/`) contains the new Vue 3 + TypeScript + Vite + Pinia
web application that incrementally replaces `web/`. The Electron app (`main.js`,
`preload.js`, `src/`) continues to use the original `shared/` modules unchanged.

## Architecture

```
web-vue/
├── src/
│   ├── core/        # Framework-independent domain logic (testable without Vue/Cesium)
│   ├── services/    # API clients (OpenSky, FlightAware, AWC, settings persistence)
│   ├── stores/      # Pinia stores (reactive state management)
│   ├── composables/ # Vue composables (bridge stores ↔ Cesium)
│   ├── components/  # Vue SFC components — TODO Phase 5
│   └── styles/      # CSS — TODO Phase 5
└── tests/           # Vitest unit tests
```

### Key Design Decisions

1. **`core/` has ZERO framework dependencies**: All domain logic is pure TypeScript.
   No Vue imports, no Cesium imports, no DOM access (except canvas for icons).
   This makes it fully testable and potentially reusable.

2. **Derived colors instead of global mutation**: The original code mutated a global
   `CONFIG` object via `setDarkColors(hex)`. The new code uses pure functions
   (`deriveDarkColors`, `deriveLightColors`) that return color sets. The Pinia
   settings store manages the lifecycle.

3. **Explicit theme parameter**: Functions like `altitudeToRgb` that originally
   read `CONFIG.theme` now accept `theme` as a parameter, making them pure.

4. **Service layer replaces `window.flightAPI` shim**: Direct API calls instead
   of routing through a shared abstraction layer. Capacitor detection is built
   into the service layer (direct API access in native, PHP proxy in browser).

5. **`shallowRef` for Cesium viewer**: The Cesium viewer object is massive and
   deeply mutable. It must NOT be made deeply reactive. `useCesiumViewer` wraps it
   in `shallowRef<Viewer>`.

6. **Aircraft store owns entity lifecycle**: The aircraft store (`useAircraftStore`)
   holds the `aircraft` Map, manages Cesium entity creation/destruction, and handles
   chunked rendering. The viewer is injected via `setViewer()`. The store reads
   settings reactively from `useSettingsStore()` — all `CONFIG.*` reads became
   store reads.

7. **Polling separated from rendering**: Polling logic lives in `usePolling`
   composable, which coordinates with the aircraft store for data updates. This
   separation allows the polling timer to be paused/resumed independently.

8. **Selected aircraft always visible**: Per CLAUDE.md rules, the selected aircraft
   is always rendered regardless of display toggles, trail mode settings, or
   viewport position. The selected-aircraft poll runs independently of bulk polls.

## Migration Status

### Completed (Phases 0-3)
- [x] Vite + Vue 3 + TypeScript project scaffolding
- [x] Core domain logic extraction (8 modules in `src/core/`)
- [x] 126 unit tests covering all core modules
- [x] API service layer (OpenSky, FlightAware, AWC Weather)
- [x] Settings Pinia store with theme resolution and derived colors
- [x] Type-safe TypeScript interfaces for all data structures
- [x] **Phase 3: Cesium core + Aircraft** — all sub-tasks complete:
  - [x] 3a: `src/composables/useCesiumViewer.ts` — Viewer init, tile providers,
        theme application (tile layers, globe styling, CSS variables), watch-driven
        reactivity. Uses `shallowRef<Viewer>`.
  - [x] 3b: `src/stores/aircraft.ts` — Aircraft store with entity CRUD, trail
        management (history, velocity vector, altitude-colored segments), chunked
        rendering with `_renderGeneration` cancellation, position extrapolation,
        billboard/label dirty-tracking.
  - [x] 3c: `src/composables/usePolling.ts` — Bulk viewport poll, selected-aircraft
        poll (10s), track fetch queue (12s), extrapolation tick, unified timer with
        safety valves, view bounds computation, rate limiting.
  - [x] 3d: `src/composables/useCamera.ts` — Camera change handler (LOD transitions,
        zoom resize via rAF debounce), poll interval adjustment (±10% hysteresis),
        2D/3D morphing, orbit rotation, entity tracking, view save/restore.
  - [x] 3e: `src/stores/flightplan.ts` — Click selection, info panel state,
        FlightAware enrichment, route polyline display, natural language search,
        flight picking (en-route → upcoming → not-arrived), search history.

### Remaining (Phases 4-6)
- [ ] **Phase 4: Weather overlays + map markers composables**
  - [ ] 4a: Weather composable — NEXRAD radar, turbulence forecast (GTG heatmap),
        PIREPs, SIGMETs, G-AIRMETs. Source: `shared/radar-weather.js`.
  - [ ] 4b: Markers composable — Airport markers (large/medium/small), airspace
        boundaries (Class B/C/D), waypoints, navaids.
        Source: `shared/radar-markers.js`.
- [ ] **Phase 5: Vue components** (HUD, controls, info panel, settings modal)
- [ ] **Phase 6: Capacitor Android integration**

## Module Mapping

| Original `shared/` Module | New Location(s) |
|---|---|
| `shared/defaults.js` | `src/core/defaults.ts` |
| `shared/config.js` (colors) | `src/core/colors.ts` |
| `shared/config.js` (scaling) | `src/core/scaling.ts` |
| `shared/config.js` (CONFIG object) | `src/stores/settings.ts` |
| `shared/data.js` (airports) | `src/core/airports.ts` |
| `shared/data.js` (OpenSky parsing) | `src/core/opensky.ts` |
| `shared/data.js` (formatting) | `src/core/formatting.ts` |
| `shared/icons.js` | `src/core/icons.ts` |
| `shared/radar-core.js` (viewer init, theme) | `src/composables/useCesiumViewer.ts` |
| `shared/radar-aircraft.js` (entities, trails) | `src/stores/aircraft.ts` |
| `shared/radar-aircraft.js` (polling, extrapolation) | `src/composables/usePolling.ts` |
| `shared/radar-ui.js` (camera, LOD, rotation) | `src/composables/useCamera.ts` |
| `shared/radar-ui.js` (boundsContain, extrapolation) | `src/core/geo.ts` |
| `shared/radar-flightplan.js` | `src/stores/flightplan.ts` |
| `shared/radar-weather.js` (pure computation) | `src/core/weather.ts` |
| `shared/radar-weather.js` (API calls) | `src/services/weather-api.ts` |
| `web/app.js` (OpenSky API) | `src/services/opensky-api.ts` |
| `web/app.js` (FlightAware API) | `src/services/flightaware-api.ts` |
| `web/app.js` (settings persistence) | `src/services/settings-service.ts` |

## Behavioral Changes

None. All extracted code was verified to produce identical outputs to the original
via unit tests. The `altitudeToRgb` function now takes an explicit `theme` parameter
instead of reading from `CONFIG.theme`, but the computed values are identical.

## Development

```bash
cd web-vue
npm install
npm test        # Run 126 unit tests
npm run dev     # Start Vite dev server (requires PHP proxy on port 8080)
```
