<template>
  <Transition name="fade">
    <div v-if="ui.loadingCount > 0" class="loading-overlay">
      <div class="spinner" />
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { useUiStore } from '@/stores/ui'
const ui = useUiStore()
</script>

<style lang="scss" scoped>
.loading-overlay {
  position: fixed;
  inset: 0;
  background: rgba(255, 255, 255, 0.35);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
  pointer-events: none;
}

.spinner {
  width: 48px;
  height: 48px;
  border: 4px solid var(--accent-bg);
  border-top-color: var(--button-bg);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.fade-enter-active, .fade-leave-active { transition: opacity 0.2s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
