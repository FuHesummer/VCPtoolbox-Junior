// 日记 / 知识库 / 公共库 API
// 后端挂载点：/admin_api/dailynotes
// mode 是前端概念，后端 GET /folders 返回 { folders, agents, public, thinking }
// 由前端按 mode 分组消费
import { apiFetch } from './client'

export type NotesMode = 'diary' | 'knowledge' | 'public'

// === 后端真实数据结构 ===

export interface AgentNotebook {
  displayName: string  // 如 "Aemeath/diary"
  folderName: string   // 同 displayName，用于路由 :folderName
  type: 'diary' | 'knowledge'
}

export interface AgentEntry {
  name: string
  notebooks: AgentNotebook[]
}

export interface ThinkingFolder {
  displayName: string  // 如 "thinking/cluster_xxx"
  folderName: string
  agent?: string
}

export interface FoldersResponse {
  folders: string[]            // 扁平列表（向后兼容）
  agents: AgentEntry[]         // diary/knowledge 模式按 agent 分组
  public: string[]             // public 模式扁平列表（knowledge/ 下子目录）
  thinking: ThinkingFolder[]   // knowledge 模式额外组：thinking/ 下思维簇
}

export interface NoteItem {
  name: string                 // 文件名（如 2025-04-14.txt）
  lastModified?: string        // ISO 时间字符串
  preview?: string
  folderName?: string          // 来自全局搜索的归属
}

export interface DiscoveryResult {
  name: string
  path: string                 // "folder/file" 或 "Agent/x/diary/file"
  score: number                // 0~1
  matchedTags?: string[]
  chunks?: string[]
}

export interface DiscoveryResponse {
  results: DiscoveryResult[]
  warning?: string
}

// === API 端点 ===

export function listNotesFolders() {
  return apiFetch<FoldersResponse>('/admin_api/dailynotes/folders')
}

export function listNotesInFolder(folderName: string) {
  return apiFetch<{ notes: NoteItem[] }>(
    `/admin_api/dailynotes/folder/${encodeURIComponent(folderName)}`,
    { suppressErrorToast: true },
  )
}

export function getNoteContent(folderName: string, fileName: string) {
  return apiFetch<{ content: string }>(
    `/admin_api/dailynotes/note/${encodeURIComponent(folderName)}/${encodeURIComponent(fileName)}`,
    { suppressErrorToast: true },
  )
}

export function saveNote(folderName: string, fileName: string, content: string) {
  return apiFetch<{ message?: string }>(
    `/admin_api/dailynotes/note/${encodeURIComponent(folderName)}/${encodeURIComponent(fileName)}`,
    { method: 'POST', body: { content } },
  )
}

export function moveNotes(
  sourceNotes: Array<{ folder: string; file: string }>,
  targetFolder: string,
) {
  return apiFetch<{ message?: string; moved: string[]; errors: Array<{ note: string; error: string }> }>(
    '/admin_api/dailynotes/move',
    { method: 'POST', body: { sourceNotes, targetFolder } },
  )
}

export function deleteNotesBatch(notesToDelete: Array<{ folder: string; file: string }>) {
  return apiFetch<{ deleted: string[]; errors: Array<{ note: string; error: string }> }>(
    '/admin_api/dailynotes/delete-batch',
    { method: 'POST', body: { notesToDelete } },
  )
}

export function deleteEmptyFolder(folderName: string) {
  return apiFetch<{ message?: string }>(
    '/admin_api/dailynotes/folder/delete',
    { method: 'POST', body: { folderName } },
  )
}

export function searchNotes(term: string, folder?: string | null, limit = 100) {
  const params = new URLSearchParams({ term, limit: String(limit) })
  if (folder) params.set('folder', folder)
  return apiFetch<{ notes: NoteItem[]; total: number; limited: boolean }>(
    `/admin_api/dailynotes/search?${params.toString()}`,
    { suppressErrorToast: true },
  )
}

export interface DiscoveryParams {
  sourceFilePath: string       // "folderName/fileName"
  k?: number
  range?: string[]             // 限定的文件夹列表
  tagBoost?: number | string   // 数值或 "0.6+" 语法（Wave v8）
}

export function associativeDiscovery(params: DiscoveryParams) {
  return apiFetch<DiscoveryResponse>(
    '/admin_api/dailynotes/associative-discovery',
    { method: 'POST', body: params },
  )
}
