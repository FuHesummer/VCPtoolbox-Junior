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

export interface PendingApprovalItem {
  requestId: string
  toolName: string
  args: Record<string, unknown>
  maid: string | null
  timestamp: string | null
  createdAt: number | null
}

// 实时待审批任务列表（内存存储，进程重启清空）
export function listPendingApprovals(opts: { showLoader?: boolean; suppressErrorToast?: boolean } = {}) {
  return apiFetch<{ pending: PendingApprovalItem[] }>('/admin_api/tool-approval-pending', opts)
}

// 批准/拒绝某条待审批任务
export function respondApproval(requestId: string, approved: boolean) {
  return apiFetch<{ success: boolean; approved?: boolean; error?: string }>(
    `/admin_api/tool-approval-pending/${encodeURIComponent(requestId)}`,
    { method: 'POST', body: { approved } },
  )
}

export function saveToolApprovalConfig(config: ToolApprovalConfig) {
  // 后端期望 { config: {...} } 包装，不是扁平
  return apiFetch<{ success: boolean; message?: string }>('/admin_api/tool-approval-config', {
    method: 'POST',
    body: { config },
  })
}

// 预处理器排序
// 后端返回带元信息的对象数组，保存时只需传 name 字符串数组
export interface PreprocessorItem {
  name: string
  displayName: string
  description?: string
}

export function getPreprocessorOrder() {
  return apiFetch<{ status: string; order: PreprocessorItem[] }>('/admin_api/preprocessors/order')
}

export function savePreprocessorOrder(order: string[]) {
  return apiFetch<{ status: string; message?: string; newOrder?: PreprocessorItem[] }>('/admin_api/preprocessors/order', {
    method: 'POST',
    body: { order },
  })
}

// 占位符列表
// 后端返回 { success, data: { list: [...] } }，每项 { type, name, preview, charCount, description? }
export type PlaceholderType =
  | 'agent'
  | 'env_tar_var'
  | 'env_sar'
  | 'fixed'
  | 'static_plugin'
  | 'tool_description'
  | 'vcp_all_tools'
  | 'image_key'
  | 'diary'
  | 'diary_character'
  | 'async_placeholder'

export interface PlaceholderItem {
  type: PlaceholderType
  name: string            // 含 {{ }} 如 {{VCPXXX}}
  preview: string
  charCount: number | string
  description?: string
}

export function getPlaceholders() {
  return apiFetch<{ success: boolean; data: { list: PlaceholderItem[] } }>('/admin_api/placeholders')
}

// 获取某个占位符的完整值
export function getPlaceholderDetail(type: PlaceholderType, name: string) {
  const params = new URLSearchParams({ type, name })
  return apiFetch<{ success: boolean; data: { name: string; value: string } }>(`/admin_api/placeholders/detail?${params.toString()}`)
}

export function restartServer() {
  return apiFetch<{ message?: string }>('/admin_api/server/restart', { method: 'POST' })
}
