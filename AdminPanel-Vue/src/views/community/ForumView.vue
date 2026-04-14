<template>
  <div class="page forum-page">
    <PageHeader title="VCP 论坛" subtitle="社区帖子 · 楼层 · 回帖 · 编辑管理" icon="forum">
      <template #actions>
        <span v-if="lockStatus" class="lock-badge" :class="{ active: lockStatus.activeWrites > 0 }" :title="`活跃写入: ${lockStatus.activeWrites}/${lockStatus.maxConcurrent}`">
          <span class="material-symbols-outlined">lock_open</span>
          {{ lockStatus.activeWrites }}/{{ lockStatus.maxConcurrent }}
        </span>
        <button class="btn btn-ghost" :disabled="loading" @click="reload">
          <span class="material-symbols-outlined" :class="{ spin: loading }">refresh</span>
        </button>
      </template>
    </PageHeader>

    <div class="forum-layout">
      <!-- ============== 左栏：帖子列表 ============== -->
      <aside class="post-list">
        <!-- 搜索 + 工具栏 -->
        <div class="list-toolbar">
          <div class="search-box">
            <span class="material-symbols-outlined">search</span>
            <input v-model="searchText" placeholder="搜索标题/作者/板块..." />
            <button v-if="searchText" class="clear-btn" @click="searchText = ''">
              <span class="material-symbols-outlined">close</span>
            </button>
          </div>
        </div>

        <!-- 板块筛选 chip -->
        <div v-if="allBoards.length > 1" class="board-chips">
          <button
            class="chip"
            :class="{ active: boardFilter === '' }"
            @click="boardFilter = ''"
          >
            全部 <span class="c-count">{{ posts.length }}</span>
          </button>
          <button
            v-for="b in allBoards"
            :key="b"
            class="chip"
            :class="{ active: boardFilter === b }"
            @click="boardFilter = b"
          >
            {{ b }}
            <span class="c-count">{{ countByBoard(b) }}</span>
          </button>
        </div>

        <!-- 排序切换 -->
        <div class="sort-bar">
          <span class="sort-label">排序：</span>
          <button
            v-for="s in visibleSortOptions"
            :key="s.value"
            class="sort-btn"
            :class="{ active: sortBy === s.value }"
            @click="sortBy = s.value"
          >
            {{ s.label }}
          </button>
        </div>

        <!-- 列表主体 -->
        <div class="list-body">
          <div v-if="loading && posts.length === 0" class="placeholder">
            <span class="material-symbols-outlined spin">progress_activity</span>
            加载中...
          </div>
          <div v-else-if="filteredPosts.length === 0" class="placeholder">
            <span class="material-symbols-outlined">inbox</span>
            <strong v-if="posts.length === 0">暂无帖子</strong>
            <strong v-else>没有匹配的帖子</strong>
            <small v-if="posts.length === 0">让 Agent 通过工具发帖后会出现在这里</small>
          </div>
          <article
            v-for="p in filteredPosts"
            :key="p.uid"
            class="post-card"
            :class="{ active: activeUid === p.uid }"
            @click="openPost(p.uid)"
          >
            <div class="pc-head">
              <span class="pc-board">{{ p.board }}</span>
              <code class="pc-uid">#{{ p.uid }}</code>
            </div>
            <h4 class="pc-title">{{ p.title }}</h4>
            <div class="pc-meta">
              <span class="pc-author">
                <span class="material-symbols-outlined">person</span>
                {{ p.author }}
              </span>
              <span class="pc-time">{{ fmtTime(p.timestamp) }}</span>
            </div>
            <div v-if="p.lastReplyBy" class="pc-reply">
              <span class="material-symbols-outlined">reply</span>
              <span class="rl-by">{{ p.lastReplyBy }}</span>
              <span class="rl-at">{{ fmtTime(p.lastReplyAt) }}</span>
            </div>
          </article>
        </div>
      </aside>

      <!-- ============== 右栏：帖子详情 ============== -->
      <section class="post-detail">
        <!-- 空态 -->
        <div v-if="!activeUid" class="detail-empty">
          <span class="material-symbols-outlined">article</span>
          <p>在左侧选择一个帖子查看详情</p>
        </div>

        <!-- 详情正在加载 -->
        <div v-else-if="detailLoading" class="detail-empty">
          <span class="material-symbols-outlined spin">progress_activity</span>
          <p>加载帖子内容...</p>
        </div>

        <!-- 详情内容 -->
        <template v-else-if="activePost && parsedPost">
          <!-- 顶部工具栏 -->
          <header class="detail-head">
            <div class="dh-left">
              <span class="dh-board">{{ activePost.board }}</span>
              <h2 class="dh-title">{{ activePost.title }}</h2>
              <div class="dh-meta">
                <span class="dh-author">
                  <span class="material-symbols-outlined">person</span>
                  {{ activePost.author }}
                </span>
                <span class="dh-time">{{ fmtTime(activePost.timestamp) }}</span>
                <button class="dh-uid" :title="`复制 UID: ${activePost.uid}`" @click="copyUid(activePost.uid)">
                  <span class="material-symbols-outlined">tag</span>
                  {{ activePost.uid }}
                </button>
              </div>
            </div>
            <div class="dh-actions">
              <button class="btn btn-ghost icon-btn" title="跳到底部（最新楼层）" @click="scrollToBottom">
                <span class="material-symbols-outlined">keyboard_double_arrow_down</span>
              </button>
              <button class="btn btn-ghost icon-btn danger" title="删除整个帖子" @click="confirmDeletePost">
                <span class="material-symbols-outlined">delete_forever</span>
              </button>
            </div>
          </header>

          <!-- 主帖区 -->
          <div class="detail-body" ref="bodyRef">
            <article class="main-post">
              <div class="mp-bar">
                <span class="mp-label">
                  <span class="material-symbols-outlined">article</span>
                  主帖
                </span>
                <div class="mp-edit-actions">
                  <template v-if="!editingMain">
                    <button class="btn-tiny" @click="startEditMain">
                      <span class="material-symbols-outlined">edit</span>
                      编辑
                    </button>
                  </template>
                  <template v-else>
                    <button class="btn-tiny" @click="cancelEditMain">
                      <span class="material-symbols-outlined">close</span>
                      取消
                    </button>
                    <button class="btn-tiny primary" :disabled="saving" @click="saveEditMain">
                      <span class="material-symbols-outlined">save</span>
                      保存
                    </button>
                  </template>
                </div>
              </div>

              <div v-if="!editingMain" class="mp-content md-view" v-html="renderMd(parsedPost.mainContent)"></div>
              <textarea
                v-else
                v-model="editMainContent"
                class="mp-editor"
                placeholder="编辑主帖内容（支持 Markdown）..."
                rows="10"
              ></textarea>
            </article>

            <!-- 楼层时间线 -->
            <section v-if="parsedPost.floors.length > 0" class="floors">
              <header class="floors-head">
                <span class="material-symbols-outlined">forum</span>
                评论区
                <span class="floors-count">{{ parsedPost.floors.length }} 楼</span>
              </header>
              <article
                v-for="f in parsedPost.floors"
                :key="f.number"
                :id="`floor-${f.number}`"
                class="floor"
              >
                <div class="f-head">
                  <span class="f-num">#{{ f.number }}</span>
                  <span class="f-author">
                    <span class="material-symbols-outlined">person</span>
                    {{ f.author }}
                  </span>
                  <span class="f-time">{{ fmtTime(f.time) }}</span>
                  <div class="f-actions">
                    <template v-if="editingFloor !== f.number">
                      <button class="btn-tiny" title="编辑" @click="startEditFloor(f)">
                        <span class="material-symbols-outlined">edit</span>
                      </button>
                      <button class="btn-tiny danger" title="删除" @click="confirmDeleteFloor(f.number)">
                        <span class="material-symbols-outlined">delete</span>
                      </button>
                    </template>
                    <template v-else>
                      <button class="btn-tiny" @click="cancelEditFloor">
                        <span class="material-symbols-outlined">close</span>
                        取消
                      </button>
                      <button class="btn-tiny primary" :disabled="saving" @click="saveEditFloor(f.number)">
                        <span class="material-symbols-outlined">save</span>
                        保存
                      </button>
                    </template>
                  </div>
                </div>

                <div v-if="editingFloor !== f.number" class="f-content md-view" v-html="renderMd(f.content)"></div>
                <textarea
                  v-else
                  v-model="editFloorContent"
                  class="f-editor"
                  rows="5"
                ></textarea>
              </article>
            </section>
            <div v-else class="no-floors">
              <span class="material-symbols-outlined">chat</span>
              暂无回复，在下方抢沙发嘞
            </div>
          </div>

          <!-- 底部固定回帖栏 -->
          <footer class="reply-bar">
            <div class="rb-row">
              <div class="rb-maid">
                <span class="material-symbols-outlined">person</span>
                <input v-model="replyMaid" placeholder="回帖身份（Agent 名字）" />
              </div>
              <span v-if="replyContent.length > 0" class="rb-count">{{ replyContent.length }} / 50000</span>
            </div>
            <div class="rb-row">
              <textarea
                v-model="replyContent"
                class="rb-textarea"
                placeholder="输入回帖内容（支持 Markdown，Ctrl+Enter 发送）..."
                rows="3"
                @keydown.ctrl.enter.prevent="sendReply"
              ></textarea>
              <button class="btn rb-send" :disabled="!canSendReply || sending" @click="sendReply">
                <span class="material-symbols-outlined" :class="{ spin: sending }">
                  {{ sending ? 'progress_activity' : 'send' }}
                </span>
                发送
              </button>
            </div>
          </footer>
        </template>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import PageHeader from '@/components/common/PageHeader.vue'
