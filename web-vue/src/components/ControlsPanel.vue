<template>
  <div class="bottom-sheet" :class="{ collapsed: bottomSheetCollapsed }" ref="bottomSheetEl">
    <div class="controls-panel" :class="{ collapsed: panelCollapsed }">
      <button class="panel-toggle controls-toggle" aria-label="Toggle controls panel"
              @click="panelCollapsed = !panelCollapsed">
        <svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M15 19l-7-7 7-7z"/></svg>
      </button>
      <div class="sheet-handle" @click="bottomSheetCollapsed = !bottomSheetCollapsed"></div>

      <!-- Aircraft toggles -->
      <div class="control-group">
        <label class="toggle-label">
          <input type="checkbox" v-model="aircraftEnabled" @change="onAircraftToggle">
          <span>All aircraft</span>
        </label>
        <label class="toggle-label">
          <input type="checkbox" v-model="labelsEnabled" :disabled="!aircraftEnabled" @change="onLabelsToggle">
          <span>Data blocks</span>
        </label>
        <span class="map-layer-label-text">Map</span>
        <div class="map-layer-select" :class="{ open: mapMenuOpen }" ref="mapSelectEl">
          <button class="map-layer-btn" type="button" @click.stop="mapMenuOpen = !mapMenuOpen">
            <span class="map-layer-label">{{ mapLayerLabel }}</span>
            <svg class="map-layer-chevron" viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M7 10l5 5 5-5z"/></svg>
          </button>
          <div class="map-layer-menu">
            <div v-for="opt in mapOptions" :key="opt.value"
                 class="map-layer-option"
                 :class="{ selected: settingsStore.settings.mapLayer === opt.value }"
                 @click="selectMapLayer(opt.value)">
              {{ opt.label }}
            </div>
          </div>
        </div>
      </div>

      <!-- Weather toggles -->
      <div class="control-group">
        <label class="toggle-label">
          <input type="checkbox" v-model="satelliteIREnabled" @change="onWeatherToggle('satelliteIREnabled')">
          <span>IR</span>
        </label>
        <label class="toggle-label">
          <input type="checkbox" v-model="radarEnabled" @change="onWeatherToggle('radarEnabled')">
          <span>Radar</span>
        </label>
        <label class="toggle-label">
          <input type="checkbox" v-model="sigmetsEnabled" @change="onWeatherToggle('sigmetsEnabled')">
          <span>SIGMETs</span>
        </label>
        <label class="toggle-label">
          <input type="checkbox" v-model="airmetsEnabled" @change="onWeatherToggle('airmetsEnabled')">
          <span>AIRMETs</span>
        </label>
        <label class="toggle-label">
          <input type="checkbox" v-model="pirepsEnabled" @change="onWeatherToggle('pirepsEnabled')">
          <span>PIREPs</span>
        </label>
        <label class="toggle-label">
          <input type="checkbox" v-model="turbForecastEnabled" @change="onWeatherToggle('turbForecastEnabled')">
          <span>GTG</span>
        </label>
      </div>

      <!-- View controls -->
      <div class="control-group">
        <button class="scope-btn btn-north" @click="$emit('northUp')">North &#8593;</button>
        <button class="scope-btn" @click="$emit('conus')">CONUS</button>
        <div class="scope-btn-group">
          <button class="scope-btn" :class="{ active: is2D }" @click="$emit('morph', false)">2D</button>
          <button class="scope-btn" :class="{ active: !is2D }" @click="$emit('morph', true)">3D</button>
        </div>
        <label class="toggle-label">
          <input type="checkbox" class="toggle-rotate" v-model="rotating" :disabled="is2D" @change="onRotateToggle">
          <span>Auto rotate</span>
        </label>
        <button class="scope-btn scope-btn-icon btn-settings" aria-label="Settings" title="Settings"
                @click="$emit('openSettings')">
          <svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94L14.4 2.81c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41L9.25 5.35C8.66 5.59 8.12 5.92 7.63 6.29L5.24 5.33c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.22-.07.47.12.61l2.03 1.58C4.84 11.36 4.8 11.69 4.8 12s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61L19.14 12.94zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue';
import { useSettingsStore } from '@/stores/settings';
import { useAircraftStore } from '@/stores/aircraft';

const settingsStore = useSettingsStore();
const aircraftStore = useAircraftStore();

const props = defineProps<{
  is2D: boolean;
  isRotating: boolean;
}>();

const emit = defineEmits<{
  northUp: [];
  conus: [];
  morph: [to3D: boolean];
  openSettings: [];
  startRotation: [];
  stopRotation: [];
}>();

