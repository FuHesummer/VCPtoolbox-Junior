// Agent 管理 API
// 后端实际格式：
//   GET /agents/map → 直接返回 map 对象（不包 {map:...}）
//   POST /agents/map → body 直接是 map 对象
//   GET /agents → { files: string[], folderStructure: object }
//   GET /agents/:fileName → { content }
//   POST /agents/:fileName → body { content }
//   POST /agents/new-file → body { fileName, folderPath? }
import { apiFetch } from './client'
import type { AgentMapNew } from './types'

export interface FolderNode {
  [key: string]: FolderNode | null
}

export interface AgentFilesResult {
  files: string[]         // 相对路径数组，如 ['Nova.txt', 'Coco/Coco.txt']
  folderStructure: FolderNode
}

export function getAgentMap() {
  return apiFetch<AgentMapNew>('/admin_api/agents/map')
}

export function saveAgentMap(newMap: AgentMapNew) {
  return apiFetch<{ message?: string }>('/admin_api/agents/map', {
    method: 'POST',
    body: newMap,            // 直接发送 map 对象（不要包一层）
  })
}

export function listAgentFiles() {
  return apiFetch<AgentFilesResult>('/admin_api/agents')
}

export function createAgentFile(fileName: string, folderPath?: string) {
  return apiFetch<{ message?: string }>('/admin_api/agents/new-file', {
    method: 'POST',
    body: { fileName, folderPath },
  })
}

export function getAgentFile(fileName: string) {
  return apiFetch<{ content: string }>(`/admin_api/agents/${encodeURIComponent(fileName)}`, {
    suppressErrorToast: true,
  })
}

export function saveAgentFile(fileName: string, content: string) {
  return apiFetch<{ message?: string }>(`/admin_api/agents/${encodeURIComponent(fileName)}`, {
    method: 'POST',
    body: { content },
  })
}

// ============================================================
// 头像 API
// ============================================================

/** 构造头像 URL（带时间戳防缓存） */
export function avatarUrl(alias: string, cacheBust?: number | string): string {
  const ts = cacheBust ?? Date.now()
  return `/admin_api/agents/${encodeURIComponent(alias)}/avatar?t=${ts}`
}

/** 上传头像（接收 File，转 base64 JSON 提交） */
export async function uploadAvatar(alias: string, file: File): Promise<{ ext: string; size: number }> {
  const ALLOWED = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml']
  if (!ALLOWED.includes(file.type)) {
    throw new Error(`不支持的图片格式: ${file.type || '未知'}`)
  }
  if (file.size > 2 * 1024 * 1024) {
    throw new Error('头像过大（上限 2MB）')
  }
  const data = await fileToDataURL(file)
  return apiFetch<{ ext: string; size: number }>(`/admin_api/agents/${encodeURIComponent(alias)}/avatar`, {
    method: 'POST',
    body: { data },
  })
}

export function deleteAvatar(alias: string) {
  return apiFetch<{ message?: string }>(`/admin_api/agents/${encodeURIComponent(alias)}/avatar`, {
    method: 'DELETE',
    suppressErrorToast: true,
  })
}

function fileToDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error || new Error('读取文件失败'))
    reader.readAsDataURL(file)
  })
}
