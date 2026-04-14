<template>
  <div class="page">
    <PageHeader title="思维链编辑" subtitle="VCP 元思考链 — 多条链 + 运行时 Auto 触发 + 自定义权重" icon="psychology">
      <template #actions>
        <button class="btn btn-ghost" :class="{ 'btn-danger': rawMode }" @click="toggleRawMode">
          <span class="material-symbols-outlined">{{ rawMode ? 'view_module' : 'data_object' }}</span>
          {{ rawMode ? '表单模式' : '原文模式' }}
        </button>
        <button class="btn btn-ghost" @click="reload" :disabled="loading">
          <span class="material-symbols-outlined" :class="{ spin: loading }">refresh</span>
        </button>
        <button class="btn" @click="save" :disabled="!dirty">
          保存{{ dirty ? ' *' : '' }}
        </button>
      </template>
    </PageHeader>

    <div class="tc-content">
      <!-- 表单模式 -->
      <div v-if="!rawMode">
        <EmptyState v-if="loading && !chainNames.length" icon="psychology" message="加载中..." />

        <template v-else>
          <!-- 链概览卡片网格 -->
          <section class="overview">
            <header class="ov-head">
              <h3>
                <span class="material-symbols-outlined">account_tree</span>
                思维链总览
                <span class="ov-count">{{ chainNames.length }}</span>
              </h3>
              <p class="ov-hint">
                <span class="material-symbols-outlined">info</span>
                运行时用占位符触发：<code>[[VCP元思考:&lt;链名&gt;::Auto:&lt;权重&gt;::Group]]</code>
              </p>
            </header>

            <div class="chain-grid">
              <div
                v-for="name in chainNames"
                :key="name"
                class="chain-card"
                :class="{ active: activeChain === name, 'is-default': name === 'default' }"
                @click="activeChain = name"
              >
                <div class="cc-badge" :class="{ auto: name !== 'default' }">
                  <span class="material-symbols-outlined">{{ name === 'default' ? 'star' : 'auto_awesome' }}</span>
                  {{ name === 'default' ? '默认' : 'Auto 候选' }}
                </div>
                <button
                  v-if="name !== 'default'"
                  class="cc-delete"
                  title="删除此链"
                  @click.stop="askDeleteChain(name)"
                >
                  <span class="material-symbols-outlined">close</span>
                </button>
                <h4 class="cc-name">{{ name }}</h4>
                <p v-if="chainDesc(name)" class="cc-desc">{{ chainDesc(name) }}</p>
                <p v-else class="cc-desc empty">（无描述）</p>
                <div class="cc-meta">
                  <span>
                    <span class="material-symbols-outlined">route</span>
                    {{ (data.chains[name]?.clusters || []).length }} 步
                  </span>
                  <span class="cc-kseq" v-if="(data.chains[name]?.kSequence || []).length">
                    k = [{{ (data.chains[name]?.kSequence || []).join(',') }}]
                  </span>
                </div>
              </div>

              <button class="chain-card new-card" @click="addChain">
                <span class="material-symbols-outlined">add_circle</span>
                <strong>新建思维链</strong>
                <small>Auto 模式会把链名作为主题向量匹配</small>
              </button>
            </div>
          </section>

          <!-- 当前链详情（分栏：左 info + 右 steps）-->
          <div v-if="activeChain && data.chains[activeChain]" class="chain-detail">
            <!-- 左栏：元信息 + 调用示例 -->
            <aside class="detail-info">
              <section class="card info-card">
                <header class="panel-head">
                  <h3>
                    <span class="material-symbols-outlined">description</span>
                    链信息
                  </h3>
                  <button
                    v-if="activeChain !== 'default' && chainNames.length > 1"
                    class="btn-del-link"
                    @click="askDeleteChain(activeChain)"
                    title="删除此链"
                  >
                    <span class="material-symbols-outlined">delete</span>
                    删除
                  </button>
                  <span v-else-if="activeChain === 'default'" class="default-lock" title="default 链受保护">
                    <span class="material-symbols-outlined">lock</span>
                    受保护
                  </span>
                </header>

                <div class="info-body">
                  <label class="field">
                    <span class="field-label">链名称</span>
                    <input type="text" :value="activeChain" readonly class="readonly-input" />
                    <small class="field-hint">
                      Auto 模式会用此名称作为主题向量参与语义匹配
                      <template v-if="activeChain === 'default'">
                        — <strong>'default' 为保留名，不参与 Auto</strong>
                      </template>
                    </small>
                  </label>

                  <label class="field">
                    <span class="field-label">描述（可选）</span>
                    <textarea
                      v-model="activeDescription"
                      rows="3"
                      placeholder="这条链的用途说明..."
                    />
                  </label>
                </div>
              </section>

              <!-- 调用示例 -->
              <section class="card example-card">
                <header class="panel-head">
                  <h3>
                    <span class="material-symbols-outlined">code_blocks</span>
                    占位符调用
                  </h3>
                </header>
                <div class="example-body">
                  <div class="example-item" v-for="ex in examples" :key="ex.label">
                    <div class="ex-label">{{ ex.label }}</div>
                    <div class="ex-code-row">
                      <code>{{ ex.code }}</code>
                      <button class="copy-btn" @click="copyToClipboard(ex.code)" title="复制">
                        <span class="material-symbols-outlined">content_copy</span>
                      </button>
                    </div>
                    <p class="ex-desc">{{ ex.desc }}</p>
                  </div>
                </div>
              </section>

              <!-- Auto 权重说明 -->
              <section v-if="activeChain !== 'default'" class="card auto-card">
                <header class="panel-head">
                  <h3>
                    <span class="material-symbols-outlined">tune</span>
                    Auto 阈值调节器
                  </h3>
                </header>
                <div class="auto-body">
                  <p class="field-hint">
                    实际阈值在**调用时指定**（<code>Auto:0.xx</code>），此处滑块仅用于生成调用示例
                  </p>
                  <div class="threshold-row">
                    <input
                      type="range"
                      min="0.3"
                      max="0.95"
                      step="0.05"
                      v-model.number="previewThreshold"
                    />
                    <span class="threshold-value">{{ previewThreshold.toFixed(2) }}</span>
                  </div>
                  <p class="threshold-hint">
                    越低越容易触发此链；默认 0.65（代码硬编码）
                  </p>
                </div>
              </section>
            </aside>

            <!-- 右栏：步骤编辑 -->
            <main class="detail-steps">
              <section class="card step-section">
                <header class="panel-head">
                  <h3>
                    <span class="material-symbols-outlined">route</span>
                    推理步骤
                  </h3>
                  <span class="sub-count">{{ currentClusters.length }} 步</span>
                </header>

                <div v-if="currentClusters.length === 0" class="empty-steps">
                  <span class="material-symbols-outlined">add_road</span>
                  <div>
                    <strong>暂无步骤</strong>
                    <p>从下方"可用思维簇"区域点击添加，或拖拽调整顺序</p>
                  </div>
                </div>

                <ul v-else class="step-list">
                  <li
                    v-for="(cluster, idx) in currentClusters"
                    :key="idx + '-' + cluster"
                    draggable="true"
                    class="step-item"
                    :class="{ dragging: dragIndex === idx, 'drop-before': dropHint?.at === idx && dropHint?.where === 'before', 'drop-after': dropHint?.at === idx && dropHint?.where === 'after' }"
                    @dragstart="onDragStart(idx, $event)"
                    @dragover="onDragOver(idx, $event)"
                    @drop="onDrop(idx, $event)"
                    @dragend="onDragEnd"
                  >
                    <span class="material-symbols-outlined handle">drag_indicator</span>
                    <span class="idx">{{ idx + 1 }}</span>
                    <strong class="cluster-name">{{ cluster }}</strong>
                    <label class="k-input">
                      <span class="k-label">k=</span>
                      <input
                        type="number"
                        min="1"
                        max="10"
                        :value="currentKSequence[idx] || 1"
                        @input="updateK(idx, ($event.target as HTMLInputElement).value)"
                      />
                    </label>
                    <button class="step-x" @click="removeStep(idx)" title="移除">
                      <span class="material-symbols-outlined">close</span>
                    </button>
                  </li>
                </ul>
              </section>

              <section class="card avail-section">
                <header class="panel-head">
                  <h3>
                    <span class="material-symbols-outlined">hub</span>
                    可用思维簇
                  </h3>
                  <span class="sub-count">
                    {{ filteredAvailable.length }}<span v-if="clusterSearch">/ {{ availableToAdd.length }}</span> 可加
                  </span>
                </header>

                <div class="cluster-search-bar">
                  <span class="material-symbols-outlined">search</span>
                  <input
                    v-model="clusterSearch"
                    type="text"
                    placeholder="搜索思维簇名..."
                    class="cluster-search-input"
                  />
                  <button
                    v-if="clusterSearch"
                    class="clear-btn"
                    title="清除"
                    @click="clusterSearch = ''"
                  >
                    <span class="material-symbols-outlined">close</span>
                  </button>
                </div>

                <div class="avail-body">
                  <div v-if="availableClusters.length === 0" class="empty-clusters">
                    <span class="material-symbols-outlined">folder_off</span>
                    未发现思维簇目录（<code>thinking/</code> 下以"簇"结尾的子目录）
                  </div>
                  <div v-else class="cluster-chips">
                    <button
                      v-for="c in filteredAvailable"
                      :key="c"
                      type="button"
                      class="chip avail"
                      @click="addStep(c)"
                    >
                      <code v-html="highlightMatch(c, clusterSearch)" />
                      <span class="material-symbols-outlined">add</span>
                    </button>
                    <span v-if="!availableToAdd.length" class="all-added">
                      ✨ 所有可用簇都已加入当前链
                    </span>
                    <span v-else-if="!filteredAvailable.length" class="all-added">
                      🔍 没有匹配 "{{ clusterSearch }}" 的簇
                    </span>
                  </div>
                </div>
              </section>
            </main>
          </div>
        </template>
      </div>

      <!-- 原文模式 -->
      <div v-else class="card raw-card">
        <CodeEditor v-model="rawJson" :rows="32" placeholder="{ }" />
      </div>
    </div>

    <!-- 删除确认对话框 -->
    <BaseModal v-model="deleteOpen" title="删除思维链" width="420px">
      <div class="delete-confirm">
        <div class="delete-icon">
          <span class="material-symbols-outlined">warning</span>
        </div>
        <div class="delete-body">
          <strong>确定删除链 "{{ deleteTarget }}"？</strong>
          <p>此操作会移除链的配置（clusters + kSequence + description），<strong>不可撤销</strong>。</p>
          <p class="delete-preview" v-if="deleteTarget && data.chains[deleteTarget]">
            当前包含：{{ (data.chains[deleteTarget].clusters || []).length }} 个思维簇步骤
          </p>
        </div>
      </div>
      <template #footer>
        <button class="btn btn-ghost" @click="deleteOpen = false">取消</button>
        <button class="btn btn-danger" @click="confirmDeleteChain">
          <span class="material-symbols-outlined">delete</span>
          确认删除
        </button>
      </template>
    </BaseModal>

    <!-- 新建链对话框 -->
    <BaseModal v-model="createOpen" title="新建思维链" width="480px">
      <div class="create-form">
        <div class="create-hint">
          <span class="material-symbols-outlined">lightbulb</span>
          <div>
            <strong>命名建议</strong>
            <p>链名会作为 Auto 模式的主题向量，建议使用**有语义的短词**（如 creative_writing / tech_analysis / reflection），不要使用 "default"（保留名）</p>
          </div>
        </div>

        <label class="create-field">
          <span class="cf-label">链名称 <span class="req">*</span></span>
          <input
            ref="nameInputRef"
            v-model="newChainName"
            type="text"
            placeholder="例如：creative_writing"
            :class="{ invalid: nameError }"
            @keyup.enter="submitCreate"
          />
          <small v-if="nameError" class="cf-error">{{ nameError }}</small>
          <small v-else class="cf-hint">纯英文或拼音，不含空格和特殊字符</small>
        </label>

        <label class="create-field">
          <span class="cf-label">描述（可选）</span>
          <textarea
            v-model="newChainDesc"
            rows="3"
            placeholder="这条链的用途说明，方便以后管理..."
          />
          <small class="cf-hint">保存后仍可在链信息里修改</small>
        </label>
      </div>
      <template #footer>
        <button class="btn btn-ghost" @click="createOpen = false">取消</button>
        <button class="btn" @click="submitCreate" :disabled="!newChainName.trim() || !!nameError">
          <span class="material-symbols-outlined">add</span>
          创建
        </button>
      </template>
    </BaseModal>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import PageHeader from '@/components/common/PageHeader.vue'
