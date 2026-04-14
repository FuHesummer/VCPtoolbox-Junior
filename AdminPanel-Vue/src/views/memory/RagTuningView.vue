<template>
  <div class="page">
    <PageHeader title="RAG 调参" subtitle="浪潮 V8 算法参数调整 — 权威位置 modules/rag_params.json" icon="tune">
      <template #actions>
        <input v-model="search" placeholder="搜索参数..." class="search" />
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

    <div class="rt-content">
      <div class="status-bar">
        <div class="hint">
          <span class="material-symbols-outlined">info</span>
          <span>热参数保存即生效，无需重启服务</span>
        </div>
        <div v-if="vectordb" class="vectordb-badge" :class="{ ok: vectordb.success, err: !vectordb.success }">
          <span class="material-symbols-outlined">{{ vectordb.success ? 'database' : 'database_off' }}</span>
          VectorDB: {{ vectordb.status }}
        </div>
      </div>

      <!-- 表单模式 -->
      <div v-if="!rawMode">
        <EmptyState v-if="loading && !Object.keys(params).length" icon="tune" message="加载中..." />

        <template v-else-if="filteredSections.length">
          <!-- 模块横向 tab 导航 -->
          <div class="mod-tabs">
            <button
              v-for="sec in filteredSections"
              :key="sec.key"
              class="mod-tab"
              :class="{ active: activeModule === sec.key }"
              @click="activeModule = sec.key"
            >
              <span class="material-symbols-outlined">{{ moduleIcon(sec.key) }}</span>
              {{ sec.key }}
              <span class="mod-tab-count">{{ countLeaves(params[sec.key]) }}</span>
            </button>
          </div>

          <!-- 当前模块内容 -->
          <section v-if="activeSection" class="card mod-section">
            <header class="mod-head">
              <h3>
                <span class="material-symbols-outlined">{{ moduleIcon(activeSection!.key) }}</span>
                {{ activeSection!.key }}
              </h3>
              <span class="mod-count">{{ countLeaves(params[activeSection!.key]) }} 参数</span>
            </header>

            <!-- 顶层字段 -->
            <div v-if="activeSection.leafKeys.length" class="fields">
              <ParamField
                v-for="k in activeSection.leafKeys"
                :key="k"
                :label="k"
                :description="descOf(activeSection!.key, k)"
                :value="(params[activeSection!.key] as Record<string, unknown>)[k]"
                @update="(v) => updateValue([activeSection!.key, k], v)"
              />
            </div>

            <!-- 嵌套子块 -->
            <div v-for="sub in activeSection.subGroups" :key="sub" class="subgroup">
              <div class="sub-head">
                <span class="material-symbols-outlined">subdirectory_arrow_right</span>
                <strong>{{ sub }}</strong>
                <span class="sub-desc" v-if="SUBGROUP_DESC[activeSection!.key + '.' + sub]">
                  {{ SUBGROUP_DESC[activeSection!.key + '.' + sub] }}
                </span>
              </div>
              <div class="fields">
                <ParamField
                  v-for="k in Object.keys((params[activeSection!.key] as Record<string, Record<string, unknown>>)[sub])"
                  :key="k"
                  :label="k"
                  :description="descOf(activeSection!.key, sub, k)"
                  :value="((params[activeSection!.key] as Record<string, Record<string, unknown>>)[sub] as Record<string, unknown>)[k]"
                  @update="(v) => updateValue([activeSection!.key, sub, k], v)"
                />
              </div>
            </div>
          </section>
        </template>

        <EmptyState v-else icon="search_off" message="没有匹配的参数" />
      </div>

      <!-- 原文模式 -->
      <div v-else class="card raw-card">
        <CodeEditor v-model="rawJson" :rows="32" placeholder="{ }" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch, h, defineComponent, type PropType } from 'vue'
import PageHeader from '@/components/common/PageHeader.vue'
import EmptyState from '@/components/common/EmptyState.vue'
import CodeEditor from '@/components/common/CodeEditor.vue'
import { getRagParams, saveRagParams, getVectorDbStatus, type RagParams } from '@/api/rag'
import { useUiStore } from '@/stores/ui'

const ui = useUiStore()
const params = ref<RagParams>({})
const originalJson = ref('')
const rawJson = ref('')
const rawMode = ref(false)
const loading = ref(false)
const search = ref('')
const vectordb = ref<{ success: boolean; status: string } | null>(null)