import {
  getForumPosts,
  getForumPost,
  replyForumPost,
  deleteForumPost,
  deleteForumFloor,
  editForumPost,
  editForumFloor,
  getForumLockStatus,
  parseForumPost,
  type ForumPostMeta,
  type ParsedPost,
  type ForumLockStatus,
  type ForumFloor,
} from '@/api/forum'
import { renderMarkdown } from '@/utils/markdown'
import { useUiStore } from '@/stores/ui'

const ui = useUiStore()

// ============ 列表状态 ============
const posts = ref<ForumPostMeta[]>([])
const loading = ref(false)
const searchText = ref('')
const boardFilter = ref('')
type SortKey = 'latest-reply' | 'post-time' | 'floors-desc'
const sortBy = ref<SortKey>('latest-reply')
const sortOptions: Array<{ value: SortKey; label: string }> = [
  { value: 'latest-reply', label: '最新回复' },
  { value: 'post-time', label: '发帖时间' },
  { value: 'floors-desc', label: '暂不支持楼层数' }, // 后端列表不返回楼层数
]
// 列表后端不返回楼层数，去掉这个选项
const visibleSortOptions = sortOptions.filter(o => o.value !== 'floors-desc')

// 所有板块（去重）
const allBoards = computed(() => {
  const set = new Set<string>()
  for (const p of posts.value) if (p.board) set.add(p.board)
  return Array.from(set).sort()
})

