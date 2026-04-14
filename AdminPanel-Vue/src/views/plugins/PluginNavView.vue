<template>
  <div class="page plugin-nav-page">
    <!-- native 模式：直接挂载插件组件（完全原生体验，无 iframe 嵌套） -->
    <template v-if="mode === 'native'">
      <EmptyState v-if="error" icon="error" :message="error" />
      <div v-else-if="!nativeComponent" class="loading-wrap">
        <span class="material-symbols-outlined spin">progress_activity</span>
        <span>加载插件页面...</span>
      </div>
      <component v-else :is="nativeComponent" />
    </template>

    <!-- iframe 模式（默认，兼容老插件） -->
    <template v-else>
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
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch, type Component } from 'vue'
import PageHeader from '@/components/common/PageHeader.vue'
import EmptyState from '@/components/common/EmptyState.vue'
import { listPlugins } from '@/api/plugins'
import { pluginComponents } from '@/plugin-host'
import type { PluginInfo, PluginManifest } from '@/api/types'

const props = defineProps<{ name: string }>()

const manifest = ref<PluginManifest | null>(null)
const error = ref('')
const nativeComponent = shallowRef<Component | null>(null)

const mode = computed<'native' | 'iframe'>(() => {
  if (manifest.value?.adminNav?.type === 'native') return 'native'
  return 'iframe'
})

// iframe 模式下的 src（走后端 admin-page 端点）
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
      return
    }
    // 若是 native 模式，立即加载组件
    if (mode.value === 'native') {
      await loadNativeComponent()
    }
  } catch (e) {
    error.value = `加载插件信息失败：${(e as Error).message}`
  }
}

// 动态加载插件 native entry JS
let injectedScriptEl: HTMLScriptElement | null = null
async function loadNativeComponent() {
  nativeComponent.value = null
  // entry 相对于插件的 admin/ 目录（admin-assets 端点会自动拼前缀）
  const entry = manifest.value?.adminNav?.entry || 'panel.js'

  // 如果已注册（切换回来时），直接取用
  const existing = pluginComponents[props.name]
  if (existing) {
    nativeComponent.value = existing
    return
  }

  // 动态 <script> 加载插件入口（加时间戳绕缓存，方便迭代）
  const url = `/admin_api/plugins/${encodeURIComponent(props.name)}/admin-assets/${entry}?t=${Date.now()}`
  try {
    await new Promise<void>((resolve, reject) => {
      injectedScriptEl = document.createElement('script')
      injectedScriptEl.src = url
      injectedScriptEl.async = false
      injectedScriptEl.onload = () => resolve()
      injectedScriptEl.onerror = () => reject(new Error('script load failed'))
      document.head.appendChild(injectedScriptEl)
    })
    // 等一拍让 script 里的同步 register 生效
    await nextMicrotask()
    const comp = pluginComponents[props.name]
    if (!comp) {
      error.value = `插件 ${props.name} 未通过 __VCPPanel.register() 注册组件`
      return
    }
    nativeComponent.value = comp
  } catch (e) {
    error.value = `加载插件组件失败：${(e as Error).message}（检查 ${entry} 是否存在）`
  }
}

function nextMicrotask() { return Promise.resolve() }

function onIframeError() {
  error.value = '插件页面加载失败'
}

watch(() => props.name, () => {
  // 清理旧的 script 避免残留
  if (injectedScriptEl) {
    injectedScriptEl.remove()
    injectedScriptEl = null
  }
  loadManifest()
})

onMounted(loadManifest)
onBeforeUnmount(() => {
  if (injectedScriptEl) injectedScriptEl.remove()
})
</script>

<style lang="scss" scoped>
.plugin-nav-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.loading-wrap {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--secondary-text);
  font-size: 14px;

  .material-symbols-outlined { font-size: 24px; color: var(--button-bg); }
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

.spin { animation: spin 1s linear infinite; }
@keyframes spin { from { transform: rotate(0); } to { transform: rotate(360deg); } }
</style>
