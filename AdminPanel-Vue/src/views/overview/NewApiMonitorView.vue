<template>
  <div class="page newapi">
    <PageHeader title="NewAPI 监控" subtitle="请求 / Token / Quota 用量统计与趋势" icon="monitor_heart">
      <template #actions>
        <select v-model.number="hours" @change="reload" class="range-select">
          <option :value="1">最近 1 小时</option>
          <option :value="6">最近 6 小时</option>
          <option :value="24">最近 24 小时</option>
          <option :value="24 * 7">最近 7 天</option>
          <option :value="24 * 30">最近 30 天</option>
        </select>
        <input v-model="modelFilter" @change="reload" placeholder="模型过滤..." class="search input" />
        <label class="auto-refresh" title="每 30 秒自动刷新">
          <input type="checkbox" v-model="autoRefresh" @change="onAutoRefreshChange" />
          <span class="material-symbols-outlined">{{ autoRefresh ? 'sync' : 'sync_disabled' }}</span>
          <span class="lbl">自动</span>
        </label>
        <button class="btn btn-ghost" @click="reload" :disabled="loading">
          <span class="material-symbols-outlined" :class="{ spinning: loading }">refresh</span>
        </button>
      </template>
    </PageHeader>

    <!-- 配置错误提示 -->
    <div v-if="configError" class="config-warn card">
      <span class="material-symbols-outlined">warning</span>
      <div>
        <strong>NewAPI 监控未配置</strong>
        <p>请在「全局配置」中设置：<code>NEWAPI_MONITOR_BASE_URL</code> / <code>NEWAPI_MONITOR_ACCESS_TOKEN</code> / <code>NEWAPI_MONITOR_API_USER_ID</code></p>
      </div>
    </div>

    <!-- KPI 4 卡 -->
    <div class="kpi-grid">
      <div class="kpi-card kpi-req card">
        <div class="kpi-icon"><span class="material-symbols-outlined">network_check</span></div>
        <div class="kpi-body">
          <span class="kpi-label">总请求数</span>
          <strong class="kpi-value">{{ fmtCompact(summary?.total_requests || 0) }}</strong>
          <span class="kpi-desc">{{ rangeLabel }}</span>
        </div>
      </div>
      <div class="kpi-card kpi-tok card">
        <div class="kpi-icon"><span class="material-symbols-outlined">token</span></div>
        <div class="kpi-body">
          <span class="kpi-label">Token 总量</span>
          <strong class="kpi-value">{{ fmtCompact(summary?.total_tokens || 0) }}</strong>
          <span class="kpi-desc">≈ {{ avgTokensPerReq }} / 请求</span>
        </div>
      </div>
      <div class="kpi-card kpi-quota card">
        <div class="kpi-icon"><span class="material-symbols-outlined">savings</span></div>
        <div class="kpi-body">
          <span class="kpi-label">Quota 消耗</span>
          <strong class="kpi-value">{{ fmtCompact(summary?.total_quota || 0) }}</strong>
          <span class="kpi-desc">$ ≈ {{ quotaUsd }}</span>
        </div>
      </div>
      <div class="kpi-card kpi-rate card">
        <div class="kpi-icon"><span class="material-symbols-outlined">speed</span></div>
        <div class="kpi-body">
          <span class="kpi-label">RPM / TPM</span>
          <strong class="kpi-value">
            {{ fmtCompact(summary?.current_rpm || 0) }}
            <span class="kpi-divider">/</span>
            {{ fmtCompact(summary?.current_tpm || 0) }}
          </strong>
          <span class="kpi-desc">实时频率</span>
        </div>
      </div>
    </div>

    <!-- 趋势图 + 环形图 -->
    <div class="charts-grid">
      <!-- 趋势图 -->
      <div class="card chart-card trend-card">
        <header>
          <div class="title">
            <span class="material-symbols-outlined">show_chart</span>
            <strong>时间趋势</strong>
          </div>
          <div class="metric-tabs">
            <button
              v-for="m in metrics"
              :key="m.key"
              class="metric-tab"
              :class="{ active: activeMetric === m.key }"
              :style="{ '--accent': m.color }"
              @click="activeMetric = m.key"
            >
              <span class="dot" :style="{ background: m.color }"></span>
              {{ m.label }}
            </button>
          </div>
        </header>

        <EmptyState v-if="!trend.length && !loading" icon="insights" message="暂无趋势数据" />

        <div v-else class="chart-area" @mousemove="onChartMove" @mouseleave="hoverIdx = null">
          <svg class="trend-chart" :viewBox="`0 0 ${chartW} ${chartH}`" preserveAspectRatio="none" ref="chartRef">
            <defs>
              <linearGradient :id="`fill-${activeMetric}`" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" :stop-color="activeMetricColor" stop-opacity="0.3" />
                <stop offset="100%" :stop-color="activeMetricColor" stop-opacity="0" />
              </linearGradient>
            </defs>
            <!-- 网格 y 轴 -->
            <g class="grid">
              <line v-for="i in 4" :key="`g${i}`"
                :x1="0" :x2="chartW"
                :y1="(i * chartH) / 4" :y2="(i * chartH) / 4"
              />
            </g>
            <!-- 面积 + 线 -->
            <path :d="trendAreaPath" :fill="`url(#fill-${activeMetric})`" />
            <path :d="trendLinePath" fill="none" :stroke="activeMetricColor" stroke-width="2" stroke-linejoin="round" />
            <!-- hover 点 -->
            <g v-if="hoverIdx !== null && hoverPoint">
              <line :x1="hoverPoint.x" :x2="hoverPoint.x" :y1="0" :y2="chartH"
                stroke="rgba(212,116,142,0.3)" stroke-dasharray="3,3" />
              <circle :cx="hoverPoint.x" :cy="hoverPoint.y" r="5" :fill="activeMetricColor" stroke="#fff" stroke-width="2" />
            </g>
          </svg>

          <!-- y 轴刻度 -->
          <div class="y-axis">
            <span v-for="(v, i) in yAxisLabels" :key="i">{{ fmtCompact(v) }}</span>
          </div>

          <!-- tooltip -->
          <div v-if="hoverIdx !== null && hoverData" class="chart-tooltip" :style="{ left: hoverPoint!.x + 'px' }">
            <div class="tt-time">{{ fmtDate(hoverData.created_at) }}</div>
            <div class="tt-row"><span>请求</span><strong>{{ fmtCompact(hoverData.requests) }}</strong></div>
            <div class="tt-row"><span>Tokens</span><strong>{{ fmtCompact(hoverData.token_used) }}</strong></div>
            <div class="tt-row"><span>Quota</span><strong>{{ fmtCompact(hoverData.quota) }}</strong></div>
          </div>
        </div>

        <div v-if="trend.length" class="trend-axis">
          <span>{{ fmtDate(trend[0].created_at) }}</span>
          <span class="muted">峰值 {{ fmtCompact(trendMax) }}</span>
          <span>{{ fmtDate(trend[trend.length - 1].created_at) }}</span>
        </div>
      </div>

      <!-- Top 5 多维度环形图 -->
      <div class="card chart-card donut-card">
        <header>
          <div class="title">
            <span class="material-symbols-outlined">donut_large</span>
            <strong>Top 5 · 请求占比</strong>
          </div>
          <div class="dim-tabs">
            <button
              v-for="d in dimensions"
              :key="d.key"
              class="dim-tab"
              :class="{ active: activeDim === d.key, disabled: d.key !== 'model' && !dimensionsData }"
              :title="d.key !== 'model' && !dimensionsData ? '点击右上 ↻ 加载明细日志（需消费日志权限）' : ''"
              @click="onDimensionClick(d.key)"
            >
              <span class="material-symbols-outlined">{{ d.icon }}</span>
              {{ d.label }}
            </button>
          </div>
        </header>

        <div v-if="dimLoading" class="dim-loading">
          <span class="material-symbols-outlined spinning">progress_activity</span>
          <div class="loading-text">
            <strong>正在拉取明细日志...</strong>
            <p>时间范围越长越慢（最多 200 页 × 100 条）</p>
          </div>
        </div>

        <div v-else-if="dimError" class="dim-error">
          <span class="material-symbols-outlined">error</span>
          <div>
            <strong>加载失败</strong>
            <p>{{ dimError }}</p>
            <button class="btn compact" @click="loadDimensions">
              <span class="material-symbols-outlined">refresh</span>重试
            </button>
          </div>
        </div>

        <div v-else-if="activeDim !== 'model' && !dimensionsData" class="dim-cta">
          <span class="material-symbols-outlined">touch_app</span>
          <p>分 {{ dimensions.find(d => d.key === activeDim)?.label }} 视图依赖明细日志</p>
          <button class="btn compact" @click="loadDimensions">
            <span class="material-symbols-outlined">download</span>加载日志
          </button>
        </div>

        <div v-else-if="dimensionsData && dimensionsData.log_count === 0" class="dim-empty">
          <span class="material-symbols-outlined">inbox</span>
          <div>
            <strong>明细日志为空</strong>
            <p>NewAPI 实例可能未开启<strong>消费日志保留</strong>，或当前时间范围内无请求</p>
            <button class="btn btn-ghost compact" @click="loadDimensions">
              <span class="material-symbols-outlined">refresh</span>重试
            </button>
          </div>
        </div>

        <EmptyState v-else-if="!topItems.length && !loading" icon="pie_chart" message="暂无数据" />

        <div v-else class="donut-wrap">
          <svg class="donut-svg" viewBox="0 0 100 100">
            <g transform="translate(50,50)">
              <circle r="40" fill="none" stroke="var(--accent-bg)" stroke-width="14" />
              <circle
                v-for="(seg, i) in topDonutSegments"
                :key="i"
                r="40" fill="none"
                :stroke="seg.color"
                stroke-width="14"
                :stroke-dasharray="`${seg.dashLen} ${seg.dashGap}`"
                :stroke-dashoffset="seg.offset"
                transform="rotate(-90)"
              />
            </g>
            <text x="50" y="48" text-anchor="middle" class="donut-center-num">{{ fmtCompact(topItemsTotal) }}</text>
            <text x="50" y="60" text-anchor="middle" class="donut-center-lbl">合计请求</text>
          </svg>
          <ul class="donut-legend">
            <li v-for="(item, i) in topItems" :key="dimKey(item)">
              <span class="dot" :style="{ background: PALETTE[i % PALETTE.length] }"></span>
              <span class="name" :title="dimKey(item)">{{ dimKey(item) }}</span>
              <span class="pct">{{ ((item.requests / Math.max(1, topItemsTotal)) * 100).toFixed(1) }}%</span>
            </li>
          </ul>
        </div>
      </div>
    </div>

    <!-- 模型用量排行表 -->
    <div class="card table-section">
      <header class="table-head">
        <div class="title">
          <span class="material-symbols-outlined">leaderboard</span>
          <strong>模型用量排行</strong>
          <span class="muted">{{ filteredModels.length }} / {{ models.length }} 模型</span>
        </div>
        <input v-model="tableSearch" placeholder="搜索模型名..." class="input compact" />
      </header>

      <EmptyState v-if="!filteredModels.length && !loading" icon="insights" :message="configError ? '请先配置监控接入' : (tableSearch ? '无匹配' : '暂无数据')" />

      <table v-else class="models-table">
        <thead>
          <tr>
            <th>模型</th>
            <th class="num sortable" :class="sortClass('requests')" @click="toggleSort('requests')">请求</th>
            <th class="num sortable" :class="sortClass('token_used')" @click="toggleSort('token_used')">Tokens</th>
            <th class="num sortable" :class="sortClass('quota')" @click="toggleSort('quota')">Quota</th>
            <th class="num cache-col" :title="dimensionsData ? '缓存命中率（cache_hit / prompt_tokens）' : '加载明细日志后显示'">
              缓存命中
            </th>
            <th class="bar-col">占比</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="m in filteredModels" :key="m.model_name">
            <td class="model-name">{{ m.model_name || '(unknown)' }}</td>
            <td class="num">{{ fmtCompact(m.requests) }}</td>
            <td class="num">{{ fmtCompact(m.token_used) }}</td>
            <td class="num">{{ fmtCompact(m.quota) }}</td>
            <td class="cache-col">
              <span v-if="cacheRateFor(m) === null" class="cache-na">—</span>
              <span v-else class="cache-pill" :class="cacheClass(cacheRateFor(m)!)">
                {{ cacheRateFor(m)!.toFixed(1) }}%
              </span>
            </td>
            <td class="bar-col">
              <div class="bar-wrap">
                <div class="bar" :style="{ width: barPct(m) + '%', background: barColor(m) }"></div>
                <span class="pct">{{ barPct(m).toFixed(1) }}%</span>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 模型 × Key 矩阵 -->
    <div v-if="dimensionsData && Object.keys(dimensionsData.model_key_matrix).length" class="card matrix-card">
      <header class="matrix-head">
        <div class="title">
          <span class="material-symbols-outlined">grid_view</span>
          <strong>模型 × Key 调用占比</strong>
          <span class="muted">每个模型下不同 Key 的占比分布</span>
        </div>
        <select v-model="matrixModel" class="input compact">
          <option v-for="m in matrixModelList" :key="m" :value="m">{{ m }}</option>
        </select>
      </header>

      <div v-if="matrixData.length" class="matrix-body">
        <ul class="matrix-list">
          <li v-for="(item, i) in matrixData" :key="item.token_name">
            <div class="row">
              <span class="dot" :style="{ background: PALETTE[i % PALETTE.length] }"></span>
              <code class="key-name">{{ item.token_name }}</code>
              <span class="spacer" />
              <span class="meta">{{ fmtCompact(item.requests) }} 次 · {{ fmtCompact(item.token_used) }} tokens</span>
              <strong class="pct" :style="{ color: PALETTE[i % PALETTE.length] }">
                {{ ((item.requests / Math.max(1, matrixTotal)) * 100).toFixed(1) }}%
              </strong>
            </div>
            <div class="bar-rail">
              <div
                class="bar-fill"
                :style="{ width: ((item.requests / Math.max(1, matrixTotal)) * 100) + '%', background: PALETTE[i % PALETTE.length] }"
              ></div>
            </div>
          </li>
        </ul>
      </div>
      <EmptyState v-else icon="key_off" message="该模型下无 Key 调用数据" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import PageHeader from '@/components/common/PageHeader.vue'
