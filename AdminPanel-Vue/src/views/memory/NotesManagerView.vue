<template>
  <div class="page">
    <PageHeader :title="titleMap[mode]" :subtitle="subtitleMap[mode]" :icon="iconMap[mode]">
      <template #actions>
        <input
          v-model="searchTerm"
          :placeholder="searchPlaceholder"
          class="search input"
          @keydown.enter="runSearch"
        />
        <button class="btn btn-ghost" :disabled="!searchTerm.trim()" @click="runSearch">
          <span class="material-symbols-outlined">search</span>搜索
        </button>
        <button v-if="searching" class="btn btn-ghost" @click="exitSearch">
          <span class="material-symbols-outlined">close</span>退出搜索
        </button>
        <button class="btn btn-ghost" :disabled="loading" @click="reloadFolders">
          <span class="material-symbols-outlined">refresh</span>
        </button>
      </template>
    </PageHeader>

    <div class="notes-layout">
      <!-- ===================== 左侧：文件夹树 ===================== -->
      <aside class="folders card">
        <h4>{{ folderTreeTitle }}</h4>
        <EmptyState v-if="!hasAnyFolder && !loading" icon="folder_off" :message="emptyFolderHint" />

        <ul v-else class="folder-tree">
          <!-- mode = public：扁平 -->
          <template v-if="mode === 'public'">
            <li
              v-for="f in publicFolders"
              :key="f"
              class="folder-item"
              :class="{ active: selectedFolder === f }"
              @click="openFolder(f)"
            >
              <span class="material-symbols-outlined">folder</span>
              <span class="name">{{ f }}</span>
            </li>
          </template>

          <!-- mode = diary / knowledge：按 Agent 分组（卡片风格） -->
          <template v-else>
            <li
              v-for="agent in groupedAgents"
              :key="agent.name"
              class="agent-group"
              :class="{ collapsed: !expandedAgents.has(agent.name) }"
            >
              <div class="agent-card" @click="toggleAgent(agent.name)">
                <AgentAvatar :alias="agent.name" :size="32" />
                <div class="info">
                  <strong class="alias">{{ agent.name }}</strong>
                  <span class="meta">{{ agent.notebooks.length }} 个{{ mode === 'diary' ? '日记本' : '知识库' }}</span>
                </div>
                <span class="material-symbols-outlined arrow">expand_more</span>
              </div>
              <ul class="notebook-list">
                <li
                  v-for="nb in agent.notebooks"
                  :key="nb.folderName"
                  class="notebook-item"
                  :class="{ active: selectedFolder === nb.folderName }"
                  @click="openFolder(nb.folderName)"
                >
                  <span class="material-symbols-outlined">{{ nb.type === 'diary' ? 'menu_book' : 'school' }}</span>
                  <span class="name">{{ nb.folderName.split('/').pop() }}</span>
                </li>
              </ul>
            </li>

            <!-- knowledge 模式额外：思维簇（不带头像，整组样式） -->
            <li
              v-if="mode === 'knowledge' && thinkingFolders.length"
              class="agent-group thinking-group"
              :class="{ collapsed: !expandedAgents.has('__thinking__') }"
            >
              <div class="agent-card" @click="toggleAgent('__thinking__')">
                <div class="thinking-icon">
                  <span class="material-symbols-outlined">psychology</span>
                </div>
                <div class="info">
                  <strong class="alias">思维簇</strong>
                  <span class="meta">{{ thinkingFolders.length }} 个簇</span>
                </div>
                <span class="material-symbols-outlined arrow">expand_more</span>
              </div>
              <ul class="notebook-list">
                <li
                  v-for="t in thinkingFolders"
                  :key="t.folderName"
                  class="notebook-item"
                  :class="{ active: selectedFolder === t.folderName }"
                  @click="openFolder(t.folderName)"
                >
                  <span class="material-symbols-outlined">hub</span>
                  <span class="name">{{ t.folderName.split('/').pop() }}</span>
                </li>
              </ul>
            </li>
          </template>
        </ul>
      </aside>

      <!-- ===================== 中间：笔记卡片 ===================== -->
      <section class="notes card">
        <div v-if="searching" class="notes-header">
          <strong>
            搜索结果：&ldquo;{{ activeSearchTerm }}&rdquo;
            <span v-if="searchMeta" class="muted">（命中 {{ searchMeta.total }}{{ searchMeta.limited ? '+' : '' }}）</span>
          </strong>
        </div>
        <div v-else-if="selectedFolder" class="notes-header">
          <strong>{{ selectedFolder }}</strong>
          <div class="notes-toolbar">
            <select
              v-if="selectedNotes.size"
              v-model="moveTarget"
              class="input compact"
            >
              <option value="">移动到...</option>
              <option v-for="f in allFolders" :key="f" :value="f" :disabled="f === selectedFolder">
                {{ f }}
              </option>
            </select>
            <button
              v-if="selectedNotes.size && moveTarget"
              class="btn btn-ghost compact"
              @click="moveSelected"
            >
              <span class="material-symbols-outlined">drive_file_move</span>移动 ({{ selectedNotes.size }})
            </button>
            <button
              v-if="selectedNotes.size"
              class="btn btn-danger compact"
              @click="deleteSelected"
            >
              <span class="material-symbols-outlined">delete</span>删除 ({{ selectedNotes.size }})
            </button>
            <button
              v-if="!notes.length && selectedFolder && !loadingNotes"
              class="btn btn-ghost compact"
              @click="confirmDeleteFolder"
            >
              <span class="material-symbols-outlined">folder_delete</span>删除空目录
            </button>
          </div>
        </div>

        <div v-if="loadingNotes" class="loading-hint">
          <span class="material-symbols-outlined spinning">progress_activity</span> 正在加载笔记...
        </div>
        <EmptyState
          v-else-if="!filteredNotes.length"
          icon="description"
          :message="searching ? '没有匹配的笔记' : (selectedFolder ? '该目录暂无笔记' : '请选择左侧目录')"
        />

        <div v-else class="note-grid">
          <article
            v-for="n in filteredNotes"
            :key="(n.folderName || selectedFolder) + '/' + n.name"
            class="note-card"
            :class="{ selected: isSelected(n) }"
            @click="onCardClick(n, $event)"
          >
            <header class="note-card-head">
              <input
                type="checkbox"
                :checked="isSelected(n)"
                @click.stop
                @change="toggleSelect(n)"
              />
              <span class="note-card-title">{{ n.name }}</span>
            </header>
            <p v-if="n.preview" class="note-card-preview">{{ n.preview }}</p>
            <footer class="note-card-foot">
              <span v-if="searching && n.folderName" class="from-folder">{{ n.folderName }}</span>
              <span v-if="n.lastModified" class="mtime">{{ fmtDate(n.lastModified) }}</span>
              <span class="spacer" />
              <button class="icon-btn" title="联想追溯" @click.stop="openDiscovery(n)">
                <span class="material-symbols-outlined">auto_awesome</span>
              </button>
              <button class="icon-btn" title="编辑" @click.stop="openNote(n)">
                <span class="material-symbols-outlined">edit</span>
              </button>
            </footer>
          </article>
        </div>
      </section>

      <!-- ===================== 右侧：编辑器 / RAG 配置 ===================== -->
      <section class="right card">
        <!-- 编辑器 -->
        <div v-if="editingFile" class="editor">
          <div class="editor-header">
            <strong>{{ editingFile.folder }} / {{ editingFile.name }}</strong>
            <div class="actions">
              <button class="btn btn-ghost compact" @click="closeEditor">关闭</button>
              <button class="btn compact" :disabled="!noteDirty" @click="saveNoteContent">保存</button>
            </div>
          </div>
          <CodeEditor v-model="noteContent" :rows="26" />
          <p class="editor-hint">未做 Markdown 渲染 — 仅纯文本/源码编辑</p>
        </div>

        <!-- RAG 标签配置 -->
        <div v-else-if="selectedFolder" class="rag-panel">
          <header class="rag-header">
            <strong>RAG 标签配置</strong>
            <span class="muted">{{ selectedFolder }}</span>
          </header>

          <div class="rag-section">
            <label class="row">
              <input type="checkbox" v-model="ragThresholdEnabled" />
              <span>启用专属阈值</span>
              <span class="muted">未启用时使用全局默认</span>
            </label>
            <div v-if="ragThresholdEnabled" class="row">
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                v-model.number="ragThreshold"
                class="slider"
              />
              <span class="threshold-value">{{ ragThreshold.toFixed(2) }}</span>
            </div>
          </div>

          <div class="rag-section">
            <header class="row between">
              <strong class="small">触发标签</strong>
              <button class="btn btn-ghost compact" @click="addTag()">
                <span class="material-symbols-outlined">add</span>添加
              </button>
            </header>
            <p class="muted small">格式 <code>标签:权重</code>（权重可省，默认 1.0）</p>
            <ul v-if="ragTags.length" class="tag-list">
              <li v-for="(t, i) in ragTags" :key="i" class="tag-item">
                <input v-model="t.value" placeholder="标签:权重(可选)" class="input compact flex" />
                <button class="icon-btn" @click="ragTags.splice(i, 1)">
                  <span class="material-symbols-outlined">close</span>
                </button>
              </li>
            </ul>
            <p v-else class="muted small empty-tags">该文件夹暂无标签</p>
          </div>

          <footer class="rag-footer">
            <button class="btn" @click="saveRagConfig" :disabled="ragSaving">
              {{ ragSaving ? '保存中...' : '保存 RAG 配置' }}
            </button>
          </footer>
        </div>

        <EmptyState v-else icon="folder_open" message="选择左侧目录即可查看 / 编辑" />
      </section>
    </div>

    <!-- ===================== 联想追溯 Modal ===================== -->
    <BaseModal v-model="discoveryOpen" :title="discoveryTitle" width="720px">
      <div class="discovery-form">
        <div class="row">
          <label>K 值</label>
          <input
            type="range"
            min="1"
            max="100"
            step="1"
            v-model.number="discoveryK"
            class="slider"
          />
          <span class="threshold-value">{{ discoveryK }}</span>
        </div>
        <div class="row">
          <label>tagBoost</label>
          <input v-model="discoveryTagBoost" placeholder="0.15  或  0.6+ (Wave v8)" class="input flex" />
        </div>
        <div class="row top">
          <label>限定范围</label>
          <div class="chip-row">
            <button
              v-for="f in allFolders"
              :key="f"
              class="chip"
              :class="{ active: discoveryRange.has(f) }"
              @click="toggleRange(f)"
            >{{ f }}</button>
          </div>
        </div>
      </div>

      <div v-if="discoveryWarning" class="warning-banner">{{ discoveryWarning }}</div>

      <div v-if="discoveryRunning" class="loading-hint">
        <span class="material-symbols-outlined spinning">progress_activity</span> 正在联想检索...
      </div>

      <div v-else-if="discoveryResults.length" class="discovery-results">
        <article
          v-for="(r, i) in discoveryResults"
          :key="i"
          class="discovery-card"
          @click="jumpToResult(r)"
        >
          <header>
            <span class="filename">{{ r.name }}</span>
            <span class="score-tag">{{ Math.round(r.score * 100) }}%</span>
          </header>
          <div class="score-bar"><span :style="{ width: (r.score * 100) + '%' }" /></div>
          <div v-if="r.matchedTags?.length" class="result-tags">
            <span v-for="t in r.matchedTags.slice(0, 6)" :key="t" class="result-tag">#{{ t }}</span>
          </div>
          <p v-if="r.chunks?.length" class="result-preview">{{ r.chunks.join(' … ') }}</p>
        </article>
      </div>

      <EmptyState v-else-if="discoveryDone" icon="psychology_alt" message="未发现相关记忆节点" />

      <template #footer>
        <button class="btn btn-ghost" @click="discoveryOpen = false">关闭</button>
        <button class="btn" :disabled="discoveryRunning || !discoverySource" @click="runDiscovery">
          {{ discoveryDone ? '重新检索' : '开始检索' }}
        </button>
      </template>
    </BaseModal>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import PageHeader from '@/components/common/PageHeader.vue'
