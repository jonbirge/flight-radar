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
  colorByAltitude: true,
  thickTrailsByAltitude: false,
  airspaceEdges: true,
  showSmallAirports: false,
  showFixes: false,
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
  font-size: 10px;
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
  box-shadow: 0 0 6px var(--swatch-active-shadow, rgba(0,0,0,0.2));
}

#set-custom-color {
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
  const swatchesHTML = COLOR_PRESETS.map(p =>
    `<button class="color-swatch" data-color="${p.color}" style="background:${p.color}" title="${p.label}" type="button"></button>`
  ).join('\n          ');

  return `
    <div class="settings-section">
      <div class="settings-label">DATA BLOCK FONT SIZE</div>
      <div class="settings-row">
        <input type="range" id="set-fontsize" min="8" max="20" value="11" step="1">
        <span class="settings-fontsize-val" id="set-fontsize-val">11px</span>
      </div>
    </div>

    <div class="settings-section">
      <div class="settings-label">DISPLAY MODE</div>
      <div class="settings-row">
        <button class="settings-theme-btn" id="set-theme-dark" type="button">DARK</button>
        <button class="settings-theme-btn active" id="set-theme-light" type="button">LIGHT</button>
      </div>
    </div>

    <div class="settings-section" id="dark-color-section">
      <div class="settings-label">DARK MODE COLOR</div>
      <div class="settings-row settings-color-row">
          ${swatchesHTML}
          <input type="color" id="set-custom-color" value="#00cc44" title="Custom color">
      </div>
    </div>

    <div class="settings-section">
      <div class="settings-label">ALTITUDE VISUALIZATION</div>
      <div class="settings-row" style="flex-direction:column;align-items:flex-start;gap:8px;">
        <label class="settings-toggle-label">
          <input type="checkbox" id="set-color-by-alt">
          <span>Color by altitude</span>
        </label>
        <label class="settings-toggle-label">
          <input type="checkbox" id="set-thick-trails">
          <span>Thick trails by altitude</span>
        </label>
      </div>
    </div>

    <div class="settings-section">
      <div class="settings-label">AIRSPACE</div>
      <div class="settings-row" style="flex-direction:column;align-items:flex-start;gap:8px;">
        <label class="settings-toggle-label">
          <input type="checkbox" id="set-airspace-edges">
          <span>Show airspace edges</span>
        </label>
      </div>
    </div>

    <div class="settings-section">
      <div class="settings-label">AIRPORTS</div>
      <div class="settings-row" style="flex-direction:column;align-items:flex-start;gap:8px;">
        <label class="settings-toggle-label">
          <input type="checkbox" id="set-small-airports">
          <span>Show small airports (visible when zoomed in)</span>
        </label>
      </div>
    </div>

    <div class="settings-section">
      <div class="settings-label">NAVAIDS</div>
      <div class="settings-row" style="flex-direction:column;align-items:flex-start;gap:8px;">
        <label class="settings-toggle-label">
          <input type="checkbox" id="set-show-fixes">
          <span>Include waypoint fixes (visible when zoomed in)</span>
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
  const btnLight = container.querySelector('#set-theme-light');
  btnDark.classList.toggle('active', s.theme === 'dark');
  btnLight.classList.toggle('active', s.theme === 'light');

  const darkSection = container.querySelector('#dark-color-section');

  // Color swatches
  const swatches = container.querySelectorAll('.color-swatch');
  let isPreset = false;
  swatches.forEach(sw => {
    const match = sw.dataset.color === s.darkColor;
    sw.classList.toggle('active', match);
    if (match) isPreset = true;
  });
  container.querySelector('#set-custom-color').value = s.darkColor;

  // Altitude checkboxes
  container.querySelector('#set-color-by-alt').checked = s.colorByAltitude;
  container.querySelector('#set-thick-trails').checked = s.thickTrailsByAltitude;

  // Airspace edges
  container.querySelector('#set-airspace-edges').checked = s.airspaceEdges;

  // Small airports
  container.querySelector('#set-small-airports').checked = s.showSmallAirports;

  // Waypoint fixes
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
  const btnLight = container.querySelector('#set-theme-light');
  const darkSection = container.querySelector('#dark-color-section');
  const swatches = container.querySelectorAll('.color-swatch');
  const customColor = container.querySelector('#set-custom-color');
  const colorByAlt = container.querySelector('#set-color-by-alt');
  const thickTrails = container.querySelector('#set-thick-trails');
  const airspaceEdges = container.querySelector('#set-airspace-edges');
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
      colorByAltitude: colorByAlt.checked,
      thickTrailsByAltitude: thickTrails.checked,
      airspaceEdges: airspaceEdges.checked,
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

  function updateDarkSectionState() {
    // Color section always visible and interactive
  }

  function updateSwatchActive(selectedColor) {
    swatches.forEach(sw => {
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
  btnDark.addEventListener('click', () => {
    formState.theme = 'dark';
    btnDark.classList.add('active');
    btnLight.classList.remove('active');
    updateDarkSectionState();
    broadcast();
  });

  btnLight.addEventListener('click', () => {
    formState.theme = 'light';
    btnLight.classList.add('active');
    btnDark.classList.remove('active');
    updateDarkSectionState();
    broadcast();
  });

  // --- Color swatches ---
  swatches.forEach(sw => {
    sw.addEventListener('click', () => {
      formState.darkColor = sw.dataset.color;
      updateSwatchActive(sw.dataset.color);
      customColor.value = sw.dataset.color;
      broadcast();
    });
  });

  // --- Custom color picker ---
  customColor.addEventListener('input', () => {
    formState.darkColor = customColor.value;
    updateSwatchActive(''); // deselect all presets
    debouncedBroadcast();
  });

  // --- Altitude checkboxes ---
  colorByAlt.addEventListener('change', () => {
    updateDarkSectionState();
    broadcast();
  });

  thickTrails.addEventListener('change', () => {
    broadcast();
  });

  airspaceEdges.addEventListener('change', () => {
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
