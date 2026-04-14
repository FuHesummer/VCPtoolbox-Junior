<template>
  <div class="page toolbox-mgr">
    <PageHeader title="Toolbox 管理" subtitle="把工具描述切成折叠块，按语义相似度动态注入省 token" icon="build">
      <template #actions>
        <input v-model="search" placeholder="搜索 alias / file..." class="search input" />
        <button class="btn" @click="openGenerator" title="从插件 invocationCommands 自动生成 toolbox 文件">
          <span class="material-symbols-outlined">auto_awesome</span>从插件生成
        </button>
        <button class="btn btn-ghost" @click="openCreateDialog">
          <span class="material-symbols-outlined">add</span>手动新建
        </button>
        <button class="btn btn-ghost" :disabled="loading" @click="reloadAll">
          <span class="material-symbols-outlined">refresh</span>
        </button>
      </template>
    </PageHeader>

    <div class="layout">
      <!-- ===== 左侧：alias 卡片列表 ===== -->
      <aside class="alias-list card">
        <div class="list-header">
          <span class="title">已配置 Toolbox</span>
          <span class="count">{{ filteredAliases.length }}</span>
          <span v-if="mapDirty" class="dirty" title="映射有未保存修改">●</span>
        </div>

        <EmptyState v-if="!aliases.length && !loading" icon="build_circle" message="暂无 Toolbox，点击右上角「新建」" />
        <ul v-else class="cards">
          <li
            v-for="alias in filteredAliases"
            :key="alias"
            class="alias-card"
            :class="{ active: selectedAlias === alias }"
            @click="selectAlias(alias)"
          >
            <div class="row top">
              <strong class="alias-name">{{ alias }}</strong>
              <button class="icon-btn" title="从映射移除" @click.stop="removeAlias(alias)">
                <span class="material-symbols-outlined">delete</span>
              </button>
            </div>
            <div class="file-line">
              <span class="material-symbols-outlined">description</span>
              <span class="file-path">{{ toolboxMap[alias]?.file || '（未绑定文件）' }}</span>
            </div>
            <p v-if="toolboxMap[alias]?.description" class="desc-preview">
              {{ toolboxMap[alias].description }}
            </p>
          </li>
        </ul>

        <!-- 未绑定文件 -->
        <div v-if="orphanFiles.length" class="orphan-section">
          <div class="orphan-header">
            <span class="material-symbols-outlined">draft</span>
            未绑定文件 <span class="orphan-count">{{ orphanFiles.length }}</span>
          </div>
          <ul class="orphan-list">
            <li v-for="f in orphanFiles" :key="f">
              <span class="path">{{ f }}</span>
              <button class="btn btn-ghost mini" @click="bindOrphan(f)">绑定 alias</button>
            </li>
          </ul>
        </div>

        <button v-if="mapDirty" class="btn save-all" @click="saveMap">
          <span class="material-symbols-outlined">save</span>保存映射
        </button>
      </aside>

      <!-- ===== 右侧：详情面板 ===== -->
      <main class="detail">
        <EmptyState v-if="!selectedAlias" icon="touch_app" message="选择左侧 Toolbox 开始编辑" />

        <template v-else>
          <!-- 元数据卡片 -->
          <div class="meta-card card">
            <div class="meta-row">
              <label>Alias</label>
              <input v-model="editAlias" @input="markMapDirty" class="input compact mono" placeholder="A-Z a-z 0-9 _" />
              <span v-if="!aliasValid" class="hint error">仅 A-Z a-z 0-9 _</span>
            </div>
            <div class="meta-row">
              <label>文件</label>
              <select v-model="editFile" @change="onFileSwitch" class="input compact flex">
                <option value="">（未选择）</option>
                <option
                  v-for="opt in fileOptions"
                  :key="opt.path || opt.label"
                  :value="opt.path"
                  :disabled="!opt.path"
                  :style="{ paddingLeft: (opt.depth * 12) + 'px' }"
                >{{ opt.label }}</option>
              </select>
            </div>
            <div class="meta-row top">
              <label>描述</label>
              <textarea
                v-model="editDescription"
                @input="markMapDirty"
                rows="2"
                class="input compact flex"
                placeholder="一句话描述这个 toolbox（用于动态注入的语义匹配）"
              />
            </div>
            <div class="meta-row stats" v-if="editFile">
              <span class="stat">
                <span class="material-symbols-outlined">layers</span>
                {{ foldBlocks.length }} 块
              </span>
              <span class="stat">
                <span class="material-symbols-outlined">data_usage</span>
                源码 {{ formatBytes(fileContent.length) }}
              </span>
              <span class="stat" v-if="fileDirty">
                <span class="material-symbols-outlined warn">circle</span>
                未保存
              </span>
            </div>
          </div>

          <!-- 编辑 + 预览 永久并列分栏 -->
          <div v-if="!editFile" class="card empty-card">
            <EmptyState icon="description" message="先在元数据中选择文件" />
          </div>

          <div v-else class="split-area">
            <!-- 左：Fold Blocks 编辑器 -->
            <div class="card editor-pane">
              <header class="pane-head">
                <span class="material-symbols-outlined">view_module</span>
                <strong>Fold Blocks</strong>
                <span class="muted">{{ foldBlocks.length }} 块 · {{ formatBytes(totalSize) }}</span>
                <span class="spacer" />
                <button class="btn-text" title="编辑原始源码" @click="rawOpen = true">
                  <span class="material-symbols-outlined">code</span>源码
                </button>
                <button class="btn compact" :disabled="!fileDirty" @click="saveFileContent">
                  <span class="material-symbols-outlined">save</span>保存
                </button>
              </header>

              <div class="pane-body fold-stream">
                <p class="hint multi">
                  <strong>两种 Fold 语法</strong>，按 description 是否为空区分：
                </p>
                <div class="mode-legend">
                  <span class="legend-item union">
                    <span class="material-symbols-outlined">layers</span>
                    <strong>累计模式</strong> <code>[===vcp_fold:0.55===]</code>
                    <span class="muted">用 plugin_description 全局判定，相似度 ≥ 阈值的块全部 union 展开（粗粒度）</span>
                  </span>
                  <span class="legend-item precise">
                    <span class="material-symbols-outlined">target</span>
                    <strong>精确模式</strong> <code>[===vcp_fold:0.55::desc:描述===]</code>
                    <span class="muted">用块自己的 description 独立判定，命中的块拼接展开（细粒度）</span>
                  </span>
                </div>

                <!-- 第一块：永久展开（plugin_description） -->
                <div class="content-card pinned">
                  <header class="cc-head">
                    <span class="material-symbols-outlined pin-icon">push_pin</span>
                    <strong>永久展开</strong>
                    <span class="muted">该块作为 plugin_description 总览，永远注入</span>
                    <span class="spacer" />
                    <span class="byte-pill">{{ formatBytes(foldBlocks[0].content.length) }}</span>
                  </header>
                  <textarea
                    v-model="foldBlocks[0].content"
                    @input="markFileDirty"
                    class="cc-content"
                    :rows="Math.min(Math.max(foldBlocks[0].content.split('\n').length, 4), 12)"
                    placeholder="工具箱总览（永远注入到 system prompt）..."
                  />
                </div>

                <!-- 后续 fold blocks：分割带 + 内容卡 配对 -->
                <template v-for="(b, i) in foldBlocks.slice(1)" :key="i + 1">
                  <!-- 分割带（核心维护对象）-->
                  <div
                    class="fold-divider"
                    :class="{
                      'mode-precise': blockMode(b) === 'precise',
                      'mode-union': blockMode(b) === 'union',
                    }"
                    :style="{ '--accent': thresholdColor(b.threshold) }"
                  >
                    <div class="divider-rail"></div>
                    <div class="divider-body">
                      <div class="divider-row primary">
                        <span class="block-num">块 #{{ i + 2 }}</span>
                        <span class="mode-badge" :title="modeTooltip(b)">
                          <span class="material-symbols-outlined">{{ blockMode(b) === 'precise' ? 'target' : 'layers' }}</span>
                          {{ blockMode(b) === 'precise' ? '精确' : '累计' }}
                        </span>
                        <input
                          v-model.number="b.threshold"
                          type="range" min="0" max="1" step="0.01"
                          class="threshold-slider"
                          :style="{ accentColor: thresholdColor(b.threshold) }"
                          @input="markFileDirty"
                        />
                        <span class="threshold-value">
                          ≥ {{ b.threshold.toFixed(2) }}
                        </span>
                        <span class="spacer" />
                        <button v-if="i > 0" class="icon-btn" title="上移" @click="moveBlock(i + 1, -1)">
                          <span class="material-symbols-outlined">arrow_upward</span>
                        </button>
                        <button v-if="i + 1 < foldBlocks.length - 1" class="icon-btn" title="下移" @click="moveBlock(i + 1, 1)">
                          <span class="material-symbols-outlined">arrow_downward</span>
                        </button>
                        <button class="icon-btn danger" title="删除此分割带（含其下内容）" @click="removeBlock(i + 1)">
                          <span class="material-symbols-outlined">delete</span>
                        </button>
                      </div>
                      <div class="divider-row secondary">
                        <span class="material-symbols-outlined label-icon">{{ blockMode(b) === 'precise' ? 'target' : 'layers' }}</span>
                        <input
                          v-model="b.description"
                          @input="markFileDirty"
                          :placeholder="blockMode(b) === 'precise'
                            ? '块描述 — 用于该块的独立语义判定（精确模式）'
                            : '留空 = 累计模式（用 plugin_description 判定）  /  填写 = 切换到精确模式'"
                          class="desc-input"
                        />
                      </div>
                    </div>
                    <div class="divider-rail"></div>
                  </div>

                  <!-- 受该分割带管辖的内容卡 -->
                  <div class="content-card">
                    <textarea
                      v-model="b.content"
                      @input="markFileDirty"
                      class="cc-content"
                      :rows="Math.min(Math.max(b.content.split('\n').length, 4), 12)"
                      placeholder="此分割带管辖的内容..."
                    />
                    <footer class="cc-foot">
                      <span class="byte">{{ formatBytes(b.content.length) }}</span>
                      <span class="lines">·  {{ b.content.split('\n').length }} 行</span>
                      <span class="spacer" />
                      <span class="hint-text" v-if="blockMode(b) === 'precise'">↑ 块描述相似度 ≥ {{ b.threshold.toFixed(2) }} 时注入（独立判定）</span>
                      <span class="hint-text" v-else>↑ plugin 全局相似度 ≥ {{ b.threshold.toFixed(2) }} 时注入（累计 union）</span>
                    </footer>
                  </div>
                </template>

                <button class="btn btn-ghost add-divider" @click="addBlock">
                  <span class="material-symbols-outlined">add</span>添加 Fold 分割带
                </button>
              </div>
            </div>

            <!-- 右：注入预览 -->
            <div class="card preview-pane">
              <header class="pane-head">
                <span class="material-symbols-outlined">visibility</span>
                <strong>注入模拟</strong>
                <span class="spacer" />
                <span class="sim-readout">相似度 = {{ simValue.toFixed(2) }}</span>
              </header>

              <div class="sim-control">
                <input
                  type="range" min="0" max="1" step="0.01"
                  v-model.number="simValue"
                  class="big-slider"
                  :style="{ '--bar-color': thresholdColor(simValue) }"
                />
                <div class="sim-marks">
                  <span @click="simValue = 0.2">0.2</span>
                  <span @click="simValue = 0.5">0.5</span>
                  <span @click="simValue = 0.8">0.8</span>
                </div>
              </div>

              <div class="sim-stats">
                <div class="stat-pill ok">
                  <span class="material-symbols-outlined">visibility</span>
                  <span class="num">{{ visibleBlocks.length }}</span>
                  <span class="lbl">/ {{ foldBlocks.length }} 展开</span>
                </div>
                <div class="stat-pill">
                  <span class="num">{{ formatBytes(injectedSize) }}</span>
                  <span class="lbl">/ {{ formatBytes(totalSize) }}</span>
                </div>
                <div class="stat-pill save" v-if="totalSize > 0">
                  <span class="material-symbols-outlined">savings</span>
                  <span class="num">{{ savePercent }}%</span>
                  <span class="lbl">节省</span>
                </div>
              </div>

              <p class="sim-explain">
                ⓘ 累计模式块用 plugin_description 算 1 个全局相似度判定，
                精确模式块独立判定（前端模拟时假设跟全局值一致）
              </p>
              <ul class="preview-list">
                <li
                  v-for="(b, i) in foldBlocks"
                  :key="i"
                  class="preview-block"
                  :class="{
                    visible: isBlockVisible(b, i),
                    folded: !isBlockVisible(b, i),
                    'mode-precise': i > 0 && blockMode(b) === 'precise',
                    'mode-union': i > 0 && blockMode(b) === 'union',
                  }"
                >
                  <header>
                    <span class="state-icon material-symbols-outlined">
                      {{ isBlockVisible(b, i) ? 'visibility' : 'visibility_off' }}
                    </span>
                    <span class="idx">#{{ i + 1 }}</span>
                    <span v-if="i === 0" class="fb-tag fixed">永久</span>
                    <template v-else>
                      <span class="mode-mini" :title="modeTooltip(b)">
                        <span class="material-symbols-outlined">{{ blockMode(b) === 'precise' ? 'target' : 'layers' }}</span>
                      </span>
                      <span class="threshold-pill" :style="{ color: thresholdColor(b.threshold) }">
                        ≥ {{ b.threshold.toFixed(2) }}
                      </span>
                    </template>
                    <span v-if="b.description" class="desc">{{ b.description }}</span>
                    <span class="spacer" />
                    <span class="byte-count">{{ formatBytes(b.content.length) }}</span>
                  </header>
                  <pre v-if="isBlockVisible(b, i)" class="content-preview">{{ b.content.slice(0, 200) }}{{ b.content.length > 200 ? '...' : '' }}</pre>
                  <p v-else class="folded-hint">已折叠 · 节省 {{ formatBytes(b.content.length) }}</p>
                </li>
              </ul>
            </div>
          </div>
        </template>
      </main>
    </div>

    <!-- 原始源码弹窗 -->
    <BaseModal v-model="rawOpen" title="编辑原始源码" width="900px">
      <p class="hint">
        高级模式 — 直接编辑源码。语法：<code>[===vcp_fold:0.55::desc:你的描述===]</code>
        分隔每个块。关闭弹窗时自动同步回可视化编辑器。
      </p>
      <CodeEditor v-model="fileContent" :rows="24" @update:modelValue="onRawEdit" />
      <div class="raw-stat">
        <span>{{ formatBytes(fileContent.length) }} · {{ foldBlocks.length }} 块</span>
        <span v-if="fileDirty" class="dirty">● 未保存</span>
      </div>
      <template #footer>
        <button class="btn btn-ghost" @click="rawOpen = false">关闭</button>
        <button class="btn" :disabled="!fileDirty" @click="saveFileContent">保存文件</button>
      </template>
    </BaseModal>

    <!-- 从插件生成 Toolbox 弹窗 -->
    <BaseModal v-model="genOpen" title="从插件生成 Toolbox" width="780px">
      <div class="gen-form">
        <div class="gen-meta">
          <div class="form-row">
            <label>Alias</label>
            <input v-model="genAlias" class="input flex mono" placeholder="A-Z a-z 0-9 _" />
          </div>
          <div class="form-row">
            <label>文件名</label>
            <input v-model="genFileName" class="input flex" placeholder="auto_tools（自动补 .txt）" />
          </div>
          <div class="form-row">
            <label>描述</label>
            <input v-model="genDescription" class="input flex" placeholder="描述这个工具箱（用于语义匹配）" />
          </div>
        </div>

        <div class="gen-options">
          <label class="check"><input type="checkbox" v-model="genIncludeHeader" />包含 VCP 调用格式 header</label>
          <label class="check"><input type="checkbox" v-model="genIncludeExamples" />包含工具示例</label>
        </div>

        <div class="gen-tools-wrap">
          <div class="gen-toolbar">
            <input v-model="genSearch" placeholder="搜索工具..." class="input flex" />
            <button class="btn btn-ghost compact" @click="genSelectAll">全选</button>
            <button class="btn btn-ghost compact" @click="genSelectNone">清空</button>
            <span class="muted">已选 {{ genSelected.size }} / {{ availableTools.length }}</span>
          </div>

          <div class="gen-tools">
            <div v-for="(group, plugin) in groupedTools" :key="plugin" class="gen-group">
              <header @click="toggleGroup(plugin)">
                <span class="material-symbols-outlined arrow" :class="{ open: !collapsedGroups.has(plugin) }">expand_more</span>
                <strong>{{ group[0]?.displayName || plugin }}</strong>
                <span class="plugin-name">({{ plugin }})</span>
                <span class="spacer" />
                <span class="count">{{ group.filter(t => genSelected.has(t.name)).length }} / {{ group.length }}</span>
                <button class="btn btn-ghost mini" @click.stop="toggleGroupSelection(group)">
                  {{ group.every(t => genSelected.has(t.name)) ? '反选' : '全选' }}
                </button>
              </header>
              <ul v-if="!collapsedGroups.has(plugin)" class="tool-list">
                <li
                  v-for="t in group"
                  :key="t.name"
                  class="tool-item"
                  :class="{ selected: genSelected.has(t.name) }"
                  @click="toggleSelectTool(t.name)"
                >
                  <input type="checkbox" :checked="genSelected.has(t.name)" @click.stop @change="toggleSelectTool(t.name)" />
                  <div class="info">
                    <code class="tool-name">{{ t.name }}</code>
                    <p class="tool-desc">{{ t.description || '（无描述）' }}</p>
                  </div>
                </li>
              </ul>
            </div>
          </div>
        </div>

        <p class="hint">
          ✦ 生成后会调用 <code>/tool-list-editor/export</code> 写入 <code>TVStxt/{{ genFileName || '?' }}.txt</code>，
          并自动注册 alias <code>{{ genAlias || '?' }}</code> 到映射
        </p>
      </div>
      <template #footer>
        <button class="btn btn-ghost" @click="genOpen = false">取消</button>
        <button class="btn" :disabled="!genValid || genRunning" @click="confirmGenerate">
          {{ genRunning ? '生成中...' : `生成（${genSelected.size} 个工具）` }}
        </button>
      </template>
    </BaseModal>

    <!-- 新建 Toolbox 弹窗 -->
    <BaseModal v-model="createOpen" title="新建 Toolbox" width="520px">
      <div class="create-form">
        <div class="form-row">
          <label>Alias</label>
          <input v-model="newAlias" class="input flex mono" placeholder="A-Z a-z 0-9 _" />
        </div>
        <div class="form-row">
          <label>文件名</label>
          <input v-model="newFileName" class="input flex" placeholder="my_toolbox.txt（自动补 .txt）" />
        </div>
        <div class="form-row">
          <label>子目录</label>
          <input v-model="newFolderPath" class="input flex" placeholder="（可选，不填则放根）" />
        </div>
        <div class="form-row">
          <label>描述</label>
          <textarea v-model="newDescription" rows="2" class="input flex" placeholder="一句话描述（用于语义匹配）" />
        </div>
        <p class="hint">
          ✦ 创建后会同时新建空文件并写入 toolbox 映射
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
import PageHeader from '@/components/common/PageHeader.vue'
import EmptyState from '@/components/common/EmptyState.vue'
import CodeEditor from '@/components/common/CodeEditor.vue'
import BaseModal from '@/components/common/BaseModal.vue'
import {
  getToolboxMap, saveToolboxMap, listToolboxFiles,
  getToolboxFile, saveToolboxFile, createToolboxFile,
  type ToolboxMap, type FolderStructure, type FileNode, type FolderNode,
} from '@/api/toolbox'
import { listToolListEditorTools, exportToolList, type ToolDef } from '@/api/toolListEditor'
import { useUiStore } from '@/stores/ui'
import { useConfirm } from '@/composables/useConfirm'