import EmptyState from '@/components/common/EmptyState.vue'
import {
  getNewApiSummary, getNewApiTrend, getNewApiModels, getNewApiDimensions,
  type NewApiSummary, type NewApiTrendItem, type NewApiModelItem,
  type NewApiDimensionsData, type NewApiDimensionItem,
} from '@/api/newapi'
import { useUiStore } from '@/stores/ui'

const ui = useUiStore()

// === 状态 ===
const summary = ref<NewApiSummary | null>(null)
const trend = ref<NewApiTrendItem[]>([])
const models = ref<NewApiModelItem[]>([])
const hours = ref(24)
const modelFilter = ref('')
const loading = ref(false)
const configError = ref(false)
const autoRefresh = ref(false)
let refreshTimer: ReturnType<typeof setInterval> | null = null

// 趋势图 metric 切换
type Metric = 'requests' | 'tokens' | 'quota'
const activeMetric = ref<Metric>('requests')
const metrics = [
  { key: 'requests' as Metric, label: '请求', color: '#d4748e' },
  { key: 'tokens' as Metric, label: 'Tokens', color: '#6dbb8a' },
  { key: 'quota' as Metric, label: 'Quota', color: '#e6a94c' },
]
const activeMetricColor = computed(() => metrics.find((m) => m.key === activeMetric.value)?.color || '#d4748e')

