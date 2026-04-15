// settings-electron.js — Electron settings window (thin wrapper over settings.js)

// ============================================================
// Color utilities (subset of config.js, Cesium-free)
// ============================================================

function hexToRgb(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return [r, g, b];
}

function withAlpha(hex, alpha) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function brighten(hex, factor = 1.3) {
  const [r, g, b] = hexToRgb(hex);
  const clamp = v => Math.min(255, Math.round(v * factor));
  return `#${clamp(r).toString(16).padStart(2,'0')}${clamp(g).toString(16).padStart(2,'0')}${clamp(b).toString(16).padStart(2,'0')}`;
}

// ============================================================
// Theme application (mirrors applyTheme CSS logic in radar-core.js)
// ============================================================

function applySettingsTheme(settings) {
  const s = { ...DEFAULT_SETTINGS, ...settings };
  let theme = s.theme;
  if (theme === 'system') {
    theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  const isDark = theme === 'dark';
  const root = document.documentElement;

  document.body.classList.toggle('theme-light', !isDark);
  document.body.classList.toggle('theme-dark', isDark);

  if (isDark) {
    const hex = s.darkColor || DEFAULT_SETTINGS.darkColor;
    const phosphorBright = brighten(hex, 1.4);
    const phosphorDim = withAlpha(hex, 0.35);

    root.style.setProperty('--md-primary', hex);
    root.style.setProperty('--md-on-primary', '#ffffff');
    root.style.setProperty('--md-surface', '#121212');
    root.style.setProperty('--md-surface-container-highest', withAlpha(hex, 0.15));
    root.style.setProperty('--md-on-surface', phosphorBright);
    root.style.setProperty('--md-on-surface-variant', phosphorDim);
    root.style.setProperty('--md-outline', withAlpha(hex, 0.3));
    root.style.setProperty('--md-outline-variant', withAlpha(hex, 0.12));
    root.style.setProperty('--settings-input-bg', 'rgba(0, 0, 0, 0.2)');
    root.style.setProperty('--settings-btn-active-color', '#000000');
  } else {
    const hex = s.lightColor || DEFAULT_SETTINGS.lightColor;
    const [r, g, b] = hexToRgb(hex);
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    const dk = v => Math.round(v * 0.6);
    const phosphorBright = `#${dk(r).toString(16).padStart(2,'0')}${dk(g).toString(16).padStart(2,'0')}${dk(b).toString(16).padStart(2,'0')}`;
    const phosphorDim = withAlpha(hex, 0.45);

    root.style.setProperty('--md-primary', hex);
    root.style.setProperty('--md-on-primary', lum > 0.5 ? '#000000' : '#ffffff');
    root.style.setProperty('--md-surface', '#f7f7f7');
    root.style.setProperty('--md-surface-container-highest', withAlpha(hex, 0.08));
    root.style.setProperty('--md-on-surface', phosphorBright);
    root.style.setProperty('--md-on-surface-variant', phosphorDim);
    root.style.setProperty('--md-outline', withAlpha(hex, 0.2));
    root.style.setProperty('--md-outline-variant', withAlpha(hex, 0.1));
    root.style.setProperty('--settings-input-bg', '#fff');
    root.style.setProperty('--settings-btn-active-color', '#ffffff');
  }
}

// Listen for OS theme changes (relevant when theme is 'system')
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', async () => {
  const settings = await window.settingsAPI.getSettings();
  applySettingsTheme(settings);
});

// ============================================================
// Settings panel initialization
// ============================================================

// Initialize cloud sync so the settings panel can show login state.
// Do not block UI rendering — fire and forget, then update cloud UI once auth is restored.
if (typeof initCloud === 'function') {
  initCloud().then(() => {
    const container = document.getElementById('settings-container');
    if (container) updateCloudUI(container);
  }).catch(err => console.warn('[Cloud] Init failed in settings:', err.message));
}

const container = document.getElementById('settings-container');

let originalSettings = {};

initSettingsPanel({
  container,
  getSettings: async () => {
    // Cloud-first: loadSettingsUnified uses cloud as source of truth when logged in
    originalSettings = await loadSettingsUnified();
    applySettingsTheme(originalSettings);
    // Always open the settings window with credentials collapsed
    return { ...originalSettings, credentialsExpanded: false };
  },
  onChanged: (form) => {
    applySettingsTheme(form);
    const merged = { ...originalSettings, ...form };
    // updateSettings saves locally + broadcasts to main window
    window.settingsAPI.updateSettings(merged);
    // Save to cloud if logged in (saveSettingsUnified handles both, but
    // settings window uses updateSettings for the broadcast side-effect,
    // so we call cloud save directly here)
    if (typeof isCloudLoggedIn === 'function' && isCloudLoggedIn()) {
      cloudSaveSettings(merged);
    }
  },
  onClose: async () => {
    if (typeof flushCloudSave === 'function') await flushCloudSave();
    window.settingsAPI.close();
  },
  onFontSizePreview: (size) => {
    window.settingsAPI.previewFontSize(size);
  },
  onRotationSpeedPreview: (speed) => {
    window.settingsAPI.previewRotationSpeed(speed);
  },
  onWeatherOpacityPreview: (opacity) => {
    window.settingsAPI.previewWeatherOpacity(opacity);
  },
  onAltGainPreview: (factor) => {
    window.settingsAPI.previewAltGain(factor);
  },
  onQuietSave: (form) => {
    applySettingsTheme(form);
    const merged = { ...originalSettings, ...form };
    window.settingsAPI.updateSettingsQuiet(merged);
    if (typeof isCloudLoggedIn === 'function' && isCloudLoggedIn()) {
      cloudSaveSettings(merged);
    }
  },
  onDefaults: async () => {
    const result = await window.settingsAPI.resetSettings();
    if (result.reset) {
      originalSettings = {};
      populateSettingsForm(container, DEFAULT_SETTINGS);
      applySettingsTheme(DEFAULT_SETTINGS);
      window.settingsAPI.resizeToContent();
      // Also reset cloud settings if logged in
      if (typeof isCloudLoggedIn === 'function' && isCloudLoggedIn()) {
        cloudSaveSettings(DEFAULT_SETTINGS);
      }
    }
  },
  onCloudLogin: async () => {
    await cloudLogin();
    // Check for existing cloud settings
    const cloudSettings = await cloudLoadSettings();
    if (cloudSettings) {
      // Cloud is source of truth — use cloud settings
      const merged = { ...DEFAULT_SETTINGS, ...cloudSettings };
      await window.settingsAPI.updateSettings(merged);
      originalSettings = merged;
    } else {
      // First-time cloud user — upload current local settings to cloud
      const local = await window.settingsAPI.getSettings();
      await cloudSaveSettings(local);
      originalSettings = local;
    }
    populateSettingsForm(container, originalSettings);
    applySettingsTheme(originalSettings);
    window.settingsAPI.cloudSettingsChanged();
  },
  onCloudLogout: async () => {
    await cloudLogout();
    populateSettingsForm(container, originalSettings);
    applySettingsTheme(originalSettings);
  },
});

// Best-effort flush of any pending cloud save if the window is closed
// via the X button instead of the Done button. beforeunload cannot await
// async work, but _doCloudSave fires a fetch which the browser will let
// finish in-flight.
window.addEventListener('beforeunload', () => {
  if (typeof flushCloudSave === 'function') flushCloudSave();
});

// Resize Electron window when credentials section is toggled
const credDetails = container.querySelector('#cred-details');
if (credDetails) {
  credDetails.addEventListener('toggle', () => {
    window.settingsAPI.resizeToContent();
  });
}
