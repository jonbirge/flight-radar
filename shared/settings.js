// Shared settings panel: HTML template, form logic, and live-update wiring.
// Loaded by both Electron settings window and web inline modal.
// Does NOT depend on Cesium, shared/config.js, or shared/radar.js.

'use strict';

// ============================================================
// Constants
// ============================================================

// Use DEFAULT_SETTINGS from shared/defaults.js (loaded before this script)

const COLOR_PRESETS = [
  { color: '#00cc44', label: 'Phosphor Green' },
  { color: '#00cccc', label: 'Cyan' },
  { color: '#cc8800', label: 'Amber' },
  { color: '#cc4444', label: 'Red' },
  { color: '#cccccc', label: 'White' },
];

const LIGHT_COLOR_PRESETS = [
  { color: '#1a1a1a', label: 'Black' },
  { color: '#2563eb', label: 'Cobalt' },
  { color: '#0d9488', label: 'Teal' },
  { color: '#dc2626', label: 'Crimson' },
  { color: '#7c3aed', label: 'Violet' },
];

// ============================================================
// Inline CSS (structural, shared by both platforms)
// ============================================================

const SETTINGS_CSS = `
.settings-columns {
  display: flex;
}
.settings-column {
  flex: 1;
  min-width: 0;
}
.settings-column:first-child {
  border-right: 1px solid var(--md-outline-variant, var(--settings-border, #ccc));
}

.settings-section {
  padding: 18px 16px;
  border-bottom: 1px solid var(--md-outline-variant, var(--settings-border, #ccc));
}

.settings-label {
  font-size: 15px;
  color: var(--md-on-surface-variant, var(--settings-label-color, #666));
  margin-bottom: 10px;
  font-weight: 600;
}

.settings-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.settings-color-row {
  flex-wrap: wrap;
  gap: 8px;
}

.color-swatch {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: 2px solid transparent;
  cursor: pointer;
  padding: 0;
  transition: border-color 0.2s, transform 0.15s cubic-bezier(0.35, 1.5, 0.65, 1);
}
.color-swatch:hover { transform: scale(1.15); }
.color-swatch.active {
  border-color: var(--md-on-surface, var(--swatch-active-border, #333));
}

#set-custom-color,
#set-light-custom-color {
  width: 36px;
  height: 36px;
  border: 1px solid var(--md-outline-variant, var(--settings-border, #ccc));
  border-radius: 8px;
  background: transparent;
  cursor: pointer;
  padding: 0;
}

.settings-hint {
  font-size: 13px;
  color: var(--md-on-surface-variant, var(--settings-label-color, #666));
  margin-bottom: 8px;
}

.settings-field-label {
  font-size: 13px;
  color: var(--md-on-surface-variant, var(--settings-label-color, #666));
  width: 65px;
  flex-shrink: 0;
}

.settings-cred-input {
  flex: 1;
  padding: 8px 12px;
  font-size: 14px;
  border: none;
  border-radius: 8px;
  background: var(--settings-input-bg, #fff);
  color: var(--md-on-surface, var(--settings-input-color, #000));
  font-family: 'Roboto Flex', system-ui, -apple-system, sans-serif;
}

.settings-cred-input:focus {
  outline: none;
}

.settings-cred-input::placeholder {
  color: var(--md-on-surface-variant, var(--settings-label-color, #666));
}

.settings-cred-section {
  transition: background 0.15s, border-color 0.15s;
  border: 2px dashed transparent;
  border-radius: 12px;
  margin: -6px;
  padding: 6px;
}
.settings-cred-section.drag-over {
  border-color: var(--md-on-surface-variant, var(--settings-label-color, #666));
  background: var(--md-surface-container-highest, var(--settings-btn-hover-bg, rgba(0,0,0,0.04)));
}

.settings-seg-group {
  display: inline-flex;
  border-radius: 9999px;
  background: var(--md-surface-container-highest, var(--settings-btn-bg, rgba(0,0,0,0.06)));
  padding: 3px;
  gap: 2px;
}
.theme-light .settings-seg-group {
  background: #ffffff;
}

.settings-theme-btn {
  padding: 6px 14px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  border: none;
  border-radius: 9999px;
  background: transparent;
  color: var(--md-on-surface, var(--settings-text-color, #333));
  font-family: 'Roboto Flex', system-ui, sans-serif;
  transition: background 0.15s, color 0.15s;
}
.settings-theme-btn:hover {
  background: var(--md-surface-container-highest, var(--settings-btn-hover-bg, rgba(0,0,0,0.06)));
}
.settings-theme-btn:active {
  background: var(--md-outline-variant, var(--settings-btn-hover-bg, rgba(0,0,0,0.1)));
}
.settings-theme-btn.active {
  background: var(--md-primary, var(--settings-btn-active-bg, #333));
  color: var(--settings-btn-active-color, #fff);
}

.settings-toggle-label {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  font-size: 14px;
  color: var(--md-on-surface, var(--settings-text-color, #333));
  font-family: 'Roboto Flex', system-ui, sans-serif;
}

.settings-fontsize-val {
  font-size: 14px;
  min-width: 32px;
  color: var(--md-on-surface, var(--settings-text-color, #333));
}

.settings-grid-2col {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.settings-color-label {
  font-size: 13px;
  color: var(--md-on-surface-variant, var(--settings-label-color, #666));
  margin-bottom: 6px;
}

/* M3 range slider */
input[type="range"] {
  -webkit-appearance: none;
  height: 4px;
  background: var(--md-outline-variant, var(--settings-border, #ccc));
  border-radius: 9999px;
  outline: none;
  flex: 1;
  margin: 12px 0;
}
input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--md-primary, var(--settings-btn-active-bg, #333));
  cursor: pointer;
  box-shadow: 0 1px 3px 1px rgba(0,0,0,0.15), 0 1px 2px 0 rgba(0,0,0,0.3);
  transition: transform 0.15s cubic-bezier(0.35, 1.5, 0.65, 1);
}
input[type="range"]::-webkit-slider-thumb:hover {
  transform: scale(1.15);
}

/* M3 checkboxes */
.settings-toggle-label input[type="checkbox"] {
  appearance: none;
  width: 18px;
  height: 18px;
  border: 2px solid var(--md-outline-variant, var(--settings-border, #ccc));
  border-radius: 4px;
  background: transparent;
  cursor: pointer;
  position: relative;
  flex-shrink: 0;
  transition: background 0.15s, border-color 0.15s;
}
.settings-toggle-label input[type="checkbox"]:checked {
  background: var(--md-primary, var(--settings-btn-active-bg, #333));
  border-color: var(--md-primary, var(--settings-btn-active-bg, #333));
}
.settings-toggle-label input[type="checkbox"]:checked::after {
  content: '';
  position: absolute;
  top: 1px;
  left: 5px;
  width: 5px;
  height: 9px;
  border: solid var(--settings-btn-active-color, #fff);
  border-width: 0 2px 2px 0;
  transform: rotate(45deg);
}
.theme-light .settings-toggle-label input[type="checkbox"]:not(:checked) {
  background: #ffffff;
}

/* Footer */
.settings-footer {
  display: flex;
  justify-content: space-between;
  padding: 12px 16px;
  border-top: 1px solid var(--md-outline-variant, var(--settings-border, #ccc));
}
/* Footer buttons use .scope-btn from shared/styles.css (web) or src/settings.css (Electron) */
`;

