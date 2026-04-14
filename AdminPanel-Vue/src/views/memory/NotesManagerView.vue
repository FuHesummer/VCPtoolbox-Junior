<template>
  <div class="page">
    <PageHeader :title="titleMap[mode]" :subtitle="subtitleMap[mode]" :icon="iconMap[mode]">
      <template #actions>
        <input v-model="search" placeholder="搜索..." class="search" />
        <button class="btn btn-ghost" @click="reloadFolders" :disabled="loading">
          <span class="material-symbols-outlined">refresh</span>
        </button>
      </template>
    </PageHeader>

    <div class="notes-layout">
      <aside class="folders card">
        <h4>目录</h4>
        <EmptyState v-if="!folders.length && !loading" icon="folder_off" message="暂无目录" />
        <ul v-else class="folder-list">
          <li v-for="f in folders" :key="f.name"
              :class="{ active: selectedFolder === f.name }"
              @click="openFolder(f.name)">
            <span class="material-symbols-outlined">folder</span>
            <span class="name">{{ f.displayName || f.name }}</span>
            <span v-if="typeof f.count === 'number'" class="count">{{ f.count }}</span>
          </li>
        </ul>
      </aside>

      <section class="notes card">
        <div v-if="selectedFolder" class="notes-inner">
          <div class="notes-header">
            <strong>{{ selectedFolder }}</strong>
            <div class="actions">
              <button v-if="selectedNotes.size" class="btn btn-danger" @click="deleteSelected">
                删除 ({{ selectedNotes.size }})
              </button>
            </div>
          </div>
          <EmptyState v-if="!filteredNotes.length" icon="description" message="暂无日记" />
          <ul v-else class="note-list">
            <li v-for="n in filteredNotes" :key="n.name" :class="{ selected: selectedNotes.has(n.name) }">
              <input type="checkbox" :checked="selectedNotes.has(n.name)" @change="toggleSelect(n.name)" />
              <span class="note-name" @click="openNote(n.name)">{{ n.name }}</span>
              <span v-if="n.mtime" class="mtime">{{ fmtDate(n.mtime) }}</span>
            </li>
          </ul>
        </div>
        <EmptyState v-else icon="folder_open" message="选择一个目录" />
      </section>

      <section v-if="editingFile" class="editor card">
        <div class="editor-header">
          <strong>{{ editingFile }}</strong>
          <div>
            <button class="btn btn-ghost" @click="editingFile = null">关闭</button>
            <button class="btn" @click="saveNoteContent" :disabled="!noteDirty">保存</button>
          </div>
        </div>
        <CodeEditor v-model="noteContent" :rows="28" />
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import PageHeader from '@/components/common/PageHeader.vue'
import EmptyState from '@/components/common/EmptyState.vue'
import CodeEditor from '@/components/common/CodeEditor.vue'
import {
  listNotesFolders, listNotesInFolder, getNoteContent, saveNote, deleteNotes,
  type NotesMode, type NotesFolder, type NoteItem,
} from '@/api/dailyNotes'
import { useUiStore } from '@/stores/ui'
import { useConfirm } from '@/composables/useConfirm'

const props = defineProps<{ mode: NotesMode }>()

const ui = useUiStore()
const { confirm } = useConfirm()

const titleMap: Record<NotesMode, string> = { diary: '日记管理', knowledge: '知识库管理', public: '公共知识库' }
const subtitleMap: Record<NotesMode, string> = {
  diary: '双根扫描：Agent/*/diary',
  knowledge: '双根扫描：Agent/*/knowledge',
  public: '公共知识库：knowledge/',
}
const iconMap: Record<NotesMode, string> = { diary: 'menu_book', knowledge: 'school', public: 'public' }

const folders = ref<NotesFolder[]>([])
const selectedFolder = ref<string | null>(null)
const notes = ref<NoteItem[]>([])
const selectedNotes = ref(new Set<string>())
const search = ref('')
const editingFile = ref<string | null>(null)
const noteContent = ref('')
const noteOriginal = ref('')
const loading = ref(false)

const filteredNotes = computed(() => {
  if (!search.value.trim()) return notes.value
  const kw = search.value.toLowerCase()
  return notes.value.filter((n) => n.name.toLowerCase().includes(kw))
})

