<template>
  <div class="page">
    <PageHeader title="占位符查看" subtitle="所有可用的系统占位符（{{VCPxxx}}、{{Tarxxx}}、{{Varxxx}}、{{Sarxxx}} 等）" icon="variables">
      <template #actions>
        <input v-model="search" placeholder="搜索..." class="search" />
        <button class="btn btn-ghost" @click="reload" :disabled="loading"><span class="material-symbols-outlined">refresh</span></button>
      </template>
    </PageHeader>
    <div class="content">
      <div v-if="loading" class="loading">加载中...</div>
      <EmptyState v-else-if="!entries.length" icon="search_off" message="没有占位符" />
      <div v-else class="grid">
        <div v-for="([key, val]) in entries" :key="key" class="card item" @click="copy(key)">
          <code class="key" v-text="wrap(key)" />
          <p class="val">{{ preview(val) }}</p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import PageHeader from '@/components/common/PageHeader.vue'
import EmptyState from '@/components/common/EmptyState.vue'
import { getPlaceholders } from '@/api/config'
import { useUiStore } from '@/stores/ui'

const ui = useUiStore()
const placeholders = ref<Record<string, unknown>>({})
const search = ref('')
const loading = ref(false)

const entries = computed(() => {
  const all = Object.entries(placeholders.value)
  if (!search.value.trim()) return all
  const kw = search.value.toLowerCase()
  return all.filter(([k, v]) => k.toLowerCase().includes(kw) || String(v).toLowerCase().includes(kw))
})

async function reload() {
  loading.value = true
  try {
    const { placeholders: p } = await getPlaceholders()
    placeholders.value = p || {}
  } finally { loading.value = false }
}

function wrap(k: string) { return `{${'{'}${k}${'}'}}` }

function preview(v: unknown) {
  const s = typeof v === 'string' ? v : JSON.stringify(v)
  return s.length > 120 ? s.slice(0, 120) + '...' : s
}

function copy(key: string) {
  const text = wrap(key)
  navigator.clipboard.writeText(text).then(() => {
    ui.showMessage(`已复制 ${text}`, 'success', 1500)
  }).catch(() => ui.showMessage('复制失败', 'error'))
}

onMounted(reload)
</script>

<style lang="scss" scoped>
.content { padding: 0 24px 24px; }
.loading { text-align: center; color: var(--secondary-text); padding: 40px; }
.search { padding: 6px 12px; border-radius: var(--radius-pill); font-size: 13px; width: 200px; }

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 10px;
}

.item {
  padding: 12px;
  cursor: pointer;
  transition: transform 0.15s;

  &:hover { transform: translateY(-2px); }

  .key {
    display: block;
    font-size: 12px;
    color: var(--highlight-text);
    font-family: 'JetBrains Mono', Consolas, monospace;
    margin-bottom: 6px;
  }

  .val {
    margin: 0;
    font-size: 11px;
    color: var(--secondary-text);
    line-height: 1.5;
    max-height: 42px;
    overflow: hidden;
  }
}
</style>
