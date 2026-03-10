<template>
  <div v-if="visible" class="context-menu" :style="{ left: x + 'px', top: y + 'px' }" ref="menuEl">
    <ul>
      <li v-for="item in items" :key="item.id" @click="onSelect(item.id)">{{ item.label }}</li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick } from 'vue';

export interface ContextMenuItem {
  id: string;
  label: string;
}

const visible = ref(false);
const x = ref(0);
const y = ref(0);
const items = ref<ContextMenuItem[]>([]);
const menuEl = ref<HTMLElement>();

let _resolvePromise: ((id: string | null) => void) | null = null;

function show(menuItems: ContextMenuItem[], posX: number, posY: number): Promise<string | null> {
  return new Promise((resolve) => {
    _resolvePromise = resolve;
    items.value = menuItems;

    // Keep menu within viewport
    const menuW = 180;
    const menuH = menuItems.length * 40 + 8;
    x.value = (posX + menuW > window.innerWidth) ? posX - menuW : posX;
    y.value = (posY + menuH > window.innerHeight) ? posY - menuH : posY;
    visible.value = true;

    nextTick(() => {
      setTimeout(() => {
        document.addEventListener('click', dismiss, true);
        document.addEventListener('contextmenu', dismiss, true);
      }, 0);
    });
  });
}

function onSelect(id: string): void {
  close(id);
}

function close(id: string | null = null): void {
  visible.value = false;
  document.removeEventListener('click', dismiss, true);
  document.removeEventListener('contextmenu', dismiss, true);
  if (_resolvePromise) {
    _resolvePromise(id);
    _resolvePromise = null;
  }
}

function dismiss(e: Event): void {
  if (menuEl.value && !menuEl.value.contains(e.target as Node)) {
    close(null);
  }
}

onUnmounted(() => {
  document.removeEventListener('click', dismiss, true);
  document.removeEventListener('contextmenu', dismiss, true);
});

defineExpose({ show, close });
</script>
