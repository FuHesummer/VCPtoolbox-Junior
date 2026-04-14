// Toolbox 管理
import { apiFetch } from './client'

export interface ToolboxEntry {
  path: string
  name: string
}

export function getToolboxMap() {
  return apiFetch<{ map: Record<string, unknown> }>('/admin_api/toolbox/map')
}

export function saveToolboxMap(map: Record<string, unknown>) {
  return apiFetch<{ message?: string }>('/admin_api/toolbox/map', { method: 'POST', body: { map } })
}

export function listToolboxFiles() {
  return apiFetch<{ files: ToolboxEntry[] }>('/admin_api/toolbox/files')
}

export function getToolboxFile(path: string) {
  return apiFetch<{ content: string }>(`/admin_api/toolbox/file/${encodeURIComponent(path)}`)
}

export function saveToolboxFile(path: string, content: string) {
  return apiFetch<{ message?: string }>(`/admin_api/toolbox/file/${encodeURIComponent(path)}`, {
    method: 'POST',
    body: { content },
  })
}

export function createToolboxFile(fileName: string, folderPath?: string) {
  return apiFetch<{ message?: string }>('/admin_api/toolbox/new-file', {
    method: 'POST',
    body: { fileName, folderPath },
  })
}
