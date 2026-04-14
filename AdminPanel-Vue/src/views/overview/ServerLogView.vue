<template>
  <div class="page log-viewer">
    <PageHeader title="服务器日志" subtitle="当前会话 / 历史归档 / 重启脚本日志" icon="description" />

    <!-- Tab 切换 -->
    <div class="log-tabs">
      <button
        v-for="t in tabs"
        :key="t.value"
        class="tab-btn"
        :class="{ active: activeTab === t.value }"
        @click="activeTab = t.value"
      >
        <span class="material-symbols-outlined">{{ t.icon }}</span>
        <span>{{ t.label }}</span>
        <span v-if="t.value === 'archives' && totalArchives > 0" class="count">{{ totalArchives }}</span>
      </button>
    </div>

    <!-- 通用工具栏（当前会话 + 归档共用） -->
    <div v-if="activeTab !== 'restart'" class="log-toolbar">
      <div class="tb-left">
        <div class="search-box">
          <span class="material-symbols-outlined">search</span>
          <input v-model="searchText" placeholder="搜索关键字..." />
          <button v-if="searchText" class="clear-btn" @click="searchText = ''">
            <span class="material-symbols-outlined">close</span>
          </button>
        </div>
        <div class="level-filter">
          <button
            v-for="lv in levelOptions"
            :key="lv.value"
            class="lv-btn"
            :class="[lv.value, { active: levelFilter === lv.value }]"
            @click="levelFilter = lv.value"
          >
            {{ lv.label }}
          </button>
        </div>
      </div>

      <div class="tb-right">
        <label v-if="activeTab === 'current'" class="auto-refresh">
          <input type="checkbox" v-model="autoRefresh" />
          <span>自动刷新 3s</span>
        </label>
        <button class="btn btn-ghost icon-btn" title="跳到顶部" @click="scrollToTop">
          <span class="material-symbols-outlined">keyboard_double_arrow_up</span>
        </button>
        <button class="btn btn-ghost icon-btn" title="跳到底部" @click="scrollToBottom">
          <span class="material-symbols-outlined">keyboard_double_arrow_down</span>
        </button>
        <button class="btn btn-ghost icon-btn" title="复制当前内容" @click="copyAll">
          <span class="material-symbols-outlined">content_copy</span>
        </button>
        <button v-if="activeTab === 'current'" class="btn btn-ghost icon-btn" title="刷新" :disabled="loading" @click="reloadCurrent(true)">
          <span class="material-symbols-outlined" :class="{ spin: loading }">refresh</span>
        </button>
        <button v-if="activeTab === 'current'" class="btn btn-ghost icon-btn danger" title="清空当前日志" @click="clearCurrent">
          <span class="material-symbols-outlined">delete</span>
        </button>
      </div>
    </div>

    <!-- ============== Tab 1: 当前会话 ============== -->
    <div v-show="activeTab === 'current'" class="log-body">
      <div class="log-meta">
        <span class="meta-item">
          <span class="material-symbols-outlined">folder_open</span>
          DebugLog/ServerLog.txt
        </span>
        <span class="meta-item">
          <span class="material-symbols-outlined">text_snippet</span>
          {{ formatSize(rawContent.length) }}
        </span>
        <span class="meta-item">
          <span class="material-symbols-outlined">filter_alt</span>
          显示 {{ filteredLineCount }} 行
          <span v-if="filteredLineCount !== totalLineCount" class="muted">/ 共 {{ totalLineCount }} 行</span>
        </span>
        <span v-if="searchText" class="meta-item hit">
          <span class="material-symbols-outlined">search</span>
          {{ matchCount }} 处匹配
        </span>
      </div>
      <pre ref="currentPre" class="log-pre" v-html="renderedCurrent" @scroll="onScroll"></pre>
    </div>

    <!-- ============== Tab 2: 历史归档 ============== -->
    <div v-show="activeTab === 'archives'" class="log-body archive-layout">
      <!-- 左侧：归档树 -->
      <aside class="archive-tree">
        <header class="tree-head">
          <h4>
            <span class="material-symbols-outlined">inventory_2</span>
            归档会话
          </h4>
          <button class="btn btn-ghost icon-btn" title="刷新列表" @click="loadArchives">
            <span class="material-symbols-outlined" :class="{ spin: archivesLoading }">refresh</span>
          </button>
        </header>

        <div v-if="archivesLoading && archives.length === 0" class="tree-placeholder">
          <span class="material-symbols-outlined spin">progress_activity</span>
          加载归档...
        </div>
        <div v-else-if="archives.length === 0" class="tree-placeholder">
          <span class="material-symbols-outlined">inbox</span>
          暂无历史归档
          <small>每次重启服务时，上次的日志会归档到这里</small>
        </div>

        <div v-else class="tree-scroll">
          <div v-for="day in archives" :key="day.date" class="day-group">
            <div class="day-head" @click="toggleDay(day.date)">
              <span class="material-symbols-outlined chev" :class="{ open: openedDays.has(day.date) }">chevron_right</span>
              <strong>{{ day.date }}</strong>
              <span class="day-count">{{ day.sessions.length }}</span>
            </div>
            <transition name="fade">
              <div v-show="openedDays.has(day.date)" class="day-sessions">
                <article
                  v-for="s in day.sessions"
                  :key="`${day.date}-${s.index}`"
                  class="session-card"
                  :class="{ active: activeArchive && activeArchive.date === day.date && activeArchive.index === s.index }"
                  @click="openArchive(day.date, s.index)"
                >
                  <div class="sc-head">
                    <span class="sc-idx">#{{ String(s.index).padStart(3, '0') }}</span>
                    <span class="sc-size">{{ formatSize(s.size) }}</span>
                    <button class="btn-tiny danger" title="删除此归档" @click.stop="deleteArchive(day.date, s.index)">
                      <span class="material-symbols-outlined">delete</span>
                    </button>
                  </div>
                  <div class="sc-time">{{ formatTime(s.mtime) }}</div>
                  <div v-if="s.firstLine" class="sc-first">{{ s.firstLine }}</div>
                </article>
              </div>
            </transition>
          </div>
        </div>
      </aside>

      <!-- 右侧：归档内容 -->
      <div class="archive-content">
        <div v-if="!activeArchive" class="content-placeholder">
          <span class="material-symbols-outlined">description</span>
          <p>在左侧选择一个归档会话查看完整日志</p>
        </div>
        <template v-else>
          <div class="log-meta">
            <span class="meta-item">
              <span class="material-symbols-outlined">inventory_2</span>
              {{ activeArchive.date }} / #{{ String(activeArchive.index).padStart(3, '0') }}
            </span>
            <span class="meta-item">
              <span class="material-symbols-outlined">text_snippet</span>
              {{ formatSize(archiveContent.fileSize || 0) }}
            </span>
            <span v-if="archiveContent.truncated" class="meta-item warn">
              <span class="material-symbols-outlined">content_cut</span>
              内容过大，仅显示末尾 5MB
            </span>
            <span v-if="archiveContent.hasError" class="meta-item error">
              <span class="material-symbols-outlined">error</span>
              包含 ERROR
            </span>
            <span class="meta-item">
              <span class="material-symbols-outlined">filter_alt</span>
              显示 {{ filteredArchiveLineCount }} 行
            </span>
          </div>
          <pre ref="archivePre" class="log-pre" v-html="renderedArchive"></pre>
        </template>
      </div>
    </div>

    <!-- ============== Tab 3: 重启脚本日志 ============== -->
    <div v-show="activeTab === 'restart'" class="log-body restart-layout">
      <header class="restart-head">
        <div class="head-left">
          <span class="hl-title">重启脚本日志</span>
          <small>由 server/admin 重启脚本写入，独立于主日志系统</small>
        </div>
        <button class="btn btn-ghost icon-btn" title="刷新" :disabled="restartLoading" @click="loadRestartLogs">
          <span class="material-symbols-outlined" :class="{ spin: restartLoading }">refresh</span>
        </button>
      </header>

      <div class="restart-grid">
        <section v-for="rf in restartFiles" :key="rf.key" class="restart-card card">
          <header class="rc-head">
            <div class="rc-title">
              <span class="material-symbols-outlined">{{ rf.icon }}</span>
              <strong>{{ rf.name }}</strong>
            </div>
            <div class="rc-meta">
              <span v-if="rf.file.exists">
                {{ formatSize(rf.file.size) }} · {{ formatTime(rf.file.mtime) }}
              </span>
              <span v-else class="muted">文件不存在</span>
            </div>
          </header>
          <pre v-if="rf.file.exists" class="log-pre compact">{{ rf.file.content || '（空）' }}</pre>
          <div v-else class="rc-placeholder">
            <span class="material-symbols-outlined">info</span>
            <span>{{ rf.filename }} 不存在</span>
          </div>
          <p v-if="rf.file.truncated" class="rc-truncated">
            <span class="material-symbols-outlined">content_cut</span>
            文件较大，仅显示末尾 200KB
          </p>
        </section>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import PageHeader from '@/components/common/PageHeader.vue'