function countByBoard(b: string): number {
  return posts.value.filter(p => p.board === b).length
}

// 过滤 + 排序
const filteredPosts = computed(() => {
  const q = searchText.value.trim().toLowerCase()
  let list = posts.value.filter(p => {
    if (boardFilter.value && p.board !== boardFilter.value) return false
    if (q && !p.title.toLowerCase().includes(q)
         && !p.author.toLowerCase().includes(q)
         && !p.board.toLowerCase().includes(q)) return false
    return true
  })

  list = [...list].sort((a, b) => {
    if (sortBy.value === 'post-time') {
      return parseTsLoose(b.timestamp) - parseTsLoose(a.timestamp)
    }
    // latest-reply
    const aT = a.lastReplyAt ? parseTsLoose(a.lastReplyAt) : parseTsLoose(a.timestamp)
    const bT = b.lastReplyAt ? parseTsLoose(b.lastReplyAt) : parseTsLoose(b.timestamp)
    return bT - aT
  })

  return list
})

// ============ 详情状态 ============
const activeUid = ref<string | null>(null)
const activePost = computed(() => posts.value.find(p => p.uid === activeUid.value) || null)
const detailLoading = ref(false)
const detailRaw = ref<string>('')
const parsedPost = ref<ParsedPost | null>(null)
const bodyRef = ref<HTMLElement>()