// 表格
const tableSearch = ref('')
type SortKey = 'requests' | 'token_used' | 'quota'
const sortKey = ref<SortKey>('requests')
const sortAsc = ref(false)

// 图表常量
const chartW = 800
const chartH = 200
const PADDING = 8

// hover
const hoverIdx = ref<number | null>(null)
const chartRef = ref<SVGSVGElement | null>(null)

// 调色板（环形图）
const PALETTE = ['#d4748e', '#6dbb8a', '#e6a94c', '#7a9fd4', '#9b6dd0', '#5fc9d9']

// 多维度切换
type Dim = 'model' | 'key' | 'user' | 'channel'
const dimensions = [
  { key: 'model' as Dim, label: '模型', icon: 'memory' },
  { key: 'key' as Dim, label: 'Key', icon: 'key' },
  { key: 'user' as Dim, label: '用户', icon: 'person' },
  { key: 'channel' as Dim, label: '渠道', icon: 'hub' },
]
const activeDim = ref<Dim>('model')
const dimensionsData = ref<NewApiDimensionsData | null>(null)
const dimLoading = ref(false)

function onDimensionClick(d: Dim) {
  activeDim.value = d
  // 切到非 model 维度时如果还没拉过日志，自动拉
  if (d !== 'model' && !dimensionsData.value && !dimLoading.value) {
    loadDimensions()
  }
}

