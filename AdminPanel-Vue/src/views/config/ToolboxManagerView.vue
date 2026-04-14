<template>
  <div class="page">
    <PageHeader title="Toolbox 管理" subtitle="编辑 toolbox 映射与文件" icon="build">
      <template #actions>
        <button class="btn btn-ghost" @click="reloadAll" :disabled="loading"><span class="material-symbols-outlined">refresh</span></button>
      </template>
    </PageHeader>

    <div class="layout">
      <aside class="sidebar card">
        <div class="section">
          <h4>映射</h4>
          <CodeEditor v-model="mapJson" :rows="10" />
          <button class="btn" @click="saveMap" :disabled="!mapDirty">保存映射</button>
        </div>
        <div class="section">
          <h4>文件</h4>
          <input v-model="search" placeholder="搜索..." class="search" />
          <ul>
            <li v-for="f in filtered" :key="f.path" :class="{ active: selected?.path === f.path }" @click="openFile(f)">
              {{ f.name }}
            </li>
          </ul>
          <button class="btn btn-ghost new-btn" @click="promptCreate">新建</button>
        </div>
      </aside>

      <main class="editor card">
        <div v-if="selected" class="inner">
          <div class="toolbar">
            <strong>{{ selected.path }}</strong>
            <button class="btn" @click="save" :disabled="!fileDirty">保存</button>
          </div>
          <CodeEditor v-model="content" :rows="28" />
        </div>
        <EmptyState v-else icon="build" message="选择一个文件" />
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import PageHeader from '@/components/common/PageHeader.vue'
import CodeEditor from '@/components/common/CodeEditor.vue'
import EmptyState from '@/components/common/EmptyState.vue'
import { getToolboxMap, saveToolboxMap, listToolboxFiles, getToolboxFile, saveToolboxFile, createToolboxFile, type ToolboxEntry } from '@/api/toolbox'
import { useUiStore } from '@/stores/ui'

const ui = useUiStore()
const mapJson = ref('')
const mapOriginal = ref('')
const files = ref<ToolboxEntry[]>([])
const search = ref('')
const selected = ref<ToolboxEntry | null>(null)
const content = ref('')
const original = ref('')
const loading = ref(false)

const mapDirty = computed(() => mapJson.value !== mapOriginal.value)
const fileDirty = computed(() => content.value !== original.value)
const filtered = computed(() => {
  const kw = search.value.toLowerCase()
  return kw ? files.value.filter((f) => f.path.toLowerCase().includes(kw)) : files.value
})

async function reloadAll() {
  loading.value = true
  try {
    const [m, f] = await Promise.all([getToolboxMap(), listToolboxFiles()])
    mapJson.value = JSON.stringify(m.map, null, 2)
    mapOriginal.value = mapJson.value
    files.value = f.files || []
  } finally { loading.value = false }
}

async function saveMap() {
  try {
    const parsed = JSON.parse(mapJson.value)
    await saveToolboxMap(parsed)
    mapOriginal.value = mapJson.value
    ui.showMessage('映射已保存', 'success')
  } catch (e) { ui.showMessage('格式错误: ' + (e as Error).message, 'error') }
}

async function openFile(f: ToolboxEntry) {
  selected.value = f
  const { content: c } = await getToolboxFile(f.path)
  content.value = c
  original.value = c
}

async function save() {
  if (!selected.value) return
  try {
    await saveToolboxFile(selected.value.path, content.value)
    original.value = content.value
    ui.showMessage('已保存', 'success')
  } catch { /* */ }
}

async function promptCreate() {
  const name = prompt('新 Toolbox 文件名：')
  if (!name) return
  try {
    await createToolboxFile(name)
    ui.showMessage('已创建', 'success')
    reloadAll()
  } catch { /* */ }
}

onMounted(reloadAll)
</script>

<style lang="scss" scoped>
.layout {
  display: grid;
  grid-template-columns: 300px 1fr;
  gap: 16px;
  padding: 0 24px 24px;
  @media (max-width: 900px) { grid-template-columns: 1fr; }
}
.sidebar { padding: 14px; display: flex; flex-direction: column; gap: 18px; }
.section h4 { margin: 0 0 8px; font-size: 13px; color: var(--secondary-text); }
.section .btn { width: 100%; margin-top: 6px; font-size: 13px; padding: 6px; }
.search { width: 100%; padding: 6px 10px; font-size: 13px; margin-bottom: 8px; }
ul { list-style: none; padding: 0; margin: 0; max-height: 300px; overflow-y: auto; }
li { padding: 6px 8px; border-radius: var(--radius-sm); cursor: pointer; font-size: 13px; }
li:hover { background: var(--accent-bg); }
li.active { background: var(--button-bg); color: #fff; }
.new-btn { margin-top: 4px; }
.editor { padding: 14px; }
.inner { display: flex; flex-direction: column; gap: 10px; }
.toolbar { display: flex; justify-content: space-between; align-items: center; }
</style>