const ui = useUiStore()
const { confirm } = useConfirm()

const ALIAS_REGEX = /^[A-Za-z0-9_]+$/
const FOLD_REGEX = /^\[===vcp_fold:\s*([0-9.]+)(?:\s*::desc:\s*(.*?)\s*)?===\]\s*$/

interface FoldBlock {
  threshold: number
  description: string
  content: string
}

// === 数据状态 ===
const loading = ref(false)
const toolboxMap = ref<ToolboxMap>({})
const mapOriginal = ref<ToolboxMap>({})
const allFiles = ref<string[]>([])
const folderStructure = ref<FolderStructure>({})
const search = ref('')

// === 选中状态 ===
const selectedAlias = ref<string | null>(null)
const editAlias = ref('')
const editFile = ref('')
const editDescription = ref('')

// === 文件内容 ===
const fileContent = ref('')
const fileOriginal = ref('')
const foldBlocks = ref<FoldBlock[]>([])

// === 原始源码弹窗 + 模拟器 ===
const rawOpen = ref(false)
const simValue = ref(0.5)

// threshold → 颜色（hot 红 / mid 橙 / cold 绿）
function thresholdColor(t: number) {
  if (t < 0.4) return '#e94e6c'       // 热（低阈值，常被注入）
  if (t < 0.7) return '#f1ae28'       // 中
  return '#58c98f'                    // 冷（高阈值，省 token）
}

