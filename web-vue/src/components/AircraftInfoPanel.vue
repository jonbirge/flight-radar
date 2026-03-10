<template>
  <div v-if="flightPlanStore.infoPanelVisible"
       class="aircraft-info-panel"
       :class="{ collapsed: panelCollapsed, 'mob-collapsed': mobCollapsed }"
       ref="panelEl">
    <button class="panel-toggle info-toggle" aria-label="Toggle info panel"
            @click="panelCollapsed = !panelCollapsed">
      <svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M7 15l5-5 5 5z"/></svg>
    </button>
    <button class="scope-btn info-close" @click="onClose">&times;</button>
    <div class="info-callsign">{{ data?.callsign || '---' }}</div>
    <div class="info-collapsible">
      <div class="info-details">
        <div v-for="(value, key) in data?.details" :key="key">
          <span class="label">{{ key }}</span>
          <span>{{ value }}</span>
        </div>
      </div>
      <div v-if="aircraftStore.selectedIcao" class="info-buttons">
        <button class="scope-btn" @click="$emit('track')">Track</button>
        <button class="scope-btn" @click="$emit('showRoute')">Show Route</button>
      </div>
    </div>
    <div class="sheet-handle" @click="mobCollapsed = !mobCollapsed"></div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useFlightPlanStore } from '@/stores/flightplan';
import { useAircraftStore } from '@/stores/aircraft';

const flightPlanStore = useFlightPlanStore();
const aircraftStore = useAircraftStore();

defineEmits<{
  track: [];
  showRoute: [];
}>();

const panelCollapsed = ref(false);
const mobCollapsed = ref(false);
const panelEl = ref<HTMLElement>();

const data = computed(() => flightPlanStore.infoPanelData);

function onClose(): void {
  flightPlanStore.deselectAircraft();
}

// Mobile: swipe detection
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
    mobCollapsed.value = dy < 0;
  }
}

onMounted(() => {
  panelEl.value?.addEventListener('touchstart', onTouchStart, { passive: true });
  panelEl.value?.addEventListener('touchend', onTouchEnd, { passive: true });
});

onUnmounted(() => {
  panelEl.value?.removeEventListener('touchstart', onTouchStart);
  panelEl.value?.removeEventListener('touchend', onTouchEnd);
});
</script>