let settingsCssInjected = false;

function injectSettingsCSS(doc) {
  if (settingsCssInjected) return;
  const style = doc.createElement('style');
  style.textContent = SETTINGS_CSS;
  doc.head.appendChild(style);
  settingsCssInjected = true;
}

// ============================================================
// HTML Template
// ============================================================

function createSettingsFormHTML() {
  const darkSwatchesHTML = COLOR_PRESETS.map(p =>
    `<button class="color-swatch dark-color-swatch" data-color="${p.color}" style="background:${p.color}" title="${p.label}" type="button"></button>`
  ).join('\n          ');

  const lightSwatchesHTML = LIGHT_COLOR_PRESETS.map(p =>
    `<button class="color-swatch light-color-swatch" data-color="${p.color}" style="background:${p.color}" title="${p.label}" type="button"></button>`
  ).join('\n          ');

  return `
    <div class="settings-columns">
      <div class="settings-column">
        <div class="settings-section">
          <div class="settings-label">Display mode</div>
          <div class="settings-seg-group">
            <button class="settings-theme-btn" id="set-theme-dark" type="button">Dark</button>
            <button class="settings-theme-btn active" id="set-theme-light" type="button">Light</button>
            <button class="settings-theme-btn" id="set-theme-system" type="button">System</button>
          </div>
          <label class="settings-toggle-label" style="margin-top:8px;">
            <input type="checkbox" id="set-mute-map-colors">
            <span>Mute map colors</span>
          </label>
        </div>

        <div class="settings-section" id="color-section">
          <div class="settings-label">UI color</div>
          <div class="settings-color-label">Dark mode</div>
          <div class="settings-row settings-color-row" style="margin-bottom:12px;">
              ${darkSwatchesHTML}
              <input type="color" id="set-custom-color" value="#00cc44" title="Custom color">
          </div>
          <div class="settings-color-label">Light mode</div>
          <div class="settings-row settings-color-row">
              ${lightSwatchesHTML}
              <input type="color" id="set-light-custom-color" value="#1a1a1a" title="Custom color">
          </div>
        </div>

        <div class="settings-section">
          <div class="settings-label">Rotation speed</div>
          <div class="settings-row">
            <input type="range" id="set-rotation-speed" min="1" max="20" value="6" step="1">
            <span class="settings-fontsize-val" id="set-rotation-speed-val">3 &deg;/s</span>
          </div>
        </div>

        <div class="settings-section" style="border-bottom:none;">
          <div class="settings-label">Weather overlay opacity</div>
          <div class="settings-row">
            <input type="range" id="set-weather-opacity" min="10" max="100" value="25" step="5">
            <span class="settings-fontsize-val" id="set-weather-opacity-val">25%</span>
          </div>
        </div>
      </div>

      <div class="settings-column">
        <div class="settings-section">
          <div class="settings-label">Aircraft display</div>
          <div class="settings-row" style="margin-bottom:10px;">
            <span class="settings-toggle-label" style="cursor:default;">Font size</span>
            <input type="range" id="set-fontsize" min="8" max="20" value="11" step="1" style="flex:1;">
            <span class="settings-fontsize-val" id="set-fontsize-val">11px</span>
          </div>
          <div class="settings-row" style="margin-bottom:10px;">
            <span class="settings-toggle-label" style="cursor:default;">Trails</span>
            <div class="settings-seg-group">
              <button class="settings-theme-btn" id="set-trail-none" type="button">None</button>
              <button class="settings-theme-btn" id="set-trail-history" type="button">History</button>
              <button class="settings-theme-btn" id="set-trail-velocity" type="button">Velocity</button>
            </div>
          </div>
          <div class="settings-row" id="trail-length-row">
            <span class="settings-toggle-label" style="cursor:default;">History length</span>
            <input type="range" id="set-trail-length" min="60" max="600" value="120" step="60" style="flex:1;">
            <span class="settings-fontsize-val" id="set-trail-length-val">2m</span>
          </div>
          <label class="settings-toggle-label" style="margin-top:8px;">
            <input type="checkbox" id="set-color-by-alt">
            <span>Color by altitude</span>
          </label>
          <label class="settings-toggle-label" style="margin-top:8px;">
            <input type="checkbox" id="set-thick-trails">
            <span>Trail thickness by altitude</span>
          </label>
        </div>

        <div class="settings-section" style="border-bottom:none;">
          <div class="settings-label">Aviation data</div>
          <div class="settings-row settings-grid-2col">
            <label class="settings-toggle-label">
              <input type="checkbox" id="set-airports">
              <span>Airports</span>
            </label>
            <label class="settings-toggle-label">
              <input type="checkbox" id="set-airspace">
              <span>Airspace</span>
            </label>
            <label class="settings-toggle-label">
              <input type="checkbox" id="set-small-airports">
              <span>Small airports</span>
            </label>
            <label class="settings-toggle-label">
              <input type="checkbox" id="set-airspace-edges">
              <span>Airspace edges</span>
            </label>
            <label class="settings-toggle-label">
              <input type="checkbox" id="set-navaids">
              <span>Navaids</span>
            </label>
            <label class="settings-toggle-label">
              <input type="checkbox" id="set-airspace-3d">
              <span>3D airspace</span>
            </label>
            <label class="settings-toggle-label">
              <input type="checkbox" id="set-show-fixes">
              <span>Nav fixes</span>
            </label>
          </div>
        </div>
      </div>
    </div>

    <div class="settings-section" style="border-bottom:none;border-top:1px solid var(--md-outline-variant, var(--settings-border, #ccc));">
      <div class="settings-cred-section" id="cred-drop-zone">
        <div class="settings-label">API credentials</div>
        <div class="settings-hint">
          Drag &amp; drop a <code>creds.json</code> or <code>credentials.json</code> file here, or enter manually.
        </div>
        <div class="settings-color-label" style="margin-top:4px;">OpenSky Network</div>
        <div class="settings-row" style="margin-bottom:6px">
          <span class="settings-field-label">Client ID</span>
          <input type="text" id="set-client-id" class="settings-cred-input"
                 placeholder="client_id" spellcheck="false" autocomplete="off">
        </div>
        <div class="settings-row" style="margin-bottom:10px">
          <span class="settings-field-label">Secret</span>
          <input type="text" id="set-client-secret" class="settings-cred-input"
                 placeholder="client_secret" autocomplete="off">
        </div>
        <div class="settings-color-label">FlightAware AeroAPI</div>
        <div class="settings-row">
          <span class="settings-field-label">API Key</span>
          <input type="text" id="set-fa-api-key" class="settings-cred-input"
                 placeholder="flightaware_api_key" spellcheck="false" autocomplete="off">
        </div>
      </div>
    </div>

    <div class="settings-footer">
      <button type="button" class="scope-btn" id="btn-settings-defaults">Defaults</button>
      <button type="button" class="scope-btn" id="btn-settings-done">Done</button>
    </div>
  `;
}

