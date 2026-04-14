<template>
  <div class="page agent-mgr">
    <PageHeader title="Agent 管理" subtitle="每个 Agent = 别名 + 提示词文件 + 专属笔记本" icon="smart_toy">
      <template #actions>
        <input v-model="search" placeholder="搜索 Agent / 文件..." class="search" />
        <button class="btn" @click="openCreateDialog">
          <span class="material-symbols-outlined">person_add</span> 新建 Agent
        </button>
        <button class="btn btn-ghost" @click="reloadAll" :disabled="loading">
          <span class="material-symbols-outlined">refresh</span>
        </button>
      </template>
    </PageHeader>

    <div class="agent-layout">
      <!-- 左：Agent 卡片列表 -->
      <aside class="agent-list card">
        <div class="list-header">
          <span class="list-title">已配置 Agent</span>
          <span class="list-count">{{ filteredAgents.length }}</span>
          <span v-if="mapDirty" class="dirty">● 未保存</span>
        </div>

        <EmptyState v-if="!agents.length && !loading" icon="person_off" message="暂无 Agent，点击「新建」创建" />
        <ul v-else class="cards">
          <li
            v-for="ag in filteredAgents"
            :key="ag.alias"
            class="agent-card"
            :class="{ active: selectedAlias === ag.alias, orphan: ag.orphanFile }"
            @click="selectAgent(ag.alias)"
          >
            <AgentAvatar :alias="ag.alias" :size="36" :cache-bust="avatarVersion.get(ag.alias) || 0" />
            <div class="info">
              <strong class="alias">{{ ag.alias }}</strong>
              <span class="file">{{ ag.file || '（未绑定文件）' }}</span>
            </div>
            <div class="badges">
              <span v-if="ag.notebookCount" class="badge nb" :title="`${ag.notebookCount} 个笔记本`">
                <span class="material-symbols-outlined">book</span>{{ ag.notebookCount }}
              </span>
              <span v-if="ag.orphanFile" class="badge warn" title="文件不存在于 Agent 目录">
                <span class="material-symbols-outlined">warning</span>
              </span>
            </div>
          </li>
        </ul>

        <!-- 未映射的孤儿文件（存在但不被任何别名引用） -->
        <div v-if="orphanFiles.length" class="orphan-files">
          <div class="orphan-header">
            <span class="material-symbols-outlined">draft</span>
            未绑定的文件 <span class="orphan-count">{{ orphanFiles.length }}</span>
          </div>
          <ul>
            <li v-for="f in orphanFiles" :key="f">
              <span class="path">{{ f }}</span>
              <button class="btn btn-ghost mini" @click="bindOrphan(f)">绑定为新 Agent</button>
            </li>
          </ul>
        </div>

        <button v-if="mapDirty" class="btn save-all" @click="saveMap">保存映射</button>
      </aside>

      <!-- 右：详情面板 -->
      <main class="agent-detail">
        <EmptyState v-if="!selected" icon="touch_app" message="选择左侧一个 Agent 开始编辑" />
        <template v-else>
          <!-- 顶部：Agent 基本信息 -->
          <div class="card detail-header">
            <AgentAvatar
              :alias="selected.alias"
              :size="72"
              :cache-bust="avatarVersion.get(selected.alias) || 0"
              clickable
              @click="triggerAvatarUpload"
            >
              <template #overlay>
                <div class="avatar-overlay">
                  <span class="material-symbols-outlined">photo_camera</span>
                </div>
              </template>
            </AgentAvatar>
            <input
              ref="avatarFileInput"
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
              hidden
              @change="onAvatarFileSelected"
            />
            <div class="header-body">
              <div class="name-row">
                <label>别名</label>
                <input v-model="editAlias" @input="markDirty" class="name-input" />
              </div>
              <div class="file-row">
                <label>提示词文件</label>
                <select v-model="editFile" @change="onFileSwitch" class="file-select">
                  <option value="">（未选择）</option>
                  <option v-for="f in files" :key="f" :value="f">{{ f }}</option>
                  <option v-if="editFile && !files.includes(editFile)" :value="editFile">
                    {{ editFile }} (不存在)
                  </option>
                </select>
                <button class="btn btn-ghost mini" @click="openCreateFileDialog" title="新建文件并绑定">
                  <span class="material-symbols-outlined">note_add</span>
                </button>
              </div>
            </div>
            <div class="header-actions">
              <button class="btn btn-ghost" @click="triggerAvatarUpload" title="更换头像">
                <span class="material-symbols-outlined">photo_camera</span>
              </button>
              <button class="btn btn-ghost" @click="onRemoveAvatar" title="移除头像">
                <span class="material-symbols-outlined">no_photography</span>
              </button>
              <button class="btn btn-ghost danger" @click="removeAgent" title="从映射中移除（不删除文件）">
                <span class="material-symbols-outlined">delete</span> 移除
              </button>
            </div>
          </div>

          <!-- Tab 切换 -->
          <div class="tabs-wrap card">
            <Tabs :tabs="detailTabs" v-model:active="activeTab">
              <template #default="{ active }">
                <!-- 提示词编辑 -->
                <div v-if="active === 'prompt'" class="tab-pane">
                  <div v-if="!editFile" class="no-file">
                    <EmptyState icon="description_off" message="先为此 Agent 绑定一个提示词文件" />
                  </div>
                  <template v-else>
                    <div class="editor-toolbar">
                      <span class="file-badge">{{ editFile }}</span>
                      <span v-if="fileDirty" class="dirty-dot">● 未保存</span>
                      <button class="btn" @click="saveFile" :disabled="!fileDirty || fileLoading">保存提示词</button>
                    </div>
                    <CodeEditor v-model="fileContent" :rows="22" placeholder="输入 Agent 的角色提示词..." />
                  </template>
                </div>

                <!-- 笔记本设置 -->
                <div v-else-if="active === 'notebooks'" class="tab-pane">
                  <p class="tip">
                    后端默认约定：<code>Agent/{{ selected.alias || '<别名>' }}/diary</code>、<code>Agent/{{ selected.alias || '<别名>' }}/knowledge</code>
                    — 自动生效无需设置。仅当想**把笔记本放到别处**时才需要自定义。
                  </p>

                  <!-- 预设笔记本：diary / knowledge -->
                  <div class="preset-list">
                    <div v-for="preset in PRESET_NOTEBOOKS" :key="preset.kind" class="preset-card" :class="{ custom: isPresetEnabled(preset.kind) }">
                      <div class="preset-head">
                        <span class="material-symbols-outlined preset-icon">{{ preset.icon }}</span>
                        <div class="preset-info">
                          <strong>{{ preset.label }}</strong>
                          <span class="preset-status">
                            <span v-if="!isPresetEnabled(preset.kind)" class="status-default">
                              默认：<code>{{ defaultPathFor(preset.kind) }}</code>
                            </span>
                            <span v-else class="status-custom">
                              <span class="material-symbols-outlined tiny">edit</span>
                              自定义路径
                            </span>
                          </span>
                        </div>
                        <button
                          v-if="!isPresetEnabled(preset.kind)"
                          class="btn btn-ghost mini"
                          @click="enableCustom(preset.kind)"
                        >
                          <span class="material-symbols-outlined">tune</span> 自定义
                        </button>
                        <button
                          v-else
                          class="btn btn-ghost mini danger"
                          @click="resetToDefault(preset.kind)"
                          title="恢复默认路径（从映射中移除）"
                        >
                          <span class="material-symbols-outlined">restart_alt</span> 恢复默认
                        </button>
                      </div>
                      <div v-if="isPresetEnabled(preset.kind)" class="preset-edit">
                        <span class="material-symbols-outlined arrow-icon">subdirectory_arrow_right</span>
                        <input
                          :value="getNotebookPath(preset.kind)"
                          @input="(e) => updateNotebookPath(preset.kind, (e.target as HTMLInputElement).value)"
                          :placeholder="defaultPathFor(preset.kind)"
                        />
                      </div>
                    </div>
                  </div>

                  <!-- 自定义笔记本 -->
                  <div class="custom-header">
                    <span>额外笔记本</span>
                    <button class="btn btn-ghost mini" @click="addNotebook">
                      <span class="material-symbols-outlined">add</span> 添加
                    </button>
                  </div>
                  <div v-if="customNotebooks.length" class="notebook-list">
                    <div v-for="nb in customNotebooks" :key="notebookList.indexOf(nb)" class="nb-row">
                      <input v-model="nb.name" placeholder="key（如 archive）" @input="markDirty" class="nb-key" />
                      <span class="arrow">→</span>
                      <input v-model="nb.path" :placeholder="`Agent/${selected.alias}/archive`" @input="markDirty" class="nb-val" />
                      <button class="row-del" @click="removeCustomNotebook(nb)" title="删除">
                        <span class="material-symbols-outlined">close</span>
                      </button>
                    </div>
                  </div>
                  <p v-else class="custom-empty">（没有额外笔记本）</p>
                </div>

                <!-- 高级（源码）-->
                <div v-else-if="active === 'raw'" class="tab-pane">
                  <p class="tip">直接编辑此条目的 JSON 结构（不推荐，除非你需要自定义字段）</p>
                  <CodeEditor v-model="rawEntryJson" :rows="10" />
                  <button class="btn mini" @click="applyRawJson">应用到表单</button>
                </div>
              </template>
            </Tabs>
          </div>
        </template>
      </main>
    </div>

    <!-- 新建 Agent 对话框 -->
    <BaseModal v-model="createDialog.open" title="新建 Agent">
      <div class="create-form">
        <label>别名</label>
        <input v-model="createDialog.alias" placeholder="如 Nova" autofocus />
        <label>提示词文件</label>
        <div class="file-create-row">
          <select v-model="createDialog.mode">
            <option value="new">创建新文件</option>
            <option value="link">绑定已存在的文件</option>
          </select>
        </div>
        <input v-if="createDialog.mode === 'new'" v-model="createDialog.fileName" placeholder="如 Nova.txt 或 Nova/Nova.txt" />
        <select v-else v-model="createDialog.fileName">
          <option value="">（选择文件）</option>
          <option v-for="f in files" :key="f" :value="f">{{ f }}</option>
        </select>
      </div>
      <template #footer>
        <button class="btn btn-ghost" @click="createDialog.open = false">取消</button>
        <button class="btn" @click="submitCreate" :disabled="!createDialog.alias.trim() || !createDialog.fileName.trim()">创建</button>
      </template>
    </BaseModal>

    <!-- 新建文件对话框（Agent 详情里的 + 按钮用）-->
    <BaseModal v-model="newFileDialog.open" title="新建提示词文件并绑定">
      <div class="create-form">
        <label>文件名</label>
        <input v-model="newFileDialog.fileName" :placeholder="`如 ${selected?.alias || 'Name'}.txt`" autofocus />
        <p class="tip">文件会创建于 <code>Agent/</code> 根目录。含 <code>/</code> 会自动放入子目录。</p>
      </div>
      <template #footer>
        <button class="btn btn-ghost" @click="newFileDialog.open = false">取消</button>
        <button class="btn" @click="submitNewFile" :disabled="!newFileDialog.fileName.trim()">创建并绑定</button>
      </template>
    </BaseModal>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import PageHeader from '@/components/common/PageHeader.vue'
