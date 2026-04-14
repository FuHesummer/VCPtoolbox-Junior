<template>
  <div class="agent-avatar" :style="bgStyle" :class="{ clickable: clickable }">
    <img
      v-if="imgOk"
      :src="src"
      :alt="alias"
      @error="imgOk = false"
      @load="imgOk = true"
    />
    <span v-else class="letter">{{ letter }}</span>
    <slot name="overlay" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { avatarUrl } from '@/api/agents'

const props = withDefaults(defineProps<{
  alias: string
  size?: number
  cacheBust?: number | string
  clickable?: boolean
}>(), { size: 36, clickable: false })

// 稳定哈希生成颜色
function colorFor(alias: string): string {
  let hash = 0
  for (let i = 0; i < alias.length; i++) hash = (hash * 31 + alias.charCodeAt(i)) & 0xffff
  const hue = 320 + (hash % 50)
  const sat = 40 + (hash % 25)
  const light = 60 + (hash % 15)
  return `hsl(${hue}, ${sat}%, ${light}%)`
}

const letter = computed(() => (props.alias?.[0] || '?').toUpperCase())
const src = computed(() => avatarUrl(props.alias, props.cacheBust))
const bgStyle = computed(() => ({
  background: colorFor(props.alias || '?'),
  width: `${props.size}px`,
  height: `${props.size}px`,
  fontSize: `${Math.round(props.size * 0.45)}px`,
}))

const imgOk = ref(true)

// alias / cacheBust 变化时重试加载（防止换头像后还显示旧的）
watch([() => props.alias, () => props.cacheBust], () => { imgOk.value = true })
</script>

<style lang="scss" scoped>
.agent-avatar {
  border-radius: 50%;
  color: #fff;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  position: relative;
  overflow: hidden;
  user-select: none;

  &.clickable {
    cursor: pointer;
    transition: transform 0.15s, box-shadow 0.15s;

    &:hover {
      transform: scale(1.03);
      box-shadow: 0 3px 12px rgba(180, 120, 140, 0.25);
    }
  }

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .letter { line-height: 1; }
}
</style>
