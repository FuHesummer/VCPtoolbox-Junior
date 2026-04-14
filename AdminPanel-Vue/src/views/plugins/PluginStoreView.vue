<template>
  <div class="page">
    <PageHeader title="插件商店" subtitle="从远程仓库浏览 / 安装插件（含 requires 依赖连锁）" icon="storefront">
      <template #actions>
        <input v-model="keyword" type="text" placeholder="搜索..." class="search" />
        <button class="btn btn-ghost" @click="checkUpdates" :disabled="loading">
          <span class="material-symbols-outlined">system_update</span>
          检查更新
        </button>
        <button class="btn btn-ghost" @click="reload" :disabled="loading">
          <span class="material-symbols-outlined">refresh</span>
        </button>
      </template>
    </PageHeader>

    <div class="store-content">
      <ServiceWarn v-if="serviceError" title="无法连接到主服务" icon="cloud_off">
        插件商店需要主服务在线（<code>PORT 6005</code>）。请先运行 <code>node server.js</code> 启动主服务后再刷新此页面。
      </ServiceWarn>

      <!-- 统计 & 更新横幅 -->
      <div v-if="!serviceError && (remote.length || loading)" class="stats-bar">
        <span class="stat-badge">{{ remote.length }} 可用</span>
        <span class="stat-badge installed">{{ installedSet.size }} 已安装</span>
        <span v-if="updatesAvailable.length" class="stat-badge updates">
          <span class="material-symbols-outlined">upgrade</span>
          {{ updatesAvailable.length }} 可更新
        </span>
      </div>

      <div v-if="updatesAvailable.length" class="update-banner card">
        <div class="update-header">
          <span class="material-symbols-outlined">upgrade</span>
          <strong>{{ updatesAvailable.length }} 个插件有可用更新</strong>
        </div>
        <ul class="update-list">
          <li v-for="u in updatesAvailable" :key="u.name">
            <span class="name">{{ u.displayName || u.name }}</span>
            <span class="versions">
              <code>{{ u.currentVersion }}</code>
              <span class="arrow">→</span>
              <code class="new">{{ u.latestVersion }}</code>
            </span>
            <button class="btn mini" @click="onInstall(findRemote(u.name))" :disabled="installing === u.name">
              {{ installing === u.name ? '更新中...' : '更新' }}
            </button>
          </li>
        </ul>
      </div>

      <EmptyState v-if="loading && !remote.length" icon="cloud_download" message="正在从远程仓库加载..." />

      <!-- 分类 tab 导航 -->
      <div v-else-if="remote.length" class="cat-tabs">
        <button
          v-for="tab in categoryTabs"
          :key="tab.key"
          class="cat-tab"
          :class="{ active: activeCategory === tab.key }"
          @click="selectCategory(tab.key)"
        >
          <span v-if="tab.icon" class="material-symbols-outlined">{{ tab.icon }}</span>
          {{ tab.label }}
          <span class="tab-count">{{ tab.count }}</span>
        </button>
      </div>

      <!-- 当前分类的卡片网格（分页后） -->
      <div v-if="!loading && pagedItems.length" class="card-grid">
        <div v-for="item in pagedItems" :key="item.name" class="store-card card" :class="{ installed: installedSet.has(item.name) }">
          <div class="header">
            <strong>{{ item.displayName || item.name }}</strong>
            <span v-if="item.version" class="version">v{{ item.version }}</span>
          </div>
          <p class="desc">{{ item.description || '（无描述）' }}</p>
          <div class="meta">
            <span v-if="installedSet.has(item.name)" class="tag ok">已安装</span>
            <span v-else class="tag avail">可安装</span>
            <span v-if="item.dashboardCards?.length" class="tag ui" title="提供仪表盘卡片（dashboardCards）">
              <span class="material-symbols-outlined">dashboard</span>
            </span>
            <span v-if="item.adminNav" class="tag ui" title="提供侧边栏页面（adminNav）">
              <span class="material-symbols-outlined">left_panel_open</span>
            </span>
            <span v-if="item.requires?.length" class="tag dep" :title="`依赖：${item.requires.join(', ')}`">
              <span class="material-symbols-outlined">link</span>{{ item.requires.length }}
            </span>
          </div>
          <button
            v-if="installedSet.has(item.name)"
            class="btn btn-danger uninstall"
            :disabled="installing === item.name"
            @click="onUninstall(item)"
          >
            {{ installing === item.name ? '卸载中...' : '卸载' }}
          </button>
          <button
            v-else
            class="btn install"
            :disabled="installing === item.name"
            @click="onInstall(item)"
          >
            {{ installing === item.name ? '安装中...' : '安装' }}
          </button>
        </div>
      </div>

      <!-- 分页栏 -->
      <div v-if="!loading && totalPages > 1" class="pagination">
        <button class="btn btn-ghost mini" @click="page = 1" :disabled="page === 1" title="首页">
          <span class="material-symbols-outlined">first_page</span>
        </button>
        <button class="btn btn-ghost mini" @click="page--" :disabled="page === 1" title="上一页">
          <span class="material-symbols-outlined">chevron_left</span>
        </button>
        <button
          v-for="p in visiblePages"
          :key="p"
          class="page-num"
          :class="{ active: p === page }"
          @click="page = p"
        >
          {{ p }}
        </button>
        <button class="btn btn-ghost mini" @click="page++" :disabled="page === totalPages" title="下一页">
          <span class="material-symbols-outlined">chevron_right</span>
        </button>
        <button class="btn btn-ghost mini" @click="page = totalPages" :disabled="page === totalPages" title="末页">
          <span class="material-symbols-outlined">last_page</span>
        </button>
        <span class="page-info">
          第 {{ page }} / {{ totalPages }} 页 · 共 {{ filtered.length }} 项
        </span>
      </div>

      <EmptyState v-if="!loading && !serviceError && !filtered.length" icon="search_off" message="没有匹配的插件" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import PageHeader from '@/components/common/PageHeader.vue'