import EmptyState from '@/components/common/EmptyState.vue'
import CodeEditor from '@/components/common/CodeEditor.vue'
import BaseModal from '@/components/common/BaseModal.vue'
import AgentAvatar from '@/components/common/AgentAvatar.vue'
import {
  listNotesFolders, listNotesInFolder, getNoteContent, saveNote,
  deleteNotesBatch, moveNotes, deleteEmptyFolder, searchNotes, associativeDiscovery,
  type NotesMode, type NoteItem, type AgentEntry, type ThinkingFolder, type DiscoveryResult,
} from '@/api/dailyNotes'
import { getRagTags, saveRagTags, type RagTagsConfig } from '@/api/rag'
import { useUiStore } from '@/stores/ui'
import { useConfirm } from '@/composables/useConfirm'

const props = defineProps<{ mode: NotesMode }>()

const ui = useUiStore()
const { confirm } = useConfirm()

// === 标题/副标题/图标按 mode 切换 ===
const titleMap: Record<NotesMode, string> = { diary: '日记管理', knowledge: '知识库管理', public: '公共知识库' }
const subtitleMap: Record<NotesMode, string> = {
  diary: 'Agent 个人日记 + RAG 标签调教',
  knowledge: 'Agent 知识库 + 思维簇 + RAG 标签调教',
  public: '公共 knowledge/ 目录 + RAG 标签调教',
}
const iconMap: Record<NotesMode, string> = { diary: 'auto_stories', knowledge: 'school', public: 'menu_book' }
const folderTreeTitle = computed(() => props.mode === 'public' ? '公共目录' : (props.mode === 'diary' ? 'Agent 日记' : 'Agent 知识库 + 思维簇'))
const emptyFolderHint = computed(() => {
  if (props.mode === 'diary') return '暂无 Agent 日记目录'
  if (props.mode === 'knowledge') return '暂无 Agent 知识库 / 思维簇'
  return '暂无公共知识库目录'
})
const searchPlaceholder = computed(() => `搜索${titleMap[props.mode]}…`)

