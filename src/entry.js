// Renderer entry point — imports all modules in dependency order,
// then the Electron-specific renderer code.
// Each module exposes its API on `window` so cross-module access works.

// CSS
import './styles.css'

// Core modules (order matters — each depends on the previous ones)
import './defaults.js'
import './config.js'
import './data.js'
import './icons.js'
import './cloud.js'
import './radar-core.js'
import './radar-weather.js'
import './radar-markers.js'
import './radar-aircraft.js'
import './radar-ui.js'
import './radar-flightplan.js'
import './radar-timeline.js'
import './radar.js'

// Electron-specific entry point
import './renderer.js'