const panelCollapsed = ref(false);
const bottomSheetCollapsed = ref(false);
const mapMenuOpen = ref(false);
const bottomSheetEl = ref<HTMLElement>();
const mapSelectEl = ref<HTMLElement>();

// Local state synced from settings store
const aircraftEnabled = ref(settingsStore.settings.aircraftEnabled);
const labelsEnabled = ref(settingsStore.settings.labelsEnabled);
const satelliteIREnabled = ref(settingsStore.settings.satelliteIREnabled);
const radarEnabled = ref(settingsStore.settings.radarEnabled);
const sigmetsEnabled = ref(settingsStore.settings.sigmetsEnabled);
const airmetsEnabled = ref(settingsStore.settings.airmetsEnabled);
const pirepsEnabled = ref(settingsStore.settings.pirepsEnabled);
const turbForecastEnabled = ref(settingsStore.settings.turbForecastEnabled);
const rotating = ref(props.isRotating);

// Watch props.isRotating to sync local state
watch(() => props.isRotating, (val) => { rotating.value = val; });

// Watch settings store to sync local state
watch(() => settingsStore.settings.aircraftEnabled, (val) => { aircraftEnabled.value = val; });
watch(() => settingsStore.settings.labelsEnabled, (val) => { labelsEnabled.value = val; });

const mapOptions = [
  { value: 'noLabels', label: 'Simple' },
  { value: 'carto', label: 'Simple (Labels)' },
  { value: 'esriGray', label: 'Gray Canvas' },
  { value: 'satellite', label: 'Satellite' },
  { value: 'osm', label: 'OpenStreetMap' },
  { value: 'topo', label: 'Topographic' },
  { value: 'night', label: 'Night Lights' },
  { value: 'vfrHybrid', label: 'VFR Charts' },
  { value: 'vfrIfrLow', label: 'IFR Low Charts' },
  { value: 'vfrIfrHigh', label: 'IFR High Charts' },
];

const mapLayerLabel = ref(
  mapOptions.find(o => o.value === settingsStore.settings.mapLayer)?.label || 'Simple'
);

watch(() => settingsStore.settings.mapLayer, (val) => {
  mapLayerLabel.value = mapOptions.find(o => o.value === val)?.label || 'Simple';
});

function onAircraftToggle(): void {
  settingsStore.update('aircraftEnabled', aircraftEnabled.value);
  aircraftStore.toggleAircraft(aircraftEnabled.value);
}

function onLabelsToggle(): void {
  settingsStore.update('labelsEnabled', labelsEnabled.value);
  aircraftStore.renderAircraft();
}

function onWeatherToggle(key: string): void {
  const map: Record<string, boolean> = {
    satelliteIREnabled: satelliteIREnabled.value,
    radarEnabled: radarEnabled.value,
    sigmetsEnabled: sigmetsEnabled.value,
    airmetsEnabled: airmetsEnabled.value,
    pirepsEnabled: pirepsEnabled.value,
    turbForecastEnabled: turbForecastEnabled.value,
  };
  if (key in map) {
    settingsStore.update(key as keyof typeof settingsStore.settings, map[key]);
  }
}

function selectMapLayer(value: string): void {
  mapMenuOpen.value = false;
  settingsStore.update('mapLayer', value);
}

function onRotateToggle(): void {
  if (props.is2D) {
    rotating.value = false;
    return;
  }
  if (rotating.value) {
    emit('startRotation');
  } else {
    emit('stopRotation');
  }
}

// Close map menu on outside click
function onDocClick(): void {
  mapMenuOpen.value = false;
}

// Mobile: swipe detection for bottom sheet
let _sy = 0;
let _sx = 0;

function onTouchStart(e: TouchEvent): void {
  _sy = e.touches[0].clientY;
  _sx = e.touches[0].clientX;
}

function onTouchEnd(e: TouchEvent): void {
  if (!window.matchMedia('(max-width: 767px)').matches) return;
  const dy = e.changedTouches[0].clientY - _sy;
  const dx = e.changedTouches[0].clientX - _sx;
  if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 50) {
    bottomSheetCollapsed.value = dy > 0;
  }
}

// Mobile: start collapsed
onMounted(() => {
  document.addEventListener('click', onDocClick);
  if (window.matchMedia('(max-width: 767px)').matches) {
    bottomSheetCollapsed.value = true;
  }
  bottomSheetEl.value?.addEventListener('touchstart', onTouchStart, { passive: true });
  bottomSheetEl.value?.addEventListener('touchend', onTouchEnd, { passive: true });
});

onUnmounted(() => {
  document.removeEventListener('click', onDocClick);
  bottomSheetEl.value?.removeEventListener('touchstart', onTouchStart);
  bottomSheetEl.value?.removeEventListener('touchend', onTouchEnd);
});
</script>