const dimError = ref('')

async function loadDimensions() {
  dimLoading.value = true
  dimError.value = ''
  try {
    const now = Math.floor(Date.now() / 1000)
    const r = await getNewApiDimensions({
      start_timestamp: now - hours.value * 3600,
      end_timestamp: now,
      model_name: modelFilter.value.trim() || undefined,
    })
    if (r.success) {
      dimensionsData.value = r.data
      if (!matrixModel.value && matrixModelList.value.length) {
        matrixModel.value = matrixModelList.value[0]
      }
      // 反馈
      const c = r.data.log_count
      if (c === 0) {
        ui.showMessage('明细日志为空 — NewAPI 实例可能未开启消费日志保留', 'warning', 4000)
      } else {
        ui.showMessage(`已加载 ${c} 条日志 · ${r.data.keys.length} Key · ${r.data.users.length} 用户`, 'success', 3000)
      }
    } else {
      dimError.value = '后端返回 success=false'
    }
  } catch (e) {
    const err = e as Error & { status?: number }
    if (err.status === 503) {
      dimError.value = 'NewAPI 监控未配置（503）'
    } else if (err.status === 502) {
      dimError.value = `NewAPI 上游接口失败：${err.message}`
    } else {
      dimError.value = `加载失败：${err.message || '未知错误'}`
    }
  } finally { dimLoading.value = false }
}

function dimKey(item: NewApiDimensionItem | NewApiModelItem): string {
  // 从对象中提取当前维度字段值
  if (activeDim.value === 'model') return (item as NewApiModelItem).model_name || '(unknown)'
  if (activeDim.value === 'key') return (item as NewApiDimensionItem).token_name || '(unknown)'
  if (activeDim.value === 'user') return (item as NewApiDimensionItem).username || '(unknown)'
  return (item as NewApiDimensionItem).channel_name || '(unknown)'
}

// === 派生 ===
const rangeLabel = computed(() => {
  if (hours.value === 1) return '过去 1 小时'
  if (hours.value === 6) return '过去 6 小时'
  if (hours.value === 24) return '过去 24 小时'
  if (hours.value === 168) return '过去 7 天'
  if (hours.value === 720) return '过去 30 天'
  return `过去 ${hours.value} 小时`
})

const avgTokensPerReq = computed(() => {
  const r = summary.value?.total_requests || 0
  const t = summary.value?.total_tokens || 0
  if (!r) return '—'
  return fmtCompact(Math.round(t / r))
})

const quotaUsd = computed(() => {
  // NewAPI 中 quota 默认 500000 = $1
  const q = summary.value?.total_quota || 0
  if (!q) return '0.00'
  return (q / 500000).toFixed(2)
})

// 趋势数据按 metric 提取
const trendValues = computed<number[]>(() => {
  const k = activeMetric.value
  return trend.value.map((t) => {
    if (k === 'requests') return t.requests
    if (k === 'tokens') return t.token_used
    return t.quota
  })
})

const trendMax = computed(() => Math.max(1, ...trendValues.value))

const computePoints = computed(() => {
  const vals = trendValues.value
  if (!vals.length) return []
  return vals.map((v, i) => ({
    x: vals.length > 1 ? (i / (vals.length - 1)) * (chartW - PADDING * 2) + PADDING : chartW / 2,
    y: chartH - (v / trendMax.value) * (chartH - PADDING * 2) - PADDING,
  }))
})

const trendLinePath = computed(() => {
  const pts = computePoints.value
  if (!pts.length) return ''
  return 'M ' + pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' L ')
})

const trendAreaPath = computed(() => {
  const pts = computePoints.value
  if (!pts.length) return ''
  const first = pts[0]
  const last = pts[pts.length - 1]
  return `M ${first.x},${chartH} ` + pts.map((p) => `L ${p.x},${p.y}`).join(' ') + ` L ${last.x},${chartH} Z`
})

const yAxisLabels = computed(() => {
  const max = trendMax.value
  return [max, (max * 0.75) | 0, (max * 0.5) | 0, (max * 0.25) | 0, 0]
})

