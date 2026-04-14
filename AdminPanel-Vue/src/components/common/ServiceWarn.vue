<template>
  <div class="service-warn card">
    <span class="material-symbols-outlined">{{ icon }}</span>
    <div>
      <strong>{{ title }}</strong>
      <p>
        <slot>{{ message }}</slot>
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  title: string
  message?: string
  icon?: string
}>(), { message: '', icon: 'warning' })
</script>

<style lang="scss" scoped>
.service-warn {
  padding: 14px 18px;
  display: flex;
  align-items: flex-start;
  gap: 12px;
  border-left: 4px solid #e6a94c;
  background: rgba(230, 169, 76, 0.06);

  .material-symbols-outlined {
    color: #e6a94c;
    font-size: 24px;
  }

  strong { display: block; font-size: 14px; color: var(--primary-text); margin-bottom: 4px; }
  p { margin: 0; font-size: 12px; color: var(--secondary-text); line-height: 1.6; }

  :deep(code) {
    background: var(--accent-bg);
    padding: 1px 6px;
    border-radius: 3px;
    font-family: 'JetBrains Mono', Consolas, monospace;
    font-size: 11px;
  }
}
</style>
