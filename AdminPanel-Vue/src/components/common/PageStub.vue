<template>
  <div class="page">
    <div class="stub card">
      <span class="material-symbols-outlined icon">construction</span>
      <h2>{{ title }}</h2>
      <p>此模块正在从原 AdminPanel 迁移到 Vue 版本</p>
      <p class="meta">参考文件：<code>{{ sourceFile }}</code></p>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  title: string
  sourceFile: string
}>()
</script>

<style lang="scss" scoped>
.stub {
  max-width: 600px;
  margin: 40px auto;
  text-align: center;

  .icon {
    font-size: 48px;
    color: var(--highlight-text);
    margin-bottom: 12px;
  }

  h2 {
    margin: 0 0 8px;
    color: var(--primary-text);
  }

  p {
    color: var(--secondary-text);
    font-size: 14px;

    &.meta {
      margin-top: 16px;
      font-size: 12px;
    }

    code {
      background: var(--accent-bg);
      padding: 2px 6px;
      border-radius: 4px;
    }
  }
}
</style>
