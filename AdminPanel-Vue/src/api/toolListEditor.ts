// 工具列表编辑器 / 生成器 API
// 后端挂载：/admin_api/tool-list-editor/*
// 用途：从 PluginManager 注册的 invocationCommands 自动生成工具说明 .txt 到 TVStxt/
import { apiFetch } from './client'

export interface ToolDef {
  name: string                // commandIdentifier
  pluginName: string
  displayName?: string
  description?: string
  example?: string
}

export interface ToolExportPayload {
  selectedTools: string[]
  toolDescriptions?: Record<string, string>
  includeHeader?: boolean
  includeExamples?: boolean
}

export function listToolListEditorTools() {
  return apiFetch<{ tools: ToolDef[] }>('/admin_api/tool-list-editor/tools')
}

export function checkToolFileExists(fileName: string) {
  return apiFetch<{ exists: boolean }>(
    `/admin_api/tool-list-editor/check-file/${encodeURIComponent(fileName)}`,
  )
}

// 导出工具列表为 .txt 到 TVStxt/<fileName>.txt
export function exportToolList(fileName: string, payload: ToolExportPayload) {
  return apiFetch<{ status: string; message?: string }>(
    `/admin_api/tool-list-editor/export/${encodeURIComponent(fileName)}`,
    { method: 'POST', body: payload },
  )
}
