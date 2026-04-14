<template>
  <div class="page tvs-mgr">
    <PageHeader title="变量编辑器" subtitle="TVStxt 变量文件 — 由 config.env 中转引用注入到 system prompt" icon="data_object">
      <template #actions>
        <input v-model="search" placeholder="搜索文件..." class="search input" />
        <button class="btn" @click="openCreateDialog">
          <span class="material-symbols-outlined">add</span>新建变量
        </button>
        <button class="btn btn-ghost" :disabled="loading" @click="reload">
          <span class="material-symbols-outlined">refresh</span>
        </button>
      </template>
    </PageHeader>

    <!-- 顶部说明 banner -->
    <div class="banner card" :class="{ collapsed: !bannerOpen }">
      <header @click="bannerOpen = !bannerOpen">
        <span class="material-symbols-outlined">info</span>
        <strong>TVS 变量工作机制</strong>
        <span class="spacer" />
        <span class="material-symbols-outlined arrow">{{ bannerOpen ? 'expand_less' : 'expand_more' }}</span>
      </header>
      <div v-if="bannerOpen" class="banner-body">
        <p>
          <strong>三步链路</strong>：
          <code v-text="LB + 'TarXxx' + RB" /> 占位符 →
          读 <code>config.env</code> 里 <code>TarXxx=xxx.txt</code> →
          读 <code>TVStxt/xxx.txt</code> 内容 → 替换
        </p>
        <ul>
          <li><code class="tar" v-text="LB + 'Tar*' + RB" /> — 系统级文本变量（system role 注入）</li>
          <li><code class="var" v-text="LB + 'Var*' + RB" /> — 通用文本变量（system role 注入）</li>
          <li><code class="sar" v-text="LB + 'SarPrompt*' + RB" /> — 模型条件注入（配套 <code>SarModel*</code> 白名单生效）</li>
        </ul>
        <p class="hint-text">
          ⓘ 本编辑器只维护 TVStxt/ 下的文件本身。要让占位符生效，还需要在
          <strong>全局配置</strong> 添加 <code>Key=文件名.txt</code> 这一行。
        </p>
      </div>
    </div>

    <div class="layout">
      <!-- ===== 左侧：文件卡片列表 ===== -->
      <aside class="file-list card">
        <div class="list-header">
          <span class="title">变量文件</span>
          <span class="count">{{ filteredFiles.length }}</span>
        </div>

        <EmptyState v-if="!files.length && !loading" icon="folder_off" message="暂无变量文件" />
        <ul v-else class="cards">
          <li
            v-for="f in filteredFiles"
            :key="f.name"
            class="file-card"
            :class="{ active: selected === f.name }"
            @click="openFile(f.name)"
          >
            <div class="row top">
              <span class="material-symbols-outlined icon">draft</span>
              <strong class="filename">{{ f.name }}</strong>
              <button class="icon-btn danger" title="删除此变量文件" @click.stop="confirmDelete(f.name)">
                <span class="material-symbols-outlined">delete</span>
              </button>
            </div>
            <div class="meta-line">
              <span v-if="f.refs?.length" class="ref-count" :title="`被 ${f.refs.length} 个占位符引用`">
                <span class="material-symbols-outlined">link</span>{{ f.refs.length }}
              </span>
              <span v-else class="ref-count orphan" title="未被任何占位符引用">
                <span class="material-symbols-outlined">link_off</span>0
              </span>
            </div>
          </li>
        </ul>
      </aside>

      <!-- ===== 右侧：编辑器 ===== -->
      <main class="detail">
        <EmptyState v-if="!selected" icon="touch_app" message="选择左侧文件开始编辑" />

        <template v-else>
          <!-- 元数据卡 -->
          <div class="meta-card card">
            <header class="meta-head">
              <span class="material-symbols-outlined">draft</span>
              <strong>{{ selected }}</strong>
              <span class="spacer" />
              <span class="stat" v-if="content">
                <span class="material-symbols-outlined">data_usage</span>
                {{ formatBytes(content.length) }} · {{ content.split('\n').length }} 行
              </span>
              <span v-if="dirty" class="dirty-pill">● 未保存</span>
              <button class="btn compact" :disabled="!dirty" @click="save">
                <span class="material-symbols-outlined">save</span>保存
              </button>
            </header>

            <!-- 引用反查 -->
            <div class="refs-section">
              <span class="refs-label">
                <span class="material-symbols-outlined">link</span>
                被引用的占位符
                <span class="muted">（来自 config.env）</span>
              </span>
              <div v-if="currentRefs.length" class="ref-chips">
                <span
                  v-for="r in currentRefs"
                  :key="r.envKey"
                  class="ref-chip"
                  :class="r.kind"
                  :title="`config.env 中的 ${r.envKey}=${selected}`"
                >
                  <span class="kind-tag">{{ r.kind }}</span>
                  <code v-text="LB + r.envKey + RB" />
                </span>
              </div>
              <div v-else class="no-refs">
                <span class="material-symbols-outlined">info</span>
                此文件未被 config.env 中任何 <code>Key={{ selected }}</code> 引用。
                如需引用，请在
                <RouterLink :to="{ name: 'base-config' }" class="link-inline">全局配置</RouterLink>
                中添加（例如：<code>VarMyText={{ selected }}</code>）
              </div>
            </div>
          </div>

          <!-- 编辑器 -->
          <div class="card editor-card">
            <CodeEditor v-model="content" :rows="24" />
          </div>
        </template>
      </main>
    </div>

    <!-- 新建文件弹窗 -->
    <BaseModal v-model="createOpen" title="新建变量文件" width="480px">
      <div class="create-form">
        <div class="form-row">
          <label>文件名</label>
          <input
            v-model="newName"
            class="input flex"
            placeholder="my_variable（自动补 .txt）"
            @keyup.enter="confirmCreate"
          />
        </div>
        <p class="hint">
          ✦ 创建后会在 <code>TVStxt/</code> 下生成空文件 <code>{{ newNameWithExt || '?.txt' }}</code>
        </p>
        <p v-if="newName && nameExists" class="error-hint">
          ⚠ 文件名已存在
        </p>
      </div>
      <template #footer>
        <button class="btn btn-ghost" @click="createOpen = false">取消</button>
        <button class="btn" :disabled="!createValid" @click="confirmCreate">创建</button>
      </template>
    </BaseModal>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import PageHeader from '@/components/common/PageHeader.vue'
