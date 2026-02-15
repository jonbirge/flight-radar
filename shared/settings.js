// Shared settings panel: HTML template, form logic, and live-update wiring.
// Loaded by both Electron settings window and web inline modal.
// Does NOT depend on Cesium, shared/config.js, or shared/radar.js.

'use strict';

// ============================================================
// Constants
// ============================================================

const SETTINGS_DEFAULTS = {
  fontSize: 12,
  theme: 'light',
  darkColor: '#00cc44',
  lightColor: '#1a1a1a',
  colorByAltitude: true,
  thickTrailsByAltitude: false,
  airspaceEdges: true,
  airspace3D: false,
  showSmallAirports: false,
  showFixes: false,
  showVelocityVector: false,
  radarEnabled: false,
  mapLayer: 'carto',
  trailLength: 120,
  rotationSpeed: 6,
  openskyClientId: '',
  openskyClientSecret: '',
};

const COLOR_PRESETS = [
  { color: '#00cc44', label: 'Phosphor Green' },
  { color: '#00cccc', label: 'Cyan' },
  { color: '#cc8800', label: 'Amber' },
  { color: '#cc4444', label: 'Red' },
  { color: '#8888ff', label: 'Lavender' },
  { color: '#cccccc', label: 'White' },
  { color: '#ff44cc', label: 'Hot Pink' },
];

const LIGHT_COLOR_PRESETS = [
  { color: '#1a1a1a', label: 'Charcoal' },
  { color: '#1a5276', label: 'Steel Blue' },
  { color: '#117864', label: 'Teal' },
  { color: '#922b21', label: 'Brick Red' },
  { color: '#6c3483', label: 'Royal Purple' },
  { color: '#1e8449', label: 'Emerald' },
  { color: '#b9770e', label: 'Goldenrod' },
];

// ============================================================
// Inline CSS (structural, shared by both platforms)
// ============================================================

