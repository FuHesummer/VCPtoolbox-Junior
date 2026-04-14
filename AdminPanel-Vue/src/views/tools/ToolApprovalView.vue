<template>
  <div class="page">
    <PageHeader
      title="工具调用审核"
      subtitle="AI 触发的工具调用 → 人工审核放行 / 拒绝"
      icon="verified"
    >
      <template #actions>
        <button class="btn btn-ghost" @click="loadPending" :disabled="pendingLoading">
          <span class="material-symbols-outlined" :class="{ spin: pendingLoading }">refresh</span>
          刷新任务
        </button>
        <button class="btn" @click="save" :disabled="!dirty">保存配置</button>
      </template>
    </PageHeader>

    <div class="ta-layout">
      <!-- ========== 左侧：实时待审批任务 ========== -->
      <div class="ta-main">
        <!-- 状态横幅 -->
        <div class="status-banner" :class="{ active: config.enabled, quiet: !config.enabled }">
          <div class="sb-icon">
            <span class="material-symbols-outlined">
              {{ config.enabled ? 'security' : 'security_update_warning' }}
            </span>
          </div>
          <div class="sb-text">
            <strong>{{ config.enabled ? '审核已启用' : '审核已关闭' }}</strong>
            <span v-if="config.enabled">
              超时 {{ config.timeoutMinutes }}min · {{ config.approveAll ? '黑名单模式' : '白名单模式' }} · {{ (config.approvalList || []).length }} 项规则
            </span>
            <span v-else>所有 AI 工具调用直接放行，不会进入此页面审核</span>
          </div>
          <div v-if="pendingList.length > 0" class="sb-badge">
            {{ pendingList.length }} 待审
          </div>
        </div>

        <!-- 待审批列表 -->
        <section class="card pending-section">
          <header class="panel-head">
            <h3>
              <span class="material-symbols-outlined">pending_actions</span>
              待审批任务
            </h3>
            <span class="poll-hint" :class="{ loading: pendingLoading }">
              <span v-if="pendingLoading" class="material-symbols-outlined spin">progress_activity</span>
              <span v-else>每 3s 自动刷新</span>
            </span>
          </header>

          <div v-if="pendingList.length === 0" class="empty-pending">
            <span class="material-symbols-outlined">coffee</span>
            <div>
              <strong>暂无待审批任务</strong>
              <p>AI 触发工具调用且命中审核规则时会在此显示，可直接批准或拒绝</p>
            </div>
          </div>

          <div v-else class="pending-list">
            <article
              v-for="p in pendingList"
              :key="p.requestId"
              class="pending-item"
              :class="{ resolving: resolving === p.requestId }"
            >
              <div class="pi-head">
                <div class="pi-tool">
                  <span class="material-symbols-outlined">handyman</span>
                  <strong>{{ p.toolName }}</strong>
                </div>
                <div class="pi-meta">
                  <span v-if="p.maid" class="pi-maid">
                    <span class="material-symbols-outlined">person</span>
                    {{ p.maid }}
                  </span>
                  <span class="pi-age">{{ formatAge(p.createdAt) }}</span>
                </div>
              </div>

              <details class="pi-args">
                <summary>
                  <span class="material-symbols-outlined">code</span>
                  参数 ({{ Object.keys(p.args || {}).length }} 项)
                </summary>
                <pre>{{ formatArgs(p.args) }}</pre>
              </details>

              <div class="pi-actions">
                <button
                  class="btn btn-danger"
                  @click="respond(p, false)"
                  :disabled="resolving === p.requestId"
                >
                  <span class="material-symbols-outlined">close</span>
                  拒绝
                </button>
                <button
                  class="btn primary"
                  @click="respond(p, true)"
                  :disabled="resolving === p.requestId"
                >
                  <span class="material-symbols-outlined">check</span>
                  批准
                </button>
              </div>
            </article>
          </div>
        </section>
      </div>

      <!-- ========== 右侧：规则配置（sticky）========== -->
      <aside class="ta-side">
        <section class="card rules-section">
          <header class="panel-head">
            <h3>
              <span class="material-symbols-outlined">rule</span>
              审核规则
            </h3>
            <span v-if="dirty" class="dirty-dot">● 未保存</span>
          </header>

          <!-- 主开关 -->
          <div class="rule-block">
            <div class="rule-switch">
              <div>
                <strong>启用审核</strong>
                <p class="hint">关闭后所有工具调用直接执行</p>
              </div>
              <label class="toggle-row">
                <input type="checkbox" v-model="config.enabled" />
                <span class="toggle-track"><span class="toggle-thumb" /></span>
              </label>
            </div>
          </div>

          <!-- 超时 -->
          <div class="rule-block">
            <label class="block-label">审批超时（分钟）</label>
            <input v-model.number="config.timeoutMinutes" type="number" min="1" max="120" class="timeout-input" />
            <p class="hint">超时未审批的请求按"拒绝"处理</p>
          </div>

          <!-- 模式 segmented -->
          <div class="rule-block">
            <label class="block-label">审核模式</label>
            <div class="mode-segment">
              <button
                type="button"
                class="seg-btn"
                :class="{ active: !config.approveAll }"
                @click="config.approveAll = false"
              >
                <span class="material-symbols-outlined">check_circle</span>
                <div>
                  <strong>白名单</strong>
                  <small>只审核名单内的工具</small>
                </div>
              </button>
              <button
                type="button"
                class="seg-btn"
                :class="{ active: config.approveAll }"
                @click="config.approveAll = true"
              >
                <span class="material-symbols-outlined">block</span>
                <div>
                  <strong>黑名单</strong>
                  <small>默认审核，名单放行</small>
                </div>
              </button>
            </div>
          </div>

          <!-- 名单编辑 -->
          <div class="rule-block list-block">
            <div class="block-head">
              <label class="block-label">
                {{ config.approveAll ? '黑名单（放行的工具）' : '白名单（需审批的工具）' }}
                <span class="label-count">{{ (config.approvalList || []).length }}</span>
              </label>
              <button type="button" class="link-btn" @click="toggleRawMode">
                <span class="material-symbols-outlined">{{ rawMode ? 'view_module' : 'data_object' }}</span>
                {{ rawMode ? '可视化' : '原文' }}
              </button>
            </div>

            <!-- 可视化 -->
            <div v-if="!rawMode" class="list-editor">
              <div v-if="(config.approvalList || []).length === 0 && suggestedTools.length === 0" class="empty-list">
                <span class="material-symbols-outlined">plug_connect</span>
                暂无可用工具 — 先在插件管理启用带工具的插件
              </div>

              <!-- 已选 -->
              <div v-if="(config.approvalList || []).length" class="chip-group">
                <span class="group-label">已选</span>
                <div class="chips">
                  <span v-for="(tool, idx) in config.approvalList" :key="tool + idx" class="chip in">
                    <code>{{ tool }}</code>
                    <button class="chip-x" @click="removeTool(idx)">
                      <span class="material-symbols-outlined">close</span>
                    </button>
                  </span>
                </div>
              </div>

              <!-- 可选 -->
              <div v-if="suggestedTools.length" class="chip-group">
                <span class="group-label">可选</span>
                <div class="chips">
                  <button
                    v-for="t in suggestedTools"
                    :key="t"
                    type="button"
                    class="chip avail"
                    @click="toggleTool(t)"
                  >
                    <code>{{ t }}</code>
                    <span class="material-symbols-outlined">add</span>
                  </button>
                </div>
              </div>

              <!-- 手动添加 -->
              <div class="add-row">
                <input
                  v-model="addInput"
                  placeholder="自定义工具名 / 工具:命令..."
                  @keyup.enter="addTool"
                />
                <button class="btn mini" @click="addTool" :disabled="!addInput.trim()">
                  <span class="material-symbols-outlined">add</span>
                </button>
              </div>
            </div>

            <!-- 原文 -->
            <div v-else class="raw-editor">
              <p class="hint">每行一个工具名或 工具:命令 规则</p>
              <CodeEditor v-model="listText" :rows="10" placeholder="ToolName&#10;ToolName:command" />
            </div>
          </div>
        </section>
      </aside>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import PageHeader from '@/components/common/PageHeader.vue'
