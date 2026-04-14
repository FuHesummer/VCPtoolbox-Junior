<template>
  <div class="page">
    <PageHeader
      title="占位符查看"
      subtitle="所有可用的系统占位符（{{'{{VCPxxx}}'}}、{{'{{Tarxxx}}'}}、{{'{{Varxxx}}'}}、{{'{{Sarxxx}}'}} 等）"
      icon="variables"
    >
      <template #actions>
        <input v-model="keyword" placeholder="搜索名称或内容..." class="search" />
        <button class="btn btn-ghost" @click="reload" :disabled="loading">
          <span class="material-symbols-outlined">refresh</span>
        </button>
      </template>
    </PageHeader>

    <div class="ph-content">
      <div v-if="items.length || loading" class="stats-bar">
        <span class="stat-badge">共 {{ items.length }} 个占位符</span>
        <span v-if="keyword.trim()" class="stat-badge kw">"{{ keyword }}" 匹配 {{ searchFiltered.length }} 项</span>
      </div>

      <EmptyState v-if="loading && !items.length" icon="variables" message="加载中..." />

      <!-- 分类 tab 导航 -->
      <div v-else-if="items.length" class="cat-tabs">
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

      <!-- 卡片网格（分页后）-->
      <div v-if="!loading && pagedItems.length" class="card-grid">
        <div
          v-for="it in pagedItems"
          :key="it.name"
          class="ph-card card"
          @click="viewDetail(it)"
        >
          <div class="card-head">
            <code class="key">{{ it.name }}</code>
          </div>
          <p class="preview">{{ it.preview || '—' }}</p>
          <p v-if="it.description" class="desc">{{ it.description }}</p>
          <div class="card-footer">
            <span class="type-tag">{{ categoryLabelOf(it.type) }}</span>
            <span v-if="it.charCount !== 0 && it.charCount !== '-'" class="char-count">
              {{ it.charCount }} 字
            </span>
          </div>
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
        <span class="page-info">第 {{ page }} / {{ totalPages }} 页 · 共 {{ filtered.length }} 项</span>
      </div>

      <EmptyState v-if="!loading && items.length && !filtered.length" icon="search_off" message="当前分类无匹配占位符" />
      <EmptyState v-if="!loading && !items.length" icon="search_off" message="没有占位符数据" />
    </div>

    <BaseModal v-model="detailOpen" :title="activeDetail?.name || '占位符详情'" width="720px">
      <div v-if="activeDetail" class="detail-body">
        <div class="detail-head">
          <code>{{ activeDetail.name }}</code>
          <button class="btn btn-ghost btn-sm" @click="copyKey(activeDetail.name)">
            <span class="material-symbols-outlined">content_copy</span> 复制
          </button>
        </div>
        <pre class="detail-value">{{ detailLoading ? '加载中...' : detailValue }}</pre>
      </div>
    </BaseModal>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import PageHeader from '@/components/common/PageHeader.vue'
import EmptyState from '@/components/common/EmptyState.vue'
import BaseModal from '@/components/common/BaseModal.vue'
import { getPlaceholders, getPlaceholderDetail, type PlaceholderItem, type PlaceholderType } from '@/api/config'
import { useUiStore } from '@/stores/ui'

const ui = useUiStore()
const items = ref<PlaceholderItem[]>([])
const keyword = ref('')
const loading = ref(false)
const detailOpen = ref(false)
const detailLoading = ref(false)
const detailValue = ref('')
const activeDetail = ref<PlaceholderItem | null>(null)

// ============================================================
// 分类定义（含图标、显示顺序）
// 多个 type 归为一类（如 diary + diary_character 归"日记"，tool_description + vcp_all_tools 归"工具描述"）
// ============================================================
interface CatDef { label: string; icon: string; order: number; types: PlaceholderType[] }
const CATEGORY_META: Record<string, CatDef> = {
  agent:          { label: 'Agent',       icon: 'smart_toy',        order: 1, types: ['agent'] },
  env_tar_var:    { label: '变量(Tar/Var)', icon: 'data_object',      order: 2, types: ['env_tar_var'] },
  env_sar:        { label: 'Sar 变量',     icon: 'model_training',   order: 3, types: ['env_sar'] },
  fixed:          { label: '固定值',       icon: 'schedule',         order: 4, types: ['fixed'] },
  static_plugin:  { label: '静态插件',     icon: 'extension',        order: 5, types: ['static_plugin'] },
  tool_description: { label: '工具描述',   icon: 'handyman',         order: 6, types: ['tool_description', 'vcp_all_tools'] },
  diary:          { label: '日记',         icon: 'menu_book',        order: 7, types: ['diary', 'diary_character'] },
  image_key:      { label: '图像',         icon: 'image',            order: 8, types: ['image_key'] },
  async_placeholder: { label: '异步',      icon: 'hourglass_empty',  order: 9, types: ['async_placeholder'] },
}