import CodeEditor from '@/components/common/CodeEditor.vue'
import EmptyState from '@/components/common/EmptyState.vue'
import BaseModal from '@/components/common/BaseModal.vue'
import Tabs from '@/components/common/Tabs.vue'
import {
  getAgentMap, saveAgentMap, listAgentFiles, getAgentFile, saveAgentFile, createAgentFile,
  uploadAvatar, deleteAvatar,
} from '@/api/agents'
import AgentAvatar from '@/components/common/AgentAvatar.vue'
import type { AgentMapNew } from '@/api/types'
import { useUiStore } from '@/stores/ui'
import { useConfirm } from '@/composables/useConfirm'

const ui = useUiStore()
const { confirm } = useConfirm()

// ============================================================
// 数据模型：AgentEntry = 一个 Agent（map 里的一条）
// ============================================================
interface Notebook { name: string; path: string }
interface AgentEntry {
  alias: string           // map 的 key
  file: string            // 提示词文件路径
  notebooks: Notebook[]
  extra?: Record<string, unknown>  // 保留其它字段（forward compat）
}

interface AgentListItem extends AgentEntry {
  notebookCount: number
  orphanFile: boolean     // 引用的文件不存在
}

// ============================================================
// State
// ============================================================
const agents = ref<AgentEntry[]>([])
const origAgentsJson = ref('')
const files = ref<string[]>([])
const loading = ref(false)