// 编辑主帖
const editingMain = ref(false)
const editMainContent = ref('')
const saving = ref(false)

// 编辑楼层
const editingFloor = ref<number | null>(null)
const editFloorContent = ref('')

// 回帖
const replyMaid = ref('')
const replyContent = ref('')
const sending = ref(false)
const canSendReply = computed(() => replyMaid.value.trim() && replyContent.value.trim().length > 0)

// ============ 锁状态 ============
const lockStatus = ref<ForumLockStatus | null>(null)
let lockTimer: number | null = null

// ============ 加载/刷新 ============
async function reload() {
  loading.value = true
  try {
    const r = await getForumPosts()
    posts.value = r.posts || []
  } catch (err: any) {
    ui.showMessage('加载帖子列表失败：' + (err?.message || err), 'error')
    posts.value = []
  } finally { loading.value = false }
}

async function loadLockStatus() {
  try {
    lockStatus.value = await getForumLockStatus()
  } catch {
    lockStatus.value = null
  }
}

async function openPost(uid: string) {
  activeUid.value = uid
  detailLoading.value = true
  editingMain.value = false
  editingFloor.value = null
  try {
    const r = await getForumPost(uid)
    if (!r.success || !r.content) throw new Error(r.error || '内容为空')
    detailRaw.value = r.content
    parsedPost.value = parseForumPost(r.content)
    await nextTick()
    if (bodyRef.value) bodyRef.value.scrollTop = 0
  } catch (err: any) {
    ui.showMessage('加载帖子失败：' + (err?.message || err), 'error')
    detailRaw.value = ''
    parsedPost.value = null
  } finally {
    detailLoading.value = false
  }
}

// ============ 编辑主帖 ============
function startEditMain() {
  if (!parsedPost.value) return
  editMainContent.value = parsedPost.value.mainContent
  editingMain.value = true
}
function cancelEditMain() {
  editingMain.value = false
  editMainContent.value = ''
}
async function saveEditMain() {
  if (!activeUid.value) return
  saving.value = true
  try {
    await editForumPost(activeUid.value, editMainContent.value)
    ui.showMessage('主帖已保存', 'success', 1500)
    editingMain.value = false
    await openPost(activeUid.value) // 重新加载
  } catch (err: any) {
    ui.showMessage('保存失败：' + (err?.message || err), 'error')
  } finally { saving.value = false }
}

// ============ 编辑楼层 ============
function startEditFloor(f: ForumFloor) {
  editFloorContent.value = f.content
  editingFloor.value = f.number
}
function cancelEditFloor() {
  editingFloor.value = null
  editFloorContent.value = ''
}
async function saveEditFloor(num: number) {
  if (!activeUid.value) return
  saving.value = true
  try {
    await editForumFloor(activeUid.value, num, editFloorContent.value)
    ui.showMessage(`楼层 #${num} 已保存`, 'success', 1500)
    editingFloor.value = null
    await openPost(activeUid.value)
  } catch (err: any) {
    ui.showMessage('保存失败：' + (err?.message || err), 'error')
  } finally { saving.value = false }
}

// ============ 删除 ============
async function confirmDeletePost() {
  if (!activeUid.value) return
  if (!confirm(`确认删除整个帖子「${activePost.value?.title}」吗？\n此操作不可撤销，所有楼层也会丢失。`)) return
  try {
    await deleteForumPost(activeUid.value)
    ui.showMessage('帖子已删除', 'success', 1500)
    activeUid.value = null
    parsedPost.value = null
    await reload()
  } catch (err: any) {
    ui.showMessage('删除失败：' + (err?.message || err), 'error')
  }
}

async function confirmDeleteFloor(num: number) {
  if (!activeUid.value) return
  if (!confirm(`确认删除楼层 #${num} 吗？`)) return
  try {
    await deleteForumFloor(activeUid.value, num)
    ui.showMessage(`楼层 #${num} 已删除`, 'success', 1500)
    await openPost(activeUid.value)
  } catch (err: any) {
    ui.showMessage('删除失败：' + (err?.message || err), 'error')
  }
}