// type → category key 反向查找
const TYPE_TO_CAT: Record<string, string> = {}
for (const [catKey, def] of Object.entries(CATEGORY_META)) {
  for (const t of def.types) TYPE_TO_CAT[t] = catKey
}

function categoryLabelOf(type: PlaceholderType): string {
  return CATEGORY_META[TYPE_TO_CAT[type] || '']?.label || type
}

// ============================================================
// 过滤管线：搜索 → 分类 → 分页
// ============================================================
const searchFiltered = computed(() => {
  if (!keyword.value.trim()) return items.value
  const kw = keyword.value.toLowerCase()
  return items.value.filter((it) =>
    it.name.toLowerCase().includes(kw)
    || it.preview.toLowerCase().includes(kw)
    || (it.description || '').toLowerCase().includes(kw),
  )
})

const activeCategory = ref<string>('all')

const filtered = computed(() => {
  if (activeCategory.value === 'all') return searchFiltered.value
  const cat = CATEGORY_META[activeCategory.value]
  if (!cat) return searchFiltered.value
  return searchFiltered.value.filter((it) => cat.types.includes(it.type))
})

interface CategoryTab { key: string; label: string; icon?: string; count: number }

const categoryTabs = computed<CategoryTab[]>(() => {
  const counts = new Map<string, number>()
  for (const it of searchFiltered.value) {
    const cat = TYPE_TO_CAT[it.type] || 'async_placeholder'
    counts.set(cat, (counts.get(cat) || 0) + 1)
  }
  const tabs: CategoryTab[] = [
    { key: 'all', label: '全部', icon: 'apps', count: searchFiltered.value.length },
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

const pagedItems = computed(() => {
  const start = (page.value - 1) * PAGE_SIZE
  return filtered.value.slice(start, start + PAGE_SIZE)
})

const visiblePages = computed<number[]>(() => {
  const total = totalPages.value
  const current = page.value
  const maxVisible = 7
  if (total <= maxVisible) return Array.from({ length: total }, (_, i) => i + 1)
  const half = Math.floor(maxVisible / 2)
  let start = Math.max(1, current - half)
  const end = Math.min(total, start + maxVisible - 1)
  if (end - start < maxVisible - 1) start = Math.max(1, end - maxVisible + 1)
  return Array.from({ length: end - start + 1 }, (_, i) => start + i)
})

watch([keyword, activeCategory], () => { page.value = 1 })
watch(totalPages, (n) => { if (page.value > n) page.value = n })

// ============================================================
// 数据加载 & 详情
// ============================================================
async function reload() {
  loading.value = true
  try {
    const resp = await getPlaceholders()
    items.value = resp?.data?.list || []
  } catch { /* toast 已弹 */ }
  finally { loading.value = false }
}

async function viewDetail(it: PlaceholderItem) {
  activeDetail.value = it
  detailOpen.value = true
  detailLoading.value = true
  detailValue.value = ''
  try {
    const resp = await getPlaceholderDetail(it.type, it.name)
    detailValue.value = resp?.data?.value ?? '(无内容)'
  } catch {
    detailValue.value = '加载失败'
  } finally {
    detailLoading.value = false
  }
}

function copyKey(name: string) {
  navigator.clipboard.writeText(name).then(() => {
    ui.showMessage(`已复制 ${name}`, 'success', 1500)
  }).catch(() => ui.showMessage('复制失败', 'error'))
}

onMounted(reload)
</script>

<style lang="scss" scoped>
.ph-content {
  padding: 0 24px 24px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.search {
  padding: 6px 12px;
  border-radius: var(--radius-pill);
  font-size: 13px;
  width: 220px;
}

// ====== 顶部统计栏 ======
.stats-bar {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;

  .stat-badge {
    font-size: 12px;
    background: var(--accent-bg);
    color: var(--secondary-text);
    padding: 4px 12px;
    border-radius: var(--radius-pill);

    &.kw { color: var(--highlight-text); }
  }
}

// ====== 分类 tab ======
.cat-tabs {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--border-color);
}

.cat-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  background: var(--tertiary-bg);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-pill);
  color: var(--secondary-text);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s;

  .material-symbols-outlined { font-size: 15px; }

  .tab-count {
    background: var(--accent-bg);
    padding: 1px 8px;
    border-radius: var(--radius-pill);
    font-size: 10px;
  }

  &:hover {
    border-color: var(--highlight-text);
    color: var(--primary-text);
  }

  &.active {
    background: var(--button-bg);
    border-color: var(--button-bg);
    color: #fff;

    .tab-count {
      background: rgba(255, 255, 255, 0.2);
      color: #fff;
    }
  }
}

// ====== 卡片网格 ======
.card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 10px;
}