const selectedAlias = ref<string | null>(null)
const editAlias = ref('')
const editFile = ref('')
const notebookList = ref<Notebook[]>([])
const rawEntryJson = ref('')
const manuallyDirty = ref(false)

const fileContent = ref('')
const fileOriginal = ref('')
const fileLoading = ref(false)

const search = ref('')
const activeTab = ref('prompt')
const detailTabs = [
  { key: 'prompt', label: '提示词' },
  { key: 'notebooks', label: '笔记本' },
  { key: 'raw', label: '高级' },
]

const createDialog = reactive({ open: false, alias: '', fileName: '', mode: 'new' as 'new' | 'link' })
const newFileDialog = reactive({ open: false, fileName: '' })

// 头像版本 map — 头像更新后递增对应 alias 的值，触发 AgentAvatar 重新加载
const avatarVersion = ref(new Map<string, number>())
const avatarFileInput = ref<HTMLInputElement>()

function bumpAvatar(alias: string) {
  const next = (avatarVersion.value.get(alias) || 0) + 1
  avatarVersion.value.set(alias, next)
  avatarVersion.value = new Map(avatarVersion.value)  // 触发响应
}

// ============================================================
// Computed
// ============================================================
const selected = computed(() => agents.value.find((a) => a.alias === selectedAlias.value) || null)

