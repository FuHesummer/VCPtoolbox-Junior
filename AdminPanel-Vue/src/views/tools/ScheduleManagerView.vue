<template>
  <div class="page">
    <PageHeader title="日程管理" subtitle="定时任务" icon="calendar_month">
      <template #actions>
        <button class="btn" @click="createNew.open = true"><span class="material-symbols-outlined">add</span> 新建</button>
        <button class="btn btn-ghost" @click="reload" :disabled="loading"><span class="material-symbols-outlined">refresh</span></button>
      </template>
    </PageHeader>

    <div class="content">
      <EmptyState v-if="!schedules.length && !loading" icon="event_busy" message="暂无日程" />
      <div v-else class="list">
        <div v-for="s in schedules" :key="s.id" class="card item">
          <div class="main">
            <strong>{{ s.content }}</strong>
            <span class="time">{{ s.time }}</span>
          </div>
          <button class="btn btn-danger" @click="remove(s.id)">
            <span class="material-symbols-outlined">delete</span>
          </button>
        </div>
      </div>
    </div>

    <BaseModal v-model="createNew.open" title="新建日程">
      <div class="form">
        <label>时间（ISO 或 cron 表达式）</label>
        <input v-model="createNew.time" placeholder="2026-04-15T10:00:00 或 0 */3 * * *" />
        <label>内容</label>
        <textarea v-model="createNew.content" rows="4" />
      </div>
      <template #footer>
        <button class="btn btn-ghost" @click="createNew.open = false">取消</button>
        <button class="btn" @click="submit" :disabled="!createNew.time || !createNew.content">创建</button>
      </template>
    </BaseModal>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import PageHeader from '@/components/common/PageHeader.vue'
import EmptyState from '@/components/common/EmptyState.vue'
import BaseModal from '@/components/common/BaseModal.vue'
import { listSchedules, createSchedule, deleteSchedule } from '@/api/schedules'
import type { Schedule } from '@/api/types'
import { useUiStore } from '@/stores/ui'
import { useConfirm } from '@/composables/useConfirm'

const ui = useUiStore()
const { confirm } = useConfirm()

const schedules = ref<Schedule[]>([])
const loading = ref(false)
const createNew = reactive({ open: false, time: '', content: '' })

async function reload() {
  loading.value = true
  try {
    const data = await listSchedules()
    schedules.value = data.schedules || []
  } finally { loading.value = false }
}

async function submit() {
  try {
    await createSchedule(createNew.time, createNew.content)
    ui.showMessage('已创建', 'success')
    createNew.open = false
    createNew.time = ''
    createNew.content = ''
    reload()
  } catch { /* */ }
}

async function remove(id: string) {
  const ok = await confirm('确定删除此日程？', { danger: true })
  if (!ok) return
  try {
    await deleteSchedule(id)
    ui.showMessage('已删除', 'success')
    reload()
  } catch { /* */ }
}

onMounted(reload)
</script>

<style lang="scss" scoped>
.content { padding: 0 24px 24px; }
.list { display: flex; flex-direction: column; gap: 8px; }
.item {
  padding: 12px 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;

  .main {
    display: flex;
    flex-direction: column;
    gap: 4px;
    flex: 1;
    min-width: 0;

    strong { color: var(--primary-text); font-size: 14px; }
    .time { font-size: 12px; color: var(--secondary-text); font-family: 'JetBrains Mono', Consolas, monospace; }
  }
}

.form {
  display: flex;
  flex-direction: column;
  gap: 8px;

  label { font-size: 13px; color: var(--secondary-text); }
  input, textarea { padding: 8px 12px; }
}
</style>