import EmptyState from '@/components/common/EmptyState.vue'
import ServiceWarn from '@/components/common/ServiceWarn.vue'
import {
  listRemotePlugins, listInstalledPlugins, resolveDependencies,
  installPlugin, uninstallPlugin, checkPluginUpdates,
} from '@/api/pluginStore'
import type { PluginStoreItem } from '@/api/types'
import { useConfirm } from '@/composables/useConfirm'
import { useUiStore } from '@/stores/ui'

const { confirm } = useConfirm()
const ui = useUiStore()

const remote = ref<PluginStoreItem[]>([])
const installed = ref<PluginStoreItem[]>([])
const keyword = ref('')
const loading = ref(false)
const installing = ref<string | null>(null)
const serviceError = ref(false)

interface UpdateItem { name: string; displayName?: string; currentVersion: string; latestVersion: string }
const updatesAvailable = ref<UpdateItem[]>([])

const installedSet = computed(() => new Set(installed.value.map((p) => p.name)))

// 关键字全局搜索（跨分类），按 keyword + activeCategory 双重过滤
const searchFiltered = computed(() => {
  if (!keyword.value.trim()) return remote.value
  const kw = keyword.value.toLowerCase()
  return remote.value.filter((p) =>
    p.name.toLowerCase().includes(kw)
    || (p.displayName || '').toLowerCase().includes(kw)
    || (p.description || '').toLowerCase().includes(kw),
  )
})

// 当前分类过滤后的结果（供 pagedItems 分页）
const filtered = computed(() => {
  if (activeCategory.value === 'all') return searchFiltered.value
  if (activeCategory.value === 'installed') return searchFiltered.value.filter((p) => installedSet.value.has(p.name))
  return searchFiltered.value.filter((p) => (p.pluginType || 'other') === activeCategory.value || (!CATEGORY_META[p.pluginType || ''] && activeCategory.value === 'other'))
})