const filteredAgents = computed<AgentListItem[]>(() => {
  const kw = search.value.toLowerCase().trim()
  const base = agents.value.map((a) => ({
    ...a,
    notebookCount: a.notebooks.length,
    orphanFile: !!a.file && !files.value.includes(a.file),
  }))
  if (!kw) return base
  return base.filter((a) =>
    a.alias.toLowerCase().includes(kw)
    || a.file.toLowerCase().includes(kw),
  )
})

const orphanFiles = computed(() => {
  const used = new Set(agents.value.map((a) => a.file).filter(Boolean))
  return files.value.filter((f) => !used.has(f))
})

const mapDirty = computed(() => manuallyDirty.value || agentsToJson(agents.value) !== origAgentsJson.value)
const fileDirty = computed(() => fileContent.value !== fileOriginal.value)

// ============================================================
// Map ↔ Agents 转换
// ============================================================
function mapToAgents(map: AgentMapNew): AgentEntry[] {
  const arr: AgentEntry[] = []
  for (const [alias, val] of Object.entries(map)) {
    if (typeof val === 'string') {
      arr.push({ alias, file: val, notebooks: [] })
    } else if (val && typeof val === 'object') {
      const v = val as Record<string, unknown>
      const prompt = typeof v.prompt === 'string' ? v.prompt : ''
      const notebooks: Notebook[] = []
      if (v.notebooks && typeof v.notebooks === 'object') {
        for (const [k, p] of Object.entries(v.notebooks as Record<string, unknown>)) {
          if (typeof p === 'string') notebooks.push({ name: k, path: p })
        }
      }
      const { prompt: _p, notebooks: _n, ...extra } = v
      void _p; void _n
      arr.push({ alias, file: prompt, notebooks, extra: Object.keys(extra).length ? extra : undefined })
    }
  }
  return arr
}

function agentsToMap(arr: AgentEntry[]): AgentMapNew {
  const map: AgentMapNew = {}
  for (const a of arr) {
    if (!a.alias) continue
    const hasNotebooks = a.notebooks.length > 0
    const hasExtra = a.extra && Object.keys(a.extra).length
    if (!hasNotebooks && !hasExtra) {
      map[a.alias] = a.file   // 简单字符串格式
    } else {
      const obj: Record<string, unknown> = { prompt: a.file }
      if (hasNotebooks) {
        obj.notebooks = Object.fromEntries(a.notebooks.filter((n) => n.name).map((n) => [n.name, n.path]))
      }
      if (hasExtra) Object.assign(obj, a.extra)
      map[a.alias] = obj as AgentMapNew[string]
    }
  }
  return map
}

function agentsToJson(arr: AgentEntry[]): string {
  return JSON.stringify(agentsToMap(arr), null, 2)
}

// ============================================================
// UI helpers
// ============================================================
function markDirty() { manuallyDirty.value = true }

// ============================================================
// 预设笔记本（diary / knowledge / thinking）
// ============================================================
interface PresetNotebook {
  kind: string          // 同时也是 notebook 的 key name
  label: string
  icon: string
}
// 只保留 Junior 后端原生支持的两种笔记本（diary / knowledge）
// 思维簇（thinking）是独立插件的功能，不在此处管理
const PRESET_NOTEBOOKS: PresetNotebook[] = [
  { kind: 'diary', label: '日记', icon: 'menu_book' },
  { kind: 'knowledge', label: '知识库', icon: 'school' },
]
const PRESET_KINDS = PRESET_NOTEBOOKS.map((p) => p.kind)

/**
 * isPresetEnabled: 此 kind 是否存在于 notebooks 中 = 是否已"自定义"路径
 * 未自定义时后端会自动用 Agent/<alias>/<kind> 默认路径
 */
function isPresetEnabled(kind: string): boolean {
  return notebookList.value.some((n) => n.name === kind)
}

function getNotebookPath(kind: string): string {
  return notebookList.value.find((n) => n.name === kind)?.path || ''
}

function defaultPathFor(kind: string): string {
  const alias = (editAlias.value || selectedAlias.value || 'Agent').trim()
  return `Agent/${alias}/${kind}`
}

/** 从默认切换到自定义 — 把当前默认路径作为初始值加入 notebooks */
function enableCustom(kind: string) {
  notebookList.value.push({ name: kind, path: defaultPathFor(kind) })
  markDirty()
}

/** 恢复默认 — 从 notebooks 移除（后端自动使用默认路径） */
function resetToDefault(kind: string) {
  const idx = notebookList.value.findIndex((n) => n.name === kind)
  if (idx >= 0) {
    notebookList.value.splice(idx, 1)
    markDirty()
  }
}