import EmptyState from '@/components/common/EmptyState.vue'
import CodeEditor from '@/components/common/CodeEditor.vue'
import BaseModal from '@/components/common/BaseModal.vue'
import { getThinkingChains, saveThinkingChains, getAvailableClusters } from '@/api/rag'
import { useUiStore } from '@/stores/ui'

interface Chain {
  clusters: string[]
  kSequence: number[]
  description?: string          // Junior 扩展字段：链用途说明（后端不解析，仅前端展示）
}

interface ThinkingChainsData {
  chains: Record<string, Chain>
  description?: string
  version?: string
  [k: string]: unknown
}

const ui = useUiStore()
const data = ref<ThinkingChainsData>({ chains: {} })
const originalJson = ref('')
const rawJson = ref('')
const rawMode = ref(false)
const loading = ref(false)
const availableClusters = ref<string[]>([])
const clusterSearch = ref('')
const activeChain = ref<string>('')
const dragIndex = ref<number | null>(null)
const dropHint = ref<{ at: number; where: 'before' | 'after' } | null>(null)
const previewThreshold = ref<number>(0.65)

const chainNames = computed(() => Object.keys(data.value.chains || {}))
const currentClusters = computed(() => data.value.chains[activeChain.value]?.clusters || [])
const currentKSequence = computed(() => data.value.chains[activeChain.value]?.kSequence || [])