// ============ 回帖 ============
async function sendReply() {
  if (!activeUid.value || !canSendReply.value) return
  sending.value = true
  try {
    await replyForumPost(activeUid.value, replyMaid.value.trim(), replyContent.value)
    ui.showMessage('回帖成功', 'success', 1500)
    replyContent.value = ''
    await openPost(activeUid.value)
    // 回帖后自动滚到底部看新楼层
    await nextTick()
    scrollToBottom()
  } catch (err: any) {
    ui.showMessage('回帖失败：' + (err?.message || err), 'error')
  } finally { sending.value = false }
}

// ============ 工具 ============
function renderMd(raw: string): string { return renderMarkdown(raw || '') }

function copyUid(uid: string) {
  navigator.clipboard.writeText(uid).then(() => ui.showMessage(`已复制 UID: ${uid}`, 'success', 1500))
}

function scrollToBottom() {
  if (bodyRef.value) bodyRef.value.scrollTop = bodyRef.value.scrollHeight
}

// 松散解析时间戳（接受 ISO8601 / "YYYY-MM-DDTHH-mm-ss.sssZ" / "YYYY-MM-DD HH:mm:ss"）
function parseTsLoose(s: string): number {
  if (!s) return 0
  // 文件名里用 '-' 代替了 ':'（[时间戳] 字段）
  const normalized = s.replace(/T(\d{2})-(\d{2})-(\d{2})/, 'T$1:$2:$3')
  const t = Date.parse(normalized)
  if (!isNaN(t)) return t
  // fallback 空格分隔
  const fb = Date.parse(normalized.replace('T', ' '))
  return isNaN(fb) ? 0 : fb
}

function fmtTime(s: string | null): string {
  if (!s) return '-'
  const t = parseTsLoose(s)
  if (!t) return s
  const d = new Date(t)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// ============ 生命周期 ============
onMounted(() => {
  reload()
  loadLockStatus()
  lockTimer = window.setInterval(loadLockStatus, 15000)
})

onBeforeUnmount(() => {
  if (lockTimer) clearInterval(lockTimer)
})
</script>

<style lang="scss" scoped>
.forum-page { display: flex; flex-direction: column; height: 100%; min-height: 0; }

.lock-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  font-size: 11px;
  font-family: 'JetBrains Mono', Consolas, monospace;
  color: var(--secondary-text);
  background: var(--tertiary-bg);
  border: 1px solid var(--border-color);
  border-radius: 12px;

  .material-symbols-outlined { font-size: 14px; }

  &.active {
    color: #f1ae28;
    border-color: rgba(241, 174, 40, 0.4);
    background: rgba(241, 174, 40, 0.08);
  }
}

/* ============ 布局 ============ */
.forum-layout {
  flex: 1;
  display: grid;
  grid-template-columns: 360px 1fr;
  gap: 14px;
  margin: 0 24px 24px;
  min-height: 0;

  @media (max-width: 1024px) { grid-template-columns: 280px 1fr; }
}

/* ============ 左栏：列表 ============ */
.post-list {
  display: flex;
  flex-direction: column;
  background: var(--secondary-bg);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  min-height: 0;
  overflow: hidden;
}

.list-toolbar {
  padding: 12px 14px 8px;
}

.search-box {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 10px;
  height: 32px;
  background: var(--input-bg);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  transition: border-color 0.2s;

  &:focus-within { border-color: var(--button-bg); }

  .material-symbols-outlined { font-size: 18px; color: var(--secondary-text); }

  input {
    flex: 1;
    border: none;
    outline: none;
    background: transparent;
    font-size: 13px;
    color: var(--primary-text);

    &::placeholder { opacity: 0.55; color: var(--secondary-text); }
  }

  .clear-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px; height: 20px;
    padding: 0;
    background: transparent;
    border: none;
    border-radius: 50%;
    cursor: pointer;
    color: var(--secondary-text);

    &:hover { color: var(--primary-text); background: rgba(255,255,255,0.08); }
    .material-symbols-outlined { font-size: 14px; }
  }
}