import CodeEditor from '@/components/common/CodeEditor.vue'
import {
  getToolApprovalConfig, saveToolApprovalConfig, listPendingApprovals, respondApproval,
  type ToolApprovalConfig, type PendingApprovalItem,
} from '@/api/config'
import { listPlugins } from '@/api/plugins'
import type { PluginInfo } from '@/api/types'
import { useUiStore } from '@/stores/ui'

const ui = useUiStore()
const config = ref<ToolApprovalConfig>({ enabled: false, timeoutMinutes: 10, approveAll: false, approvalList: [] })
const originalJson = ref('')
const rawMode = ref(false)
const addInput = ref('')
const availableTools = ref<string[]>([])

const listText = computed({
  get: () => (config.value.approvalList || []).join('\n'),
  set: (v: string) => { config.value.approvalList = v.split(/\r?\n/).map((s) => s.trim()).filter(Boolean) },
})

const dirty = computed(() => JSON.stringify(config.value) !== originalJson.value)

const suggestedTools = computed(() => {
  const inList = new Set(config.value.approvalList || [])
  return availableTools.value.filter((t) => !inList.has(t))
})

async function reload() {
  const [data, plugins] = await Promise.all([
    getToolApprovalConfig(),
    listPlugins({ suppressErrorToast: true }).catch(() => [] as PluginInfo[]),
  ])
  config.value = { enabled: false, timeoutMinutes: 10, approveAll: false, approvalList: [], ...data }
  originalJson.value = JSON.stringify(config.value)
  const names = new Set<string>()
  for (const p of (plugins as PluginInfo[])) {
    if (!p.enabled) continue
    const caps = (p.manifest as { capabilities?: { invocationCommands?: unknown[] } })?.capabilities
    if (Array.isArray(caps?.invocationCommands) && caps!.invocationCommands!.length > 0) {
      names.add(p.manifest.name)
    }
  }
  availableTools.value = Array.from(names).sort()
}

