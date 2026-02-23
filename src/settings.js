// settings.js — Electron settings window (thin wrapper over shared/settings.js)

'use strict';

// Apply theme-light/theme-dark class based on OS preference
// (enables .theme-light rules in shared/settings.js inline CSS)
function applyThemeClass() {
  const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.body.classList.toggle('theme-light', !isDark);
  document.body.classList.toggle('theme-dark', isDark);
}
applyThemeClass();
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyThemeClass);

const container = document.getElementById('settings-container');
container.innerHTML = createSettingsFormHTML();

let originalSettings = {};

initSettingsPanel({
  container,
  getSettings: async () => {
    originalSettings = await window.settingsAPI.getSettings();
    return originalSettings;
  },
  onChanged: (form) => {
    window.settingsAPI.updateSettings({ ...originalSettings, ...form });
  },
  onClose: () => {
    window.settingsAPI.close();
  },
  onDefaults: async () => {
    const result = await window.settingsAPI.resetSettings();
    if (result.reset) {
      originalSettings = {};
      populateSettingsForm(container, DEFAULT_SETTINGS);
    }
  },
});