function updateNotebookPath(kind: string, path: string) {
  const nb = notebookList.value.find((n) => n.name === kind)
  if (nb) { nb.path = path; markDirty() }
}

// ============================================================
// 自定义笔记本（非 PRESET_KINDS 的 notebook）
// ============================================================
const customNotebooks = computed(() => notebookList.value.filter((n) => !PRESET_KINDS.includes(n.name)))

function removeCustomNotebook(nb: Notebook) {
  const idx = notebookList.value.indexOf(nb)
  if (idx >= 0) {
    notebookList.value.splice(idx, 1)
    markDirty()
  }
}

// ============================================================
// 头像上传/移除
// ============================================================
function triggerAvatarUpload() {
  if (!selected.value) return
  avatarFileInput.value?.click()
}

async function onAvatarFileSelected(e: Event) {
  const target = e.target as HTMLInputElement
  const file = target.files?.[0]
  target.value = ''         // 允许选同一个文件再次触发 change
  if (!file || !selected.value) return
  try {
    await uploadAvatar(selected.value.alias, file)
    bumpAvatar(selected.value.alias)
    ui.showMessage('头像已上传', 'success')
  } catch (err) {
    ui.showMessage('上传失败: ' + (err as Error).message, 'error')
  }
}

async function onRemoveAvatar() {
  if (!selected.value) return
  const ok = await confirm('确定移除此 Agent 的头像？', { danger: true, okText: '移除' })
  if (!ok) return
  try {
    await deleteAvatar(selected.value.alias)
    bumpAvatar(selected.value.alias)
    ui.showMessage('头像已移除', 'success')
  } catch (err) {
    const e = err as Error & { status?: number }
    if (e.status === 404) {
      ui.showMessage('未设置头像', 'info')
    } else {
      ui.showMessage('移除失败: ' + e.message, 'error')
    }
  }
}

function addNotebook() {
  notebookList.value.push({ name: '', path: '' })
  markDirty()
}

// ============================================================
// Agent selection / form binding
// ============================================================
async function selectAgent(alias: string) {
  if (fileDirty.value) {
    const ok = await confirm('当前提示词有未保存的修改，确定切换吗？', { danger: true, okText: '切换' })
    if (!ok) return
  }
  // 把当前编辑的内容同步回 agents 数组
  syncEditBackToAgents()
  selectedAlias.value = alias
  const ag = agents.value.find((a) => a.alias === alias)
  if (!ag) return
  editAlias.value = ag.alias
  editFile.value = ag.file
  notebookList.value = ag.notebooks.map((n) => ({ ...n }))
  rawEntryJson.value = JSON.stringify(agentsToMap([ag])[ag.alias], null, 2)
  activeTab.value = 'prompt'
  if (ag.file) loadFileContent(ag.file)
  else { fileContent.value = ''; fileOriginal.value = '' }
}

/** 把右侧 form 的值同步回 agents 数组（保存前调用） */
function syncEditBackToAgents() {
  if (!selectedAlias.value) return
  const idx = agents.value.findIndex((a) => a.alias === selectedAlias.value)
  if (idx < 0) return
  const old = agents.value[idx]
  const updated: AgentEntry = {
    alias: editAlias.value.trim() || old.alias,
    file: editFile.value,
    notebooks: notebookList.value.filter((n) => n.name.trim() || n.path.trim()),
    extra: old.extra,
  }
  agents.value.splice(idx, 1, updated)
  selectedAlias.value = updated.alias
}

async function loadFileContent(path: string) {
  fileLoading.value = true
  try {
    const data = await getAgentFile(path)
    fileContent.value = data.content
    fileOriginal.value = data.content
  } catch (e) {
    const err = e as Error & { status?: number }
    if (err.status === 404) {
      fileContent.value = ''
      fileOriginal.value = ''
    } else {
      ui.showMessage(err.message, 'error')
    }
  } finally {
    fileLoading.value = false
  }
}

async function onFileSwitch() {
  if (fileDirty.value) {
    const ok = await confirm('当前文件有未保存的修改，确定切换吗？', { danger: true, okText: '切换' })
    if (!ok) {
      // 回退
      const ag = agents.value.find((a) => a.alias === selectedAlias.value)
      if (ag) editFile.value = ag.file
      return
    }
  }
  markDirty()
  if (editFile.value) loadFileContent(editFile.value)
  else { fileContent.value = ''; fileOriginal.value = '' }
}

async function removeAgent() {
  if (!selected.value) return
  const ok = await confirm(`将 "${selected.value.alias}" 从映射表移除？\n（文件 ${selected.value.file} 不会被删除）`, {
    danger: true, okText: '移除',
  })
  if (!ok) return
  agents.value = agents.value.filter((a) => a.alias !== selected.value!.alias)
  selectedAlias.value = null
  markDirty()
}