// === 文件夹数据 ===
const loading = ref(false)
const allAgents = ref<AgentEntry[]>([])
const thinkingFolders = ref<ThinkingFolder[]>([])
const publicFolders = ref<string[]>([])
const allFlatFolders = ref<string[]>([])
const expandedAgents = ref(new Set<string>())

const groupedAgents = computed(() => {
  if (props.mode === 'public') return []
  return allAgents.value
    .map((a) => ({
      name: a.name,
      notebooks: a.notebooks.filter((n) => n.type === (props.mode === 'diary' ? 'diary' : 'knowledge')),
    }))
    .filter((a) => a.notebooks.length > 0)
})

const hasAnyFolder = computed(() => {
  if (props.mode === 'public') return publicFolders.value.length > 0
  if (props.mode === 'knowledge') return groupedAgents.value.length > 0 || thinkingFolders.value.length > 0
  return groupedAgents.value.length > 0
})

const allFolders = computed(() => {
  if (props.mode === 'public') return publicFolders.value
  const fs: string[] = []
  for (const a of groupedAgents.value) fs.push(...a.notebooks.map((n) => n.folderName))
  if (props.mode === 'knowledge') fs.push(...thinkingFolders.value.map((t) => t.folderName))
  return fs
})

function toggleAgent(name: string) {
  if (expandedAgents.value.has(name)) expandedAgents.value.delete(name)
  else expandedAgents.value.add(name)
  expandedAgents.value = new Set(expandedAgents.value)
}

