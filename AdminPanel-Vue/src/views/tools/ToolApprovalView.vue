<template>
  <div class="page">
    <PageHeader title="工具调用审核" subtitle="配置哪些工具需要人工批准才能执行" icon="verified">
      <template #actions>
        <button class="btn" @click="save" :disabled="!dirty">保存</button>
      </template>
    </PageHeader>

    <div class="content card">
      <div class="row">
        <label class="toggle-row">
          <input type="checkbox" v-model="config.enabled" />
          <span>启用调用审核</span>
        </label>
      </div>
      <div class="row">
        <label>超时（分钟）</label>
        <input v-model.number="config.timeoutMinutes" type="number" min="1" />
      </div>
      <div class="row">
        <label class="toggle-row">
          <input type="checkbox" v-model="config.approveAll" />
          <span>默认批准所有工具（黑名单模式）</span>
        </label>
      </div>
      <div class="row">
        <label>{{ config.approveAll ? '黑名单' : '白名单' }}（每行一个工具名）</label>
        <CodeEditor v-model="listText" :rows="14" placeholder="ToolName1&#10;ToolName2" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import PageHeader from '@/components/common/PageHeader.vue'
import CodeEditor from '@/components/common/CodeEditor.vue'
import { getToolApprovalConfig, saveToolApprovalConfig, type ToolApprovalConfig } from '@/api/config'
import { useUiStore } from '@/stores/ui'

const ui = useUiStore()
const config = ref<ToolApprovalConfig>({ enabled: false, timeoutMinutes: 10, approveAll: false, approvalList: [] })
const originalJson = ref('')

const listText = computed({
  get: () => (config.value.approvalList || []).join('\n'),
  set: (v: string) => { config.value.approvalList = v.split(/\r?\n/).map((s) => s.trim()).filter(Boolean) },
})

const dirty = computed(() => JSON.stringify(config.value) !== originalJson.value)

async function reload() {
  const data = await getToolApprovalConfig()
  config.value = { enabled: false, timeoutMinutes: 10, approveAll: false, approvalList: [], ...data }
  originalJson.value = JSON.stringify(config.value)
}

async function save() {
  try {
    await saveToolApprovalConfig(config.value)
    originalJson.value = JSON.stringify(config.value)
    ui.showMessage('已保存', 'success')
  } catch { /* */ }
}

onMounted(reload)
</script>

<style lang="scss" scoped>
.content { margin: 0 24px 24px; padding: 20px; display: flex; flex-direction: column; gap: 16px; }
.row { display: flex; flex-direction: column; gap: 6px; }
.row label { font-size: 13px; color: var(--secondary-text); }
.row input[type="number"] { width: 120px; }
.toggle-row { flex-direction: row; gap: 10px; align-items: center; color: var(--primary-text); }
</style>