const dirty = computed(() => {
  if (rawMode.value) return rawJson.value.trim() !== originalJson.value.trim()
  return JSON.stringify(params.value) !== originalJson.value
})

// 按模块分组：识别顶层直接字段 / 嵌套子对象
interface Section {
  key: string
  leafKeys: string[]
  subGroups: string[]
}

const sections = computed<Section[]>(() => {
  const result: Section[] = []
  for (const [modKey, modVal] of Object.entries(params.value)) {
    if (!modVal || typeof modVal !== 'object' || Array.isArray(modVal)) continue
    const leafKeys: string[] = []
    const subGroups: string[] = []
    for (const [k, v] of Object.entries(modVal as Record<string, unknown>)) {
      if (v && typeof v === 'object' && !Array.isArray(v)) subGroups.push(k)
      else leafKeys.push(k)
    }
    result.push({ key: modKey, leafKeys, subGroups })
  }
  return result
})

const activeModule = ref<string>('')

const activeSection = computed<Section | undefined>(() => {
  return filteredSections.value.find((s) => s.key === activeModule.value) || filteredSections.value[0]
})

const filteredSections = computed<Section[]>(() => {
  const kw = search.value.trim().toLowerCase()
  if (!kw) return sections.value
  return sections.value
    .map((s) => ({
      ...s,
      leafKeys: s.leafKeys.filter((k) => k.toLowerCase().includes(kw)),
      subGroups: s.subGroups.filter((sub) => {
        if (sub.toLowerCase().includes(kw)) return true
        const subObj = (params.value[s.key] as Record<string, unknown>)[sub] as Record<string, unknown>
        return Object.keys(subObj || {}).some((k) => k.toLowerCase().includes(kw))
      }),
    }))
    .filter((s) => (s.leafKeys.length + s.subGroups.length) > 0 || s.key.toLowerCase().includes(kw))
})

function moduleIcon(key: string): string {
  const lower = key.toLowerCase()
  if (lower.includes('context') || lower.includes('fold')) return 'layers'
  if (lower.includes('diary')) return 'menu_book'
  if (lower.includes('knowledge')) return 'school'
  if (lower.includes('vector') || lower.includes('vex')) return 'database'
  return 'tune'
}

// ============================================================
// 参数说明字典（按 "模块.子组.字段" 或 "模块.字段" 查找）
// ============================================================
const PARAM_DESC: Record<string, string> = {
  // ContextFoldingV2 — 上下文折叠 V2
  'ContextFoldingV2.thresholdBase': '折叠触发的基础相似度阈值（0~1）',
  'ContextFoldingV2.thresholdRange': '阈值动态浮动区间 [最小, 最大]',
  'ContextFoldingV2.lWeight': '逻辑深度权重系数（参与动态阈值计算）',
  'ContextFoldingV2.sWeight': '相似度权重系数（参与动态阈值计算）',

  // RAGDiaryPlugin — RAG 日记检索
  'RAGDiaryPlugin.noise_penalty': '搜索结果中噪音项的惩罚因子（0~1）',
  'RAGDiaryPlugin.tagWeightRange': '标签权重浮动范围 [最小, 最大]',
  'RAGDiaryPlugin.tagTruncationBase': '标签截断的基准值，超过此值的标签会被保留',
  'RAGDiaryPlugin.tagTruncationRange': '标签截断阈值范围 [最小, 最大]',
  'RAGDiaryPlugin.timeDecay.halfLifeDays': '时间衰减的半衰期（天）— 越大越重视历史记忆',
  'RAGDiaryPlugin.timeDecay.minScore': '时间衰减后的最小分数下界（避免完全淡出）',
  'RAGDiaryPlugin.mainSearchWeights': '主检索权重分配 [用户查询, AI 历史]',
  'RAGDiaryPlugin.refreshWeights': '内存刷新的三段权重（例：新→旧 = 0.5 / 0.35 / 0.15）',
  'RAGDiaryPlugin.metaThinkingWeights': '元思考链权重比例',

  // KnowledgeBaseManager — 知识库总控（浪潮 V8）
  'KnowledgeBaseManager.activationMultiplier': '标签激活系数动态范围 [最小, 最大]',
  'KnowledgeBaseManager.dynamicBoostRange': '动态增强倍数范围 [最小, 最大]',
  'KnowledgeBaseManager.coreBoostRange': '核心标签加权倍数范围 [最小, 最大]',
  'KnowledgeBaseManager.deduplicationThreshold': '语义去重的相似度阈值（越高越容易去重）',
  'KnowledgeBaseManager.techTagThreshold': '技术词汇保留的权重百分比阈值（基于最大权重）',
  'KnowledgeBaseManager.normalTagThreshold': '普通词汇保留的权重百分比阈值（基于最大权重）',

  // KnowledgeBaseManager.geodesicRerank — 测地线重排
  'KnowledgeBaseManager.geodesicRerank.alpha': '测地线与 KNN 混合权重（0 = 纯 KNN，1 = 纯测地线）',
  'KnowledgeBaseManager.geodesicRerank.minGeoSamples': '触发测地线重排的最小标签采样数',

  // KnowledgeBaseManager.spikeRouting — 脉冲路由
  'KnowledgeBaseManager.spikeRouting.maxSafeHops': '脉冲传播的最大跳数限制',
  'KnowledgeBaseManager.spikeRouting.baseMomentum': '脉冲传播的初始动量值',
  'KnowledgeBaseManager.spikeRouting.firingThreshold': '脉冲发火的最小能量阈值',
  'KnowledgeBaseManager.spikeRouting.baseDecay': '常规传播的能量衰减因子',
  'KnowledgeBaseManager.spikeRouting.wormholeDecay': '虫洞通道的能量衰减因子',
  'KnowledgeBaseManager.spikeRouting.tensionThreshold': '判定虫洞的张力临界值',
  'KnowledgeBaseManager.spikeRouting.maxEmergentNodes': '涌现节点的最大数量上限',
  'KnowledgeBaseManager.spikeRouting.maxNeighborsPerNode': '单个节点的最大邻接数',

  // KnowledgeBaseManager.languageCompensator — 语言补偿
  'KnowledgeBaseManager.languageCompensator.penaltyUnknown': '未知语境下英文词汇的惩罚系数',
  'KnowledgeBaseManager.languageCompensator.penaltyCrossDomain': '跨领域英文词汇的惩罚系数',
}