import CodeEditor from '@/components/common/CodeEditor.vue'
import EmptyState from '@/components/common/EmptyState.vue'
import BaseModal from '@/components/common/BaseModal.vue'
import { listTvsFiles, getTvsFile, saveTvsFile, deleteTvsFile } from '@/api/tvs'
import { getMainConfig } from '@/api/config'
import { useUiStore } from '@/stores/ui'
import { useConfirm } from '@/composables/useConfirm'

interface FileRef {
  envKey: string                       // config.env 中的键名（如 TarSystemPrompt）
  kind: 'Tar' | 'Var' | 'Sar' | 'Other'
}
interface FileEntry {
  name: string                         // xxx.txt
  refs: FileRef[]                      // 引用此文件的环境变量
}

const ui = useUiStore()
const { confirm } = useConfirm()

// mustache 字面量常量（避开模板解析器把 }} 当作 mustache 结束符）
const LB = '{{'
const RB = '}}'

// === 状态 ===
const loading = ref(false)
const files = ref<FileEntry[]>([])
const search = ref('')
const selected = ref<string | null>(null)
const content = ref('')
const original = ref('')
const bannerOpen = ref(true)
const envContent = ref('')

// === 新建对话框 ===
const createOpen = ref(false)
const newName = ref('')

// === 派生 ===
const filteredFiles = computed(() => {
  const kw = search.value.trim().toLowerCase()
  if (!kw) return files.value
  return files.value.filter((f) => f.name.toLowerCase().includes(kw))
})

const dirty = computed(() => content.value !== original.value)

const currentRefs = computed<FileRef[]>(() =>
  selected.value ? (files.value.find((f) => f.name === selected.value)?.refs || []) : [],
)