function addTool() {
  const name = addInput.value.trim()
  if (!name) return
  if (!config.value.approvalList) config.value.approvalList = []
  if (!config.value.approvalList.includes(name)) {
    config.value.approvalList.push(name)
  }
  addInput.value = ''
}

function removeTool(idx: number) {
  config.value.approvalList?.splice(idx, 1)
}

function toggleTool(name: string) {
  if (!config.value.approvalList) config.value.approvalList = []
  const idx = config.value.approvalList.indexOf(name)
  if (idx >= 0) config.value.approvalList.splice(idx, 1)
  else config.value.approvalList.push(name)
}

function toggleRawMode() {
  rawMode.value = !rawMode.value
}

async function save() {
  try {
    await saveToolApprovalConfig(config.value)
    originalJson.value = JSON.stringify(config.value)
    ui.showMessage('已保存', 'success')
  } catch { /* toast 已弹 */ }
}

// ============ 待审批任务轮询 ============
const pendingList = ref<PendingApprovalItem[]>([])
const pendingLoading = ref(false)
const resolving = ref<string>('')
let pendingTimer: number | null = null

async function loadPending() {
  pendingLoading.value = true
  try {
    const data = await listPendingApprovals({ showLoader: false, suppressErrorToast: true })
    pendingList.value = data.pending || []
  } catch { /* silent */ }
  finally { pendingLoading.value = false }
}

async function respond(item: PendingApprovalItem, approved: boolean) {
  resolving.value = item.requestId
  try {
    await respondApproval(item.requestId, approved)
    ui.showMessage(`已${approved ? '批准' : '拒绝'} ${item.toolName}`, approved ? 'success' : 'info')
    pendingList.value = pendingList.value.filter((p) => p.requestId !== item.requestId)
  } catch { /* toast 已弹 */ }
  finally { resolving.value = '' }
}

function formatAge(ts: number | null): string {
  if (!ts) return ''
  const elapsed = Math.floor((Date.now() - ts) / 1000)
  if (elapsed < 60) return `${elapsed}s 前`
  if (elapsed < 3600) return `${Math.floor(elapsed / 60)}min 前`
  return `${Math.floor(elapsed / 3600)}h 前`
}

function formatArgs(args: Record<string, unknown>): string {
  try { return JSON.stringify(args, null, 2) } catch { return String(args) }
}

