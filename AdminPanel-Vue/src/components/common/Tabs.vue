<template>
  <div class="tabs">
    <div class="tab-bar">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        class="tab"
        :class="{ active: tab.key === active }"
        @click="$emit('update:active', tab.key)"
      >
        {{ tab.label }}
      </button>
    </div>
    <div class="tab-content">
      <slot :active="active" />
    </div>
  </div>
</template>

<script setup lang="ts">
interface TabDef {
  key: string
  label: string
}

defineProps<{
  tabs: TabDef[]
  active: string
}>()

defineEmits<{
  'update:active': [key: string]
}>()
</script>

<style lang="scss" scoped>
.tabs {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.tab-bar {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid var(--border-color);
  padding: 0 4px;
}

.tab {
  padding: 8px 16px;
  border: none;
  background: transparent;
  color: var(--secondary-text);
  cursor: pointer;
  font-size: 14px;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  transition: color 0.15s, border-color 0.15s;

  &:hover { color: var(--primary-text); }

  &.active {
    color: var(--highlight-text);
    border-bottom-color: var(--highlight-text);
  }
}

.tab-content {
  flex: 1;
}
</style>
