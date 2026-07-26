// Settings panel: HTML template, form logic, and live-update wiring.
// Does NOT depend on Cesium, config.js, or radar.js.

// ============================================================
// Constants
// ============================================================

// Use DEFAULT_SETTINGS from defaults.js (loaded before this script)

const COLOR_PRESETS = window.COLOR_PRESETS = [
  { color: '#cccccc', label: 'White' },
  { color: '#00cccc', label: 'Cyan' },
  { color: '#cc8800', label: 'Amber' },
  { color: '#00cc44', label: 'Phosphor Green' },
  { color: '#6c7f70', label: 'Sage' },
];

const LIGHT_COLOR_PRESETS = window.LIGHT_COLOR_PRESETS = [
  { color: '#1a1a1a', label: 'Black' },
  { color: '#2563eb', label: 'Cobalt' },
  { color: '#0d9488', label: 'Teal' },
  { color: '#dc2626', label: 'Crimson' },
  { color: '#7c3aed', label: 'Violet' },
];

// ============================================================
// Inline CSS (structural, shared by both platforms)
// ============================================================

const SETTINGS_CSS = window.SETTINGS_CSS = `
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

.settings-cred-details {
  border: none;
  margin: 0;
  padding: 0;
}
.settings-cred-details > summary {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  list-style: none;
  font-size: 15px;
  font-weight: 600;
  color: var(--md-on-surface-variant, var(--settings-label-color, #666));
  font-family: 'Roboto Flex', system-ui, -apple-system, sans-serif;
  user-select: none;
}
.settings-cred-details > summary::-webkit-details-marker {
  display: none;
}
.settings-cred-details > summary::before {
  content: '\\25B6';
  font-size: 10px;
  transition: transform 0.15s ease;
  display: inline-block;
}
.settings-cred-details[open] > summary::before {
  transform: rotate(90deg);
}
.settings-cred-details > .settings-cred-body {
  padding-top: 10px;
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
  position: sticky;
  bottom: 0;
  background: var(--md-surface-container-solid, var(--md-surface, #f0f0f0));
  z-index: 5;
}
/* Footer buttons use .scope-btn from styles.css or settings.css */
.settings-footer-left {
  display: flex;
  gap: 8px;
}

/* Destructive footer buttons (Defaults, Import) — red hue */
.scope-btn-danger {
  background: #4a1414;
  color: #ff8a80;
}
.scope-btn-danger:hover {
  background: #5c1a1a;
}
.scope-btn-danger:active {
  background: #6b1f1f;
}
.theme-light .scope-btn-danger {
  background: #fdecea;
  color: #c62828;
}
.theme-light .scope-btn-danger:hover {
  background: #fbdad7;
}
.theme-light .scope-btn-danger:active {
  background: #f8c9c5;
}

@media (max-width: 767px) {
  .settings-columns {
    flex-direction: column;
  }
  .settings-column:first-child {
    border-right: none;
    border-bottom: 1px solid var(--md-outline-variant, var(--settings-border, #ccc));
  }
  /* Hide 3D-only options (rotation speed, 3D airspace) — mobile is always 2D */
  .settings-section:has(#set-rotation-speed),
  label:has(#set-airspace-3d) {
    display: none;
  }
}
`;

let settingsCssInjected = false;

function injectSettingsCSS(doc) {
  if (settingsCssInjected) return;
  const style = doc.createElement('style');
  style.textContent = SETTINGS_CSS;
  doc.head.appendChild(style);
  settingsCssInjected = true;
}