const availableToAdd = computed(() => {
  const inChain = new Set(currentClusters.value)
  return availableClusters.value.filter((c) => !inChain.has(c))
})

const filteredAvailable = computed(() => {
  const kw = clusterSearch.value.trim().toLowerCase()
  if (!kw) return availableToAdd.value
  return availableToAdd.value.filter((c) => c.toLowerCase().includes(kw))
})

function highlightMatch(text: string, kw: string): string {
  const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
  if (!kw.trim()) return escapeHtml(text)
  const safeKw = kw.trim().toLowerCase()
  const lower = text.toLowerCase()
  const idx = lower.indexOf(safeKw)
  if (idx < 0) return escapeHtml(text)
  return escapeHtml(text.slice(0, idx)) +
    `<mark>${escapeHtml(text.slice(idx, idx + safeKw.length))}</mark>` +
    escapeHtml(text.slice(idx + safeKw.length))
}

const activeDescription = computed({
  get: () => data.value.chains[activeChain.value]?.description || '',
  set: (v: string) => {
    if (data.value.chains[activeChain.value]) {
      data.value.chains[activeChain.value].description = v
      data.value = { ...data.value }
    }
  },
})

function chainDesc(name: string): string {
  return data.value.chains[name]?.description || ''
}

const dirty = computed(() => {
  if (rawMode.value) return rawJson.value.trim() !== originalJson.value.trim()
  return JSON.stringify(data.value) !== originalJson.value
})

