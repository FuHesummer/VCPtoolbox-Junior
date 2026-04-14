<template>
  <div class="page">
    <PageHeader title="语义组编辑" subtitle="标签聚类 — 用于 RAG 检索激活相关标签簇" icon="hub">
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

    <div class="sg-content">
      <!-- 表单模式 -->
      <div v-if="!rawMode" class="form-mode">
        <EmptyState v-if="loading && !groupNames.length" icon="hub" message="加载中..." />

        <template v-else>
          <!-- 作用说明横幅 -->
          <div class="intro-banner">
            <span class="material-symbols-outlined">lightbulb</span>
            <div class="intro-body">
              <strong>什么是语义组？</strong>
              <p>
                把一组<strong>主题相关的词汇</strong>聚成一个"组"（如"编程学习": Python / 算法 / 代码 / debug...）。
                RAG 检索时只要命中组内任意一个词，<strong>整组词汇都会被激活</strong>参与召回（按权重加成），
                提升同主题下相关内容的命中率。
              </p>
              <p class="intro-tips">
                <span>💡 组名会作为主题向量参与语义匹配 · 权重越高激活贡献越大 · AI 在对话中自动学习扩展 auto_learned 词</span>
              </p>
            </div>
          </div>

          <!-- 工具条：全局配置按钮 + 统计 -->
          <div class="toolbar">
            <div class="tb-stat">
              <span class="stat-pill">
                <span class="material-symbols-outlined">account_tree</span>
                {{ groupNames.length }} 个语义组
              </span>
              <span v-if="totalWords" class="stat-pill">
                <span class="material-symbols-outlined">label</span>
                {{ totalWords }} 个词
              </span>
              <span v-if="totalAutoLearned" class="stat-pill auto">
                <span class="material-symbols-outlined">psychology</span>
                {{ totalAutoLearned }} 个自学
              </span>
            </div>
            <div class="tb-actions">
              <button class="btn btn-ghost" @click="presetOpen = true" title="载入参考模板">
                <span class="material-symbols-outlined">menu_book</span>
                参考预设
              </button>
              <button class="btn btn-ghost" @click="configOpen = !configOpen" :class="{ active: configOpen }">
                <span class="material-symbols-outlined">{{ configOpen ? 'expand_less' : 'tune' }}</span>
                全局配置
              </button>
            </div>
          </div>

          <!-- 全局配置（可折叠） -->
          <section v-if="configOpen" class="card config-section">
            <div class="config-body">
              <label class="conf-field">
                <span class="cf-label">最小共现次数</span>
                <input type="number" min="1" v-model.number="configCooccur" />
                <small>两个词共同出现达到此值才考虑关联</small>
              </label>
              <label class="conf-field">
                <span class="cf-label">新组最小聚类大小</span>
                <input type="number" min="2" v-model.number="configMinCluster" />
                <small>自动形成新组需要的最少词数</small>
              </label>
              <label class="conf-field toggle">
                <input type="checkbox" v-model="configAutoSave" />
                <span class="toggle-track"><span class="toggle-thumb" /></span>
                <span class="toggle-text">
                  <strong>自动学习后保存</strong>
                  <small>新学到组自动写入 semantic_groups.json</small>
                </span>
              </label>
            </div>
          </section>

          <!-- Master-Detail 布局 -->
          <div class="md-layout">
            <!-- 左：组列表 -->
            <aside class="md-list">
              <div class="list-head">
                <input
                  v-model="listSearch"
                  placeholder="搜索组名..."
                  class="list-search"
                />
                <button class="btn list-new" @click="openCreate" title="新建语义组">
                  <span class="material-symbols-outlined">add</span>
                </button>
              </div>

              <div v-if="filteredGroupNames.length === 0 && groupNames.length === 0" class="list-empty">
                <span class="material-symbols-outlined">inbox</span>
                <div>
                  <strong>还没有语义组</strong>
                  <p>点 + 创建，或等 AI 对话学习</p>
                </div>
              </div>

              <div v-else-if="filteredGroupNames.length === 0" class="list-empty small">
                <span class="material-symbols-outlined">search_off</span>
                无匹配
              </div>

              <ul class="list-items">
                <li
                  v-for="name in filteredGroupNames"
                  :key="name"
                  class="list-item"
                  :class="{ active: activeGroup === name }"
                  :data-group-name="name"
                  @click="activeGroup = name"
                >
                  <span class="li-name">{{ name }}</span>
                  <div class="li-meta">
                    <span class="li-weight">w={{ (data.groups[name]?.weight ?? 1).toFixed(1) }}</span>
                    <span>{{ (data.groups[name]?.words || []).length }} 词</span>
                    <span v-if="(data.groups[name]?.auto_learned || []).length" class="auto">
                      +{{ (data.groups[name]!.auto_learned!.length) }} 自学
                    </span>
                    <span v-if="data.groups[name]?.activation_count" class="act">
                      ⚡{{ data.groups[name]!.activation_count }}
                    </span>
                  </div>
                  <button class="li-delete" @click.stop="askDeleteGroup(name)" title="删除">
                    <span class="material-symbols-outlined">close</span>
                  </button>
                </li>
              </ul>
            </aside>

            <!-- 右：详情 -->
            <main class="md-detail">
              <div v-if="activeGroup && data.groups[activeGroup]" class="detail-body">
                <!-- 组头信息行 -->
                <header class="detail-head card">
                  <div class="dh-left">
                    <h2 class="dh-title">{{ activeGroup }}</h2>
                    <div class="dh-subline">
                      <span class="material-symbols-outlined">scale</span>
                      权重
                      <input
                        type="range"
                        min="0.1"
                        max="3"
                        step="0.1"
                        :value="data.groups[activeGroup]?.weight ?? 1"
                        @input="updateWeight(($event.target as HTMLInputElement).value)"
                      />
                      <span class="dh-weight">{{ (data.groups[activeGroup]?.weight ?? 1).toFixed(1) }}</span>
                    </div>
                  </div>
                  <div v-if="hasRuntimeMeta" class="dh-right">
                    <span class="meta-chip" :title="'vector_id: ' + (data.groups[activeGroup]?.vector_id || '—')">
                      <span class="material-symbols-outlined">hub</span>
                      {{ data.groups[activeGroup]?.vector_id ? 'indexed' : '未索引' }}
                    </span>
                    <span class="meta-chip" v-if="data.groups[activeGroup]?.activation_count">
                      <span class="material-symbols-outlined">bolt</span>
                      激活 {{ data.groups[activeGroup]!.activation_count }} 次
                    </span>
                    <span class="meta-chip" v-if="data.groups[activeGroup]?.last_activated">
                      <span class="material-symbols-outlined">schedule</span>
                      {{ formatTime(data.groups[activeGroup]?.last_activated) }}
                    </span>
                  </div>
                </header>

                <!-- 核心词汇 -->
                <section class="card words-card">
                  <header class="panel-head">
                    <h3>
                      <span class="material-symbols-outlined">label</span>
                      核心词汇
                    </h3>
                    <span class="sub-count">{{ currentWords.length }} 词</span>
                  </header>

                  <div v-if="currentWords.length === 0" class="empty-words">
                    <span class="material-symbols-outlined">tag</span>
                    尚无核心词汇 — 用下方输入框添加
                  </div>

                  <div v-else class="word-chips">
                    <span
                      v-for="(word, idx) in currentWords"
                      :key="idx + '-' + word"
                      class="word-chip"
                    >
                      <code>{{ word }}</code>
                      <button class="chip-x" @click="removeWord(idx)">
                        <span class="material-symbols-outlined">close</span>
                      </button>
                    </span>
                  </div>

                  <div class="word-add-row">
                    <input
                      v-model="newWord"
                      placeholder="输入后回车或逗号添加 — 批量可用逗号/空格分隔"
                      @keydown="onWordKeydown"
                    />
                    <button class="btn" @click="addWord" :disabled="!newWord.trim()">
                      <span class="material-symbols-outlined">add</span>
                    </button>
                  </div>
                </section>

                <!-- 自动学习词（条件显示） -->
                <section v-if="currentAutoLearned.length" class="card auto-card">
                  <header class="panel-head">
                    <h3>
                      <span class="material-symbols-outlined">auto_awesome</span>
                      自动学习到的词
                    </h3>
                    <span class="sub-count auto-count">{{ currentAutoLearned.length }} 词</span>
                  </header>
                  <div class="auto-chips">
                    <span v-for="w in currentAutoLearned" :key="w" class="auto-chip">
                      <span class="material-symbols-outlined">psychology</span>
                      <code>{{ w }}</code>
                      <button class="chip-x" @click="promoteAutoWord(w)" title="提升到核心词汇">
                        <span class="material-symbols-outlined">arrow_upward</span>
                      </button>
                      <button class="chip-x danger" @click="removeAutoWord(w)" title="移除">
                        <span class="material-symbols-outlined">close</span>
                      </button>
                    </span>
                  </div>
                  <p class="auto-note">
                    <span class="material-symbols-outlined">info</span>
                    ↑ 提升到核心，× 移除
                  </p>
                </section>
              </div>

              <div v-else class="md-placeholder">
                <span class="material-symbols-outlined">hub</span>
                <div>
                  <strong>选择一个语义组</strong>
                  <p>从左侧列表选择查看和编辑，或点 + 新建</p>
                </div>
              </div>
            </main>
          </div>
        </template>
      </div>

      <!-- 原文模式 -->
      <div v-else class="card raw-card">
        <CodeEditor v-model="rawJson" :rows="32" placeholder="{ config: {}, groups: {} }" />
      </div>
    </div>

    <!-- 新建组对话框 -->
    <BaseModal v-model="createOpen" title="新建语义组" width="480px">
      <div class="create-form">
        <div class="create-hint">
          <span class="material-symbols-outlined">lightbulb</span>
          <div>
            <strong>语义组作用</strong>
            <p>一组相关词作为标签聚类。RAG 检索时，匹配到一个词会激活整组（按权重加成），用于提升同主题相关结果召回</p>
          </div>
        </div>

        <label class="create-field">
          <span class="cf-label">组名 <span class="req">*</span></span>
          <input
            ref="nameInputRef"
            v-model="newGroupName"
            type="text"
            placeholder="例如：编程学习 / 情感主题 / 角色塔罗会"
            :class="{ invalid: groupNameError }"
            @keyup.enter="submitCreate"
          />
          <small v-if="groupNameError" class="cf-error">{{ groupNameError }}</small>
          <small v-else class="cf-hint">中文、英文、下划线、连字符，描述该组的主题</small>
        </label>

        <label class="create-field">
          <span class="cf-label">初始词汇（可选）</span>
          <textarea
            v-model="newGroupWords"
            rows="3"
            placeholder="逗号或换行分隔&#10;例如：Python, 算法, 数据结构"
          />
          <small class="cf-hint">也可创建后再在组详情里单个添加</small>
        </label>

        <label class="create-field">
          <span class="cf-label">初始权重</span>
          <div class="weight-row">
            <input type="range" min="0.1" max="3" step="0.1" v-model.number="newGroupWeight" />
            <span class="weight-val">{{ newGroupWeight.toFixed(1) }}</span>
          </div>
        </label>
      </div>
      <template #footer>
        <button class="btn btn-ghost" @click="createOpen = false">取消</button>
        <button class="btn" @click="submitCreate" :disabled="!newGroupName.trim() || !!groupNameError">
          <span class="material-symbols-outlined">add</span>
          创建
        </button>
      </template>
    </BaseModal>

    <!-- 参考预设对话框 -->
    <BaseModal v-model="presetOpen" title="语义组参考预设" width="560px">
      <div class="preset-dialog">
        <div class="preset-hint">
          <span class="material-symbols-outlined">info</span>
          <div>
            <strong>这些是示例参考</strong>
            <p>来自上游项目的演示数据，载入后可自由删改。适合小白了解语义组格式和思路 — <strong>不是必须的配置</strong></p>
          </div>
        </div>

        <div class="preset-list">
          <label
            v-for="p in PRESET_GROUPS"
            :key="p.name"
            class="preset-item"
            :class="{ conflict: !!data.groups[p.name] }"
          >
            <input
              type="checkbox"
              :checked="selectedPresets.has(p.name)"
              @change="togglePreset(p.name)"
              :disabled="!!data.groups[p.name]"
            />
            <div class="preset-info">
              <div class="preset-head">
                <strong>{{ p.name }}</strong>
                <span class="preset-meta">
                  <span class="material-symbols-outlined">label</span>
                  {{ p.group.words?.length || 0 }} 词
                  <span class="material-symbols-outlined">scale</span>
                  w={{ p.group.weight }}
                </span>
              </div>
              <p class="preset-note">{{ p.note }}</p>
              <div class="preset-preview">
                <span v-for="w in (p.group.words || []).slice(0, 5)" :key="w" class="preset-word">{{ w }}</span>
                <span v-if="(p.group.words?.length || 0) > 5" class="preset-more">
                  +{{ (p.group.words!.length) - 5 }}
                </span>
              </div>
              <small v-if="data.groups[p.name]" class="preset-conflict">
                <span class="material-symbols-outlined">warning</span>
                组 "{{ p.name }}" 已存在，跳过
              </small>
            </div>
          </label>
        </div>
      </div>
      <template #footer>
        <button class="btn btn-ghost" @click="presetOpen = false">取消</button>
        <button class="btn" @click="loadSelectedPresets" :disabled="selectedPresets.size === 0">
          <span class="material-symbols-outlined">library_add</span>
          载入 {{ selectedPresets.size }} 个参考组
        </button>
      </template>
    </BaseModal>

    <!-- 删除确认 -->
    <BaseModal v-model="deleteOpen" title="删除语义组" width="420px">
      <div class="delete-confirm">
        <div class="delete-icon">
          <span class="material-symbols-outlined">warning</span>
        </div>
        <div class="delete-body">
          <strong>确定删除组 "{{ deleteTarget }}"？</strong>
          <p>会移除组的 words / 权重 / 运行时元数据，<strong>不可撤销</strong>。</p>
          <p class="delete-preview" v-if="deleteTarget && data.groups[deleteTarget]">
            包含 {{ (data.groups[deleteTarget].words || []).length }} 个核心词 +
            {{ (data.groups[deleteTarget].auto_learned || []).length }} 个自学词
          </p>
        </div>
      </div>
      <template #footer>
        <button class="btn btn-ghost" @click="deleteOpen = false">取消</button>
        <button class="btn btn-danger" @click="confirmDeleteGroup">
          <span class="material-symbols-outlined">delete</span>
          确认删除
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
import { getSemanticGroups, saveSemanticGroups } from '@/api/rag'
import { useUiStore } from '@/stores/ui'

