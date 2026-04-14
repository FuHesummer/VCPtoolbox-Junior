<template>
  <div class="page plugin-nav-page">
    <PageHeader
      :title="displayTitle"
      :subtitle="manifest?.description || `插件：${name}`"
      :icon="manifest?.adminNav?.icon || 'extension'"
    />
    <div class="content-area">
      <EmptyState v-if="error" icon="error" :message="error" />
      <iframe
        v-else
        :key="name"
        :src="iframeSrc"
        class="plugin-iframe"
        referrerpolicy="same-origin"
        @error="onIframeError"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import PageHeader from '@/components/common/PageHeader.vue'
import EmptyState from '@/components/common/EmptyState.vue'
import { listPlugins } from '@/api/plugins'
import type { PluginInfo, PluginManifest } from '@/api/types'

const props = defineProps<{ name: string }>()

const manifest = ref<PluginManifest | null>(null)
const error = ref('')

// iframe 走后端的 /admin-page 端点，完整 HTML 直接渲染
// 沙箱隔离，插件的 body/html/全局样式不会污染管理面板
const iframeSrc = computed(() => `/admin_api/plugins/${encodeURIComponent(props.name)}/admin-page`)

const displayTitle = computed(() => {
  if (manifest.value) {
    return manifest.value.adminNav?.title
      || manifest.value.displayName
      || manifest.value.name
      || props.name
  }
  return props.name
})

async function loadManifest() {
  error.value = ''
  try {
    const plugins = (await listPlugins({ suppressErrorToast: true })) as PluginInfo[]
    const found = plugins.find((p) => p.manifest.name === props.name)
    manifest.value = found?.manifest || null
    if (!found) {
      error.value = `找不到插件 ${props.name}`
    }
  } catch (e) {
    error.value = `加载插件信息失败：${(e as Error).message}`
  }
}

function onIframeError() {
  error.value = '插件页面加载失败'
}

watch(() => props.name, loadManifest)
onMounted(loadManifest)
</script>

<style lang="scss" scoped>
.plugin-nav-page {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.content-area {
  flex: 1;
  padding: 0 24px 24px;
  min-height: 400px;
  display: flex;
  flex-direction: column;
}

.plugin-iframe {
  flex: 1;
  width: 100%;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  background: #fff;
  min-height: 600px;
}
</style>