const hoverData = computed(() => hoverIdx.value !== null ? trend.value[hoverIdx.value] : null)
const hoverPoint = computed(() => hoverIdx.value !== null ? computePoints.value[hoverIdx.value] : null)

// 环形图 — 多维度切换数据源
const topItems = computed<Array<NewApiModelItem | NewApiDimensionItem>>(() => {
  const d = activeDim.value
  if (d === 'model') {
    return [...models.value].sort((a, b) => b.requests - a.requests).slice(0, 5)
  }
  if (!dimensionsData.value) return []
  const arr = d === 'key' ? dimensionsData.value.keys
    : d === 'user' ? dimensionsData.value.users
    : dimensionsData.value.channels
  return arr.slice(0, 5)
})

const topItemsTotal = computed(() => topItems.value.reduce((s, m) => s + m.requests, 0))

const topDonutSegments = computed(() => {
  const total = topItemsTotal.value || 1
  const circumference = 2 * Math.PI * 40   // 圆周
  let acc = 0
  return topItems.value.map((m, i) => {
    const pct = m.requests / total
    const dashLen = pct * circumference
    const dashGap = circumference - dashLen
    const offset = -acc * circumference
    acc += pct
    return { color: PALETTE[i % PALETTE.length], dashLen, dashGap, offset }
  })
})

// 表格筛选 / 排序
const filteredModels = computed(() => {
  const kw = tableSearch.value.trim().toLowerCase()
  let arr = models.value
  if (kw) arr = arr.filter((m) => m.model_name.toLowerCase().includes(kw))
  return [...arr].sort((a, b) => {
    const va = a[sortKey.value] || 0
    const vb = b[sortKey.value] || 0
    return sortAsc.value ? va - vb : vb - va
  })
})

const tableMaxRequests = computed(() => Math.max(1, ...models.value.map((m) => m.requests)))

function barPct(m: NewApiModelItem) {
  return (m.requests / tableMaxRequests.value) * 100
}
function barColor(m: NewApiModelItem) {
  const pct = barPct(m)
  if (pct >= 70) return 'linear-gradient(90deg, #ff9bb3, #d4748e)'
  if (pct >= 30) return 'linear-gradient(90deg, #ffe2a8, #e6a94c)'
  return 'linear-gradient(90deg, #d4d4d4, #a8a8a8)'
}

// 缓存命中率（仅当拉过 dimensions 数据后可用）
function cacheRateFor(m: NewApiModelItem): number | null {
  if (!dimensionsData.value) return null
  const dim = dimensionsData.value.models.find((d) => d.model_name === m.model_name)
  if (!dim || dim.cache_hit_rate == null) return null
  return dim.cache_hit_rate
}
function cacheClass(rate: number): string {
  if (rate >= 50) return 'high'   // 高命中（绿）
  if (rate >= 20) return 'mid'    // 中（橙）
  if (rate > 0) return 'low'      // 低（粉）
  return 'zero'                    // 0
}

// 模型 × Key 矩阵 — 选中的模型
const matrixModel = ref<string>('')
const matrixModelList = computed(() => {
  if (!dimensionsData.value) return []
  return Object.keys(dimensionsData.value.model_key_matrix).sort()
})
const matrixData = computed<NewApiDimensionItem[]>(() => {
  if (!dimensionsData.value || !matrixModel.value) return []
  return dimensionsData.value.model_key_matrix[matrixModel.value] || []
})
const matrixTotal = computed(() => matrixData.value.reduce((s, it) => s + it.requests, 0))

function toggleSort(k: SortKey) {
  if (sortKey.value === k) sortAsc.value = !sortAsc.value
  else { sortKey.value = k; sortAsc.value = false }
}
function sortClass(k: SortKey) {
  return sortKey.value === k ? (sortAsc.value ? 'sort-asc' : 'sort-desc') : ''
}

// === Hover 交互 ===
function onChartMove(e: MouseEvent) {
  const svg = chartRef.value
  if (!svg || !computePoints.value.length) return
  const rect = svg.getBoundingClientRect()
  const x = ((e.clientX - rect.left) / rect.width) * chartW
  // 找最近的点
  let nearestIdx = 0
  let nearestDist = Infinity
  computePoints.value.forEach((p, i) => {
    const d = Math.abs(p.x - x)
    if (d < nearestDist) { nearestDist = d; nearestIdx = i }
  })
  hoverIdx.value = nearestIdx
}

// === 加载 ===
async function reload() {
  loading.value = true
  configError.value = false
  const now = Math.floor(Date.now() / 1000)
  const params = {
    start_timestamp: now - hours.value * 3600,
    end_timestamp: now,
    model_name: modelFilter.value.trim() || undefined,
  }
  const [s, t, m] = await Promise.allSettled([
    getNewApiSummary(params),
    getNewApiTrend(params),
    getNewApiModels(params),
  ])

  if (s.status === 'fulfilled' && s.value.success) {
    summary.value = s.value.data
  } else {
    summary.value = null
    const err = (s.status === 'rejected' ? s.reason : null) as { status?: number } | null
    if (err?.status === 503) configError.value = true
  }

  trend.value = (t.status === 'fulfilled' && t.value.success) ? (t.value.data.items || []) : []
  models.value = (m.status === 'fulfilled' && m.value.success) ? (m.value.data.items || []) : []

  loading.value = false
}

