// 全局配置 + 工具审批
import { apiFetch } from './client'

export interface ToolApprovalConfig {
  enabled?: boolean
  timeoutMinutes?: number
  approveAll?: boolean
  approvalList?: string[]
  [k: string]: unknown
}

export function getMainConfig() {
  return apiFetch<{ content: string }>('/admin_api/config/main')
}

export function getMainConfigRaw() {
  return apiFetch<{ content: string }>('/admin_api/config/main/raw')
}

export function saveMainConfig(content: string) {
  return apiFetch<{ message?: string }>('/admin_api/config/main', {
    method: 'POST',
    body: { content },
  })
}

export function getToolApprovalConfig() {
  return apiFetch<ToolApprovalConfig>('/admin_api/tool-approval-config')
}

export function saveToolApprovalConfig(config: ToolApprovalConfig) {
  return apiFetch<{ success: boolean; message?: string }>('/admin_api/tool-approval-config', {
    method: 'POST',
    body: config,
  })
}

export function getPreprocessorOrder() {
  return apiFetch<{ order: string[] }>('/admin_api/preprocessors/order')
}

export function savePreprocessorOrder(order: string[]) {
  return apiFetch<{ message?: string }>('/admin_api/preprocessors/order', {
    method: 'POST',
    body: { order },
  })
}

export function getPlaceholders() {
  return apiFetch<{ placeholders: Record<string, unknown> }>('/admin_api/placeholders')
}

export function restartServer() {
  return apiFetch<{ message?: string }>('/admin_api/server/restart', { method: 'POST' })
}
