<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="modelValue" class="modal-backdrop" @click.self="close">
        <div class="modal-card card" :style="{ maxWidth: width }">
          <header class="modal-header">
            <h3>{{ title }}</h3>
            <button class="close-btn" @click="close" aria-label="关闭">
              <span class="material-symbols-outlined">close</span>
            </button>
          </header>
          <div class="modal-body">
            <slot />
          </div>
          <footer v-if="$slots.footer" class="modal-footer">
            <slot name="footer" />
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  modelValue: boolean
  title?: string
  width?: string
}>(), { title: '', width: '520px' })

const emit = defineEmits<{
  'update:modelValue': [v: boolean]
}>()

function close() {
  emit('update:modelValue', false)
}
</script>

<style lang="scss" scoped>
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(61, 44, 62, 0.4);
  backdrop-filter: blur(4px);
  z-index: 9998;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}

.modal-card {
  width: 100%;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  padding: 0;
  overflow: hidden;
  // 覆盖 .card 的半透明白 — 改用奶油白不透明底，避免透出蒙层变灰扑扑
  background: var(--input-bg);
  border: 1px solid var(--border-color);
  box-shadow: 0 10px 40px rgba(180, 120, 140, 0.18);
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-color);
  background: linear-gradient(135deg, rgba(212, 116, 142, 0.06), transparent);

  h3 {
    margin: 0;
    font-size: 16px;
    color: var(--primary-text);
  }
}

.close-btn {
  background: transparent;
  border: none;
  cursor: pointer;
  color: var(--secondary-text);
  padding: 4px;
  border-radius: var(--radius-sm);
  display: flex;
  align-items: center;
  justify-content: center;

  &:hover { background: var(--accent-bg); color: var(--primary-text); }
}

.modal-body {
  padding: 20px;
  overflow-y: auto;
}

.modal-footer {
  padding: 12px 20px;
  border-top: 1px solid var(--border-color);
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.modal-enter-active, .modal-leave-active {
  transition: opacity 0.2s ease;
  .modal-card {
    transition: transform 0.2s ease;
  }
}
.modal-enter-from, .modal-leave-to {
  opacity: 0;
  .modal-card { transform: scale(0.95); }
}
</style>
