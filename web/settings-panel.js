'use strict';

const settingsOverlay = document.getElementById('settings-overlay');

if (settingsOverlay) {
  const fontSizeSlider = document.getElementById('set-fontsize');
  const fontSizeVal = document.getElementById('set-fontsize-val');
  const fontPreview = document.getElementById('fontsize-preview');
  const btnThemeDark = document.getElementById('set-theme-dark');
  const btnThemeLight = document.getElementById('set-theme-light');
  const darkColorSection = document.getElementById('dark-color-section');
  const colorSwatches = document.querySelectorAll('.color-swatch');
  const customColorInput = document.getElementById('set-custom-color');
  const colorByAltCheckbox = document.getElementById('set-color-by-alt');
  const thickTrailsCheckbox = document.getElementById('set-thick-trails');
  const openskyClientIdInput = document.getElementById('set-opensky-client-id');
  const openskyClientSecretInput = document.getElementById('set-opensky-client-secret');

  let pendingSettings = {};

  function syncSettingsUI() {
    fontSizeSlider.value = pendingSettings.fontSize;
    fontSizeVal.textContent = `${pendingSettings.fontSize}px`;
    fontPreview.style.fontSize = `${pendingSettings.fontSize}px`;

    btnThemeDark.classList.toggle('active', pendingSettings.theme === 'dark');
    btnThemeLight.classList.toggle('active', pendingSettings.theme === 'light');

    const isDarkTheme = pendingSettings.theme === 'dark';
    const colorDisabled = isDarkTheme && pendingSettings.colorByAltitude;
    darkColorSection.style.display = isDarkTheme ? '' : 'none';
    darkColorSection.style.opacity = colorDisabled ? '0.3' : '';
    darkColorSection.style.pointerEvents = colorDisabled ? 'none' : '';

    colorSwatches.forEach(sw => {
      sw.classList.toggle('active', sw.dataset.color === pendingSettings.darkColor);
    });
    customColorInput.value = pendingSettings.darkColor;

    colorByAltCheckbox.checked = pendingSettings.colorByAltitude;
    thickTrailsCheckbox.checked = pendingSettings.thickTrailsByAltitude;
    openskyClientIdInput.value = pendingSettings.openskyClientId;
    openskyClientSecretInput.value = pendingSettings.openskyClientSecret;
  }

  async function openSettings() {
    const saved = await window.flightAPI.getSettings();
    pendingSettings = {
      fontSize: saved.fontSize || 11,
      theme: saved.theme || 'dark',
      darkColor: saved.darkColor || '#00cc44',
      colorByAltitude: saved.colorByAltitude !== undefined ? saved.colorByAltitude : true,
      thickTrailsByAltitude: saved.thickTrailsByAltitude || false,
      openskyClientId: saved.openskyClientId || '',
      openskyClientSecret: saved.openskyClientSecret || '',
    };
    syncSettingsUI();
    settingsOverlay.classList.remove('hidden');
  }

  function closeSettings() {
    settingsOverlay.classList.add('hidden');
  }

  fontSizeSlider.addEventListener('input', (e) => {
    pendingSettings.fontSize = parseInt(e.target.value, 10);
    syncSettingsUI();
  });

  btnThemeDark.addEventListener('click', () => {
    pendingSettings.theme = 'dark';
    syncSettingsUI();
  });

  btnThemeLight.addEventListener('click', () => {
    pendingSettings.theme = 'light';
    syncSettingsUI();
  });

  colorSwatches.forEach(sw => {
    sw.addEventListener('click', () => {
      pendingSettings.darkColor = sw.dataset.color;
      syncSettingsUI();
    });
  });

  customColorInput.addEventListener('input', (e) => {
    pendingSettings.darkColor = e.target.value;
    colorSwatches.forEach(sw => sw.classList.remove('active'));
  });

  colorByAltCheckbox.addEventListener('change', (e) => {
    pendingSettings.colorByAltitude = e.target.checked;
    syncSettingsUI();
  });

  thickTrailsCheckbox.addEventListener('change', (e) => {
    pendingSettings.thickTrailsByAltitude = e.target.checked;
  });

  openskyClientIdInput.addEventListener('input', (e) => {
    pendingSettings.openskyClientId = e.target.value.trim();
  });

  openskyClientSecretInput.addEventListener('input', (e) => {
    pendingSettings.openskyClientSecret = e.target.value;
  });

  document.getElementById('settings-apply').addEventListener('click', async () => {
    const current = await window.flightAPI.getSettings();
    await window.flightAPI.saveSettings({ ...current, ...pendingSettings });
    window.notifySettingsChanged();
    closeSettings();
  });

  document.getElementById('settings-cancel').addEventListener('click', closeSettings);
  document.getElementById('settings-close').addEventListener('click', closeSettings);

  settingsOverlay.addEventListener('click', (e) => {
    if (e.target === settingsOverlay) closeSettings();
  });

  window.addEventListener('flightradar:open-settings', () => {
    openSettings();
  });
}
