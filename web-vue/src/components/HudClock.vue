<template>
  <div class="hud">
    <div class="hud-stats">
      <span class="hud-clock">{{ clockText }}</span>
      <span class="hud-sep">|</span>
      <span>Tracks: <span>{{ trackCount }}</span></span>
      <span class="hud-sep">|</span>
      <span>Updated: <span>{{ lastUpdate }}</span></span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue';
import { useAircraftStore } from '@/stores/aircraft';

const aircraftStore = useAircraftStore();

const clockText = ref('--:--:--Z');
let clockTimer: ReturnType<typeof setInterval> | null = null;

const trackCount = computed(() => aircraftStore.aircraft.size);

const lastUpdate = computed(() => {
  const t = aircraftStore.lastPollTime;
  if (!t) return '--:--:--';
  return t.toUTCString().slice(17, 25);
});

function updateClock(): void {
  const now = new Date();
  const utc = now.toUTCString().slice(17, 25);
  clockText.value = `${utc}Z`;
}

function startClock(): void {
  if (!clockTimer) clockTimer = setInterval(updateClock, 1000);
}

function stopClock(): void {
  if (clockTimer) { clearInterval(clockTimer); clockTimer = null; }
}

onMounted(() => {
  updateClock();
  startClock();
});

onUnmounted(() => {
  stopClock();
});

defineExpose({ startClock, stopClock });
</script>
