<template>
  <div id="cesium-container"></div>

  <!-- HUD -->
  <HudClock ref="hudClockRef" />
  <div v-if="throttled" class="throttle-warning">API rate limited — displaying last known positions</div>
  <div class="hud-instructions">
    <div>Ctrl + drag to change perspective.</div>
    <div>Scroll to zoom, drag to pan.</div>
  </div>

  <!-- Controls -->
  <ControlsPanel
    :is2D="camera?.is2D.value ?? false"
    :isRotating="camera?.isRotating.value ?? false"
    @northUp="onNorthUp"
    @conus="onConus"
    @morph="onMorph"
    @openSettings="settingsOpen = true"
    @startRotation="onStartRotation"
    @stopRotation="onStopRotation"
  />

  <!-- Flight search -->
  <FlightSearchResults ref="flightSearchRef" />

  <!-- Aircraft info panel -->
  <AircraftInfoPanel
    @track="onTrack"
    @showRoute="onShowRoute"
  />

  <!-- Context menu -->
  <ContextMenu ref="contextMenuRef" />

  <!-- Settings modal -->
  <SettingsModal v-model="settingsOpen" />
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue';
import { useSettingsStore } from '@/stores/settings';
import { useAircraftStore } from '@/stores/aircraft';
import { useFlightPlanStore } from '@/stores/flightplan';
import { useCesiumViewer } from '@/composables/useCesiumViewer';
import { useCamera, type CameraReturn } from '@/composables/useCamera';
import { usePolling, type PollingReturn } from '@/composables/usePolling';

import HudClock from '@/components/HudClock.vue';
import ControlsPanel from '@/components/ControlsPanel.vue';
import AircraftInfoPanel from '@/components/AircraftInfoPanel.vue';
import FlightSearchResults from '@/components/FlightSearchResults.vue';
import ContextMenu from '@/components/ContextMenu.vue';
import SettingsModal from '@/components/SettingsModal.vue';

// ============================================================
// Stores
// ============================================================

const settingsStore = useSettingsStore();
const aircraftStore = useAircraftStore();
const flightPlanStore = useFlightPlanStore();

// ============================================================
// Settings initialization
// ============================================================

settingsStore.load();
settingsStore.initSystemThemeListener();

// ============================================================
// Composables
// ============================================================

const { viewer, init: initViewer, applyTheme, destroy: destroyViewer } = useCesiumViewer('cesium-container');

// Polling must be set up during setup phase (so watchers register)
const polling: PollingReturn = usePolling(viewer);

// Camera composable
const camera: CameraReturn = useCamera(viewer, {
  setPollInterval: polling.setPollInterval,
  setTickInterval: polling.setTickInterval,
  pollStates: polling.pollStates,
  rateLimitedUntil: polling.rateLimitedUntil,
});

// ============================================================
// Refs
// ============================================================

const settingsOpen = ref(false);
const throttled = ref(false);
const hudClockRef = ref<InstanceType<typeof HudClock>>();
const contextMenuRef = ref<InstanceType<typeof ContextMenu>>();
const flightSearchRef = ref<InstanceType<typeof FlightSearchResults>>();

// ============================================================
// Watch for rate limiting
// ============================================================

watch(polling.rateLimitedUntil, (val) => {
  throttled.value = val > Date.now();
  if (throttled.value) {
    setTimeout(() => { throttled.value = false; }, val - Date.now());
  }
});

// ============================================================
// Lifecycle
// ============================================================

