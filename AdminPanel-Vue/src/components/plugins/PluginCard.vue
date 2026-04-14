<template>
  <div class="plugin-card card" :class="{ enabled: plugin.enabled }" @click="$emit('open', plugin)">
    <div class="header">
      <strong class="name">{{ plugin.manifest.displayName || plugin.manifest.name }}</strong>
      <span class="version">v{{ plugin.manifest.version || '?' }}</span>
    </div>
    <p class="desc">{{ plugin.manifest.description || '（无描述）' }}</p>
    <div class="meta">
      <span class="tag">{{ plugin.manifest.pluginType || '?' }}</span>
      <span v-if="plugin.manifest.dashboardCards?.length" class="tag ui" title="提供仪表盘卡片">
        <span class="material-symbols-outlined">dashboard</span>
      </span>
      <span v-if="plugin.manifest.adminNav" class="tag ui" title="提供侧边栏页面">
        <span class="material-symbols-outlined">left_panel_open</span>
      </span>
      <span v-if="plugin.manifest.requires?.length" class="tag dep" :title="`依赖：${plugin.manifest.requires.join(', ')}`">
        <span class="material-symbols-outlined">link</span>
      </span>
    </div>
    <label class="toggle" @click.stop>
      <input
        type="checkbox"
        :checked="plugin.enabled"
        @change="$emit('toggle', plugin, ($event.target as HTMLInputElement).checked)"
      />
      <span class="toggle-track"><span class="toggle-thumb" /></span>
    </label>
  </div>
</template>

<script setup lang="ts">
import type { PluginInfo, PluginUiPrefs } from '@/api/types'

defineProps<{
  plugin: PluginInfo
  uiPrefs?: PluginUiPrefs[string]
}>()

defineEmits<{
  open: [plugin: PluginInfo]
  toggle: [plugin: PluginInfo, enabled: boolean]
}>()
</script>

<style lang="scss" scoped>
.plugin-card {
  position: relative;
  padding: 14px 16px;
  cursor: pointer;
  transition: transform 0.15s, box-shadow 0.15s;

  &:hover {
    transform: translateY(-2px);
    box-shadow: 0 6px 24px rgba(180, 120, 140, 0.15);
  }

  &.enabled {
    border-left: 3px solid var(--button-bg);
  }
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 6px;

  .name { font-size: 14px; color: var(--primary-text); }
  .version { font-size: 11px; color: var(--secondary-text); }
}

.desc {
  font-size: 12px;
  color: var(--secondary-text);
  margin: 0 0 10px;
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.meta {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;

  .tag {
    background: var(--accent-bg);
    padding: 2px 8px;
    border-radius: var(--radius-pill);
    font-size: 10px;
    color: var(--secondary-text);
    display: inline-flex;
    align-items: center;
    gap: 3px;

    .material-symbols-outlined { font-size: 12px; }

    &.ui { color: var(--highlight-text); }
    &.dep { color: #c08a1f; }
  }
}

.toggle {
  position: absolute;
  top: 14px;
  right: 16px;
  cursor: pointer;

  input { display: none; }

  .toggle-track {
    display: inline-block;
    width: 36px;
    height: 20px;
    background: var(--border-color);
    border-radius: 10px;
    position: relative;
    transition: background 0.2s;
  }

  .toggle-thumb {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 16px;
    height: 16px;
    background: #fff;
    border-radius: 50%;
    transition: transform 0.2s;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
  }

  input:checked ~ .toggle-track {
    background: var(--button-bg);

    .toggle-thumb { transform: translateX(16px); }
  }
}
</style>
