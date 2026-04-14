<template>
  <div class="dashboard page">
    <PageHeader title="仪表盘" subtitle="系统运行状态一览 · 拖动重排 · 调整大小 · 隐藏/显示" icon="dashboard">
      <template #actions>
        <button
          class="btn btn-ghost"
          :title="editMode ? '退出自定义模式' : '进入自定义模式（显示拖动/调整按钮）'"
          :class="{ 'btn-pink-active': editMode }"
          @click="editMode = !editMode"
        >
          <span class="material-symbols-outlined">{{ editMode ? 'lock_open' : 'tune' }}</span>
          {{ editMode ? '完成' : '自定义' }}
        </button>
        <button
          v-if="layouts.length > 0"
          class="btn btn-ghost"
          title="重置为默认布局"
          @click="resetLayout"
        >
          <span class="material-symbols-outlined">restart_alt</span>
          重置
        </button>
        <button class="btn btn-ghost" @click="refresh" :disabled="updating">
          <span class="material-symbols-outlined">refresh</span>
          刷新
        </button>
      </template>
    </PageHeader>

    <!-- 隐藏卡片抽屉 -->
    <div v-if="hiddenCards.length > 0" class="hidden-shelf">
      <span class="hs-label">
        <span class="material-symbols-outlined">visibility_off</span>
        已隐藏 {{ hiddenCards.length }} 个卡片：
      </span>
      <button
        v-for="h in hiddenCards"
        :key="h.id"
        class="hs-chip"
        @click="showCard(h.id)"
      >
        <span class="material-symbols-outlined">{{ h.icon || 'dashboard' }}</span>
        {{ h.title }}
        <span class="hs-restore material-symbols-outlined">add</span>
      </button>
    </div>

    <div class="dashboard-grid" :class="{ 'edit-mode': editMode }">
      <div
        v-for="card in renderedCards"
        :key="card.id"
        class="dash-card card"
        :class="[`size-${card.size}`, { dragging: draggingId === card.id, dragover: dragOverId === card.id }]"
        :data-card-id="card.id"
        :draggable="editMode"
        @dragstart="onDragStart($event, card.id)"
        @dragover.prevent="onDragOver($event, card.id)"
        @dragleave="onDragLeave(card.id)"
        @drop="onDrop($event, card.id)"
        @dragend="onDragEnd"
        :ref="(el) => card.kind === 'plugin' ? registerCardRef(card.pluginCard!.id, el as HTMLElement | null) : null"
      >
        <!-- 统一头部（标题 + action bar） -->
        <header class="dc-head">
          <div class="dc-title">
            <span v-if="card.icon" class="material-symbols-outlined">{{ card.icon }}</span>
            <h3>{{ card.title }}</h3>
            <span v-if="card.kind === 'plugin'" class="plugin-tag">{{ card.pluginCard?.displayName }}</span>
          </div>
          <div v-if="editMode" class="dc-actions">
            <button
              class="dc-btn"
              title="缩小"
              :disabled="!canDecreaseSize(card.size)"
              @click="changeSize(card.id, -1)"
            >
              <span class="material-symbols-outlined">chevron_left</span>
            </button>
            <span class="size-label" :title="`当前大小：${sizeLabel(card.size)}`">{{ card.size.toUpperCase() }}</span>
            <button
              class="dc-btn"
              title="放大"
              :disabled="!canIncreaseSize(card.size)"
              @click="changeSize(card.id, 1)"
            >
              <span class="material-symbols-outlined">chevron_right</span>
            </button>
            <button class="dc-btn" title="隐藏此卡片" @click="hideCard(card.id)">
              <span class="material-symbols-outlined">visibility_off</span>
            </button>
            <span class="drag-handle" title="拖动重排" @mousedown.stop>
              <span class="material-symbols-outlined">drag_indicator</span>
            </span>
          </div>
        </header>

        <!-- 卡片内容（根据 id 分发） -->
        <div class="dc-body">
          <!-- CPU -->
          <template v-if="card.id === 'cpu'">
            <div class="gauge" :style="`--pct:${cpu.percent}%`">
              <div class="gauge-value">{{ cpu.percent.toFixed(1) }}%</div>
            </div>
            <p class="meta">
              平台: {{ cpu.platform || '—' }} · 架构: {{ cpu.arch || '—' }}
            </p>
          </template>

          <!-- Memory -->
          <template v-else-if="card.id === 'mem'">
            <div class="gauge memory" :style="`--pct:${mem.percent}%`">
              <div class="gauge-value">{{ mem.percent.toFixed(1) }}%</div>
            </div>
            <p class="meta">
              已用 {{ fmtGB(mem.used) }} / {{ fmtGB(mem.total) }}
            </p>
          </template>

          <!-- Node 进程 -->
          <template v-else-if="card.id === 'node'">
            <div v-if="node" class="kv-list">
              <div><strong>PID</strong><span>{{ node.pid }}</span></div>
              <div><strong>版本</strong><span>{{ node.version }}</span></div>
              <div><strong>RSS</strong><span>{{ fmtMB(node.rss) }}</span></div>
              <div><strong>运行</strong><span>{{ node.uptimeFmt }}</span></div>
            </div>
            <EmptyState v-else icon="memory" message="数据加载中..." />
          </template>

          <!-- NewAPI 简报 -->
          <template v-else-if="card.id === 'newapi'">
            <div v-if="newapi" class="newapi-grid">
              <div><span class="l">请求</span><strong>{{ fmtCompact(newapi.total_requests) }}</strong></div>
              <div><span class="l">Tokens</span><strong>{{ fmtCompact(newapi.total_tokens) }}</strong></div>
              <div><span class="l">Quota</span><strong>{{ fmtCompact(newapi.total_quota) }}</strong></div>
              <div><span class="l">RPM/TPM</span><strong>{{ fmtCompact(newapi.current_rpm) }}/{{ fmtCompact(newapi.current_tpm) }}</strong></div>
            </div>
            <p v-else class="newapi-hint">未配置或不可达（在全局配置填写 NEWAPI_MONITOR_* 参数）</p>
          </template>

          <!-- PM2 进程 -->
          <template v-else-if="card.id === 'pm2'">
            <div v-if="pm2.length" class="pm2-list">
              <div v-for="p in pm2" :key="p.pid ?? p.name" class="pm2-item">
                <div>
                  <strong>{{ p.name }}</strong>
                  <span class="pid">PID {{ p.pid ?? '—' }}</span>
                </div>
                <div class="pm2-stats">
                  <span :class="['status', (p.status || '').toLowerCase()]">{{ p.status }}</span>
                  <span>CPU {{ (p.cpu ?? 0).toFixed(1) }}%</span>
                  <span>RAM {{ fmtMB((p.memory ?? 0)) }}</span>
                </div>
              </div>
            </div>
            <EmptyState v-else icon="inventory" message="没有 PM2 进程" />
          </template>

          <!-- 插件卡片：由 injectCardContent 动态塞 HTML -->
          <template v-else-if="card.kind === 'plugin'">
            <div class="plugin-card-body"></div>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, reactive, watch, nextTick } from 'vue'
