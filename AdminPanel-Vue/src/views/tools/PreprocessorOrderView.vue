<template>
  <div class="page">
    <PageHeader title="预处理器排序" subtitle="调整 messagePreprocessor 插件的执行顺序（拖拽排序）" icon="swap_vert">
      <template #actions>
        <button class="btn btn-ghost" @click="reload" :disabled="loading">
          <span class="material-symbols-outlined" :class="{ spin: loading }">refresh</span>
          刷新
        </button>
        <button class="btn" @click="save" :disabled="!dirty">
          <span v-if="dirty" class="material-symbols-outlined">save</span>
          保存{{ dirty ? ' *' : '' }}
        </button>
      </template>
    </PageHeader>

    <div class="po-content">
      <div class="hint-banner">
        <span class="material-symbols-outlined">info</span>
        <span>
          预处理器按此顺序逐个执行，后者看到的是前者处理过的消息。
          拖动 <span class="material-symbols-outlined inline">drag_indicator</span> 调整顺序，保存后立即热重载。
        </span>
      </div>

      <div class="po-card card">
        <EmptyState v-if="!items.length && !loading" icon="drag_indicator" message="暂无预处理器插件" />

        <ul v-else class="sortable">
          <li
            v-for="(item, idx) in items"
            :key="item.name"
            draggable="true"
            class="so-item"
            :class="{ dragging: dragIndex === idx, 'drop-before': dropHint?.at === idx && dropHint?.where === 'before', 'drop-after': dropHint?.at === idx && dropHint?.where === 'after' }"
            @dragstart="onDragStart(idx, $event)"
            @dragover="onDragOver(idx, $event)"
            @dragleave="onDragLeave"
            @drop="onDrop(idx, $event)"
            @dragend="onDragEnd"
          >
            <span class="material-symbols-outlined handle">drag_indicator</span>
            <span class="idx">{{ idx + 1 }}</span>
            <div class="info">
              <strong class="name">{{ item.displayName || item.name }}</strong>
              <code v-if="item.displayName && item.displayName !== item.name" class="raw">{{ item.name }}</code>
              <p v-if="item.description" class="desc">{{ item.description }}</p>
            </div>
            <div class="order-arrows">
              <button
                class="arrow-btn"
                :disabled="idx === 0"
                @click="moveUp(idx)"
                title="上移"
              >
                <span class="material-symbols-outlined">keyboard_arrow_up</span>
              </button>
              <button
                class="arrow-btn"
                :disabled="idx === items.length - 1"
                @click="moveDown(idx)"
                title="下移"
              >
                <span class="material-symbols-outlined">keyboard_arrow_down</span>
              </button>
            </div>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import PageHeader from '@/components/common/PageHeader.vue'
import EmptyState from '@/components/common/EmptyState.vue'
import { getPreprocessorOrder, savePreprocessorOrder, type PreprocessorItem } from '@/api/config'
import { useUiStore } from '@/stores/ui'

const ui = useUiStore()
const items = ref<PreprocessorItem[]>([])
const originalNames = ref<string>('')
const dragIndex = ref<number | null>(null)
const dropHint = ref<{ at: number; where: 'before' | 'after' } | null>(null)
const loading = ref(false)

const currentNames = computed(() => items.value.map((x) => x.name).join(','))
const dirty = computed(() => currentNames.value !== originalNames.value)

async function reload() {
  loading.value = true
  try {
    const data = await getPreprocessorOrder()
    items.value = data.order || []
    originalNames.value = currentNames.value
  } finally { loading.value = false }
}

function onDragStart(i: number, e: DragEvent) {
  dragIndex.value = i
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(i))
  }
}

function onDragOver(i: number, e: DragEvent) {
  e.preventDefault()
  if (dragIndex.value === null || dragIndex.value === i) return
  const target = e.currentTarget as HTMLElement
  const rect = target.getBoundingClientRect()
  const mid = rect.top + rect.height / 2
  dropHint.value = { at: i, where: e.clientY < mid ? 'before' : 'after' }
}

function onDragLeave() {
  // 短暂的 leave 不清空，交给 dragend 统一清理（避免闪烁）
}

function onDragEnd() {
  dragIndex.value = null
  dropHint.value = null
}