// ============================================================
// Populate Form from Settings Object
// ============================================================

function populateSettingsForm(container, settings) {
  const s = { ...DEFAULT_SETTINGS, ...settings };

  const fontSlider = container.querySelector('#set-fontsize');
  const fontVal = container.querySelector('#set-fontsize-val');
  fontSlider.value = s.fontSize;
  fontVal.textContent = `${s.fontSize}px`;

  // Theme buttons
  const btnDark = container.querySelector('#set-theme-dark');
  const btnSystem = container.querySelector('#set-theme-system');
  const btnLight = container.querySelector('#set-theme-light');
  btnDark.classList.toggle('active', s.theme === 'dark');
  btnSystem.classList.toggle('active', s.theme === 'system');
  btnLight.classList.toggle('active', s.theme === 'light');

  // Mute map colors
  container.querySelector('#set-mute-map-colors').checked = s.muteMapColors;

  // Dark color swatches
  const darkSwatches = container.querySelectorAll('.dark-color-swatch');
  darkSwatches.forEach(sw => {
    sw.classList.toggle('active', sw.dataset.color === s.darkColor);
  });
  container.querySelector('#set-custom-color').value = s.darkColor;

  // Light color swatches
  const lightSwatches = container.querySelectorAll('.light-color-swatch');
  lightSwatches.forEach(sw => {
    sw.classList.toggle('active', sw.dataset.color === s.lightColor);
  });
  container.querySelector('#set-light-custom-color').value = s.lightColor;

  // Altitude checkboxes
  container.querySelector('#set-color-by-alt').checked = s.colorByAltitude;
  container.querySelector('#set-thick-trails').checked = s.thickTrailsByAltitude;

  // Trail mode buttons
  const trailMode = s.trailMode || 'history';
  container.querySelector('#set-trail-none').classList.toggle('active', trailMode === 'none');
  container.querySelector('#set-trail-history').classList.toggle('active', trailMode === 'history');
  container.querySelector('#set-trail-velocity').classList.toggle('active', trailMode === 'velocity');

  // Trail length
  const trailSlider = container.querySelector('#set-trail-length');
  const trailVal = container.querySelector('#set-trail-length-val');
  trailSlider.value = s.trailLength;
  trailVal.textContent = `${Math.round(s.trailLength / 60)}m`;
  const trailRow = container.querySelector('#trail-length-row');
  if (trailRow) {
    trailRow.style.opacity = trailMode !== 'history' ? '0.4' : '1';
    trailSlider.disabled = trailMode !== 'history';
  }

  // Aviation data
  container.querySelector('#set-airports').checked = s.airportsEnabled;
  container.querySelector('#set-airspace').checked = s.airspaceEnabled;
  container.querySelector('#set-navaids').checked = s.navaidsEnabled;
  container.querySelector('#set-airspace-edges').checked = s.airspaceEdges;
  container.querySelector('#set-airspace-3d').checked = s.airspace3D;
  container.querySelector('#set-small-airports').checked = s.showSmallAirports;
  container.querySelector('#set-show-fixes').checked = s.showFixes;

  // Rotation speed
  const rotSlider = container.querySelector('#set-rotation-speed');
  const rotVal = container.querySelector('#set-rotation-speed-val');
  rotSlider.value = s.rotationSpeed;
  rotVal.textContent = `${s.rotationSpeed} \u00B0/s`;

  // Weather overlay opacity
  const weatherOpacitySlider = container.querySelector('#set-weather-opacity');
  const weatherOpacityVal = container.querySelector('#set-weather-opacity-val');
  if (weatherOpacitySlider) {
    weatherOpacitySlider.value = s.weatherOverlayOpacity;
    weatherOpacityVal.textContent = `${s.weatherOverlayOpacity}%`;
  }

  // Credentials
  container.querySelector('#set-client-id').value = s.openskyClientId || '';
  container.querySelector('#set-client-secret').value = s.openskyClientSecret || '';
  const faKeyEl = container.querySelector('#set-fa-api-key');
  if (faKeyEl) faKeyEl.value = s.flightawareApiKey || '';
}