interface GroupInfo {
  words?: string[]
  auto_learned?: string[]
  weight?: number
  vector_id?: string | null
  last_activated?: string | number | null
  activation_count?: number
}

interface SemanticData {
  config: {
    min_cooccurrence_to_learn?: number
    min_cluster_size_for_new_group?: number
    auto_save_on_learn?: boolean
    [k: string]: unknown
  }
  groups: Record<string, GroupInfo>
  [k: string]: unknown
}

const ui = useUiStore()
const data = ref<SemanticData>({ config: {}, groups: {} })
const originalJson = ref('')
const rawJson = ref('')
const rawMode = ref(false)
const loading = ref(false)
const activeGroup = ref<string>('')
const newWord = ref('')

const groupNames = computed(() => Object.keys(data.value.groups || {}))
const currentWords = computed(() => data.value.groups?.[activeGroup.value]?.words || [])
const currentAutoLearned = computed(() => data.value.groups?.[activeGroup.value]?.auto_learned || [])

// 全局配置折叠状态
const configOpen = ref(false)

// 左栏列表搜索
const listSearch = ref('')
const filteredGroupNames = computed(() => {
  if (!listSearch.value.trim()) return groupNames.value
  const kw = listSearch.value.toLowerCase()
  return groupNames.value.filter((n) => n.toLowerCase().includes(kw))
})

