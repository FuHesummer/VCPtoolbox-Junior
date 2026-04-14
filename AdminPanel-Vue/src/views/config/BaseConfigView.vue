<template>
  <div class="page base-config">
    <PageHeader title="全局配置" subtitle="config.env — 按字段编辑，自动保留注释" icon="settings">
      <template #actions>
        <input v-model="search" placeholder="搜索字段..." class="search" />
        <button class="btn btn-ghost" :class="{ 'btn-danger': rawMode }" @click="toggleRawMode">
          <span class="material-symbols-outlined">{{ rawMode ? 'view_module' : 'data_object' }}</span>
          {{ rawMode ? '表单模式' : '原文模式' }}
        </button>
        <button class="btn btn-ghost" @click="reload" :disabled="loading"><span class="material-symbols-outlined">refresh</span></button>
        <button class="btn" @click="save" :disabled="!dirty">保存</button>
      </template>
    </PageHeader>

    <p v-if="dirty" class="dirty-banner">⚠️ 有 {{ dirtyCount }} 个字段未保存，保存后重启服务生效</p>

    <!-- 表单模式 -->
    <div v-if="!rawMode" class="content">
      <EmptyState v-if="loading" icon="sync" message="正在加载..." />
      <div v-else-if="!sections.length" class="empty-tip">
        <EmptyState icon="settings_applications" message="配置为空" />
      </div>
      <div v-else class="sections">
        <section v-for="(sec, idx) in sections" :key="idx" class="card section">
          <h3 v-if="sec.title" class="section-title">
            <span class="material-symbols-outlined">{{ sec.icon || 'settings' }}</span>
            {{ sec.title }}
          </h3>
          <div class="fields">
            <EnvField
              v-for="e in sec.entries"
              :key="e.originalIndex + '-' + e.key"
              :entry="itemAt(e.originalIndex)"
              :dirty="dirtyKeys.has(e.key)"
              @update:value="(v) => updateValue(e.originalIndex, v)"
            />
          </div>
        </section>
      </div>
    </div>

    <!-- 原文模式（fallback）-->
    <div v-else class="content">
      <CodeEditor v-model="rawContent" :rows="32" placeholder="KEY=VALUE" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import PageHeader from '@/components/common/PageHeader.vue'
import EmptyState from '@/components/common/EmptyState.vue'
import CodeEditor from '@/components/common/CodeEditor.vue'
import EnvField from '@/components/config/EnvField.vue'
import { getMainConfig, saveMainConfig } from '@/api/config'
import { useUiStore } from '@/stores/ui'
import { parseEnv, buildEnv, type EnvItem, type EnvEntry } from '@/utils/envParser'

const ui = useUiStore()
const items = ref<EnvItem[]>([])
const original = ref<EnvItem[]>([])
const search = ref('')
const loading = ref(false)
const rawMode = ref(false)
const rawContent = ref('')

const dirtyKeys = computed(() => {
  const set = new Set<string>()
  const origMap = new Map<string, string>()
  for (const item of original.value) {
    if (item.kind === 'entry') origMap.set(item.key, item.value)
  }
  for (const item of items.value) {
    if (item.kind === 'entry' && origMap.get(item.key) !== item.value) {
      set.add(item.key)
    }
  }
  return set
})

const dirty = computed(() => {
  if (rawMode.value) return rawContent.value !== buildEnv(original.value)
  return dirtyKeys.value.size > 0
})

const dirtyCount = computed(() => dirtyKeys.value.size)

// 按注释段落分组（连续 entries 聚在一起，遇到注释"段标题"时开新段）
interface Section {
  title: string
  icon?: string
  entries: Array<{ key: string; originalIndex: number }>
}

// 段标题识别：只认规范化的 banner 格式（与 config.env.example 一致）
//   # ============================================================   ← 分隔线
//   # [段标题]                                                         ← 标题
//   # ============================================================   ← 分隔线
// 分隔线规则：# 后跟 3+ 个连续的 = 字符（可两端空格）
const BANNER_REGEX = /^=+$/
function isBannerLine(text: string): boolean {
  return BANNER_REGEX.test(text.trim()) && text.trim().length >= 3
}