function onAutoRefreshChange() {
  if (autoRefresh.value) {
    refreshTimer = setInterval(reload, 30_000)
  } else if (refreshTimer) {
    clearInterval(refreshTimer)
    refreshTimer = null
  }
}

// === 工具 ===
function fmtCompact(n: number | string | undefined | null): string {
  const v = Number(n ?? 0)
  if (v >= 1e9) return (v / 1e9).toFixed(1) + 'B'
  if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M'
  if (v >= 1e3) return (v / 1e3).toFixed(1) + 'K'
  return String(v)
}

function fmtDate(ts: number): string {
  const d = new Date(ts * 1000)
  if (hours.value > 24) {
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

onMounted(reload)
onUnmounted(() => { if (refreshTimer) clearInterval(refreshTimer) })
</script>

<style lang="scss" scoped>
.newapi {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 0 24px 24px;
}

.range-select {
  padding: 6px 12px;
  border-radius: var(--radius-pill);
  font-size: 13px;
  background: var(--input-bg);
}
.search { width: 180px; border-radius: var(--radius-pill); padding: 6px 12px; }

.auto-refresh {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 5px 10px;
  background: var(--input-bg);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-pill);
  font-size: 12px;
  cursor: pointer;
  color: var(--secondary-text);

  input[type="checkbox"] {
    appearance: none;
    width: 12px; height: 12px;
    background: transparent;
    border: 1.5px solid var(--border-color);
    border-radius: 3px;
    cursor: pointer;
    margin: 0; padding: 0;
    position: relative;
    &:checked {
      background: var(--button-bg);
      border-color: var(--button-bg);
      &::after {
        content: '';
        position: absolute;
        left: 3px; top: 0;
        width: 4px; height: 7px;
        border: solid #fff;
        border-width: 0 2px 2px 0;
        transform: rotate(45deg);
      }
    }
  }
  .material-symbols-outlined { font-size: 14px; }
  .lbl { font-weight: 500; }
  &:has(input:checked) { color: var(--button-bg); border-color: var(--button-bg);
    .material-symbols-outlined { color: var(--button-bg); animation: spin 4s linear infinite; }
  }
}

.spinning { animation: spin 1s linear infinite; }
@keyframes spin { from { transform: rotate(0); } to { transform: rotate(360deg); } }

.config-warn {
  padding: 14px 18px;
  display: flex; align-items: flex-start; gap: 12px;
  border-left: 4px solid #e6a94c;
  background: rgba(230, 169, 76, 0.06);

  .material-symbols-outlined { color: #e6a94c; font-size: 24px; }
  strong { display: block; font-size: 14px; color: var(--primary-text); margin-bottom: 4px; }
  p { margin: 0; font-size: 12px; color: var(--secondary-text); }
  code { background: var(--accent-bg); padding: 1px 6px; border-radius: 3px; font-family: monospace; font-size: 11px; color: var(--highlight-text); }
}

// ===== KPI 卡 =====
.kpi-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  @media (max-width: 900px) { grid-template-columns: repeat(2, 1fr); }
}

.kpi-card {
  padding: 16px;
  display: flex; align-items: center; gap: 14px;
  position: relative;
  overflow: hidden;
  transition: transform 0.2s, box-shadow 0.2s;
  &:hover { transform: translateY(-2px); box-shadow: 0 6px 20px rgba(180, 120, 140, 0.15); }

  .kpi-icon {
    width: 48px; height: 48px;
    border-radius: 14px;
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0;
    .material-symbols-outlined { font-size: 26px; color: #fff; }
  }

  .kpi-body { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
  .kpi-label { font-size: 11.5px; color: var(--secondary-text); letter-spacing: 0.3px; }
  .kpi-value {
    font-size: 22px; color: var(--primary-text); font-weight: 700;
    font-family: 'JetBrains Mono', monospace;
    line-height: 1.2;
    .kpi-divider { color: var(--secondary-text); font-weight: 400; margin: 0 4px; }
  }
  .kpi-desc { font-size: 11px; color: var(--secondary-text); opacity: 0.85; }

  // 4 张卡分别用粉/绿/橙/紫色调
  &.kpi-req {
    .kpi-icon { background: linear-gradient(135deg, #ff9bb3, #d4748e); }
    &::before { content: ''; position: absolute; right: -20px; top: -20px; width: 80px; height: 80px;
      background: radial-gradient(circle, rgba(212, 116, 142, 0.15), transparent 70%); }
  }
  &.kpi-tok {
    .kpi-icon { background: linear-gradient(135deg, #8edcae, #6dbb8a); }
    &::before { content: ''; position: absolute; right: -20px; top: -20px; width: 80px; height: 80px;
      background: radial-gradient(circle, rgba(109, 187, 138, 0.15), transparent 70%); }
  }
  &.kpi-quota {
    .kpi-icon { background: linear-gradient(135deg, #ffd278, #e6a94c); }
    &::before { content: ''; position: absolute; right: -20px; top: -20px; width: 80px; height: 80px;
      background: radial-gradient(circle, rgba(230, 169, 76, 0.15), transparent 70%); }
  }
  &.kpi-rate {
    .kpi-icon { background: linear-gradient(135deg, #c098e8, #9b6dd0); }
    &::before { content: ''; position: absolute; right: -20px; top: -20px; width: 80px; height: 80px;
      background: radial-gradient(circle, rgba(155, 109, 208, 0.15), transparent 70%); }
  }
}

// ===== 图表区 =====
.charts-grid {
  display: grid;
  grid-template-columns: 1.6fr 1fr;
  gap: 12px;
  @media (max-width: 1100px) { grid-template-columns: 1fr; }
}

.chart-card {
  padding: 0;
  display: flex; flex-direction: column;

  > header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 12px 16px;
    border-bottom: 1px solid var(--border-color);

    .title { display: flex; align-items: center; gap: 6px;
      .material-symbols-outlined { font-size: 18px; color: var(--button-bg); }
      strong { font-size: 13px; color: var(--primary-text); }
    }
  }
}

.metric-tabs { display: flex; gap: 4px; }
.metric-tab {
  background: transparent; border: 1px solid transparent; cursor: pointer;
  padding: 4px 10px; border-radius: var(--radius-pill);
  font-size: 11.5px; color: var(--secondary-text);
  display: inline-flex; align-items: center; gap: 5px;
  transition: all 0.15s;
  .dot { width: 8px; height: 8px; border-radius: 50%; }
  &:hover { background: var(--accent-bg); }
  &.active { background: var(--input-bg); border-color: var(--accent, var(--button-bg)); color: var(--primary-text); font-weight: 500; }
}

// 趋势图
.trend-card .chart-area {
  position: relative;
  padding: 14px 16px 6px 50px;
}
.trend-chart { width: 100%; height: 200px; display: block; }

.grid line { stroke: var(--border-color); stroke-width: 0.5; opacity: 0.6; }

.y-axis {
  position: absolute;
  left: 10px; top: 14px; bottom: 6px;
  display: flex; flex-direction: column; justify-content: space-between;
  font-size: 10.5px; color: var(--secondary-text); font-family: monospace;
  pointer-events: none;
}

.chart-tooltip {
  position: absolute;
  bottom: 100%;
  transform: translateX(-50%);
  margin-bottom: 8px;
  padding: 8px 12px;
  background: var(--input-bg);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  font-size: 11px;
  box-shadow: 0 4px 16px rgba(180, 120, 140, 0.18);
  pointer-events: none;
  z-index: 10;
  white-space: nowrap;

  .tt-time { font-weight: 600; color: var(--primary-text); margin-bottom: 4px; }
  .tt-row { display: flex; justify-content: space-between; gap: 12px;
    span { color: var(--secondary-text); }
    strong { color: var(--primary-text); font-family: monospace; }
  }
}

.trend-axis {
  display: flex; justify-content: space-between;
  padding: 0 16px 12px;
  font-size: 11px; color: var(--secondary-text);
  .muted { font-style: italic; opacity: 0.8; }
}

// 维度切换 tab
.dim-tabs { display: flex; gap: 3px; }
.dim-tab {
  background: transparent; border: 1px solid transparent; cursor: pointer;
  padding: 3px 9px; border-radius: var(--radius-pill);
  font-size: 11px; color: var(--secondary-text);
  display: inline-flex; align-items: center; gap: 4px;
  transition: all 0.15s;
  .material-symbols-outlined { font-size: 13px; }
  &:hover { background: var(--accent-bg); color: var(--primary-text); }
  &.active { background: var(--input-bg); border-color: var(--button-bg); color: var(--button-bg); font-weight: 600; }
  &.disabled { opacity: 0.55; }
}

.dim-loading {
  padding: 30px 16px; display: flex; align-items: center; justify-content: center; gap: 12px;
  color: var(--secondary-text); font-size: 13px;
  .material-symbols-outlined { font-size: 24px; color: var(--button-bg); }
  .loading-text strong { display: block; font-size: 13px; color: var(--primary-text); }
  .loading-text p { margin: 2px 0 0; font-size: 11.5px; opacity: 0.85; }
}

.dim-error, .dim-empty {
  display: flex; align-items: flex-start; gap: 12px;
  padding: 16px 18px; margin: 12px 16px;
  border-left: 3px solid;
  border-radius: var(--radius-sm);
  font-size: 12.5px;

  > .material-symbols-outlined { font-size: 22px; flex-shrink: 0; margin-top: 2px; }

  strong { display: block; font-size: 13px; color: var(--primary-text); margin-bottom: 4px; }
  p { margin: 0 0 8px; color: var(--secondary-text); line-height: 1.5; }

  .btn.compact {
    font-size: 12px; padding: 4px 12px;
    display: inline-flex; align-items: center; gap: 4px;
    .material-symbols-outlined { font-size: 14px; color: inherit; }
  }
}

.dim-error {
  background: rgba(217, 85, 85, 0.06);
  border-color: var(--danger-color);
  > .material-symbols-outlined { color: var(--danger-color); }
}

.dim-empty {
  background: rgba(241, 174, 40, 0.06);
  border-color: #f1ae28;
  > .material-symbols-outlined { color: #f1ae28; }
}

.dim-cta {
  padding: 30px 16px; display: flex; flex-direction: column; align-items: center; gap: 8px;
  text-align: center;
  .material-symbols-outlined { font-size: 32px; color: var(--button-bg); opacity: 0.7; }
  p { margin: 0; font-size: 12px; color: var(--secondary-text); }
  .btn.compact { font-size: 12px; padding: 5px 14px;
    display: inline-flex; align-items: center; gap: 4px;
    .material-symbols-outlined { font-size: 14px; color: inherit; opacity: 1; }
  }
}

// 环形图
.donut-card {
  .donut-wrap {
    display: flex; align-items: center; gap: 14px;
    padding: 14px 16px;
  }
  .donut-svg { width: 140px; height: 140px; flex-shrink: 0; }
  .donut-center-num { font-size: 11px; font-weight: 700; fill: var(--primary-text); font-family: monospace; }
  .donut-center-lbl { font-size: 5px; fill: var(--secondary-text); }

  .donut-legend {
    list-style: none; padding: 0; margin: 0;
    display: flex; flex-direction: column; gap: 6px;
    flex: 1; min-width: 0;

    li { display: flex; align-items: center; gap: 6px; font-size: 12px;
      .dot { width: 10px; height: 10px; border-radius: 3px; flex-shrink: 0; }
      .name { flex: 1; color: var(--primary-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: monospace; font-size: 11px; }
      .pct { font-weight: 600; color: var(--secondary-text); font-family: monospace; font-size: 11.5px; }
    }
  }
}

// ===== 模型表格 =====
.table-section {
  padding: 0;
  overflow: hidden;
}
.table-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-color);

  .title { display: flex; align-items: center; gap: 6px;
    .material-symbols-outlined { font-size: 18px; color: var(--button-bg); }
    strong { font-size: 13px; color: var(--primary-text); }
    .muted { font-size: 11px; color: var(--secondary-text); margin-left: 4px; }
  }
  .input.compact { font-size: 12px; padding: 5px 10px; border-radius: var(--radius-pill); width: 200px; }
}

.models-table {
  width: 100%; border-collapse: collapse; font-size: 13px;

  th, td { padding: 10px 16px; border-bottom: 1px solid var(--border-color); text-align: left; }
  th {
    font-size: 11px; color: var(--secondary-text); font-weight: 500;
    background: var(--accent-bg);
    user-select: none;
    &.sortable { cursor: pointer; transition: background 0.1s;
      &:hover { background: rgba(212, 116, 142, 0.1); }
      &::after { content: ' ⇅'; opacity: 0.4; }
      &.sort-asc::after { content: ' ↑'; opacity: 1; color: var(--button-bg); }
      &.sort-desc::after { content: ' ↓'; opacity: 1; color: var(--button-bg); }
    }
  }
  .num { text-align: right; font-family: 'JetBrains Mono', monospace; color: var(--primary-text); }
  .model-name { font-family: 'JetBrains Mono', monospace; color: var(--primary-text); font-size: 12px; }
  .bar-col { width: 20%; min-width: 140px; }

  .cache-col { text-align: right; width: 90px; }
  .cache-na { color: var(--secondary-text); font-style: italic; opacity: 0.5; }
  .cache-pill {
    display: inline-block; padding: 2px 8px; border-radius: var(--radius-pill);
    font-size: 11px; font-family: monospace; font-weight: 600;
    &.high { background: rgba(88, 201, 143, 0.15); color: #2f8e5f; }
    &.mid  { background: rgba(241, 174, 40, 0.15); color: #b67e1f; }
    &.low  { background: rgba(212, 116, 142, 0.15); color: var(--button-bg); }
    &.zero { background: rgba(0, 0, 0, 0.04); color: var(--secondary-text); font-weight: 400; }
  }

  .bar-wrap { display: flex; align-items: center; gap: 8px;
    .bar { height: 8px; border-radius: 4px; transition: width 0.4s; min-width: 4px; }
    .pct { font-size: 11px; color: var(--secondary-text); font-family: monospace; min-width: 40px; }
  }

  tr:last-child td { border-bottom: none; }
  tr:hover td { background: var(--accent-bg); }
}

// ===== 模型 × Key 矩阵 =====
.matrix-card { padding: 0; }
.matrix-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-color);

  .title { display: flex; align-items: center; gap: 6px;
    .material-symbols-outlined { font-size: 18px; color: var(--button-bg); }
    strong { font-size: 13px; color: var(--primary-text); }
    .muted { font-size: 11px; color: var(--secondary-text); margin-left: 4px; opacity: 0.85; }
  }
  .input.compact { font-size: 12px; padding: 5px 12px; border-radius: var(--radius-pill); min-width: 200px; font-family: monospace; }
}

.matrix-body { padding: 14px 16px; }

.matrix-list {
  list-style: none; padding: 0; margin: 0;
  display: flex; flex-direction: column; gap: 12px;

  li {
    display: flex; flex-direction: column; gap: 5px;

    .row {
      display: flex; align-items: center; gap: 8px;
      font-size: 12px;
      .dot { width: 10px; height: 10px; border-radius: 3px; flex-shrink: 0; }
      .key-name { font-family: monospace; color: var(--primary-text); font-size: 12px; background: transparent; padding: 0; flex-shrink: 0; }
      .spacer { flex: 1; }
      .meta { color: var(--secondary-text); font-size: 11px; font-family: monospace; }
      .pct { font-family: 'JetBrains Mono', monospace; font-size: 13px; font-weight: 700; min-width: 60px; text-align: right; }
    }

    .bar-rail {
      height: 8px; background: var(--accent-bg);
      border-radius: 4px; overflow: hidden;

      .bar-fill { height: 100%; transition: width 0.4s ease; min-width: 4px; border-radius: 4px; }
    }
  }
}
</style>
