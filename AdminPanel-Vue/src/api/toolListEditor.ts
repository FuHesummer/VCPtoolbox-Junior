// 工具列表编辑器
import { apiFetch } from './client'

export interface ToolDef {
  name: string
  pluginName: string
  displayName?: string
  description?: string
}

export function listToolListEditorTools() {
  return apiFetch<{ tools: ToolDef[] }>('/admin_api/tool-list-editor/tools')
}

export function listToolListEditorConfigs() {
  return apiFetch<{ configs: string[] }>('/admin_api/tool-list-editor/configs')
}