onMounted(async () => {
  await reload()
  await loadPending()
  pendingTimer = window.setInterval(loadPending, 3000)
})

onBeforeUnmount(() => {
  if (pendingTimer) { clearInterval(pendingTimer); pendingTimer = null }
})
</script>

<style lang="scss" scoped>
// ========== 双栏布局 ==========
.ta-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 360px;
  gap: 16px;
  padding: 0 24px 24px;
  align-items: flex-start;

  @media (max-width: 1100px) {
    grid-template-columns: minmax(0, 1fr);
  }
}

.ta-main { display: flex; flex-direction: column; gap: 14px; min-width: 0; }

.ta-side {
  position: sticky;
  top: 16px;

  @media (max-width: 1100px) { position: static; }
}

// ========== 状态横幅 ==========
.status-banner {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 18px;
  border-radius: var(--card-radius);
  background: var(--card-bg);
  border: 1px solid var(--border-color);
  box-shadow: var(--card-shadow);

  &.active {
    border-left: 3px solid var(--button-bg);
    background: linear-gradient(90deg, rgba(212, 116, 142, 0.06), transparent 50%);
  }

  &.quiet {
    opacity: 0.75;
    border-left: 3px solid var(--border-color);
  }

  .sb-icon {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--accent-bg);
    color: var(--highlight-text);
    flex-shrink: 0;

    .material-symbols-outlined { font-size: 22px; }
  }

  .sb-text {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;

    strong { font-size: 14px; color: var(--primary-text); }
    span { font-size: 12px; color: var(--secondary-text); }
  }

  .sb-badge {
    padding: 6px 14px;
    background: var(--button-bg);
    color: #fff;
    border-radius: var(--radius-pill);
    font-size: 12px;
    font-weight: 500;
    animation: pulse 1.8s ease-in-out infinite;
  }
}

@keyframes pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(212, 116, 142, 0.4); }
  50% { box-shadow: 0 0 0 8px rgba(212, 116, 142, 0); }
}

// ========== 通用 panel header ==========
.panel-head {
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
}

.poll-hint {
  font-size: 10px;
  color: var(--secondary-text);
  opacity: 0.6;
  display: inline-flex;
  align-items: center;
  gap: 4px;

  &.loading { opacity: 1; color: var(--highlight-text); }

  .material-symbols-outlined { font-size: 12px; }

  .spin { animation: spin 1s linear infinite; }
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.dirty-dot {
  font-size: 11px;
  color: var(--highlight-text);
}

// ========== 待审批列表 ==========
.pending-section { padding: 0; }

.empty-pending {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 40px 20px;
  color: var(--secondary-text);

  .material-symbols-outlined {
    font-size: 36px;
    opacity: 0.4;
  }

  strong { font-size: 13px; color: var(--primary-text); display: block; margin-bottom: 4px; }
  p { margin: 0; font-size: 11px; line-height: 1.5; }
}

.pending-list {
  padding: 14px 18px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.pending-item {
  padding: 14px 16px;
  background: var(--tertiary-bg);
  border: 1px solid var(--border-color);
  border-left: 3px solid var(--highlight-text);
  border-radius: var(--radius-md);
  display: flex;
  flex-direction: column;
  gap: 10px;
  transition: opacity 0.2s;

  &.resolving { opacity: 0.5; }
}

.pi-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.pi-tool {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--highlight-text);
  font-size: 14px;

  .material-symbols-outlined { font-size: 16px; }
}

.pi-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 11px;
  color: var(--secondary-text);
}

.pi-maid {
  display: inline-flex;
  align-items: center;
  gap: 3px;

  .material-symbols-outlined { font-size: 13px; }
}

.pi-age { white-space: nowrap; font-family: 'JetBrains Mono', Consolas, monospace; }

.pi-args {
  font-size: 11px;

  summary {
    cursor: pointer;
    padding: 4px 0;
    user-select: none;
    color: var(--secondary-text);
    display: flex;
    align-items: center;
    gap: 4px;

    &:hover { color: var(--primary-text); }

    .material-symbols-outlined { font-size: 14px; }
  }

  pre {
    margin: 6px 0 0;
    padding: 8px 10px;
    background: var(--card-bg);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    font-family: 'JetBrains Mono', Consolas, monospace;
    font-size: 11px;
    line-height: 1.5;
    max-height: 200px;
    overflow-y: auto;
    white-space: pre-wrap;
    word-break: break-word;
    color: var(--primary-text);
  }
}

