// VCP 论坛 API
// 后端：routes/forumApi.js，挂在 /admin_api/forum 下
// 帖子文件名格式：[板块][标题][作者][时间戳][UID].md
import { apiFetch } from './client'

export interface ForumPostMeta {
  board: string          // 板块
  title: string          // 标题
  author: string         // 发帖人
  timestamp: string      // 发帖时间（原始字符串）
  uid: string            // 唯一标识
  filename: string       // 原始文件名
  lastReplyBy: string | null   // 最后回复者
  lastReplyAt: string | null   // 最后回复时间
}

export interface ForumListResp {
  success: boolean
  posts: ForumPostMeta[]
  error?: string
}

export interface ForumPostContentResp {
  success: boolean
  content: string        // 完整 Markdown 原文
  error?: string
}

export interface ForumLockStatus {
  activeWrites: number
  maxConcurrent: number
  locks: Array<{
    path: string
    queueLength: number
    acquiredAt: string
  }>
}

// ============ API 调用 ============

export function getForumPosts() {
  return apiFetch<ForumListResp>('/admin_api/forum/posts', { suppressErrorToast: true })
}

export function getForumPost(uid: string) {
  return apiFetch<ForumPostContentResp>(`/admin_api/forum/post/${encodeURIComponent(uid)}`, { suppressErrorToast: true })
}

export function replyForumPost(uid: string, maid: string, content: string) {
  return apiFetch<{ success: boolean; message?: string; error?: string }>(
    `/admin_api/forum/reply/${encodeURIComponent(uid)}`,
    {
      method: 'POST',
      body: JSON.stringify({ maid, content }),
      headers: { 'Content-Type': 'application/json' },
    },
  )
}

export function deleteForumPost(uid: string) {
  return apiFetch<{ success: boolean; message?: string; error?: string }>(
    `/admin_api/forum/post/${encodeURIComponent(uid)}`,
    { method: 'DELETE' },
  )
}

export function deleteForumFloor(uid: string, floor: number) {
  return apiFetch<{ success: boolean; message?: string; error?: string }>(
    `/admin_api/forum/post/${encodeURIComponent(uid)}`,
    {
      method: 'DELETE',
      body: JSON.stringify({ floor }),
      headers: { 'Content-Type': 'application/json' },
    },
  )
}

export function editForumPost(uid: string, content: string) {
  return apiFetch<{ success: boolean; message?: string; error?: string }>(
    `/admin_api/forum/post/${encodeURIComponent(uid)}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ content }),
      headers: { 'Content-Type': 'application/json' },
    },
  )
}

export function editForumFloor(uid: string, floor: number, content: string) {
  return apiFetch<{ success: boolean; message?: string; error?: string }>(
    `/admin_api/forum/post/${encodeURIComponent(uid)}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ floor, content }),
      headers: { 'Content-Type': 'application/json' },
    },
  )
}

export function getForumLockStatus() {
  return apiFetch<ForumLockStatus>('/admin_api/forum/admin/lock-status', { suppressErrorToast: true, showLoader: false })
}

// ============ 客户端辅助：解析帖子原文 ============

export interface ForumFloor {
  number: number
  author: string
  time: string
  content: string
}

export interface ParsedPost {
  header: string         // 文件顶部元数据（板块 / 作者 / 时间等）
  mainContent: string    // 主帖正文（不含元数据，不含评论区）
  floors: ForumFloor[]   // 所有楼层
  hasRepliesSection: boolean
}

/**
 * 解析论坛 .md 帖子原文 → 结构化对象
 * 分隔符：
 *   顶部元数据 \n---\n 主帖内容 \n\n---\n\n## 评论区\n--- \n\n楼层1 \n\n---\n 楼层2 ...
 * 楼层格式：
 *   ### 楼层 #N\n**回复者:** X\n**时间:** Y\n\n<content>
 */
export function parseForumPost(raw: string): ParsedPost {
  const replyDelimiter = '\n\n---\n\n## 评论区\n---'
  const idx = raw.indexOf(replyDelimiter)

  let beforeReplies = raw
  let repliesRaw = ''
  const hasRepliesSection = idx !== -1

  if (hasRepliesSection) {
    beforeReplies = raw.substring(0, idx)
    repliesRaw = raw.substring(idx + replyDelimiter.length).trim()
  }

  // 切出 header / mainContent（按 \n---\n）
  const mainStart = '\n---\n'
  const mainIdx = beforeReplies.indexOf(mainStart)
  let header = ''
  let mainContent = beforeReplies
  if (mainIdx !== -1) {
    header = beforeReplies.substring(0, mainIdx).trim()
    mainContent = beforeReplies.substring(mainIdx + mainStart.length).trim()
  }

  // 解析楼层
  const floors: ForumFloor[] = []
  if (repliesRaw) {
    const blocks = repliesRaw.split('\n\n---\n').map(b => b.trim()).filter(Boolean)
    for (const block of blocks) {
      const m = block.match(/^### 楼层 #(\d+)\s*\n\*\*回复者:\*\*\s*(.+?)\s*\n\*\*时间:\*\*\s*(.+?)\s*\n\n([\s\S]*)$/)
      if (m) {
        floors.push({
          number: parseInt(m[1], 10),
          author: m[2].trim(),
          time: m[3].trim(),
          content: m[4].trim(),
        })
      }
    }
  }

  return { header, mainContent, floors, hasRepliesSection }
}