// (HTML template is now in settings.html — no longer generated in JS)

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

  // Dark color swatches — apply saved preset overrides before checking active
  const darkSwatches = container.querySelectorAll('.dark-color-swatch');
  if (s.darkColorPresets) {
    darkSwatches.forEach((sw, i) => {
      if (s.darkColorPresets[i]) {
        sw.dataset.color = s.darkColorPresets[i];
        sw.style.background = s.darkColorPresets[i];
      }
    });
  }
  darkSwatches.forEach(sw => {
    sw.classList.toggle('active', sw.dataset.color === s.darkColor);
  });
  container.querySelector('#set-custom-color').value = s.darkColor;

  // Light color swatches — apply saved preset overrides before checking active
  const lightSwatches = container.querySelectorAll('.light-color-swatch');
  if (s.lightColorPresets) {
    lightSwatches.forEach((sw, i) => {
      if (s.lightColorPresets[i]) {
        sw.dataset.color = s.lightColorPresets[i];
        sw.style.background = s.lightColorPresets[i];
      }
    });
  }
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

  // Radar thinning
  const radarThinningEl = container.querySelector('#set-radar-thinning');
  if (radarThinningEl) radarThinningEl.checked = s.radarThinning;

  // 3D turbulence
  const turb3dEl = container.querySelector('#set-turb-3d');
  if (turb3dEl) turb3dEl.checked = s.turb3D;

  // Airport delays
  const airportDelaysEl = container.querySelector('#set-airport-delays');
  if (airportDelaysEl) airportDelaysEl.checked = s.airportDelaysEnabled;

  // Exaggerate altitudes
  const exAltSlider = container.querySelector('#set-exaggerate-alt');
  const exAltVal = container.querySelector('#set-exaggerate-alt-val');
  if (exAltSlider) {
    // Migrate old boolean: false → 1, true → 10
    const v = s.exaggerateAltitudes === true ? 10 : (s.exaggerateAltitudes === false ? 1 : (s.exaggerateAltitudes || 1));
    exAltSlider.value = v;
    if (exAltVal) exAltVal.textContent = `${Number.isInteger(v) ? v : v.toFixed(1)}\u00D7`;
  }

  // Credentials
  container.querySelector('#set-client-id').value = s.openskyClientId || '';
  container.querySelector('#set-client-secret').value = s.openskyClientSecret || '';
  const faKeyEl = container.querySelector('#set-fa-api-key');
  if (faKeyEl) faKeyEl.value = s.flightawareApiKey || '';

  // Credentials collapsed/expanded
  const credDetails = container.querySelector('#cred-details');
  if (credDetails) credDetails.open = !!s.credentialsExpanded;
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
 * @param {Function} [options.onFontSizePreview] - (size) => void, lightweight callback during font slider drag
 * @returns {{ populate: (settings) => void }}
 */
