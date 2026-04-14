<template>
  <div class="page">
    <PageHeader title="VCP 论坛" subtitle="社区帖子与互动" icon="forum">
      <template #actions>
        <button class="btn btn-ghost" @click="reload" :disabled="loading"><span class="material-symbols-outlined">refresh</span></button>
      </template>
    </PageHeader>

    <div class="content">
      <EmptyState v-if="!posts.length && !loading" icon="forum" message="暂无帖子" />
      <div v-else class="list">
        <article v-for="p in posts" :key="p.id" class="card post">
          <header>
            <strong>{{ p.title }}</strong>
            <span class="author">{{ p.author || '匿名' }}</span>
          </header>
          <p class="excerpt">{{ p.excerpt || p.content || '' }}</p>
          <footer>
            <span v-if="p.timestamp" class="time">{{ fmtTime(p.timestamp) }}</span>
            <span v-if="typeof p.replies === 'number'" class="replies">{{ p.replies }} 回复</span>
          </footer>
        </article>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import PageHeader from '@/components/common/PageHeader.vue'
import EmptyState from '@/components/common/EmptyState.vue'
import { apiFetch } from '@/api/client'

interface Post {
  id: string
  title: string
  author?: string
  excerpt?: string
  content?: string
  timestamp?: number
  replies?: number
}

const posts = ref<Post[]>([])
const loading = ref(false)

async function reload() {
  loading.value = true
  try {
    const data = await apiFetch<{ posts: Post[] }>('/admin_api/forum/posts', { suppressErrorToast: true })
    posts.value = data.posts || []
  } catch {
    posts.value = []
  } finally { loading.value = false }
}

function fmtTime(ts: number) {
  const d = new Date(ts * (ts < 1e12 ? 1000 : 1))
  return d.toLocaleString('zh-CN', { hour12: false })
}

onMounted(reload)
</script>

<style lang="scss" scoped>
.content { padding: 0 24px 24px; }
.list { display: flex; flex-direction: column; gap: 12px; }
.post {
  padding: 14px 16px;

  header {
    display: flex;
    justify-content: space-between;
    margin-bottom: 8px;
    gap: 12px;

    strong { color: var(--primary-text); font-size: 15px; }
    .author { color: var(--secondary-text); font-size: 12px; }
  }

  .excerpt {
    margin: 0 0 8px;
    font-size: 13px;
    color: var(--primary-text);
    line-height: 1.6;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  footer {
    display: flex;
    gap: 12px;
    font-size: 11px;
    color: var(--secondary-text);
  }
}
</style>