async function saveFile() {
  if (!editFile.value) return
  try {
    await saveAgentFile(editFile.value, fileContent.value)
    fileOriginal.value = fileContent.value
    ui.showMessage('提示词已保存', 'success')
  } catch { /* */ }
}

async function saveMap() {
  syncEditBackToAgents()
  try {
    // 校验
    const seen = new Set<string>()
    for (const a of agents.value) {
      if (!a.alias.trim()) throw new Error('存在空别名')
      if (seen.has(a.alias)) throw new Error(`别名重复: ${a.alias}`)
      seen.add(a.alias)
    }
    const map = agentsToMap(agents.value)
    await saveAgentMap(map)
    origAgentsJson.value = agentsToJson(agents.value)
    manuallyDirty.value = false
    ui.showMessage('映射表已保存（重启服务生效）', 'success')
  } catch (e) {
    ui.showMessage('保存失败: ' + (e as Error).message, 'error')
  }
}

function applyRawJson() {
  try {
    const parsed = JSON.parse(rawEntryJson.value)
    if (typeof parsed === 'string') {
      editFile.value = parsed
      notebookList.value = []
    } else if (parsed && typeof parsed === 'object') {
      const v = parsed as Record<string, unknown>
      if (typeof v.prompt === 'string') editFile.value = v.prompt
      if (v.notebooks && typeof v.notebooks === 'object') {
        notebookList.value = Object.entries(v.notebooks as Record<string, unknown>)
          .filter(([, p]) => typeof p === 'string')
          .map(([k, p]) => ({ name: k, path: p as string }))
      }
      // 保留其余字段到 extra
      if (selected.value) {
        const { prompt: _p, notebooks: _n, ...extra } = v
        void _p; void _n
        selected.value.extra = Object.keys(extra).length ? extra : undefined
      }
    }
    markDirty()
    ui.showMessage('已应用到表单', 'success', 1500)
  } catch (e) {
    ui.showMessage('JSON 错误: ' + (e as Error).message, 'error')
  }
}

// ============================================================
// 新建 Agent
// ============================================================
function openCreateDialog() {
  createDialog.alias = ''
  createDialog.fileName = ''
  createDialog.mode = 'new'
  createDialog.open = true
}

async function submitCreate() {
  const alias = createDialog.alias.trim()
  const fileName = createDialog.fileName.trim()
  if (!alias || !fileName) return
  if (agents.value.some((a) => a.alias === alias)) {
    ui.showMessage('别名已存在', 'error')
    return
  }
  try {
    let finalFileName = fileName
    if (createDialog.mode === 'new') {
      // 创建文件
      let realName = fileName
      let folderPath: string | undefined
      if (fileName.includes('/')) {
        const idx = fileName.lastIndexOf('/')
        folderPath = fileName.slice(0, idx)
        realName = fileName.slice(idx + 1)
      }
      await createAgentFile(realName, folderPath)
      finalFileName = fileName.endsWith('.txt') || fileName.endsWith('.md') ? fileName : fileName + '.txt'
    }
    // 加入 map
    agents.value.push({ alias, file: finalFileName, notebooks: [] })
    markDirty()
    // 直接保存 map（用户创建后一般期望立即生效）
    await saveMap()
    // 重新扫描文件列表
    const fileList = await listAgentFiles()
    files.value = (fileList.files || []).slice().sort()
    selectAgent(alias)
    createDialog.open = false
  } catch (e) {
    ui.showMessage('创建失败: ' + (e as Error).message, 'error')
  }
}

function openCreateFileDialog() {
  newFileDialog.fileName = (selected.value?.alias || '') + '.txt'
  newFileDialog.open = true
}

async function submitNewFile() {
  const fileName = newFileDialog.fileName.trim()
  if (!fileName) return
  try {
    let realName = fileName
    let folderPath: string | undefined
    if (fileName.includes('/')) {
      const idx = fileName.lastIndexOf('/')
      folderPath = fileName.slice(0, idx)
      realName = fileName.slice(idx + 1)
    }
    await createAgentFile(realName, folderPath)
    const finalFileName = fileName.endsWith('.txt') || fileName.endsWith('.md') ? fileName : fileName + '.txt'
    const fileList = await listAgentFiles()
    files.value = (fileList.files || []).slice().sort()
    editFile.value = finalFileName
    markDirty()
    onFileSwitch()
    newFileDialog.open = false
    ui.showMessage('文件已创建并绑定', 'success')
  } catch (e) {
    ui.showMessage('创建失败: ' + (e as Error).message, 'error')
  }
}

