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
│   ├── composables/ # Vue composables (bridge stores ↔ Cesium) — TODO Phase 3+
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

5. **`shallowRef` for Cesium viewer** (Phase 3+): The Cesium viewer object is
   massive and deeply mutable. It must NOT be made deeply reactive.

## Migration Status

### Completed (Phases 0-2)
- [x] Vite + Vue 3 + TypeScript project scaffolding
- [x] Core domain logic extraction (8 modules in `src/core/`)
- [x] 126 unit tests covering all core modules
- [x] API service layer (OpenSky, FlightAware, AWC Weather)
- [x] Settings Pinia store with theme resolution and derived colors
- [x] Type-safe TypeScript interfaces for all data structures

### Remaining (Phases 3-6)
- [ ] Phase 3: Aircraft store + polling composable + Cesium entity rendering
- [ ] Phase 4: Weather overlays + map markers composables
- [ ] Phase 5: Vue components (HUD, controls, info panel, settings modal)
- [ ] Phase 6: Capacitor Android integration

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
| `shared/radar-weather.js` (pure computation) | `src/core/weather.ts` |
| `shared/radar-weather.js` (API calls) | `src/services/weather-api.ts` |
| `shared/radar-ui.js` (boundsContain, extrapolation) | `src/core/geo.ts` |
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
