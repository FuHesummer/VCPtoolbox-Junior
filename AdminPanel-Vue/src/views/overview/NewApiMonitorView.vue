<template>
  <div class="page newapi">
    <PageHeader title="NewAPI 监控" subtitle="请求 / Token / Quota 用量统计" icon="monitor_heart">
      <template #actions>
        <select v-model.number="hours" @change="reload" class="range-select">
          <option :value="1">最近 1 小时</option>
          <option :value="6">最近 6 小时</option>
          <option :value="24">最近 24 小时</option>
          <option :value="24 * 7">最近 7 天</option>
          <option :value="24 * 30">最近 30 天</option>
        </select>
        <input v-model="modelFilter" @change="reload" placeholder="按模型过滤..." class="search" />
        <button class="btn btn-ghost" @click="reload" :disabled="loading">
          <span class="material-symbols-outlined">refresh</span>
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

    <!-- Summary 汇总卡片 -->
    <div v-if="summary" class="summary-grid">
      <div class="summary-card card">
        <span class="summary-label">请求数</span>
        <strong class="summary-value">{{ fmtCompact(summary.total_requests) }}</strong>
      </div>
      <div class="summary-card card">
        <span class="summary-label">Tokens</span>
        <strong class="summary-value">{{ fmtCompact(summary.total_tokens) }}</strong>
      </div>
      <div class="summary-card card">
        <span class="summary-label">Quota</span>
        <strong class="summary-value">{{ fmtCompact(summary.total_quota) }}</strong>
      </div>
      <div class="summary-card card">
        <span class="summary-label">RPM / TPM</span>
        <strong class="summary-value">{{ fmtCompact(summary.current_rpm) }} / {{ fmtCompact(summary.current_tpm) }}</strong>
      </div>
    </div>

    <!-- 趋势图 -->
    <div v-if="trend.length" class="card trend-section">
      <h3>时间趋势</h3>
      <svg class="trend-chart" :viewBox="`0 0 ${chartW} ${chartH}`" preserveAspectRatio="none">
        <defs>
          <linearGradient id="trend-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#c9627e" stop-opacity="0.25" />
            <stop offset="100%" stop-color="#c9627e" stop-opacity="0" />
          </linearGradient>
        </defs>
        <path :d="trendAreaPath" fill="url(#trend-fill)" />
        <path :d="trendLinePath" fill="none" stroke="#c9627e" stroke-width="2" />
      </svg>
      <div class="trend-axis">
        <span>{{ fmtDate(trend[0].created_at) }}</span>
        <span>请求数峰值 {{ fmtCompact(trendMax) }}</span>
        <span>{{ fmtDate(trend[trend.length - 1].created_at) }}</span>
      </div>
    </div>

    <!-- 模型排行 -->
    <div class="card table-section">
      <h3>模型用量排行</h3>
      <EmptyState v-if="!models.length && !loading" icon="insights" :message="configError ? '请先配置监控接入' : '暂无数据'" />
      <table v-else class="models-table">
        <thead>
          <tr>
            <th>模型</th>
            <th class="num">请求</th>
            <th class="num">Tokens</th>
            <th class="num">Quota</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="m in models" :key="m.model_name">
            <td class="model-name">{{ m.model_name || '(unknown)' }}</td>
            <td class="num">{{ fmtCompact(m.requests) }}</td>
            <td class="num">{{ fmtCompact(m.token_used) }}</td>
            <td class="num">{{ fmtCompact(m.quota) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import PageHeader from '@/components/common/PageHeader.vue'
import EmptyState from '@/components/common/EmptyState.vue'
import {
  getNewApiSummary, getNewApiTrend, getNewApiModels,
  type NewApiSummary, type NewApiTrendItem, type NewApiModelItem,
} from '@/api/newapi'

const summary = ref<NewApiSummary | null>(null)
const trend = ref<NewApiTrendItem[]>([])
const models = ref<NewApiModelItem[]>([])
const hours = ref(24)
const modelFilter = ref('')
const loading = ref(false)
const configError = ref(false)

const chartW = 800
const chartH = 120

const trendMax = computed(() => Math.max(1, ...trend.value.map((t) => t.requests)))

const trendLinePath = computed(() => pathFromPoints(computePoints.value))
const trendAreaPath = computed(() => {
  const pts = computePoints.value
  if (!pts.length) return ''
  const first = pts[0]
  const last = pts[pts.length - 1]
  return `M ${first.x},${chartH} ` + pts.map((p) => `L ${p.x},${p.y}`).join(' ') + ` L ${last.x},${chartH} Z`
})

const computePoints = computed(() => {
  const items = trend.value
  if (!items.length) return []
  const padding = 4
  const maxR = trendMax.value
  return items.map((it, i) => ({
    x: items.length > 1 ? (i / (items.length - 1)) * (chartW - padding * 2) + padding : chartW / 2,
    y: chartH - (it.requests / maxR) * (chartH - padding * 2) - padding,
  }))
})

function pathFromPoints(pts: Array<{ x: number; y: number }>): string {
  if (!pts.length) return ''
  return 'M ' + pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' L ')
}

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

  // summary
  if (s.status === 'fulfilled' && s.value.success) {
    summary.value = s.value.data
  } else {
    summary.value = null
    const err = (s.status === 'rejected' ? s.reason : null) as { status?: number } | null
    if (err?.status === 503) configError.value = true
  }

  // trend
  if (t.status === 'fulfilled' && t.value.success) {
    trend.value = t.value.data.items || []
  } else { trend.value = [] }

  // models
  if (m.status === 'fulfilled' && m.value.success) {
    models.value = m.value.data.items || []
  } else { models.value = [] }

  loading.value = false
}

