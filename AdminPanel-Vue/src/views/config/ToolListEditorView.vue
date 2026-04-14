<template>
  <div class="page tool-list-editor">
    <PageHeader title="工具列表编辑" subtitle="编辑插件工具的启用/排序/描述" icon="list_alt" />
    <!-- 沿用原 tool_list_editor.html —— 放在 AdminPanel/ 老目录下仍然可用 -->
    <iframe :src="iframeSrc" class="editor-frame" />
  </div>
</template>

<script setup lang="ts">
import PageHeader from '@/components/common/PageHeader.vue'

// 工具列表编辑器 — 复用老 AdminPanel 的独立页面，复制到了 public/legacy/ 下
// dev 和 prod 模式都由 Vite/后端静态 serve（与 base=/AdminPanel/ 一致）
const iframeSrc = '/AdminPanel/legacy/tool_list_editor.html'
</script>

<style lang="scss" scoped>
.tool-list-editor {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.editor-frame {
  flex: 1;
  margin: 0 24px 24px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  background: var(--tertiary-bg);
  min-height: 600px;
}
</style>
