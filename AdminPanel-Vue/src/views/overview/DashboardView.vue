<template>
  <div class="dashboard page">
    <PageHeader title="仪表盘" subtitle="系统运行状态一览" icon="dashboard">
      <template #actions>
        <button class="btn btn-ghost" @click="refresh" :disabled="updating">
          <span class="material-symbols-outlined">refresh</span>
          刷新
        </button>
      </template>
    </PageHeader>

    <div class="dashboard-grid">
      <!-- CPU -->
      <div class="card stat-card">
        <h3>CPU</h3>
        <div class="gauge" :style="`--pct:${cpu.percent}%`">
          <div class="gauge-value">{{ cpu.percent.toFixed(1) }}%</div>
        </div>
        <p class="meta">
          平台: {{ cpu.platform || '—' }} · 架构: {{ cpu.arch || '—' }}
        </p>
      </div>

      <!-- Memory -->
      <div class="card stat-card">
        <h3>内存</h3>
        <div class="gauge memory" :style="`--pct:${mem.percent}%`">
          <div class="gauge-value">{{ mem.percent.toFixed(1) }}%</div>
        </div>
        <p class="meta">
          已用 {{ fmtGB(mem.used) }} / {{ fmtGB(mem.total) }}
        </p>
      </div>

      <!-- Node 进程信息 -->
      <div class="card stat-card">
        <h3>Node 进程</h3>
        <div v-if="node" class="kv-list">
          <div><strong>PID</strong><span>{{ node.pid }}</span></div>
          <div><strong>版本</strong><span>{{ node.version }}</span></div>
          <div><strong>RSS</strong><span>{{ fmtMB(node.rss) }}</span></div>
          <div><strong>运行</strong><span>{{ node.uptimeFmt }}</span></div>
        </div>
        <EmptyState v-else icon="memory" message="数据加载中..." />
      </div>

      <!-- NewAPI 简报 -->
      <div class="card stat-card newapi-card">
        <h3>
          <span class="material-symbols-outlined">monitor_heart</span>
          NewAPI 简报
        </h3>
        <div v-if="newapi" class="newapi-grid">
          <div><span class="l">请求</span><strong>{{ fmtCompact(newapi.total_requests) }}</strong></div>
          <div><span class="l">Tokens</span><strong>{{ fmtCompact(newapi.total_tokens) }}</strong></div>
          <div><span class="l">Quota</span><strong>{{ fmtCompact(newapi.total_quota) }}</strong></div>
          <div><span class="l">RPM/TPM</span><strong>{{ fmtCompact(newapi.current_rpm) }}/{{ fmtCompact(newapi.current_tpm) }}</strong></div>
        </div>
        <p v-else class="newapi-hint">未配置或不可达（在全局配置中填写 NEWAPI_MONITOR_* 参数）</p>
      </div>

      <!-- PM2 进程 -->
      <div class="card stat-card pm2-card">
        <h3>PM2 进程</h3>
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
      </div>

      <!-- 插件 dashboardCards 动态注入 -->
      <div
        v-for="card in pluginCards"
        :key="card.id"
        class="card plugin-dashboard-card"
        :class="{ wide: card.width === '2x' }"
        :data-plugin-name="card.pluginName"
      >
        <h3>
          <span v-if="card.icon" class="material-symbols-outlined">{{ card.icon }}</span>
          {{ card.title || card.id }}
        </h3>
        <div class="plugin-card-body" v-html="card.html" />
        <div class="plugin-card-badge">{{ card.displayName }}</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, reactive } from 'vue'
import PageHeader from '@/components/common/PageHeader.vue'
import EmptyState from '@/components/common/EmptyState.vue'
import { getSystemResources, getPM2Processes } from '@/api/system'
import { getNewApiSummary, type NewApiSummary } from '@/api/newapi'
import { listPlugins, getPluginUiPrefs } from '@/api/plugins'
import type { PluginInfo, DashboardCardDef } from '@/api/types'