// 子组描述（在嵌套子标题旁展示）
const SUBGROUP_DESC: Record<string, string> = {
  'RAGDiaryPlugin.timeDecay': '时间衰减曲线',
  'KnowledgeBaseManager.geodesicRerank': '测地线重排参数',
  'KnowledgeBaseManager.spikeRouting': '脉冲路由参数（涌现式图检索）',
  'KnowledgeBaseManager.languageCompensator': '中英语言补偿',
}

function descOf(...parts: string[]): string {
  return PARAM_DESC[parts.join('.')] || ''
}

function countLeaves(val: unknown): number {
  if (!val || typeof val !== 'object' || Array.isArray(val)) return 0
  let n = 0
  for (const v of Object.values(val as Record<string, unknown>)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) n += countLeaves(v)
    else n++
  }
  return n
}

function updateValue(path: string[], newValue: unknown) {
  let node: Record<string, unknown> = params.value as Record<string, unknown>
  for (let i = 0; i < path.length - 1; i++) {
    node = node[path[i]] as Record<string, unknown>
  }
  node[path[path.length - 1]] = newValue
  // Vue 深度响应触发（params 是 ref 对象，内部修改要通过赋值触发）
  params.value = { ...params.value }
}

async function reload() {
  loading.value = true
  try {
    const [data, vdb] = await Promise.all([
      getRagParams(),
      getVectorDbStatus().catch(() => null),
    ])
    params.value = (data || {}) as RagParams
    originalJson.value = JSON.stringify(params.value)
    rawJson.value = JSON.stringify(params.value, null, 2)
    vectordb.value = vdb
  } finally { loading.value = false }
}

async function save() {
  try {
    let payload: RagParams
    if (rawMode.value) {
      payload = JSON.parse(rawJson.value) as RagParams
      params.value = payload
    } else {
      payload = params.value
      rawJson.value = JSON.stringify(payload, null, 2)
    }
    await saveRagParams(payload)
    originalJson.value = JSON.stringify(payload)
    ui.showMessage('已保存，热参数已生效', 'success')
  } catch (e) {
    ui.showMessage('保存失败: ' + (e as Error).message, 'error')
  }
}

function toggleRawMode() {
  if (rawMode.value) {
    // 原文 → 表单：解析 JSON
    try {
      params.value = JSON.parse(rawJson.value) as RagParams
      rawMode.value = false
    } catch (e) {
      ui.showMessage('JSON 格式错误: ' + (e as Error).message, 'error')
    }
  } else {
    // 表单 → 原文：序列化
    rawJson.value = JSON.stringify(params.value, null, 2)
    rawMode.value = true
  }
}