// 全局统计
const totalWords = computed(() => {
  let n = 0
  for (const g of Object.values(data.value.groups || {})) {
    n += (g.words || []).length
  }
  return n
})
const totalAutoLearned = computed(() => {
  let n = 0
  for (const g of Object.values(data.value.groups || {})) {
    n += (g.auto_learned || []).length
  }
  return n
})

const hasRuntimeMeta = computed(() => {
  const g = data.value.groups?.[activeGroup.value]
  if (!g) return false
  return g.vector_id != null || g.last_activated != null || (g.activation_count != null && g.activation_count > 0)
})

// config 字段双向绑定
const configCooccur = computed({
  get: () => (data.value.config?.min_cooccurrence_to_learn ?? 2),
  set: (v: number) => {
    if (!data.value.config) data.value.config = {}
    data.value.config.min_cooccurrence_to_learn = Math.max(1, Number(v) || 1)
    data.value = { ...data.value }
  },
})
const configMinCluster = computed({
  get: () => (data.value.config?.min_cluster_size_for_new_group ?? 3),
  set: (v: number) => {
    if (!data.value.config) data.value.config = {}
    data.value.config.min_cluster_size_for_new_group = Math.max(2, Number(v) || 2)
    data.value = { ...data.value }
  },
})
const configAutoSave = computed({
  get: () => Boolean(data.value.config?.auto_save_on_learn ?? true),
  set: (v: boolean) => {
    if (!data.value.config) data.value.config = {}
    data.value.config.auto_save_on_learn = v
    data.value = { ...data.value }
  },
})

