<template>
  <div id="cesium-container" ref="cesiumContainer"></div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';

const cesiumContainer = ref<HTMLDivElement>();

onMounted(() => {
  // Cesium viewer initialization will be added in Phase 3+
  // For now, this is the scaffold proving the build tooling works
  console.log('[FlightRadar] Vue app mounted, Cesium container ready');
});
</script>

<style>
html, body, #app {
  margin: 0;
  padding: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: #000;
}

#cesium-container {
  width: 100%;
  height: 100%;
}
</style>