// 保持 rawJson 与表单同步（表单修改时）
watch(params, (v) => {
  if (!rawMode.value) rawJson.value = JSON.stringify(v, null, 2)
}, { deep: true })

// 数据加载 / 搜索改变时自动确保 activeModule 有效
watch(filteredSections, (secs) => {
  if (!secs.length) { activeModule.value = ''; return }
  if (!secs.find((s) => s.key === activeModule.value)) {
    activeModule.value = secs[0].key
  }
}, { immediate: true })

onMounted(reload)

// ============================================================
// 内联 ParamField 组件 — 根据值类型自动渲染合适控件
// ============================================================
const ParamField = defineComponent({
  name: 'ParamField',
  props: {
    label: { type: String, required: true },
    description: { type: String, default: '' },
    value: { type: null as unknown as PropType<unknown>, required: true },
  },
  emits: ['update'],
  setup(props, { emit }) {
    const isNumber = computed(() => typeof props.value === 'number')
    const isBoolean = computed(() => typeof props.value === 'boolean')
    const isArrayNum = computed(() => Array.isArray(props.value) && props.value.every((x) => typeof x === 'number'))
    const isRange = computed(() => isArrayNum.value && (props.value as number[]).length === 2)
    const isWeights = computed(() => isArrayNum.value && (props.value as number[]).length !== 2)

    const onNum = (v: string | number) => emit('update', Number(v))
    const onBool = (v: boolean) => emit('update', v)
    const onText = (v: string) => emit('update', v)
    const onRangeItem = (idx: number, v: string) => {
      const arr = [...(props.value as number[])]
      arr[idx] = Number(v)
      emit('update', arr)
    }

    return () => {
      return h('div', { class: 'pf-row' }, [
        h('label', { class: 'pf-label' }, [
          h('code', props.label),
          h('span', { class: 'pf-type' }, typeLabel(props.value)),
        ]),
        props.description
          ? h('p', { class: 'pf-desc' }, props.description)
          : null,
        h('div', { class: 'pf-input' }, [
          isBoolean.value
            ? h('label', { class: 'pf-toggle' }, [
                h('input', {
                  type: 'checkbox',
                  checked: props.value as boolean,
                  onChange: (e: Event) => onBool((e.target as HTMLInputElement).checked),
                }),
                h('span', { class: 'toggle-track' }, [h('span', { class: 'toggle-thumb' })]),
              ])
            : isRange.value
              ? h('div', { class: 'pf-range' }, [
                  h('input', {
                    type: 'number',
                    step: 'any',
                    value: (props.value as number[])[0],
                    onInput: (e: Event) => onRangeItem(0, (e.target as HTMLInputElement).value),
                  }),
                  h('span', { class: 'pf-dash' }, '—'),
                  h('input', {
                    type: 'number',
                    step: 'any',
                    value: (props.value as number[])[1],
                    onInput: (e: Event) => onRangeItem(1, (e.target as HTMLInputElement).value),
                  }),
                ])
              : isWeights.value
                ? h('div', { class: 'pf-weights' },
                    (props.value as number[]).map((v, i) =>
                      h('input', {
                        key: i,
                        type: 'number',
                        step: 'any',
                        value: v,
                        class: 'pf-weight-item',
                        onInput: (e: Event) => onRangeItem(i, (e.target as HTMLInputElement).value),
                      }),
                    ),
                  )
                : isNumber.value
                  ? h('input', {
                      type: 'number',
                      step: 'any',
                      value: props.value as number,
                      onInput: (e: Event) => onNum((e.target as HTMLInputElement).value),
                    })
                  : h('input', {
                      type: 'text',
                      value: String(props.value ?? ''),
                      onInput: (e: Event) => onText((e.target as HTMLInputElement).value),
                    }),
        ]),
      ])
    }
  },
})

function typeLabel(v: unknown): string {
  if (typeof v === 'boolean') return 'boolean'
  if (typeof v === 'number') return 'number'
  if (Array.isArray(v)) {
    if (v.length === 2 && v.every((x) => typeof x === 'number')) return 'range'
    if (v.every((x) => typeof x === 'number')) return `${v.length} 权重`
    return 'array'
  }
  return typeof v
}
</script>

<style lang="scss" scoped>
.rt-content {
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

.status-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.hint {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--secondary-text);

  .material-symbols-outlined { font-size: 15px; color: var(--highlight-text); }
}

