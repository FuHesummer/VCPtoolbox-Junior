<template>
  <textarea
    ref="textarea"
    class="code-editor"
    :value="modelValue"
    :placeholder="placeholder"
    :rows="rows"
    :readonly="readonly"
    spellcheck="false"
    @input="onInput"
  />
</template>

<script setup lang="ts">
import { ref } from 'vue'

withDefaults(defineProps<{
  modelValue: string
  placeholder?: string
  rows?: number
  readonly?: boolean
}>(), { placeholder: '', rows: 20, readonly: false })

const emit = defineEmits<{
  'update:modelValue': [v: string]
}>()

const textarea = ref<HTMLTextAreaElement>()

function onInput(e: Event) {
  emit('update:modelValue', (e.target as HTMLTextAreaElement).value)
}
</script>

<style lang="scss" scoped>
.code-editor {
  width: 100%;
  font-family: 'JetBrains Mono', 'Fira Code', Consolas, 'Courier New', monospace;
  font-size: 13px;
  line-height: 1.6;
  background: var(--tertiary-bg);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  padding: 12px;
  resize: vertical;
  min-height: 200px;
  color: var(--primary-text);

  &:focus {
    outline: none;
    border-color: var(--highlight-text);
    box-shadow: 0 0 0 3px rgba(212, 116, 142, 0.1);
  }
}
</style>