const SETTINGS_CSS = `
.settings-section {
  padding: 14px 16px;
  border-bottom: 1px solid var(--settings-border, #ccc);
}

.settings-label {
  font-size: 12px;
  letter-spacing: 1.5px;
  color: var(--settings-label-color, #666);
  margin-bottom: 8px;
  text-transform: uppercase;
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
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 2px solid transparent;
  cursor: pointer;
  padding: 0;
  transition: border-color 0.2s, transform 0.1s;
}
.color-swatch:hover { transform: scale(1.15); }
.color-swatch.active {
  border-color: var(--swatch-active-border, #333);
}

#set-custom-color,
#set-light-custom-color {
  width: 28px;
  height: 28px;
  border: 1px solid var(--settings-border, #ccc);
  border-radius: 4px;
  background: transparent;
  cursor: pointer;
  padding: 0;
}

.settings-hint {
  font-size: 10px;
  color: var(--settings-label-color, #666);
  letter-spacing: 0.5px;
  margin-bottom: 8px;
}

.settings-field-label {
  font-size: 10px;
  letter-spacing: 1px;
  color: var(--settings-label-color, #666);
  width: 65px;
  flex-shrink: 0;
  text-transform: uppercase;
}

.settings-cred-input {
  flex: 1;
  padding: 3px 6px;
  font-size: 12px;
  border: 1px solid var(--settings-border, #ccc);
  border-radius: 3px;
  background: var(--settings-input-bg, #fff);
  color: var(--settings-input-color, #000);
  font-family: system-ui, -apple-system, sans-serif;
}

.settings-cred-section {
  transition: background 0.15s, border-color 0.15s;
  border: 2px dashed transparent;
  border-radius: 6px;
  margin: -6px;
  padding: 6px;
}
.settings-cred-section.drag-over {
  border-color: var(--settings-label-color, #666);
  background: var(--settings-btn-hover-bg, rgba(0,0,0,0.04));
}

.settings-theme-btn {
  padding: 5px 14px;
  font-size: 11px;
  letter-spacing: 1px;
  cursor: pointer;
  border: 1px solid var(--settings-border, #ccc);
  border-radius: 3px;
  background: var(--settings-btn-bg, #f0f0f0);
  color: var(--settings-btn-color, #333);
  text-transform: uppercase;
  font-weight: 600;
  transition: background 0.15s, border-color 0.15s;
}
.settings-theme-btn:hover {
  background: var(--settings-btn-hover-bg, #e0e0e0);
}
.settings-theme-btn.active {
  background: var(--settings-btn-active-bg, #333);
  color: var(--settings-btn-active-color, #fff);
  border-color: var(--settings-btn-active-border, #333);
}


.settings-toggle-label {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  font-size: 12px;
  color: var(--settings-text-color, #333);
}

.settings-fontsize-val {
  font-size: 12px;
  min-width: 32px;
  color: var(--settings-text-color, #333);
}

.settings-grid-2col {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.settings-color-label {
  font-size: 11px;
  letter-spacing: 0.5px;
  color: var(--settings-label-color, #666);
  margin-bottom: 6px;
  text-transform: uppercase;
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
    <div class="settings-section">
      <div class="settings-label">DISPLAY MODE</div>
      <div class="settings-row">
        <button class="settings-theme-btn" id="set-theme-dark" type="button">DARK</button>
        <button class="settings-theme-btn" id="set-theme-system" type="button">SYSTEM</button>
        <button class="settings-theme-btn active" id="set-theme-light" type="button">LIGHT</button>
      </div>
    </div>

    <div class="settings-section" id="color-section">
      <div class="settings-label">UI COLOR</div>
      <div class="settings-color-label">Dark Mode</div>
      <div class="settings-row settings-color-row" style="margin-bottom:12px;">
          ${darkSwatchesHTML}
          <input type="color" id="set-custom-color" value="#00cc44" title="Custom color">
      </div>
      <div class="settings-color-label">Light Mode</div>
      <div class="settings-row settings-color-row">
          ${lightSwatchesHTML}
          <input type="color" id="set-light-custom-color" value="#1a1a1a" title="Custom color">
      </div>
    </div>

    <div class="settings-section">
      <div class="settings-label">AIRCRAFT DISPLAY</div>
      <div class="settings-row" style="margin-bottom:8px;">
        <span class="settings-toggle-label" style="cursor:default;">Font size</span>
        <input type="range" id="set-fontsize" min="8" max="20" value="11" step="1" style="flex:1;">
        <span class="settings-fontsize-val" id="set-fontsize-val">11px</span>
      </div>
      <div class="settings-row" id="trail-length-row">
        <span class="settings-toggle-label" style="cursor:default;">History length</span>
        <input type="range" id="set-trail-length" min="60" max="600" value="120" step="60" style="flex:1;">
        <span class="settings-fontsize-val" id="set-trail-length-val">2m</span>
      </div>
      <label class="settings-toggle-label" style="margin-top:8px;">
        <input type="checkbox" id="set-velocity-vector">
        <span>Velocity vector trails</span>
      </label>
      <label class="settings-toggle-label" style="margin-top:4px;">
        <input type="checkbox" id="set-color-by-alt">
        <span>Color by altitude</span>
      </label>
      <label class="settings-toggle-label" style="margin-top:4px;">
        <input type="checkbox" id="set-thick-trails">
        <span>Trail thickness by altitude</span>
      </label>
    </div>

    <div class="settings-section">
      <div class="settings-label">LEVEL OF DETAIL</div>
      <div class="settings-row settings-grid-2col">
        <label class="settings-toggle-label">
          <input type="checkbox" id="set-airspace-edges">
          <span>Show airspace edges</span>
        </label>
        <label class="settings-toggle-label">
          <input type="checkbox" id="set-airspace-3d">
          <span>3D airspace</span>
        </label>
        <label class="settings-toggle-label">
          <input type="checkbox" id="set-small-airports">
          <span>Show small airports</span>
        </label>
        <label class="settings-toggle-label">
          <input type="checkbox" id="set-show-fixes">
          <span>Include waypoint fixes</span>
        </label>
      </div>
    </div>

    <div class="settings-section">
      <div class="settings-label">ROTATION SPEED</div>
      <div class="settings-row">
        <input type="range" id="set-rotation-speed" min="1" max="20" value="6" step="1">
        <span class="settings-fontsize-val" id="set-rotation-speed-val">3 &deg;/s</span>
      </div>
    </div>

    <div class="settings-section" style="border-bottom:none;">
      <div class="settings-cred-section" id="cred-drop-zone">
        <div class="settings-label">OPENSKY NETWORK CREDENTIALS</div>
        <div class="settings-hint">
          OAuth2 Client ID &amp; Secret from your OpenSky account. Leave blank for anonymous access (lower rate limits).
          You can also drag &amp; drop a credentials JSON file here.
        </div>
        <div class="settings-row" style="margin-bottom:6px">
          <span class="settings-field-label">CLIENT ID</span>
          <input type="text" id="set-client-id" class="settings-cred-input"
                 placeholder="client_id" spellcheck="false" autocomplete="off">
        </div>
        <div class="settings-row">
          <span class="settings-field-label">SECRET</span>
          <input type="text" id="set-client-secret" class="settings-cred-input"
                 placeholder="client_secret" autocomplete="off">
        </div>
      </div>
    </div>
  `;
}

// ============================================================
// Populate Form from Settings Object
// ============================================================

