<template>
  <div class="page plugin-nav-page">
    <PageHeader :title="displayTitle" :subtitle="manifest?.description || `插件：${name}`" :icon="manifest?.adminNav?.icon || 'extension'" />
    <div class="content-area" ref="contentRoot">
      <EmptyState v-if="loading" icon="sync" message="加载插件页面..." />
      <EmptyState v-else-if="error" icon="error" :message="error" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import PageHeader from '@/components/common/PageHeader.vue'
import EmptyState from '@/components/common/EmptyState.vue'
import { listPlugins } from '@/api/plugins'
import type { PluginInfo, PluginManifest } from '@/api/types'

const props = defineProps<{ name: string }>()

const contentRoot = ref<HTMLElement>()
const manifest = ref<PluginManifest | null>(null)
const loading = ref(false)
const error = ref('')

const displayTitle = (): string => {
  if (manifest.value) {
    return manifest.value.adminNav?.title
      || manifest.value.displayName
      || manifest.value.name
      || props.name
  }
  return props.name
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    // 取 manifest 信息
    const plugins = (await listPlugins()) as PluginInfo[]
    manifest.value = plugins.find((p) => p.manifest.name === props.name)?.manifest || null

    // 取插件的 admin-page HTML
    const resp = await fetch(
      `/admin_api/plugins/${encodeURIComponent(props.name)}/admin-page`,
      { credentials: 'same-origin' },
    )
    if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`)
    const html = await resp.text()
    injectHtml(extractBody(html))
  } catch (e) {
    error.value = `加载插件页面失败：${(e as Error).message}`
  } finally {
    loading.value = false
  }
}

function extractBody(html: string): string {
  if (!html.includes('<html') && !html.includes('<!DOCTYPE') && !html.includes('<!doctype')) return html
  const parser = new DOMParser()
  const doc = parser.parseFromString(html, 'text/html')
  let headStyles = ''
  doc.head.querySelectorAll('style, link[rel="stylesheet"]').forEach((el) => { headStyles += el.outerHTML })
  return headStyles + doc.body.innerHTML
}

function injectHtml(html: string) {
  if (!contentRoot.value) return
  contentRoot.value.innerHTML = html
  const prefix = `/admin_api/plugins/${encodeURIComponent(props.name)}/admin-assets/`

  // 重写 <script>
  contentRoot.value.querySelectorAll('script').forEach((oldScript) => {
    const s = document.createElement('script')
    if (oldScript.src) {
      s.src = oldScript.src.startsWith('http') || oldScript.src.startsWith('/')
        ? oldScript.src
        : prefix + oldScript.src
    } else {
      s.textContent = oldScript.textContent
    }
    oldScript.replaceWith(s)
  })

  // 重写 <link rel=stylesheet>
  contentRoot.value.querySelectorAll('link[rel="stylesheet"]').forEach((el) => {
    const href = el.getAttribute('href')
    if (href && !href.startsWith('http') && !href.startsWith('/')) {
      (el as HTMLLinkElement).href = prefix + href
    }
  })

  // 重写 <img>
  contentRoot.value.querySelectorAll('img').forEach((el) => {
    const src = el.getAttribute('src')
    if (src && !src.startsWith('http') && !src.startsWith('/') && !src.startsWith('data:')) {
      (el as HTMLImageElement).src = prefix + src
    }
  })
}

watch(() => props.name, load)
onMounted(load)
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
  min-height: 200px;
}
</style>
