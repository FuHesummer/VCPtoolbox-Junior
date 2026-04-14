<template>
  <div class="env-field" :class="{ dirty }">
    <div class="field-header">
      <code class="key">{{ entry.key }}</code>
      <span class="type-tag">{{ entry.type }}</span>
    </div>
    <p v-if="entry.description" class="desc">{{ entry.description }}</p>

    <!-- boolean -->
    <label v-if="entry.type === 'boolean'" class="bool">
      <input
        type="checkbox"
        :checked="entry.value.toLowerCase() === 'true'"
        @change="onBool(($event.target as HTMLInputElement).checked)"
      />
      <span class="bool-track"><span class="bool-thumb" /></span>
      <span class="bool-label">{{ entry.value.toLowerCase() === 'true' ? '启用' : '禁用' }}</span>
    </label>

    <!-- textarea -->
    <textarea
      v-else-if="entry.type === 'textarea'"
      :value="entry.value"
      :rows="Math.min(10, Math.max(3, entry.value.split('\n').length + 1))"
      @input="onText(($event.target as HTMLTextAreaElement).value)"
    />

    <!-- password -->
    <div v-else-if="entry.type === 'password'" class="password-wrap">
      <input
        :type="show ? 'text' : 'password'"
        :value="entry.value"
        @input="onText(($event.target as HTMLInputElement).value)"
      />
      <button type="button" class="toggle-pass" @click="show = !show">
        <span class="material-symbols-outlined">{{ show ? 'visibility_off' : 'visibility' }}</span>
      </button>
    </div>

    <!-- integer -->
    <input
      v-else-if="entry.type === 'integer'"
      type="number"
      step="1"
      :value="entry.value"
      @input="onText(($event.target as HTMLInputElement).value)"
    />

    <!-- text -->
    <input
      v-else
      type="text"
      :value="entry.value"
      @input="onText(($event.target as HTMLInputElement).value)"
    />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import type { EnvEntry } from '@/utils/envParser'

defineProps<{
  entry: EnvEntry
  dirty?: boolean
}>()

const emit = defineEmits<{
  'update:value': [value: string]
}>()

const show = ref(false)

function onBool(checked: boolean) {
  emit('update:value', checked ? 'true' : 'false')
}

function onText(v: string) {
  emit('update:value', v)
}
</script>

<style lang="scss" scoped>
.env-field {
  padding: 14px 16px;
  background: var(--tertiary-bg);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  transition: border-color 0.15s, background 0.15s;

  &.dirty {
    border-left: 3px solid var(--highlight-text);
    background: rgba(212, 116, 142, 0.04);
  }
}

.field-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;

  .key {
    font-size: 13px;
    color: var(--primary-text);
    font-family: 'JetBrains Mono', Consolas, monospace;
    font-weight: 500;
  }

  .type-tag {
    font-size: 10px;
    color: var(--secondary-text);
    background: var(--accent-bg);
    padding: 1px 6px;
    border-radius: var(--radius-pill);
  }
}

.desc {
  margin: 0 0 8px;
  font-size: 12px;
  color: var(--secondary-text);
  line-height: 1.5;
}

input[type="text"], input[type="number"], input[type="password"], textarea {
  width: 100%;
}

textarea {
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 12px;
  resize: vertical;
}

// Password field with toggle button
.password-wrap {
  position: relative;

  input { padding-right: 36px; }

  .toggle-pass {
    position: absolute;
    right: 6px;
    top: 50%;
    transform: translateY(-50%);
    background: transparent;
    border: none;
    padding: 4px;
    color: var(--secondary-text);
    cursor: pointer;
    border-radius: var(--radius-sm);

    &:hover { color: var(--primary-text); background: var(--accent-bg); }

    .material-symbols-outlined { font-size: 18px; }
  }
}

// Boolean switch (与 PluginCard 的 toggle 同构)
.bool {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;

  input { display: none; }

  .bool-track {
    display: inline-block;
    width: 36px;
    height: 20px;
    background: var(--border-color);
    border-radius: 10px;
    position: relative;
    transition: background 0.2s;
  }

  .bool-thumb {
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

  input:checked ~ .bool-track {
    background: var(--button-bg);

    .bool-thumb { transform: translateX(16px); }
  }

  .bool-label {
    font-size: 13px;
    color: var(--primary-text);
  }
}
</style>