import {
  getServerLog,
  clearServerLog,
  getServerLogArchives,
  getServerLogArchiveContent,
  deleteServerLogArchive,
  getRestartLogs,
  type ArchiveDay,
  type RestartLogFile,
} from '@/api/system'
import { useUiStore } from '@/stores/ui'

const ui = useUiStore()

// ============ Tab 状态 ============
type TabKey = 'current' | 'archives' | 'restart'
const activeTab = ref<TabKey>('current')
const tabs: Array<{ value: TabKey; label: string; icon: string }> = [
  { value: 'current', label: '当前会话', icon: 'podcasts' },
  { value: 'archives', label: '历史归档', icon: 'inventory_2' },
  { value: 'restart', label: '重启脚本', icon: 'restart_alt' },
]

// ============ 共用过滤 ============
const searchText = ref('')
type LevelKey = 'all' | 'error' | 'warn' | 'info'
const levelFilter = ref<LevelKey>('all')
const levelOptions: Array<{ value: LevelKey; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'error', label: 'ERROR' },
  { value: 'warn', label: 'WARN+' },
  { value: 'info', label: 'INFO+' },
]

// ============ 当前会话 ============
const rawContent = ref('')
const autoRefresh = ref(true)
const loading = ref(false)
const currentPre = ref<HTMLElement>()
let currentOffset = 0
let refreshTimer: number | null = null
let userScrolledUp = false

