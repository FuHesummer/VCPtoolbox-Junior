// Toolbox 管理 API
// 后端挂载：/admin_api/toolbox/*
// ⚠️ /toolbox/map POST 是 writeFile-style — 直接发 raw map（不包 wrapper）
import { apiFetch } from './client'

export interface ToolboxMapEntry {
  file: string
  description: string
}

export type ToolboxMap = Record<string, ToolboxMapEntry>

// 文件夹结构：递归对象，folder.children 嵌套
export interface FileNode { type: 'file'; path: string }
export interface FolderNode { type: 'folder'; children: Record<string, FileNode | FolderNode> }
export type FolderStructure = Record<string, FileNode | FolderNode>

export interface ToolboxFilesResponse {
  files: string[]              // 扁平相对路径列表（如 "MemoToolBox.txt" / "sub/foo.md"）
  folderStructure: FolderStructure
}

// === API 端点 ===

export function getToolboxMap() {
  return apiFetch<ToolboxMap>('/admin_api/toolbox/map')
}

export function saveToolboxMap(map: ToolboxMap) {
  // writeFile-style 直发 payload，不要包 { map }
  return apiFetch<{ message?: string }>('/admin_api/toolbox/map', {
    method: 'POST', body: map,
  })
}

export function listToolboxFiles() {
  return apiFetch<ToolboxFilesResponse>('/admin_api/toolbox/files')
}

export function getToolboxFile(filePath: string) {
  return apiFetch<{ content: string }>(
    `/admin_api/toolbox/file/${encodeURIComponent(filePath)}`,
  )
}

export function saveToolboxFile(filePath: string, content: string) {
  return apiFetch<{ message?: string }>(
    `/admin_api/toolbox/file/${encodeURIComponent(filePath)}`,
    { method: 'POST', body: { content } },
  )
}

export function createToolboxFile(fileName: string, folderPath = '') {
  return apiFetch<{ message?: string }>('/admin_api/toolbox/new-file', {
    method: 'POST', body: { fileName, folderPath },
  })
}
