// 系统监控
// 这些端点多用于 5s 轮询/自动刷新场景 — 默认 silent（不触发全局 loading + 不弹错误 toast）
// 如需触发 spinner，调用时传 { showLoader: true }
import { apiFetch } from './client'
import type { PM2Process, SystemResources } from './types'

const SILENT = { showLoader: false, suppressErrorToast: true } as const

export function getSystemResources(opts: { showLoader?: boolean } = {}) {
  return apiFetch<SystemResources>('/admin_api/system-monitor/system/resources', { ...SILENT, ...opts })
}

export function getPM2Processes(opts: { showLoader?: boolean } = {}) {
  return apiFetch<{ processes: PM2Process[] }>('/admin_api/system-monitor/pm2/processes', { ...SILENT, ...opts })
}

export function getServerLog(offset = 0, incremental = false, opts: { showLoader?: boolean } = {}) {
  const params = new URLSearchParams({ offset: String(offset), incremental: String(incremental) })
  return apiFetch<{ content: string; offset: number; needFullReload?: boolean }>(
    `/admin_api/server-log?${params}`,
    { ...SILENT, ...opts },
  )
}