function populateSettingsForm(container, settings) {
  const s = { ...SETTINGS_DEFAULTS, ...settings };

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
  container.querySelector('#set-velocity-vector').checked = s.showVelocityVector;

  // Trail length
  const trailSlider = container.querySelector('#set-trail-length');
  const trailVal = container.querySelector('#set-trail-length-val');
  trailSlider.value = s.trailLength;
  trailVal.textContent = `${Math.round(s.trailLength / 60)}m`;
  const trailRow = container.querySelector('#trail-length-row');
  if (trailRow) {
    trailRow.style.opacity = s.showVelocityVector ? '0.4' : '1';
    trailSlider.disabled = s.showVelocityVector;
  }

  // Level of detail
  container.querySelector('#set-airspace-edges').checked = s.airspaceEdges;
  container.querySelector('#set-airspace-3d').checked = s.airspace3D;
  container.querySelector('#set-small-airports').checked = s.showSmallAirports;
  container.querySelector('#set-show-fixes').checked = s.showFixes;

  // Rotation speed
  const rotSlider = container.querySelector('#set-rotation-speed');
  const rotVal = container.querySelector('#set-rotation-speed-val');
  rotSlider.value = s.rotationSpeed;
  rotVal.textContent = `${s.rotationSpeed} \u00B0/s`;

  // Credentials
  container.querySelector('#set-client-id').value = s.openskyClientId || '';
  container.querySelector('#set-client-secret').value = s.openskyClientSecret || '';
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
  const { container, getSettings, onChanged, onClose } = options;

  // Inject shared CSS into this document
  injectSettingsCSS(container.ownerDocument);

  const fontSlider = container.querySelector('#set-fontsize');
  const fontVal = container.querySelector('#set-fontsize-val');
  const btnDark = container.querySelector('#set-theme-dark');
  const btnSystem = container.querySelector('#set-theme-system');
  const btnLight = container.querySelector('#set-theme-light');
  const darkSwatches = container.querySelectorAll('.dark-color-swatch');
  const customColor = container.querySelector('#set-custom-color');
  const lightSwatches = container.querySelectorAll('.light-color-swatch');
  const lightCustomColor = container.querySelector('#set-light-custom-color');
  const colorByAlt = container.querySelector('#set-color-by-alt');
  const thickTrails = container.querySelector('#set-thick-trails');
  const velocityVector = container.querySelector('#set-velocity-vector');
  const trailLengthSlider = container.querySelector('#set-trail-length');
  const trailLengthVal = container.querySelector('#set-trail-length-val');
  const trailLengthRow = container.querySelector('#trail-length-row');
  const airspaceEdges = container.querySelector('#set-airspace-edges');
  const airspace3D = container.querySelector('#set-airspace-3d');
  const smallAirports = container.querySelector('#set-small-airports');
  const showFixes = container.querySelector('#set-show-fixes');
  const rotSlider = container.querySelector('#set-rotation-speed');
  const rotVal = container.querySelector('#set-rotation-speed-val');
  const clientId = container.querySelector('#set-client-id');
  const clientSecret = container.querySelector('#set-client-secret');

  // Current form state
  let formState = { ...SETTINGS_DEFAULTS };

  function readForm() {
    return {
      fontSize: parseInt(fontSlider.value),
      theme: formState.theme,
      darkColor: formState.darkColor,
      lightColor: formState.lightColor,
      colorByAltitude: colorByAlt.checked,
      thickTrailsByAltitude: thickTrails.checked,
      showVelocityVector: velocityVector.checked,
      trailLength: parseInt(trailLengthSlider.value),
      airspaceEdges: airspaceEdges.checked,
      airspace3D: airspace3D.checked,
      showSmallAirports: smallAirports.checked,
      showFixes: showFixes.checked,
      rotationSpeed: parseInt(rotSlider.value),
      openskyClientId: clientId.value.trim(),
      openskyClientSecret: clientSecret.value,
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

  velocityVector.addEventListener('change', () => {
    trailLengthRow.style.opacity = velocityVector.checked ? '0.4' : '1';
    trailLengthSlider.disabled = velocityVector.checked;
    broadcast();
  });

  trailLengthSlider.addEventListener('input', () => {
    trailLengthVal.textContent = `${Math.round(trailLengthSlider.value / 60)}m`;
    debouncedBroadcast();
  });

  airspaceEdges.addEventListener('change', () => {
    broadcast();
  });

  airspace3D.addEventListener('change', () => {
    broadcast();
  });

  smallAirports.addEventListener('change', () => {
    broadcast();
  });

  showFixes.addEventListener('change', () => {
    broadcast();
  });

  // --- Rotation speed slider ---
  rotSlider.addEventListener('input', () => {
    rotVal.textContent = `${rotSlider.value} \u00B0/s`;
    debouncedBroadcast();
  });

  // --- Credentials (fire on blur/change, not every keystroke) ---
  clientId.addEventListener('change', broadcast);
  clientSecret.addEventListener('change', broadcast);

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
          if (id) clientId.value = id;
          if (secret) clientSecret.value = secret;
          if (id || secret) broadcast();
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
    formState = { ...SETTINGS_DEFAULTS, ...settings };
    populateSettingsForm(container, formState);
  }

  loadAndPopulate();

  // Return controller
  return {
    populate(settings) {
      formState = { ...SETTINGS_DEFAULTS, ...settings };
      populateSettingsForm(container, formState);
    },
  };
}
