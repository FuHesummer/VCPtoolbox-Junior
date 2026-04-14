<template>
  <div class="page">
    <PageHeader title="变量编辑器" subtitle="TVStxt 目录下的 {{Tar*}} {{Var*}} {{Sar*}} 占位符变量" icon="data_object">
      <template #actions>
        <button class="btn btn-ghost" @click="reload" :disabled="loading"><span class="material-symbols-outlined">refresh</span></button>
      </template>
    </PageHeader>

    <div class="tvs-layout">
      <aside class="tvs-files card">
        <input v-model="search" placeholder="搜索..." class="search" />
        <ul class="file-list">
          <li v-for="f in filtered" :key="f" :class="{ active: selected === f }" @click="openFile(f)">
            {{ f }}
          </li>
        </ul>
      </aside>
      <main class="tvs-editor card">
        <div v-if="selected" class="inner">
          <div class="toolbar">
            <strong>{{ selected }}</strong>
            <button class="btn" @click="save" :disabled="!dirty">保存</button>
          </div>
          <CodeEditor v-model="content" :rows="28" />
        </div>
        <EmptyState v-else icon="edit_note" message="选择一个 TVS 文件" />
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import PageHeader from '@/components/common/PageHeader.vue'
import CodeEditor from '@/components/common/CodeEditor.vue'
import EmptyState from '@/components/common/EmptyState.vue'
import { listTvsFiles, getTvsFile, saveTvsFile } from '@/api/tvs'
import { useUiStore } from '@/stores/ui'

const ui = useUiStore()
const files = ref<string[]>([])
const search = ref('')
const selected = ref<string | null>(null)
const content = ref('')
const original = ref('')
const loading = ref(false)

const filtered = computed(() => {
  const kw = search.value.toLowerCase()
  return kw ? files.value.filter((f) => f.toLowerCase().includes(kw)) : files.value
})

const dirty = computed(() => content.value !== original.value)

async function reload() {
  loading.value = true
  try {
    const { files: list } = await listTvsFiles()
    files.value = list || []
  } finally { loading.value = false }
}

async function openFile(name: string) {
  selected.value = name
  const { content: c } = await getTvsFile(name)
  content.value = c
  original.value = c
}

async function save() {
  if (!selected.value) return
  try {
    await saveTvsFile(selected.value, content.value)
    original.value = content.value
    ui.showMessage('已保存', 'success')
  } catch { /* toast */ }
}

onMounted(reload)
</script>

<style lang="scss" scoped>
.tvs-layout {
  display: grid;
  grid-template-columns: 260px 1fr;
  gap: 16px;
  padding: 0 24px 24px;
  @media (max-width: 900px) { grid-template-columns: 1fr; }
}

.tvs-files {
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;

  .search { padding: 6px 10px; font-size: 13px; }

  .file-list {
    list-style: none; padding: 0; margin: 0;
    max-height: 600px; overflow-y: auto;

    li {
      padding: 6px 8px; border-radius: var(--radius-sm);
      cursor: pointer; font-size: 13px;
      &:hover { background: var(--accent-bg); }
      &.active { background: var(--button-bg); color: #fff; }
    }
  }
}

.tvs-editor { padding: 14px; }
.inner { display: flex; flex-direction: column; gap: 10px; }
.toolbar { display: flex; justify-content: space-between; align-items: center; }
</style>