function fmtCompact(n: number | string | undefined | null): string {
  const v = Number(n ?? 0)
  if (v >= 1e9) return (v / 1e9).toFixed(1) + 'B'
  if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M'
  if (v >= 1e3) return (v / 1e3).toFixed(1) + 'K'
  return String(v)
}

function fmtDate(ts: number): string {
  const d = new Date(ts * 1000)
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

onMounted(reload)
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

.search {
  padding: 6px 12px;
  border-radius: var(--radius-pill);
  font-size: 13px;
  width: 180px;
}

.config-warn {
  padding: 14px 18px;
  display: flex;
  align-items: flex-start;
  gap: 12px;
  border-left: 4px solid #e6a94c;
  background: rgba(230, 169, 76, 0.06);

  .material-symbols-outlined {
    color: #e6a94c;
    font-size: 24px;
  }

  strong { display: block; font-size: 14px; color: var(--primary-text); margin-bottom: 4px; }
  p { margin: 0; font-size: 12px; color: var(--secondary-text); }

  code {
    background: var(--accent-bg);
    padding: 1px 6px;
    border-radius: 3px;
    font-family: 'JetBrains Mono', Consolas, monospace;
    font-size: 11px;
  }
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;

  @media (max-width: 700px) { grid-template-columns: repeat(2, 1fr); }
}

.summary-card {
  padding: 16px 18px;
  display: flex;
  flex-direction: column;
  gap: 6px;

  .summary-label {
    font-size: 12px;
    color: var(--secondary-text);
    letter-spacing: 0.3px;
  }

  .summary-value {
    font-size: 24px;
    color: var(--primary-text);
    font-weight: 600;
  }
}

.trend-section {
  padding: 18px 20px;

  h3 {
    margin: 0 0 12px;
    font-size: 13px;
    color: var(--secondary-text);
    font-weight: 500;
  }

  .trend-chart {
    width: 100%;
    height: 120px;
    display: block;
  }

  .trend-axis {
    display: flex;
    justify-content: space-between;
    font-size: 11px;
    color: var(--secondary-text);
    margin-top: 6px;
  }
}

.table-section {
  padding: 0;
  overflow: hidden;

  h3 {
    margin: 0;
    padding: 14px 18px;
    border-bottom: 1px solid var(--border-color);
    font-size: 13px;
    color: var(--secondary-text);
    font-weight: 500;
  }
}

.models-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;

  th, td {
    padding: 10px 16px;
    border-bottom: 1px solid var(--border-color);
    text-align: left;
  }

  th {
    font-size: 11px;
    color: var(--secondary-text);
    font-weight: 500;
    background: var(--accent-bg);
  }

  .num {
    text-align: right;
    font-family: 'JetBrains Mono', Consolas, monospace;
    color: var(--primary-text);
  }

  .model-name {
    font-family: 'JetBrains Mono', Consolas, monospace;
    color: var(--primary-text);
  }

  tr:last-child td { border-bottom: none; }
  tr:hover td { background: var(--accent-bg); }
}
</style>