// 调用示例（根据当前链名和阈值动态生成）
const examples = computed(() => {
  const chain = activeChain.value
  const thr = previewThreshold.value.toFixed(2)
  const isDefault = chain === 'default'
  return [
    {
      label: isDefault ? '基础调用（默认链）' : `基础调用（${chain} 链）`,
      code: isDefault ? `[[VCP元思考::Group]]` : `[[VCP元思考:${chain}::Group]]`,
      desc: '在系统提示词里插入此占位符，调用时会直接执行此链',
    },
    {
      label: 'Auto 模式（语义自动匹配）',
      code: `[[VCP元思考::Auto:${thr}::Group]]`,
      desc: `计算 query 与所有非默认链的主题向量相似度，超过 ${thr} 就切到最匹配的链，否则用 default`,
    },
    ...(isDefault ? [] : [{
      label: '不使用 Group 模式',
      code: `[[VCP元思考:${chain}]]`,
      desc: 'useGroup=false，使用独立的 diary 检索',
    }]),
  ]
})

async function reload() {
  loading.value = true
  try {
    const [chainsData, clustersResp] = await Promise.all([
      getThinkingChains(),
      getAvailableClusters().catch(() => ({ clusters: [] as string[] })),
    ])
    data.value = (chainsData as unknown as ThinkingChainsData) || { chains: {} }
    if (!data.value.chains) data.value.chains = {}
    availableClusters.value = clustersResp.clusters || []
    originalJson.value = JSON.stringify(data.value)
    rawJson.value = JSON.stringify(data.value, null, 2)
    if (!activeChain.value || !data.value.chains[activeChain.value]) {
      activeChain.value = chainNames.value[0] || ''
    }
  } finally { loading.value = false }
}

function addStep(cluster: string) {
  const chain = data.value.chains[activeChain.value]
  if (!chain) return
  if (!chain.clusters) chain.clusters = []
  if (!chain.kSequence) chain.kSequence = []
  chain.clusters.push(cluster)
  chain.kSequence.push(1)
  data.value = { ...data.value }
}

function removeStep(idx: number) {
  const chain = data.value.chains[activeChain.value]
  if (!chain) return
  chain.clusters.splice(idx, 1)
  chain.kSequence.splice(idx, 1)
  data.value = { ...data.value }
}

function updateK(idx: number, v: string) {
  const chain = data.value.chains[activeChain.value]
  if (!chain) return
  chain.kSequence[idx] = Math.max(1, Number(v) || 1)
  data.value = { ...data.value }
}

function onDragStart(i: number, e: DragEvent) {
  dragIndex.value = i
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
}

function onDragOver(i: number, e: DragEvent) {
  e.preventDefault()
  if (dragIndex.value === null || dragIndex.value === i) return
  const target = e.currentTarget as HTMLElement
  const rect = target.getBoundingClientRect()
  const mid = rect.top + rect.height / 2
  dropHint.value = { at: i, where: e.clientY < mid ? 'before' : 'after' }
}

function onDragEnd() { dragIndex.value = null; dropHint.value = null }

function onDrop(to: number, e: DragEvent) {
  e.preventDefault()
  if (dragIndex.value === null || dragIndex.value === to) return onDragEnd()
  const chain = data.value.chains[activeChain.value]
  if (!chain) return onDragEnd()
  const clusters = [...chain.clusters]
  const kSeq = [...chain.kSequence]
  const [movedCluster] = clusters.splice(dragIndex.value, 1)
  const [movedK] = kSeq.splice(dragIndex.value, 1)
  let insertAt = to
  if (dropHint.value?.where === 'after') insertAt = to + 1
  if (dragIndex.value < to) insertAt--
  clusters.splice(insertAt, 0, movedCluster)
  kSeq.splice(insertAt, 0, movedK)
  chain.clusters = clusters
  chain.kSequence = kSeq
  data.value = { ...data.value }
  onDragEnd()
}

// ============ 新建链对话框 ============
const createOpen = ref(false)
const newChainName = ref('')
const newChainDesc = ref('')
const nameInputRef = ref<HTMLInputElement | null>(null)

