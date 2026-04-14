<template>
  <div class="page log-viewer">
    <PageHeader title="服务器日志" subtitle="实时追踪 server.js 输出" icon="description">
      <template #actions>
        <label class="auto-refresh">
          <input type="checkbox" v-model="autoRefresh" />
          <span>自动刷新</span>
        </label>
        <button class="btn btn-ghost" @click="copyAll">
          <span class="material-symbols-outlined">content_copy</span>
        </button>
        <button class="btn btn-ghost" @click="() => reload(false)" :disabled="loading">
          <span class="material-symbols-outlined">refresh</span>
        </button>
        <button class="btn btn-ghost" @click="clear">
          <span class="material-symbols-outlined">delete</span>
        </button>
      </template>
    </PageHeader>

    <div class="log-body">
      <pre ref="pre" class="log-pre">{{ content || '（暂无日志）' }}</pre>
    </div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import PageHeader from '@/components/common/PageHeader.vue'
import { getServerLog } from '@/api/system'
import { useUiStore } from '@/stores/ui'

const ui = useUiStore()
const content = ref('')
const autoRefresh = ref(true)
const loading = ref(false)
const pre = ref<HTMLElement>()
let offset = 0
let timer: number | null = null

async function reload(fullReload = false) {
  loading.value = true
  try {
    if (fullReload) { content.value = ''; offset = 0 }
    const data = await getServerLog(offset, offset > 0)
    if (data.needFullReload) { content.value = data.content; offset = data.offset }
    else if (offset === 0) { content.value = data.content; offset = data.offset }
    else { content.value += data.content; offset = data.offset }
    await nextTick()
    if (pre.value) pre.value.scrollTop = pre.value.scrollHeight
  } finally { loading.value = false }
}

function clear() { content.value = ''; offset = 0 }

function copyAll() {
  navigator.clipboard.writeText(content.value).then(() => ui.showMessage('日志已复制', 'success', 1500))
}

watch(autoRefresh, (v) => {
  if (v) timer = window.setInterval(() => reload(false), 3000)
  else if (timer) { clearInterval(timer); timer = null }
})

onMounted(() => {
  reload(true)
  if (autoRefresh.value) timer = window.setInterval(() => reload(false), 3000)
})

onBeforeUnmount(() => { if (timer) clearInterval(timer) })
</script>

<style lang="scss" scoped>
.log-viewer { display: flex; flex-direction: column; height: 100%; }

.log-body { flex: 1; margin: 0 24px 24px; min-height: 400px; }

.log-pre {
  width: 100%;
  height: 100%;
  min-height: 500px;
  background: #1e1e1e;
  color: #d4d4d4;
  padding: 12px;
  border-radius: var(--radius-md);
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-all;
  overflow-y: auto;
  margin: 0;
}

.auto-refresh {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  color: var(--primary-text);
}
</style>