async function reloadCurrent(fullReload = false) {
  loading.value = true
  try {
    if (fullReload) { rawContent.value = ''; currentOffset = 0 }
    const data = await getServerLog(currentOffset, currentOffset > 0)
    if (data.needFullReload) {
      rawContent.value = data.content
      currentOffset = data.offset
    } else if (currentOffset === 0) {
      rawContent.value = data.content
      currentOffset = data.offset
    } else {
      rawContent.value += data.content
      currentOffset = data.offset
    }
    await nextTick()
    if (!userScrolledUp) scrollToBottom()
  } catch (err) {
    console.warn('[ServerLog] reload failed', err)
  } finally {
    loading.value = false
  }
}

async function clearCurrent() {
  if (!confirm('确认清空当前会话日志吗？此操作不可撤销。')) return
  try {
    await clearServerLog()
    rawContent.value = ''
    currentOffset = 0
    ui.showMessage('当前日志已清空', 'success', 1500)
  } catch (err: any) {
    ui.showMessage('清空失败：' + (err?.message || err), 'error')
  }
}

function onScroll() {
  if (!currentPre.value) return
  const el = currentPre.value
  // 距离底部 > 50px 视为用户手动往上看，暂停自动滚底
  userScrolledUp = el.scrollHeight - el.scrollTop - el.clientHeight > 50
}

watch(autoRefresh, (v) => {
  if (v) {
    refreshTimer = window.setInterval(() => {
      if (activeTab.value === 'current') reloadCurrent(false)
    }, 3000)
  } else if (refreshTimer) {
    clearInterval(refreshTimer)
    refreshTimer = null
  }
})

// ============ 归档 ============
const archives = ref<ArchiveDay[]>([])
const archivesLoading = ref(false)
const openedDays = ref<Set<string>>(new Set())
const activeArchive = ref<{ date: string; index: number } | null>(null)
const archiveContent = ref<{ content: string; fileSize: number; truncated: boolean; hasError: boolean }>({
  content: '', fileSize: 0, truncated: false, hasError: false,
})
const archivePre = ref<HTMLElement>()

const totalArchives = computed(() => archives.value.reduce((sum, d) => sum + d.sessions.length, 0))