const dirty = computed(() => {
  if (rawMode.value) return rawJson.value.trim() !== originalJson.value.trim()
  return JSON.stringify(data.value) !== originalJson.value
})

async function reload() {
  loading.value = true
  try {
    const resp = await getSemanticGroups()
    data.value = (resp as unknown as SemanticData) || { config: {}, groups: {} }
    if (!data.value.groups) data.value.groups = {}
    if (!data.value.config) data.value.config = {}
    originalJson.value = JSON.stringify(data.value)
    rawJson.value = JSON.stringify(data.value, null, 2)
    if (!activeGroup.value || !data.value.groups[activeGroup.value]) {
      activeGroup.value = groupNames.value[0] || ''
    }
  } finally { loading.value = false }
}

function updateWeight(v: string) {
  const g = data.value.groups?.[activeGroup.value]
  if (!g) return
  g.weight = Math.max(0.1, Math.min(3, Number(v) || 1))
  data.value = { ...data.value }
}

function addWord() {
  const g = data.value.groups?.[activeGroup.value]
  if (!g || !newWord.value.trim()) return
  if (!g.words) g.words = []
  // 支持逗号/空格批量
  const parts = newWord.value.split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean)
  for (const p of parts) {
    if (!g.words.includes(p)) g.words.push(p)
  }
  newWord.value = ''
  data.value = { ...data.value }
}

// 回车或逗号触发添加（对齐老版本体验）
function onWordKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' || e.key === ',' || e.key === '，') {
    e.preventDefault()
    addWord()
  }
}

function removeWord(idx: number) {
  const g = data.value.groups?.[activeGroup.value]
  if (!g?.words) return
  g.words.splice(idx, 1)
  data.value = { ...data.value }
}

function promoteAutoWord(word: string) {
  const g = data.value.groups?.[activeGroup.value]
  if (!g?.auto_learned) return
  if (!g.words) g.words = []
  if (!g.words.includes(word)) g.words.push(word)
  g.auto_learned = g.auto_learned.filter((w) => w !== word)
  data.value = { ...data.value }
}

function removeAutoWord(word: string) {
  const g = data.value.groups?.[activeGroup.value]
  if (!g?.auto_learned) return
  g.auto_learned = g.auto_learned.filter((w) => w !== word)
  data.value = { ...data.value }
}