// fold block 模式判定：有 desc = 精确，无 desc = 累计
function blockMode(b: FoldBlock): 'union' | 'precise' {
  return (b.description || '').trim() ? 'precise' : 'union'
}
function modeTooltip(b: FoldBlock): string {
  return blockMode(b) === 'precise'
    ? '精确模式：用此块的 description 独立算相似度判定'
    : '累计模式：用 plugin_description 全局判定，多块按 union 展开'
}

// === 从插件生成 弹窗状态 ===
const genOpen = ref(false)
const genRunning = ref(false)
const availableTools = ref<ToolDef[]>([])
const genSelected = ref(new Set<string>())
const genSearch = ref('')
const collapsedGroups = ref(new Set<string>())
const genAlias = ref('')
const genFileName = ref('')
const genDescription = ref('')
const genIncludeHeader = ref(true)
const genIncludeExamples = ref(true)

const filteredTools = computed(() => {
  const kw = genSearch.value.trim().toLowerCase()
  if (!kw) return availableTools.value
  return availableTools.value.filter((t) =>
    t.name.toLowerCase().includes(kw) ||
    (t.displayName || '').toLowerCase().includes(kw) ||
    (t.pluginName || '').toLowerCase().includes(kw),
  )
})

const groupedTools = computed(() => {
  const map: Record<string, ToolDef[]> = {}
  for (const t of filteredTools.value) {
    if (!map[t.pluginName]) map[t.pluginName] = []
    map[t.pluginName].push(t)
  }
  return map
})