const newNameWithExt = computed(() => {
  const n = newName.value.trim()
  if (!n) return ''
  return /\.txt$/i.test(n) ? n : `${n}.txt`
})
const nameExists = computed(() => files.value.some((f) => f.name === newNameWithExt.value))
const createValid = computed(() => !!newNameWithExt.value && !nameExists.value && /^[\w\u4e00-\u9fa5\-.]+$/.test(newNameWithExt.value))

// === 引用反查 ===
function classifyKind(envKey: string): FileRef['kind'] {
  if (envKey.startsWith('Tar')) return 'Tar'
  if (envKey.startsWith('Var')) return 'Var'
  if (envKey.startsWith('Sar')) return 'Sar'
  return 'Other'
}

function parseEnvRefs(envText: string, fileNames: string[]): Map<string, FileRef[]> {
  // 简单解析 KEY=VALUE 行，找 VALUE === 文件名 的引用
  const map = new Map<string, FileRef[]>()
  for (const fn of fileNames) map.set(fn, [])
  const lines = envText.split('\n')
  for (const raw of lines) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+?)\s*$/)
    if (!m) continue
    const [, key, rawValue] = m
    let value = rawValue.trim()
    // 去除两侧引号
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (!value.toLowerCase().endsWith('.txt')) continue
    if (map.has(value)) {
      map.get(value)!.push({ envKey: key, kind: classifyKind(key) })
    }
  }
  return map
}

// === 加载 ===
async function reload() {
  loading.value = true
  try {
    const [filesResp, envResp] = await Promise.all([
      listTvsFiles(),
      getMainConfig().catch(() => ({ content: '' })),
    ])
    envContent.value = envResp.content || ''
    const fileNames = (filesResp.files || []).slice().sort((a, b) => a.localeCompare(b))
    const refMap = parseEnvRefs(envContent.value, fileNames)
    files.value = fileNames.map((name) => ({ name, refs: refMap.get(name) || [] }))
    if (selected.value && !fileNames.includes(selected.value)) {
      selected.value = null
      content.value = ''
      original.value = ''
    }
  } catch (e) {
    ui.showMessage('加载失败：' + (e as Error).message, 'error')
  } finally { loading.value = false }
}

// === 文件操作 ===
async function openFile(name: string) {
  if (dirty.value) {
    const ok = await confirm('当前文件未保存，确定切换吗？', { danger: true, okText: '切换' })
    if (!ok) return
  }
  selected.value = name
  try {
    const { content: c } = await getTvsFile(name)
    content.value = c
    original.value = c
  } catch (e) {
    const err = e as Error & { status?: number }
    if (err.status === 404) {
      content.value = ''
      original.value = ''
    } else {
      ui.showMessage('打开失败：' + err.message, 'error')
    }
  }
}

async function save() {
  if (!selected.value) return
  try {
    await saveTvsFile(selected.value, content.value)
    original.value = content.value
    ui.showMessage('已保存', 'success')
  } catch (e) {
    ui.showMessage('保存失败：' + (e as Error).message, 'error')
  }
}

async function confirmDelete(name: string) {
  const ok = await confirm(
    `确定删除变量文件 "${name}"？\n如有 config.env 引用此文件，引用会失效。`,
    { danger: true, okText: '删除' },
  )
  if (!ok) return
  try {
    await deleteTvsFile(name)
    ui.showMessage(`已删除 ${name}`, 'success')
    if (selected.value === name) {
      selected.value = null
      content.value = ''
      original.value = ''
    }
    await reload()
  } catch (e) {
    ui.showMessage('删除失败：' + (e as Error).message, 'error')
  }
}

// === 新建 ===
function openCreateDialog() {
  newName.value = ''
  createOpen.value = true
}

async function confirmCreate() {
  if (!createValid.value) return
  const fn = newNameWithExt.value
  try {
    await saveTvsFile(fn, '')
    ui.showMessage(`已创建 ${fn}`, 'success')
    createOpen.value = false
    await reload()
    selected.value = fn
    content.value = ''
    original.value = ''
  } catch (e) {
    ui.showMessage('创建失败：' + (e as Error).message, 'error')
  }
}

