<template>
  <div class="settings-overlay" :class="{ visible: modelValue }" @click.self="$emit('update:modelValue', false)">
    <div class="settings-panel">
      <div class="settings-header">
        <span>Preferences</span>
        <button class="scope-btn settings-close-btn" @click="$emit('update:modelValue', false)">&times;</button>
      </div>
      <div class="settings-container" ref="containerEl"></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted } from 'vue';
import { useSettingsStore } from '@/stores/settings';
import { DEFAULT_SETTINGS } from '@/core/defaults';

const props = defineProps<{
  modelValue: boolean;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
}>();

const settingsStore = useSettingsStore();
const containerEl = ref<HTMLElement>();

// ============================================================
// Settings panel HTML and event wiring (ported from shared/settings.js)
// We reuse the same approach: generate HTML, inject CSS, wire events
// ============================================================

const COLOR_PRESETS = [
  { color: '#cccccc', label: 'White' },
  { color: '#00cccc', label: 'Cyan' },
  { color: '#cc8800', label: 'Amber' },
  { color: '#00cc44', label: 'Phosphor Green' },
  { color: '#6c7f70', label: 'Sage' },
];

const LIGHT_COLOR_PRESETS = [
  { color: '#1a1a1a', label: 'Black' },
  { color: '#2563eb', label: 'Cobalt' },
  { color: '#0d9488', label: 'Teal' },
  { color: '#dc2626', label: 'Crimson' },
  { color: '#7c3aed', label: 'Violet' },
];

