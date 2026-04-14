<template>
  <BaseModal :model-value="!!current" :title="current?.options.title || '请确认'" @update:model-value="!$event && respond(false)">
    <p class="message">{{ current?.message }}</p>
    <template #footer>
      <button class="btn btn-ghost" @click="respond(false)">
        {{ current?.options.cancelText || '取消' }}
      </button>
      <button
        class="btn"
        :class="{ 'btn-danger': current?.options.danger }"
        @click="respond(true)"
      >
        {{ current?.options.okText || '确认' }}
      </button>
    </template>
  </BaseModal>
</template>

<script setup lang="ts">
import BaseModal from '@/components/common/BaseModal.vue'
import { useConfirm } from '@/composables/useConfirm'

const { current, respond } = useConfirm()
</script>

<style lang="scss" scoped>
.message {
  margin: 0;
  color: var(--primary-text);
  font-size: 15px;
  line-height: 1.6;
  white-space: pre-wrap;
}
</style>