async function loadArchives() {
  archivesLoading.value = true
  try {
    const r = await getServerLogArchives()
    archives.value = r.archives || []
    // 默认展开最新日期
    if (archives.value.length > 0) {
      openedDays.value = new Set([archives.value[0].date])
    }
  } finally {
    archivesLoading.value = false
  }
}

function toggleDay(date: string) {
  const s = new Set(openedDays.value)
  if (s.has(date)) s.delete(date)
  else s.add(date)
  openedDays.value = s
}

async function openArchive(date: string, index: number) {
  activeArchive.value = { date, index }
  archiveContent.value = { content: '', fileSize: 0, truncated: false, hasError: false }
  try {
    const r = await getServerLogArchiveContent(date, index)
    archiveContent.value = {
      content: r.content,
      fileSize: r.fileSize,
      truncated: r.truncated,
      hasError: r.hasError,
    }
    await nextTick()
    if (archivePre.value) archivePre.value.scrollTop = 0
  } catch (err: any) {
    ui.showMessage('加载归档失败：' + (err?.message || err), 'error')
  }
}

async function deleteArchive(date: string, index: number) {
  if (!confirm(`确认删除归档 ${date}/#${String(index).padStart(3, '0')} 吗？`)) return
  try {
    await deleteServerLogArchive(date, index)
    if (activeArchive.value && activeArchive.value.date === date && activeArchive.value.index === index) {
      activeArchive.value = null
      archiveContent.value = { content: '', fileSize: 0, truncated: false, hasError: false }
    }
    await loadArchives()
    ui.showMessage('归档已删除', 'success', 1500)
  } catch (err: any) {
    ui.showMessage('删除失败：' + (err?.message || err), 'error')
  }
}

// ============ 重启日志 ============
const restartLoading = ref(false)
const serverRestart = ref<RestartLogFile>({ exists: false, content: '', size: 0, truncated: false, mtime: 0 })
const adminRestart = ref<RestartLogFile>({ exists: false, content: '', size: 0, truncated: false, mtime: 0 })

const restartFiles = computed(() => [
  { key: 'server', name: '主服务重启日志', filename: 'server-restart.log', icon: 'dns', file: serverRestart.value },
  { key: 'admin', name: '管理面板重启日志', filename: 'admin-restart.log', icon: 'admin_panel_settings', file: adminRestart.value },
])

async function loadRestartLogs() {
  restartLoading.value = true
  try {
    const r = await getRestartLogs()
    serverRestart.value = r.server
    adminRestart.value = r.admin
  } finally {
    restartLoading.value = false
  }
}

// ============ 等级过滤 + 搜索 ============
// 按日志行切分：形如 "[时间] [LEVEL] ..." 开头
// 连续的非标记行归属上一条（多行 JSON）
interface LogBlock {
  level: string  // LOG / INFO / WARN / ERROR / other
  text: string
}

function parseBlocks(raw: string): LogBlock[] {
  if (!raw) return []
  const lines = raw.split('\n')
  const blocks: LogBlock[] = []
  const levelRe = /^\[[^\]]+\]\s*\[(LOG|INFO|WARN|ERROR)\]/

  let current: LogBlock | null = null
  for (const line of lines) {
    const m = line.match(levelRe)
    if (m) {
      if (current) blocks.push(current)
      current = { level: m[1], text: line }
    } else {
      if (current) current.text += '\n' + line
      else current = { level: 'LOG', text: line }
    }
  }
  if (current) blocks.push(current)
  return blocks
}