async function reloadFolders() {
  loading.value = true
  try {
    const data = await listNotesFolders()
    allAgents.value = data.agents || []
    thinkingFolders.value = data.thinking || []
    publicFolders.value = data.public || []
    allFlatFolders.value = data.folders || []
    // 默认展开第一个
    if (props.mode !== 'public') {
      const first = groupedAgents.value[0]
      if (first) expandedAgents.value.add(first.name)
      if (props.mode === 'knowledge' && thinkingFolders.value.length) expandedAgents.value.add('__thinking__')
    }
    // 自动选中第一个
    if (!selectedFolder.value) {
      const auto = props.mode === 'public'
        ? publicFolders.value[0]
        : (groupedAgents.value[0]?.notebooks[0]?.folderName || thinkingFolders.value[0]?.folderName)
      if (auto) await openFolder(auto)
    }
  } catch {
    allAgents.value = []
    thinkingFolders.value = []
    publicFolders.value = []
  } finally { loading.value = false }
}

// === 笔记列表 ===
const selectedFolder = ref<string | null>(null)
const notes = ref<NoteItem[]>([])
const loadingNotes = ref(false)
const selectedNotes = ref(new Set<string>())  // key: folder/file
const moveTarget = ref('')

// 搜索状态
const searchTerm = ref('')
const searching = ref(false)
const activeSearchTerm = ref('')
const searchResults = ref<NoteItem[]>([])
const searchMeta = ref<{ total: number; limited: boolean } | null>(null)

const filteredNotes = computed(() => searching.value ? searchResults.value : notes.value)

function noteKey(n: NoteItem) { return (n.folderName || selectedFolder.value || '') + '/' + n.name }
function isSelected(n: NoteItem) { return selectedNotes.value.has(noteKey(n)) }
function toggleSelect(n: NoteItem) {
  const k = noteKey(n)
  if (selectedNotes.value.has(k)) selectedNotes.value.delete(k)
  else selectedNotes.value.add(k)
  selectedNotes.value = new Set(selectedNotes.value)
}

function onCardClick(n: NoteItem, e: MouseEvent) {
  // 卡片点击空白处即编辑（按钮区域已 stop）
  if ((e.target as HTMLElement).closest('button, input')) return
  openNote(n)
}

async function openFolder(name: string) {
  selectedFolder.value = name
  notes.value = []
  selectedNotes.value.clear()
  moveTarget.value = ''
  closeEditor()
  await loadRagForCurrentFolder()
  loadingNotes.value = true
  try {
    const data = await listNotesInFolder(name)
    notes.value = data.notes || []
  } catch (e) {
    const err = e as Error & { status?: number }
    if (err.status === 404) notes.value = []
    else ui.showMessage(err.message, 'error')
  } finally { loadingNotes.value = false }
}