function onDrop(to: number, e: DragEvent) {
  e.preventDefault()
  if (dragIndex.value === null || dragIndex.value === to) {
    onDragEnd()
    return
  }
  const arr = [...items.value]
  const [moved] = arr.splice(dragIndex.value, 1)
  // 按 dropHint 决定插入位置（before = 原 to 位置，after = to 之后）
  let insertAt = to
  if (dropHint.value?.where === 'after') insertAt = to + 1
  if (dragIndex.value < to) insertAt--  // 源在目标前，移除后 insertAt 要前移
  arr.splice(insertAt, 0, moved)
  items.value = arr
  onDragEnd()
}

function moveUp(i: number) {
  if (i === 0) return
  const arr = [...items.value]
  ;[arr[i - 1], arr[i]] = [arr[i], arr[i - 1]]
  items.value = arr
}

function moveDown(i: number) {
  if (i === items.value.length - 1) return
  const arr = [...items.value]
  ;[arr[i], arr[i + 1]] = [arr[i + 1], arr[i]]
  items.value = arr
}

async function save() {
  try {
    const resp = await savePreprocessorOrder(items.value.map((x) => x.name))
    // 热重载后后端返回最新 order，用它同步本地
    if (resp.newOrder) items.value = resp.newOrder
    originalNames.value = currentNames.value
    ui.showMessage('顺序已保存并热重载', 'success')
  } catch { /* */ }
}

onMounted(reload)
</script>

<style lang="scss" scoped>
.po-content {
  padding: 0 24px 24px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.hint-banner {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 14px;
  background: rgba(212, 116, 142, 0.06);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  font-size: 12px;
  color: var(--secondary-text);
  line-height: 1.6;

  > .material-symbols-outlined { font-size: 16px; color: var(--highlight-text); margin-top: 2px; }

  .inline {
    font-size: 14px;
    vertical-align: middle;
    color: var(--highlight-text);
  }
}

.po-card { padding: 16px; }

.sortable {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.so-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  background: var(--tertiary-bg);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  cursor: grab;
  transition: transform 0.15s, box-shadow 0.15s, opacity 0.15s, border-color 0.15s;

  &:hover {
    box-shadow: 0 3px 12px rgba(180, 120, 140, 0.1);
    border-color: var(--highlight-text);
  }

  &:active { cursor: grabbing; }
  &.dragging { opacity: 0.4; }

  // 拖放位置指示器（before 顶边 / after 底边 高亮粉线）
  &.drop-before::before,
  &.drop-after::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    height: 3px;
    background: var(--button-bg);
    border-radius: 2px;
    box-shadow: 0 0 8px rgba(212, 116, 142, 0.5);
  }

  &.drop-before::before { top: -5px; }
  &.drop-after::after { bottom: -5px; }

  .handle {
    color: var(--secondary-text);
    cursor: grab;
    font-size: 20px;
    opacity: 0.6;
    transition: opacity 0.15s;
  }

  &:hover .handle { opacity: 1; }

  .idx {
    flex-shrink: 0;
    font-size: 11px;
    color: var(--highlight-text);
    background: var(--accent-bg);
    padding: 3px 10px;
    border-radius: var(--radius-pill);
    font-family: 'JetBrains Mono', Consolas, monospace;
    font-weight: 600;
    min-width: 32px;
    text-align: center;
  }

  .info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;

    .name {
      font-size: 14px;
      color: var(--primary-text);
    }

    .raw {
      font-size: 10px;
      color: var(--secondary-text);
      font-family: 'JetBrains Mono', Consolas, monospace;
      background: var(--card-bg);
      padding: 1px 6px;
      border-radius: var(--radius-sm);
      width: fit-content;
      opacity: 0.7;
    }

    .desc {
      margin: 2px 0 0;
      font-size: 11px;
      color: var(--secondary-text);
      line-height: 1.5;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
  }

  .order-arrows {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex-shrink: 0;
    opacity: 0;
    transition: opacity 0.15s;
  }

  &:hover .order-arrows { opacity: 1; }
}

.arrow-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 20px;
  padding: 0;
  background: transparent;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  color: var(--secondary-text);
  cursor: pointer;
  transition: all 0.15s;

  &:hover:not(:disabled) {
    border-color: var(--highlight-text);
    color: var(--highlight-text);
    background: var(--accent-bg);
  }

  &:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

  .material-symbols-outlined { font-size: 14px; }
}

.spin { animation: spin 1s linear infinite; }

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>