// ============================================================
// Initialize Settings Panel (wire events + live update)
// ============================================================

/**
 * @param {Object} options
 * @param {HTMLElement} options.container - DOM element containing the settings form
 * @param {Function} options.getSettings - async () => settingsObject
 * @param {Function} options.onChanged - (formSettings) => void, called on every change
 * @param {Function} [options.onClose] - () => void, called when Done/close is triggered
 * @returns {{ populate: (settings) => void }}
 */
function initSettingsPanel(options) {
  const { container, getSettings, onChanged, onClose, onDefaults } = options;

  // Inject shared CSS into this document
  injectSettingsCSS(container.ownerDocument);

  const fontSlider = container.querySelector('#set-fontsize');
  const fontVal = container.querySelector('#set-fontsize-val');
  const btnDark = container.querySelector('#set-theme-dark');
  const btnSystem = container.querySelector('#set-theme-system');
  const btnLight = container.querySelector('#set-theme-light');
  const muteMapColors = container.querySelector('#set-mute-map-colors');
  const darkSwatches = container.querySelectorAll('.dark-color-swatch');
  const customColor = container.querySelector('#set-custom-color');
  const lightSwatches = container.querySelectorAll('.light-color-swatch');
  const lightCustomColor = container.querySelector('#set-light-custom-color');
  const colorByAlt = container.querySelector('#set-color-by-alt');
  const thickTrails = container.querySelector('#set-thick-trails');
  const btnTrailNone = container.querySelector('#set-trail-none');
  const btnTrailHistory = container.querySelector('#set-trail-history');
  const btnTrailVelocity = container.querySelector('#set-trail-velocity');
  const trailLengthSlider = container.querySelector('#set-trail-length');
  const trailLengthVal = container.querySelector('#set-trail-length-val');
  const trailLengthRow = container.querySelector('#trail-length-row');
  const airportsEnabled = container.querySelector('#set-airports');
  const airspaceEnabled = container.querySelector('#set-airspace');
  const navaidsEnabled = container.querySelector('#set-navaids');
  const airspaceEdges = container.querySelector('#set-airspace-edges');
  const airspace3D = container.querySelector('#set-airspace-3d');
  const smallAirports = container.querySelector('#set-small-airports');
  const showFixes = container.querySelector('#set-show-fixes');
  const rotSlider = container.querySelector('#set-rotation-speed');
  const rotVal = container.querySelector('#set-rotation-speed-val');
  const weatherOpacitySlider = container.querySelector('#set-weather-opacity');
  const weatherOpacityVal = container.querySelector('#set-weather-opacity-val');
  const clientId = container.querySelector('#set-client-id');
  const clientSecret = container.querySelector('#set-client-secret');
  const faApiKey = container.querySelector('#set-fa-api-key');

  // Current form state
  let formState = { ...DEFAULT_SETTINGS };

  function readForm() {
    return {
      fontSize: parseInt(fontSlider.value),
      theme: formState.theme,
      muteMapColors: muteMapColors.checked,
      darkColor: formState.darkColor,
      lightColor: formState.lightColor,
      colorByAltitude: colorByAlt.checked,
      thickTrailsByAltitude: thickTrails.checked,
      trailMode: formState.trailMode,
      trailLength: parseInt(trailLengthSlider.value),
      airportsEnabled: airportsEnabled.checked,
      airspaceEnabled: airspaceEnabled.checked,
      navaidsEnabled: navaidsEnabled.checked,
      airspaceEdges: airspaceEdges.checked,
      airspace3D: airspace3D.checked,
      showSmallAirports: smallAirports.checked,
      showFixes: showFixes.checked,
      rotationSpeed: parseInt(rotSlider.value),
      weatherOverlayOpacity: parseInt(weatherOpacitySlider.value),
      openskyClientId: clientId.value.trim(),
      openskyClientSecret: clientSecret.value,
      flightawareApiKey: faApiKey ? faApiKey.value.trim() : '',
    };
  }

  function broadcast() {
    formState = readForm();
    onChanged(formState);
  }

  function updateDarkSwatchActive(selectedColor) {
    darkSwatches.forEach(sw => {
      sw.classList.toggle('active', sw.dataset.color === selectedColor);
    });
  }

  function updateLightSwatchActive(selectedColor) {
    lightSwatches.forEach(sw => {
      sw.classList.toggle('active', sw.dataset.color === selectedColor);
    });
  }

  // Debounce helper for continuous inputs (slider, color picker)
  function debounce(fn, ms) {
    let timer;
    return function(...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), ms);
    };
  }

  const debouncedBroadcast = debounce(broadcast, 80);

  // --- Font size slider ---
  fontSlider.addEventListener('input', () => {
    fontVal.textContent = `${fontSlider.value}px`;
    debouncedBroadcast();
  });

  // --- Theme toggle ---
  function setThemeButton(theme) {
    formState.theme = theme;
    btnDark.classList.toggle('active', theme === 'dark');
    btnSystem.classList.toggle('active', theme === 'system');
    btnLight.classList.toggle('active', theme === 'light');
    broadcast();
  }

  btnDark.addEventListener('click', () => setThemeButton('dark'));
  btnSystem.addEventListener('click', () => setThemeButton('system'));
  btnLight.addEventListener('click', () => setThemeButton('light'));

  muteMapColors.addEventListener('change', broadcast);

  // --- Dark color swatches ---
  darkSwatches.forEach(sw => {
    sw.addEventListener('click', () => {
      formState.darkColor = sw.dataset.color;
      updateDarkSwatchActive(sw.dataset.color);
      customColor.value = sw.dataset.color;
      broadcast();
    });
  });

  // --- Dark custom color picker ---
  customColor.addEventListener('input', () => {
    formState.darkColor = customColor.value;
    updateDarkSwatchActive(''); // deselect all presets
    debouncedBroadcast();
  });

  // --- Light color swatches ---
  lightSwatches.forEach(sw => {
    sw.addEventListener('click', () => {
      formState.lightColor = sw.dataset.color;
      updateLightSwatchActive(sw.dataset.color);
      lightCustomColor.value = sw.dataset.color;
      broadcast();
    });
  });

  // --- Light custom color picker ---
  lightCustomColor.addEventListener('input', () => {
    formState.lightColor = lightCustomColor.value;
    updateLightSwatchActive(''); // deselect all presets
    debouncedBroadcast();
  });

  // --- Altitude checkboxes ---
  colorByAlt.addEventListener('change', () => {
    broadcast();
  });

  thickTrails.addEventListener('change', () => {
    broadcast();
  });

  function setTrailMode(mode) {
    formState.trailMode = mode;
    btnTrailNone.classList.toggle('active', mode === 'none');
    btnTrailHistory.classList.toggle('active', mode === 'history');
    btnTrailVelocity.classList.toggle('active', mode === 'velocity');
    trailLengthRow.style.opacity = mode !== 'history' ? '0.4' : '1';
    trailLengthSlider.disabled = mode !== 'history';
    broadcast();
  }

  btnTrailNone.addEventListener('click', () => setTrailMode('none'));
  btnTrailHistory.addEventListener('click', () => setTrailMode('history'));
  btnTrailVelocity.addEventListener('click', () => setTrailMode('velocity'));

  trailLengthSlider.addEventListener('input', () => {
    trailLengthVal.textContent = `${Math.round(trailLengthSlider.value / 60)}m`;
    debouncedBroadcast();
  });

  airportsEnabled.addEventListener('change', broadcast);
  airspaceEnabled.addEventListener('change', broadcast);
  navaidsEnabled.addEventListener('change', broadcast);
  airspaceEdges.addEventListener('change', broadcast);
  airspace3D.addEventListener('change', broadcast);
  smallAirports.addEventListener('change', broadcast);
  showFixes.addEventListener('change', broadcast);

  // --- Rotation speed slider ---
  rotSlider.addEventListener('input', () => {
    rotVal.textContent = `${rotSlider.value} \u00B0/s`;
    debouncedBroadcast();
  });

  // --- Weather overlay opacity slider ---
  weatherOpacitySlider.addEventListener('input', () => {
    weatherOpacityVal.textContent = `${weatherOpacitySlider.value}%`;
    debouncedBroadcast();
  });

  // --- Credentials (fire on blur/change, not every keystroke) ---
  clientId.addEventListener('change', broadcast);
  clientSecret.addEventListener('change', broadcast);
  if (faApiKey) faApiKey.addEventListener('change', broadcast);

  // --- Footer buttons ---
  const btnDone = container.querySelector('#btn-settings-done');
  const btnDefaults = container.querySelector('#btn-settings-defaults');

  if (btnDone && onClose) {
    btnDone.addEventListener('click', onClose);
  }

  if (btnDefaults && onDefaults) {
    btnDefaults.addEventListener('click', onDefaults);
  }

  // --- Credential JSON drag-and-drop ---
  const credDropZone = container.querySelector('#cred-drop-zone');
  if (credDropZone) {
    let dragCounter = 0;

    credDropZone.addEventListener('dragenter', (e) => {
      e.preventDefault();
      dragCounter++;
      credDropZone.classList.add('drag-over');
    });

    credDropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
    });

    credDropZone.addEventListener('dragleave', () => {
      dragCounter--;
      if (dragCounter <= 0) {
        dragCounter = 0;
        credDropZone.classList.remove('drag-over');
      }
    });

    credDropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dragCounter = 0;
      credDropZone.classList.remove('drag-over');

      const file = e.dataTransfer.files && e.dataTransfer.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = () => {
        try {
          const json = JSON.parse(reader.result);
          const id = json.client_id || json.clientId || json.openskyClientId || '';
          const secret = json.client_secret || json.clientSecret || json.openskyClientSecret || '';
          const faKey = json.flightaware_api_key || json.flightawareApiKey || '';
          if (id) clientId.value = id;
          if (secret) clientSecret.value = secret;
          if (faKey && faApiKey) faApiKey.value = faKey;
          if (id || secret || faKey) broadcast();
        } catch (_) {
          // Silently ignore non-JSON files
        }
      };
      reader.readAsText(file);
    });
  }

  // --- Load initial settings ---
  async function loadAndPopulate() {
    const settings = await getSettings();
    formState = { ...DEFAULT_SETTINGS, ...settings };
    populateSettingsForm(container, formState);
  }

  loadAndPopulate();

  // Return controller
  return {
    populate(settings) {
      formState = { ...DEFAULT_SETTINGS, ...settings };
      populateSettingsForm(container, formState);
    },
  };
}
