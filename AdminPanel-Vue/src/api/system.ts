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

export function clearServerLog() {
  return apiFetch<{ success: boolean; message: string }>(
    '/admin_api/server-log/clear',
    { method: 'POST' },
  )
}

// ---------- 归档日志 ----------
export interface ArchiveSession {
  index: number
  size: number
  mtime: number
  firstLine?: string
}

export interface ArchiveDay {
  date: string
  sessions: ArchiveSession[]
}

export function getServerLogArchives() {
  return apiFetch<{ archives: ArchiveDay[] }>(
    '/admin_api/server-log/archives',
    { ...SILENT },
  )
}

export function getServerLogArchiveContent(date: string, index: number) {
  return apiFetch<{
    content: string
    fileSize: number
    truncated: boolean
    readFrom: number
    hasError: boolean
    path: string
    date: string
    index: number
  }>(
    `/admin_api/server-log/archives/${encodeURIComponent(date)}/${index}`,
    { ...SILENT },
  )
}

export function deleteServerLogArchive(date: string, index: number) {
  return apiFetch<{ success: boolean }>(
    `/admin_api/server-log/archives/${encodeURIComponent(date)}/${index}`,
    { method: 'DELETE' },
  )
}

// ---------- 重启脚本日志 ----------
export interface RestartLogFile {
  exists: boolean
  content: string
  size: number
  truncated: boolean
  mtime: number
}

export function getRestartLogs() {
  return apiFetch<{ server: RestartLogFile; admin: RestartLogFile }>(
    '/admin_api/server-log/restart-logs',
    { ...SILENT },
  )
}
