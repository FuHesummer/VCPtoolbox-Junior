<template>
  <header class="page-header">
    <div class="title-group">
      <span v-if="icon" class="material-symbols-outlined icon">{{ icon }}</span>
      <div>
        <h2>{{ title }}</h2>
        <p v-if="subtitle" class="subtitle">{{ subtitle }}</p>
      </div>
    </div>
    <div class="actions">
      <slot name="actions" />
    </div>
  </header>
</template>

<script setup lang="ts">
defineProps<{
  title: string
  subtitle?: string
  icon?: string
}>()
</script>

<style lang="scss" scoped>
.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 24px;
  gap: 16px;
  flex-wrap: wrap;
}

.title-group {
  display: flex;
  align-items: center;
  gap: 12px;

  .icon {
    font-size: 32px;
    color: var(--highlight-text);
  }

  h2 {
    margin: 0;
    font-size: 20px;
    color: var(--primary-text);
  }

  .subtitle {
    margin: 2px 0 0;
    font-size: 13px;
    color: var(--secondary-text);
  }
}

.actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
</style>