// === 搜索 ===
async function runSearch() {
  const term = searchTerm.value.trim()
  if (!term) return
  loadingNotes.value = true
  try {
    const data = await searchNotes(term, selectedFolder.value || undefined, 200)
    searchResults.value = data.notes || []
    searchMeta.value = { total: data.total, limited: data.limited }
    activeSearchTerm.value = term
    searching.value = true
    selectedNotes.value.clear()
  } catch (e) {
    ui.showMessage((e as Error).message, 'error')
  } finally { loadingNotes.value = false }
}

function exitSearch() {
  searching.value = false
  searchResults.value = []
  searchMeta.value = null
  searchTerm.value = ''
  selectedNotes.value.clear()
}

// === 编辑器 ===
const editingFile = ref<{ folder: string; name: string } | null>(null)
const noteContent = ref('')
const noteOriginal = ref('')
const noteDirty = computed(() => noteContent.value !== noteOriginal.value)

async function openNote(n: NoteItem) {
  if (noteDirty.value) {
    const ok = await confirm('当前笔记未保存，确定切换吗？', { danger: true })
    if (!ok) return
  }
  const folder = n.folderName || selectedFolder.value
  if (!folder) return
  try {
    const { content } = await getNoteContent(folder, n.name)
    editingFile.value = { folder, name: n.name }
    noteContent.value = content
    noteOriginal.value = content
  } catch (e) {
    ui.showMessage('打开失败：' + (e as Error).message, 'error')
  }
}

async function saveNoteContent() {
  if (!editingFile.value) return
  try {
    await saveNote(editingFile.value.folder, editingFile.value.name, noteContent.value)
    noteOriginal.value = noteContent.value
    ui.showMessage('已保存', 'success')
    // 同步刷新该文件夹笔记列表
    if (editingFile.value.folder === selectedFolder.value) {
      const data = await listNotesInFolder(editingFile.value.folder)
      notes.value = data.notes || []
    }
  } catch (e) {
    ui.showMessage('保存失败：' + (e as Error).message, 'error')
  }
}

function closeEditor() {
  editingFile.value = null
  noteContent.value = ''
  noteOriginal.value = ''
}

// === 批量操作 ===
async function deleteSelected() {
  const items = Array.from(selectedNotes.value).map(parseKey)
  if (!items.length) return
  const ok = await confirm(`确定删除选中的 ${items.length} 个笔记吗？此操作不可撤销。`, { danger: true, okText: '删除' })
  if (!ok) return
  try {
    const r = await deleteNotesBatch(items)
    if (r.errors?.length) ui.showMessage(`部分删除失败：${r.errors.length}`, 'warning')
    else ui.showMessage(`已删除 ${items.length} 个`, 'success')
    selectedNotes.value.clear()
    if (selectedFolder.value) await openFolder(selectedFolder.value)
  } catch (e) { ui.showMessage('删除失败：' + (e as Error).message, 'error') }
}

async function moveSelected() {
  if (!moveTarget.value) return
  const items = Array.from(selectedNotes.value).map(parseKey)
  if (!items.length) return
  try {
    const r = await moveNotes(items, moveTarget.value)
    if (r.errors?.length) ui.showMessage(`部分移动失败：${r.errors.length}`, 'warning')
    else ui.showMessage(`已移动 ${items.length} 个到 ${moveTarget.value}`, 'success')
    selectedNotes.value.clear()
    moveTarget.value = ''
    if (selectedFolder.value) await openFolder(selectedFolder.value)
  } catch (e) { ui.showMessage('移动失败：' + (e as Error).message, 'error') }
}

function parseKey(k: string): { folder: string; file: string } {
  const i = k.lastIndexOf('/')
  return { folder: k.slice(0, i), file: k.slice(i + 1) }
}

async function confirmDeleteFolder() {
  if (!selectedFolder.value) return
  const ok = await confirm(`确定删除空目录 "${selectedFolder.value}" 吗？`, { danger: true, okText: '删除' })
  if (!ok) return
  try {
    await deleteEmptyFolder(selectedFolder.value)
    ui.showMessage('已删除', 'success')
    selectedFolder.value = null
    notes.value = []
    await reloadFolders()
  } catch (e) { ui.showMessage('删除失败：' + (e as Error).message, 'error') }
}

// === RAG 标签 ===
const ragData = ref<RagTagsConfig>({})
const ragTags = ref<{ value: string }[]>([])
const ragThreshold = ref(0.7)
const ragThresholdEnabled = ref(false)
const ragSaving = ref(false)

async function loadRagConfig() {
  try {
    ragData.value = await getRagTags() || {}
  } catch {
    ragData.value = {}
  }
}