const genValid = computed(() =>
  ALIAS_REGEX.test(genAlias.value.trim()) &&
  !!genFileName.value.trim() &&
  genSelected.value.size > 0 &&
  !aliases.value.includes(genAlias.value.trim()),
)

async function openGenerator() {
  genAlias.value = ''
  genFileName.value = ''
  genDescription.value = ''
  genIncludeHeader.value = true
  genIncludeExamples.value = true
  genSelected.value = new Set()
  genSearch.value = ''
  collapsedGroups.value = new Set()
  genOpen.value = true
  try {
    const { tools } = await listToolListEditorTools()
    availableTools.value = tools || []
  } catch (e) {
    ui.showMessage('加载工具列表失败：' + (e as Error).message, 'error')
  }
}

function toggleSelectTool(name: string) {
  if (genSelected.value.has(name)) genSelected.value.delete(name)
  else genSelected.value.add(name)
  genSelected.value = new Set(genSelected.value)
}

function toggleGroup(plugin: string) {
  if (collapsedGroups.value.has(plugin)) collapsedGroups.value.delete(plugin)
  else collapsedGroups.value.add(plugin)
  collapsedGroups.value = new Set(collapsedGroups.value)
}

function toggleGroupSelection(group: ToolDef[]) {
  const allOn = group.every((t) => genSelected.value.has(t.name))
  if (allOn) {
    for (const t of group) genSelected.value.delete(t.name)
  } else {
    for (const t of group) genSelected.value.add(t.name)
  }
  genSelected.value = new Set(genSelected.value)
}

function genSelectAll() {
  for (const t of availableTools.value) genSelected.value.add(t.name)
  genSelected.value = new Set(genSelected.value)
}

function genSelectNone() {
  genSelected.value = new Set()
}

async function confirmGenerate() {
  if (!genValid.value) return
  const alias = genAlias.value.trim()
  let fileName = genFileName.value.trim()
  if (!/\.(txt|md)$/i.test(fileName)) fileName = `${fileName}.txt`
  const baseName = fileName.replace(/\.(txt|md)$/i, '')
  genRunning.value = true
  try {
    // 1. 调 export 写入 TVStxt/<baseName>.txt
    await exportToolList(baseName, {
      selectedTools: Array.from(genSelected.value),
      includeHeader: genIncludeHeader.value,
      includeExamples: genIncludeExamples.value,
    })
    // 2. 注册到 toolboxMap 并保存
    toolboxMap.value[alias] = { file: fileName, description: genDescription.value.trim() }
    await saveToolboxMap(toolboxMap.value)
    mapOriginal.value = JSON.parse(JSON.stringify(toolboxMap.value))
    // 3. 重载并选中
    await reloadAll()
    await selectAlias(alias)
    genOpen.value = false
    ui.showMessage(`Toolbox "${alias}" 已生成（${genSelected.value.size} 个工具）`, 'success')
  } catch (e) {
    ui.showMessage('生成失败：' + (e as Error).message, 'error')
  } finally { genRunning.value = false }
}

// === 新建对话框 ===
const createOpen = ref(false)
const newAlias = ref('')
const newFileName = ref('')
const newFolderPath = ref('')
const newDescription = ref('')

// === 派生 ===
const aliases = computed(() => Object.keys(toolboxMap.value))
const filteredAliases = computed(() => {
  const kw = search.value.trim().toLowerCase()
  if (!kw) return aliases.value
  return aliases.value.filter((a) => {
    const item = toolboxMap.value[a]
    return a.toLowerCase().includes(kw) || (item?.file || '').toLowerCase().includes(kw)
  })
})

const orphanFiles = computed(() => {
  const used = new Set(Object.values(toolboxMap.value).map((v) => v.file))
  return allFiles.value.filter((f) => !used.has(f))
})

const mapDirty = computed(() => JSON.stringify(toolboxMap.value) !== JSON.stringify(mapOriginal.value))
const fileDirty = ref(false)

const aliasValid = computed(() => editAlias.value === '' || ALIAS_REGEX.test(editAlias.value))

const createValid = computed(() => {
  return ALIAS_REGEX.test(newAlias.value.trim()) &&
    !!newFileName.value.trim() &&
    !aliases.value.includes(newAlias.value.trim())
})

interface FileOption { path: string; label: string; depth: number }

const fileOptions = computed(() => {
  const list: FileOption[] = []
  function walk(node: Record<string, FileNode | FolderNode>, depth: number, prefix: string) {
    for (const [name, item] of Object.entries(node)) {
      if (item.type === 'folder') {
        list.push({ path: '', label: `${prefix}${name}/`, depth })
        walk(item.children, depth + 1, `${prefix}${name}/`)
      } else {
        list.push({ path: item.path, label: name, depth })
      }
    }
  }
  walk(folderStructure.value, 0, '')
  return list
})

// === 模拟器派生 ===
function isBlockVisible(b: FoldBlock, i: number) {
  if (i === 0) return true
  return simValue.value >= b.threshold
}
const visibleBlocks = computed(() => foldBlocks.value.filter(isBlockVisible))
const totalSize = computed(() => foldBlocks.value.reduce((s, b) => s + b.content.length, 0))
const injectedSize = computed(() => visibleBlocks.value.reduce((s, b) => s + b.content.length, 0))
const savePercent = computed(() => {
  if (!totalSize.value) return 0
  return Math.round((1 - injectedSize.value / totalSize.value) * 100)
})

// === 加载 ===
async function reloadAll() {
  loading.value = true
  try {
    const [m, f] = await Promise.all([getToolboxMap(), listToolboxFiles()])
    toolboxMap.value = m || {}
    mapOriginal.value = JSON.parse(JSON.stringify(toolboxMap.value))
    allFiles.value = f.files || []
    folderStructure.value = f.folderStructure || {}
    if (selectedAlias.value && !aliases.value.includes(selectedAlias.value)) {
      selectedAlias.value = null
    }
  } catch (e) {
    ui.showMessage('加载失败：' + (e as Error).message, 'error')
  } finally { loading.value = false }
}

// === 选中 alias ===
async function selectAlias(alias: string) {
  if (fileDirty.value) {
    const ok = await confirm('当前文件有未保存的修改，确定切换吗？', { danger: true, okText: '切换' })
    if (!ok) return
  }
  // 同步当前编辑的 alias/file/description 回 map
  syncEditBackToMap()
  selectedAlias.value = alias
  const item = toolboxMap.value[alias]
  if (!item) return
  editAlias.value = alias
  editFile.value = item.file || ''
  editDescription.value = item.description || ''
  if (editFile.value) await loadFileContent(editFile.value)
  else { fileContent.value = ''; fileOriginal.value = ''; foldBlocks.value = []; fileDirty.value = false }
}

