<template>
  <div class="page">
    <PageHeader title="语义组编辑" subtitle="标签归类与聚合" icon="hub">
      <template #actions>
        <button class="btn btn-ghost" @click="reload" :disabled="loading"><span class="material-symbols-outlined">refresh</span></button>
        <button class="btn" @click="save" :disabled="!dirty">保存</button>
      </template>
    </PageHeader>
    <div class="content card">
      <p class="hint">JSON 格式：组名 → 标签列表</p>
      <CodeEditor v-model="json" :rows="28" placeholder='{"情感类":["快乐","悲伤"],"知识类":["技术","历史"]}' />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import PageHeader from '@/components/common/PageHeader.vue'
import CodeEditor from '@/components/common/CodeEditor.vue'
import { getSemanticGroups, saveSemanticGroups } from '@/api/rag'
import { useUiStore } from '@/stores/ui'

const ui = useUiStore()
const json = ref('')
const original = ref('')
const loading = ref(false)
const dirty = computed(() => json.value !== original.value)

async function reload() {
  loading.value = true
  try {
    const data = await getSemanticGroups()
    json.value = JSON.stringify(data, null, 2)
    original.value = json.value
  } finally { loading.value = false }
}

async function save() {
  try {
    const parsed = JSON.parse(json.value)
    await saveSemanticGroups(parsed)
    original.value = json.value
    ui.showMessage('已保存', 'success')
  } catch (e) { ui.showMessage('JSON 错误: ' + (e as Error).message, 'error') }
}

onMounted(reload)
</script>

<style lang="scss" scoped>
.content { margin: 0 24px 24px; padding: 16px; }
.hint { margin: 0 0 10px; font-size: 12px; color: var(--secondary-text); }
</style>