// === 工具 ===
function formatBytes(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

onMounted(reload)
</script>

<style lang="scss" scoped>
.search { width: 200px; }

// ===== 顶部说明 banner =====
.banner {
  margin: 0 24px 12px;
  padding: 0;
  overflow: hidden;
  background: var(--input-bg);

  > header {
    display: flex; align-items: center; gap: 6px;
    padding: 10px 16px;
    cursor: pointer; user-select: none;
    font-size: 13px;
    transition: background 0.15s;
    &:hover { background: rgba(212, 116, 142, 0.05); }

    .material-symbols-outlined { font-size: 18px; color: var(--button-bg); }
    strong { color: var(--primary-text); }
    .spacer { flex: 1; }
    .arrow { font-size: 18px; color: var(--secondary-text); }
  }

  .banner-body {
    padding: 0 16px 12px 16px;
    font-size: 12.5px; color: var(--secondary-text); line-height: 1.7;

    p { margin: 4px 0; }
    ul { margin: 6px 0; padding-left: 22px; list-style: none; }
    li { margin: 3px 0; }

    code {
      background: rgba(212, 116, 142, 0.08); padding: 1px 5px;
      border-radius: var(--radius-sm); font-size: 11px;
      color: var(--highlight-text);
      &.tar { background: rgba(88, 201, 143, 0.15); color: #2f8e5f; }
      &.var { background: rgba(100, 150, 240, 0.15); color: #4570c4; }
      &.sar { background: rgba(155, 109, 208, 0.15); color: #7b50b0; }
    }

    .hint-text { color: var(--secondary-text); font-style: italic; padding: 6px 0 0; opacity: 0.85; }
  }
}

// ===== 主布局 =====
.layout {
  display: grid;
  grid-template-columns: 280px 1fr;
  gap: 16px;
  padding: 0 24px 24px;
  min-height: calc(100vh - 240px);
  @media (max-width: 1100px) { grid-template-columns: 1fr; }
}

// ===== 左侧文件列表 =====
.file-list {
  padding: 14px;
  display: flex; flex-direction: column; gap: 10px;
  max-height: calc(100vh - 240px);
  overflow-y: auto;
}

.list-header {
  display: flex; align-items: center; gap: 8px;
  font-size: 12px; color: var(--secondary-text);
  .title { font-weight: 500; }
  .count { background: var(--accent-bg); color: var(--highlight-text); padding: 1px 7px; border-radius: var(--radius-pill); font-size: 11px; }
}

.cards { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 6px; }

.file-card {
  background: var(--tertiary-bg);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  padding: 9px 10px;
  cursor: pointer;
  transition: all 0.15s;
  display: flex; flex-direction: column; gap: 4px;

  &:hover { transform: translateX(2px); box-shadow: 0 2px 8px rgba(180, 120, 140, 0.1); border-color: var(--button-bg); }
  &.active { background: var(--accent-bg); border-color: var(--button-bg); }

  .row.top {
    display: flex; align-items: center; gap: 6px;
    .icon { color: var(--button-bg); font-size: 16px; }
    .filename {
      flex: 1; font-size: 12.5px; color: var(--primary-text);
      font-family: 'JetBrains Mono', monospace;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
  }

  .meta-line {
    display: flex; gap: 6px;
    .ref-count {
      display: inline-flex; align-items: center; gap: 3px;
      padding: 1px 7px; border-radius: var(--radius-pill);
      font-size: 10.5px; font-family: monospace;
      background: var(--accent-bg); color: var(--button-bg); font-weight: 600;
      .material-symbols-outlined { font-size: 12px; }
      &.orphan { background: rgba(0, 0, 0, 0.04); color: var(--secondary-text); font-weight: normal; }
    }
  }
}

.icon-btn {
  background: transparent; border: none; cursor: pointer; padding: 3px;
  color: var(--secondary-text); border-radius: var(--radius-sm);
  display: inline-flex; align-items: center;
  &:hover { background: var(--accent-bg); color: var(--primary-text); }
  &.danger:hover { background: rgba(217, 85, 85, 0.12); color: var(--danger-color); }
  .material-symbols-outlined { font-size: 16px; }
}

// ===== 右侧详情 =====
.detail { display: flex; flex-direction: column; gap: 12px; min-width: 0; }

// 元数据卡
.meta-card { padding: 0; }

.meta-head {
  display: flex; align-items: center; gap: 8px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-color);
  background: linear-gradient(135deg, rgba(212, 116, 142, 0.06), transparent 70%);

  // 只染色头部装饰图标（紧跟 strong 前面那个），避免污染 button/stat 内部的图标
  > .material-symbols-outlined:first-child { color: var(--button-bg); font-size: 18px; }

  strong { font-size: 14px; color: var(--primary-text); font-family: 'JetBrains Mono', monospace; }
  .spacer { flex: 1; }
  .stat { display: inline-flex; align-items: center; gap: 4px; font-size: 11.5px; color: var(--secondary-text); font-family: monospace;
    .material-symbols-outlined { font-size: 14px; }
  }
  .dirty-pill { color: #f1ae28; font-size: 11px; font-weight: 500; }

  // 保存按钮内的图标强制继承按钮文字色（白色）+ 行内 flex 对齐避免基线偏移
  .btn.compact {
    font-size: 12px; padding: 4px 12px;
    display: inline-flex; align-items: center; gap: 4px;
    .material-symbols-outlined { color: inherit; font-size: 14px; line-height: 1; }
  }
}

.refs-section {
  padding: 12px 16px;
  display: flex; flex-direction: column; gap: 8px;

  .refs-label {
    display: flex; align-items: center; gap: 5px;
    font-size: 12px; color: var(--secondary-text);
    .material-symbols-outlined { font-size: 14px; }
    .muted { opacity: 0.7; font-size: 11px; }
  }

  .ref-chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .ref-chip {
    display: inline-flex; align-items: center; gap: 4px;
    padding: 3px 9px;
    border-radius: var(--radius-pill);
    background: var(--tertiary-bg);
    border: 1px solid var(--border-color);
    font-size: 11.5px;

    .kind-tag {
      font-size: 10px; font-weight: 700;
      padding: 0 4px; border-radius: var(--radius-sm);
      letter-spacing: 0.3px;
    }
    code {
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px;
      background: transparent; padding: 0;
      color: var(--primary-text); font-weight: 500;
    }

    &.Tar { border-color: rgba(88, 201, 143, 0.4); .kind-tag { background: rgba(88, 201, 143, 0.18); color: #2f8e5f; } }
    &.Var { border-color: rgba(100, 150, 240, 0.4); .kind-tag { background: rgba(100, 150, 240, 0.18); color: #4570c4; } }
    &.Sar { border-color: rgba(155, 109, 208, 0.4); .kind-tag { background: rgba(155, 109, 208, 0.18); color: #7b50b0; } }
    &.Other { .kind-tag { background: var(--accent-bg); color: var(--secondary-text); } }
  }

  .no-refs {
    display: flex; align-items: center; gap: 5px; flex-wrap: wrap;
    padding: 8px 12px;
    background: rgba(241, 174, 40, 0.08);
    border: 1px dashed rgba(241, 174, 40, 0.3);
    border-radius: var(--radius-sm);
    font-size: 11.5px; color: var(--secondary-text); line-height: 1.7;

    .material-symbols-outlined { font-size: 16px; color: #f1ae28; }
    code {
      background: var(--tertiary-bg); padding: 1px 5px;
      border-radius: var(--radius-sm); font-size: 11px;
      color: var(--highlight-text); font-family: monospace;
    }
    .link-inline { color: var(--button-bg); font-weight: 500; text-decoration: underline; }
  }
}

// ===== 编辑器 =====
.editor-card { padding: 14px; flex: 1; }

// ===== 新建弹窗 =====
.create-form { display: flex; flex-direction: column; gap: 10px; }
.form-row {
  display: flex; align-items: center; gap: 8px; font-size: 13px;
  label { min-width: 60px; color: var(--secondary-text); }
  .input { flex: 1; }
}
.hint { margin: 0; font-size: 12px; color: var(--secondary-text);
  code { background: var(--accent-bg); padding: 1px 5px; border-radius: var(--radius-sm); font-size: 11px; color: var(--highlight-text); }
}
.error-hint { margin: 0; font-size: 12px; color: var(--danger-color); }
</style>