const nameError = computed(() => {
  const name = newChainName.value.trim()
  if (!name) return ''
  if (name === 'default') return '"default" 是保留名，不能使用'
  if (data.value.chains[name]) return `链 "${name}" 已存在`
  if (/\s/.test(name)) return '链名不能包含空格'
  if (!/^[\w\u4e00-\u9fa5-]+$/.test(name)) return '链名只能包含字母、数字、中文、下划线和连字符'
  return ''
})

function addChain() {
  newChainName.value = ''
  newChainDesc.value = ''
  createOpen.value = true
  nextTick(() => {
    nameInputRef.value?.focus()
  })
}

function submitCreate() {
  const name = newChainName.value.trim()
  if (!name || nameError.value) return
  data.value.chains[name] = {
    clusters: [],
    kSequence: [],
    ...(newChainDesc.value.trim() ? { description: newChainDesc.value.trim() } : {}),
  }
  data.value = { ...data.value }
  activeChain.value = name
  createOpen.value = false
}

// 删除确认对话框
const deleteOpen = ref(false)
const deleteTarget = ref<string>('')

function askDeleteChain(name: string) {
  if (name === 'default') {
    ui.showMessage('default 链受保护，不能删除', 'error')
    return
  }
  if (chainNames.value.length <= 1) {
    ui.showMessage('至少保留一条链', 'error')
    return
  }
  deleteTarget.value = name
  deleteOpen.value = true
}

async function confirmDeleteChain() {
  const name = deleteTarget.value
  if (!name || !data.value.chains[name]) {
    deleteOpen.value = false
    return
  }
  delete data.value.chains[name]
  data.value = { ...data.value }
  if (activeChain.value === name) activeChain.value = chainNames.value[0] || ''
  deleteOpen.value = false

  // 破坏性操作立即落盘（用户已确认，不应该留"未保存"中间态）
  try {
    await saveThinkingChains(data.value as unknown as { chains: Record<string, unknown> })
    originalJson.value = JSON.stringify(data.value)
    rawJson.value = JSON.stringify(data.value, null, 2)
    ui.showMessage(`已删除链 "${name}"`, 'success')
  } catch (e) {
    ui.showMessage('本地已移除但保存失败: ' + (e as Error).message, 'error')
  }
}

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text).then(() => {
    ui.showMessage('已复制到剪贴板', 'success', 1500)
  }).catch(() => ui.showMessage('复制失败', 'error'))
}

function toggleRawMode() {
  if (rawMode.value) {
    try {
      data.value = JSON.parse(rawJson.value) as ThinkingChainsData
      if (!data.value.chains) data.value.chains = {}
      rawMode.value = false
    } catch (e) {
      ui.showMessage('JSON 格式错误: ' + (e as Error).message, 'error')
    }
  } else {
    rawJson.value = JSON.stringify(data.value, null, 2)
    rawMode.value = true
  }
}

async function save() {
  try {
    let payload: ThinkingChainsData
    if (rawMode.value) {
      payload = JSON.parse(rawJson.value) as ThinkingChainsData
      data.value = payload
    } else {
      payload = data.value
      rawJson.value = JSON.stringify(payload, null, 2)
    }
    await saveThinkingChains(payload as unknown as { chains: Record<string, unknown> })
    originalJson.value = JSON.stringify(payload)
    ui.showMessage('思维链已保存', 'success')
  } catch (e) {
    ui.showMessage('保存失败: ' + (e as Error).message, 'error')
  }
}

watch(data, (v) => {
  if (!rawMode.value) rawJson.value = JSON.stringify(v, null, 2)
}, { deep: true })

onMounted(reload)
</script>

<style lang="scss" scoped>
.tc-content {
  padding: 0 24px 24px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

// ========== 总览 ==========
.overview {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.ov-head {
  display: flex;
  flex-direction: column;
  gap: 6px;

  h3 {
    margin: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 15px;
    color: var(--primary-text);

    .material-symbols-outlined { font-size: 19px; color: var(--highlight-text); }

    .ov-count {
      background: var(--accent-bg);
      color: var(--highlight-text);
      padding: 2px 10px;
      border-radius: var(--radius-pill);
      font-size: 12px;
    }
  }

  .ov-hint {
    margin: 0;
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--secondary-text);
    padding: 6px 12px;
    background: rgba(212, 116, 142, 0.06);
    border-radius: var(--radius-md);

    .material-symbols-outlined { font-size: 14px; color: var(--highlight-text); }

    code {
      font-family: 'JetBrains Mono', Consolas, monospace;
      background: var(--card-bg);
      padding: 2px 8px;
      border-radius: var(--radius-sm);
      font-size: 11px;
      color: var(--highlight-text);
    }
  }
}

.chain-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 12px;
}