import PageHeader from '@/components/common/PageHeader.vue'
import EmptyState from '@/components/common/EmptyState.vue'
import { getSystemResources, getPM2Processes } from '@/api/system'
import { getNewApiSummary, type NewApiSummary } from '@/api/newapi'
import { listPlugins, getPluginUiPrefs } from '@/api/plugins'
import { getDashboardLayout, saveDashboardLayout, type CardLayout, type CardSize } from '@/api/dashboardLayout'
import type { PluginInfo, DashboardCardDef } from '@/api/types'

interface PluginCardRendered extends DashboardCardDef {
  id: string
  pluginName: string
  displayName: string
  html: string
  width?: string
}

interface CardMeta {
  id: string
  kind: 'builtin' | 'plugin'
  title: string
  icon?: string
  pluginCard?: PluginCardRendered
}

interface RenderedCard extends CardMeta {
  order: number
  size: CardSize
}

// ============ 基础数据状态 ============
const cpu = reactive({ percent: 0, platform: '', arch: '' })
const mem = reactive({ percent: 0, used: 0, total: 0 })
const node = ref<{ pid: number; version: string; rss: number; uptimeFmt: string; uptimeSec: number } | null>(null)
const pm2 = ref<Array<{ name: string; pid: number | null; status: string; cpu?: number; memory?: number }>>([])
const newapi = ref<NewApiSummary | null>(null)
const pluginCards = ref<PluginCardRendered[]>([])
const updating = ref(false)