const sections = computed<Section[]>(() => {
  const secs: Section[] = []
  let currentTitle = ''
  // banner 状态机：0=等第一条分隔线，1=等标题，2=等第二条分隔线
  let bannerState: 0 | 1 | 2 = 0
  let bannerTitle = ''
  const kw = search.value.trim().toLowerCase()

  items.value.forEach((item, idx) => {
    if (item.kind === 'comment') {
      if (item.blank) {
        // 空行不影响 banner 状态，但重置 bannerState（防止跨段）
        if (bannerState !== 0) bannerState = 0
        return
      }
      if (isBannerLine(item.text)) {
        if (bannerState === 0) { bannerState = 1; bannerTitle = '' }
        else if (bannerState === 2) {
          // 完整 banner 结束：应用 title
          currentTitle = bannerTitle
          bannerState = 0
          bannerTitle = ''
        }
      } else if (bannerState === 1) {
        // 等标题阶段 — 下一条非 banner 注释作为 title
        bannerTitle = item.text
        bannerState = 2
      }
      // 其他情况（普通注释，作为字段 description 的来源）无需处理
      return
    }

    // entry 的过滤
    if (kw && !item.key.toLowerCase().includes(kw) && !item.description.toLowerCase().includes(kw)) return

    if (!secs.length || secs[secs.length - 1].title !== currentTitle) {
      secs.push({ title: currentTitle, entries: [] })
    }
    secs[secs.length - 1].entries.push({ key: item.key, originalIndex: idx })
  })

  return secs.filter((s) => s.entries.length > 0)
})

function itemAt(index: number): EnvEntry {
  return items.value[index] as EnvEntry
}

function updateValue(index: number, value: string) {
  const entry = items.value[index]
  if (entry?.kind === 'entry') {
    entry.value = value
  }
}

async function reload() {
  loading.value = true
  try {
    const data = await getMainConfig()
    const parsed = parseEnv(data.content)
    items.value = parsed
    // deep clone for original baseline
    original.value = parsed.map((x) => ({ ...x }))
    rawContent.value = data.content
  } finally { loading.value = false }
}

async function save() {
  try {
    const content = rawMode.value ? rawContent.value : buildEnv(items.value)
    await saveMainConfig(content)
    const parsed = parseEnv(content)
    items.value = parsed
    original.value = parsed.map((x) => ({ ...x }))
    rawContent.value = content
    ui.showMessage('配置已保存，重启服务生效', 'success')
  } catch { /* toast 已弹 */ }
}

function toggleRawMode() {
  if (rawMode.value) {
    // 从原文模式切回：重新解析原文
    items.value = parseEnv(rawContent.value)
    original.value = items.value.map((x) => ({ ...x }))
    rawMode.value = false
  } else {
    // 切入原文模式：用当前表单构建 env 原文
    rawContent.value = buildEnv(items.value)
    rawMode.value = true
  }
}

// 两种模式来回切换时保持 rawContent 同步
watch(items, () => {
  if (!rawMode.value) rawContent.value = buildEnv(items.value)
}, { deep: true })

onMounted(reload)
</script>

<style lang="scss" scoped>
.base-config { display: flex; flex-direction: column; }

.search {
  padding: 6px 12px;
  border-radius: var(--radius-pill);
  font-size: 13px;
  width: 180px;
}

.dirty-banner {
  margin: 0 24px 12px;
  padding: 8px 14px;
  background: rgba(212, 116, 142, 0.08);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  color: var(--highlight-text);
  font-size: 13px;
}

.content {
  padding: 0 24px 24px;
  flex: 1;
}

.sections {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.section {
  padding: 18px 20px;

  .section-title {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0 0 14px;
    padding-bottom: 10px;
    border-bottom: 1px solid var(--border-color);
    color: var(--highlight-text);
    font-size: 14px;
    letter-spacing: 0.5px;

    .material-symbols-outlined { font-size: 18px; }
  }

  .fields {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
}

.empty-tip { padding: 40px 0; }
</style>
