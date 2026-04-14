<template>
  <div class="empty-state">
    <span class="material-symbols-outlined">{{ icon }}</span>
    <p>{{ message }}</p>
    <slot />
  </div>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  icon?: string
  message?: string
}>(), { icon: 'inbox', message: '暂无数据' })
</script>

<style lang="scss" scoped>
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 20px;
  color: var(--secondary-text);
  gap: 10px;

  .material-symbols-outlined {
    font-size: 48px;
    opacity: 0.5;
  }

  p {
    margin: 0;
    font-size: 14px;
  }
}
</style>