interface PluginCardRendered extends DashboardCardDef {
  id: string
  pluginName: string
  displayName: string
  html: string
  width?: string
}

const cpu = reactive({ percent: 0, platform: '', arch: '' })
const mem = reactive({ percent: 0, used: 0, total: 0 })
const node = ref<{ pid: number; version: string; rss: number; uptimeFmt: string } | null>(null)
const pm2 = ref<Array<{ name: string; pid: number | null; status: string; cpu?: number; memory?: number }>>([])
const newapi = ref<NewApiSummary | null>(null)
const pluginCards = ref<PluginCardRendered[]>([])
const updating = ref(false)

let timer: number | null = null

async function refresh() {
  updating.value = true
  try {
    // 兼容两种后端形态：system.cpu/system.memory 结构（原 AdminPanel 用）或直接扁平（api/types 推断）
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
        }
      }
    }

    pm2.value = pm2Data.processes
    newapi.value = summary.success ? summary.data as NewApiSummary : null
  } finally {
    updating.value = false
  }
}

async function loadPluginCards() {
  try {
    // 仪表盘的插件卡片加载是"增强"特性：主服务未起时静默失败，不干扰主体
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
        if (!def.src && !def.inline) continue
        tasks.push(renderCard(p, def))
      }
    }
    const results = await Promise.allSettled(tasks)
    pluginCards.value = results
      .filter((r): r is PromiseFulfilledResult<PluginCardRendered | null> => r.status === 'fulfilled' && r.value !== null)
      .map((r) => r.value as PluginCardRendered)
  } catch (e) {
    console.warn('[Dashboard] load plugin cards failed:', e)
  }
}

async function renderCard(p: PluginInfo, def: DashboardCardDef): Promise<PluginCardRendered | null> {
  try {
    let html = ''
    if (typeof def.inline === 'string') {
      html = def.inline
    } else if (def.src) {
      const resp = await fetch(
        `/admin_api/plugins/${encodeURIComponent(p.manifest.name)}/admin-assets/${encodeURIComponent(def.src)}`,
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

function fmtGB(bytes: number) {
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function fmtMB(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function fmtCompact(n: number | string | undefined): string {
  const v = Number(n ?? 0)
  if (v >= 1e9) return (v / 1e9).toFixed(1) + 'B'
  if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M'
  if (v >= 1e3) return (v / 1e3).toFixed(1) + 'K'
  return String(v)
}

onMounted(async () => {
  await refresh()
  loadPluginCards()
  timer = window.setInterval(refresh, 5000)
})

onBeforeUnmount(() => {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
})
</script>

<style lang="scss" scoped>
.dashboard-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 16px;
  padding: 0 24px 24px;
}

.stat-card {
  h3 {
    margin: 0 0 12px;
    font-size: 14px;
    color: var(--secondary-text);
    display: flex;
    align-items: center;
    gap: 6px;
    font-weight: 500;
    letter-spacing: 0.5px;
  }

  .meta {
    margin: 12px 0 0;
    font-size: 12px;
    color: var(--secondary-text);
  }
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

.newapi-card {
  h3 .material-symbols-outlined { font-size: 18px; color: var(--highlight-text); }
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

.pm2-card {
  grid-column: span 2;
  @media (max-width: 700px) { grid-column: span 1; }
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

.plugin-dashboard-card {
  position: relative;

  &.wide { grid-column: span 2; }

  h3 {
    margin: 0 0 10px;
    font-size: 14px;
    display: flex;
    align-items: center;
    gap: 6px;

    .material-symbols-outlined { font-size: 18px; color: var(--highlight-text); }
  }

  .plugin-card-body :deep(*) { max-width: 100%; }

  .plugin-card-badge {
    position: absolute;
    bottom: 6px;
    right: 10px;
    font-size: 10px;
    color: var(--secondary-text);
    opacity: 0.65;
  }
}
</style>
