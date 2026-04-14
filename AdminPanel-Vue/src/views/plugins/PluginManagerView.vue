<template>
  <div class="page">
    <PageHeader title="插件管理" subtitle="已安装插件的启用 / 配置 / 描述" icon="extension">
      <template #actions>
        <input v-model="keyword" type="text" placeholder="搜索插件..." class="search" />
        <button class="btn btn-ghost" @click="reload" :disabled="loading">
          <span class="material-symbols-outlined">refresh</span>
          刷新
        </button>
      </template>
    </PageHeader>

    <div class="pm-content">
      <ServiceWarn v-if="serviceError" title="无法连接到主服务" icon="cloud_off">
        插件管理需要主服务在线（<code>PORT 6005</code>）。请先运行 <code>node server.js</code> 启动主服务后再刷新此页面。
      </ServiceWarn>

      <section v-if="enabled.length">
        <h4 class="cat-title">已启用 <span class="cat-count">({{ enabled.length }})</span></h4>
        <div class="card-grid">
          <PluginCard v-for="p in enabled" :key="p.manifest.name" :plugin="p" :ui-prefs="uiPrefs[p.manifest.name]" @toggle="onToggle" @open="openPlugin" />
        </div>
      </section>

      <section v-if="disabled.length">
        <h4 class="cat-title">已禁用 <span class="cat-count">({{ disabled.length }})</span></h4>
        <div class="card-grid">
          <PluginCard v-for="p in disabled" :key="p.manifest.name" :plugin="p" :ui-prefs="uiPrefs[p.manifest.name]" @toggle="onToggle" @open="openPlugin" />
        </div>
      </section>

      <EmptyState v-if="!filtered.length && !loading" icon="extension_off" message="没有匹配的插件" />
    </div>

    <BaseModal v-model="modalOpen" :title="active?.manifest.displayName || active?.manifest.name || '插件配置'" width="720px">
      <div v-if="active" class="config-editor">
        <Tabs :tabs="editorTabs" v-model:active="activeTab">
          <template #default="{ active: tab }">
            <div v-if="tab === 'config'">
              <div class="config-head">
                <p class="hint">编辑该插件的 config.env（保存后会立即覆盖运行时配置）</p>
                <button
                  type="button"
                  class="btn btn-ghost btn-sm"
                  :class="{ 'btn-danger': pluginConfigRawMode }"
                  @click="togglePluginConfigRawMode"
                >
                  <span class="material-symbols-outlined">{{ pluginConfigRawMode ? 'view_module' : 'data_object' }}</span>
                  {{ pluginConfigRawMode ? '表单模式' : '原文模式' }}
                </button>
              </div>

              <div v-if="active?.configEnvFromExample" class="example-banner">
                <span class="material-symbols-outlined">info</span>
                当前内容来自 <code>config.env.example</code> 模板 — 保存后会在插件目录创建 <code>config.env</code>
              </div>

              <EmptyState
                v-if="!pluginConfigRawMode && pluginConfigEntries.length === 0"
                icon="settings_applications"
                message="此插件没有 config.env 也没有 config.env.example，配置可能统一在根目录 config.env — 可切到原文模式手动新增"
              />

              <div v-else-if="!pluginConfigRawMode" class="plugin-fields">
                <EnvField
                  v-for="x in pluginConfigEntries"
                  :key="x.idx + '-' + x.entry.key"
                  :entry="x.entry"
                  @update:value="(v) => updatePluginConfigValue(x.idx, v)"
                />
              </div>

              <CodeEditor v-else v-model="editingContent" :rows="16" placeholder="KEY=VALUE" />
            </div>
            <div v-else-if="tab === 'description'">
              <p class="hint">描述会展示在插件列表和系统提示里</p>
              <textarea v-model="editingDescription" rows="6" class="desc-input" />
            </div>
            <div v-else-if="tab === 'ui'">
              <p class="hint">控制该插件在管理面板中的 UI 扩展是否显示</p>
              <label class="toggle-row">
                <input type="checkbox" v-model="editingUiPrefs.dashboardCards" :disabled="!(active?.manifest.dashboardCards?.length)" />
                <span>仪表盘卡片（dashboardCards）</span>
                <small v-if="!active?.manifest.dashboardCards?.length">此插件未声明</small>
              </label>
              <label class="toggle-row">
                <input type="checkbox" v-model="editingUiPrefs.adminNav" :disabled="!active?.manifest.adminNav" />
                <span>侧边栏导航（adminNav）</span>
                <small v-if="!active?.manifest.adminNav">此插件未声明</small>
              </label>
            </div>
            <div v-else-if="tab === 'info'">
              <dl class="info-grid">
                <dt>名称</dt><dd>{{ active.manifest.name }}</dd>
                <dt>显示名</dt><dd>{{ active.manifest.displayName || '—' }}</dd>
                <dt>版本</dt><dd>{{ active.manifest.version || '—' }}</dd>
                <dt>类型</dt><dd>{{ active.manifest.pluginType || '—' }}</dd>
                <dt>有管理页</dt><dd>{{ active.hasAdminPage ? '是（自定义 admin/index.html）' : '否' }}</dd>
                <dt>configSchema</dt><dd>{{ active.hasConfigSchema ? '已声明' : '—' }}</dd>
                <dt>requires</dt><dd>{{ active.manifest.requires?.join(', ') || '—' }}</dd>
              </dl>
            </div>
          </template>
        </Tabs>
      </div>
      <template #footer>
        <button class="btn btn-ghost" @click="modalOpen = false">取消</button>
        <button class="btn" @click="saveAll" :disabled="!active">保存</button>
      </template>
    </BaseModal>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, reactive, watch } from 'vue'