.vectordb-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 10px;
  border-radius: var(--radius-pill);
  font-size: 11px;
  border: 1px solid var(--border-color);

  .material-symbols-outlined { font-size: 14px; }

  &.ok { background: rgba(74, 141, 99, 0.1); color: #4a8d63; border-color: rgba(74, 141, 99, 0.3); }
  &.err { background: rgba(192, 86, 86, 0.08); color: var(--danger-color); border-color: rgba(192, 86, 86, 0.3); }
}

.sections { display: flex; flex-direction: column; gap: 16px; }

// ========== 模块 tab 导航 ==========
.mod-tabs {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border-color);
  margin-bottom: 16px;
}

.mod-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 16px;
  background: var(--tertiary-bg);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-pill);
  color: var(--secondary-text);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s;

  .material-symbols-outlined { font-size: 16px; }

  .mod-tab-count {
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

    .mod-tab-count {
      background: rgba(255, 255, 255, 0.2);
      color: #fff;
    }
  }
}

.mod-section { padding: 0; }

.mod-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  border-bottom: 1px solid var(--border-color);

  h3 {
    margin: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
    color: var(--highlight-text);

    .material-symbols-outlined { font-size: 18px; }
  }

  .mod-count {
    font-size: 11px;
    color: var(--secondary-text);
    background: var(--accent-bg);
    padding: 2px 10px;
    border-radius: var(--radius-pill);
  }
}

.fields {
  padding: 16px 18px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.subgroup {
  border-top: 2px solid var(--border-color);
  background: rgba(212, 116, 142, 0.03);
  padding-bottom: 4px;
}

.sub-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 18px 6px;
  font-size: 13px;
  color: var(--highlight-text);

  .material-symbols-outlined { font-size: 16px; opacity: 0.7; }

  strong {
    font-family: 'JetBrains Mono', Consolas, monospace;
    font-weight: 600;
    color: var(--highlight-text);
  }

  .sub-desc {
    margin-left: 6px;
    font-family: inherit;
    font-weight: 400;
    font-size: 11px;
    color: var(--secondary-text);
    opacity: 0.8;

    &::before { content: '— '; }
  }
}

.raw-card { margin: 0; padding: 14px; }

// ========== ParamField 内联样式 ==========
// 列表式卡片 — 左边框粉色 accent + 更大 padding + 清晰边界分离感
:deep(.pf-row) {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(240px, 360px);
  align-items: center;
  gap: 20px;
  padding: 12px 16px;
  background: var(--card-bg);
  border: 1px solid var(--border-color);
  border-left: 3px solid transparent;
  border-radius: var(--radius-md);
  transition: all 0.15s;

  &:hover {
    border-color: var(--highlight-text);
    border-left-color: var(--button-bg);
    background: rgba(212, 116, 142, 0.02);
    box-shadow: 0 2px 8px rgba(180, 120, 140, 0.06);
  }

  @media (max-width: 720px) {
    grid-template-columns: 1fr;
  }
}

:deep(.pf-label) {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
  grid-column: 1;

  code {
    font-size: 13px;
    color: var(--primary-text);
    font-family: 'JetBrains Mono', Consolas, monospace;
    background: transparent;
    padding: 0;
    font-weight: 500;
  }

  .pf-type {
    font-size: 9px;
    color: var(--secondary-text);
    background: var(--accent-bg);
    padding: 2px 8px;
    border-radius: var(--radius-pill);
    text-transform: lowercase;
    letter-spacing: 0.3px;
  }
}

:deep(.pf-desc) {
  grid-column: 1;
  margin: 2px 0 0;
  font-size: 11px;
  color: var(--secondary-text);
  line-height: 1.5;
  opacity: 0.85;
}

:deep(.pf-input) {
  grid-column: 2;
  justify-self: end;
  width: 100%;

  @media (max-width: 720px) {
    grid-column: 1;
    justify-self: stretch;
  }

  input {
    width: 100%;
    padding: 6px 10px;
    font-size: 12px;
    font-family: 'JetBrains Mono', Consolas, monospace;
    text-align: right;
  }
}

:deep(.pf-range) {
  display: flex;
  align-items: center;
  gap: 6px;

  input { flex: 1; }

  .pf-dash {
    color: var(--secondary-text);
    font-size: 12px;
  }
}

:deep(.pf-weights) {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;

  .pf-weight-item {
    flex: 1;
    min-width: 60px;
  }
}

:deep(.pf-toggle) {
  display: inline-flex;
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
}

.spin { animation: spin 1s linear infinite; }

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>
