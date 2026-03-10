<template>
  <div class="flight-search-wrap">
    <div class="flight-search-bar">
      <input type="text"
             class="flight-search-input"
             :placeholder="'Flight # or &quot;flights from SFO to LAX&quot;'"
             autocomplete="off"
             spellcheck="false"
             v-model="searchQuery"
             @keydown.enter="onSearch"
             ref="searchInputEl">
      <button class="search-history-btn" aria-label="Recent searches" title="Recent searches"
              @click="toggleHistory">
        <svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M13 3a9 9 0 0 0-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7a6.97 6.97 0 0 1-4.95-2.05l-1.41 1.41A8.97 8.97 0 0 0 13 21a9 9 0 0 0 0-18zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z"/></svg>
      </button>
    </div>

    <!-- Flight search results -->
    <div v-if="flightPlanStore.flightResultsVisible && flightPlanStore.flightResults.length > 0"
         class="flight-results">
      <div v-for="(flight, idx) in flightPlanStore.flightResults" :key="idx"
           class="flight-result-item"
           @click="onSelectFlight(flight)">
        <span class="flight-result-badge" :class="badgeClass(flight)">{{ badgeText(flight) }}</span>
        <span class="flight-result-ident">{{ flight.ident || flight.ident_iata || '???' }}</span>
        <span class="flight-result-route">{{ routeText(flight) }}</span>
        <span class="flight-result-time">{{ timeText(flight) }}</span>
      </div>
    </div>

    <!-- Search history -->
    <div v-if="historyVisible && searchHistory.length > 0" class="flight-results">
      <div v-for="(item, idx) in searchHistory" :key="idx"
           class="search-history-item"
           @click="onHistoryClick(item)">
        <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M13 3a9 9 0 0 0-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7a6.97 6.97 0 0 1-4.95-2.05l-1.41 1.41A8.97 8.97 0 0 0 13 21a9 9 0 0 0 0-18zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z"/></svg>
        <span class="search-history-ident">{{ item }}</span>
      </div>
    </div>
    <div v-if="historyVisible && searchHistory.length === 0" class="flight-results">
      <div class="search-history-empty">No recent searches</div>
    </div>

    <!-- Search error/loading indicator -->
    <div v-if="flightPlanStore.isSearching" class="flight-results">
      <div class="search-history-empty">Searching...</div>
    </div>
    <div v-if="flightPlanStore.searchError" class="flight-results">
      <div class="search-history-empty">{{ flightPlanStore.searchError }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useFlightPlanStore } from '@/stores/flightplan';
import { useSettingsStore } from '@/stores/settings';
import type { FlightRecord } from '@/stores/flightplan';

const flightPlanStore = useFlightPlanStore();
const settingsStore = useSettingsStore();

const searchQuery = ref('');
const historyVisible = ref(false);
const searchInputEl = ref<HTMLInputElement>();

const searchHistory = computed(() => settingsStore.settings.searchHistory || []);

function onSearch(): void {
  const q = searchQuery.value.trim();
  if (!q) return;
  historyVisible.value = false;
  flightPlanStore.searchFlightPlan(q);

  // Update search history
  const history = [...(settingsStore.settings.searchHistory || [])];
  const idx = history.indexOf(q);
  if (idx !== -1) history.splice(idx, 1);
  history.unshift(q);
  if (history.length > 10) history.length = 10;
  settingsStore.update('searchHistory', history);
}

function toggleHistory(): void {
  historyVisible.value = !historyVisible.value;
  if (historyVisible.value) {
    flightPlanStore.flightResultsVisible = false;
  }
}

function onHistoryClick(item: string): void {
  searchQuery.value = item;
  historyVisible.value = false;
  flightPlanStore.searchFlightPlan(item);
}

function onSelectFlight(flight: FlightRecord): void {
  flightPlanStore.flightResultsVisible = false;
  // Wrap single flight in FAFlightsResponse format expected by displayFlightPlanRoute
  flightPlanStore.displayFlightPlanRoute(
    { flights: [flight] } as Parameters<typeof flightPlanStore.displayFlightPlanRoute>[0],
    flight,
  );
}

function badgeClass(flight: FlightRecord): string {
  if (flight.progress_percent != null) {
    if (flight.progress_percent > 0 && flight.progress_percent < 100) return 'badge-enroute';
    if (flight.progress_percent === 0) return 'badge-upcoming';
  } else {
    if (flight.actual_off && !flight.actual_on) return 'badge-enroute';
    if (!flight.actual_off) return 'badge-upcoming';
  }
  return 'badge-past';
}

function badgeText(flight: FlightRecord): string {
  if (flight.progress_percent != null) {
    if (flight.progress_percent > 0 && flight.progress_percent < 100) return 'En Route';
    if (flight.progress_percent === 0) return 'Upcoming';
    return 'Arrived';
  }
  if (flight.actual_off && !flight.actual_on) return 'En Route';
  if (!flight.actual_off) return 'Upcoming';
  return 'Arrived';
}

function routeText(flight: FlightRecord): string {
  const orig = flight.origin?.code_iata || flight.origin?.code || '';
  const dest = flight.destination?.code_iata || flight.destination?.code || '';
  if (orig && dest) return `${orig} → ${dest}`;
  return '';
}

function timeText(flight: FlightRecord): string {
  const dep = flight.actual_off || flight.estimated_out || flight.scheduled_out;
  if (!dep) return '';
  const d = new Date(dep);
  return d.toUTCString().slice(5, 22);
}

function blur(): void {
  searchInputEl.value?.blur();
}

defineExpose({ blur });
</script>
