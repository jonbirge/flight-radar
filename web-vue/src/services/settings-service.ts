/**
 * Settings persistence service.
 * Ported from web/app.js settings section.
 *
 * Uses localStorage for both browser and Capacitor (Capacitor
 * supports localStorage via its WebView).
 */

import type { Settings } from '@/core/types';
import { DEFAULT_SETTINGS } from '@/core/defaults';

const STORAGE_KEY = 'flightRadar_settings';

/**
 * Load saved settings from localStorage, merged with defaults.
 * Missing keys are filled from DEFAULT_SETTINGS.
 */
export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    }
  } catch (err) {
    console.error('[Settings] Load error:', (err as Error).message);
  }
  return { ...DEFAULT_SETTINGS };
}

/**
 * Save settings to localStorage.
 */
export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (err) {
    console.error('[Settings] Save error:', (err as Error).message);
  }
}

/**
 * Clear all saved settings (resets to defaults on next load).
 */
export function clearSettings(): void {
  localStorage.removeItem(STORAGE_KEY);
}

/**
 * Detect system theme preference.
 */
export function getSystemTheme(): 'dark' | 'light' {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/**
 * Listen for system theme changes.
 */
export function onSystemThemeChanged(callback: (theme: 'dark' | 'light') => void): void {
  window.matchMedia('(prefers-color-scheme: dark)')
    .addEventListener('change', (e) => callback(e.matches ? 'dark' : 'light'));
}
