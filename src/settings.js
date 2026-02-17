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
});

document.getElementById('btn-done').addEventListener('click', () => {
  window.settingsAPI.close();
});

document.getElementById('btn-defaults').addEventListener('click', async () => {
  const result = await window.settingsAPI.resetSettings();
  if (result.reset) {
    originalSettings = {};
    populateSettingsForm(container, SETTINGS_DEFAULTS);
  }
});
