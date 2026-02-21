// settings.js — Electron settings window (thin wrapper over shared/settings.js)

'use strict';

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