onMounted(async () => {
  // Initialize the Cesium viewer (needs DOM)
  initViewer();

  // Apply initial theme
  await applyTheme();

  // Wire stores to viewer
  const v = viewer.value;
  if (v) {
    aircraftStore.setViewer(v);
    flightPlanStore.setViewer(v);

    // Start camera handler and polling
    camera.startCameraHandler();
    polling.startPolling();

    // Set up context menu on Cesium canvas
    v.canvas.addEventListener('contextmenu', (e: Event) => e.preventDefault());

    const { ScreenSpaceEventHandler, ScreenSpaceEventType } = await import('cesium');
    const contextHandler = new ScreenSpaceEventHandler(v.canvas);
    contextHandler.setInputAction(async (click: { position: { x: number; y: number } }) => {
      const action = await contextMenuRef.value?.show(
        [
          { id: 'home', label: 'Go home' },
          { id: 'save-view', label: 'Save view' },
        ],
        click.position.x,
        click.position.y,
      );
      if (action === 'home') camera.goHome();
      else if (action === 'save-view') camera.saveView();
    }, ScreenSpaceEventType.RIGHT_CLICK);

    // Mobile: force 2D mode
    if (camera.isMobile()) {
      setTimeout(() => {
        if (!camera.is2D.value) camera.morphAndPreserveView(false);
      }, 500);
    }
  }

  // Visibility change handler — pause/resume timers
  document.addEventListener('visibilitychange', onVisibilityChange);

  // Keyboard shortcuts
  document.addEventListener('keydown', onKeyDown);

  // Mobile layout change
  window.matchMedia('(max-width: 767px)').addEventListener('change', onMediaChange);

  console.log('[FlightRadar] Vue app initialized');
});

onUnmounted(() => {
  camera.stopCameraHandler();
  camera.stopRotation();
  polling.stopPolling();
  destroyViewer();
  document.removeEventListener('visibilitychange', onVisibilityChange);
  document.removeEventListener('keydown', onKeyDown);
});

// ============================================================
// Event handlers
// ============================================================

function onVisibilityChange(): void {
  if (document.hidden) {
    polling.pauseAllTimers();
    hudClockRef.value?.stopClock();
  } else {
    polling.resumeAllTimers();
    hudClockRef.value?.startClock();
  }
}

function onKeyDown(e: KeyboardEvent): void {
  // Don't handle shortcuts when typing in input fields
  if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA') return;

  switch (e.key.toLowerCase()) {
    case 'r':
      if (!camera.is2D.value) {
        if (camera.isRotating.value) {
          camera.isRotating.value = false;
          camera.stopRotation();
        } else {
          camera.isRotating.value = true;
          camera.stopTracking();
          camera.startRotation();
        }
      }
      break;
    case 'h':
      camera.goHome();
      break;
    case 'escape':
      if (settingsOpen.value) {
        settingsOpen.value = false;
      } else if (flightPlanStore.infoPanelVisible) {
        flightPlanStore.deselectAircraft();
      }
      break;
    case '2':
      if (!camera.is2D.value) camera.morphAndPreserveView(false);
      break;
    case '3':
      if (camera.is2D.value) camera.morphAndPreserveView(true);
      break;
    case 'n':
      onNorthUp();
      break;
  }
}

function onMediaChange(e: MediaQueryListEvent): void {
  if (e.matches && !camera.is2D.value) {
    camera.morphAndPreserveView(false);
  }
}

function onNorthUp(): void {
  const v = viewer.value;
  if (!v) return;
  v.camera.flyTo({
    destination: v.camera.positionWC,
    orientation: { heading: 0, pitch: v.camera.pitch, roll: 0 },
    duration: 0.5,
  });
}

async function onConus(): Promise<void> {
  const v = viewer.value;
  if (!v) return;
  const { Cartesian3 } = await import('cesium');
  v.camera.flyTo({
    destination: Cartesian3.fromDegrees(-98.5, 39.5, 4860000),
    duration: 1.5,
  });
}

function onMorph(to3D: boolean): void {
  camera.morphAndPreserveView(to3D);
}

function onStartRotation(): void {
  camera.isRotating.value = true;
  camera.stopTracking();
  camera.startRotation();
}

function onStopRotation(): void {
  camera.isRotating.value = false;
  camera.stopRotation();
}

function onTrack(): void {
  const v = viewer.value;
  if (!v || !aircraftStore.selectedIcao) return;
  const ac = aircraftStore.aircraft.get(aircraftStore.selectedIcao);
  if (ac?.entity) {
    v.trackedEntity = ac.entity;
    camera.isTracking.value = true;
  }
}

function onShowRoute(): void {
  if (flightPlanStore.selectedRouteFlight && flightPlanStore.activeFlightPlan) {
    flightPlanStore.displayFlightPlanRoute(
      flightPlanStore.activeFlightPlan,
      flightPlanStore.selectedRouteFlight,
    );
  }
}
</script>