async function loadRagForCurrentFolder() {
  if (!selectedFolder.value) return
  const cfg = (ragData.value as Record<string, { tags?: unknown[]; threshold?: number }>)[selectedFolder.value] || {}
  const tagsField = cfg.tags || []
  ragTags.value = tagsField
    .map((t) => typeof t === 'string' ? t : (t as { tag?: string }).tag || '')
    .filter(Boolean)
    .map((value) => ({ value }))
  if (typeof cfg.threshold === 'number') {
    ragThresholdEnabled.value = true
    ragThreshold.value = cfg.threshold
  } else {
    ragThresholdEnabled.value = false
    ragThreshold.value = 0.7
  }
}

function addTag() {
  ragTags.value.push({ value: '' })
}

async function saveRagConfig() {
  if (!selectedFolder.value) return
  ragSaving.value = true
  try {
    const tags = ragTags.value.map((t) => t.value.trim()).filter(Boolean)
    const newCfg: { tags: string[]; threshold?: number } = { tags }
    if (ragThresholdEnabled.value) newCfg.threshold = ragThreshold.value
    const next: Record<string, unknown> = { ...ragData.value }
    if (tags.length || ragThresholdEnabled.value) next[selectedFolder.value] = newCfg
    else delete next[selectedFolder.value]
    await saveRagTags(next as RagTagsConfig)
    ragData.value = next as RagTagsConfig
    ui.showMessage('RAG 配置已保存', 'success')
  } catch (e) {
    ui.showMessage('保存失败：' + (e as Error).message, 'error')
  } finally { ragSaving.value = false }
}

// === 联想追溯 ===
const discoveryOpen = ref(false)
const discoverySource = ref<{ folder: string; name: string } | null>(null)
const discoveryK = ref(50)
const discoveryTagBoost = ref('0.15')
const discoveryRange = ref(new Set<string>())
const discoveryRunning = ref(false)
const discoveryDone = ref(false)
const discoveryResults = ref<DiscoveryResult[]>([])
const discoveryWarning = ref('')

const discoveryTitle = computed(() => discoverySource.value
  ? `联想追溯: ${discoverySource.value.name}`
  : '联想追溯')

function openDiscovery(n: NoteItem) {
  const folder = n.folderName || selectedFolder.value
  if (!folder) return
  discoverySource.value = { folder, name: n.name }
  discoveryK.value = 50
  discoveryTagBoost.value = '0.15'
  discoveryRange.value = new Set()
  discoveryResults.value = []
  discoveryWarning.value = ''
  discoveryDone.value = false
  discoveryOpen.value = true
}

function toggleRange(f: string) {
  if (discoveryRange.value.has(f)) discoveryRange.value.delete(f)
  else discoveryRange.value.add(f)
  discoveryRange.value = new Set(discoveryRange.value)
}

async function runDiscovery() {
  if (!discoverySource.value) return
  discoveryRunning.value = true
  discoveryWarning.value = ''
  try {
    const tagBoost = discoveryTagBoost.value.trim()
    const tb: number | string = tagBoost.endsWith('+') ? tagBoost : (parseFloat(tagBoost) || 0.15)
    const data = await associativeDiscovery({
      sourceFilePath: `${discoverySource.value.folder}/${discoverySource.value.name}`,
      k: discoveryK.value,
      range: Array.from(discoveryRange.value),
      tagBoost: tb,
    })
    discoveryResults.value = data.results || []
    discoveryWarning.value = data.warning || ''
    discoveryDone.value = true
  } catch (e) {
    ui.showMessage('联想失败：' + (e as Error).message, 'error')
  } finally { discoveryRunning.value = false }
}

function jumpToResult(r: DiscoveryResult) {
  const parts = r.path.split('/')
  const file = parts.pop() as string
  const folder = parts.join('/')
  discoveryOpen.value = false
  // 切换到该文件夹（如果不是当前）
  if (folder !== selectedFolder.value) {
    openFolder(folder).then(() => openNote({ name: file }))
  } else {
    openNote({ name: file })
  }
}

// === 工具 ===
function fmtDate(iso?: string) {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
}

// === mode 切换重置 ===
watch(() => props.mode, async () => {
  selectedFolder.value = null
  notes.value = []
  closeEditor()
  exitSearch()
  selectedNotes.value.clear()
  expandedAgents.value.clear()
  await loadRagConfig()
  await reloadFolders()
}, { immediate: true })
</script>

<style lang="scss" scoped>
.notes-layout {
  display: grid;
  grid-template-columns: 240px 1fr 380px;
  gap: 12px;
  padding: 0 24px 24px;
  min-height: calc(100vh - 180px);
  @media (max-width: 1280px) { grid-template-columns: 220px 1fr; .right { grid-column: 1 / -1; } }
}

