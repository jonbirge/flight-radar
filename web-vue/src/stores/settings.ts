/**
 * Settings Pinia store.
 * Replaces the global CONFIG object for all user-configurable state.
 *
 * Manages:
 * - Loading/saving settings from localStorage
 * - Theme resolution (system/dark/light → resolved dark/light)
 * - Derived color computation (phosphor, trail, label colors)
 * - Settings change broadcasting
 */

import { defineStore } from 'pinia';
import { ref, computed, watch } from 'vue';
import type { Settings, DerivedColors } from '@/core/types';
import { DEFAULT_SETTINGS } from '@/core/defaults';
import { deriveDarkColors, deriveLightColors } from '@/core/colors';
import {
  loadSettings as loadFromStorage,
  saveSettings as saveToStorage,
  getSystemTheme,
  onSystemThemeChanged,
} from '@/services/settings-service';

export const useSettingsStore = defineStore('settings', () => {
  // ============================================================
  // State
  // ============================================================

  const settings = ref<Settings>({ ...DEFAULT_SETTINGS });
  const resolvedTheme = ref<'dark' | 'light'>('dark');
  const derivedColors = ref<DerivedColors>(deriveDarkColors(DEFAULT_SETTINGS.darkColor));

  // ============================================================
  // Getters
  // ============================================================

  const isDark = computed(() => resolvedTheme.value === 'dark');

  const phosphor = computed(() => derivedColors.value.phosphor);
  const phosphorBright = computed(() => derivedColors.value.phosphorBright);
  const phosphorSelect = computed(() => derivedColors.value.phosphorSelect);
  const phosphorDim = computed(() => derivedColors.value.phosphorDim);
  const trailColor = computed(() => derivedColors.value.trailColor);

  // ============================================================
  // Actions
  // ============================================================

  /** Load settings from localStorage and apply theme */
  function load(): void {
    settings.value = loadFromStorage();
    resolveTheme();
    updateDerivedColors();
  }

  /** Save current settings to localStorage */
  function save(): void {
    saveToStorage(settings.value);
  }

  /** Update a single setting and persist */
  function update<K extends keyof Settings>(key: K, value: Settings[K]): void {
    settings.value[key] = value;
    save();

    // Re-derive colors if theme-related setting changed
    if (key === 'theme' || key === 'darkColor' || key === 'lightColor') {
      resolveTheme();
      updateDerivedColors();
    }
  }

  /** Merge partial settings (e.g., from settings form) and persist */
  function merge(partial: Partial<Settings>): void {
    settings.value = { ...settings.value, ...partial };
    save();
    resolveTheme();
    updateDerivedColors();
  }

  /** Reset all settings to defaults */
  function reset(): void {
    settings.value = { ...DEFAULT_SETTINGS };
    save();
    resolveTheme();
    updateDerivedColors();
  }

  // ============================================================
  // Theme Resolution
  // ============================================================

  function resolveTheme(): void {
    const pref = settings.value.theme;
    if (pref === 'dark' || pref === 'light') {
      resolvedTheme.value = pref;
    } else {
      resolvedTheme.value = getSystemTheme();
    }
  }

  function updateDerivedColors(): void {
    if (resolvedTheme.value === 'dark') {
      derivedColors.value = deriveDarkColors(settings.value.darkColor);
    } else {
      derivedColors.value = deriveLightColors(settings.value.lightColor);
    }
  }

  /** Listen for OS theme changes (only matters when theme pref is 'system') */
  function initSystemThemeListener(): void {
    onSystemThemeChanged(() => {
      if (settings.value.theme === 'system') {
        resolveTheme();
        updateDerivedColors();
      }
    });
  }

  // ============================================================
  // Watchers
  // ============================================================

  // Auto-save when settings change (debounced by Vue's microtask batching)
  watch(settings, () => save(), { deep: true });

  return {
    // State
    settings,
    resolvedTheme,
    derivedColors,

    // Getters
    isDark,
    phosphor,
    phosphorBright,
    phosphorSelect,
    phosphorDim,
    trailColor,

    // Actions
    load,
    save,
    update,
    merge,
    reset,
    initSystemThemeListener,
  };
});