// ============================================================
// 分类（对齐原 AdminPanel 的 6 大类）
// ============================================================
const CATEGORY_META: Record<string, { label: string; icon: string; order: number }> = {
  hybridservice:        { label: 'AI 协作', icon: 'hub', order: 1 },
  synchronous:          { label: '同步工具', icon: 'bolt', order: 2 },
  asynchronous:         { label: '异步工具', icon: 'schedule', order: 3 },
  messagePreprocessor:  { label: '消息预处理器', icon: 'transform', order: 4 },
  static:               { label: '静态注入', icon: 'subject', order: 5 },
  service:              { label: '后台服务', icon: 'memory', order: 6 },
  other:                { label: '其它', icon: 'category', order: 99 },
}

const activeCategory = ref<string>('all')

interface CategoryTab { key: string; label: string; icon?: string; count: number }

const categoryTabs = computed<CategoryTab[]>(() => {
  const counts = new Map<string, number>()
  for (const item of searchFiltered.value) {
    const type = item.pluginType || 'other'
    const key = CATEGORY_META[type] ? type : 'other'
    counts.set(key, (counts.get(key) || 0) + 1)
  }
  const tabs: CategoryTab[] = [
    { key: 'all', label: '全部', icon: 'apps', count: searchFiltered.value.length },
    { key: 'installed', label: '已安装', icon: 'check_circle', count: searchFiltered.value.filter((p) => installedSet.value.has(p.name)).length },
  ]
  const ordered = Object.keys(CATEGORY_META)
    .filter((k) => counts.get(k))
    .sort((a, b) => CATEGORY_META[a].order - CATEGORY_META[b].order)
  for (const key of ordered) {
    tabs.push({ key, label: CATEGORY_META[key].label, icon: CATEGORY_META[key].icon, count: counts.get(key) || 0 })
  }
  return tabs
})

function selectCategory(key: string) {
  activeCategory.value = key
  page.value = 1
}

// ============================================================
// 分页
// ============================================================
const PAGE_SIZE = 24
const page = ref(1)
const totalPages = computed(() => Math.max(1, Math.ceil(filtered.value.length / PAGE_SIZE)))

const pagedItems = computed<PluginStoreItem[]>(() => {
  const sorted = [...filtered.value].sort((a, b) => {
    const ai = installedSet.value.has(a.name) ? 1 : 0
    const bi = installedSet.value.has(b.name) ? 1 : 0
    if (ai !== bi) return ai - bi
    return (a.displayName || a.name).localeCompare(b.displayName || b.name)
  })
  const start = (page.value - 1) * PAGE_SIZE
  return sorted.slice(start, start + PAGE_SIZE)
})

// 分页栏可见页码（最多 7 个，围绕 current page 滑动）
const visiblePages = computed<number[]>(() => {
  const total = totalPages.value
  const current = page.value
  const maxVisible = 7
  if (total <= maxVisible) return Array.from({ length: total }, (_, i) => i + 1)
  const half = Math.floor(maxVisible / 2)
  let start = Math.max(1, current - half)
  let end = Math.min(total, start + maxVisible - 1)
  if (end - start < maxVisible - 1) start = Math.max(1, end - maxVisible + 1)
  return Array.from({ length: end - start + 1 }, (_, i) => start + i)
})

// 搜索/分类变化 → 重置到第一页，防止页码超过 totalPages
watch([keyword, activeCategory], () => { page.value = 1 })
watch(totalPages, (n) => { if (page.value > n) page.value = n })

function findRemote(name: string): PluginStoreItem {
  return remote.value.find((p) => p.name === name) || { name }
}