// ============ 布局状态 ============
const layouts = ref<CardLayout[]>([])
const editMode = ref(false)
const draggingId = ref<string | null>(null)
const dragOverId = ref<string | null>(null)

let timer: number | null = null
let saveDebounceTimer: number | null = null

// ============ 卡片元数据（内置 + 插件统一） ============
const BUILTIN_CARDS: CardMeta[] = [
  { id: 'cpu',    kind: 'builtin', title: 'CPU',         icon: 'memory' },
  { id: 'mem',    kind: 'builtin', title: '内存',         icon: 'database' },
  { id: 'node',   kind: 'builtin', title: 'Node 进程',    icon: 'terminal' },
  { id: 'newapi', kind: 'builtin', title: 'NewAPI 简报',  icon: 'monitor_heart' },
  { id: 'pm2',    kind: 'builtin', title: 'PM2 进程',     icon: 'inventory' },
]

const allCards = computed<CardMeta[]>(() => {
  const plugins: CardMeta[] = pluginCards.value.map(pc => ({
    id: `plugin:${pc.id}`,
    kind: 'plugin',
    title: pc.title || pc.id,
    icon: pc.icon,
    pluginCard: pc,
  }))
  return [...BUILTIN_CARDS, ...plugins]
})

// 默认大小（按卡片特性）
function defaultSize(id: string): CardSize {
  if (id === 'pm2' || id === 'newapi') return 'lg'
  return 'md'
}

// 合并 allCards + layouts → 实际渲染列表
const renderedCards = computed<RenderedCard[]>(() => {
  const layoutMap = new Map(layouts.value.map(l => [l.id, l]))
  const maxOrderInLayout = layouts.value.length > 0
    ? Math.max(...layouts.value.map(l => l.order))
    : 0
  let fallbackOrder = maxOrderInLayout

  return allCards.value
    .map((meta) => {
      const l = layoutMap.get(meta.id)
      return {
        ...meta,
        order: l?.order ?? (++fallbackOrder),
        size: (l?.size ?? defaultSize(meta.id)) as CardSize,
        visible: l?.visible !== false,
      }
    })
    .filter(c => c.visible)
    .sort((a, b) => a.order - b.order)
})

const hiddenCards = computed<CardMeta[]>(() => {
  const layoutMap = new Map(layouts.value.map(l => [l.id, l]))
  return allCards.value.filter(c => layoutMap.get(c.id)?.visible === false)
})

// ============ Layout 操作 ============
const SIZES: CardSize[] = ['sm', 'md', 'lg', 'xl']

function sizeLabel(s: CardSize): string {
  return { sm: '小', md: '中', lg: '大', xl: '全宽' }[s]
}

function canIncreaseSize(s: CardSize): boolean {
  return SIZES.indexOf(s) < SIZES.length - 1
}

function canDecreaseSize(s: CardSize): boolean {
  return SIZES.indexOf(s) > 0
}

function upsertLayout(id: string, patch: Partial<CardLayout>) {
  const existing = layouts.value.find(l => l.id === id)
  if (existing) {
    Object.assign(existing, patch)
  } else {
    layouts.value.push({
      id,
      order: layouts.value.length + 1,
      size: defaultSize(id),
      visible: true,
      ...patch,
    })
  }
  layouts.value = [...layouts.value]
  scheduleSave()
}

function changeSize(id: string, delta: number) {
  const current = renderedCards.value.find(c => c.id === id)?.size || defaultSize(id)
  const idx = SIZES.indexOf(current)
  const next = Math.max(0, Math.min(SIZES.length - 1, idx + delta))
  upsertLayout(id, { size: SIZES[next] })
}