function passesLevelFilter(level: string): boolean {
  switch (levelFilter.value) {
    case 'all': return true
    case 'error': return level === 'ERROR'
    case 'warn': return level === 'ERROR' || level === 'WARN'
    case 'info': return level === 'ERROR' || level === 'WARN' || level === 'INFO'
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function renderBlocks(raw: string): { html: string; lineCount: number; matchCount: number } {
  const blocks = parseBlocks(raw)
  const parts: string[] = []
  let lineCount = 0
  let matchCount = 0
  const q = searchText.value.trim()
  const hi = q ? new RegExp(escapeRegex(q), 'gi') : null

  for (const b of blocks) {
    if (!passesLevelFilter(b.level)) continue
    if (hi) {
      if (!hi.test(b.text)) continue
      hi.lastIndex = 0
    }
    let html = escapeHtml(b.text)
    if (hi) {
      html = html.replace(hi, (s) => {
        matchCount++
        return `<mark>${s}</mark>`
      })
    }
    const cls = `lvl-${b.level.toLowerCase()}`
    parts.push(`<span class="log-line ${cls}">${html}</span>`)
    lineCount += b.text.split('\n').length
  }

  return { html: parts.join('\n'), lineCount, matchCount }
}

const currentRender = computed(() => renderBlocks(rawContent.value))
const renderedCurrent = computed(() => currentRender.value.html || '<span class="empty">（暂无日志）</span>')
const filteredLineCount = computed(() => currentRender.value.lineCount)
const matchCount = computed(() => currentRender.value.matchCount)
const totalLineCount = computed(() => rawContent.value ? rawContent.value.split('\n').length : 0)

const archiveRender = computed(() => renderBlocks(archiveContent.value.content))
const renderedArchive = computed(() => archiveRender.value.html || '<span class="empty">（空内容）</span>')
const filteredArchiveLineCount = computed(() => archiveRender.value.lineCount)

// ============ 工具函数 ============
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

function formatTime(ts: number): string {
  if (!ts) return '-'
  const d = new Date(ts * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function scrollToTop() {
  const el = activeTab.value === 'current' ? currentPre.value : archivePre.value
  if (el) { el.scrollTop = 0; userScrolledUp = true }
}

function scrollToBottom() {
  const el = activeTab.value === 'current' ? currentPre.value : archivePre.value
  if (el) { el.scrollTop = el.scrollHeight; userScrolledUp = false }
}

function copyAll() {
  const raw = activeTab.value === 'current' ? rawContent.value : archiveContent.value.content
  navigator.clipboard.writeText(raw).then(() => ui.showMessage('内容已复制', 'success', 1500))
}

// ============ Tab 切换时懒加载 ============
watch(activeTab, async (tab) => {
  if (tab === 'archives' && archives.value.length === 0) {
    await loadArchives()
  } else if (tab === 'restart') {
    await loadRestartLogs()
  }
})

onMounted(() => {
  reloadCurrent(true)
  if (autoRefresh.value) {
    refreshTimer = window.setInterval(() => {
      if (activeTab.value === 'current') reloadCurrent(false)
    }, 3000)
  }
})

onBeforeUnmount(() => {
  if (refreshTimer) clearInterval(refreshTimer)
})
</script>

<style lang="scss" scoped>
.log-viewer {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

/* ============ Tab 栏 ============ */
.log-tabs {
  display: flex;
  gap: 6px;
  margin: 0 24px 16px;
  padding: 4px;
  background: var(--tertiary-bg);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  width: fit-content;
}

.tab-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  font-size: 13px;
  font-weight: 500;
  color: var(--secondary-text);
  background: transparent;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;

  .material-symbols-outlined { font-size: 18px; }

  &:hover { color: var(--primary-text); background: rgba(255, 255, 255, 0.04); }

  &.active {
    color: #fff;
    background: var(--button-bg);
    box-shadow: 0 2px 8px rgba(228, 104, 156, 0.25);
  }

  .count {
    padding: 1px 6px;
    font-size: 11px;
    background: rgba(255, 255, 255, 0.25);
    border-radius: 10px;
  }

  &:not(.active) .count {
    background: var(--button-bg);
    color: #fff;
  }
}

/* ============ 工具栏 ============ */
.log-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin: 0 24px 12px;
  padding: 10px 14px;
  background: var(--secondary-bg);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  flex-wrap: wrap;
}

.tb-left, .tb-right { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }

.search-box {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0 10px;
  height: 32px;
  background: var(--input-bg);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  min-width: 240px;
  transition: border-color 0.2s;

  &:focus-within { border-color: var(--button-bg); }

  .material-symbols-outlined { font-size: 18px; color: var(--secondary-text); }

  input {
    flex: 1;
    border: none;
    outline: none;
    background: transparent;
    font-size: 13px;
    color: var(--primary-text);

    &::placeholder { color: var(--secondary-text); opacity: 0.6; }
  }

  .clear-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    padding: 0;
    background: transparent;
    border: none;
    border-radius: 50%;
    cursor: pointer;
    color: var(--secondary-text);

    &:hover { color: var(--primary-text); background: rgba(255, 255, 255, 0.08); }
    .material-symbols-outlined { font-size: 14px; }
  }
}

.level-filter {
  display: inline-flex;
  gap: 2px;
  padding: 2px;
  background: var(--tertiary-bg);
  border: 1px solid var(--border-color);
  border-radius: 8px;
}

.lv-btn {
  padding: 4px 12px;
  font-size: 12px;
  font-weight: 500;
  color: var(--secondary-text);
  background: transparent;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s;

  &:hover { color: var(--primary-text); }
  &.active { color: #fff; background: var(--button-bg); }

  &.error.active { background: #e94e6c; }
  &.warn.active { background: #f1ae28; }
  &.info.active { background: #58c98f; }
}

.auto-refresh {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--primary-text);
  cursor: pointer;

  input[type="checkbox"] {
    appearance: none;
    width: 16px;
    height: 16px;
    background: var(--tertiary-bg);
    border: 1.5px solid var(--border-color);
    border-radius: 4px;
    cursor: pointer;
    position: relative;
    transition: all 0.15s;

    &:checked {
      background: var(--button-bg);
      border-color: var(--button-bg);
    }

    &:checked::after {
      content: '';
      position: absolute;
      left: 4px;
      top: 1px;
      width: 4px;
      height: 8px;
      border: solid #fff;
      border-width: 0 1.5px 1.5px 0;
      transform: rotate(45deg);
    }
  }
}

.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;

  .material-symbols-outlined { font-size: 18px; }

  &.danger:hover { color: #e94e6c; }
}

/* ============ 日志主体 ============ */
.log-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  margin: 0 24px 24px;
  min-height: 0;
}

.log-meta {
  display: flex;
  gap: 16px;
  padding: 8px 14px;
  background: var(--secondary-bg);
  border: 1px solid var(--border-color);
  border-bottom: none;
  border-radius: var(--radius-md) var(--radius-md) 0 0;
  font-size: 12px;
  color: var(--secondary-text);
  flex-wrap: wrap;

  .meta-item {
    display: inline-flex;
    align-items: center;
    gap: 4px;

    .material-symbols-outlined { font-size: 14px; }

    &.hit { color: var(--button-bg); font-weight: 500; }
    &.warn { color: #f1ae28; }
    &.error { color: #e94e6c; }
    .muted { opacity: 0.6; }
  }
}

.log-pre {
  flex: 1;
  min-height: 400px;
  padding: 14px;
  background: #1a1a1e;
  color: #d4d4d4;
  border: 1px solid var(--border-color);
  border-radius: 0 0 var(--radius-md) var(--radius-md);
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-all;
  overflow-y: auto;
  margin: 0;

  &.compact {
    min-height: 200px;
    max-height: 400px;
    border-radius: var(--radius-md);
  }

  :deep(.log-line) {
    display: block;
    padding: 1px 6px;
    border-left: 2px solid transparent;
    margin-left: -6px;

    &.lvl-error {
      color: #ff8aa0;
      background: rgba(233, 78, 108, 0.08);
      border-left-color: #e94e6c;
    }
    &.lvl-warn {
      color: #ffd68a;
      background: rgba(241, 174, 40, 0.06);
      border-left-color: #f1ae28;
    }
    &.lvl-info {
      color: #a0e4b9;
      border-left-color: rgba(88, 201, 143, 0.4);
    }
  }

  :deep(mark) {
    background: #f1ae28;
    color: #000;
    padding: 0 2px;
    border-radius: 2px;
    font-weight: 600;
  }

  :deep(.empty) {
    display: block;
    text-align: center;
    padding: 40px;
    color: #666;
  }
}

/* ============ 归档布局 ============ */
.archive-layout {
  flex-direction: row;
  gap: 14px;
}

.archive-tree {
  flex: 0 0 320px;
  display: flex;
  flex-direction: column;
  background: var(--secondary-bg);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  min-height: 0;
  overflow: hidden;
}

.tree-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 14px;
  border-bottom: 1px solid var(--border-color);

  h4 {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin: 0;
    font-size: 14px;
    color: var(--primary-text);

    .material-symbols-outlined { font-size: 18px; color: var(--button-bg); }
  }
}

.tree-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 40px 20px;
  font-size: 13px;
  color: var(--secondary-text);
  text-align: center;

  .material-symbols-outlined { font-size: 32px; opacity: 0.5; }

  small { font-size: 11px; opacity: 0.7; }
}

.tree-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.day-group { margin-bottom: 8px; }

.day-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  font-size: 12px;
  color: var(--primary-text);
  background: var(--tertiary-bg);
  border-radius: 6px;
  cursor: pointer;
  user-select: none;

  &:hover { background: rgba(228, 104, 156, 0.08); }

  .chev {
    font-size: 16px;
    transition: transform 0.2s;
    &.open { transform: rotate(90deg); }
  }

  strong { flex: 1; font-weight: 600; }

  .day-count {
    padding: 1px 6px;
    font-size: 10px;
    background: var(--button-bg);
    color: #fff;
    border-radius: 10px;
    font-weight: 600;
  }
}

.day-sessions {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px 0 6px 14px;
}

.session-card {
  padding: 8px 10px;
  background: var(--input-bg);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s;

  &:hover { border-color: var(--button-bg); }

  &.active {
    border-color: var(--button-bg);
    background: rgba(228, 104, 156, 0.08);
    box-shadow: 0 0 0 2px rgba(228, 104, 156, 0.15);
  }

  .sc-head {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 4px;
  }

  .sc-idx {
    font-family: 'JetBrains Mono', Consolas, monospace;
    font-size: 11px;
    font-weight: 600;
    color: var(--button-bg);
  }

  .sc-size {
    flex: 1;
    font-size: 11px;
    color: var(--secondary-text);
  }

  .sc-time {
    font-size: 11px;
    color: var(--secondary-text);
    margin-bottom: 2px;
  }

  .sc-first {
    font-size: 11px;
    color: var(--secondary-text);
    opacity: 0.8;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-family: 'JetBrains Mono', Consolas, monospace;
  }
}

.btn-tiny {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  background: transparent;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  color: var(--secondary-text);
  opacity: 0.6;
  transition: all 0.15s;

  &:hover { opacity: 1; }

  &.danger:hover { color: #e94e6c; background: rgba(233, 78, 108, 0.1); }

  .material-symbols-outlined { font-size: 14px; }
}

.archive-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

.content-placeholder {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  background: var(--secondary-bg);
  border: 1px dashed var(--border-color);
  border-radius: var(--radius-md);
  color: var(--secondary-text);

  .material-symbols-outlined { font-size: 48px; opacity: 0.4; }
  p { margin: 0; font-size: 14px; }
}

/* ============ 重启日志布局 ============ */
.restart-layout {
  gap: 14px;
}

.restart-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 14px;
  background: var(--secondary-bg);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  margin-bottom: 14px;

  .head-left { display: flex; flex-direction: column; gap: 2px; }
  .hl-title { font-size: 14px; font-weight: 600; color: var(--primary-text); }
  small { font-size: 11px; color: var(--secondary-text); }
}

.restart-grid {
  flex: 1;
  display: grid;
  grid-template-columns: 1fr;
  gap: 14px;
  min-height: 0;

  @media (min-width: 1200px) { grid-template-columns: 1fr 1fr; }
}

.restart-card {
  display: flex;
  flex-direction: column;
  padding: 14px;
  min-height: 0;
}

.rc-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;

  .rc-title {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    .material-symbols-outlined { font-size: 18px; color: var(--button-bg); }
  }

  .rc-meta {
    font-size: 11px;
    color: var(--secondary-text);
    .muted { opacity: 0.5; }
  }
}

.rc-placeholder {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 30px;
  justify-content: center;
  background: var(--tertiary-bg);
  border-radius: var(--radius-md);
  color: var(--secondary-text);
  font-size: 13px;
}

.rc-truncated {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin: 8px 0 0;
  font-size: 11px;
  color: #f1ae28;
  .material-symbols-outlined { font-size: 14px; }
}

/* ============ 动画 ============ */
.fade-enter-active, .fade-leave-active { transition: all 0.2s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; transform: translateY(-4px); }

.spin { animation: spin 1s linear infinite; }
@keyframes spin { from { transform: rotate(0); } to { transform: rotate(360deg); } }
</style>
