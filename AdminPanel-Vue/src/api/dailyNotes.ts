// 日记 / 知识库 / 公共库 API
// 模式 mode: 'diary' | 'knowledge' | 'public'
// notebookResolver 在后端处理双根扫描（Agent/ + knowledge/）
import { apiFetch } from './client'

export type NotesMode = 'diary' | 'knowledge' | 'public'

export interface NotesFolder {
  name: string
  displayName?: string
  agentName?: string      // 如果属于某个 Agent
  count?: number
}

export interface NoteItem {
  name: string
  size?: number
  mtime?: number
  tags?: string[]
}

export function listNotesFolders(mode: NotesMode) {
  // 端点设计：/admin_api/dailynotes/folders?mode=xxx
  return apiFetch<{ folders: NotesFolder[] }>(`/admin_api/dailynotes/folders?mode=${encodeURIComponent(mode)}`)
}

export function listNotesInFolder(mode: NotesMode, folderName: string) {
  return apiFetch<{ notes: NoteItem[] }>(
    `/admin_api/dailynotes/${encodeURIComponent(mode)}/${encodeURIComponent(folderName)}`,
    { suppressErrorToast: true },
  )
}

export function getNoteContent(mode: NotesMode, folderName: string, fileName: string) {
  return apiFetch<{ content: string }>(
    `/admin_api/dailynotes/${encodeURIComponent(mode)}/${encodeURIComponent(folderName)}/${encodeURIComponent(fileName)}`,
    { suppressErrorToast: true },
  )
}

export function saveNote(mode: NotesMode, folderName: string, fileName: string, content: string) {
  return apiFetch<{ message?: string }>(
    `/admin_api/dailynotes/${encodeURIComponent(mode)}/${encodeURIComponent(folderName)}/${encodeURIComponent(fileName)}`,
    { method: 'POST', body: { content } },
  )
}

export function deleteNotes(mode: NotesMode, folderName: string, fileNames: string[]) {
  return apiFetch<{ message?: string }>(
    `/admin_api/dailynotes/${encodeURIComponent(mode)}/${encodeURIComponent(folderName)}/batch-delete`,
    { method: 'POST', body: { fileNames } },
  )
}

export function moveNotes(
  mode: NotesMode,
  fromFolder: string,
  toFolder: string,
  fileNames: string[],
) {
  return apiFetch<{ message?: string }>(`/admin_api/dailynotes/${encodeURIComponent(mode)}/batch-move`, {
    method: 'POST',
    body: { fromFolder, toFolder, fileNames },
  })
}

export function searchNotes(mode: NotesMode, keyword: string) {
  return apiFetch<{ results: Array<NoteItem & { folder: string; preview?: string }> }>(
    `/admin_api/dailynotes/${encodeURIComponent(mode)}/search?q=${encodeURIComponent(keyword)}`,
  )
}

export function associativeDiscovery(mode: NotesMode, folderName: string) {
  return apiFetch<{ results: Array<{ file: string; score: number; preview?: string }> }>(
    `/admin_api/dailynotes/${encodeURIComponent(mode)}/associative-discovery?folder=${encodeURIComponent(folderName)}`,
  )
}