.chain-card {
  position: relative;
  padding: 14px 16px;
  background: var(--card-bg);
  border: 1px solid var(--border-color);
  border-radius: var(--card-radius);
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  flex-direction: column;
  gap: 6px;
  text-align: left;
  min-height: 110px;

  &:hover {
    border-color: var(--highlight-text);
    transform: translateY(-2px);
    box-shadow: 0 4px 16px rgba(180, 120, 140, 0.12);
  }

  &.active {
    border-color: var(--button-bg);
    border-left: 3px solid var(--button-bg);
    background: linear-gradient(135deg, rgba(212, 116, 142, 0.06), transparent 60%);
    box-shadow: 0 4px 20px rgba(212, 116, 142, 0.15);
  }

  &.is-default .cc-badge {
    background: rgba(245, 180, 120, 0.15);
    color: #c08a1f;
  }

  .cc-badge {
    position: absolute;
    top: 10px;
    right: 10px;
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 2px 8px;
    background: rgba(180, 220, 180, 0.12);
    color: #4a8d63;
    border-radius: var(--radius-pill);
    font-size: 10px;
    font-weight: 500;

    .material-symbols-outlined { font-size: 12px; }
  }

  // 卡片左上角的 × 删除按钮（hover 卡片时显现）
  .cc-delete {
    position: absolute;
    top: 8px;
    left: 8px;
    width: 22px;
    height: 22px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 50%;
    color: var(--secondary-text);
    cursor: pointer;
    opacity: 0;
    transition: all 0.15s;
    z-index: 2;

    .material-symbols-outlined { font-size: 14px; }

    &:hover {
      border-color: var(--danger-color);
      color: var(--danger-color);
      background: rgba(192, 86, 86, 0.1);
    }
  }

  &:hover .cc-delete { opacity: 1; }
  &.active .cc-delete { opacity: 0.7; }
  &.active .cc-delete:hover { opacity: 1; }

  .cc-name {
    margin: 0;
    font-size: 15px;
    color: var(--primary-text);
    font-family: 'JetBrains Mono', Consolas, monospace;
    padding-right: 80px;
    word-break: break-all;
  }

  .cc-desc {
    margin: 0;
    font-size: 11px;
    color: var(--secondary-text);
    line-height: 1.5;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    min-height: 32px;

    &.empty { font-style: italic; opacity: 0.5; }
  }

  .cc-meta {
    display: flex;
    gap: 10px;
    font-size: 11px;
    color: var(--secondary-text);
    margin-top: auto;
    padding-top: 6px;
    border-top: 1px dashed var(--border-color);

    span {
      display: inline-flex;
      align-items: center;
      gap: 3px;
    }

    .material-symbols-outlined { font-size: 12px; opacity: 0.7; }

    .cc-kseq {
      font-family: 'JetBrains Mono', Consolas, monospace;
      color: var(--highlight-text);
    }
  }

  &.new-card {
    border-style: dashed;
    background: transparent;
    align-items: center;
    justify-content: center;
    color: var(--highlight-text);
    min-height: 110px;

    .material-symbols-outlined { font-size: 28px; opacity: 0.8; }
    strong { font-size: 13px; }
    small { font-size: 10px; color: var(--secondary-text); text-align: center; line-height: 1.4; }
  }
}

// ========== 详情分栏 ==========
.chain-detail {
  display: grid;
  grid-template-columns: minmax(0, 360px) minmax(0, 1fr);
  gap: 14px;
  align-items: flex-start;

  @media (max-width: 1100px) {
    grid-template-columns: minmax(0, 1fr);
  }
}

.detail-info,
.detail-steps {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

// ========== 通用 panel head ==========
.info-card, .example-card, .auto-card,
.step-section, .avail-section { padding: 0; }

.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-color);

  h3 {
    margin: 0;
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    color: var(--highlight-text);

    .material-symbols-outlined { font-size: 16px; }
  }

  .sub-count {
    font-size: 11px;
    color: var(--secondary-text);
    background: var(--accent-bg);
    padding: 2px 10px;
    border-radius: var(--radius-pill);
  }

  .btn-del-link {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    background: transparent;
    border: none;
    color: var(--secondary-text);
    font-size: 11px;
    cursor: pointer;
    padding: 2px 6px;
    border-radius: var(--radius-sm);

    &:hover { color: var(--danger-color); background: rgba(192, 86, 86, 0.08); }

    .material-symbols-outlined { font-size: 13px; }
  }

  .default-lock {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    font-size: 10px;
    color: #c08a1f;
    background: rgba(245, 180, 120, 0.12);
    padding: 2px 8px;
    border-radius: var(--radius-pill);

    .material-symbols-outlined { font-size: 11px; }
  }
}

// ========== 信息字段 ==========
.info-body {
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;

  .field-label {
    font-size: 11px;
    color: var(--secondary-text);
    font-weight: 500;
  }

  input, textarea {
    padding: 6px 10px;
    font-size: 12px;
  }

  .readonly-input {
    background: var(--tertiary-bg);
    font-family: 'JetBrains Mono', Consolas, monospace;
    color: var(--highlight-text);
  }

  .field-hint {
    font-size: 10px;
    color: var(--secondary-text);
    opacity: 0.8;
    line-height: 1.5;
  }
}

