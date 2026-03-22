// Renderer entry point — imports all shared modules in dependency order,
// then the Electron-specific renderer code.
// Each shared module exposes its API on `window` so cross-module access works.

// CSS
import '../shared/styles.css'

// Shared modules (order matters — each depends on the previous ones)
import '../shared/defaults.js'
import '../shared/config.js'
import '../shared/data.js'
import '../shared/icons.js'
import '../shared/radar-core.js'
import '../shared/radar-weather.js'
import '../shared/radar-markers.js'
import '../shared/radar-aircraft.js'
import '../shared/radar-ui.js'
import '../shared/radar-flightplan.js'
import '../shared/radar-timeline.js'
import '../shared/radar.js'

// Electron-specific entry point
import './renderer.js'