function initSettingsPanel(options) {
  const { container, getSettings, onChanged, onClose, onDefaults, onFontSizePreview, onRotationSpeedPreview, onWeatherOpacityPreview, onAltGainPreview, onQuietSave, onExport, onImport } = options;

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

  const showFixes = container.querySelector('#set-show-fixes');
  const rotSlider = container.querySelector('#set-rotation-speed');
  const rotVal = container.querySelector('#set-rotation-speed-val');
  const weatherOpacitySlider = container.querySelector('#set-weather-opacity');
  const weatherOpacityVal = container.querySelector('#set-weather-opacity-val');
  const radarThinning = container.querySelector('#set-radar-thinning');
  const turb3d = container.querySelector('#set-turb-3d');
  const airportDelays = container.querySelector('#set-airport-delays');
  const exaggerateAlt = container.querySelector('#set-exaggerate-alt');
  const exaggerateAltVal = container.querySelector('#set-exaggerate-alt-val');
  const clientId = container.querySelector('#set-client-id');
  const clientSecret = container.querySelector('#set-client-secret');
  const faApiKey = container.querySelector('#set-fa-api-key');
  const credDetails = container.querySelector('#cred-details');

  // Current form state
  let formState = { ...DEFAULT_SETTINGS };

  function readForm() {
    // Derive theme and trail mode from DOM button active states so that
    // readForm() never returns stale values from the internal formState.
    // This fixes settings not loading correctly after a reset to defaults
    // or an import, where populateSettingsForm() updates the DOM but
    // formState is not refreshed.
    const theme = btnDark.classList.contains('active') ? 'dark'
      : btnLight.classList.contains('active') ? 'light'
      : 'system';
    const trailMode = btnTrailNone.classList.contains('active') ? 'none'
      : btnTrailVelocity.classList.contains('active') ? 'velocity'
      : 'history';

    return {
      fontSize: parseInt(fontSlider.value),
      theme,
      muteMapColors: muteMapColors.checked,
      darkColor: customColor.value,
      lightColor: lightCustomColor.value,
      darkColorPresets: Array.from(darkSwatches).map(sw => sw.dataset.color),
      lightColorPresets: Array.from(lightSwatches).map(sw => sw.dataset.color),
      colorByAltitude: colorByAlt.checked,
      thickTrailsByAltitude: thickTrails.checked,
      trailMode,
      trailLength: parseInt(trailLengthSlider.value),
      airportsEnabled: airportsEnabled.checked,
      airspaceEnabled: airspaceEnabled.checked,
      navaidsEnabled: navaidsEnabled.checked,
      airspaceEdges: airspaceEdges.checked,
      airspace3D: airspace3D.checked,

      showFixes: showFixes.checked,
      rotationSpeed: parseInt(rotSlider.value),
      weatherOverlayOpacity: parseInt(weatherOpacitySlider.value),
      radarThinning: radarThinning ? radarThinning.checked : true,
      turb3D: turb3d ? turb3d.checked : false,
      airportDelaysEnabled: airportDelays ? airportDelays.checked : false,
      exaggerateAltitudes: exaggerateAlt ? parseFloat(exaggerateAlt.value) : 1,
      openskyClientId: clientId.value.trim(),
      openskyClientSecret: clientSecret.value,
      flightawareApiKey: faApiKey ? faApiKey.value.trim() : '',
      credentialsExpanded: credDetails ? credDetails.open : false,
    };
  }

  function broadcast() {
    formState = readForm();
    onChanged(formState);
  }

  // Save settings without triggering a full renderer reload (used after slider preview)
  function quietBroadcast() {
    formState = readForm();
    if (onQuietSave) {
      onQuietSave(formState);
    } else {
      onChanged(formState);
    }
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
    if (onFontSizePreview) {
      onFontSizePreview(parseInt(fontSlider.value));
    } else {
      debouncedBroadcast();
    }
  });
  fontSlider.addEventListener('change', () => {
    quietBroadcast();
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

  // --- Dark custom color picker (overrides active preset) ---
  customColor.addEventListener('input', () => {
    formState.darkColor = customColor.value;
    const activeSwatch = container.querySelector('.dark-color-swatch.active');
    if (activeSwatch) {
      activeSwatch.dataset.color = customColor.value;
      activeSwatch.style.background = customColor.value;
    }
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

  // --- Light custom color picker (overrides active preset) ---
  lightCustomColor.addEventListener('input', () => {
    formState.lightColor = lightCustomColor.value;
    const activeSwatch = container.querySelector('.light-color-swatch.active');
    if (activeSwatch) {
      activeSwatch.dataset.color = lightCustomColor.value;
      activeSwatch.style.background = lightCustomColor.value;
    }
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

  showFixes.addEventListener('change', broadcast);

  // --- Rotation speed slider ---
  rotSlider.addEventListener('input', () => {
    rotVal.textContent = `${rotSlider.value} \u00B0/s`;
    if (onRotationSpeedPreview) {
      onRotationSpeedPreview(parseInt(rotSlider.value));
    } else {
      debouncedBroadcast();
    }
  });
  rotSlider.addEventListener('change', () => {
    quietBroadcast();
  });

  // --- Weather overlay opacity slider ---
  weatherOpacitySlider.addEventListener('input', () => {
    weatherOpacityVal.textContent = `${weatherOpacitySlider.value}%`;
    if (onWeatherOpacityPreview) {
      onWeatherOpacityPreview(parseInt(weatherOpacitySlider.value));
    } else {
      debouncedBroadcast();
    }
  });
  weatherOpacitySlider.addEventListener('change', () => {
    quietBroadcast();
  });

  // --- Radar thinning toggle ---
  if (radarThinning) radarThinning.addEventListener('change', broadcast);

  // --- 3D turbulence toggle ---
  if (turb3d) turb3d.addEventListener('change', broadcast);

  // --- Airport delays toggle ---
  if (airportDelays) airportDelays.addEventListener('change', broadcast);

  // --- Exaggerate altitudes (height gain) slider ---
  if (exaggerateAlt) {
    exaggerateAlt.addEventListener('input', () => {
      const v = parseFloat(exaggerateAlt.value);
      if (exaggerateAltVal) exaggerateAltVal.textContent = `${Number.isInteger(v) ? v : v.toFixed(1)}\u00D7`;
      if (onAltGainPreview) {
        onAltGainPreview(v);
      } else {
        debouncedBroadcast();
      }
    });
    exaggerateAlt.addEventListener('change', () => {
      quietBroadcast();
    });
  }

  // --- Credentials (fire on blur/change, not every keystroke) ---
  clientId.addEventListener('change', broadcast);
  clientSecret.addEventListener('change', broadcast);
  if (faApiKey) faApiKey.addEventListener('change', broadcast);

  // --- Credentials collapse/expand ---
  if (credDetails) {
    credDetails.addEventListener('toggle', broadcast);
  }

  // --- Footer buttons ---
  const btnDone = container.querySelector('#btn-settings-done');
  const btnDefaults = container.querySelector('#btn-settings-defaults');

  if (btnDone && onClose) {
    btnDone.addEventListener('click', onClose);
  }

  if (btnDefaults && onDefaults) {
    btnDefaults.addEventListener('click', onDefaults);
  }

  // --- Footer: export/import buttons ---
  const btnExport = container.querySelector('#btn-settings-export');
  const btnImport = container.querySelector('#btn-settings-import');

  if (btnExport && onExport) {
    btnExport.addEventListener('click', onExport);
  }

  if (btnImport && onImport) {
    btnImport.addEventListener('click', onImport);
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

window.initSettingsPanel = initSettingsPanel;
window.populateSettingsForm = populateSettingsForm;

export {}