function hideCard(id: string) { upsertLayout(id, { visible: false }) }
function showCard(id: string) { upsertLayout(id, { visible: true }) }

function resetLayout() {
  if (!confirm('确认重置为默认布局嘛？所有自定义顺序/大小/隐藏都会清空。')) return
  layouts.value = []
  scheduleSave()
}

// ============ 拖动排序（HTML5 DnD） ============
function onDragStart(e: DragEvent, id: string) {
  if (!editMode.value) return
  draggingId.value = id
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', id)
  }
}

function onDragOver(e: DragEvent, id: string) {
  if (!draggingId.value || draggingId.value === id) return
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
  dragOverId.value = id
}

function onDragLeave(id: string) {
  if (dragOverId.value === id) dragOverId.value = null
}

function onDrop(_e: DragEvent, targetId: string) {
  if (!draggingId.value || draggingId.value === targetId) {
    dragOverId.value = null
    return
  }
  const ids = renderedCards.value.map(c => c.id)
  const fromIdx = ids.indexOf(draggingId.value)
  const toIdx = ids.indexOf(targetId)
  if (fromIdx < 0 || toIdx < 0) { dragOverId.value = null; return }

  const [moved] = ids.splice(fromIdx, 1)
  ids.splice(toIdx, 0, moved)

  // 重建 layouts：可见卡片按新顺序；隐藏卡片保留
  const visibleLayouts: CardLayout[] = ids.map((id, i) => {
    const existing = layouts.value.find(l => l.id === id)
    return {
      id,
      order: i + 1,
      size: existing?.size ?? defaultSize(id),
      visible: true,
    }
  })
  const hiddenLayouts: CardLayout[] = hiddenCards.value.map((c, i) => {
    const existing = layouts.value.find(l => l.id === c.id)
    return {
      id: c.id,
      order: 10000 + i,
      size: existing?.size ?? defaultSize(c.id),
      visible: false,
    }
  })
  layouts.value = [...visibleLayouts, ...hiddenLayouts]

  dragOverId.value = null
  draggingId.value = null
  scheduleSave()
}

function onDragEnd() {
  draggingId.value = null
  dragOverId.value = null
}

// ============ 持久化 ============
function scheduleSave() {
  if (saveDebounceTimer) clearTimeout(saveDebounceTimer)
  saveDebounceTimer = window.setTimeout(async () => {
    try {
      await saveDashboardLayout(layouts.value)
    } catch (e) {
      console.warn('[Dashboard] 布局保存失败:', e)
    }
  }, 400)
}

async function loadLayouts() {
  try {
    const r = await getDashboardLayout()
    layouts.value = r.layouts || []
  } catch (e) {
    console.warn('[Dashboard] 布局加载失败（可能后端未注册新路由，请重启服务）:', e)
  }
}

// ============ 数据刷新 ============
async function refresh() {
  updating.value = true
  try {
    const [rawRes, pm2Data, summary] = await Promise.all([
      getSystemResources().catch(() => null),
      getPM2Processes().catch(() => ({ processes: [] as Array<{ name: string; pid: number | null; status: string; cpu?: number; memory?: number }> })),
      getNewApiSummary().catch(() => ({ success: false } as { success: false })),
    ])
    const resources = rawRes as unknown as {
      system?: {
        cpu?: { usage: number }
        memory?: { used: number; total: number }
        nodeProcess?: { platform: string; arch: string; pid: number; version: string; memory: { rss: number }; uptime: number }
      }
    } | null

    if (resources?.system) {
      const s = resources.system
      if (s.cpu) cpu.percent = s.cpu.usage
      if (s.nodeProcess) { cpu.platform = s.nodeProcess.platform; cpu.arch = s.nodeProcess.arch }
      if (s.memory && s.memory.total > 0) {
        mem.used = s.memory.used
        mem.total = s.memory.total
        mem.percent = (s.memory.used / s.memory.total) * 100
      }
      if (s.nodeProcess) {
        const up = s.nodeProcess.uptime
        const h = Math.floor(up / 3600), m = Math.floor((up % 3600) / 60)
        node.value = {
          pid: s.nodeProcess.pid,
          version: s.nodeProcess.version,
          rss: s.nodeProcess.memory.rss,
          uptimeFmt: `${h}h ${m}m`,
          uptimeSec: up,
        }
      }
    }

    pm2.value = pm2Data.processes
    newapi.value = summary.success ? summary.data as NewApiSummary : null
  } finally {
    updating.value = false
  }
}