import PageHeader from '@/components/common/PageHeader.vue'
import EmptyState from '@/components/common/EmptyState.vue'
import BaseModal from '@/components/common/BaseModal.vue'
import Tabs from '@/components/common/Tabs.vue'
import CodeEditor from '@/components/common/CodeEditor.vue'
import EnvField from '@/components/config/EnvField.vue'
import PluginCard from '@/components/plugins/PluginCard.vue'
import ServiceWarn from '@/components/common/ServiceWarn.vue'
import { listPlugins, togglePlugin, savePluginConfig, updatePluginDescription, getPluginUiPrefs, savePluginUiPrefs } from '@/api/plugins'
import type { PluginInfo, PluginUiPrefs } from '@/api/types'
import { useUiStore } from '@/stores/ui'
import { parseEnv, buildEnv, type EnvItem, type EnvEntry } from '@/utils/envParser'

const ui = useUiStore()
const plugins = ref<PluginInfo[]>([])
const uiPrefs = ref<PluginUiPrefs>({})
const keyword = ref('')
const loading = ref(false)
const serviceError = ref(false)
const modalOpen = ref(false)
const active = ref<PluginInfo | null>(null)
const activeTab = ref('config')
const editingContent = ref('')
const editingDescription = ref('')
const editingUiPrefs = reactive<{ dashboardCards: boolean; adminNav: boolean }>({ dashboardCards: true, adminNav: true })

// 插件 config 表单模式 / 原文模式
const pluginConfigRawMode = ref(false)
const pluginConfigItems = ref<EnvItem[]>([])

const pluginConfigEntries = computed(() => {
  const result: Array<{ entry: EnvEntry; idx: number }> = []
  pluginConfigItems.value.forEach((it, idx) => {
    if (it.kind === 'entry') result.push({ entry: it, idx })
  })
  return result
})

function updatePluginConfigValue(idx: number, v: string) {
  const it = pluginConfigItems.value[idx]
  if (it && it.kind === 'entry') {
    it.value = v
    editingContent.value = buildEnv(pluginConfigItems.value)
  }
}

function togglePluginConfigRawMode() {
  if (pluginConfigRawMode.value) {
    // 原文 → 表单：重新解析原文
    pluginConfigItems.value = parseEnv(editingContent.value)
    pluginConfigRawMode.value = false
  } else {
    // 表单 → 原文：用当前 items 重建原文
    editingContent.value = buildEnv(pluginConfigItems.value)
    pluginConfigRawMode.value = true
  }
}

const editorTabs = [
  { key: 'config', label: '配置' },
  { key: 'description', label: '描述' },
  { key: 'ui', label: 'UI 扩展' },
  { key: 'info', label: '信息' },
]

const filtered = computed(() => {
  if (!keyword.value.trim()) return plugins.value
  const kw = keyword.value.toLowerCase()
  return plugins.value.filter((p) =>
    p.manifest.name.toLowerCase().includes(kw)
    || (p.manifest.displayName || '').toLowerCase().includes(kw)
    || (p.manifest.description || '').toLowerCase().includes(kw),
  )
})

const enabled = computed(() => filtered.value.filter((p) => p.enabled).sort(sortFn))
const disabled = computed(() => filtered.value.filter((p) => !p.enabled).sort(sortFn))

function sortFn(a: PluginInfo, b: PluginInfo) {
  return (a.manifest.displayName || a.manifest.name).localeCompare(b.manifest.displayName || b.manifest.name)
}