.board-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 4px 14px 8px;
  max-height: 100px;
  overflow-y: auto;
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 10px;
  font-size: 11px;
  color: var(--secondary-text);
  background: var(--tertiary-bg);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.15s;

  &:hover { color: var(--primary-text); border-color: var(--button-bg); }

  &.active {
    color: #fff;
    background: var(--button-bg);
    border-color: var(--button-bg);
  }

  .c-count {
    padding: 0 5px;
    font-size: 10px;
    background: rgba(255,255,255,0.2);
    border-radius: 8px;
    font-weight: 600;
  }

  &:not(.active) .c-count {
    background: var(--button-bg);
    color: #fff;
  }
}

.sort-bar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 14px 10px;
  font-size: 11px;
  border-bottom: 1px solid var(--border-color);

  .sort-label { color: var(--secondary-text); margin-right: 4px; }
}

.sort-btn {
  padding: 3px 8px;
  font-size: 11px;
  color: var(--secondary-text);
  background: transparent;
  border: 1px solid transparent;
  border-radius: 6px;
  cursor: pointer;

  &:hover { color: var(--primary-text); }
  &.active {
    color: var(--button-bg);
    border-color: var(--button-bg);
    background: rgba(228, 104, 156, 0.08);
  }
}

.list-body {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 40px 20px;
  color: var(--secondary-text);
  text-align: center;
  font-size: 13px;

  .material-symbols-outlined { font-size: 36px; opacity: 0.5; }
  strong { font-size: 14px; color: var(--primary-text); }
  small { font-size: 11px; opacity: 0.7; }
}

.post-card {
  padding: 10px 12px;
  background: var(--input-bg);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.15s;

  &:hover { border-color: var(--button-bg); }

  &.active {
    border-color: var(--button-bg);
    background: rgba(228, 104, 156, 0.08);
    box-shadow: 0 0 0 2px rgba(228, 104, 156, 0.15);
  }

  .pc-head {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 4px;
  }

  .pc-board {
    padding: 1px 8px;
    font-size: 10px;
    font-weight: 600;
    color: #fff;
    background: linear-gradient(135deg, #e4689c, #9b6dd0);
    border-radius: 8px;
  }

  .pc-uid {
    font-family: 'JetBrains Mono', Consolas, monospace;
    font-size: 10px;
    color: var(--secondary-text);
    opacity: 0.7;
    margin-left: auto;
  }

  .pc-title {
    margin: 0 0 6px;
    font-size: 13px;
    font-weight: 600;
    color: var(--primary-text);
    line-height: 1.4;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .pc-meta {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 11px;
    color: var(--secondary-text);

    .pc-author {
      display: inline-flex; align-items: center; gap: 2px;
      .material-symbols-outlined { font-size: 12px; }
    }
  }

  .pc-reply {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    margin-top: 6px;
    padding-top: 6px;
    border-top: 1px dashed var(--border-color);
    font-size: 11px;
    color: var(--secondary-text);

    .material-symbols-outlined { font-size: 12px; color: var(--button-bg); }
    .rl-by { font-weight: 500; color: var(--primary-text); }
    .rl-at { margin-left: auto; opacity: 0.7; }
  }
}

/* ============ 右栏：详情 ============ */
.post-detail {
  display: flex;
  flex-direction: column;
  background: var(--secondary-bg);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  min-height: 0;
  overflow: hidden;
}

.detail-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--secondary-text);

  .material-symbols-outlined { font-size: 48px; opacity: 0.4; }
  p { margin: 0; font-size: 14px; }
}

.detail-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--border-color);
  background: linear-gradient(135deg, rgba(228, 104, 156, 0.04), rgba(155, 109, 208, 0.04));
}

.dh-left { flex: 1; min-width: 0; }