// ========== 调用示例 ==========
.example-body {
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.example-item {
  display: flex;
  flex-direction: column;
  gap: 4px;

  .ex-label {
    font-size: 11px;
    color: var(--highlight-text);
    font-weight: 500;
  }

  .ex-code-row {
    display: flex;
    align-items: stretch;
    gap: 4px;

    code {
      flex: 1;
      background: var(--tertiary-bg);
      border: 1px solid var(--border-color);
      padding: 6px 10px;
      border-radius: var(--radius-sm);
      font-family: 'JetBrains Mono', Consolas, monospace;
      font-size: 11px;
      color: var(--primary-text);
      word-break: break-all;
    }

    .copy-btn {
      background: var(--tertiary-bg);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-sm);
      color: var(--secondary-text);
      cursor: pointer;
      padding: 0 10px;
      display: flex;
      align-items: center;
      transition: all 0.15s;

      &:hover {
        color: var(--highlight-text);
        border-color: var(--highlight-text);
        background: var(--accent-bg);
      }

      .material-symbols-outlined { font-size: 14px; }
    }
  }

  .ex-desc {
    margin: 0;
    font-size: 10px;
    color: var(--secondary-text);
    line-height: 1.5;
    opacity: 0.8;
  }
}

// ========== Auto 阈值 ==========
.auto-body {
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.threshold-row {
  display: flex;
  align-items: center;
  gap: 10px;

  input[type="range"] { flex: 1; }

  .threshold-value {
    min-width: 44px;
    text-align: center;
    padding: 2px 8px;
    background: var(--accent-bg);
    color: var(--highlight-text);
    border-radius: var(--radius-sm);
    font-family: 'JetBrains Mono', Consolas, monospace;
    font-size: 12px;
  }
}

.threshold-hint {
  margin: 0;
  font-size: 10px;
  color: var(--secondary-text);
  opacity: 0.8;
}

// ========== 步骤列表 ==========
.empty-steps {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 30px 20px;
  color: var(--secondary-text);

  > .material-symbols-outlined { font-size: 28px; opacity: 0.4; }

  strong { font-size: 13px; color: var(--primary-text); display: block; margin-bottom: 3px; }
  p { margin: 0; font-size: 11px; line-height: 1.5; }
}

.step-list {
  list-style: none;
  margin: 0;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.step-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  background: var(--tertiary-bg);
  border: 1px solid var(--border-color);
  border-left: 2px solid var(--border-color);
  border-radius: var(--radius-md);
  cursor: grab;
  transition: all 0.15s;

  &:hover {
    border-left-color: var(--highlight-text);
    box-shadow: 0 2px 8px rgba(180, 120, 140, 0.08);
  }

  &:active { cursor: grabbing; }
  &.dragging { opacity: 0.4; }

  &.drop-before::before, &.drop-after::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    height: 3px;
    background: var(--button-bg);
    border-radius: 2px;
    box-shadow: 0 0 8px rgba(212, 116, 142, 0.5);
  }

  &.drop-before::before { top: -5px; }
  &.drop-after::after { bottom: -5px; }

  .handle {
    color: var(--secondary-text);
    font-size: 18px;
    opacity: 0.6;
  }

  &:hover .handle { opacity: 1; }

  .idx {
    flex-shrink: 0;
    font-size: 11px;
    color: var(--highlight-text);
    background: var(--accent-bg);
    padding: 2px 8px;
    border-radius: var(--radius-pill);
    font-family: 'JetBrains Mono', Consolas, monospace;
    font-weight: 600;
    min-width: 28px;
    text-align: center;
  }

  .cluster-name {
    flex: 1;
    font-size: 13px;
    color: var(--primary-text);
  }

  .k-input {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    background: var(--card-bg);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    padding: 3px 6px;

    .k-label {
      font-size: 10px;
      color: var(--secondary-text);
      font-family: 'JetBrains Mono', Consolas, monospace;
    }

    input {
      width: 38px;
      padding: 0 4px;
      text-align: center;
      font-size: 12px;
      font-family: 'JetBrains Mono', Consolas, monospace;
      border: none;
      background: transparent;
    }
  }
}

.step-x {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  background: transparent;
  border: 1px solid var(--border-color);
  border-radius: 50%;
  color: var(--secondary-text);
  cursor: pointer;
  transition: all 0.15s;

  &:hover {
    border-color: var(--danger-color);
    color: var(--danger-color);
    background: rgba(192, 86, 86, 0.08);
  }

  .material-symbols-outlined { font-size: 13px; }
}

// ========== 可用簇 ==========
.avail-body { padding: 14px 16px; }

.empty-clusters {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--secondary-text);
  font-size: 11px;
  padding: 10px 12px;
  background: var(--tertiary-bg);
  border: 1px dashed var(--border-color);
  border-radius: var(--radius-md);

  .material-symbols-outlined { font-size: 16px; opacity: 0.5; }

  code {
    font-family: 'JetBrains Mono', Consolas, monospace;
    background: var(--card-bg);
    padding: 1px 6px;
    border-radius: var(--radius-sm);
    font-size: 10px;
  }
}