async function reload() {
  loading.value = true
  serviceError.value = false
  try {
    const [r, i] = await Promise.all([listRemotePlugins(), listInstalledPlugins()])
    remote.value = r.plugins || []
    installed.value = i.plugins || []
  } catch (e) {
    remote.value = []
    installed.value = []
    serviceError.value = true
    const err = e as Error & { status?: number }
    if (err.status !== 504 && err.status !== 502 && err.status !== 503) {
      ui.showMessage('加载失败: ' + err.message, 'error')
    }
  } finally {
    loading.value = false
  }
}

async function checkUpdates() {
  try {
    const result = await checkPluginUpdates()
    updatesAvailable.value = (result.updates as unknown as UpdateItem[]) || []
    if (!updatesAvailable.value.length) {
      ui.showMessage('所有插件已是最新版本 ✅', 'success', 2500)
    }
  } catch { /* */ }
}

async function onInstall(item: PluginStoreItem) {
  installing.value = item.name
  try {
    const deps = await resolveDependencies(item.name).catch(() => null)
    if (deps?.notFound?.length) {
      ui.showMessage(`依赖 ${deps.notFound.join(', ')} 在仓库中不存在`, 'error', 5000)
      return
    }
    if (deps?.missing?.length) {
      const missingNames = deps.missing.map((d) => typeof d === 'string' ? d : (d as { name?: string; displayName?: string }).displayName || (d as { name?: string }).name || '').filter(Boolean)
      const ok = await confirm(
        `此插件依赖以下未安装的插件：\n\n${missingNames.join('、')}\n\n是否一起安装？`,
        { title: '插件依赖', okText: '一起安装' },
      )
      if (!ok) return
      for (const dep of deps.missing) {
        const depName = typeof dep === 'string' ? dep : (dep as { name?: string }).name
        if (!depName) continue
        installing.value = depName
        const r = await installPlugin(depName)
        if (!r.success) {
          ui.showMessage(`依赖 ${depName} 安装失败: ${r.message}`, 'error')
          return
        }
      }
    }
    installing.value = item.name
    const res = await installPlugin(item.name)
    if (res.success === false) {
      ui.showMessage(res.message || '安装失败', 'error')
      return
    }
    ui.showMessage(`${item.displayName || item.name} 安装成功（重启服务生效）`, 'success')
    // 把更新记录里这项去掉（如果在列表里）
    updatesAvailable.value = updatesAvailable.value.filter((u) => u.name !== item.name)
    reload()
  } catch (e) {
    ui.showMessage('安装失败: ' + (e as Error).message, 'error')
  } finally {
    installing.value = null
  }
}

async function onUninstall(item: PluginStoreItem) {
  const ok = await confirm(`确定卸载 "${item.displayName || item.name}" 吗？\n（将从本地移除该插件目录）`, {
    danger: true, okText: '卸载',
  })
  if (!ok) return
  installing.value = item.name
  try {
    const res = await uninstallPlugin(item.name)
    if (res.success === false) {
      ui.showMessage(res.message || '卸载失败', 'error')
      return
    }
    ui.showMessage(`${item.displayName || item.name} 已卸载`, 'success')
    reload()
  } catch (e) {
    ui.showMessage('卸载失败: ' + (e as Error).message, 'error')
  } finally {
    installing.value = null
  }
}

onMounted(reload)
</script>