function formatTime(ts: string | number | null | undefined): string {
  if (!ts) return '—'
  try {
    const d = new Date(ts)
    return d.toLocaleString('zh-CN', { hour12: false })
  } catch { return String(ts) }
}

// ============ 新建组对话框 ============
const createOpen = ref(false)
const newGroupName = ref('')
const newGroupWords = ref('')
const newGroupWeight = ref(1.0)
const nameInputRef = ref<HTMLInputElement | null>(null)

const groupNameError = computed(() => {
  const name = newGroupName.value.trim()
  if (!name) return ''
  if (data.value.groups?.[name]) return `组 "${name}" 已存在`
  return ''
})

function openCreate() {
  newGroupName.value = ''
  newGroupWords.value = ''
  newGroupWeight.value = 1.0
  createOpen.value = true
  nextTick(() => nameInputRef.value?.focus())
}

function submitCreate() {
  const name = newGroupName.value.trim()
  if (!name || groupNameError.value) return
  if (!data.value.groups) data.value.groups = {}
  const words = newGroupWords.value.split(/[,，\n\s]+/).map((s) => s.trim()).filter(Boolean)
  data.value.groups[name] = {
    words,
    auto_learned: [],
    weight: newGroupWeight.value,
    vector_id: null,
    last_activated: null,
    activation_count: 0,
  }
  data.value = { ...data.value }
  activeGroup.value = name
  createOpen.value = false
  ui.showMessage(`已创建组 "${name}"`, 'success', 1500)
  // 对齐老版本：创建后滚动到新组卡片
  nextTick(() => {
    const el = document.querySelector(`[data-group-name="${name}"]`)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  })
}

// ============ 参考预设 ============
// 来自上游 semantic_groups.json.example，供小白参考格式和思路
const PRESET_GROUPS: Array<{ name: string; note: string; group: GroupInfo }> = [
  {
    name: '编程学习',
    note: '通用技术主题 — 演示"用核心关键词定义一个技术领域"的典型用法',
    group: {
      words: ['Python', '算法', '数据结构', '编程', '代码', 'debug', '函数', 'JavaScript', 'Node.js'],
      auto_learned: [],
      weight: 1.0,
      vector_id: null,
      last_activated: null,
      activation_count: 0,
    },
  },
  {
    name: '克莱恩·莫雷蒂',
    note: '角色/世界观主题 — 演示"把一个虚构角色或故事世界观的标志性词汇聚成组"的玩法',
    group: {
      words: ['愚者', '克莱恩', '世界', '格尔曼', '道恩', '侦探', '塔罗会', '源堡', '灰雾'],
      auto_learned: [],
      weight: 1.2,
      vector_id: null,
      last_activated: null,
      activation_count: 0,
    },
  },
]

const presetOpen = ref(false)
const selectedPresets = ref(new Set<string>())

watch(presetOpen, (v) => {
  // 每次打开时重置选择
  if (v) selectedPresets.value = new Set()
})

function togglePreset(name: string) {
  if (selectedPresets.value.has(name)) selectedPresets.value.delete(name)
  else selectedPresets.value.add(name)
  selectedPresets.value = new Set(selectedPresets.value)  // trigger reactivity
}

function loadSelectedPresets() {
  let count = 0
  for (const preset of PRESET_GROUPS) {
    if (!selectedPresets.value.has(preset.name)) continue
    if (data.value.groups[preset.name]) continue  // 跳过已存在的
    // 深拷贝，避免预设对象被后续编辑污染
    data.value.groups[preset.name] = JSON.parse(JSON.stringify(preset.group))
    count++
  }
  if (count > 0) {
    data.value = { ...data.value }
    ui.showMessage(`已载入 ${count} 个参考组 — 记得点保存`, 'success')
    // 选中第一个载入的组
    const firstLoaded = Array.from(selectedPresets.value).find((n) => data.value.groups[n])
    if (firstLoaded) activeGroup.value = firstLoaded
  }
  presetOpen.value = false
}

// ============ 删除确认 ============
const deleteOpen = ref(false)
const deleteTarget = ref<string>('')

function askDeleteGroup(name: string) {
  deleteTarget.value = name
  deleteOpen.value = true
}

async function confirmDeleteGroup() {
  const name = deleteTarget.value
  if (!name || !data.value.groups?.[name]) {
    deleteOpen.value = false
    return
  }
  delete data.value.groups[name]
  data.value = { ...data.value }
  if (activeGroup.value === name) activeGroup.value = groupNames.value[0] || ''
  deleteOpen.value = false

  // 破坏性操作立即落盘（用户已确认，不应该留"未保存"中间态）
  try {
    await saveSemanticGroups(data.value as unknown as { groups: Record<string, string[]> })
    originalJson.value = JSON.stringify(data.value)
    rawJson.value = JSON.stringify(data.value, null, 2)
    ui.showMessage(`已删除组 "${name}"`, 'success')
  } catch (e) {
    ui.showMessage('本地已移除但保存失败: ' + (e as Error).message, 'error')
  }
}