// 思维簇搜索栏
.cluster-search-bar {
  display: flex; align-items: center; gap: 6px;
  padding: 6px 12px;
  margin: 0 14px 8px;
  background: var(--accent-bg);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-pill);
  transition: border-color 0.15s;

  &:focus-within { border-color: var(--button-bg); }

  > .material-symbols-outlined { font-size: 16px; color: var(--secondary-text); }

  .cluster-search-input {
    flex: 1;
    background: transparent;
    border: none;
    outline: none;
    font-size: 12.5px;
    color: var(--primary-text);
    padding: 2px 0;
    &::placeholder { color: var(--secondary-text); }
  }

  .clear-btn {
    background: transparent; border: none; cursor: pointer;
    padding: 2px; border-radius: 50%;
    color: var(--secondary-text);
    display: inline-flex; align-items: center;
    &:hover { background: var(--bg-color); color: var(--primary-text); }
    .material-symbols-outlined { font-size: 14px; }
  }
}

.cluster-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;

  // 高亮匹配（v-html mark 标签）
  :deep(mark) {
    background: rgba(255, 200, 80, 0.4);
    color: inherit;
    padding: 0 1px;
    border-radius: 2px;
    font-weight: 600;
  }

  .all-added {
    font-size: 11px;
    color: var(--secondary-text);
    padding: 4px 8px;
  }
}

.chip.avail {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 3px 4px 3px 10px;
  background: var(--tertiary-bg);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-pill);
  font-size: 11px;
  color: var(--primary-text);
  cursor: pointer;
  transition: all 0.15s;

  code {
    font-family: 'JetBrains Mono', Consolas, monospace;
    background: transparent;
    padding: 0;
  }

  .material-symbols-outlined {
    font-size: 12px;
    color: var(--secondary-text);
    background: var(--accent-bg);
    border-radius: 50%;
    padding: 2px;
  }

  &:hover {
    border-color: var(--highlight-text);
    background: var(--accent-bg);

    .material-symbols-outlined { color: var(--highlight-text); background: var(--card-bg); }
  }
}

.raw-card { padding: 14px; }

// ========== 删除确认对话框 ==========
.delete-confirm {
  display: flex;
  gap: 14px;
  align-items: flex-start;
}

.delete-icon {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(192, 86, 86, 0.1);
  color: var(--danger-color);

  .material-symbols-outlined { font-size: 22px; }
}

.delete-body {
  flex: 1;

  strong {
    display: block;
    font-size: 14px;
    color: var(--primary-text);
    margin-bottom: 6px;
  }

  p {
    margin: 0 0 6px;
    font-size: 12px;
    color: var(--secondary-text);
    line-height: 1.6;

    strong { display: inline; color: var(--danger-color); font-size: inherit; margin: 0; }
  }

  .delete-preview {
    padding: 6px 10px;
    background: var(--tertiary-bg);
    border-left: 2px solid var(--border-color);
    font-size: 11px;
    color: var(--secondary-text);
    border-radius: var(--radius-sm);
    margin-top: 8px;
  }
}

// ========== 新建链对话框 ==========
.create-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.create-hint {
  display: flex;
  gap: 10px;
  padding: 12px 14px;
  background: rgba(212, 116, 142, 0.06);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);

  > .material-symbols-outlined {
    font-size: 18px;
    color: var(--highlight-text);
    flex-shrink: 0;
  }

  strong {
    display: block;
    font-size: 12px;
    color: var(--primary-text);
    margin-bottom: 4px;
  }

  p {
    margin: 0;
    font-size: 11px;
    color: var(--secondary-text);
    line-height: 1.6;

    strong { display: inline; color: var(--highlight-text); }
  }
}

.create-field {
  display: flex;
  flex-direction: column;
  gap: 6px;

  .cf-label {
    font-size: 12px;
    color: var(--primary-text);
    font-weight: 500;

    .req { color: var(--danger-color); margin-left: 2px; }
  }

  input, textarea {
    padding: 8px 12px;
    font-size: 13px;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    transition: border-color 0.15s, box-shadow 0.15s;

    &:focus {
      border-color: var(--highlight-text);
      box-shadow: 0 0 0 3px rgba(212, 116, 142, 0.12);
      outline: none;
    }

    &.invalid {
      border-color: var(--danger-color);

      &:focus {
        box-shadow: 0 0 0 3px rgba(192, 86, 86, 0.15);
      }
    }
  }

  input {
    font-family: 'JetBrains Mono', Consolas, monospace;
  }

  .cf-hint {
    font-size: 11px;
    color: var(--secondary-text);
    opacity: 0.8;
  }

  .cf-error {
    font-size: 11px;
    color: var(--danger-color);
    display: inline-flex;
    align-items: center;
    gap: 3px;

    &::before {
      content: '⚠';
      font-size: 11px;
    }
  }
}

.spin { animation: spin 1s linear infinite; }

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>