function syncEditBackToMap() {
  if (!selectedAlias.value) return
  const oldAlias = selectedAlias.value
  const newAliasName = (editAlias.value || '').trim() || oldAlias
  // 如果 alias 改名了
  if (newAliasName !== oldAlias) {
    delete toolboxMap.value[oldAlias]
  }
  toolboxMap.value[newAliasName] = {
    file: editFile.value,
    description: editDescription.value,
  }
  if (newAliasName !== oldAlias) selectedAlias.value = newAliasName
}

function markMapDirty() {
  // alias / description 变更直接同步到 map（map dirty 自然变 true）
  if (selectedAlias.value) syncEditBackToMap()
}

async function onFileSwitch() {
  if (fileDirty.value) {
    const ok = await confirm('文件未保存，确定切换吗？', { danger: true, okText: '切换' })
    if (!ok) {
      // 回滚 select
      const item = toolboxMap.value[selectedAlias.value || '']
      editFile.value = item?.file || ''
      return
    }
  }
  if (selectedAlias.value) syncEditBackToMap()
  if (editFile.value) await loadFileContent(editFile.value)
  else { fileContent.value = ''; fileOriginal.value = ''; foldBlocks.value = []; fileDirty.value = false }
}

// === 文件加载/保存 ===
async function loadFileContent(filePath: string) {
  try {
    const { content } = await getToolboxFile(filePath)
    fileContent.value = content
    fileOriginal.value = content
    foldBlocks.value = parseFoldBlocks(content)
    fileDirty.value = false
  } catch (e) {
    ui.showMessage('加载文件失败：' + (e as Error).message, 'error')
  }
}

async function saveFileContent() {
  if (!editFile.value) return
  // 序列化兜底（visual 模式 markFileDirty 已实时同步，但保险起见再跑一次）
  fileContent.value = serializeFoldBlocks(foldBlocks.value)
  try {
    await saveToolboxFile(editFile.value, fileContent.value)
    fileOriginal.value = fileContent.value
    fileDirty.value = false
    ui.showMessage('文件已保存', 'success')
  } catch (e) { ui.showMessage('保存失败：' + (e as Error).message, 'error') }
}

function onRawEdit() {
  fileDirty.value = true
  // 实时解析 blocks（切到可视化时立刻可用）
  foldBlocks.value = parseFoldBlocks(fileContent.value)
}

function markFileDirty() {
  fileDirty.value = true
  // 反向：blocks 改了立刻同步到 fileContent（让 raw 模式实时一致）
  fileContent.value = serializeFoldBlocks(foldBlocks.value)
}

// === Fold Block 操作 ===
function addBlock() {
  foldBlocks.value.push({ threshold: 0.5, description: '', content: '' })
  markFileDirty()
}

function removeBlock(i: number) {
  foldBlocks.value.splice(i, 1)
  markFileDirty()
}

function moveBlock(i: number, delta: number) {
  const target = i + delta
  if (target < 1 || target >= foldBlocks.value.length) return  // 不能移到 0 位置
  const [item] = foldBlocks.value.splice(i, 1)
  foldBlocks.value.splice(target, 0, item)
  markFileDirty()
}

// === Fold Parser / Serializer ===
function parseFoldBlocks(content: string): FoldBlock[] {
  const blocks: FoldBlock[] = []
  let cur: FoldBlock = { threshold: 0, description: '', content: '' }
  let curLines: string[] = []
  let opened = false

  for (const line of content.split('\n')) {
    const m = line.match(FOLD_REGEX)
    if (m) {
      if (opened || curLines.length > 0) {
        cur.content = curLines.join('\n').trim()
        blocks.push(cur)
      }
      const t = parseFloat(m[1])
      cur = {
        threshold: Number.isNaN(t) ? 0 : t,
        description: (m[2] || '').trim(),
        content: '',
      }
      curLines = []
      opened = true
    } else {
      curLines.push(line)
    }
  }
  if (opened || curLines.length > 0) {
    cur.content = curLines.join('\n').trim()
    blocks.push(cur)
  }
  if (!blocks.length) return [{ threshold: 0, description: '', content: '' }]
  return blocks
}

function serializeFoldBlocks(blocks: FoldBlock[]): string {
  const out: string[] = []
  blocks.forEach((b, i) => {
    if (i > 0) {
      const desc = b.description.trim()
      out.push(desc
        ? `[===vcp_fold:${b.threshold.toFixed(2)}::desc:${desc}===]`
        : `[===vcp_fold:${b.threshold.toFixed(2)}===]`)
    }
    out.push(b.content)
  })
  return out.join('\n\n')
}

// === Map 保存 / 删除 alias ===
async function saveMap() {
  if (selectedAlias.value) syncEditBackToMap()
  // 校验
  for (const a of Object.keys(toolboxMap.value)) {
    if (!ALIAS_REGEX.test(a)) {
      ui.showMessage(`alias "${a}" 不合法（仅 A-Z a-z 0-9 _）`, 'error')
      return
    }
    if (!toolboxMap.value[a].file) {
      ui.showMessage(`alias "${a}" 未选择文件`, 'error')
      return
    }
  }
  try {
    await saveToolboxMap(toolboxMap.value)
    mapOriginal.value = JSON.parse(JSON.stringify(toolboxMap.value))
    ui.showMessage('映射已保存', 'success')
  } catch (e) { ui.showMessage('保存失败：' + (e as Error).message, 'error') }
}

async function removeAlias(alias: string) {
  const ok = await confirm(`从映射中移除 "${alias}"？文件本身不会被删除。`, { danger: true, okText: '移除' })
  if (!ok) return
  delete toolboxMap.value[alias]
  if (selectedAlias.value === alias) {
    selectedAlias.value = null
    editAlias.value = ''
    editFile.value = ''
    editDescription.value = ''
    fileContent.value = ''
    foldBlocks.value = []
  }
}

async function bindOrphan(file: string) {
  // 默认用文件名（去后缀）作为 alias
  const base = file.split('/').pop()?.replace(/\.(txt|md)$/i, '') || 'NewToolbox'
  let alias = base.replace(/[^A-Za-z0-9_]/g, '_')
  let i = 1
  while (aliases.value.includes(alias)) alias = `${base}_${++i}`
  toolboxMap.value[alias] = { file, description: '' }
  await selectAlias(alias)
}

// === 新建 ===
function openCreateDialog() {
  newAlias.value = ''
  newFileName.value = ''
  newFolderPath.value = ''
  newDescription.value = ''
  createOpen.value = true
}