function createSettingsFormHTML(): string {
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
            <label class="settings-toggle-label"><input type="checkbox" id="set-airports"><span>Airports</span></label>
            <label class="settings-toggle-label"><input type="checkbox" id="set-airspace"><span>Airspace</span></label>
            <label class="settings-toggle-label"><input type="checkbox" id="set-small-airports"><span>Small airports</span></label>
            <label class="settings-toggle-label"><input type="checkbox" id="set-airspace-edges"><span>Airspace edges</span></label>
            <label class="settings-toggle-label"><input type="checkbox" id="set-navaids"><span>Navaids</span></label>
            <label class="settings-toggle-label"><input type="checkbox" id="set-airspace-3d"><span>3D airspace</span></label>
            <label class="settings-toggle-label"><input type="checkbox" id="set-show-fixes"><span>Nav fixes</span></label>
          </div>
        </div>
      </div>
    </div>
    <div class="settings-footer">
      <button type="button" class="scope-btn" id="btn-settings-defaults">Defaults</button>
      <button type="button" class="scope-btn" id="btn-settings-done">Done</button>
    </div>
  `;
}

// Settings CSS (injected inline, same as shared/settings.js)
const SETTINGS_CSS = `
.settings-columns { display: flex; }
.settings-column { flex: 1; min-width: 0; }
.settings-column:first-child { border-right: 1px solid var(--md-outline-variant); }
.settings-section { padding: 18px 16px; border-bottom: 1px solid var(--md-outline-variant); }
.settings-label { font-size: 15px; color: var(--md-on-surface-variant); margin-bottom: 10px; font-weight: 600; }
.settings-row { display: flex; align-items: center; gap: 10px; }
.settings-color-row { flex-wrap: wrap; gap: 8px; }
.color-swatch { width: 36px; height: 36px; border-radius: 50%; border: 2px solid transparent; cursor: pointer; padding: 0; transition: border-color 0.2s, transform 0.15s cubic-bezier(0.35, 1.5, 0.65, 1); }
.color-swatch:hover { transform: scale(1.15); }
.color-swatch.active { border-color: var(--md-on-surface); }
#set-custom-color, #set-light-custom-color { width: 36px; height: 36px; border: 1px solid var(--md-outline-variant); border-radius: 8px; background: transparent; cursor: pointer; padding: 0; }
.settings-hint { font-size: 13px; color: var(--md-on-surface-variant); margin-bottom: 8px; }
.settings-field-label { font-size: 13px; color: var(--md-on-surface-variant); width: 65px; flex-shrink: 0; }
.settings-seg-group { display: inline-flex; border-radius: 9999px; background: var(--md-surface-container-highest); padding: 3px; gap: 2px; }
.theme-light .settings-seg-group { background: #ffffff; }
.settings-theme-btn { padding: 6px 14px; font-size: 14px; font-weight: 500; cursor: pointer; border: none; border-radius: 9999px; background: transparent; color: var(--md-on-surface); font-family: 'Roboto Flex', system-ui, sans-serif; transition: background 0.15s, color 0.15s; }
.settings-theme-btn:hover { background: var(--md-surface-container-highest); }
.settings-theme-btn.active { background: var(--md-primary); color: var(--settings-btn-active-color, #fff); }
.settings-toggle-label { display: flex; align-items: center; gap: 6px; cursor: pointer; font-size: 14px; color: var(--md-on-surface); font-family: 'Roboto Flex', system-ui, sans-serif; }
.settings-fontsize-val { font-size: 14px; min-width: 32px; color: var(--md-on-surface); }
.settings-grid-2col { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.settings-color-label { font-size: 13px; color: var(--md-on-surface-variant); margin-bottom: 6px; }
.settings-toggle-label input[type="checkbox"] { appearance: none; width: 18px; height: 18px; border: 2px solid var(--md-outline-variant); border-radius: 4px; background: transparent; cursor: pointer; position: relative; flex-shrink: 0; transition: background 0.15s, border-color 0.15s; }
.settings-toggle-label input[type="checkbox"]:checked { background: var(--md-primary); border-color: var(--md-primary); }
.settings-toggle-label input[type="checkbox"]:checked::after { content: ''; position: absolute; top: 1px; left: 5px; width: 5px; height: 9px; border: solid var(--settings-btn-active-color, #fff); border-width: 0 2px 2px 0; transform: rotate(45deg); }
.theme-light .settings-toggle-label input[type="checkbox"]:not(:checked) { background: #ffffff; }
.settings-footer { display: flex; justify-content: space-between; padding: 12px 16px; border-top: 1px solid var(--md-outline-variant); position: sticky; bottom: 0; background: var(--md-surface-container-solid); z-index: 5; }
@media (max-width: 767px) { .settings-columns { flex-direction: column; } .settings-column:first-child { border-right: none; border-bottom: 1px solid var(--md-outline-variant); } .settings-section:has(#set-rotation-speed), label:has(#set-airspace-3d) { display: none; } }
`;

let settingsCssInjected = false;
let _formState: Record<string, unknown> = {};

function injectCSS(): void {
  if (settingsCssInjected) return;
  const style = document.createElement('style');
  style.textContent = SETTINGS_CSS;
  document.head.appendChild(style);
  settingsCssInjected = true;
}

function debounce(fn: () => void, ms: number): () => void {
  let timer: ReturnType<typeof setTimeout>;
  return () => {
    clearTimeout(timer);
    timer = setTimeout(fn, ms);
  };
}

function populateForm(): void {
  const c = containerEl.value;
  if (!c) return;
  const s = settingsStore.settings;

  // Font size
  const fontSlider = c.querySelector<HTMLInputElement>('#set-fontsize');
  const fontVal = c.querySelector<HTMLElement>('#set-fontsize-val');
  if (fontSlider) fontSlider.value = String(s.fontSize);
  if (fontVal) fontVal.textContent = `${s.fontSize}px`;

  // Theme buttons
  c.querySelector('#set-theme-dark')?.classList.toggle('active', s.theme === 'dark');
  c.querySelector('#set-theme-light')?.classList.toggle('active', s.theme === 'light');
  c.querySelector('#set-theme-system')?.classList.toggle('active', s.theme === 'system');

  // Mute map
  const mute = c.querySelector<HTMLInputElement>('#set-mute-map-colors');
  if (mute) mute.checked = s.muteMapColors;

  // Dark swatches
  const darkSwatches = c.querySelectorAll<HTMLButtonElement>('.dark-color-swatch');
  if (s.darkColorPresets) {
    darkSwatches.forEach((sw, i) => {
      if (s.darkColorPresets && s.darkColorPresets[i]) {
        sw.dataset.color = s.darkColorPresets[i];
        sw.style.background = s.darkColorPresets[i];
      }
    });
  }
  darkSwatches.forEach(sw => sw.classList.toggle('active', sw.dataset.color === s.darkColor));
  const customColor = c.querySelector<HTMLInputElement>('#set-custom-color');
  if (customColor) customColor.value = s.darkColor;

  // Light swatches
  const lightSwatches = c.querySelectorAll<HTMLButtonElement>('.light-color-swatch');
  if (s.lightColorPresets) {
    lightSwatches.forEach((sw, i) => {
      if (s.lightColorPresets && s.lightColorPresets[i]) {
        sw.dataset.color = s.lightColorPresets[i];
        sw.style.background = s.lightColorPresets[i];
      }
    });
  }
  lightSwatches.forEach(sw => sw.classList.toggle('active', sw.dataset.color === s.lightColor));
  const lightCustom = c.querySelector<HTMLInputElement>('#set-light-custom-color');
  if (lightCustom) lightCustom.value = s.lightColor;

  // Altitude
  const colorByAlt = c.querySelector<HTMLInputElement>('#set-color-by-alt');
  if (colorByAlt) colorByAlt.checked = s.colorByAltitude;
  const thickTrails = c.querySelector<HTMLInputElement>('#set-thick-trails');
  if (thickTrails) thickTrails.checked = s.thickTrailsByAltitude;

  // Trail mode
  const trailMode = s.trailMode || 'history';
  c.querySelector('#set-trail-none')?.classList.toggle('active', trailMode === 'none');
  c.querySelector('#set-trail-history')?.classList.toggle('active', trailMode === 'history');
  c.querySelector('#set-trail-velocity')?.classList.toggle('active', trailMode === 'velocity');

  // Trail length
  const trailSlider = c.querySelector<HTMLInputElement>('#set-trail-length');
  const trailVal = c.querySelector<HTMLElement>('#set-trail-length-val');
  if (trailSlider) trailSlider.value = String(s.trailLength);
  if (trailVal) trailVal.textContent = `${Math.round(s.trailLength / 60)}m`;
  const trailRow = c.querySelector<HTMLElement>('#trail-length-row');
  if (trailRow) {
    trailRow.style.opacity = trailMode !== 'history' ? '0.4' : '1';
    if (trailSlider) trailSlider.disabled = trailMode !== 'history';
  }

  // Aviation data
  const setChecked = (id: string, val: boolean) => {
    const el = c.querySelector<HTMLInputElement>(id);
    if (el) el.checked = val;
  };
  setChecked('#set-airports', s.airportsEnabled);
  setChecked('#set-airspace', s.airspaceEnabled);
  setChecked('#set-navaids', s.navaidsEnabled);
  setChecked('#set-airspace-edges', s.airspaceEdges);
  setChecked('#set-airspace-3d', s.airspace3D);
  setChecked('#set-small-airports', s.showSmallAirports);
  setChecked('#set-show-fixes', s.showFixes);

  // Rotation speed
  const rotSlider = c.querySelector<HTMLInputElement>('#set-rotation-speed');
  const rotVal = c.querySelector<HTMLElement>('#set-rotation-speed-val');
  if (rotSlider) rotSlider.value = String(s.rotationSpeed);
  if (rotVal) rotVal.textContent = `${s.rotationSpeed} \u00B0/s`;

  // Weather opacity
  const weatherSlider = c.querySelector<HTMLInputElement>('#set-weather-opacity');
  const weatherVal = c.querySelector<HTMLElement>('#set-weather-opacity-val');
  if (weatherSlider) weatherSlider.value = String(s.weatherOverlayOpacity);
  if (weatherVal) weatherVal.textContent = `${s.weatherOverlayOpacity}%`;

  _formState = { theme: s.theme, darkColor: s.darkColor, lightColor: s.lightColor, trailMode: s.trailMode };
}

function readForm(): Partial<typeof settingsStore.settings> {
  const c = containerEl.value;
  if (!c) return {};
  const val = (id: string) => (c.querySelector<HTMLInputElement>(id)?.value) || '';
  const checked = (id: string) => c.querySelector<HTMLInputElement>(id)?.checked ?? false;
  const darkSwatches = c.querySelectorAll<HTMLButtonElement>('.dark-color-swatch');
  const lightSwatches = c.querySelectorAll<HTMLButtonElement>('.light-color-swatch');

  return {
    fontSize: parseInt(val('#set-fontsize')) || 11,
    theme: _formState.theme as 'dark' | 'light' | 'system',
    muteMapColors: checked('#set-mute-map-colors'),
    darkColor: _formState.darkColor as string,
    lightColor: _formState.lightColor as string,
    darkColorPresets: Array.from(darkSwatches).map(sw => sw.dataset.color || ''),
    lightColorPresets: Array.from(lightSwatches).map(sw => sw.dataset.color || ''),
    colorByAltitude: checked('#set-color-by-alt'),
    thickTrailsByAltitude: checked('#set-thick-trails'),
    trailMode: _formState.trailMode as 'none' | 'history' | 'velocity',
    trailLength: parseInt(val('#set-trail-length')) || 120,
    airportsEnabled: checked('#set-airports'),
    airspaceEnabled: checked('#set-airspace'),
    navaidsEnabled: checked('#set-navaids'),
    airspaceEdges: checked('#set-airspace-edges'),
    airspace3D: checked('#set-airspace-3d'),
    showSmallAirports: checked('#set-small-airports'),
    showFixes: checked('#set-show-fixes'),
    rotationSpeed: parseInt(val('#set-rotation-speed')) || 6,
    weatherOverlayOpacity: parseInt(val('#set-weather-opacity')) || 25,
  };
}

function broadcast(): void {
  const form = readForm();
  settingsStore.merge(form);
}

const debouncedBroadcast = debounce(broadcast, 80);

function wireEvents(): void {
  const c = containerEl.value;
  if (!c) return;

  // Font size
  c.querySelector('#set-fontsize')?.addEventListener('input', () => {
    const v = (c.querySelector<HTMLInputElement>('#set-fontsize'))?.value;
    const el = c.querySelector<HTMLElement>('#set-fontsize-val');
    if (el && v) el.textContent = `${v}px`;
    debouncedBroadcast();
  });

  // Theme buttons
  function setTheme(theme: string): void {
    _formState.theme = theme;
    c!.querySelector('#set-theme-dark')?.classList.toggle('active', theme === 'dark');
    c!.querySelector('#set-theme-light')?.classList.toggle('active', theme === 'light');
    c!.querySelector('#set-theme-system')?.classList.toggle('active', theme === 'system');
    broadcast();
  }
  c.querySelector('#set-theme-dark')?.addEventListener('click', () => setTheme('dark'));
  c.querySelector('#set-theme-light')?.addEventListener('click', () => setTheme('light'));
  c.querySelector('#set-theme-system')?.addEventListener('click', () => setTheme('system'));

  c.querySelector('#set-mute-map-colors')?.addEventListener('change', broadcast);

  // Dark color swatches
  c.querySelectorAll<HTMLButtonElement>('.dark-color-swatch').forEach(sw => {
    sw.addEventListener('click', () => {
      _formState.darkColor = sw.dataset.color;
      c.querySelectorAll('.dark-color-swatch').forEach(s => s.classList.toggle('active', s === sw));
      const cp = c.querySelector<HTMLInputElement>('#set-custom-color');
      if (cp) cp.value = sw.dataset.color || '';
      broadcast();
    });
  });

  c.querySelector('#set-custom-color')?.addEventListener('input', () => {
    const v = (c.querySelector<HTMLInputElement>('#set-custom-color'))?.value || '';
    _formState.darkColor = v;
    const active = c.querySelector('.dark-color-swatch.active') as HTMLButtonElement | null;
    if (active) { active.dataset.color = v; active.style.background = v; }
    debouncedBroadcast();
  });

  // Light color swatches
  c.querySelectorAll<HTMLButtonElement>('.light-color-swatch').forEach(sw => {
    sw.addEventListener('click', () => {
      _formState.lightColor = sw.dataset.color;
      c.querySelectorAll('.light-color-swatch').forEach(s => s.classList.toggle('active', s === sw));
      const cp = c.querySelector<HTMLInputElement>('#set-light-custom-color');
      if (cp) cp.value = sw.dataset.color || '';
      broadcast();
    });
  });

  c.querySelector('#set-light-custom-color')?.addEventListener('input', () => {
    const v = (c.querySelector<HTMLInputElement>('#set-light-custom-color'))?.value || '';
    _formState.lightColor = v;
    const active = c.querySelector('.light-color-swatch.active') as HTMLButtonElement | null;
    if (active) { active.dataset.color = v; active.style.background = v; }
    debouncedBroadcast();
  });

  // Altitude
  c.querySelector('#set-color-by-alt')?.addEventListener('change', broadcast);
  c.querySelector('#set-thick-trails')?.addEventListener('change', broadcast);

  // Trail mode
  function setTrailMode(mode: string): void {
    _formState.trailMode = mode;
    c!.querySelector('#set-trail-none')?.classList.toggle('active', mode === 'none');
    c!.querySelector('#set-trail-history')?.classList.toggle('active', mode === 'history');
    c!.querySelector('#set-trail-velocity')?.classList.toggle('active', mode === 'velocity');
    const trailRow = c!.querySelector<HTMLElement>('#trail-length-row');
    const trailSlider = c!.querySelector<HTMLInputElement>('#set-trail-length');
    if (trailRow) trailRow.style.opacity = mode !== 'history' ? '0.4' : '1';
    if (trailSlider) trailSlider.disabled = mode !== 'history';
    broadcast();
  }
  c.querySelector('#set-trail-none')?.addEventListener('click', () => setTrailMode('none'));
  c.querySelector('#set-trail-history')?.addEventListener('click', () => setTrailMode('history'));
  c.querySelector('#set-trail-velocity')?.addEventListener('click', () => setTrailMode('velocity'));

  // Trail length
  c.querySelector('#set-trail-length')?.addEventListener('input', () => {
    const v = (c.querySelector<HTMLInputElement>('#set-trail-length'))?.value || '120';
    const el = c.querySelector<HTMLElement>('#set-trail-length-val');
    if (el) el.textContent = `${Math.round(parseInt(v) / 60)}m`;
    debouncedBroadcast();
  });

  // Aviation data checkboxes
  ['#set-airports', '#set-airspace', '#set-navaids', '#set-airspace-edges',
   '#set-airspace-3d', '#set-small-airports', '#set-show-fixes'].forEach(id => {
    c.querySelector(id)?.addEventListener('change', broadcast);
  });

  // Rotation speed
  c.querySelector('#set-rotation-speed')?.addEventListener('input', () => {
    const v = (c.querySelector<HTMLInputElement>('#set-rotation-speed'))?.value || '6';
    const el = c.querySelector<HTMLElement>('#set-rotation-speed-val');
    if (el) el.textContent = `${v} \u00B0/s`;
    debouncedBroadcast();
  });

  // Weather opacity
  c.querySelector('#set-weather-opacity')?.addEventListener('input', () => {
    const v = (c.querySelector<HTMLInputElement>('#set-weather-opacity'))?.value || '25';
    const el = c.querySelector<HTMLElement>('#set-weather-opacity-val');
    if (el) el.textContent = `${v}%`;
    debouncedBroadcast();
  });

  // Footer buttons
  c.querySelector('#btn-settings-done')?.addEventListener('click', () => {
    emit('update:modelValue', false);
  });
  c.querySelector('#btn-settings-defaults')?.addEventListener('click', () => {
    if (confirm('Reset all settings to defaults? This cannot be undone.')) {
      settingsStore.reset();
      populateForm();
    }
  });
}

onMounted(() => {
  injectCSS();
  if (containerEl.value) {
    containerEl.value.innerHTML = createSettingsFormHTML();
    // Hide credentials section on web (server-side)
    const credSection = containerEl.value.querySelector('#cred-drop-zone');
    if (credSection) {
      const parent = credSection.closest('.settings-section');
      if (parent) (parent as HTMLElement).style.display = 'none';
    }
    wireEvents();
  }
});

// Re-populate when modal opens
watch(() => props.modelValue, (visible) => {
  if (visible) populateForm();
});
</script>