const noteDirty = computed(() => noteContent.value !== noteOriginal.value)

async function reloadFolders() {
  loading.value = true
  try {
    const data = await listNotesFolders(props.mode)
    folders.value = data.folders || []
  } catch {
    folders.value = []
    ui.showMessage('暂无 Agent 日记目录', 'info')
  } finally { loading.value = false }
}

async function openFolder(name: string) {
  selectedFolder.value = name
  notes.value = []
  selectedNotes.value.clear()
  try {
    const data = await listNotesInFolder(props.mode, name)
    notes.value = data.notes || []
  } catch (e) {
    const err = e as Error & { status?: number }
    if (err.status === 404) ui.showMessage('暂无日记', 'info', 1500)
    else ui.showMessage(err.message, 'error')
  }
}

function toggleSelect(name: string) {
  if (selectedNotes.value.has(name)) selectedNotes.value.delete(name)
  else selectedNotes.value.add(name)
  selectedNotes.value = new Set(selectedNotes.value)
}

async function openNote(name: string) {
  if (noteDirty.value) {
    const ok = await confirm('当前日记未保存，确定切换吗？', { danger: true })
    if (!ok) return
  }
  if (!selectedFolder.value) return
  try {
    const { content } = await getNoteContent(props.mode, selectedFolder.value, name)
    editingFile.value = name
    noteContent.value = content
    noteOriginal.value = content
  } catch { /* 已提示 */ }
}

async function saveNoteContent() {
  if (!editingFile.value || !selectedFolder.value) return
  try {
    await saveNote(props.mode, selectedFolder.value, editingFile.value, noteContent.value)
    noteOriginal.value = noteContent.value
    ui.showMessage('已保存', 'success')
  } catch { /* */ }
}

async function deleteSelected() {
  if (!selectedFolder.value || !selectedNotes.value.size) return
  const count = selectedNotes.value.size
  const ok = await confirm(`确定删除 ${count} 条日记吗？`, { danger: true, okText: '删除' })
  if (!ok) return
  try {
    await deleteNotes(props.mode, selectedFolder.value, [...selectedNotes.value])
    ui.showMessage(`已删除 ${count} 条`, 'success')
    selectedNotes.value.clear()
    openFolder(selectedFolder.value)
  } catch { /* */ }
}

function fmtDate(ts?: number) {
  if (!ts) return ''
  const d = new Date(ts * (ts < 1e12 ? 1000 : 1))
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
}

watch(() => props.mode, () => {
  selectedFolder.value = null
  notes.value = []
  editingFile.value = null
  reloadFolders()
}, { immediate: true })
</script>

<style lang="scss" scoped>
.notes-layout {
  display: grid;
  grid-template-columns: 220px 280px 1fr;
  gap: 12px;
  padding: 0 24px 24px;
  min-height: 560px;
  @media (max-width: 1100px) { grid-template-columns: 1fr; }
}

.folders, .notes, .editor { padding: 14px; overflow: hidden; }

h4 { margin: 0 0 10px; font-size: 13px; color: var(--secondary-text); }

.search { padding: 6px 12px; border-radius: var(--radius-pill); font-size: 13px; width: 200px; }

.folder-list, .note-list {
  list-style: none;
  padding: 0;
  margin: 0;
  max-height: 600px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.folder-list li {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 8px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: 13px;

  &:hover { background: var(--accent-bg); }
  &.active { background: var(--button-bg); color: #fff; .count { color: rgba(255,255,255,0.75); } }

  .material-symbols-outlined { font-size: 16px; }
  .name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .count { font-size: 11px; color: var(--secondary-text); }
}

.note-list li {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  border-radius: var(--radius-sm);
  font-size: 13px;
  cursor: default;

  &:hover { background: var(--accent-bg); }
  &.selected { background: var(--accent-bg); }

  .note-name { flex: 1; cursor: pointer; color: var(--primary-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mtime { font-size: 11px; color: var(--secondary-text); }
}

.notes-inner, .editor { display: flex; flex-direction: column; gap: 10px; height: 100%; }

.notes-header, .editor-header {
  display: flex;
  justify-content: space-between;
  align-items: center;

  strong { font-size: 14px; color: var(--primary-text); }
  .actions, > div { display: flex; gap: 6px; }
}
</style>