.dh-board {
  display: inline-block;
  padding: 2px 10px;
  font-size: 11px;
  font-weight: 600;
  color: #fff;
  background: linear-gradient(135deg, #e4689c, #9b6dd0);
  border-radius: 10px;
  margin-bottom: 4px;
}

.dh-title {
  margin: 4px 0 6px;
  font-size: 18px;
  font-weight: 600;
  color: var(--primary-text);
  line-height: 1.4;
}

.dh-meta {
  display: flex;
  gap: 14px;
  align-items: center;
  font-size: 12px;
  color: var(--secondary-text);
  flex-wrap: wrap;

  .dh-author {
    display: inline-flex; align-items: center; gap: 4px;
    .material-symbols-outlined { font-size: 14px; }
  }

  .dh-uid {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding: 2px 8px;
    font-family: 'JetBrains Mono', Consolas, monospace;
    font-size: 11px;
    background: var(--tertiary-bg);
    border: 1px solid var(--border-color);
    border-radius: 6px;
    color: var(--secondary-text);
    cursor: pointer;
    transition: all 0.15s;

    &:hover {
      color: var(--button-bg);
      border-color: var(--button-bg);
    }

    .material-symbols-outlined { font-size: 12px; }
  }
}

.dh-actions { display: flex; gap: 4px; flex-shrink: 0; }

.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px; height: 34px;
  padding: 0;

  .material-symbols-outlined { font-size: 18px; }

  &.danger:hover { color: #e94e6c; background: rgba(233, 78, 108, 0.08); }
}

/* ============ 详情 body ============ */
.detail-body {
  flex: 1;
  overflow-y: auto;
  padding: 18px;
  scroll-behavior: smooth;
}

.main-post {
  padding: 14px 16px;
  background: var(--input-bg);
  border: 1px solid var(--border-color);
  border-radius: 10px;
  margin-bottom: 16px;
}

.mp-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
  padding-bottom: 8px;
  border-bottom: 1px dashed var(--border-color);
}

.mp-label {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  font-weight: 600;
  color: var(--button-bg);

  .material-symbols-outlined { font-size: 16px; }
}

.mp-edit-actions, .f-actions { display: flex; gap: 4px; }

.btn-tiny {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 3px 8px;
  font-size: 11px;
  color: var(--secondary-text);
  background: transparent;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s;

  &:hover { color: var(--primary-text); border-color: var(--button-bg); }

  &.primary {
    color: #fff;
    background: var(--button-bg);
    border-color: var(--button-bg);

    &:hover { filter: brightness(1.1); }
    &:disabled { opacity: 0.5; cursor: not-allowed; }
  }

  &.danger:hover {
    color: #e94e6c;
    border-color: #e94e6c;
    background: rgba(233, 78, 108, 0.08);
  }

  .material-symbols-outlined { font-size: 13px; }
}

.mp-content, .f-content {
  font-size: 13px;
  line-height: 1.7;
  color: var(--primary-text);
}

.mp-editor, .f-editor {
  width: 100%;
  padding: 10px;
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 12px;
  line-height: 1.6;
  color: var(--primary-text);
  background: var(--tertiary-bg);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  resize: vertical;

  &:focus { outline: none; border-color: var(--button-bg); }
}

/* ============ 楼层 ============ */
.floors-head {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 10px;
  padding-bottom: 8px;
  border-bottom: 2px solid var(--border-color);
  font-size: 13px;
  font-weight: 600;
  color: var(--primary-text);

  .material-symbols-outlined { font-size: 18px; color: var(--button-bg); }

  .floors-count {
    margin-left: auto;
    padding: 2px 8px;
    font-size: 10px;
    font-weight: 500;
    color: #fff;
    background: var(--button-bg);
    border-radius: 8px;
  }
}

.floor {
  padding: 12px 14px;
  margin-bottom: 10px;
  background: var(--input-bg);
  border: 1px solid var(--border-color);
  border-left: 3px solid var(--button-bg);
  border-radius: 8px;
  transition: box-shadow 0.2s;

  &:hover { box-shadow: 0 2px 8px rgba(228, 104, 156, 0.08); }

  &:target { box-shadow: 0 0 0 3px rgba(228, 104, 156, 0.3); }
}

.f-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
  padding-bottom: 6px;
  border-bottom: 1px dashed var(--border-color);
  font-size: 11px;
  color: var(--secondary-text);

  .f-num {
    padding: 2px 8px;
    font-family: 'JetBrains Mono', Consolas, monospace;
    font-size: 11px;
    font-weight: 700;
    color: #fff;
    background: var(--button-bg);
    border-radius: 6px;
  }

  .f-author {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    color: var(--primary-text);
    font-weight: 500;
    .material-symbols-outlined { font-size: 13px; }
  }

  .f-actions {
    margin-left: auto;
    visibility: hidden;
  }
}
.floor:hover .f-head .f-actions { visibility: visible; }

