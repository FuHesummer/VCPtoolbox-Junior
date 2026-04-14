<template>
  <div class="page">
    <PageHeader title="RAG 调参" subtitle="浪潮 V8 算法参数调整 — 权威位置 modules/rag_params.json" icon="tune">
      <template #actions>
        <button class="btn btn-ghost" @click="reload" :disabled="loading"><span class="material-symbols-outlined">refresh</span></button>
        <button class="btn" @click="save" :disabled="!dirty">保存</button>
      </template>
    </PageHeader>
    <div class="content card">
      <p class="hint">热参数 — 保存后即生效（无需重启）。默认 <code>{}</code>。</p>
      <CodeEditor v-model="json" :rows="28" />
      <p class="vectordb" v-if="vectordb">
        VectorDB：<strong :class="vectordb.success ? 'ok' : 'err'">{{ vectordb.status }}</strong>
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import PageHeader from '@/components/common/PageHeader.vue'
import CodeEditor from '@/components/common/CodeEditor.vue'
import { getRagParams, saveRagParams, getVectorDbStatus } from '@/api/rag'
import { useUiStore } from '@/stores/ui'

const ui = useUiStore()
const json = ref('')
const original = ref('')
const loading = ref(false)
const vectordb = ref<{ success: boolean; status: string } | null>(null)
const dirty = computed(() => json.value !== original.value)

async function reload() {
  loading.value = true
  try {
    const [params, vdb] = await Promise.all([
      getRagParams(),
      getVectorDbStatus().catch(() => null),
    ])
    json.value = JSON.stringify(params, null, 2)
    original.value = json.value
    vectordb.value = vdb
  } finally { loading.value = false }
}

async function save() {
  try {
    const parsed = JSON.parse(json.value)
    await saveRagParams(parsed)
    original.value = json.value
    ui.showMessage('已保存', 'success')
  } catch (e) { ui.showMessage('JSON 错误: ' + (e as Error).message, 'error') }
}

onMounted(reload)
</script>

<style lang="scss" scoped>
.content { margin: 0 24px 24px; padding: 16px; }
.hint { margin: 0 0 10px; font-size: 12px; color: var(--secondary-text); code { background: var(--accent-bg); padding: 2px 6px; border-radius: 4px; } }
.vectordb { margin: 12px 0 0; font-size: 12px; color: var(--secondary-text); .ok { color: #4a8d63; } .err { color: var(--danger-color); } }
</style>