// ============ 插件卡片加载 + 注入 ============
async function loadPluginCards() {
  try {
    const [plugins, prefs] = await Promise.all([
      listPlugins({ showLoader: false, suppressErrorToast: true }).catch(() => [] as PluginInfo[]),
      getPluginUiPrefs({ showLoader: false, suppressErrorToast: true }).catch(() => ({} as Record<string, { dashboardCards?: boolean }>)),
    ])
    const list = (plugins as PluginInfo[]) ?? []
    const tasks: Array<Promise<PluginCardRendered | null>> = []
    for (const p of list) {
      if (!p.enabled) continue
      const cards = p.manifest?.dashboardCards
      if (!Array.isArray(cards)) continue
      const pluginPref = (prefs as Record<string, { dashboardCards?: boolean }>)[p.manifest.name]
      if (pluginPref?.dashboardCards === false) continue
      for (const def of cards) {
        if (!def.source && !def.inline) continue
        tasks.push(renderCard(p, def))
      }
    }
    const results = await Promise.allSettled(tasks)
    pluginCards.value = results
      .filter((r): r is PromiseFulfilledResult<PluginCardRendered | null> => r.status === 'fulfilled' && r.value !== null)
      .map((r) => r.value as PluginCardRendered)
    await nextTick()
    for (const card of pluginCards.value) {
      injectCardContent(card)
    }
  } catch (e) {
    console.warn('[Dashboard] load plugin cards failed:', e)
  }
}

const cardRefs = new Map<string, HTMLElement>()
function registerCardRef(id: string, el: HTMLElement | null) {
  if (el) cardRefs.set(id, el)
  else cardRefs.delete(id)
}

function injectCardContent(card: PluginCardRendered) {
  const root = cardRefs.get(card.id)
  if (!root) return
  const body = root.querySelector<HTMLElement>('.plugin-card-body')
  if (!body) return
  // 已注入过则跳过（拖动排序会保留 DOM，避免重新执行 script）
  if (body.dataset.injected === '1') return
  body.innerHTML = card.html
  body.dataset.injected = '1'
  body.querySelectorAll('script').forEach((oldScript) => {
    const s = document.createElement('script')
    for (const attr of Array.from(oldScript.attributes)) {
      s.setAttribute(attr.name, attr.value)
    }
    if (oldScript.src) s.src = oldScript.src
    else s.textContent = oldScript.textContent
    oldScript.replaceWith(s)
  })
}

async function renderCard(p: PluginInfo, def: DashboardCardDef): Promise<PluginCardRendered | null> {
  try {
    let html = ''
    if (typeof def.inline === 'string') {
      html = def.inline
    } else if (def.source) {
      const resp = await fetch(
        `/admin_api/plugins/${encodeURIComponent(p.manifest.name)}/admin-assets/${encodeURIComponent(def.source)}`,
        { credentials: 'same-origin' },
      )
      if (!resp.ok) return null
      html = await resp.text()
    }
    return {
      ...def,
      id: def.id || `${p.manifest.name}-${def.title || 'card'}`,
      pluginName: p.manifest.name,
      displayName: p.manifest.displayName || p.manifest.name,
      html,
    }
  } catch {
    return null
  }
}

// renderedCards 变化时重新尝试注入插件卡片（比如恢复隐藏后重新创建 DOM）
watch(renderedCards, async () => {
  await nextTick()
  for (const card of pluginCards.value) injectCardContent(card)
}, { flush: 'post' })