async function bindOrphan(filePath: string) {
  // 从文件路径猜个别名（文件名去扩展名）
  const base = filePath.split('/').pop() || filePath
  const guess = base.replace(/\.(txt|md)$/i, '')
  openCreateDialog()
  createDialog.alias = guess
  createDialog.fileName = filePath
  createDialog.mode = 'link'
}

// ============================================================
// 数据加载
// ============================================================
async function reloadAll() {
  loading.value = true
  try {
    const [map, fileList] = await Promise.all([
      getAgentMap(),
      listAgentFiles().catch(() => ({ files: [] as string[], folderStructure: {} })),
    ])
    agents.value = mapToAgents(map)
    origAgentsJson.value = agentsToJson(agents.value)
    manuallyDirty.value = false
    files.value = (fileList.files || []).slice().sort()
  } finally { loading.value = false }
}

onMounted(reloadAll)

// 编辑 form 变动时同步回数据（保持列表即时更新）
watch([editAlias, editFile, notebookList], () => {
  if (selectedAlias.value) syncEditBackToAgents()
}, { deep: true })
</script>

<style lang="scss" scoped>
.search {
  padding: 6px 12px;
  border-radius: var(--radius-pill);
  font-size: 13px;
  width: 220px;
}

.agent-layout {
  display: grid;
  grid-template-columns: 360px 1fr;
  gap: 16px;
  padding: 0 24px 24px;
  min-height: 620px;
  @media (max-width: 1000px) { grid-template-columns: 1fr; }
}

// ====== 左侧 Agent 列表 ======
.agent-list {
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: calc(100vh - 180px);
  overflow-y: auto;
}

.list-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 2px;
  font-size: 12px;
  color: var(--secondary-text);

  .list-title { font-weight: 500; }
  .list-count {
    background: var(--accent-bg);
    color: var(--highlight-text);
    padding: 1px 7px;
    border-radius: var(--radius-pill);
    font-size: 11px;
  }
  .dirty {
    margin-left: auto;
    color: var(--highlight-text);
    font-size: 11px;
  }
}

