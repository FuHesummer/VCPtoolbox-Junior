<template>
  <Transition name="toast">
    <div v-if="ui.message" class="message-popup" :class="ui.message.type">
      {{ ui.message.text }}
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { useUiStore } from '@/stores/ui'
const ui = useUiStore()
</script>

<style lang="scss" scoped>
.message-popup {
  position: fixed;
  top: calc(var(--topbar-height) + 16px);
  right: 20px;
  padding: 12px 20px;
  border-radius: var(--radius-md);
  background: var(--tertiary-bg);
  color: var(--primary-text);
  box-shadow: var(--card-shadow);
  border: var(--card-border);
  font-size: 14px;
  z-index: 9999;
  max-width: 360px;

  &.success { border-left: 4px solid #6dbb8a; }
  &.error   { border-left: 4px solid var(--danger-color); }
  &.warning { border-left: 4px solid #e6a94c; }
  &.info    { border-left: 4px solid var(--highlight-text); }
}

.toast-enter-active, .toast-leave-active {
  transition: all 0.25s ease;
}
.toast-enter-from, .toast-leave-to {
  opacity: 0;
  transform: translateX(20px);
}
</style>
