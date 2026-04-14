<template>
  <div class="page">
    <PageHeader title="预处理器排序" subtitle="调整 messagePreprocessor 插件的执行顺序（拖拽）" icon="swap_vert">
      <template #actions>
        <button class="btn" @click="save" :disabled="!dirty">保存</button>
      </template>
    </PageHeader>

    <div class="content card">
      <EmptyState v-if="!order.length" icon="drag_handle" message="暂无预处理器" />
      <ul v-else class="sortable">
        <li
          v-for="(name, idx) in order"
          :key="name"
          draggable="true"
          @dragstart="onDragStart(idx, $event)"
          @dragover.prevent
          @drop="onDrop(idx, $event)"
          :class="{ dragging: dragIndex === idx }"
        >
          <span class="material-symbols-outlined handle">drag_handle</span>
          <span class="idx">{{ idx + 1 }}</span>
          <strong>{{ name }}</strong>
        </li>
      </ul>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import PageHeader from '@/components/common/PageHeader.vue'
import EmptyState from '@/components/common/EmptyState.vue'
import { getPreprocessorOrder, savePreprocessorOrder } from '@/api/config'
import { useUiStore } from '@/stores/ui'

const ui = useUiStore()
const order = ref<string[]>([])
const originalJson = ref('')
const dragIndex = ref<number | null>(null)

const dirty = computed(() => JSON.stringify(order.value) !== originalJson.value)

async function reload() {
  const { order: o } = await getPreprocessorOrder()
  order.value = o || []
  originalJson.value = JSON.stringify(order.value)
}

function onDragStart(i: number, e: DragEvent) {
  dragIndex.value = i
  e.dataTransfer!.effectAllowed = 'move'
}

function onDrop(to: number, _e: DragEvent) {
  if (dragIndex.value === null || dragIndex.value === to) return
  const arr = [...order.value]
  const [item] = arr.splice(dragIndex.value, 1)
  arr.splice(to, 0, item)
  order.value = arr
  dragIndex.value = null
}

async function save() {
  try {
    await savePreprocessorOrder(order.value)
    originalJson.value = JSON.stringify(order.value)
    ui.showMessage('顺序已保存', 'success')
  } catch { /* */ }
}

onMounted(reload)
</script>

<style lang="scss" scoped>
.content { margin: 0 24px 24px; padding: 16px; }

.sortable {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;

  li {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 14px;
    background: var(--tertiary-bg);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    cursor: move;
    transition: transform 0.15s, box-shadow 0.15s;

    &:hover { box-shadow: 0 2px 8px rgba(180, 120, 140, 0.1); }
    &.dragging { opacity: 0.5; }

    .handle { color: var(--secondary-text); cursor: grab; }
    .idx { font-size: 11px; color: var(--highlight-text); background: var(--accent-bg); padding: 2px 8px; border-radius: var(--radius-pill); }
    strong { color: var(--primary-text); font-size: 14px; }
  }
}
</style>