// ============ 模式切换 + 保存 ============
function toggleRawMode() {
  if (rawMode.value) {
    try {
      data.value = JSON.parse(rawJson.value) as SemanticData
      if (!data.value.groups) data.value.groups = {}
      if (!data.value.config) data.value.config = {}
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
    let payload: SemanticData
    if (rawMode.value) {
      payload = JSON.parse(rawJson.value) as SemanticData
      data.value = payload
    } else {
      payload = data.value
      rawJson.value = JSON.stringify(payload, null, 2)
    }
    await saveSemanticGroups(payload as unknown as { groups: Record<string, string[]> })
    originalJson.value = JSON.stringify(payload)
    ui.showMessage('语义组已保存', 'success')
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
.sg-content {
  padding: 0 24px 24px;
}

.form-mode {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

// ========== 作用说明横幅 ==========
.intro-banner {
  display: flex;
  gap: 12px;
  padding: 14px 18px;
  background: linear-gradient(135deg, rgba(212, 116, 142, 0.08), rgba(212, 116, 142, 0.02));
  border: 1px solid var(--border-color);
  border-left: 3px solid var(--highlight-text);
  border-radius: var(--card-radius);

  > .material-symbols-outlined {
    font-size: 22px;
    color: var(--highlight-text);
    flex-shrink: 0;
    margin-top: 2px;
  }

  .intro-body {
    flex: 1;
    min-width: 0;
  }

  strong {
    display: block;
    font-size: 14px;
    color: var(--primary-text);
    margin-bottom: 6px;
  }

  p {
    margin: 0;
    font-size: 12px;
    color: var(--secondary-text);
    line-height: 1.7;

    strong {
      display: inline;
      margin: 0;
      font-size: inherit;
      color: var(--highlight-text);
    }
  }

  .intro-tips {
    margin-top: 6px;
    padding-top: 6px;
    border-top: 1px dashed var(--border-color);
    font-size: 11px;
    opacity: 0.85;

    span { white-space: nowrap; }
  }
}

// ========== 工具条 ==========
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.tb-stat {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.stat-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  background: var(--tertiary-bg);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-pill);
  font-size: 11px;
  color: var(--secondary-text);

  .material-symbols-outlined { font-size: 13px; opacity: 0.7; }

  &.auto { color: #7a7acf; border-color: rgba(122, 122, 207, 0.3); }
}

.btn.active {
  background: var(--accent-bg);
  color: var(--highlight-text);
  border-color: var(--highlight-text);
}

// ========== 全局 config ==========
.config-section { padding: 0; }

.config-body {
  padding: 14px 18px;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 16px;
}

.conf-field {
  display: flex;
  flex-direction: column;
  gap: 4px;

  .cf-label {
    font-size: 12px;
    color: var(--secondary-text);
    font-weight: 500;
  }

  input[type="number"] {
    padding: 6px 10px;
    font-size: 13px;
    font-family: 'JetBrains Mono', Consolas, monospace;
    max-width: 120px;
  }

  small {
    font-size: 10px;
    color: var(--secondary-text);
    opacity: 0.8;
    line-height: 1.5;
  }

  &.toggle {
    flex-direction: row;
    align-items: center;
    cursor: pointer;

    input { display: none; }

    .toggle-track {
      display: inline-block;
      width: 36px;
      height: 20px;
      background: var(--border-color);
      border-radius: 10px;
      position: relative;
      transition: background 0.2s;
      flex-shrink: 0;
      margin-right: 10px;
    }

    .toggle-thumb {
      position: absolute;
      top: 2px;
      left: 2px;
      width: 16px;
      height: 16px;
      background: #fff;
      border-radius: 50%;
      transition: transform 0.2s;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
    }

    input:checked ~ .toggle-track {
      background: var(--button-bg);
      .toggle-thumb { transform: translateX(16px); }
    }

    .toggle-text {
      display: flex;
      flex-direction: column;
      gap: 2px;

      strong { font-size: 12px; color: var(--primary-text); }
      small { font-size: 10px; }
    }
  }
}

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

  .sub-count,
  .ph-hint {
    font-size: 11px;
    color: var(--secondary-text);
  }

  .sub-count {
    background: var(--accent-bg);
    padding: 2px 10px;
    border-radius: var(--radius-pill);
  }

  .ph-hint { opacity: 0.8; }
}

// ========== Master-Detail 布局 ==========
.md-layout {
  display: grid;
  grid-template-columns: 260px minmax(0, 1fr);
  gap: 14px;
  align-items: flex-start;
  min-height: 500px;

  @media (max-width: 900px) {
    grid-template-columns: 1fr;
  }
}

// 左栏：组列表
.md-list {
  background: var(--card-bg);
  border: 1px solid var(--border-color);
  border-radius: var(--card-radius);
  overflow: hidden;
  position: sticky;
  top: 16px;
  max-height: calc(100vh - 120px);
  display: flex;
  flex-direction: column;

  @media (max-width: 900px) { position: static; max-height: none; }
}

.list-head {
  display: flex;
  gap: 6px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border-color);

  .list-search {
    flex: 1;
    padding: 5px 10px;
    font-size: 12px;
    border-radius: var(--radius-pill);
  }

  .list-new {
    padding: 4px 10px;

    .material-symbols-outlined { font-size: 16px; vertical-align: middle; }
  }
}

.list-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 30px 16px;
  text-align: center;
  color: var(--secondary-text);

  > .material-symbols-outlined { font-size: 28px; opacity: 0.4; }

  strong { font-size: 12px; color: var(--primary-text); display: block; margin-bottom: 2px; }
  p { margin: 0; font-size: 10px; line-height: 1.5; }

  &.small { padding: 14px; font-size: 11px; flex-direction: row; gap: 6px; }
}

.list-items {
  list-style: none;
  margin: 0;
  padding: 6px;
  overflow-y: auto;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.list-item {
  position: relative;
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all 0.12s;
  border-left: 2px solid transparent;

  &:hover {
    background: var(--accent-bg);
    .li-delete { opacity: 1; }
  }

  &.active {
    background: var(--accent-bg);
    border-left-color: var(--button-bg);

    .li-name { color: var(--highlight-text); }
  }

  .li-name {
    display: block;
    font-size: 12px;
    color: var(--primary-text);
    font-weight: 500;
    word-break: break-all;
    padding-right: 22px;  // 让出右上角 delete 按钮空间
    margin-bottom: 3px;
  }

  .li-meta {
    display: flex;
    gap: 8px;
    font-size: 10px;
    color: var(--secondary-text);
    flex-wrap: wrap;

    .li-weight {
      font-family: 'JetBrains Mono', Consolas, monospace;
      color: var(--highlight-text);
    }

    .auto { color: #7a7acf; }
    .act { color: #c08a1f; }
  }

  .li-delete {
    position: absolute;
    top: 6px;
    right: 6px;
    width: 18px;
    height: 18px;
    padding: 0;
    background: transparent;
    border: none;
    border-radius: 50%;
    color: var(--secondary-text);
    cursor: pointer;
    opacity: 0;
    transition: all 0.12s;

    .material-symbols-outlined { font-size: 12px; }

    &:hover { color: var(--danger-color); background: rgba(192, 86, 86, 0.1); }
  }
}

// 右栏：详情
.md-detail { min-width: 0; }

.md-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 14px;
  min-height: 400px;
  padding: 40px;
  background: var(--card-bg);
  border: 1px dashed var(--border-color);
  border-radius: var(--card-radius);
  color: var(--secondary-text);

  > .material-symbols-outlined { font-size: 44px; opacity: 0.3; }

  strong { font-size: 14px; color: var(--primary-text); display: block; margin-bottom: 4px; }
  p { margin: 0; font-size: 12px; line-height: 1.5; }
}

.detail-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

// 详情头
.detail-head {
  padding: 14px 18px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;

  .dh-left {
    display: flex;
    flex-direction: column;
    gap: 8px;
    flex: 1;
    min-width: 0;
  }

  .dh-title {
    margin: 0;
    font-size: 18px;
    color: var(--primary-text);
    font-family: 'JetBrains Mono', Consolas, monospace;
  }

  .dh-subline {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    color: var(--secondary-text);

    > .material-symbols-outlined { font-size: 14px; opacity: 0.6; }

    input[type="range"] {
      flex: 1;
      max-width: 200px;
    }

    .dh-weight {
      min-width: 36px;
      padding: 2px 8px;
      background: var(--accent-bg);
      color: var(--highlight-text);
      border-radius: var(--radius-sm);
      font-family: 'JetBrains Mono', Consolas, monospace;
      font-size: 12px;
      text-align: center;
    }
  }

  .dh-right {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }

  .meta-chip {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 3px 10px;
    background: var(--tertiary-bg);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-pill);
    font-size: 10px;
    color: var(--secondary-text);

    .material-symbols-outlined { font-size: 11px; opacity: 0.7; }
  }
}

.words-card, .auto-card { padding: 0; }

.auto-count { color: #7a7acf; }

.auto-note {
  margin: 0;
  padding: 0 16px 12px;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 10px;
  color: var(--secondary-text);
  line-height: 1.5;

  .material-symbols-outlined { font-size: 12px; opacity: 0.6; }
}

// ========== 词汇区 ==========
.empty-words {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 30px 20px;
  font-size: 12px;
  color: var(--secondary-text);

  .material-symbols-outlined { font-size: 16px; opacity: 0.5; }
}

.word-chips {
  padding: 14px 16px 10px;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.word-chip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 4px 4px 4px 12px;
  background: var(--accent-bg);
  border: 1px solid var(--highlight-text);
  border-radius: var(--radius-pill);
  font-size: 12px;
  color: var(--highlight-text);

  code {
    font-family: 'JetBrains Mono', Consolas, monospace;
    background: transparent;
    padding: 0;
  }
}

.chip-x {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  width: 18px;
  height: 18px;
  padding: 0;
  cursor: pointer;
  color: var(--secondary-text);
  border-radius: 50%;
  transition: all 0.15s;

  &:hover { background: rgba(212, 116, 142, 0.15); color: var(--highlight-text); }

  &.danger:hover { background: rgba(192, 86, 86, 0.1); color: var(--danger-color); }

  .material-symbols-outlined { font-size: 13px; }
}

.word-add-row {
  padding: 10px 16px 16px;
  border-top: 1px dashed var(--border-color);
  display: flex;
  gap: 8px;

  input {
    flex: 1;
    padding: 7px 12px;
    font-size: 12px;
  }

  .btn .material-symbols-outlined { font-size: 15px; vertical-align: middle; }
}

// 自动学习词
.auto-chips {
  padding: 14px 16px 6px;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.auto-chip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 3px 4px 3px 10px;
  background: rgba(180, 180, 240, 0.08);
  border: 1px dashed var(--border-color);
  border-radius: var(--radius-pill);
  font-size: 11px;
  color: var(--secondary-text);

  > .material-symbols-outlined:first-child {
    font-size: 11px;
    color: #7a7acf;
    margin-right: 2px;
  }

  code {
    font-family: 'JetBrains Mono', Consolas, monospace;
    background: transparent;
    padding: 0;
    color: var(--primary-text);
  }
}

.raw-card { padding: 14px; }

// ========== 对话框 ==========
.create-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
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

  strong { display: block; font-size: 12px; color: var(--primary-text); margin-bottom: 4px; }
  p { margin: 0; font-size: 11px; color: var(--secondary-text); line-height: 1.6; }
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
    transition: all 0.15s;

    &:focus {
      border-color: var(--highlight-text);
      box-shadow: 0 0 0 3px rgba(212, 116, 142, 0.12);
      outline: none;
    }

    &.invalid { border-color: var(--danger-color); }
  }

  textarea { font-family: 'JetBrains Mono', Consolas, monospace; font-size: 12px; }

  .cf-hint { font-size: 11px; color: var(--secondary-text); opacity: 0.8; }
  .cf-error {
    font-size: 11px;
    color: var(--danger-color);

    &::before { content: '⚠ '; }
  }
}

// ========== 参考预设对话框 ==========
.preset-dialog {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.preset-hint {
  display: flex;
  gap: 10px;
  padding: 12px 14px;
  background: rgba(212, 116, 142, 0.06);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);

  > .material-symbols-outlined { font-size: 18px; color: var(--highlight-text); flex-shrink: 0; }

  strong { display: block; font-size: 12px; color: var(--primary-text); margin-bottom: 4px; }
  p { margin: 0; font-size: 11px; color: var(--secondary-text); line-height: 1.6;
    strong { display: inline; color: var(--highlight-text); margin: 0; font-size: inherit; }
  }
}

.preset-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 400px;
  overflow-y: auto;
}