async function confirmCreate() {
  if (!createValid.value) return
  const alias = newAlias.value.trim()
  let fileName = newFileName.value.trim()
  if (!/\.(txt|md)$/i.test(fileName)) fileName = `${fileName}.txt`
  const folderPath = newFolderPath.value.trim().replace(/[\\/]+$/, '')
  const fullPath = folderPath ? `${folderPath}/${fileName}` : fileName

  try {
    // 先新建文件（如果已存在会 409，但我们仍然可以绑定）
    try {
      await createToolboxFile(fileName, folderPath)
    } catch (e) {
      const err = e as Error & { status?: number }
      if (err.status !== 409) throw err
      // 409：文件已存在，沿用即可
    }
    toolboxMap.value[alias] = { file: fullPath, description: newDescription.value.trim() }
    await reloadAll()
    await selectAlias(alias)
    createOpen.value = false
    ui.showMessage(`Toolbox "${alias}" 已创建`, 'success')
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

onMounted(reloadAll)
</script>

<style lang="scss" scoped>
.layout {
  display: grid;
  grid-template-columns: 320px 1fr;
  gap: 16px;
  padding: 0 24px 24px;
  min-height: calc(100vh - 180px);
  @media (max-width: 1100px) { grid-template-columns: 1fr; }
}

.search { width: 200px; }

// ===== 左侧 alias 列表 =====
.alias-list {
  padding: 14px;
  display: flex; flex-direction: column; gap: 10px;
  max-height: calc(100vh - 180px);
  overflow-y: auto;
}

.list-header {
  display: flex; align-items: center; gap: 8px;
  font-size: 12px; color: var(--secondary-text);
  .title { font-weight: 500; }
  .count { background: var(--accent-bg); color: var(--highlight-text); padding: 1px 7px; border-radius: var(--radius-pill); font-size: 11px; }
  .dirty { color: #f1ae28; font-size: 18px; line-height: 1; }
}

.cards { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 6px; }

.alias-card {
  background: var(--tertiary-bg);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  padding: 10px;
  cursor: pointer;
  transition: all 0.15s;
  display: flex; flex-direction: column; gap: 4px;

  &:hover { transform: translateX(2px); box-shadow: 0 2px 8px rgba(180, 120, 140, 0.1); border-color: var(--button-bg); }
  &.active { background: var(--accent-bg); border-color: var(--button-bg); }

  .row.top { display: flex; align-items: center; justify-content: space-between; }
  .alias-name { font-size: 13px; color: var(--primary-text); font-family: 'JetBrains Mono', monospace; }

  .file-line {
    display: flex; align-items: center; gap: 4px;
    font-size: 11.5px; color: var(--secondary-text);
    .material-symbols-outlined { font-size: 14px; }
    .file-path { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  }

  .desc-preview {
    margin: 0; font-size: 11px; color: var(--secondary-text);
    display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
  }
}

.icon-btn {
  background: transparent; border: none; cursor: pointer; padding: 3px;
  color: var(--secondary-text); border-radius: var(--radius-sm);
  display: inline-flex; align-items: center;
  &:hover { background: var(--accent-bg); color: var(--primary-text); }
  .material-symbols-outlined { font-size: 16px; }
}

.orphan-section {
  margin-top: 8px; padding-top: 10px; border-top: 1px dashed var(--border-color);
  .orphan-header {
    display: flex; align-items: center; gap: 4px;
    font-size: 11.5px; color: var(--secondary-text); margin-bottom: 6px;
    .material-symbols-outlined { font-size: 14px; }
    .orphan-count { background: var(--accent-bg); padding: 0 5px; border-radius: var(--radius-pill); font-size: 10.5px; }
  }
  .orphan-list {
    list-style: none; padding: 0; margin: 0;
    li { display: flex; align-items: center; gap: 4px; font-size: 11px; padding: 3px 0;
      .path { flex: 1; color: var(--secondary-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    }
  }
}

.btn.mini { font-size: 10.5px; padding: 2px 6px; }
.save-all { margin-top: auto; width: 100%; }

// ===== 右侧详情 =====
.detail { display: flex; flex-direction: column; gap: 12px; min-width: 0; }

.meta-card { padding: 14px; display: flex; flex-direction: column; gap: 10px; }
.meta-row {
  display: flex; align-items: center; gap: 8px; font-size: 13px;
  &.top { align-items: flex-start; }
  &.stats { padding-top: 6px; border-top: 1px dashed var(--border-color); gap: 14px; }
  label { min-width: 60px; color: var(--secondary-text); font-size: 12px; }
  .input.compact { font-size: 13px; padding: 5px 9px; }
  .input.flex { flex: 1; }
  .input.mono { font-family: 'JetBrains Mono', monospace; }
  .hint.error { color: #d65a5a; font-size: 11px; }
}

.stat { display: inline-flex; align-items: center; gap: 4px; color: var(--secondary-text); font-size: 12px;
  .material-symbols-outlined { font-size: 16px; }
  .warn { color: #f1ae28; }
}

.empty-card { padding: 40px 0; }
.hint { margin: 0 0 10px; font-size: 12px; color: var(--secondary-text); padding: 8px 12px; background: var(--accent-bg); border-radius: var(--radius-sm); line-height: 1.6;
  code { background: var(--bg-color); padding: 1px 5px; border-radius: var(--radius-sm); font-size: 11px; color: var(--highlight-text); }
}

// ===== 编辑 + 预览 分栏 =====
.split-area {
  display: grid;
  grid-template-columns: 1.4fr 1fr;
  gap: 12px;
  flex: 1;
  min-height: 0;
  @media (max-width: 1280px) { grid-template-columns: 1fr; }
}

.editor-pane, .preview-pane {
  padding: 0;
  display: flex; flex-direction: column;
  overflow: hidden;
}

.pane-head {
  display: flex; align-items: center; gap: 6px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border-color);
  font-size: 13px;
  background: var(--tertiary-bg);

  .material-symbols-outlined { font-size: 18px; color: var(--button-bg); }
  strong { color: var(--primary-text); }
  .muted { color: var(--secondary-text); font-size: 11.5px; font-weight: normal; }
  .spacer { flex: 1; }
  .btn-text {
    background: transparent; border: none; cursor: pointer;
    color: var(--secondary-text); font-size: 12px;
    padding: 4px 8px; border-radius: var(--radius-sm);
    display: inline-flex; align-items: center; gap: 4px;
    .material-symbols-outlined { font-size: 14px; color: var(--secondary-text); }
    &:hover { background: var(--accent-bg); color: var(--primary-text); }
  }
  .btn.compact { font-size: 12px; padding: 4px 10px; }
  .sim-readout { font-family: monospace; color: var(--highlight-text); font-weight: 600; }
}

.pane-body { padding: 14px; overflow-y: auto; flex: 1; }

// ===== Fold Stream（内容卡 + 分割带） =====
.fold-stream {
  display: flex; flex-direction: column;
  gap: 0;       // 分割带和内容卡紧贴
}

// 内容卡（中性灰，主体内容）
.content-card {
  background: var(--bg-color);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  padding: 0;
  margin-bottom: 0;
  display: flex; flex-direction: column;
  overflow: hidden;

  &.pinned {
    border-color: #b478a0;
    background: linear-gradient(180deg, rgba(180, 120, 160, 0.05), transparent 50%);
    margin-top: 4px;
  }

  + .fold-divider { margin-top: 8px; }

  .cc-head {
    display: flex; align-items: center; gap: 6px;
    padding: 8px 12px;
    background: linear-gradient(135deg, rgba(255, 155, 179, 0.12), rgba(180, 120, 160, 0.08));
    border-bottom: 1px dashed rgba(180, 120, 160, 0.3);
    font-size: 12px;
    .pin-icon { color: #b478a0; font-size: 16px; }
    strong { color: #b478a0; font-size: 13px; }
    .muted { color: var(--secondary-text); font-size: 11px; }
    .spacer { flex: 1; }
    .byte-pill { background: var(--accent-bg); padding: 1px 7px; border-radius: var(--radius-pill); font-size: 11px; font-family: monospace; color: var(--secondary-text); }
  }

  .cc-content {
    width: 100%; box-sizing: border-box;
    font-family: 'JetBrains Mono', 'Consolas', monospace;
    font-size: 12.5px;
    padding: 12px 14px;
    background: transparent;
    border: none;
    resize: vertical;
    color: var(--primary-text);
    line-height: 1.6;
    min-height: 80px;
    &:focus { outline: none; background: var(--accent-bg); }
  }

  .cc-foot {
    display: flex; align-items: center; gap: 6px;
    padding: 6px 12px;
    background: var(--tertiary-bg);
    border-top: 1px solid var(--border-color);
    font-size: 11px; color: var(--secondary-text);
    .byte { font-family: monospace; }
    .spacer { flex: 1; }
    .hint-text { font-style: italic; opacity: 0.85; }
  }
}

// 分割带（核心维护对象 — 重点色突出）
.fold-divider {
  position: relative;
  margin: 14px 0;
  display: flex; flex-direction: column; align-items: stretch; gap: 0;
  padding: 0;

  // 上下两条彩色 rail
  .divider-rail {
    height: 3px;
    background: linear-gradient(90deg,
      transparent,
      var(--accent, #b478a0) 20%,
      var(--accent, #b478a0) 80%,
      transparent
    );
    border-radius: 2px;
    opacity: 0.7;
  }

  .divider-body {
    background: linear-gradient(135deg,
      color-mix(in srgb, var(--accent, #b478a0) 14%, var(--bg-color)),
      color-mix(in srgb, var(--accent, #b478a0) 6%, var(--bg-color))
    );
    border: 1.5px solid var(--accent, #b478a0);
    border-radius: var(--radius-md);
    padding: 10px 12px;
    margin: 4px 0;
    display: flex; flex-direction: column; gap: 8px;
    box-shadow: 0 2px 12px color-mix(in srgb, var(--accent, #b478a0) 18%, transparent);
  }

  .divider-row {
    display: flex; align-items: center; gap: 8px;

    &.primary {
      .block-num {
        font-family: monospace; font-size: 11px;
        color: var(--accent, #b478a0); font-weight: 600;
        min-width: 44px;
      }
      .symbol { font-size: 18px; color: var(--accent, #b478a0); }
      .threshold-slider {
        flex: 1; max-width: 220px;
        height: 6px;
        cursor: pointer;
      }
      .threshold-value {
        font-family: 'JetBrains Mono', monospace;
        font-size: 14px; font-weight: 700;
        color: var(--accent, #b478a0);
        min-width: 70px; text-align: right;
        padding: 2px 10px;
        background: var(--bg-color);
        border-radius: var(--radius-pill);
        border: 1px solid var(--accent, #b478a0);
      }
      .spacer { flex: 1; }
    }

    &.secondary {
      padding-top: 4px;
      border-top: 1px dashed color-mix(in srgb, var(--accent, #b478a0) 30%, transparent);

      .label-icon { font-size: 16px; color: var(--accent, #b478a0); }
      .desc-input {
        flex: 1;
        font-size: 12.5px; padding: 6px 10px;
        background: var(--bg-color);
        border: 1px solid color-mix(in srgb, var(--accent, #b478a0) 35%, var(--border-color));
        border-radius: var(--radius-sm);
        color: var(--primary-text);
        font-weight: 500;
        &::placeholder { color: var(--secondary-text); font-weight: normal; }
        &:focus { outline: none; border-color: var(--accent, #b478a0); box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent, #b478a0) 20%, transparent); }
      }
    }
  }
}

.icon-btn.danger {
  &:hover { background: rgba(214, 90, 90, 0.12); color: #d65a5a; }
}

.add-divider {
  width: 100%; margin-top: 16px;
  border: 1.5px dashed var(--border-color);
  background: transparent;
  &:hover { border-color: #b478a0; background: rgba(180, 120, 160, 0.06); color: #b478a0; }
}

// ===== 注入预览 =====
.sim-control {
  padding: 14px;
  background: var(--accent-bg);
  display: flex; flex-direction: column; gap: 6px;

  .big-slider {
    width: 100%;
    height: 8px;
    accent-color: var(--bar-color, var(--button-bg));
    cursor: pointer;
  }
  .sim-marks {
    display: flex; justify-content: space-between;
    font-size: 11px; color: var(--secondary-text); font-family: monospace;
    span { cursor: pointer; padding: 2px 6px; border-radius: var(--radius-sm);
      &:hover { background: var(--bg-color); color: var(--primary-text); }
    }
  }
}

.sim-stats {
  display: flex; gap: 8px; padding: 12px 14px;
  border-bottom: 1px solid var(--border-color);

  .stat-pill {
    flex: 1;
    display: flex; flex-direction: column; align-items: center; gap: 2px;
    padding: 8px 6px;
    background: var(--tertiary-bg);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    font-size: 11px; color: var(--secondary-text);

    .material-symbols-outlined { font-size: 16px; }
    .num { font-size: 16px; font-weight: 600; color: var(--primary-text); font-family: monospace; }
    .lbl { font-size: 10.5px; color: var(--secondary-text); }

    &.ok .num, &.ok .material-symbols-outlined { color: #58c98f; }
    &.save .num, &.save .material-symbols-outlined { color: #f1ae28; }
  }
}

.preview-list {
  list-style: none; padding: 14px; margin: 0;
  display: flex; flex-direction: column; gap: 6px;
  overflow-y: auto; flex: 1;
}

.preview-block {
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  padding: 8px 10px;
  transition: all 0.25s;

  header { display: flex; align-items: center; gap: 6px; font-size: 12px;
    .state-icon { font-size: 16px; }
    .idx { font-family: monospace; color: var(--secondary-text); font-size: 10.5px; opacity: 0.6; }
    .threshold-pill { background: var(--bg-color); padding: 1px 6px; border-radius: var(--radius-pill); font-size: 11px; font-family: monospace; font-weight: 500; }
    .fb-tag.fixed { background: linear-gradient(135deg, #ff9bb3, #b478a0); color: #fff; padding: 1px 7px; border-radius: var(--radius-pill); font-size: 10.5px; }
    .desc { color: var(--secondary-text); font-size: 11px; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .spacer { flex: 1; }
    .byte-count { font-size: 10.5px; color: var(--secondary-text); font-family: monospace; }
  }

  .content-preview {
    margin: 6px 0 0; font-family: 'JetBrains Mono', monospace;
    font-size: 11px; padding: 6px 8px;
    background: var(--bg-color); border-radius: var(--radius-sm);
    white-space: pre-wrap; max-height: 100px; overflow-y: auto;
    color: var(--secondary-text); line-height: 1.5;
  }
  .folded-hint { margin: 4px 0 0; font-size: 10.5px; color: var(--secondary-text); font-style: italic; padding-left: 22px; }

  &.visible { border-color: rgba(88, 201, 143, 0.4); background: rgba(88, 201, 143, 0.04);
    .state-icon { color: #58c98f; }
  }
  &.folded { opacity: 0.55;
    .state-icon { color: var(--secondary-text); }
  }
}

// ===== Mode badge & legend =====
.hint.multi { margin-bottom: 4px; }
.mode-legend {
  display: flex; flex-direction: column; gap: 6px;
  margin-bottom: 12px; padding: 10px 12px;
  background: var(--accent-bg); border-radius: var(--radius-md);
  font-size: 11.5px;

  .legend-item {
    display: flex; align-items: center; gap: 6px;
    flex-wrap: wrap;
    .material-symbols-outlined { font-size: 14px; }
    code { background: var(--bg-color); padding: 1px 5px; border-radius: var(--radius-sm); font-size: 10.5px; color: var(--highlight-text); }
    strong { color: var(--primary-text); }
    .muted { color: var(--secondary-text); flex-basis: 100%; padding-left: 22px; font-size: 11px; }
  }
  .legend-item.union { strong, .material-symbols-outlined { color: #f1ae28; } }
  .legend-item.precise { strong, .material-symbols-outlined { color: #9b6dd0; } }
}

// 分割带 mode 颜色覆盖
.fold-divider.mode-precise {
  --accent: #9b6dd0;  // 紫色 = 精确
  .mode-badge { background: rgba(155, 109, 208, 0.18); color: #9b6dd0; border-color: rgba(155, 109, 208, 0.4); }
}
.fold-divider.mode-union {
  --accent: #f1ae28;  // 橙色 = 累计
  .mode-badge { background: rgba(241, 174, 40, 0.18); color: #f1ae28; border-color: rgba(241, 174, 40, 0.4); }
}

.mode-badge {
  display: inline-flex; align-items: center; gap: 3px;
  padding: 1px 7px;
  background: var(--bg-color);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-pill);
  font-size: 10.5px; font-weight: 600;
  .material-symbols-outlined { font-size: 12px; }
}

.mode-mini {
  display: inline-flex; align-items: center;
  padding: 1px 4px;
  border-radius: var(--radius-sm);
  .material-symbols-outlined { font-size: 13px; }
}

.preview-block.mode-precise .mode-mini { color: #9b6dd0; background: rgba(155, 109, 208, 0.1); }
.preview-block.mode-union .mode-mini { color: #f1ae28; background: rgba(241, 174, 40, 0.1); }

.sim-explain {
  margin: 0 0 8px; padding: 6px 10px;
  font-size: 11px; color: var(--secondary-text);
  background: var(--accent-bg); border-radius: var(--radius-sm);
  line-height: 1.5;
}

// ===== 从插件生成 弹窗 =====
.gen-form { display: flex; flex-direction: column; gap: 14px; }

// 自定义 checkbox — 还原原生 + 粉色主题（修复全局 input 样式污染）
:deep(.gen-form input[type="checkbox"]),
.gen-form :deep(input[type="checkbox"]) {
  appearance: none;
  -webkit-appearance: none;
  width: 16px; height: 16px;
  margin: 0;
  padding: 0;
  background: var(--tertiary-bg);
  border: 1.5px solid var(--border-color);
  border-radius: 4px;
  cursor: pointer;
  position: relative;
  flex-shrink: 0;
  transition: all 0.15s;

  &:hover { border-color: var(--button-bg); }

  &:checked {
    background: var(--button-bg);
    border-color: var(--button-bg);
    &::after {
      content: '';
      position: absolute;
      left: 4px; top: 1px;
      width: 5px; height: 9px;
      border: solid #fff;
      border-width: 0 2px 2px 0;
      transform: rotate(45deg);
    }
  }
}

.gen-meta {
  display: flex; flex-direction: column; gap: 10px;
  padding: 14px 16px;
  background: var(--input-bg);             // 不透明奶油白 — 跟 input 视觉融合
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);

  .form-row {
    display: flex; align-items: center; gap: 10px; font-size: 13px;
    label {
      min-width: 64px;
      color: var(--secondary-text);
      font-size: 12px; font-weight: 500;
    }
    .input { flex: 1; padding: 7px 12px; font-size: 13px; background: #fff; }   // 内部 input 更白让层次出来
    .input.mono { font-family: 'JetBrains Mono', monospace; letter-spacing: 0.3px; }
  }
}

.gen-options {
  display: flex; gap: 18px;
  padding: 10px 16px;
  background: var(--input-bg);             // 不透明奶油白
  border: 1px solid var(--border-color);
  border-radius: var(--radius-pill);

  .check {
    display: inline-flex; align-items: center; gap: 7px;
    font-size: 12.5px; color: var(--primary-text);
    cursor: pointer;
    user-select: none;
    transition: color 0.15s;
    &:hover { color: var(--button-bg); }
  }
}

// 工具区整体容器 — 不透明奶油白底，跟 input 视觉融合
.gen-tools-wrap {
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  overflow: hidden;
  background: var(--input-bg);   // 同 input-bg 不透明
}

.gen-toolbar {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 12px;
  background: rgba(212, 116, 142, 0.05);     // 极淡粉色调（在不透明底色上是粉色，不会变灰）
  border-bottom: 1px solid var(--border-color);

  .input {
    flex: 1; font-size: 12.5px; padding: 6px 12px;
    border-radius: var(--radius-pill);
    background: #fff;
  }
  .btn.compact { font-size: 12px; padding: 5px 12px; border-radius: var(--radius-pill); }
  .muted {
    color: var(--button-bg);
    font-weight: 600;
    font-size: 11.5px;
    margin-left: 2px;
    white-space: nowrap;
    background: #fff;
    padding: 3px 10px;
    border-radius: var(--radius-pill);
    font-family: 'JetBrains Mono', monospace;
  }
}

.gen-tools {
  max-height: 360px; overflow-y: auto;
  background: transparent;   // 透明，让外层 wrap 的玻璃白透出
}

.gen-group {
  &:not(:last-child) {
    border-bottom: 1px dashed var(--border-color);
  }

  > header {
    display: flex; align-items: center; gap: 8px;
    padding: 10px 14px;
    background: transparent;     // 透明
    cursor: pointer; user-select: none;
    font-size: 12.5px;
    transition: background 0.15s;
    &:hover { background: rgba(212, 116, 142, 0.05); }

    .arrow {
      font-size: 18px; color: var(--button-bg);
      transition: transform 0.18s ease;
      &:not(.open) { transform: rotate(-90deg); }
    }
    strong { color: var(--primary-text); font-size: 13px; }
    .plugin-name {
      color: var(--secondary-text);
      font-size: 11px;
      font-family: 'JetBrains Mono', monospace;
      opacity: 0.7;
    }
    .spacer { flex: 1; }
    .count {
      font-size: 11px; font-family: 'JetBrains Mono', monospace;
      color: var(--button-bg); font-weight: 600;
      padding: 2px 9px;
      background: rgba(255, 255, 255, 0.7);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-pill);
    }
    .btn.mini {
      font-size: 11px; padding: 3px 10px;
      border-radius: var(--radius-pill);
    }
  }

  .tool-list {
    list-style: none; padding: 4px 8px 8px;
    margin: 0;
    display: flex; flex-direction: column; gap: 4px;
    background: transparent;
  }
}

.tool-item {
  display: flex; align-items: flex-start; gap: 10px;
  padding: 8px 10px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all 0.15s;

  &:hover {
    background: #fff;                      // 不透明白 hover
    border-color: var(--border-color);
  }
  &.selected {
    background: rgba(212, 116, 142, 0.1);  // 在 input-bg 底上叠淡粉
    border-color: var(--button-bg);
  }

  > input[type="checkbox"] { margin-top: 2px; }

  .info { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 2px; }
  .tool-name {
    font-size: 12px;
    color: var(--highlight-text);
    background: transparent;
    padding: 0;
    font-family: 'JetBrains Mono', monospace;
    font-weight: 600;
  }
  .tool-desc {
    margin: 0; font-size: 11px;
    color: var(--secondary-text);
    line-height: 1.5;
    display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2;
    -webkit-box-orient: vertical; overflow: hidden;
  }
}

// ===== 原始源码弹窗 =====
.raw-stat {
  display: flex; justify-content: space-between; align-items: center;
  padding: 8px 0 0; font-size: 11px; color: var(--secondary-text); font-family: monospace;
  .dirty { color: #f1ae28; font-weight: 500; }
}

// ===== 新建对话框 =====
.create-form { display: flex; flex-direction: column; gap: 10px; }
.form-row {
  display: flex; align-items: center; gap: 8px; font-size: 13px;
  label { min-width: 60px; color: var(--secondary-text); }
  .input { flex: 1; }
  .input.mono { font-family: 'JetBrains Mono', monospace; }
}
</style>