// ============ 格式化 ============
function fmtGB(bytes: number) { return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB` }
function fmtMB(bytes: number) { return `${(bytes / 1024 / 1024).toFixed(1)} MB` }
function fmtCompact(n: number | string | undefined): string {
  const v = Number(n ?? 0)
  if (v >= 1e9) return (v / 1e9).toFixed(1) + 'B'
  if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M'
  if (v >= 1e3) return (v / 1e3).toFixed(1) + 'K'
  return String(v)
}

// ============ 生命周期 ============
onMounted(async () => {
  await refresh()
  await loadPluginCards()
  await loadLayouts()
  timer = window.setInterval(refresh, 5000)
})

onBeforeUnmount(() => {
  if (timer) { clearInterval(timer); timer = null }
  if (saveDebounceTimer) { clearTimeout(saveDebounceTimer); saveDebounceTimer = null }
})
</script>

<style lang="scss" scoped>
/* ============ 隐藏卡片抽屉 ============ */
.hidden-shelf {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin: 0 24px 12px;
  padding: 10px 14px;
  background: var(--tertiary-bg);
  border: 1px dashed var(--border-color);
  border-radius: var(--radius-md);
  font-size: 12px;
  color: var(--secondary-text);

  .hs-label {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-weight: 500;

    .material-symbols-outlined { font-size: 16px; }
  }
}

.hs-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  background: var(--input-bg);
  border: 1px solid var(--border-color);
  border-radius: 16px;
  font-size: 11px;
  color: var(--primary-text);
  cursor: pointer;
  transition: all 0.15s;

  &:hover {
    border-color: var(--button-bg);
    color: var(--button-bg);
    .hs-restore { color: var(--button-bg); }
  }

  .material-symbols-outlined { font-size: 14px; }

  .hs-restore {
    color: var(--secondary-text);
    opacity: 0.7;
    margin-left: 2px;
  }
}

/* ============ 网格 ============ */
.dashboard-grid {
  display: grid;
  grid-template-columns: repeat(12, 1fr);
  gap: 16px;
  padding: 0 24px 24px;

  &.edit-mode {
    outline: 2px dashed rgba(228, 104, 156, 0.3);
    outline-offset: 4px;
    border-radius: var(--radius-md);
    padding: 8px 16px 16px;
    margin: 0 16px 16px;
  }
}

/* Size 档位（12 列 grid）：sm=3/12，md=4/12，lg=6/12，xl=12/12 */
.dash-card.size-sm { grid-column: span 3; }
.dash-card.size-md { grid-column: span 4; }
.dash-card.size-lg { grid-column: span 6; }
.dash-card.size-xl { grid-column: span 12; }

/* 中屏降级：12 列 → 6 列，sm 变 3，md/lg 变 6，xl 变 6 */
@media (max-width: 1200px) {
  .dashboard-grid { grid-template-columns: repeat(6, 1fr); }
  .dash-card.size-sm { grid-column: span 3; }
  .dash-card.size-md { grid-column: span 6; }
  .dash-card.size-lg { grid-column: span 6; }
  .dash-card.size-xl { grid-column: span 6; }
}

/* 小屏：全部铺满 */
@media (max-width: 700px) {
  .dashboard-grid { grid-template-columns: 1fr; }
  .dash-card.size-sm,
  .dash-card.size-md,
  .dash-card.size-lg,
  .dash-card.size-xl { grid-column: span 1; }
}

/* ============ 卡片 ============ */
.dash-card {
  position: relative;
  transition: transform 0.15s, box-shadow 0.15s, opacity 0.15s;

  &[draggable="true"] { cursor: grab; }
  &.dragging {
    opacity: 0.4;
    transform: scale(0.98);
  }
  &.dragover {
    box-shadow: 0 0 0 3px var(--button-bg);
  }
}

.dc-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin: 0 0 12px;
  min-height: 24px;
}

.dc-title {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;

  .material-symbols-outlined {
    font-size: 18px;
    color: var(--highlight-text);
    flex-shrink: 0;
  }

  h3 {
    margin: 0;
    font-size: 14px;
    color: var(--secondary-text);
    font-weight: 500;
    letter-spacing: 0.5px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .plugin-tag {
    flex-shrink: 0;
    padding: 1px 6px;
    font-size: 9px;
    font-weight: 600;
    color: #fff;
    background: linear-gradient(135deg, #e4689c, #9b6dd0);
    border-radius: 8px;
    opacity: 0.8;
  }
}

/* ============ 卡片 action bar ============ */
.dc-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

.dc-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  background: transparent;
  border: none;
  border-radius: 4px;
  color: var(--secondary-text);
  cursor: pointer;
  transition: all 0.15s;

  &:hover:not(:disabled) {
    background: rgba(228, 104, 156, 0.1);
    color: var(--button-bg);
  }
  &:disabled { opacity: 0.3; cursor: not-allowed; }

  .material-symbols-outlined { font-size: 16px; }
}

.size-label {
  padding: 1px 5px;
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 9px;
  font-weight: 700;
  color: var(--button-bg);
  background: rgba(228, 104, 156, 0.1);
  border-radius: 4px;
  min-width: 22px;
  text-align: center;
}

.drag-handle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  color: var(--secondary-text);
  cursor: grab;

  &:active { cursor: grabbing; }

  .material-symbols-outlined { font-size: 16px; }
}

/* ============ 卡片内容（原有样式保留） ============ */
.dc-body { min-height: 0; }

.meta {
  margin: 12px 0 0;
  font-size: 12px;
  color: var(--secondary-text);
}

.gauge {
  width: 140px;
  height: 140px;
  margin: 0 auto;
  border-radius: 50%;
  background: conic-gradient(var(--cpu-color) calc(var(--pct)), var(--accent-bg) 0);
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;

  &::before {
    content: '';
    position: absolute;
    inset: 10px;
    border-radius: 50%;
    background: var(--tertiary-bg);
  }

  &.memory {
    background: conic-gradient(var(--memory-color) calc(var(--pct)), var(--accent-bg) 0);
  }

  .gauge-value {
    position: relative;
    font-size: 22px;
    font-weight: 600;
    color: var(--primary-text);
  }
}

.kv-list > div {
  display: flex;
  justify-content: space-between;
  padding: 6px 0;
  font-size: 13px;
  border-bottom: 1px dashed var(--border-color);

  &:last-child { border-bottom: none; }

  strong { color: var(--secondary-text); font-weight: 500; }
  span { color: var(--primary-text); }
}

.newapi-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;

  > div {
    background: var(--accent-bg);
    padding: 8px 12px;
    border-radius: var(--radius-sm);
    display: flex;
    flex-direction: column;
    gap: 2px;

    .l { font-size: 11px; color: var(--secondary-text); }
    strong { font-size: 16px; color: var(--primary-text); }
  }
}

.newapi-hint {
  margin: 0;
  font-size: 12px;
  color: var(--secondary-text);
}

.pm2-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.pm2-item {
  padding: 10px 12px;
  background: var(--tertiary-bg);
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-color);
  display: flex;
  justify-content: space-between;
  align-items: center;

  .pid {
    font-size: 11px;
    color: var(--secondary-text);
    margin-left: 8px;
  }

  .pm2-stats {
    display: flex;
    gap: 12px;
    font-size: 12px;
    color: var(--secondary-text);
  }

  .status {
    padding: 2px 8px;
    border-radius: var(--radius-pill);
    font-size: 11px;

    &.online { background: rgba(109, 187, 138, 0.15); color: #4a8d63; }
    &.stopped { background: rgba(217, 85, 85, 0.15); color: var(--danger-color); }
    &.errored { background: rgba(217, 85, 85, 0.15); color: var(--danger-color); }
  }
}

.plugin-card-body {
  :deep(*) { max-width: 100%; }
}

/* 自定义模式时的按钮高亮 */
.btn-pink-active {
  color: #fff !important;
  background: var(--button-bg) !important;
  border-color: var(--button-bg) !important;
}
</style>
