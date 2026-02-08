// settings.js — Settings window logic

'use strict';

const fontSizeSlider = document.getElementById('set-fontsize');
const fontSizeVal = document.getElementById('set-fontsize-val');
const fontPreview = document.getElementById('fontsize-preview');
const darkColorSection = document.getElementById('dark-color-section');
const customColorInput = document.getElementById('custom-color');
const colorByAltCheckbox = document.getElementById('set-color-by-alt');
const thickTrailsCheckbox = document.getElementById('set-thick-trails');
const clientIdInput = document.getElementById('set-client-id');
const clientSecretInput = document.getElementById('set-client-secret');

// Original settings loaded from main process (used to preserve savedView etc.)
let originalSettings = {};

async function loadSettings() {
  const s = await window.settingsAPI.getSettings();
  originalSettings = s;

  fontSizeSlider.value = s.fontSize || 11;
  fontSizeVal.textContent = `${fontSizeSlider.value}px`;
  fontPreview.style.fontSize = `${fontSizeSlider.value}px`;

  // Theme
  const themeRadio = document.querySelector(`input[name="theme"][value="${s.theme || 'dark'}"]`);
  if (themeRadio) themeRadio.checked = true;

  // Dark color
  const color = s.darkColor || '#00cc44';
  const presetRadio = document.querySelector(`input[name="darkColor"][value="${color}"]`);
  if (presetRadio) {
    presetRadio.checked = true;
  } else {
    // Custom color
    const customRadio = document.querySelector('input[name="darkColor"][value="custom"]');
    if (customRadio) customRadio.checked = true;
    customColorInput.value = color;
  }

  // Altitude viz
  colorByAltCheckbox.checked = s.colorByAltitude !== undefined ? s.colorByAltitude : true;
  thickTrailsCheckbox.checked = s.thickTrailsByAltitude || false;

  // Credentials
  clientIdInput.value = s.openskyClientId || '';
  clientSecretInput.value = s.openskyClientSecret || '';

  updateDarkColorVisibility();
}

function getSelectedTheme() {
  const checked = document.querySelector('input[name="theme"]:checked');
  return checked ? checked.value : 'dark';
}

function getSelectedDarkColor() {
  const checked = document.querySelector('input[name="darkColor"]:checked');
  if (!checked) return '#00cc44';
  if (checked.value === 'custom') return customColorInput.value;
  return checked.value;
}

function updateDarkColorVisibility() {
  const isDark = getSelectedTheme() === 'dark';
  darkColorSection.classList.toggle('hidden', !isDark);
}

// Gather current form state and push to main process
function broadcastSettings() {
  const settings = {
    ...originalSettings,
    fontSize: parseInt(fontSizeSlider.value),
    theme: getSelectedTheme(),
    darkColor: getSelectedDarkColor(),
    colorByAltitude: colorByAltCheckbox.checked,
    thickTrailsByAltitude: thickTrailsCheckbox.checked,
    openskyClientId: clientIdInput.value.trim(),
    openskyClientSecret: clientSecretInput.value,
  };
  window.settingsAPI.updateSettings(settings);
}

// Font size preview + live broadcast
fontSizeSlider.addEventListener('input', () => {
  fontSizeVal.textContent = `${fontSizeSlider.value}px`;
  fontPreview.style.fontSize = `${fontSizeSlider.value}px`;
  broadcastSettings();
});

// Theme change toggles dark color section visibility + live broadcast
document.querySelectorAll('input[name="theme"]').forEach(r => {
  r.addEventListener('change', () => {
    updateDarkColorVisibility();
    broadcastSettings();
  });
});

// Dark color changes
document.querySelectorAll('input[name="darkColor"]').forEach(r => {
  r.addEventListener('change', broadcastSettings);
});

// When custom color picker changes, auto-select the custom radio + broadcast
customColorInput.addEventListener('input', () => {
  const customRadio = document.querySelector('input[name="darkColor"][value="custom"]');
  if (customRadio) customRadio.checked = true;
  broadcastSettings();
});

// Altitude viz checkboxes
colorByAltCheckbox.addEventListener('change', broadcastSettings);
thickTrailsCheckbox.addEventListener('change', broadcastSettings);

// Credentials — broadcast on blur/change (not every keystroke)
clientIdInput.addEventListener('change', broadcastSettings);
clientSecretInput.addEventListener('change', broadcastSettings);

// Done — close the window
document.getElementById('btn-done').addEventListener('click', () => {
  window.settingsAPI.close();
});

// Prevent form submission
document.getElementById('settings-form').addEventListener('submit', (e) => {
  e.preventDefault();
});

loadSettings();