.preset-item {
  display: flex;
  gap: 10px;
  padding: 12px 14px;
  background: var(--tertiary-bg);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all 0.15s;

  &:hover:not(.conflict) {
    border-color: var(--highlight-text);
    background: var(--accent-bg);
  }

  &.conflict {
    opacity: 0.55;
    cursor: not-allowed;
  }

  input[type="checkbox"] {
    flex-shrink: 0;
    margin-top: 3px;
  }

  .preset-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .preset-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;

    strong { font-size: 13px; color: var(--primary-text); }

    .preset-meta {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      font-size: 10px;
      color: var(--secondary-text);
      font-family: 'JetBrains Mono', Consolas, monospace;

      .material-symbols-outlined { font-size: 11px; opacity: 0.7; }
    }
  }

  .preset-note {
    margin: 0;
    font-size: 11px;
    color: var(--secondary-text);
    line-height: 1.5;
    opacity: 0.85;
  }

  .preset-preview {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 2px;
  }

  .preset-word {
    font-size: 10px;
    padding: 1px 8px;
    background: var(--card-bg);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-pill);
    color: var(--secondary-text);
    font-family: 'JetBrains Mono', Consolas, monospace;
  }

  .preset-more {
    font-size: 10px;
    color: var(--highlight-text);
    padding: 1px 6px;
    background: rgba(212, 116, 142, 0.1);
    border-radius: var(--radius-pill);
  }

  .preset-conflict {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    margin-top: 4px;
    font-size: 10px;
    color: #c08a1f;

    .material-symbols-outlined { font-size: 11px; }
  }
}

.tb-actions {
  display: flex;
  gap: 6px;
}

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

  strong { display: block; font-size: 14px; color: var(--primary-text); margin-bottom: 6px; }
  p { margin: 0 0 6px; font-size: 12px; color: var(--secondary-text); line-height: 1.6;
    strong { display: inline; color: var(--danger-color); margin: 0; font-size: inherit; }
  }
  .delete-preview {
    padding: 6px 10px;
    background: var(--tertiary-bg);
    border-left: 2px solid var(--border-color);
    font-size: 11px;
    border-radius: var(--radius-sm);
    margin-top: 8px;
  }
}

.spin { animation: spin 1s linear infinite; }

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>