.folders, .notes, .right { padding: 14px; overflow: hidden; display: flex; flex-direction: column; gap: 10px; }

.notes { min-width: 0; }

h4 { margin: 0; font-size: 13px; color: var(--secondary-text); }

.search { width: 220px; }

// ===== 文件夹树 — Agent 卡片风格 =====
.folder-tree {
  list-style: none; padding: 0; margin: 0;
  overflow-y: auto;
  flex: 1;
  display: flex; flex-direction: column; gap: 6px;
}

// Public 模式扁平 folder
.folder-item {
  list-style: none;
  display: flex; align-items: center; gap: 8px;
  padding: 9px 10px;
  background: var(--tertiary-bg);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  cursor: pointer;
  font-size: 13px;
  color: var(--primary-text);
  transition: all 0.15s;

  .material-symbols-outlined { font-size: 18px; color: var(--secondary-text); }
  .name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  &:hover { transform: translateX(2px); border-color: var(--button-bg); }
  &.active { background: var(--button-bg); color: #fff; border-color: var(--button-bg);
    .material-symbols-outlined { color: #fff; }
  }
}

// Agent 分组卡片
.agent-group {
  list-style: none;
  display: flex; flex-direction: column; gap: 4px;
}

.agent-card {
  display: grid;
  grid-template-columns: 32px 1fr auto;
  gap: 10px;
  align-items: center;
  padding: 8px 10px;
  background: var(--tertiary-bg);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all 0.15s;

  &:hover { transform: translateX(2px); box-shadow: 0 2px 8px rgba(180, 120, 140, 0.1); border-color: var(--button-bg); }

  .info { min-width: 0; display: flex; flex-direction: column; gap: 1px; }
  .alias { font-size: 13px; color: var(--primary-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .meta { font-size: 11px; color: var(--secondary-text); }

  .arrow { font-size: 18px; color: var(--secondary-text); transition: transform 0.15s; }
}

.thinking-group .thinking-icon {
  width: 32px; height: 32px;
  background: linear-gradient(135deg, #ff9bb3, #b478a0);
  border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  color: #fff;
  .material-symbols-outlined { font-size: 18px; color: #fff; }
}

.agent-group.collapsed .arrow { transform: rotate(-90deg); }
.agent-group.collapsed .notebook-list { display: none; }

.notebook-list {
  list-style: none; padding: 0;
  margin: 2px 0 4px 14px;
  display: flex; flex-direction: column; gap: 2px;
  border-left: 2px solid var(--border-color);
  padding-left: 8px;
}

.notebook-item {
  list-style: none;
  display: flex; align-items: center; gap: 6px;
  padding: 6px 8px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: 12.5px;
  color: var(--secondary-text);

  .material-symbols-outlined { font-size: 15px; }
  .name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  &:hover { background: var(--accent-bg); color: var(--primary-text); }
  &.active { background: var(--button-bg); color: #fff;
    .material-symbols-outlined { color: #fff; }
  }
}

// ===== 笔记卡片 =====
.notes-header {
  display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;
  strong { font-size: 14px; color: var(--primary-text); }
  .muted { color: var(--secondary-text); font-size: 12px; font-weight: normal; margin-left: 4px; }
}

.notes-toolbar { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.input.compact { font-size: 12px; padding: 4px 8px; }
.btn.compact { font-size: 12px; padding: 4px 10px; }

.note-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 10px;
  overflow-y: auto;
  padding: 4px;
  flex: 1;
  align-content: start;
}

.note-card {
  background: var(--bg-color);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  padding: 10px 12px;
  display: flex; flex-direction: column; gap: 6px;
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s;

  &:hover { border-color: var(--button-bg); box-shadow: 0 2px 6px rgba(0, 0, 0, 0.04); }
  &.selected { border-color: var(--button-bg); background: var(--accent-bg); }
}

.note-card-head {
  display: flex; align-items: center; gap: 6px;
  .note-card-title {
    flex: 1; font-weight: 500; font-size: 13px; color: var(--primary-text);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
}

.note-card-preview {
  margin: 0; font-size: 12px; color: var(--secondary-text);
  display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical;
  overflow: hidden;
  min-height: 30px;
}

.note-card-foot {
  display: flex; align-items: center; gap: 6px;
  font-size: 11px; color: var(--secondary-text);
  .from-folder { background: var(--accent-bg); padding: 1px 6px; border-radius: var(--radius-pill); font-size: 10.5px; }
  .mtime { }
  .spacer { flex: 1; }
}

.icon-btn {
  background: transparent; border: none; cursor: pointer;
  padding: 4px; border-radius: var(--radius-sm);
  color: var(--secondary-text);
  display: inline-flex; align-items: center;
  &:hover { background: var(--accent-bg); color: var(--primary-text); }
  .material-symbols-outlined { font-size: 16px; }
}

.loading-hint {
  display: flex; align-items: center; gap: 6px;
  color: var(--secondary-text); font-size: 13px; padding: 12px;
  .spinning { animation: spin 1s linear infinite; }
}
@keyframes spin { from { transform: rotate(0); } to { transform: rotate(360deg); } }

// ===== 编辑器 =====
.editor { display: flex; flex-direction: column; gap: 8px; height: 100%; }
.editor-header { display: flex; justify-content: space-between; align-items: center;
  strong { font-size: 13px; color: var(--primary-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .actions { display: flex; gap: 6px; flex-shrink: 0; }
}
.editor-hint { margin: 0; font-size: 11px; color: var(--secondary-text); }

// ===== RAG 配置面板 =====
.rag-panel { display: flex; flex-direction: column; gap: 14px; }
.rag-header {
  display: flex; flex-direction: column; gap: 2px;
  padding-bottom: 10px; border-bottom: 1px solid var(--border-color);
  strong { font-size: 14px; color: var(--primary-text); }
  .muted { font-size: 12px; color: var(--secondary-text); }
}

.rag-section {
  display: flex; flex-direction: column; gap: 8px;
  padding: 10px;
  background: var(--accent-bg);
  border-radius: var(--radius-md);

  .row { display: flex; align-items: center; gap: 8px; font-size: 13px; }
  .row.between { justify-content: space-between; }
  .row.top { align-items: flex-start; }
  .small { font-size: 12px; }
  .muted { color: var(--secondary-text); font-size: 12px; }
  code { background: var(--bg-color); padding: 1px 4px; border-radius: var(--radius-sm); font-size: 11px; }
  .empty-tags { padding: 6px; }
}

.slider { flex: 1; }
.threshold-value { min-width: 36px; text-align: right; font-variant-numeric: tabular-nums; font-size: 13px; }

.tag-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 6px; }
.tag-item { display: flex; gap: 4px; align-items: center; .flex { flex: 1; } }

.rag-footer { display: flex; justify-content: flex-end; }

// ===== Discovery Modal =====
.discovery-form {
  display: flex; flex-direction: column; gap: 12px;
  padding: 12px;
  background: var(--accent-bg);
  border-radius: var(--radius-md);
  margin-bottom: 12px;

  .row { display: flex; align-items: center; gap: 8px; font-size: 13px;
    label { min-width: 70px; color: var(--secondary-text); }
    .flex { flex: 1; }
  }
  .row.top { align-items: flex-start; }
}

.chip-row { display: flex; flex-wrap: wrap; gap: 4px; flex: 1; max-height: 120px; overflow-y: auto; }
.chip {
  padding: 3px 8px; border-radius: var(--radius-pill);
  border: 1px solid var(--border-color); background: var(--bg-color);
  cursor: pointer; font-size: 11.5px; color: var(--secondary-text);
  &:hover { border-color: var(--button-bg); }
  &.active { background: var(--button-bg); color: #fff; border-color: var(--button-bg); }
}

.warning-banner {
  background: rgba(255, 200, 0, 0.15); border: 1px solid rgba(255, 200, 0, 0.4);
  padding: 8px 12px; border-radius: var(--radius-sm); font-size: 12px; margin-bottom: 12px;
}

.discovery-results { display: flex; flex-direction: column; gap: 10px; max-height: 360px; overflow-y: auto; padding-right: 4px; }
.discovery-card {
  border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 10px 12px;
  cursor: pointer; transition: border-color 0.15s;
  &:hover { border-color: var(--button-bg); }

  header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;
    .filename { font-weight: 500; font-size: 13px; }
    .score-tag { background: var(--button-bg); color: #fff; padding: 1px 6px; border-radius: var(--radius-pill); font-size: 11px; }
  }
  .score-bar { height: 4px; background: var(--accent-bg); border-radius: 2px; overflow: hidden; margin-bottom: 6px;
    span { display: block; height: 100%; background: linear-gradient(90deg, var(--button-bg), #ff9bb3); transition: width 0.4s; }
  }
  .result-tags { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 4px; }
  .result-tag { background: var(--accent-bg); padding: 1px 6px; border-radius: var(--radius-pill); font-size: 10.5px; color: var(--secondary-text); }
  .result-preview { margin: 0; font-size: 11.5px; color: var(--secondary-text);
    display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
  }
}
</style>