<style lang="scss" scoped>
.store-content {
  padding: 0 24px 24px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.search {
  padding: 6px 12px;
  border-radius: var(--radius-pill);
  font-size: 13px;
  width: 200px;
}

.stats-bar {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.stat-badge {
  padding: 3px 12px;
  border-radius: var(--radius-pill);
  background: var(--accent-bg);
  color: var(--highlight-text);
  font-size: 12px;
  display: inline-flex;
  align-items: center;
  gap: 4px;

  &.installed { background: rgba(109, 187, 138, 0.15); color: #4a8d63; }
  &.updates { background: rgba(230, 169, 76, 0.15); color: #b07a1f; }

  .material-symbols-outlined { font-size: 14px; }
}

.update-banner {
  padding: 14px 18px;
  border-left: 4px solid #b07a1f;
  background: rgba(230, 169, 76, 0.04);

  .update-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 10px;

    .material-symbols-outlined { color: #b07a1f; }
    strong { font-size: 14px; color: var(--primary-text); }
  }
}

.update-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;

  li {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 6px 0;

    .name { flex: 1; font-size: 13px; color: var(--primary-text); }
    .versions {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      color: var(--secondary-text);

      code {
        background: var(--accent-bg);
        padding: 1px 6px;
        border-radius: 3px;
        font-family: 'JetBrains Mono', Consolas, monospace;

        &.new { color: #4a8d63; background: rgba(109, 187, 138, 0.12); }
      }

      .arrow { opacity: 0.5; }
    }
    .mini { padding: 4px 12px; font-size: 12px; }
  }
}

// ====== 分类 tab 导航 ======
.cat-tabs {
  display: flex;
  gap: 4px;
  padding: 8px;
  background: var(--card-bg);
  border: var(--card-border);
  border-radius: var(--card-radius);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  box-shadow: var(--card-shadow);
  overflow-x: auto;
  flex-wrap: wrap;
}

.cat-tab {
  background: transparent;
  border: 1px solid transparent;
  padding: 7px 14px;
  border-radius: var(--radius-pill);
  font-size: 13px;
  cursor: pointer;
  color: var(--primary-text);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  transition: all 0.15s;
  white-space: nowrap;

  &:hover { background: var(--accent-bg); }

  &.active {
    background: var(--button-bg);
    color: #fff;

    .tab-count { background: rgba(255, 255, 255, 0.25); color: #fff; }
  }

  .material-symbols-outlined { font-size: 16px; }

  .tab-count {
    font-size: 11px;
    background: var(--accent-bg);
    color: var(--highlight-text);
    padding: 1px 8px;
    border-radius: var(--radius-pill);
    min-width: 18px;
    text-align: center;
  }
}

// ====== 分页栏 ======
.pagination {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 8px 14px;
  background: var(--card-bg);
  border: var(--card-border);
  border-radius: var(--card-radius);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  flex-wrap: wrap;

  .mini {
    padding: 4px;
    display: inline-flex;
    align-items: center;
    justify-content: center;

    .material-symbols-outlined { font-size: 18px; }
  }

  .page-num {
    min-width: 30px;
    padding: 4px 8px;
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    color: var(--primary-text);
    cursor: pointer;
    font-size: 13px;

    &:hover { background: var(--accent-bg); }

    &.active {
      background: var(--button-bg);
      color: #fff;
    }
  }

  .page-info {
    margin-left: auto;
    font-size: 11px;
    color: var(--secondary-text);
  }
}

.card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 10px;
}

.store-card {
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  position: relative;

  &.installed {
    border-left: 3px solid #6dbb8a;
  }

  .header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 8px;

    strong { font-size: 14px; color: var(--primary-text); }
    .version { font-size: 11px; color: var(--secondary-text); }
  }

  .desc {
    font-size: 12px;
    color: var(--secondary-text);
    margin: 0;
    line-height: 1.5;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    min-height: 36px;
  }

  .meta {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;

    .tag {
      font-size: 10px;
      padding: 1px 8px;
      border-radius: var(--radius-pill);
      background: var(--accent-bg);
      color: var(--secondary-text);
      display: inline-flex;
      align-items: center;
      gap: 2px;

      .material-symbols-outlined { font-size: 11px; }

      &.ok { background: rgba(109, 187, 138, 0.15); color: #4a8d63; }
      &.avail { background: var(--accent-bg); color: var(--highlight-text); }
      &.ui { color: var(--highlight-text); }
      &.dep { color: #c08a1f; }
    }
  }

  .install, .uninstall {
    margin-top: 4px;
    padding: 6px 12px;
    font-size: 13px;
  }
}
</style>