async function reload() {
  loading.value = true
  serviceError.value = false
  try {
    const [list, prefs] = await Promise.all([
      listPlugins({ suppressErrorToast: true }),
      getPluginUiPrefs({ suppressErrorToast: true }).catch(() => ({} as PluginUiPrefs)),
    ])
    plugins.value = list as PluginInfo[]
    uiPrefs.value = prefs as PluginUiPrefs
  } catch (e) {
    plugins.value = []
    serviceError.value = true
    const err = e as Error & { status?: number }
    if (err.status !== 504 && err.status !== 502 && err.status !== 503) {
      ui.showMessage('加载失败: ' + err.message, 'error')
    }
  } finally {
    loading.value = false
  }
}

async function onToggle(p: PluginInfo, enabledVal: boolean) {
  try {
    await togglePlugin(p.manifest.name, enabledVal)
    ui.showMessage(`${p.manifest.displayName || p.manifest.name} 已${enabledVal ? '启用' : '禁用'}`, 'success')
    reload()
  } catch { /* apiFetch 已报错 */ }
}

function openPlugin(p: PluginInfo) {
  active.value = p
  editingContent.value = p.configEnvContent || ''
  editingDescription.value = p.manifest.description || ''
  pluginConfigItems.value = parseEnv(editingContent.value)
  pluginConfigRawMode.value = false
  const prefs = uiPrefs.value[p.manifest.name] || {}
  editingUiPrefs.dashboardCards = prefs.dashboardCards !== false
  editingUiPrefs.adminNav = prefs.adminNav !== false
  activeTab.value = 'config'
  modalOpen.value = true
}

async function saveAll() {
  if (!active.value) return
  const name = active.value.manifest.name
  const originalDesc = active.value.manifest.description || ''
  try {
    const tasks: Promise<unknown>[] = []
    if (editingContent.value !== (active.value.configEnvContent || '')) {
      tasks.push(savePluginConfig(name, editingContent.value))
    }
    if (editingDescription.value !== originalDesc) {
      tasks.push(updatePluginDescription(name, editingDescription.value))
    }
    const prevPrefs = uiPrefs.value[name] || {}
    const nextPrefs = { ...prevPrefs, dashboardCards: editingUiPrefs.dashboardCards, adminNav: editingUiPrefs.adminNav }
    if (prevPrefs.dashboardCards !== nextPrefs.dashboardCards || prevPrefs.adminNav !== nextPrefs.adminNav) {
      const allPrefs = { ...uiPrefs.value, [name]: nextPrefs }
      tasks.push(savePluginUiPrefs(allPrefs))
    }
    if (tasks.length === 0) {
      ui.showMessage('没有修改需要保存', 'info')
    } else {
      await Promise.all(tasks)
      ui.showMessage('保存成功', 'success')
      modalOpen.value = false
      reload()
    }
  } catch { /* apiFetch 已报错 */ }
}

watch(modalOpen, (v) => { if (!v) active.value = null })

onMounted(reload)
</script>

<style lang="scss" scoped>
.pm-content {
  padding: 0 24px 24px;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.search {
  padding: 6px 12px;
  border-radius: var(--radius-pill);
  font-size: 13px;
  width: 200px;
}

.cat-title {
  margin: 0 0 12px;
  font-size: 14px;
  color: var(--secondary-text);

  .cat-count {
    font-size: 12px;
    color: var(--highlight-text);
    margin-left: 6px;
  }
}

.card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 12px;
}

.hint {
  margin: 0 0 8px;
  font-size: 12px;
  color: var(--secondary-text);
}

.config-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;

  .hint { margin: 0; flex: 1; }

  .btn-sm {
    padding: 4px 10px;
    font-size: 12px;

    .material-symbols-outlined { font-size: 15px; }
  }
}

.plugin-fields {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: 520px;
  overflow-y: auto;
  padding-right: 4px;
}

.example-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  margin-bottom: 10px;
  background: rgba(212, 116, 142, 0.08);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  font-size: 12px;
  color: var(--highlight-text);

  .material-symbols-outlined { font-size: 16px; }

  code {
    font-family: 'JetBrains Mono', Consolas, monospace;
    background: var(--accent-bg);
    padding: 1px 6px;
    border-radius: var(--radius-sm);
    font-size: 11px;
  }
}

.desc-input {
  width: 100%;
  resize: vertical;
  padding: 10px 12px;
}

.toggle-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 0;
  border-bottom: 1px dashed var(--border-color);

  &:last-child { border: none; }

  small { color: var(--secondary-text); font-size: 11px; margin-left: auto; }
}

.info-grid {
  display: grid;
  grid-template-columns: 120px 1fr;
  gap: 8px 12px;
  margin: 0;

  dt { color: var(--secondary-text); font-size: 13px; }
  dd { margin: 0; font-size: 13px; color: var(--primary-text); }
}
</style>