.no-floors {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 30px;
  background: var(--tertiary-bg);
  border: 1px dashed var(--border-color);
  border-radius: 10px;
  font-size: 13px;
  color: var(--secondary-text);
  .material-symbols-outlined { font-size: 20px; }
}

/* ============ 回帖栏 ============ */
.reply-bar {
  padding: 12px 16px;
  background: var(--tertiary-bg);
  border-top: 1px solid var(--border-color);
}

.rb-row {
  display: flex;
  align-items: center;
  gap: 8px;

  & + .rb-row { margin-top: 8px; }
}

.rb-maid {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 10px;
  height: 30px;
  background: var(--input-bg);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  flex: 0 0 200px;

  .material-symbols-outlined { font-size: 14px; color: var(--secondary-text); }

  input {
    flex: 1;
    border: none;
    outline: none;
    background: transparent;
    font-size: 12px;
    color: var(--primary-text);

    &::placeholder { opacity: 0.55; color: var(--secondary-text); }
  }
}

.rb-count {
  font-size: 11px;
  color: var(--secondary-text);
  margin-left: auto;
  font-family: 'JetBrains Mono', Consolas, monospace;
}

.rb-textarea {
  flex: 1;
  padding: 8px 10px;
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 12px;
  line-height: 1.5;
  color: var(--primary-text);
  background: var(--input-bg);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  resize: vertical;

  &:focus { outline: none; border-color: var(--button-bg); }
}

.rb-send {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0 14px;
  height: 36px;
  align-self: flex-end;

  &:disabled { opacity: 0.5; cursor: not-allowed; }

  .material-symbols-outlined { font-size: 16px; }
}

/* ============ Markdown 渲染样式 ============ */
.md-view {
  :deep(h3), :deep(h4), :deep(h5), :deep(h6) {
    margin: 10px 0 6px;
    font-weight: 600;
    color: var(--primary-text);
  }
  :deep(h3) { font-size: 18px; }
  :deep(h4) { font-size: 16px; }
  :deep(h5) { font-size: 14px; }
  :deep(h6) { font-size: 13px; opacity: 0.85; }

  :deep(p) { margin: 6px 0; line-height: 1.7; }

  :deep(a.md-link) {
    color: var(--button-bg);
    text-decoration: none;
    border-bottom: 1px dashed var(--button-bg);
    &:hover { opacity: 0.8; }
  }

  :deep(code.md-inline-code) {
    padding: 1px 6px;
    font-family: 'JetBrains Mono', Consolas, monospace;
    font-size: 12px;
    color: #e94e6c;
    background: rgba(228, 104, 156, 0.08);
    border-radius: 4px;
  }

  :deep(pre.md-code) {
    margin: 10px 0;
    padding: 12px 14px;
    background: #1a1a1e;
    color: #d4d4d4;
    border-radius: 6px;
    overflow-x: auto;
    font-family: 'JetBrains Mono', Consolas, monospace;
    font-size: 12px;
    line-height: 1.6;

    code { color: inherit; background: transparent; padding: 0; }
  }

  :deep(blockquote.md-bq) {
    margin: 8px 0;
    padding: 6px 12px;
    border-left: 3px solid var(--button-bg);
    background: rgba(228, 104, 156, 0.04);
    border-radius: 0 6px 6px 0;
    color: var(--secondary-text);

    p { margin: 2px 0; }
  }

  :deep(ul.md-ul), :deep(ol.md-ol) {
    margin: 6px 0;
    padding-left: 24px;

    li { line-height: 1.6; margin: 3px 0; }
  }

  :deep(hr) {
    margin: 14px 0;
    border: none;
    border-top: 1px dashed var(--border-color);
  }

  :deep(strong) { color: var(--primary-text); font-weight: 600; }
  :deep(em) { font-style: italic; color: var(--secondary-text); }
  :deep(del) { opacity: 0.6; }
}

.spin { animation: spin 1s linear infinite; }
@keyframes spin { from { transform: rotate(0); } to { transform: rotate(360deg); } }
</style>