.pi-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;

  .btn .material-symbols-outlined { font-size: 15px; vertical-align: middle; }

  .btn.primary { background: var(--button-bg); color: #fff; border-color: var(--button-bg); }
}

// ========== 右侧规则配置 ==========
.rules-section { padding: 0; }

.rule-block {
  padding: 14px 18px;

  & + & { border-top: 1px solid var(--border-color); }
}

.block-label {
  font-size: 12px;
  color: var(--secondary-text);
  font-weight: 500;
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;

  .label-count {
    background: var(--accent-bg);
    color: var(--highlight-text);
    padding: 1px 8px;
    border-radius: var(--radius-pill);
    font-size: 10px;
  }
}

.block-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.hint {
  font-size: 11px;
  color: var(--secondary-text);
  margin: 4px 0 0;
  opacity: 0.75;
}

.rule-switch {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;

  strong { font-size: 13px; color: var(--primary-text); }
}

// Toggle
.toggle-row {
  display: inline-flex;
  cursor: pointer;
  flex-shrink: 0;

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

.timeout-input {
  width: 100%;
  padding: 7px 10px;
  font-size: 13px;
}

// Segmented mode selector
.mode-segment {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}

.seg-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 10px 8px;
  background: var(--tertiary-bg);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all 0.15s;
  text-align: center;

  .material-symbols-outlined { font-size: 18px; color: var(--secondary-text); }

  strong { font-size: 12px; color: var(--primary-text); display: block; }
  small { font-size: 10px; color: var(--secondary-text); display: block; margin-top: 2px; }

  &:hover {
    border-color: var(--highlight-text);
  }

  &.active {
    background: var(--accent-bg);
    border-color: var(--button-bg);

    .material-symbols-outlined { color: var(--highlight-text); }
    strong { color: var(--highlight-text); }
  }
}

// List editor
.list-block .block-head { margin-bottom: 10px; }

.list-editor {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.empty-list {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 14px;
  background: var(--tertiary-bg);
  border: 1px dashed var(--border-color);
  border-radius: var(--radius-md);
  font-size: 11px;
  color: var(--secondary-text);

  .material-symbols-outlined { font-size: 16px; opacity: 0.6; }
}

.chip-group {
  display: flex;
  flex-direction: column;
  gap: 6px;

  .group-label {
    font-size: 10px;
    color: var(--secondary-text);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
  }
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 3px 4px 3px 10px;
  border-radius: var(--radius-pill);
  font-size: 11px;
  border: 1px solid var(--border-color);
  background: var(--card-bg);

  code {
    font-family: 'JetBrains Mono', Consolas, monospace;
    background: transparent;
    padding: 0;
  }

  &.in {
    background: var(--accent-bg);
    color: var(--highlight-text);
    border-color: var(--highlight-text);
  }

  &.avail {
    cursor: pointer;
    color: var(--primary-text);

    &:hover {
      border-color: var(--highlight-text);
      background: var(--accent-bg);

      .material-symbols-outlined { color: var(--highlight-text); }
    }

    .material-symbols-outlined {
      font-size: 13px;
      color: var(--secondary-text);
      padding: 0 3px;
    }
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

  .material-symbols-outlined { font-size: 13px; }
}

.add-row {
  display: flex;
  gap: 6px;

  input { flex: 1; padding: 6px 10px; font-size: 12px; }

  .btn.mini {
    padding: 4px 10px;

    .material-symbols-outlined { font-size: 14px; vertical-align: middle; }
  }
}

.raw-editor .hint { margin-bottom: 6px; }

.link-btn {
  background: transparent;
  border: none;
  color: var(--secondary-text);
  font-size: 11px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  transition: all 0.15s;

  &:hover { color: var(--highlight-text); background: var(--accent-bg); }

  .material-symbols-outlined { font-size: 13px; }
}
</style>