.ph-card {
  padding: 12px 14px;
  cursor: pointer;
  transition: transform 0.15s, box-shadow 0.15s;
  display: flex;
  flex-direction: column;
  gap: 6px;

  &:hover {
    transform: translateY(-2px);
    box-shadow: 0 4px 16px rgba(180, 120, 140, 0.1);
  }

  .card-head {
    .key {
      font-size: 12px;
      color: var(--highlight-text);
      font-family: 'JetBrains Mono', Consolas, monospace;
      word-break: break-all;
    }
  }

  .preview {
    margin: 0;
    font-size: 11px;
    color: var(--secondary-text);
    line-height: 1.5;
    max-height: 48px;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
  }

  .desc {
    margin: 0;
    font-size: 10px;
    color: var(--secondary-text);
    opacity: 0.7;
    line-height: 1.4;
    padding-top: 6px;
    border-top: 1px dashed var(--border-color);
  }

  // 底部 footer：左边 type-tag，右边 char-count
  .card-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-top: 4px;
    padding-top: 6px;
    border-top: 1px dashed var(--border-color);
  }

  .type-tag {
    font-size: 9px;
    color: var(--secondary-text);
    background: var(--accent-bg);
    padding: 2px 8px;
    border-radius: var(--radius-pill);
  }

  .char-count {
    font-size: 10px;
    color: var(--secondary-text);
    white-space: nowrap;
    opacity: 0.7;
  }
}

// ====== 分页栏 ======
.pagination {
  display: flex;
  align-items: center;
  gap: 4px;
  justify-content: center;
  padding: 12px 0;
  flex-wrap: wrap;

  .mini {
    padding: 4px 8px;
    min-width: 28px;

    .material-symbols-outlined { font-size: 16px; }
  }

  .page-num {
    min-width: 28px;
    padding: 4px 8px;
    border: 1px solid var(--border-color);
    background: var(--tertiary-bg);
    color: var(--secondary-text);
    border-radius: var(--radius-sm);
    font-size: 12px;
    cursor: pointer;
    transition: all 0.15s;

    &:hover {
      border-color: var(--highlight-text);
      color: var(--primary-text);
    }

    &.active {
      background: var(--button-bg);
      border-color: var(--button-bg);
      color: #fff;
    }
  }

  .page-info {
    margin-left: 10px;
    font-size: 12px;
    color: var(--secondary-text);
  }
}

// ====== 详情 modal ======
.detail-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.detail-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;

  code {
    font-family: 'JetBrains Mono', Consolas, monospace;
    font-size: 13px;
    color: var(--highlight-text);
    background: var(--accent-bg);
    padding: 4px 10px;
    border-radius: var(--radius-sm);
  }

  .btn-sm {
    padding: 4px 10px;
    font-size: 12px;

    .material-symbols-outlined { font-size: 15px; }
  }
}

.detail-value {
  background: var(--tertiary-bg);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  padding: 12px 14px;
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 12px;
  line-height: 1.6;
  color: var(--primary-text);
  max-height: 500px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-word;
  margin: 0;
}
</style>