.cards {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.agent-card {
  display: grid;
  grid-template-columns: 36px 1fr auto;
  gap: 10px;
  padding: 10px;
  background: var(--tertiary-bg);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all 0.15s;

  &:hover {
    transform: translateX(2px);
    box-shadow: 0 2px 8px rgba(180, 120, 140, 0.1);
  }

  &.active {
    border-color: var(--button-bg);
    background: var(--accent-bg);
  }

  &.orphan { border-left: 3px solid #e6a94c; }
}

.info {
  display: flex;
  flex-direction: column;
  min-width: 0;

  .alias { font-size: 14px; color: var(--primary-text); }
  .file { font-size: 11px; color: var(--secondary-text); font-family: 'JetBrains Mono', Consolas, monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
}

.badges {
  display: flex;
  flex-direction: column;
  gap: 2px;
  align-items: flex-end;
  justify-content: center;

  .badge {
    font-size: 10px;
    padding: 1px 6px;
    border-radius: var(--radius-pill);
    display: inline-flex;
    align-items: center;
    gap: 2px;
    background: var(--accent-bg);
    color: var(--highlight-text);

    .material-symbols-outlined { font-size: 11px; }

    &.warn { background: rgba(230, 169, 76, 0.15); color: #b07a1f; }
    &.nb { background: rgba(109, 187, 138, 0.15); color: #4a8d63; }
  }
}

// ====== 孤儿文件 ======
.orphan-files {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px dashed var(--border-color);

  .orphan-header {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--secondary-text);
    margin-bottom: 6px;

    .material-symbols-outlined { font-size: 14px; color: #b07a1f; }
    .orphan-count { color: #b07a1f; font-weight: 500; }
  }

  ul { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 4px; }
  li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 5px 8px;
    background: rgba(230, 169, 76, 0.05);
    border-radius: var(--radius-sm);
    font-size: 12px;

    .path { font-family: 'JetBrains Mono', Consolas, monospace; color: var(--secondary-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .mini { padding: 2px 8px; font-size: 11px; }
  }
}

.save-all {
  margin-top: 10px;
  padding: 8px;
  font-size: 13px;
  position: sticky;
  bottom: 0;
}

// ====== 右侧详情 ======
.agent-detail {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.detail-header {
  padding: 16px;
  display: grid;
  grid-template-columns: 72px 1fr auto;
  gap: 16px;
  align-items: center;
}

.avatar-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity 0.15s;

  .material-symbols-outlined {
    color: #fff;
    font-size: 22px;
  }
}

.detail-header :deep(.agent-avatar.clickable:hover) .avatar-overlay { opacity: 1; }

.header-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.name-row, .file-row {
  display: flex;
  align-items: center;
  gap: 10px;

  label {
    font-size: 12px;
    color: var(--secondary-text);
    width: 80px;
    flex-shrink: 0;
  }
}

.name-input {
  flex: 1;
  font-size: 16px;
  font-weight: 500;
}

.file-select {
  flex: 1;
  font-size: 13px;
  font-family: 'JetBrains Mono', Consolas, monospace;
  background: var(--input-bg);
  min-width: 0;
}

.header-actions {
  display: flex;
  gap: 6px;

  .btn-ghost.danger {
    color: var(--danger-color);
    &:hover { background: rgba(217, 85, 85, 0.08); }
  }
}

.tabs-wrap { padding: 12px 16px; }

.tab-pane {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 300px;
}

.editor-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;

  .file-badge {
    background: var(--accent-bg);
    color: var(--highlight-text);
    padding: 3px 10px;
    border-radius: var(--radius-pill);
    font-size: 12px;
    font-family: 'JetBrains Mono', Consolas, monospace;
  }

  .dirty-dot {
    color: var(--highlight-text);
    font-size: 12px;
  }

  .btn { margin-left: auto; }
}

.tip {
  margin: 0;
  font-size: 12px;
  color: var(--secondary-text);

  code {
    background: var(--accent-bg);
    padding: 1px 6px;
    border-radius: 4px;
    font-family: 'JetBrains Mono', Consolas, monospace;
  }
}

.no-file { padding: 30px 0; }

// ====== 预设笔记本 ======
.preset-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 16px;
}

.preset-card {
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  padding: 12px 14px;
  background: var(--tertiary-bg);
  transition: all 0.2s;

  &.custom {
    border-color: var(--button-bg);
    background: var(--accent-bg);
  }
}

.preset-head {
  display: flex;
  align-items: center;
  gap: 12px;

  .preset-icon {
    font-size: 22px;
    color: var(--highlight-text);
  }

  .preset-info {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;

    strong {
      font-size: 14px;
      color: var(--primary-text);
    }

    .preset-status {
      font-size: 11px;
      color: var(--secondary-text);
      display: inline-flex;
      align-items: center;
      gap: 3px;

      code {
        background: rgba(61, 44, 62, 0.04);
        padding: 1px 6px;
        border-radius: 3px;
        font-family: 'JetBrains Mono', Consolas, monospace;
      }

      .status-custom {
        color: var(--highlight-text);
        display: inline-flex;
        align-items: center;
        gap: 3px;
      }

      .tiny { font-size: 12px; }
    }
  }
}

.preset-head .mini.danger {
  color: var(--danger-color);
  &:hover { background: rgba(217, 85, 85, 0.08); }
}

.preset-edit {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px dashed var(--border-color);
  display: grid;
  grid-template-columns: 24px 1fr;
  gap: 8px;
  align-items: center;

  .arrow-icon {
    color: var(--secondary-text);
    font-size: 18px;
  }

  input {
    padding: 6px 10px;
    font-size: 13px;
    font-family: 'JetBrains Mono', Consolas, monospace;
  }
}

// ====== 自定义笔记本 ======
.custom-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 0;
  border-top: 1px dashed var(--border-color);
  color: var(--secondary-text);
  font-size: 12px;
  margin-top: 4px;

  .mini {
    padding: 3px 10px;
    font-size: 11px;
    .material-symbols-outlined { font-size: 14px; }
  }
}

.custom-empty {
  margin: 0;
  font-size: 11px;
  color: var(--secondary-text);
  font-style: italic;
  padding: 4px 0;
}

.notebook-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.nb-row {
  display: grid;
  grid-template-columns: 160px 14px 1fr 28px;
  gap: 6px;
  align-items: center;

  .nb-key { font-family: 'JetBrains Mono', Consolas, monospace; padding: 6px 10px; font-size: 13px; }
  .nb-val { font-family: 'JetBrains Mono', Consolas, monospace; padding: 6px 10px; font-size: 13px; }
  .arrow { color: var(--secondary-text); text-align: center; font-size: 12px; }

  .row-del {
    background: transparent;
    border: none;
    color: var(--secondary-text);
    cursor: pointer;
    border-radius: var(--radius-sm);
    padding: 2px;
    display: flex;
    align-items: center;
    justify-content: center;

    &:hover { color: var(--danger-color); background: rgba(217, 85, 85, 0.1); }
    .material-symbols-outlined { font-size: 16px; }
  }
}

// ====== Create dialog ======
.create-form {
  display: flex;
  flex-direction: column;
  gap: 8px;

  label {
    font-size: 12px;
    color: var(--secondary-text);
  }
  input, select {
    padding: 8px 12px;
  }
  .file-create-row {
    display: flex;
    gap: 6px;

    select { flex: 1; }
  }
}

.btn.mini {
  padding: 4px 10px;
  font-size: 12px;
}
</style>
